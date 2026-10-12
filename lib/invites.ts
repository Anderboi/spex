import type { InviteRole } from "./permissions";

/**
 * Приглашение глазами страницы `/invite/accept`: организация, адрес, на который
 * оно выписано, роль и срок. Секрет здесь — сам токен, поэтому ничего, кроме
 * этого, публичная страница не читает.
 */
export type InvitePreview = {
  email: string;
  role: InviteRole;
  expires_at: string;
  org_name: string;
  org_slug: string;
};

/**
 * Результат поиска приглашения по токену. `error` отделён от `not_found`
 * намеренно: «ссылка недействительна» и «мы не смогли проверить» — разные
 * сообщения, и второе не должно выглядеть как отказ по существу.
 */
export type InviteLookup =
  | { status: "ok"; invite: InvitePreview }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Что показать на странице принятия.
 *
 * Состояние считается до отправки формы. Так причина видна сразу и целиком:
 * у гостя нет сессии, а приглашение выписано на конкретный адрес — если вошёл
 * другой аккаунт, БД откажет (`INVITE_EMAIL_MISMATCH`), и человек без этой
 * проверки увидит только «не удалось».
 */
export type InviteView =
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "expired"; invite: InvitePreview }
  | { kind: "login"; invite: InvitePreview }
  | { kind: "wrong_account"; invite: InvitePreview; sessionEmail: string | null }
  | { kind: "accept"; invite: InvitePreview };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function resolveInviteView(input: {
  lookup: InviteLookup;
  signedIn: boolean;
  sessionEmail: string | null;
  now?: Date;
}): InviteView {
  const { lookup, signedIn, sessionEmail } = input;

  if (lookup.status === "error") return { kind: "error" };
  if (lookup.status === "not_found") return { kind: "unavailable" };

  const invite = lookup.invite;
  const now = input.now ?? new Date();
  if (new Date(invite.expires_at).getTime() <= now.getTime()) {
    return { kind: "expired", invite };
  }

  if (!signedIn) return { kind: "login", invite };

  // Адрес сравниваем так же, как это делает `accept_invite` в БД (lower/trim):
  // иначе страница пропустит к форме того, кому функция откажет.
  if (!sessionEmail || normalizeEmail(sessionEmail) !== normalizeEmail(invite.email)) {
    return { kind: "wrong_account", invite, sessionEmail };
  }

  return { kind: "accept", invite };
}
