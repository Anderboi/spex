"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageMembers,
  canRemoveMember,
  canChangeRole,
  OrgRole,
} from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

/**
 * Получение роли текущего пользователя в активной организации
 */
async function getCurrentUserRole(
  orgId: string,
  userId: string,
): Promise<OrgRole> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single();

  if (!data) throw new Error("Вы не являетесь участником этой организации");
  return data.role as OrgRole;
}

/**
 * 1. Создание приглашения (Generate Invite)
 */
export async function createInvite(formData: FormData) {
  const { userId, orgId } = await requireSession();
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const role = (formData.get("role")?.toString() || "member") as OrgRole;

  if (!email || !email.includes("@")) {
    return { error: "Укажите корректный email" };
  }

  const currentUserRole = await getCurrentUserRole(orgId, userId);
  if (!canManageMembers(currentUserRole)) {
    return { error: "Недостаточно прав для приглашения участников" };
  }

  const supabase = createAdminClient();

  // Проверяем, не состоит ли пользователь уже в этой организации
  const { data: existingUser } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    const { data: isMember } = await supabase
      .from("organization_members")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", existingUser.id)
      .maybeSingle();

    if (isMember) {
      return {
        error: "Пользователь с таким email уже состоит в вашей организации",
      };
    }
  }

  // Создаем или обновляем запись приглашения
  const { data: invite, error } = await supabase
    .from("organization_invites")
    .upsert(
      {
        org_id: orgId,
        email,
        role,
        invited_by: userId,
        expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      { onConflict: "org_id,email" },
    )
    .select("token")
    .single();

  if (error || !invite) {
    console.error("[createInvite] Error:", error?.message);
    return { error: "Не удалось создать приглашение" };
  }

  revalidatePath("/settings/team");

  // Возвращаем ссылку (её можно скопировать вручную или отправить через Resend/Email)
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/accept?token=${invite.token}`;
  return { success: true, inviteUrl };
}

/**
 * 2. Принятие приглашения по токену
 */
export async function acceptInvite(token: string) {
  const { userId, user } = await requireSession();
  const userEmail = user.email;
  const supabase = createAdminClient();

  const { data: invite, error } = await supabase
    .from("organization_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error || !invite) {
    return { error: "Приглашение не найдено или токен недействителен" };
  }

  if (new Date(invite.expires_at) < new Date()) {
    return { error: "Срок действия приглашения истек" };
  }

  // Защита: проверять соответствие email
  if (userEmail && invite.email !== userEmail.toLowerCase()) {
    return {
      error: `Этот инвайт предназначен для ${invite.email}, а вы вошли как ${userEmail}`,
    };
  }

  // Добавляем в участники
  const { error: joinError } = await supabase
    .from("organization_members")
    .insert({
      org_id: invite.org_id,
      user_id: userId,
      role: invite.role,
    });

  if (joinError) {
    console.error("[acceptInvite] Join Error:", joinError.message);
    return { error: "Ошибка при вступлении в организацию" };
  }

  // Делаем эту организацию активной для пользователя
  await supabase
    .from("profiles")
    .update({ active_org_id: invite.org_id })
    .eq("id", userId);

  // Удаляем использованный инвайт
  await supabase.from("organization_invites").delete().eq("id", invite.id);

  revalidatePath("/", "layout");
  redirect("/projects");
}

/**
 * 3. Изменение роли участника
 */
export async function updateMemberRole(
  memberId: string,
  targetUserId: string,
  targetRole: OrgRole,
  newRole: OrgRole,
) {
  const { userId, orgId } = await requireSession();
  const currentUserRole = await getCurrentUserRole(orgId, userId);

  if (!canChangeRole(currentUserRole, targetRole, newRole)) {
    throw new Error("Недостаточно прав для изменения роли этого участника");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("organization_members")
    .update({ role: newRole })
    .eq("id", memberId)
    .eq("org_id", orgId);

  if (error) {
    throw new Error("Ошибка при обновлении роли");
  }

  revalidatePath("/settings/team");
}

/**
 * 4. Удаление участника из организации
 */
export async function removeMember(memberId: string, targetRole: OrgRole) {
  const { userId, orgId } = await requireSession();
  const currentUserRole = await getCurrentUserRole(orgId, userId);

  if (!canRemoveMember(currentUserRole, targetRole)) {
    throw new Error("У вас нет прав на исключение этого участника");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("id", memberId)
    .eq("org_id", orgId);

  if (error) {
    throw new Error("Не удалось исключить участника");
  }

  revalidatePath("/settings/team");
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
    .from("profiles")
    .update({ active_org_id: targetOrgId })
    .eq("id", userId);

  revalidatePath("/", "layout");
}
