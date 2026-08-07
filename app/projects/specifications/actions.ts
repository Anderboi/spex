"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  specItemSchema,
  SpecItemInput,
  reorderSpecItemsSchema,
  ReorderSpecItemsInput,
} from "@/lib/validations";

type ActionResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
};

/**
 * Добавление или обновление позиции спецификации
 */
export async function upsertSpecItem(
  input: SpecItemInput,
): Promise<ActionResponse> {
  const parsed = specItemSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Неавторизованный доступ" };
  }

  // Если создается новая позиция без указанной позиции,
  // ставим ее в конец списка
  let itemData = { ...parsed.data };
  if (!itemData.id && itemData.position === 0) {
    const { data: maxPosItem } = await supabase
      .from("spec_items")
      .select("position")
      .eq("project_id", itemData.project_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    itemData.position = maxPosItem ? maxPosItem.position + 1 : 0;
  }

  const { data, error } = await supabase
    .from("spec_items")
    .upsert(itemData)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${itemData.project_id}`);
  return { success: true, data };
}

/**
 * Удаление позиции спецификации
 */
export async function deleteSpecItem(
  id: string,
  projectId: string,
): Promise<ActionResponse> {
  if (!id || !projectId) {
    return { success: false, error: "Недостаточно параметров для удаления" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("spec_items").delete().eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

/**
 * Массовое обновление порядка строк (Drag-and-Drop)
 * Принимает массив { id, position } и обновляет их единым запросом
 */
export async function reorderSpecItems(
  input: ReorderSpecItemsInput,
): Promise<ActionResponse> {
  const parsed = reorderSpecItemsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { projectId, items } = parsed.data;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Неавторизованный доступ" };
  }

  // Используем upsert для множественного обновления по primary key (id)
  const updates = items.map((item) => ({
    id: item.id,
    project_id: projectId,
    position: item.position,
  }));

  const { error } = await supabase
    .from("spec_items")
    .upsert(updates, { onConflict: "id" });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}
