"use server";

import { revalidatePath } from "next/cache";
import { projectSchema, ProjectInput } from "@/lib/validations";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg } from "@/lib/auth/session";
import { canMutateRecord } from "@/lib/permissions";
import { assertCanMutate } from "@/lib/db/guard";

type ActionResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function upsertProject(
  input: ProjectInput,
): Promise<ActionResponse> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { userId, orgId } = await requireOrg();
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
    const guard = await assertCanMutate("projects", id);
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

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { success: true, data };
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

  revalidatePath("/projects");
  return { success: true, data };
}

export async function deleteProject(id: string): Promise<ActionResponse> {
  if (!id) return { success: false, error: "ID не указан" };

  const { userId, orgId, role } = await requireOrg();
  const supabase = createAdminClient();

  // 1. проект существует и принадлежит МОЕЙ организации
  const { data: project } = await supabase
    .from("projects")
    .select("id, created_by")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!project) return { success: false, error: "Проект не найден" };
  if (!canMutateRecord({ role, userId, createdBy: project.created_by })) {
    return {
      success: false,
      error: "Удалять чужие проекты может только администратор",
    };
  }

  const guard = await assertCanMutate("projects", id);
  if (!guard.ok) return guard.response;

  const { error } = await guard.ctx.supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    console.error("[deleteProject]", error.message);
    return { success: false, error: "Не удалось удалить проект" };
  }

  revalidatePath("/projects");
  return { success: true };
}
