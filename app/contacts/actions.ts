"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  companySchema,
  contactSchema,
  CompanyInput,
  ContactInput,
} from "@/lib/validations";
import { createAdminClient } from "@/lib/supabase/admin";
import { auth } from "@/lib/auth";

// --- КОМПАНИИ ---

export async function upsertCompany(input: CompanyInput) {
  const supabase = createAdminClient();
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Неавторизованный доступ" };
  }

  const parsed = companySchema.safeParse(input);
  const payload = {
    ...parsed.data,
    user_id: session.user.id,
  };
  if (!parsed.success) {
    return { success: false, error: "Некорректные данные компании" };
  }

  const { data, error } = await supabase
    .from("companies")
    .upsert(payload)
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
  const supabase = createAdminClient();
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Неавторизованный доступ" };
  }
  const parsed = contactSchema.safeParse(input);

  if (!parsed.success) {
    console.error("Zod validation errors:", parsed.error.format());
    return { success: false, error: "Некорректные данные контакта" };
  }

  const payload = {
    ...parsed.data,
    user_id: session.user.id,
    company_id: input.company_id ?? null,
  };

  if (!payload.id) {
    delete payload.id;
  }

  const { data, error } = await supabase
    .from("contacts")
    .upsert(payload)
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
