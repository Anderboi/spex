"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateProfileSchema } from "@/lib/validations";
import { fail, ok, type ActionResult } from "@/lib/action-result";

/**
 * Смена отображаемого имени текущего пользователя.
 *
 * Кого менять — решает ТОЛЬКО сессия: id, email и организация из клиента не
 * принимаются вообще, поэтому подменить пользователя формой нельзя. Роль здесь
 * не проверяется: своё имя доступно любому участнику
 * (owner/admin/member/viewer) — профиль это личные данные, а не ресурс
 * организации, и доступ к нему у наблюдателя есть (единственное, что он может
 * менять).
 *
 * Запись идёт service role-клиентом, как и в остальных server actions: таблица
 * `public.users` закрыта для Data API политикой `users_service_role_all`, а
 * доступ к ней есть только у сервера. Без авторизации `requireAuth()` уводит
 * на /login, то есть анонимно изменить имя невозможно.
 *
 * Ограничения совпадают с клиентской формой (обе стороны используют
 * `updateProfileSchema`) — сервер проверяет вход повторно и не доверяет UI.
 */
export async function updateProfile(input: {
  name: string;
}): Promise<ActionResult<{ name: string }>> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0].message, "INVALID_INPUT");
  }

  const { userId } = await requireAuth();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("users")
    .update({ name: parsed.data.name })
    .eq("id", userId)
    .select("name")
    .maybeSingle();

  if (error || !data) {
    console.error("[updateProfile]", error?.message);
    return fail("Не удалось сохранить имя. Попробуйте ещё раз.");
  }

  // Имя показывают сайдбар (он в layout организации) и список команды,
  // поэтому обновляем весь layout, а не отдельные страницы.
  revalidatePath("/", "layout");

  return ok({ name: data.name ?? parsed.data.name });
}
