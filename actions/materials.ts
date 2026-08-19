"use server";

import { revalidatePath } from "next/cache";
import { MaterialInput, materialSchema } from "@/lib/validations";
import { assertCanMutate, forbidden, scoped } from "@/lib/db/guard";
import { can } from "@/lib/permissions";
import { requireOrgBySlug } from "@/lib/auth/session";

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

  // обе сущности обязаны принадлежать нашей организации
  const [{ data: material }, { data: project }] = await Promise.all([
    ctx.supabase
      .from("materials")
      .select("id, name, brand, unit, price, company_id, contact_id")
      .eq("id", materialId)
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle(),
    ctx.supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
  ]);

  if (!material)
    return { success: false as const, error: "Материал не найден" };
  if (!project) return { success: false as const, error: "Проект не найден" };

  // 2. Создаем позицию в спецификации проекта
  const { data, error } = await ctx.supabase
    .from("spec_items")
    .insert({
      project_id: projectId,
      material_id: material.id,
      company_id: material.company_id,
      contact_id: material.contact_id,
      name: material.name,
      brand: material.brand,
      qty: 1,
      unit: material.unit,
      price: material.price,
      status: "draft",
      is_placeholder: false,
    })
    .select()
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
