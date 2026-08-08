"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  companySchema,
  contactSchema,
  CompanyInput,
  ContactInput,
} from "@/lib/validations";

// --- КОМПАНИИ ---

export async function upsertCompany(input: CompanyInput) {
  const supabase = await createClient();
  const parsed = companySchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, error: "Некорректные данные компании" };
  }

  const { data, error } = await supabase
    .from("companies")
    .upsert(parsed.data)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath("/contacts");
  return { success: true, data };
}

export async function deleteCompany(id: string) {
  const supabase = await createClient();

  // Таблица contacts имеет 'ON DELETE CASCADE', поэтому менеджеры удалятся автоматически
  const { error } = await supabase.from("companies").delete().eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/contacts");
  return { success: true };
}

// --- КОНТАКТЫ / МЕНЕДЖЕРЫ ---

export async function upsertContact(
  input: ContactInput & { company_id?: string | null },
) {
  const supabase = await createClient();
  const parsed = contactSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, error: "Некорректные данные контакта" };
  }

  const { data, error } = await supabase
    .from("contacts")
    .upsert({
      ...parsed.data,
      company_id: input.company_id ?? null,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath("/contacts");
  return { success: true, data };
}

export async function deleteContact(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from("contacts").delete().eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/contacts");
  return { success: true };
}
