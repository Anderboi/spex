"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canMutateRecord } from "@/lib/permissions";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import {
  ManualSpecItemInput,
  manualSpecItemSchema,
  SpecItemPatch,
  specItemPatchSchema,
} from "@/lib/validations";
import { patchToRow } from "@/lib/spec/mappers";
import { callRpc } from "@/lib/supabase/rpc";
import { TablesInsert } from "@/lib/supabase/database.types";
import { SpecType } from "@/lib/constants";

async function assertProject(orgSlug: string, projectId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, created_by")
    .eq("id", projectId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();
  return { ...ctx, supabase, project };
}

async function guard(orgSlug: string, projectId: string) {
  const c = await assertProject(orgSlug, projectId);
  if (!c.project) return { error: "Проект не найден" as const, c: null };
  if (
    !canMutateRecord({
      role: c.role,
      userId: c.userId,
      createdBy: c.project.created_by,
    })
  ) {
    return { error: "Недостаточно прав" as const, c: null };
  }
  return { error: null, c };
}

/** Название компании на момент записи. null — компания не указана. */
async function companySnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  companyId: string | null | undefined,
): Promise<{ ok: true; name: string | null } | { ok: false }> {
  if (!companyId) return { ok: true, name: null };
  const { data } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data ? { ok: true, name: data.name } : { ok: false };
}

export async function saveSpecItemPatch(
  orgSlug: string,
  projectId: string,
  itemId: string,
  patch: SpecItemPatch,
): Promise<ActionResult<null>> {
  const parsed = specItemPatchSchema.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);

  const row = patchToRow(parsed.data);
  if (Object.keys(row).length === 0) return ok(null);

  if (row.company_id) {
    const snap = await companySnapshot(c.supabase, c.orgId, row.company_id);
    if (!snap.ok) return fail("Компания не найдена");
    row.company_name_snapshot = snap.name;
  }

  const { error } = await c.supabase
    .from("spec_items")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null);

  if (error) {
    if (error.code === "23505") return fail("Марка уже занята другой позицией");
    console.error("[saveSpecItemPatch]", error.message);
    return fail("Не удалось сохранить изменения");
  }
  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

export async function createSpecItems(
  orgSlug: string,
  projectId: string,
  items: (SpecItemPatch & { id: string; name: string; type: SpecType })[],
): Promise<ActionResult<null>> {
  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);
  if (items.length === 0) return ok(null);

  const { data: last } = await c.supabase
    .from("spec_items")
    .select("position")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  // снапшоты названий — одним запросом на все компании сразу
  const companyIds = [
    ...new Set(items.map((i) => i.companyId).filter(Boolean)),
  ] as string[];
  const names = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data } = await c.supabase
      .from("companies")
      .select("id, name")
      .in("id", companyIds)
      .eq("org_id", c.orgId);
    for (const co of data ?? []) names.set(co.id, co.name);
  }

  let pos = (last?.position ?? -1) + 1;
  const rows: TablesInsert<"spec_items">[] = items.map((it) => ({
    ...patchToRow(it),
    id: it.id,
    project_id: projectId,
    org_id: c.orgId,
    name: it.name,
    type: it.type,
    company_name_snapshot: it.companyId
      ? (names.get(it.companyId) ?? null)
      : null,
    position: pos++,
  }));

  const { error } = await c.supabase.from("spec_items").insert(rows);
  if (error) {
    if (error.code === "23505") return fail("Одна из марок уже занята");
    console.error("[createSpecItems]", error.message);
    return fail("Не удалось добавить позиции");
  }
  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

export async function createManualSpecItem(
  orgSlug: string,
  projectId: string,
  payload: ManualSpecItemInput & {
    itemId: string;
    materialId: string | null;
    code: string;
  },
): Promise<ActionResult<null>> {
  const parsed = manualSpecItemSchema.safeParse(payload);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);
  const d = parsed.data;

  const snap = await companySnapshot(c.supabase, c.orgId, d.companyId);
  if (!snap.ok) return fail("Компания не найдена");

  // 1. библиотека — только если попросили
  if (payload.materialId) {
    const { error } = await c.supabase.from("materials").insert({
      id: payload.materialId,
      org_id: c.orgId,
      created_by: c.userId,
      name: d.name,
      brand: d.brand || null,
      category: d.type,
      spec: d.spec || null,
      article: d.article || null,
      unit: d.unit,
      price: d.price,
      company_id: d.companyId,
    });
    if (error) {
      console.error("[createManualSpecItem:material]", error.message);
      return fail("Не удалось сохранить материал в библиотеку");
    }
  }

  // 2. позиция
  const { data: last } = await c.supabase
    .from("spec_items")
    .select("position")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await c.supabase.from("spec_items").insert({
    id: payload.itemId,
    project_id: projectId,
    org_id: c.orgId,
    material_id: payload.materialId,
    company_id: d.companyId,
    company_name_snapshot: snap.name,
    code: payload.code,
    type: d.type,
    name: d.name,
    brand: d.brand || null,
    spec: d.spec || null,
    article: d.article || null,
    qty: d.qty,
    unit: d.unit,
    price: d.price,
    stock_pct: d.stockPct, // ← три новых поля
    client_discount_pct: d.clientDiscountPct, // ←
    supplier_discount_pct: d.supplierDiscountPct, // ←
    status: d.price > 0 ? "picked" : "draft",
    is_placeholder: false,
    position: (last?.position ?? -1) + 1,
  });

  if (error) {
    // материал уже создан — убираем, чтобы не осталось сироты
    if (payload.materialId) {
      await c.supabase
        .from("materials")
        .delete()
        .eq("id", payload.materialId)
        .eq("org_id", c.orgId);
    }
    if (error.code === "23505")
      return fail("Марка уже занята — обновите страницу");
    console.error("[createManualSpecItem:item]", error.message);
    return fail("Не удалось добавить позицию");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  if (payload.materialId) revalidatePath(`/${orgSlug}/materials`);
  return ok(null);
}

export async function deleteSpecItems(
  orgSlug: string,
  projectId: string,
  ids: string[],
): Promise<ActionResult<null>> {
  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);
  if (ids.length === 0) return ok(null);

  const { error } = await c.supabase
    .from("spec_items")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId);

  if (error) {
    console.error("[deleteSpecItems]", error.message);
    return fail("Не удалось удалить");
  }
  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

export async function restoreSpecItems(
  orgSlug: string,
  projectId: string,
  ids: string[],
): Promise<ActionResult<null>> {
  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);
  if (ids.length === 0) return ok(null);

  const { error } = await c.supabase
    .from("spec_items")
    .update({ deleted_at: null })
    .in("id", ids)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId);

  if (error) {
    if (error.code === "23505") {
      return fail("Марка позиции уже занята другой — восстановить нельзя");
    }
    console.error("[restoreSpecItems]", error.message);
    return fail("Не удалось восстановить");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

type SetCodeRow = {
  result: "ok" | "swapped" | "unchanged";
  swapped_id: string | null;
  swapped_name: string | null;
};

export async function setSpecItemCode(
  orgSlug: string,
  projectId: string,
  itemId: string,
  code: string,
  allowSwap = false,
): Promise<
  ActionResult<{ result: SetCodeRow["result"]; swappedName: string | null }>
> {
  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);

  const { data, error } = await callRpc(c.supabase, "set_spec_item_code", {
    p_org_id: c.orgId,
    p_project_id: projectId,
    p_item_id: itemId,
    p_code: code,
    p_allow_swap: allowSwap,
  });

  if (error) {
    const m = error.message;
    if (m.includes("CODE_INVALID")) return fail("Формат марки: «О-03»");
    if (m.includes("CODE_TAKEN"))
      return fail(`CODE_TAKEN:${m.split("CODE_TAKEN:")[1]?.trim() ?? ""}`);
    console.error("[setSpecItemCode]", m);
    return fail("Не удалось изменить марку");
  }

  const row = data?.[0];
  if (!row) return fail("Пустой ответ сервера");

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok({ result: row.result, swappedName: row.swapped_name });
}
