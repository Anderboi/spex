export type OrgRole = "owner" | "admin" | "member";

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
};

const RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

export type Permission =
  | "record:create"
  | "record:mutate:any"
  | "member:invite"
  | "member:remove"
  | "member:role:change"
  | "org:update"
  | "org:delete";

const MIN_ROLE: Record<Permission, OrgRole> = {
  "record:create": "member",
  "record:mutate:any": "admin",
  "member:invite": "admin",
  "member:remove": "admin",
  "member:role:change": "owner",
  "org:update": "admin",
  "org:delete": "owner",
};

export function can(role: OrgRole | null | undefined, p: Permission): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[MIN_ROLE[p]];
}

/**
 * Проверка прав на выполнение действия
 */
export function canMutateRecord(args: {
  role: OrgRole | null | undefined;
  userId: string;
  createdBy: string | null;
}): boolean {
  if (!args.role) return false;
  if (args.createdBy && args.createdBy === args.userId) return true;
  return can(args.role, "record:mutate:any");
}

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
