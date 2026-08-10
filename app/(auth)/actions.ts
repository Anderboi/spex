"use server";

import { requireSession, signIn, signOut } from "@/lib/auth";
import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import {
  NewPasswordInput,
  newPasswordSchema,
  RegisterInput,
  registerSchema,
  ResetPasswordRequestInput,
  resetPasswordRequestSchema,
} from "@/lib/validations";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/mail";
import {
  generatePasswordResetToken,
  generateVerificationToken,
} from "@/lib/tokens";
import { z } from "zod/v3";
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

// Используем Service Role Key для прямых операций с записью
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function registerWithCredentials(data: RegisterInput) {
  const validated = registerSchema.safeParse(data);
  if (!validated.success) return { error: "Неверно заполнены поля формы" };

  const { name, email, password } = validated.data;

  try {
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id, email_verified")
      .eq("email", email)
      .single();

    if (existingUser) {
      return { error: "Пользователь с таким Email уже зарегистрирован" };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 1. Создаем пользователя (email_verified по умолчанию NULL)
    const { error: insertError } = await supabaseAdmin.from("users").insert({
      name,
      email,
      password: hashedPassword,
    });

    if (insertError) {
      return { error: "Не удалось создать аккаунт. Попробуйте позже." };
    }

    // 2. Генерируем токен и отправляем письмо
    const verificationToken = await generateVerificationToken(email);
    await sendVerificationEmail(
      verificationToken.identifier,
      verificationToken.token,
    );

    return { success: "Письмо с подтверждением отправлено на ваш Email!" };
  } catch (err) {
    console.error("Register error:", err);
    return { error: "Произошла ошибка при отправке письма" };
  }
}

export async function registerUser(data: RegisterInput) {
  const parsed = registerSchema.safeParse(data);
  if (!parsed.success) {
    return { error: "Некорректно заполнены поля формы" };
  }

  const { name, email, password } = parsed.data;

  try {
    // 1. Проверяем, существует ли уже пользователь с таким Email
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existingUser) {
      return { error: "Пользователь с таким Email уже зарегистрирован" };
    }

    // 2. Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Создаем пользователя
    const { data: newUser, error: createError } = await supabaseAdmin
      .from("users")
      .insert({
        name,
        email,
        password: hashedPassword,
        email_verified: false,
      })
      .select("id, email")
      .single();

    if (createError || !newUser) {
      console.error("Create user error:", createError);
      return { error: "Не удалось создать аккаунт. Попробуйте позже." };
    }

    // 4. Генерируем токен и отправляем письмо верификации
    const verificationToken = await generateVerificationToken(newUser.email);
    await sendVerificationEmail(
      verificationToken.identifier,
      verificationToken.token,
    );

    return {
      success:
        "Аккаунт успешно создан! Мы отправили письмо с подтверждением на ваш Email.",
    };
  } catch (err) {
    console.error("Registration action error:", err);
    return { error: "Произошла ошибка при регистрации" };
  }
}

export async function verifyEmailToken(token: string) {
  // 1. Находим токен в базе
  const { data: existingToken } = await supabaseAdmin
    .from("verification_tokens")
    .select("*")
    .eq("token", token)
    .single();

  if (!existingToken) {
    return { error: "Токен не существует или недействителен!" };
  }

  const hasExpired = new Date(existingToken.expires) < new Date();
  if (hasExpired) {
    return { error: "Срок действия токена истек!" };
  }

  // 2. Находим пользователя по email
  const { data: existingUser } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", existingToken.identifier)
    .single();

  if (!existingUser) {
    return { error: "Пользователь не найден!" };
  }

  // 3. Обновляем статус подтверждения email у пользователя
  await supabaseAdmin
    .from("users")
    .update({ email_verified: new Date().toISOString() })
    .eq("id", existingUser.id);

  // 4. Удаляем использованный токен
  await supabaseAdmin.from("verification_tokens").delete().eq("token", token);

  return { success: "Email успешно подтвержден! Теперь вы можете войти." };
}

const emailSchema = z.string().email("Введите корректный email");

export async function resendVerificationEmail(email: string) {
  // 1. Валидация Email
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { error: "Некорректный формат Email" };
  }

  const cleanEmail = parsed.data;

  try {
    // 2. Проверяем существование пользователя
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, email_verified")
      .eq("email", cleanEmail)
      .single();

    if (!user) {
      // Для защиты от перебора пользователей возвращаем одинаковый ответ
      return {
        success: "Если аккаунт существует, письмо с подтверждением отправлено.",
      };
    }

    if (user.email_verified) {
      return { error: "Этот Email уже подтвержден. Вы можете войти." };
    }

    // 3. Rate-limiting: проверяем, когда был создан последний токен
    const { data: existingToken } = await supabaseAdmin
      .from("verification_tokens")
      .select("expires")
      .eq("identifier", cleanEmail)
      .single();

    if (existingToken) {
      // Токен создается на 1 час (3600000 ms).
      // Если до конца жизни токена осталось больше 59 минут, значит, его создали меньше 60 сек назад.
      const expiresTime = new Date(existingToken.expires).getTime();
      const timeRemaining = expiresTime - Date.now();
      const timeElapsedSec = 3600 - Math.floor(timeRemaining / 1000);

      if (timeElapsedSec < 60) {
        const cooldownLeft = 60 - timeElapsedSec;
        return {
          error: `Повторная отправка возможна через ${cooldownLeft} сек.`,
        };
      }
    }

    // 4. Генерируем новый токен и отправляем письмо
    const verificationToken = await generateVerificationToken(cleanEmail);
    await sendVerificationEmail(
      verificationToken.identifier,
      verificationToken.token,
    );

    return { success: "Новое письмо с подтверждением успешно отправлено!" };
  } catch (err) {
    console.error("Resend verification error:", err);
    return { error: "Произошла ошибка при отправке письма. Попробуйте позже." };
  }
}

export async function requestPasswordReset(data: ResetPasswordRequestInput) {
  const parsed = resetPasswordRequestSchema.safeParse(data);
  if (!parsed.success) return { error: "Некорректный Email" };

  const { email } = parsed.data;

  try {
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    // Защита от перебора пользователей: если пользователя нет, вернем успех
    if (!user) {
      return {
        success:
          "Если аккаунт с таким Email существует, мы отправили ссылку для сброса.",
      };
    }

    const resetToken = await generatePasswordResetToken(email);
    await sendPasswordResetEmail(resetToken.email, resetToken.token);

    return { success: "Инструкции по сбросу пароля отправлены на ваш Email." };
  } catch (err) {
    console.error("Reset password request error:", err);
    return { error: "Произошла ошибка при отправке запроса" };
  }
}

// 2. Установка нового пароля по токену
export async function resetPasswordWithToken(
  token: string,
  data: NewPasswordInput,
) {
  const parsed = newPasswordSchema.safeParse(data);
  if (!parsed.success) return { error: "Неверно заполнены пароли" };

  const { password } = parsed.data;

  try {
    // Проверяем наличие и срок жизни токена
    const { data: existingToken } = await supabaseAdmin
      .from("password_reset_tokens")
      .select("*")
      .eq("token", token)
      .single();

    if (!existingToken) {
      return { error: "Недействительный токен сброса пароля" };
    }

    const hasExpired = new Date(existingToken.expires) < new Date();
    if (hasExpired) {
      return { error: "Срок действия ссылки истек. Запросите сброс заново." };
    }

    // Хешируем новый пароль
    const hashedPassword = await bcrypt.hash(password, 10);

    // Обновляем пароль пользователя в Supabase
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ password: hashedPassword })
      .eq("email", existingToken.email);

    if (updateError) {
      return { error: "Не удалось обновить пароль. Попробуйте позже." };
    }

    // Удаляем использованный токен
    await supabaseAdmin
      .from("password_reset_tokens")
      .delete()
      .eq("token", token);

    return { success: "Пароль успешно изменен! Теперь вы можете войти." };
  } catch (err) {
    console.error("Reset password execution error:", err);
    return { error: "Произошла ошибка при сбросе пароля" };
  }
}

export async function authenticateWithGoogle() {
  await signIn("google", { redirectTo: "/contacts" });
}

export async function loginWithCredentials(formData: FormData) {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false, // Отключаем автоматический редирект Auth.js, чтобы управлять им вручную
    });

    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      // Проверяем, не вызвана ли ошибка не подтвержденным email
      if (error.cause?.err?.message === "EmailNotVerified") {
        return {
          error: "Ваш Email еще не подтвержден. Пожалуйста, проверьте почту.",
        };
      }

      switch (error.type) {
        case "CredentialsSignin":
          return { error: "Неверный email или пароль." };
        default:
          return { error: "Ошибка авторизации. Проверьте введенные данные." };
      }
    }

    // Обязательно пробрасываем ошибку дальше, если это редирект Next.js
    throw error;
  }
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}

export async function createOrganization(formData: FormData) {
  const { userId } = await requireSession();
  const name = formData.get("name")?.toString().trim();

  if (!name || name.length < 2) {
    return { error: "Название организации должно содержать минимум 2 символа" };
  }

  const supabase = createAdminClient();

  // 1. Создаем запись организации
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name })
    .select("id")
    .single();

  if (orgError || !org) {
    console.error(
      "[createOrganization] Error creating org:",
      orgError?.message,
    );
    return { error: "Не удалось создать организацию. Попробуйте еще раз." };
  }

  // 2. Добавляем пользователя как владельца (owner)
  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({
      org_id: org.id,
      user_id: userId,
      role: "owner",
    });

  if (memberError) {
    console.error(
      "[createOrganization] Error adding member:",
      memberError.message,
    );
    return { error: "Ошибка при назначении прав владельца." };
  }

  // 3. Делаем созданную организацию активной для пользователя
  await supabase
    .from("profiles")
    .update({ active_org_id: org.id })
    .eq("id", userId);

  revalidatePath("/", "layout");
  redirect("/projects");
}

/**
 * Переключение активной организации
 */
export async function switchOrganization(orgId: string) {
  const { userId } = await requireSession();
  const supabase = createAdminClient();

  // Проверяем, состоит ли пользователь в этой организации
  const { data: membership, error: checkError } = await supabase
    .from("organization_members")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (checkError || !membership) {
    throw new Error("У вас нет доступа к этой организации");
  }

  // Обновляем активную организацию в профиле
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ active_org_id: orgId })
    .eq("id", userId);

  if (updateError) {
    console.error(
      "[switchOrganization] Error updating active org:",
      updateError.message,
    );
    throw new Error("Не удалось переключить организацию");
  }

  revalidatePath("/", "layout");
}
