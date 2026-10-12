"use server";

import { revalidatePath } from "next/cache";
import { projectSchema, ProjectInput } from "@/lib/validations";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrgBySlug } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { assertCanMutate } from "@/lib/db/guard";
import { ActionResult, ok } from "@/lib/action-result";

type ActionResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function upsertProject(
  orgSlug: string,
  input: ProjectInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { userId, orgId, role } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  // никогда не доверяем клиенту в этих полях
  const {
    id,
    org_id: _o,
    created_by: _u,
    created_at: _c,
    ...payload
  } = parsed.data as any;

  if (id) {
    const guard = await assertCanMutate(orgSlug, "projects", id);
    if (!guard.ok) return guard.response;

    const { data, error } = await guard.ctx.supabase
      .from("projects")
      .update(payload)
      .eq("id", id)
      .eq("org_id", guard.ctx.orgId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[upsertProject:update]", error.message);
      return { success: false, error: "Не удалось сохранить проект" };
    }
    if (!data) return { success: false, error: "Проект не найден" }; // чужой org_id

    revalidatePath(`/${orgSlug}/projects`);
    revalidatePath(`/${orgSlug}/projects/${id}`);
    return { success: true, data };
  }

  // ── создание: нужен доступ на запись в организацию (у viewer его нет)
  if (!can(role, "record:create")) {
    return { success: false, error: "Недостаточно прав" };
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({ ...payload, created_by: userId, org_id: orgId })
    .select()
    .single();

  if (error) {
    console.error("[upsertProject:insert]", error.message);
    return { success: false, error: "Не удалось создать проект" };
  }

  revalidatePath(`/${orgSlug}/projects`);
  return ok({ id: data.id as string });
}

/**
 * Убрать проект в архив — мягкое удаление (`deleted_at`), а не стирание.
 *
 * Первый из двух шагов удаления: случайный клик или удаление «не тем человеком»
 * перестаёт быть необратимым — проект уходит из рабочего списка в архив, откуда
 * его возвращает `restoreProject`, а окончательно удаляет `deleteProject`.
 * Заодно это единственный путь для проектов с платежами: физически они не
 * удаляются из-за `ON DELETE RESTRICT` (ADR 0004).
 *
 * Права как у правки: автор записи или администратор.
 */
export async function archiveProject(orgSlug: string, id: string) {
  const guard = await assertCanMutate(orgSlug, "projects", id);
  if (!guard.ok) return guard.response;

  const { error } = await guard.ctx.supabase
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    console.error("[archiveProject]", error.message);
    return { success: false as const, error: "Не удалось убрать проект в архив" };
  }

  revalidatePath(`/${orgSlug}/projects`);
  return { success: true as const };
}

/** Вернуть проект из архива: снимает `deleted_at`. Права — как у архивации. */
export async function restoreProject(orgSlug: string, id: string) {
  const guard = await assertCanMutate(orgSlug, "projects", id);
  if (!guard.ok) return guard.response;

  const { error } = await guard.ctx.supabase
    .from("projects")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    console.error("[restoreProject]", error.message);
    return {
      success: false as const,
      error: "Не удалось вернуть проект из архива",
    };
  }

  revalidatePath(`/${orgSlug}/projects`);
  return { success: true as const };
}

export async function deleteProject(
  orgSlug: string,
  id: string,
): Promise<ActionResponse> {
  if (!id) return { success: false, error: "ID не указан" };

  // Организация берётся из СЛАГА страницы, а не из `active_org_id` сессии:
  // переключатель организаций в сайдбаре ведёт обычной ссылкой на `/<slug>/...`
  // и активную организацию в базе не меняет. Из-за `requireOrg()` удаление
  // искало проект в чужой организации и заканчивалось «Проект не найден»,
  // хотя карточка была видна (список читается по слагу).
  // `assertCanMutate` (lib/db/guard) сам проверяет и принадлежность записи
  // организации из слага, и права на её изменение, а `guard.ctx.orgId` — тот
  // самый org_id, по которому надо удалять.
  const guard = await assertCanMutate(orgSlug, "projects", id);
  if (!guard.ok) return guard.response;

  // Стирание — только владелец и администратор. Убрать проект в архив участник
  // может (это обратимо), а уничтожить данные организации — нет.
  if (!can(guard.ctx.role, "record:mutate:any")) {
    return {
      success: false,
      error: "Удалить проект окончательно может только администратор",
    };
  }

  // И только из архива: два шага вместо одного клика — цена необратимости.
  const { data: project } = await guard.ctx.supabase
    .from("projects")
    .select("deleted_at")
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId)
    .maybeSingle();

  // Между проверкой прав и этим чтением проект мог исчезнуть: тогда честнее
  // сказать «не найден», чем упасть на необъявленном состоянии.
  if (!project) return { success: false, error: "Проект не найден" };
  if (project.deleted_at === null) {
    return { success: false, error: "Сначала переместите проект в архив" };
  }

  const { error } = await guard.ctx.supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    // 23503 — нарушение внешнего ключа: на платежах и графике платежей стоит
    // ON DELETE RESTRICT, поэтому проект с финансовой историей физически не
    // удаляется (см. ADR 0004). Пользователю нужна причина, а не «не удалилось».
    if (error.code === "23503") {
      return {
        success: false,
        error:
          "По проекту есть платежи или график платежей — финансовая история не удаляется. Удалить проект нельзя.",
      };
    }
    console.error("[deleteProject]", error.message);
    return { success: false, error: "Не удалось удалить проект" };
  }

  revalidatePath(`/${orgSlug}/projects`);
  return { success: true };
}

const MAX_PROJECT_IMAGE_SIZE = 5 * 1024 * 1024;
const PROJECT_IMAGES_BUCKET = "project-images";

export async function uploadProjectImage(
  orgSlug: string,
  formData: FormData,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const { orgId, role } = await requireOrgBySlug(orgSlug);

  // Загрузка обложки — операция записи, а не чтения: наблюдателю она недоступна.
  if (!can(role, "record:create")) {
    return { success: false, error: "Недостаточно прав" };
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { success: false, error: "Файл не найден" };
  }
  if (!file.type.startsWith("image/")) {
    return { success: false, error: "Нужно изображение" };
  }
  if (file.size > MAX_PROJECT_IMAGE_SIZE) {
    return { success: false, error: "Файл больше 5 МБ" };
  }

  const supabase = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${orgId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(PROJECT_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    console.error("[uploadProjectImage]", error.message);
    return { success: false, error: "Не удалось загрузить изображение" };
  }

  const { data } = supabase.storage
    .from(PROJECT_IMAGES_BUCKET)
    .getPublicUrl(path);
  return { success: true, url: data.publicUrl };
}
