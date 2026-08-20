"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageMembers,
  canRemoveMember,
  OrgRole,
  can,
} from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { requireOrg, requireOrgBySlug } from "@/lib/auth/session";
import z from 'zod';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { randomBytes } from 'node:crypto';
import { callRpc } from '@/lib/supabase/rpc';

const INVITE_TTL_DAYS = 7;

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Укажите корректный email")
    .max(200),
  role: z.enum(["admin", "member"]),
});

/**
 * 1. Создание приглашения (Generate Invite)
 */
export async function createInvite(
  orgSlug: string,
  formData: FormData,
): Promise<ActionResult<{ inviteUrl: string }>> {
  const { orgId, userId, role } = await requireOrgBySlug(orgSlug);

  if (!can(role, "member:invite")) {
    return fail("Приглашать участников может только администратор");
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role") ?? "member",
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { email, role: inviteRole } = parsed.data;

  const supabase = createAdminClient();

  // уже в команде — приглашать незачем
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    const { data: member } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", existing.id)
      .maybeSingle();
    if (member) return fail("Этот пользователь уже состоит в студии");
  }

  // токен генерируем в приложении: не зависим от дефолта колонки
  const token = randomBytes(32).toString("base64url");

  const { error } = await supabase.from("organization_invites").upsert(
    {
      org_id: orgId,
      email,
      role: inviteRole,
      token,
      invited_by: userId,
      expires_at: new Date(
        Date.now() + INVITE_TTL_DAYS * 86_400_000,
      ).toISOString(),
    },
    { onConflict: "org_id,email" },
  );

  if (error) {
    console.error("[createInvite]", error.message);
    return fail("Не удалось создать приглашение");
  }

  revalidatePath(`/${orgSlug}/settings/team`);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return ok({ inviteUrl: `${base}/invite/accept?token=${token}` });
}

/**
 * 2. Принятие приглашения по токену
 */
export async function acceptInvite(
  token: string,
): Promise<ActionResult<never>> {
  const { userId, user } = await requireSession();
  if (!user.email) return fail("В вашем профиле не указан email");

  const supabase = createAdminClient();
  const { data, error } = await callRpc(supabase, "accept_invite", {
    p_token: token,
    p_user_id: userId,
    p_email: user.email,
  });

  if (error) {
    const m = error.message;
    if (m.includes("INVITE_NOT_FOUND"))
      return fail("Приглашение не найдено или уже использовано");
    if (m.includes("INVITE_EXPIRED"))
      return fail("Срок действия приглашения истёк");
    if (m.includes("ALREADY_MEMBER"))
      return fail("Вы уже состоите в этой студии");
    if (m.includes("INVITE_EMAIL_MISMATCH")) {
      const target =
        m.split("INVITE_EMAIL_MISMATCH:")[1]?.trim() ?? "другого адреса";
      return fail(
        `Приглашение выписано на ${target}, а вы вошли как ${user.email}`,
      );
    }
    console.error("[acceptInvite]", m);
    return fail("Не удалось принять приглашение");
  }

  const row = data?.[0];
  if (!row) return fail("Приглашение не найдено");

  revalidatePath("/", "layout");
  revalidatePath(`/${row.org_slug}/settings/team`); // владелец увидит нового участника
  redirect(`/${row.org_slug}/projects`); // redirect бросает исключение — код ниже не выполнится
}

/**
 * 3. Изменение роли участника
 */
export async function updateMemberRole(
  orgSlug: string,
  targetUserId: string,
  newRole: OrgRole,
): Promise<ActionResult<null>> {
  const { userId, orgId, role } = await requireOrgBySlug(orgSlug);

  if (!can(role, "member:role:change"))
    return fail("Менять роли может только владелец");
  if (targetUserId === userId) return fail("Нельзя изменить собственную роль");

  const supabase = createAdminClient();
  const { data: target } = await supabase
    .from("organization_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (!target) return fail("Участник не найден");
  if (target.role === newRole) return ok(null);

  // студия без владельца — необратимое состояние
  if (target.role === "owner" && newRole !== "owner") {
    const { count } = await supabase
      .from("organization_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("role", "owner");
    if ((count ?? 0) <= 1)
      return fail("В студии должен остаться хотя бы один владелец");
  }

  const { error } = await supabase
    .from("organization_members")
    .update({ role: newRole })
    .eq("org_id", orgId)
    .eq("user_id", targetUserId);

  if (error) {
    console.error("[updateMemberRole]", error.message);
    return fail("Не удалось изменить роль");
  }

  revalidatePath(`/${orgSlug}/settings/team`);
  return ok(null);
}

/**
 * 4. Удаление участника из организации
 */
export async function removeMember(
  orgSlug: string,
  targetUserId: string,
): Promise<ActionResult<null>> {
  const { userId, orgId, role } = await requireOrgBySlug(orgSlug);
  if (targetUserId === userId)
    return fail("Нельзя исключить себя — покиньте студию отдельно");

  const supabase = createAdminClient();

  // роль цели читаем из БД, не из аргумента: клиент мог прислать заниженную
  const { data: target } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (!target) return fail("Участник не найден");
  if (!canRemoveMember(role, target.role as OrgRole)) {
    return fail("У вас нет прав исключить этого участника");
  }

  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", targetUserId);

  if (error) {
    console.error("[removeMember]", error.message);
    return fail("Не удалось исключить участника");
  }

  // у исключённого эта студия могла быть активной
  await supabase
    .from("users")
    .update({ active_org_id: null })
    .eq("id", targetUserId)
    .eq("active_org_id", orgId);

  revalidatePath(`/${orgSlug}/settings/team`);
  return ok(null);
}

export async function revokeInvite(
  orgSlug: string,
  inviteId: string,
): Promise<ActionResult<null>> {
  const { orgId, role } = await requireOrgBySlug(orgSlug);
  if (!can(role, "member:invite")) return fail("Недостаточно прав");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("organization_invites")
    .delete()
    .eq("id", inviteId)
    .eq("org_id", orgId);

  if (error) {
    console.error("[revokeInvite]", error.message);
    return fail("Не удалось отозвать приглашение");
  }
  revalidatePath(`/${orgSlug}/settings/team`);
  return ok(null);
}

export async function switchActiveOrg(targetOrgId: string) {
  const { userId } = await requireSession({ allowNoOrg: true });
  const supabase = createAdminClient();

  // Проверяем, что пользователь действительно состоит в целевой организации
  const { data: member } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", userId)
    .eq("org_id", targetOrgId)
    .maybeSingle();

  if (!member) {
    throw new Error("У вас нет доступа к этой организации");
  }

  // Обновляем active_org_id в профиле
  await supabase
    .from("users")
    .update({ active_org_id: targetOrgId })
    .eq("id", userId);

  revalidatePath("/", "layout");
}
