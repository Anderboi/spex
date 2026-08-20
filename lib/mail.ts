import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? "Spex <onboarding@resend.dev>";
const DEV_INBOX = process.env.DEV_EMAIL_INBOX;

// const domain = process.env.NEXT_PUBLIC_APP_URL;

export async function sendVerificationEmail(to: string, token: string) {
  const url = `${process.env.AUTH_URL ?? "http://localhost:3000"}/verify-email?token=${token}`;

  if (process.env.NODE_ENV !== "production") {
    console.log("\n─────────────────────────────────────────");
    console.log("📧 Подтверждение email");
    console.log("   Кому:", to);
    console.log("   Ссылка:", url);
    console.log("─────────────────────────────────────────\n");

    // если хочется увидеть реальное письмо — только на свой ящик
    if (!DEV_INBOX || to.toLowerCase() !== DEV_INBOX.toLowerCase()) {
      return { ok: true as const, skipped: true as const };
    }
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: "Подтвердите email — Spex",
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px">
        <h2 style="font-weight:600">Подтвердите ваш email</h2>
        <p style="color:#555">Нажмите кнопку, чтобы активировать аккаунт. Ссылка действует 24 часа.</p>
        <a href="${url}" style="display:inline-block;background:#111;color:#fff;
           padding:12px 20px;border-radius:8px;text-decoration:none">Подтвердить email</a>
        <p style="color:#888;font-size:13px;margin-top:24px">
          Если кнопка не работает, откройте ссылку:<br>
          <a href="${url}" style="color:#555">${url}</a>
        </p>
      </div>`,
  });

  if (error) {
    console.error("[sendVerificationEmail]", error);
    return { ok: false as const, error: "Не удалось отправить письмо" };
  }
  return { ok: true as const };
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const resetLink = `${process.env.AUTH_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;

  await resend.emails.send({
    from: FROM,
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
