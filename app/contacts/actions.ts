"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SupplierInput, supplierSchema } from "@/lib/validations";

type ActionResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function upsertSupplier(
  input: SupplierInput,
): Promise<ActionResponse> {
  const parsed = supplierSchema.safeParse(input);
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

  const payload = {
    ...parsed.data,
    user_id: user.id,
  };

  const { data, error } = await supabase
    .from("suppliers")
    .upsert(payload)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/contacts");
  revalidatePath("/materials"); // Переинвалидируем материалы, так как имя поставщика могло измениться
  return { success: true, data };
}

export async function deleteSupplier(id: string): Promise<ActionResponse> {
  if (!id) return { success: false, error: "ID не указан" };

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").delete().eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/contacts");
  revalidatePath("/materials");
  return { success: true };
}
