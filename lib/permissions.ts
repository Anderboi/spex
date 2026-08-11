export type OrgRole = "owner" | "admin" | "member";

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
};

/**
 * Проверка прав на выполнение действия
 */
export function canManageMembers(currentRole: OrgRole): boolean {
  return currentRole === "owner" || currentRole === "admin";
}

export function canChangeRole(
  currentRole: OrgRole,
  targetRole: OrgRole,
  newRole: OrgRole,
): boolean {
  // Только Владелец может назначать/снимать Администраторов и передавать Владение
  if (currentRole === "owner") return true;

  // Администраторы могут управлять только обычными участниками (member)
  if (currentRole === "admin") {
    return targetRole === "member" && newRole === "member";
  }

  return false;
}

export function canRemoveMember(
  currentRole: OrgRole,
  targetRole: OrgRole,
): boolean {
  if (targetRole === "owner") return false; // Владельца нельзя удалить
  if (currentRole === "owner") return true;
  if (currentRole === "admin" && targetRole === "member") return true;
  return false;
}
