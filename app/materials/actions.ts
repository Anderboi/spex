"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MaterialInput, materialSchema } from "@/lib/validations";
import { createAdminClient } from "@/lib/supabase/admin";
import { auth } from "@/auth";

type ActionResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function upsertMaterial(
  input: MaterialInput,
): Promise<ActionResponse> {
  const supabase = createAdminClient();
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Неавторизованный доступ" };
  }

  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const payload = {
    ...parsed.data,
    user_id: session.user.id,
  };

  if (!payload.id) {
    delete payload.id;
  }

  const { data, error } = await supabase
    .from("materials")
    .upsert(payload)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath("/materials");
  return { success: true, data };
}

export async function deleteMaterial(id: string): Promise<ActionResponse> {
  if (!id) return { success: false, error: "ID не указан" };

  const supabase = await createClient();
  const { error } = await supabase.from("materials").delete().eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/materials");
  return { success: true };
}

/**
 * Вспомогательный Action для импорта материала напрямую в специфическую таблицу проекта
 */
export async function addMaterialToProject(
  materialId: string,
  projectId: string,
): Promise<ActionResponse> {
  const supabase = await createClient();

  // 1. Получаем исходный материал
  const { data: material, error: matError } = await supabase
    .from("materials")
    .select("*")
    .eq("id", materialId)
    .single();

  if (matError || !material) {
    return { success: false, error: "Материал не найден" };
  }

  // 2. Создаем позицию в спецификации проекта
  const { data, error } = await supabase
    .from("spec_items")
    .insert({
      project_id: projectId,
      material_id: material.id,
      supplier_id: material.supplier_id,
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
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true, data };
}
