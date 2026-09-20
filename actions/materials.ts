"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MaterialInput, materialSchema } from "@/lib/validations";
import { assertCanMutate, forbidden, scoped } from "@/lib/db/guard";
import { can, canMutateRecord } from "@/lib/permissions";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import {
  MATERIAL_TARGET_PROJECT_STATUSES,
  TYPE_ORDER,
  type SpecType,
} from "@/lib/constants";
import { prefixFor } from "@/lib/utils";
import { nextCodesFrom } from "@/lib/spec/codes";
import { getMaterialProjectTargets, type MaterialProjectTarget } from "@/lib/queries";
import type { TablesInsert } from "@/lib/supabase/database.types";

type ActionResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function upsertMaterial(
  orgSlug: string,
  input: MaterialInput,
): Promise<ActionResponse> {
  // const { userId, orgId, role } = await requireOrgBySlug(orgSlug);
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  const { id, ...fields } = parsed.data as MaterialInput & { id?: string };

  if (id) {
    const guard = await assertCanMutate(orgSlug, "materials", id);
    if (!guard.ok) return guard.response;

    const { data, error } = await guard.ctx.supabase
      .from("materials")
      .update(fields)
      .eq("id", id)
      .eq("org_id", guard.ctx.orgId)
      .select()
      .single();

    if (error) {
      console.error("[upsertMaterial:update]", error.message);
      return {
        success: false as const,
        error: "Не удалось сохранить материал",
      };
    }
    revalidatePath(`/${orgSlug}/materials`);
    return { success: true as const, data };
  }

  //* ── создание
  const ctx = await scoped(orgSlug);
  if (!can(ctx.role, "record:create")) return forbidden();

  const { data, error } = await ctx.supabase
    .from("materials")
    .insert({ ...fields, org_id: ctx.orgId, created_by: ctx.userId })
    .select()
    .single();

  if (error) {
    console.error("[upsertMaterial:insert]", error.message);
    return { success: false as const, error: "Не удалось создать материал" };
  }

  revalidatePath(`/${orgSlug}/materials`);
  return { success: true as const, data };
}

export async function deleteMaterial(orgSlug: string, id: string) {
  const guard = await assertCanMutate(orgSlug, "materials", id);
  if (!guard.ok) return guard.response;

  // мягкое удаление: материал может стоять в спецификациях сданных проектов
  const { error } = await guard.ctx.supabase
    .from("materials")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    console.error("[deleteMaterial]", error.message);
    return { success: false as const, error: "Не удалось удалить материал" };
  }

  revalidatePath(`/${orgSlug}/materials`);
  return { success: true as const };
}

/* ------------------------------------------------------------------ */
/*  Материал → спецификация проекта                                    */
/* ------------------------------------------------------------------ */

/** Что нужно клиенту после успешного прикрепления: ссылка и присвоенная марка. */
export type AttachMaterialResult = {
  itemId: string;
  /** Марка новой позиции («ОТ-07»). */
  code: string;
  projectId: string;
  projectTitle: string;
};

const attachMaterialSchema = z.object({
  projectId: z.string().uuid("Некорректный проект"),
  materialId: z.string().uuid("Некорректный материал"),
});

/**
 * Проекты-цели для диалога «В проект» — по требованию.
 *
 * Раньше список приезжал вместе с открытием диалога: параметр
 * `action=to-project` читал серверный компонент страницы, и переход по URL
 * заново рендерил всю библиотеку. Теперь диалог открывается «shallow», без
 * серверного рендера, поэтому данные запрашиваются отдельно — уже после того,
 * как окно показалось (в диалоге на этот случай есть скелет, см.
 * `targets === null` в AttachToProjectDialog).
 */
export async function listMaterialProjectTargets(
  orgSlug: string,
  materialId: string,
): Promise<MaterialProjectTarget[]> {
  return getMaterialProjectTargets(orgSlug, materialId);
}

/** Сколько раз пересчитывать марку, если номер заняли параллельно. */
const ATTACH_CODE_ATTEMPTS = 3;

/**
 * Прикрепить материал библиотеки к проекту: создать в спецификации проекта
 * позицию, связанную с материалом (`spec_items.material_id`).
 *
 * Материал — шаблон, а не ссылка: значения копируются в позицию снимком на
 * момент добавления (так же работает добавление из библиотеки в конструкторе
 * спецификации, см. `addFromLibrary` в hooks/use-spec-builder.ts). Дальше
 * позиция живёт своей жизнью, а правки материала её не трогают.
 *
 * Повторное добавление того же материала в тот же проект запрещено — это
 * дубль в спецификации, а не вторая позиция. Проверка выполняется здесь, а не
 * только в UI: список проектов мог устареть, пока диалог был открыт.
 *
 * Марка присваивается на сервере (следующий свободный номер для категории) —
 * клиент не должен угадывать нумерацию проекта, которого он не открывал.
 */
export async function addMaterialToProject(
  orgSlug: string,
  projectId: string,
  materialId: string,
): Promise<ActionResult<AttachMaterialResult>> {
  const parsed = attachMaterialSchema.safeParse({ projectId, materialId });
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Неверные данные",
      "INVALID_INPUT",
    );
  }

  const ctx = await scoped(orgSlug);

  const { data: material, error: materialError } = await ctx.supabase
    .from("materials")
    .select(
      "id, name, brand, article, category, unit, price, image_url, product_type, product_url, lead_time, attrs, company_id, contact_id, deleted_at",
    )
    .eq("id", materialId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (materialError) {
    console.error("[addMaterialToProject] material", materialError.message);
    return fail("Не удалось загрузить материал");
  }
  if (!material) return fail("Материал не найден в библиотеке", "NOT_FOUND");
  if (material.deleted_at !== null) {
    return fail(
      "Материал удалён из библиотеки — восстановите его, чтобы добавить в проект",
      "NOT_FOUND",
    );
  }

  const { data: project, error: projectError } = await ctx.supabase
    .from("projects")
    .select("id, title, status, created_by")
    .eq("id", projectId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (projectError) {
    console.error("[addMaterialToProject] project", projectError.message);
    return fail("Не удалось загрузить проект");
  }
  if (!project) return fail("Проект не найден", "NOT_FOUND");

  if (
    !(MATERIAL_TARGET_PROJECT_STATUSES as readonly string[]).includes(
      project.status,
    )
  ) {
    return fail(
      `Проект «${project.title}» завершён или в архиве — материалы в него не добавляются`,
      "FORBIDDEN",
    );
  }

  // Право на изменение проекта — то же правило, что у действий спецификации.
  if (
    !canMutateRecord({
      role: ctx.role,
      userId: ctx.userId,
      createdBy: project.created_by,
    })
  ) {
    return fail("Недостаточно прав: проект создан другим участником", "FORBIDDEN");
  }

  const { count, error: duplicateError } = await ctx.supabase
    .from("spec_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("org_id", ctx.orgId)
    .eq("material_id", materialId)
    .is("deleted_at", null);

  if (duplicateError) {
    console.error("[addMaterialToProject] duplicate", duplicateError.message);
    return fail("Не удалось проверить спецификацию проекта");
  }
  if ((count ?? 0) > 0) {
    return fail(
      `Материал уже добавлен в спецификацию проекта «${project.title}»`,
      "ALREADY_IN_PROJECT",
    );
  }

  // Снапшоты поставщика и менеджера: позиция должна читаться и после того,
  // как компанию или контакт переименуют.
  const [companyName, contactName] = await Promise.all([
    snapshotName(ctx.supabase, ctx.orgId, "companies", material.company_id),
    snapshotName(ctx.supabase, ctx.orgId, "contacts", material.contact_id),
  ]);

  // Категория материала — раздел спецификации; неизвестное значение уходит
  // в «Прочее», чтобы позиция не выпала из группировки.
  const type: SpecType = (TYPE_ORDER as readonly string[]).includes(
    material.category,
  )
    ? (material.category as SpecType)
    : "Прочее";
  const prefix = prefixFor(type);

  const [positionRes, codesRes] = await Promise.all([
    ctx.supabase
      .from("spec_items")
      .select("position")
      .eq("project_id", projectId)
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ctx.supabase
      .from("spec_items")
      .select("code")
      .eq("project_id", projectId)
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .like("code", `${prefix}-%`),
  ]);

  const row: TablesInsert<"spec_items"> = {
    project_id: projectId,
    org_id: ctx.orgId,
    material_id: material.id,
    company_id: material.company_id,
    company_name_snapshot: companyName,
    contact_id: material.contact_id,
    contact_name_snapshot: contactName,
    image_url: material.image_url,
    type,
    name: material.name,
    brand: material.brand,
    article: material.article,
    qty: 1,
    unit: material.unit || "шт",
    price: material.price,
    // Как в конструкторе: цена есть — позиция «подобрана», иначе черновик.
    status: material.price > 0 ? "picked" : "draft",
    is_placeholder: false,
    position: (positionRes.data?.position ?? -1) + 1,
    product_type: material.product_type,
    product_url: material.product_url,
    lead_time: material.lead_time,
    attrs: material.attrs,
  };

  const usedCodes = (codesRes.data ?? []).map((r) => r.code ?? "");

  // Нумерация и порядок восстанавливаются из БД; при сбое чтения работаем по
  // пустому списку (марка и позиция всё равно будут проверены вставкой).
  if (positionRes.error) {
    console.error("[addMaterialToProject] position", positionRes.error.message);
  }
  if (codesRes.error) {
    console.error("[addMaterialToProject] codes", codesRes.error.message);
  }

  // Марку мог занять кто-то другой между чтением и вставкой (вторая вкладка,
  // конструктор спецификации). Гонка редкая, но пользователь не должен видеть
  // ошибку уникальности: пересчитываем номер и пробуем снова.
  for (let attempt = 0; attempt < ATTACH_CODE_ATTEMPTS; attempt++) {
    const code = nextCodesFrom(prefix, usedCodes, 1)[0];
    const itemId = crypto.randomUUID();
    const { error } = await ctx.supabase
      .from("spec_items")
      .insert({ ...row, id: itemId, code });

    if (!error) {
      revalidatePath(`/${orgSlug}/projects/${projectId}`);
      revalidatePath(`/${orgSlug}/materials`);
      return ok({
        itemId,
        code,
        projectId,
        projectTitle: project.title,
      });
    }

    if (error.code !== "23505") {
      console.error("[addMaterialToProject] insert", error.message);
      return fail("Не удалось добавить материал в проект");
    }

    usedCodes.push(code);
  }

  return fail("Не удалось подобрать свободную марку — обновите страницу проекта");
}

/** Имя компании или контакта для снапшота; null — записи нет или она не указана. */
async function snapshotName(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  table: "companies" | "contacts",
  id: string | null,
): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabase
    .from(table)
    .select("name")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  return data?.name ?? null;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MATERIAL_IMAGES_BUCKET = "material-images";

export async function uploadMaterialImage(
  orgSlug: string,
  formData: FormData,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const { orgId } = await requireOrgBySlug(orgSlug);

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { success: false, error: "Файл не найден" };
  }
  if (!file.type.startsWith("image/")) {
    return { success: false, error: "Нужно изображение" };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { success: false, error: "Файл больше 5 МБ" };
  }

  const supabase = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${orgId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(MATERIAL_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    console.error("[uploadMaterialImage]", error.message);
    return { success: false, error: "Не удалось загрузить изображение" };
  }

  const { data } = supabase.storage
    .from(MATERIAL_IMAGES_BUCKET)
    .getPublicUrl(path);
  return { success: true, url: data.publicUrl };
}
