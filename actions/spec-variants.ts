"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canMutateRecord } from "@/lib/permissions";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import { specVariantPatchSchema } from "@/lib/validations";
import { rowToVariant } from "@/lib/spec/variants";
import type { SpecVariant } from "@/lib/types";

/** Колонки позиции, из которых собирается снимок её базового материала. */
const BASE_SNAPSHOT_COLUMNS =
  "name, brand, article, spec, price, product_url, image_url, lead_time, company_id, contact_id, company_name_snapshot";

/**
 * Проверяет, что позиция принадлежит организации из сессии и что у
 * пользователя есть право её менять (по создателю проекта). Возвращает
 * admin-клиент и projectId для revalidate — или null, если доступа нет.
 */
async function assertSpecItem(orgSlug: string, specItemId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data: item } = await supabase
    .from("spec_items")
    .select("id, project_id, org_id")
    .eq("id", specItemId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!item) return null;

  const { data: project } = await supabase
    .from("projects")
    .select("created_by")
    .eq("id", item.project_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!project) return null;

  if (
    !canMutateRecord({
      role: ctx.role,
      userId: ctx.userId,
      createdBy: project.created_by,
    })
  ) {
    return null;
  }

  return { supabase, orgId: ctx.orgId, projectId: item.project_id };
}

/**
 * Сохраняет текущий материал позиции отдельным вариантом (position = 0,
 * label «Основной»), если у позиции ещё нет ни одного варианта.
 *
 * Без этого снимка замена оказывается единственной записью, а исходный
 * материал остаётся только в плоских полях spec_items: после переключения
 * на замену `applyActiveVariant` перекрывает их, и вернуться к исходному
 * материалу из интерфейса уже нечем.
 *
 * Снимок создаётся только когда других вариантов у позиции нет, поэтому
 * он же и активный.
 */
async function ensureBaseVariant(
  ctx: Awaited<ReturnType<typeof assertSpecItem>>,
  specItemId: string,
): Promise<ActionResult<SpecVariant | null>> {
  if (!ctx) return fail("Проект не найден");

  const { data: existing, error } = await ctx.supabase
    .from("spec_item_variants")
    .select("id, is_active")
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId);

  if (error) return fail("Не удалось прочитать варианты");
  const variants = existing ?? [];
  if (variants.length > 0) return ok(null);

  const { data: item, error: itemErr } = await ctx.supabase
    .from("spec_items")
    .select(BASE_SNAPSHOT_COLUMNS)
    .eq("id", specItemId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (itemErr || !item) return fail("Позиция не найдена");

  const { data: base, error: insertErr } = await ctx.supabase
    .from("spec_item_variants")
    .insert({
      spec_item_id: specItemId,
      org_id: ctx.orgId,
      name: item.name ?? "",
      brand: item.brand ?? "",
      article: item.article ?? "",
      spec: item.spec ?? "",
      price: item.price ?? 0,
      product_url: item.product_url ?? "",
      image_url: item.image_url ?? null,
      lead_time: item.lead_time ?? "",
      company_id: item.company_id ?? null,
      contact_id: item.contact_id ?? null,
      company_name_snapshot: item.company_name_snapshot ?? "",
      label: "Основной",
      // снимок создаётся только когда других вариантов нет — он и активный
      is_active: true,
      position: 0,
    })
    .select("*")
    .single();

  if (insertErr) {
    console.error("[ensureBaseVariant]", insertErr.message);
    return fail("Не удалось сохранить текущий материал как вариант");
  }
  return ok(rowToVariant(base));
}

/**
 * Добавляет вариант замены. Перед этим исходный материал позиции
 * фиксируется отдельным вариантом, чтобы переключение было обратимым.
 */
export async function addVariant(
  orgSlug: string,
  specItemId: string,
  label = "Альтернатива",
): Promise<ActionResult<{ id: string; base: SpecVariant | null }>> {
  const ctx = await assertSpecItem(orgSlug, specItemId);
  if (!ctx) return fail("Проект не найден");

  const base = await ensureBaseVariant(ctx, specItemId);
  if (!base.success) return base;

  // берём активный как основу — альтернативу удобнее править от существующего
  const { data: source } = await ctx.supabase
    .from("spec_item_variants")
    .select("*")
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .eq("is_active", true)
    .maybeSingle();

  const { data: last } = await ctx.supabase
    .from("spec_item_variants")
    .select("position")
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.supabase
    .from("spec_item_variants")
    .insert({
      spec_item_id: specItemId,
      org_id: ctx.orgId,
      name: source?.name ?? "",
      brand: source?.brand ?? "",
      article: source?.article ?? "",
      spec: source?.spec ?? "",
      price: source?.price ?? 0,
      product_url: source?.product_url ?? "",
      image_url: source?.image_url ?? null,
      lead_time: source?.lead_time ?? "",
      company_id: source?.company_id ?? null,
      contact_id: source?.contact_id ?? null,
      company_name_snapshot: source?.company_name_snapshot ?? "",
      label,
      is_active: false,
      position: (last?.position ?? 0) + 1,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[addVariant]", error.message);
    return fail("Не удалось добавить вариант");
  }
  revalidatePath(`/${orgSlug}/projects/${ctx.projectId}`);
  return ok({ id: data.id, base: base.data });
}

/** Переключает активный вариант атомарно: снимает флаг со всех, ставит одному. */
export async function switchVariant(
  orgSlug: string,
  specItemId: string,
  variantId: string,
): Promise<ActionResult> {
  const ctx = await assertSpecItem(orgSlug, specItemId);
  if (!ctx) return fail("Проект не найден");

  // снять активность со всех, кроме целевого — иначе уникальный индекс упрётся
  const { error: e1 } = await ctx.supabase
    .from("spec_item_variants")
    .update({ is_active: false })
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .neq("id", variantId);
  if (e1) return fail("Не удалось переключить вариант");

  // целевой обязан принадлежать той же позиции и организации
  const { error: e2 } = await ctx.supabase
    .from("spec_item_variants")
    .update({ is_active: true })
    .eq("id", variantId)
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId);
  if (e2) return fail("Не удалось переключить вариант");

  revalidatePath(`/${orgSlug}/projects/${ctx.projectId}`);
  return ok(null);
}

export async function updateVariant(
  orgSlug: string,
  specItemId: string,
  variantId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult> {
  const ctx = await assertSpecItem(orgSlug, specItemId);
  if (!ctx) return fail("Проект не найден");

  // неизвестные/служебные ключи (id, org_id, spec_item_id, is_active) отбрасываются
  const parsed = specVariantPatchSchema.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  // название компании — снапшот на момент записи: в интерфейсе выбирают
  // только id, поэтому имя резолвит сервер (как в saveSpecItemPatch).
  if ("company_id" in parsed.data) {
    const companyId = parsed.data.company_id;
    if (companyId) {
      const { data: company } = await ctx.supabase
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .eq("org_id", ctx.orgId)
        .maybeSingle();
      if (!company) return fail("Компания не найдена");
      parsed.data.company_name_snapshot = company.name;
    } else {
      parsed.data.company_name_snapshot = "";
    }
  }

  const { error } = await ctx.supabase
    .from("spec_item_variants")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", variantId)
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId);

  if (error) {
    console.error("[updateVariant]", error.message);
    return fail("Не удалось сохранить вариант");
  }
  revalidatePath(`/${orgSlug}/projects/${ctx.projectId}`);
  return ok(null);
}

export async function deleteVariant(
  orgSlug: string,
  specItemId: string,
  variantId: string,
): Promise<ActionResult> {
  const ctx = await assertSpecItem(orgSlug, specItemId);
  if (!ctx) return fail("Проект не найден");

  // последний вариант не удаляем — у позиции всегда должен остаться активный
  const { count } = await ctx.supabase
    .from("spec_item_variants")
    .select("id", { count: "exact", head: true })
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId);
  if ((count ?? 0) <= 1) return fail("Нельзя удалить последний вариант");

  const { data: target } = await ctx.supabase
    .from("spec_item_variants")
    .select("is_active")
    .eq("id", variantId)
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  const { error } = await ctx.supabase
    .from("spec_item_variants")
    .delete()
    .eq("id", variantId)
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId);
  if (error) return fail("Не удалось удалить вариант");

  // удалили активный → назначаем активным первый оставшийся
  if (target?.is_active) {
    const { data: next } = await ctx.supabase
      .from("spec_item_variants")
      .select("id")
      .eq("spec_item_id", specItemId)
      .eq("org_id", ctx.orgId)
      .order("position")
      .limit(1)
      .maybeSingle();
    if (next) {
      await ctx.supabase
        .from("spec_item_variants")
        .update({ is_active: true })
        .eq("id", next.id)
        .eq("spec_item_id", specItemId)
        .eq("org_id", ctx.orgId);
    }
  }

  revalidatePath(`/${orgSlug}/projects/${ctx.projectId}`);
  return ok(null);
}
