"use server";

import { revalidatePath } from "next/cache";
import { MaterialInput, materialSchema } from "@/lib/validations";
import { assertCanMutate, forbidden, scoped } from "@/lib/db/guard";
import { can } from "@/lib/permissions";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResponse<T = any> = {
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
