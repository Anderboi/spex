"use server";

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserOrganization } from "../queries";

export type OrgRole = "owner" | "admin" | "member";

export type SessionUser = NonNullable<Session["user"]> & { id: string };

export type SessionContext = {
  session: Session;
  userId: string;
  user: SessionUser;
  orgId: string | null;
  orgSlug: string | null;
  role: OrgRole | null;
  organizations: UserOrganization[];
};

export type AuthedContext = SessionContext & {
  orgId: string;
  orgSlug: string;
  role: OrgRole;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

type MembershipRaw = {
  role: OrgRole;
  org_id: string;
  organizations:
    | { id: string; name: string; slug: string }
    | { id: string; name: string; slug: string }[]
    | null;
};

/**
 * Чистое чтение сессии. НИКОГДА не редиректит.
 * null → пользователь не вошёл. Безопасно вызывать где угодно, включая /login.
 */
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const session = await auth();
    if (!session?.user?.id) return null;

    const userId = session.user.id;
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("users")
      .select(
        `
      active_org_id,
      organization_members ( role, org_id, organizations ( id, name, slug ) )
    `,
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) console.error("[getSessionContext]", error.message);

    const memberships = (data?.organization_members ??
      []) as unknown as MembershipRaw[];

    let active = memberships.find((m) => m.org_id === data?.active_org_id);
    if (!active && memberships.length > 0) active = memberships[0];

    const activeOrg = one(active?.organizations);

    const organizations: UserOrganization[] = memberships
      .map((m) => {
        const org = one(m.organizations);
        if (!org) return null;
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          role: m.role,
          is_active: org.id === activeOrg?.id,
        };
      })
      .filter((o): o is UserOrganization => o !== null)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    return {
      session,
      userId,
      user: session.user as SessionUser,
      orgId: active?.org_id ?? null,
      orgSlug: activeOrg?.slug ?? null,
      role: active?.role ?? null,
      organizations,
    };
  },
);

/** Нужен вход, организация не обязательна. */
export async function requireAuth(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Нужен вход И организация. Основная функция для страниц приложения. */
export async function requireOrg(): Promise<AuthedContext> {
  const ctx = await requireAuth();
  if (!ctx.orgId || !ctx.orgSlug || !ctx.role)
    redirect("/onboarding/create-org");
  return ctx as AuthedContext;
}

/** Только для онбординга: организации быть не должно. */
export async function requireNoOrg(): Promise<SessionContext> {
  const ctx = await requireAuth();
  if (ctx.orgId) redirect("/projects");
  return ctx;
}
