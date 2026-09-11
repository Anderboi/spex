"use server";

import { revalidatePath } from "next/cache";
import {
  companySchema,
  contactSchema,
  CompanyInput,
  ContactInput,
} from "@/lib/validations";
import { assertCanMutate, forbidden, scoped } from "@/lib/db/guard";
import { can } from "@/lib/permissions";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// --- ИЗОБРАЖЕНИЯ (Storage) ---

/**
 * Публичный bucket с логотипами компаний и фото специалистов.
 * Создаётся вручную в Supabase Dashboard (лимит 5 МБ, разрешены image/*).
 */
const CONTACT_IMAGES_BUCKET = "company-images";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * Достаёт путь внутри bucket из public URL, если файл принадлежит
 * CONTACT_IMAGES_BUCKET. Для чужих URL (другие bucket / внешние ссылки)
 * возвращает null — такие файлы не трогаем.
 */
function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${CONTACT_IMAGES_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length).split("?")[0];
  return path ? decodeURIComponent(path) : null;
}

/** Best-effort удаление файла из Storage: ошибка не должна ломать запись в БД. */
async function removeStoredImage(
  supabase: ReturnType<typeof createAdminClient>,
  url: string | null | undefined,
) {
  const path = storagePathFromUrl(url);
  if (!path) return;
  const { error } = await supabase.storage
    .from(CONTACT_IMAGES_BUCKET)
    .remove([path]);
  if (error) console.error("[removeStoredImage]", error.message);
}

/**
 * Загрузка логотипа компании или фото специалиста.
 *
 * kind = "company" → {orgId}/companies/{uuid}.{ext}
 * kind = "contact" → {orgId}/contacts/{uuid}.{ext}
 *
 * При успешной загрузке старый файл (previousUrl) удаляется, если он
 * принадлежал bucket company-images.
 */
export async function uploadContactImage(
  orgSlug: string,
  formData: FormData,
  kind: "company" | "contact",
  previousUrl?: string | null,
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
  const folder = kind === "company" ? "companies" : "contacts";
  const path = `${orgId}/${folder}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(CONTACT_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    console.error("[uploadContactImage]", error.message);
    return { success: false, error: "Не удалось загрузить изображение" };
  }

  // Замена: старый файл больше не нужен.
  await removeStoredImage(supabase, previousUrl);

  const { data } = supabase.storage
    .from(CONTACT_IMAGES_BUCKET)
    .getPublicUrl(path);
  return { success: true, url: data.publicUrl };
}

// --- КОМПАНИИ ---

export async function upsertCompany(orgSlug: string, input: CompanyInput) {
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  const { id, ...fields } = parsed.data as CompanyInput & { id?: string };

  // ── обновление
  if (id) {
    const guard = await assertCanMutate(orgSlug, "companies", id);
    if (!guard.ok) return guard.response;

    // Текущий логотип нужен, чтобы удалить заменённый/очищенный файл.
    const { data: existing } = await guard.ctx.supabase
      .from("companies")
      .select("logo_url")
      .eq("id", id)
      .eq("org_id", guard.ctx.orgId)
      .maybeSingle();
    const previousLogo = existing?.logo_url ?? null;

    const { data, error } = await guard.ctx.supabase
      .from("companies")
      .update(fields)
      .eq("id", id)
      .eq("org_id", guard.ctx.orgId) // ← защита даже здесь
      .select()
      .single();

    if (error) {
      console.error("[upsertCompany:update]", error.message);
      return {
        success: false as const,
        error: "Не удалось сохранить компанию",
      };
    }

    // Логотип заменён или очищен — старый файл удаляем (best-effort).
    const nextLogo =
      fields.logo_url === undefined ? previousLogo : (fields.logo_url ?? null);
    if (previousLogo && previousLogo !== nextLogo) {
      await removeStoredImage(guard.ctx.supabase, previousLogo);
    }

    revalidatePath(`/${orgSlug}/contacts`);
    // ← компания могла быть подрядчиком операций на страницах проектов
    revalidatePath(`/${orgSlug}/projects`, "layout");
    return { success: true as const, data };
  }

  // ── создание
  const ctx = await scoped(orgSlug);
  if (!can(ctx.role, "record:create")) return forbidden();

  const { data, error } = await ctx.supabase
    .from("companies")
    .insert({ ...fields, org_id: ctx.orgId, created_by: ctx.userId })
    .select()
    .single();

  if (error) {
    console.error("[upsertCompany:insert]", error.message);
    return { success: false as const, error: "Не удалось создать компанию" };
  }

  revalidatePath(`/${orgSlug}/contacts`);
  // ← компания могла быть подрядчиком операций на страницах проектов
  revalidatePath(`/${orgSlug}/projects`, "layout");
  return { success: true as const, data };
}

export async function deleteCompany(orgSlug: string, id: string) {
  const guard = await assertCanMutate(orgSlug, "companies", id);
  if (!guard.ok) return guard.response;

  // 1. Логотип: берём URL и удаляем файл из Storage (best-effort).
  const { data: existing } = await guard.ctx.supabase
    .from("companies")
    .select("logo_url")
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId)
    .maybeSingle();
  await removeStoredImage(guard.ctx.supabase, existing?.logo_url ?? null);

  // FK: contacts.company_id → SET NULL, materials.company_id → SET NULL
  // контакты станут независимыми, материалы останутся без поставщика
  const { error } = await guard.ctx.supabase
    .from("companies")
    .delete()
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    console.error("[deleteCompany]", error.message);
    return { success: false as const, error: "Не удалось удалить компанию" };
  }

  revalidatePath(`/${orgSlug}/contacts`);
  revalidatePath(`/${orgSlug}/materials`); // ← у материалов пропал поставщик
  // ← у операций проектов подрядчик обнуляется (FK ON DELETE SET NULL)
  revalidatePath(`/${orgSlug}/projects`, "layout");
  return { success: true as const };
}

// --- КОНТАКТЫ / МЕНЕДЖЕРЫ ---

export async function upsertContact(
  orgSlug: string,
  input: ContactInput & { company_id?: string | null },
) {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    console.error("[upsertContact] validation:", parsed.error.format());
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  const { id, ...fields } = parsed.data as ContactInput & { id?: string };
  const companyId = input.company_id ?? null;

  if (id) {
    const guard = await assertCanMutate(orgSlug, "contacts", id);
    if (!guard.ok) return guard.response;

    // Текущее фото нужно, чтобы удалить заменённый/очищенный файл.
    const { data: existing } = await guard.ctx.supabase
      .from("contacts")
      .select("avatar_url")
      .eq("id", id)
      .eq("org_id", guard.ctx.orgId)
      .maybeSingle();
    const previousAvatar = existing?.avatar_url ?? null;

    // компания обязана быть из той же организации
    if (companyId) {
      const { data: co } = await guard.ctx.supabase
        .from("companies")
        .select("id")
        .eq("id", companyId)
        .eq("org_id", guard.ctx.orgId)
        .maybeSingle();
      if (!co) return { success: false as const, error: "Компания не найдена" };
    }

    const { data, error } = await guard.ctx.supabase
      .from("contacts")
      .update({ ...fields, company_id: companyId })
      .eq("id", id)
      .eq("org_id", guard.ctx.orgId)
      .select()
      .single();

    if (error) {
      console.error("[upsertContact:update]", error.message);
      return { success: false as const, error: "Не удалось сохранить контакт" };
    }

    // Фото заменено или очищено — старый файл удаляем (best-effort).
    const nextAvatar =
      fields.avatar_url === undefined
        ? previousAvatar
        : (fields.avatar_url ?? null);
    if (previousAvatar && previousAvatar !== nextAvatar) {
      await removeStoredImage(guard.ctx.supabase, previousAvatar);
    }

    revalidatePath(`/${orgSlug}/contacts`);
    return { success: true as const, data };
  }

  const ctx = await scoped(orgSlug);
  if (!can(ctx.role, "record:create")) return forbidden();

  if (companyId) {
    const { data: co } = await ctx.supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    if (!co) return { success: false as const, error: "Компания не найдена" };
  }

  const { data, error } = await ctx.supabase
    .from("contacts")
    .insert({
      ...fields,
      company_id: companyId,
      org_id: ctx.orgId,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (error) {
    console.error("[upsertContact:insert]", error.message);
    return { success: false as const, error: "Не удалось создать контакт" };
  }

  revalidatePath(`/${orgSlug}/contacts`);
  return { success: true as const, data };
}

export async function deleteContact(orgSlug: string, id: string) {
  const guard = await assertCanMutate(orgSlug, "contacts", id);
  if (!guard.ok) return guard.response;

  // 1. Фото: берём URL и удаляем файл из Storage (best-effort).
  const { data: existing } = await guard.ctx.supabase
    .from("contacts")
    .select("avatar_url")
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId)
    .maybeSingle();
  await removeStoredImage(guard.ctx.supabase, existing?.avatar_url ?? null);

  const { error } = await guard.ctx.supabase
    .from("contacts")
    .delete()
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    console.error("[deleteContact]", error.message);
    return { success: false as const, error: "Не удалось удалить контакт" };
  }

  revalidatePath(`/${orgSlug}/contacts`);
  revalidatePath(`/${orgSlug}/materials`);
  return { success: true as const };
}
