// app/(protected)/[orgSlug]/projects/[id]/spec-items/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, canMutateRecord } from "@/lib/permissions";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import {
  specItemSchema,
  reorderSpecItemsSchema,
  type SpecItemInput,
  type ReorderSpecItemsInput,
} from "@/lib/validations";

/** Проект существует и принадлежит студии из URL. Возвращает контекст. */
async function assertProject(orgSlug: string, projectId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, created_by")
    .eq("id", projectId)
    .eq("org_id", ctx.orgId) // ← без этой строки любая проверка бессмысленна
    .is("deleted_at", null)
    .maybeSingle();

  return { ...ctx, supabase, project };
}

export async function upsertSpecItem(
  orgSlug: string,
  input: SpecItemInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = specItemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { userId, orgId, role, supabase, project } = await assertProject(
    orgSlug,
    parsed.data.project_id,
  );
  if (!project) return fail("Проект не найден");
  if (!canMutateRecord({ role, userId, createdBy: project.created_by })) {
    return fail(
      "Редактировать этот проект может только автор или администратор",
    );
  }

  const item = { ...parsed.data, org_id: orgId };

  // снапшот названия поставщика на момент сохранения
  if (item.company_id) {
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", item.company_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!company) return fail("Компания не найдена");
    item.company_name_snapshot = company.name;
  }

  // новая позиция без явного порядка → в конец
  if (!item.id) {
    const { data: last } = await supabase
      .from("spec_items")
      .select("position")
      .eq("project_id", item.project_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    item.position = (last?.position ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("spec_items")
    .upsert(item)
    .select("id")
    .single();

  if (error) {
    console.error("[upsertSpecItem]", error.message);
    return fail("Не удалось сохранить позицию");
  }

  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok({ id: data.id as string });
}

export async function deleteSpecItem(
  orgSlug: string,
  projectId: string,
  id: string,
): Promise<ActionResult> {
  const { userId, orgId, role, supabase, project } = await assertProject(
    orgSlug,
    projectId,
  );
  if (!project) return fail("Проект не найден");
  if (!canMutateRecord({ role, userId, createdBy: project.created_by })) {
    return fail("Недостаточно прав");
  }

  const { error } = await supabase
    .from("spec_items")
    .delete()
    .eq("id", id)
    .eq("project_id", projectId)
    .eq("org_id", orgId); // ← три условия вместо одного

  if (error) {
    console.error("[deleteSpecItem]", error.message);
    return fail("Не удалось удалить позицию");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}
