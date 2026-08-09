"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { projectSchema, ProjectInput } from "@/lib/validations";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResponse<T = any> = {
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

  // 1. Берем пользователя из сессии Auth.js
  const session = await auth();

  if (!session?.user?.id) {
    return { success: false, error: "Неавторизованный доступ" };
  }

  const payload = {
    ...parsed.data,
    user_id: session.user.id, // Используем ID из сессии Auth.js
  };

  // 2. Используем Supabase клиент (с Service Role или обычный без проверки Auth-сессии Supabase)
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("projects")
    .upsert(payload)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath("/projects");
  if (parsed.data.id) {
    revalidatePath(`/projects/${parsed.data.id}`);
  }

  return { success: true, data };
}

export async function deleteProject(id: string): Promise<ActionResponse> {
  if (!id) return { success: false, error: "ID не указан" };
  const session = await auth();

  if (!session?.user?.id) {
    return { success: false, error: "Неавторизованный доступ" };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/projects");
  redirect("/projects");
}
