import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function generateVerificationToken(email: string) {
  const token = crypto.randomUUID();
  const expires = new Date(new Date().getTime() + 3600 * 1000); // Токен действителен 1 час

  // Удаляем старый токен для этого email, если он существует
  await supabaseAdmin
    .from("verification_tokens")
    .delete()
    .eq("identifier", email);

  // Сохраняем новый токен
  const { data, error } = await supabaseAdmin
    .from("verification_tokens")
    .insert({
      identifier: email,
      token,
      expires: expires.toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error("Не удалось сгенерировать токен");

  return data;
}

export async function generatePasswordResetToken(email: string) {
  const token = crypto.randomUUID();
  const expires = new Date(new Date().getTime() + 3600 * 1000); // Действителен 1 час

  // Удаляем старые токены сброса для этого email
  await supabaseAdmin
    .from("password_reset_tokens")
    .delete()
    .eq("email", email);

  // Создаем новый токен
  const { data, error } = await supabaseAdmin
    .from("password_reset_tokens")
    .insert({
      email,
      token,
      expires: expires.toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error("Не удалось сгенерировать токен сброса");

  return data;
}
