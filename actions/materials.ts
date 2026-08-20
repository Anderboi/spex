"use server";

import { revalidatePath } from "next/cache";
import { MaterialInput, materialSchema } from "@/lib/validations";
import { assertCanMutate, forbidden, scoped } from "@/lib/db/guard";
import { can } from "@/lib/permissions";
import { requireOrgBySlug } from "@/lib/auth/session";
import { prefixFor } from "@/lib/utils";
import { TYPE_ORDER } from "@/lib/constants";

type ActionResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function upsertMaterial(
  orgSlug: string,
  input: MaterialInput,
): Promise<ActionResponse> {
  const { userId, orgId, role } = await requireOrgBySlug(orgSlug);
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

/**
 * Вспомогательный Action для импорта материала напрямую в специфическую таблицу проекта
 */
export async function addMaterialToProject(
  orgSlug: string,
  materialId: string,
  projectId: string,
) {
  const ctx = await scoped(orgSlug);
  if (!can(ctx.role, "record:create")) return forbidden();

  const [{ data: material }, { data: project }] = await Promise.all([
    ctx.supabase
      .from("materials")
      .select(
        "id, name, brand, article, unit, price, category, company_id, contact_id",
      )
      .eq("id", materialId)
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle(),
    ctx.supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  if (!material)
    return { success: false as const, error: "Материал не найден" };
  if (!project) return { success: false as const, error: "Проект не найден" };

  const type = TYPE_ORDER.includes(material.category as never)
    ? material.category!
    : "Прочее";

  // снапшот поставщика — иначе переименование компании перепишет историю сметы
  let companyName: string | null = null;
  if (material.company_id) {
    const { data: co } = await ctx.supabase
      .from("companies")
      .select("name")
      .eq("id", material.company_id)
      .maybeSingle();
    companyName = co?.name ?? null;
  }

  // марка: следующий свободный номер для этого типа
  const { data: siblings } = await ctx.supabase
    .from("spec_items")
    .select("code, position")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  const prefix = prefixFor(type);
  const maxNum = (siblings ?? []).reduce((m, s) => {
    if (!s.code?.startsWith(`${prefix}-`)) return m;
    return Math.max(m, parseInt(s.code.slice(prefix.length + 1), 10) || 0);
  }, 0);
  const maxPos = (siblings ?? []).reduce((m, s) => Math.max(m, s.position), -1);

  const { data, error } = await ctx.supabase
    .from("spec_items")
    .insert({
      project_id: projectId,
      org_id: ctx.orgId, // ← обязателен
      type, // ← обязателен
      code: `${prefix}-${String(maxNum + 1).padStart(2, "0")}`,
      position: maxPos + 1,
      material_id: material.id,
      company_id: material.company_id,
      contact_id: material.contact_id,
      company_name_snapshot: companyName,
      name: material.name,
      brand: material.brand,
      article: material.article,
      qty: 1,
      unit: material.unit ?? "шт",
      price: Number(material.price ?? 0),
      status: "picked", // материал выбран — это не draft
      is_placeholder: false,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[addMaterialToProject]", error.message);
    return {
      success: false as const,
      error: "Не удалось добавить в спецификацию",
    };
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return { success: true as const, data };
}
