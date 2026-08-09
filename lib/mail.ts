import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const domain = process.env.NEXT_PUBLIC_APP_URL;

export async function sendVerificationEmail(email: string, token: string) {
  const confirmLink = `${domain}/verify-email?token=${token}`;

  await resend.emails.send({
    from: "onboarding@resend.dev", // После верификации домена замените на свой (например, auth@yourdomain.com)
    to: email,
    subject: "Подтверждение регистрации",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Подтверждение Email</h2>
        <p>Для завершения регистрации и активации аккаунта перейдите по ссылке ниже:</p>
        <a href="${confirmLink}" style="display: inline-block; padding: 10px 20px; color: #fff; background-color: #0070f3; border-radius: 5px; text-decoration: none;">
          Подтвердить Email
        </a>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">
          Ссылка действительна в течение 1 часа. Если вы не регистрировались на нашем сайте, просто проигнорируйте это письмо.
        </p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const resetLink = `${domain}/reset-password?token=${token}`;

  await resend.emails.send({
    from: "onboarding@resend.dev",
    to: email,
    subject: "Сброс пароля",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Сброс пароля</h2>
        <p>Вы запросили сброс пароля. Для указания нового пароля перейдите по ссылке ниже:</p>
        <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; color: #fff; background-color: #0070f3; border-radius: 5px; text-decoration: none;">
          Сбросить пароль
        </a>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">
          Ссылка действительна 1 час. Если вы не запрашивали сброс пароля, проигнорируйте это письмо.
        </p>
      </div>
    `,
  });
}
