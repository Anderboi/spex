import { describe, expect, it } from "vitest";

import {
  resolveInviteView,
  type InviteLookup,
  type InvitePreview,
} from "./invites";

const INVITE: InvitePreview = {
  email: "Invitee@Example.com ",
  role: "admin",
  expires_at: "2026-10-19T09:55:40.822+00:00",
  org_name: "MINIMAL",
  org_slug: "andy",
};

const NOW = new Date("2026-10-12T12:00:00.000Z");

function view(
  lookup: InviteLookup,
  extra: { signedIn?: boolean; sessionEmail?: string | null } = {},
) {
  return resolveInviteView({
    lookup,
    signedIn: extra.signedIn ?? false,
    sessionEmail: extra.sessionEmail ?? null,
    now: NOW,
  });
}

describe("resolveInviteView", () => {
  it("отправляет гостя входить, если приглашение валидно", () => {
    const result = view({ status: "ok", invite: INVITE });
    expect(result.kind).toBe("login");
  });

  it("различает «не найдено» и «не смогли прочитать»", () => {
    expect(view({ status: "not_found" }).kind).toBe("unavailable");
    expect(view({ status: "error" }).kind).toBe("error");
  });

  it("считает просроченное приглашение истёкшим, даже для вошедшего", () => {
    const result = view(
      { status: "ok", invite: { ...INVITE, expires_at: "2026-10-11T00:00:00Z" } },
      { signedIn: true, sessionEmail: INVITE.email },
    );
    expect(result.kind).toBe("expired");
  });

  it("считает истёкшим приглашение ровно в момент окончания срока", () => {
    const result = view({
      status: "ok",
      invite: { ...INVITE, expires_at: NOW.toISOString() },
    });
    expect(result.kind).toBe("expired");
  });

  it("пускает к форме того, кто вошёл под адресом приглашения", () => {
    const result = view(
      { status: "ok", invite: INVITE },
      { signedIn: true, sessionEmail: " invitee@example.COM" },
    );
    expect(result.kind).toBe("accept");
  });

  it("показывает несовпадение адресов вместо отказа из БД", () => {
    const result = view(
      { status: "ok", invite: INVITE },
      { signedIn: true, sessionEmail: "someone@else.com" },
    );
    expect(result).toMatchObject({
      kind: "wrong_account",
      sessionEmail: "someone@else.com",
    });
  });

  it("не пускает к форме профиль без email", () => {
    const result = view(
      { status: "ok", invite: INVITE },
      { signedIn: true, sessionEmail: null },
    );
    expect(result).toMatchObject({ kind: "wrong_account", sessionEmail: null });
  });
});
