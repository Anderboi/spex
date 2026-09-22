/**
 * Роли организации и права на операции.
 *
 * Роли: owner (владелец) / admin (администратор) / member (пользователь).
 * В организации ровно один owner — инвариант закреплён в БД частичным
 * уникальным индексом `organization_members_single_owner_idx`.
 *
 * `can()` — это UI-гейт и ПРЕДВАРИТЕЛЬНАЯ проверка. Он не является механизмом
 * безопасности: каждый server action обязан повторить проверку у себя, а
 * операции, затрагивающие владение или состав команды, дополнительно
 * проверяются в БД (RLS + SECURITY DEFINER RPC).
 */

export type OrgRole = "owner" | "admin" | "member";

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Пользователь",
};

const RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

export type Permission =
  /** Переименование организации. */
  | "organization:update"
  /** Удаление организации вместе со связанными данными. */
  | "organization:delete"
  /** Передача владения другому участнику. */
  | "organization:transfer"
  /** Создание приглашений. */
  | "member:invite"
  /** Изменение роли участника (с ограничениями, см. canUpdateMemberRole). */
  | "member:update"
  /** Исключение участника (с ограничениями, см. canRemoveMember). */
  | "member:remove"
  // ── права уровня записей (проекты, материалы, контакты) ──────────────
  | "record:create"
  | "record:mutate:any";

/**
 * Матрица прав. Ранг роли достаточен: чтобы получить право, нужна роль не ниже
 * указанной.
 *
 * | permission            | owner | admin | member |
 * | --------------------- | ----: | ----: | -----: |
 * | organization:update   |   yes |    no |     no |
 * | organization:delete   |   yes |    no |     no |
 * | organization:transfer |   yes |    no |     no |
 * | member:invite         |   yes |   yes |     no |
 * | member:update         |   yes |   yes |     no |
 * | member:remove         |   yes |   yes |     no |
 *
 * `member:update` у администратора — это право ДОЙТИ до операции: конкретные
 * разрешённые переходы ролей ограничивает `canUpdateMemberRole`, который не
 * даёт трогать владельца и назначать владельца.
 */
const MIN_ROLE: Record<Permission, OrgRole> = {
  "organization:update": "owner",
  "organization:delete": "owner",
  "organization:transfer": "owner",
  "member:invite": "admin",
  "member:update": "admin",
  "member:remove": "admin",
  "record:create": "member",
  "record:mutate:any": "admin",
};

export function can(role: OrgRole | null | undefined, p: Permission): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[MIN_ROLE[p]];
}

/**
 * Проверка прав на изменение записи (проект, материал, контакт).
 * Автор записи может менять её сам; чужие записи — только admin и выше.
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

/** Управление составом команды: приглашения, роли, исключение. */
export function canManageMembers(currentRole: OrgRole | null | undefined): boolean {
  return can(currentRole, "member:invite");
}

/** Переименование организации — только владелец. */
export function canUpdateOrganization(
  currentRole: OrgRole | null | undefined,
): boolean {
  return can(currentRole, "organization:update");
}

/** Удаление организации — только владелец. */
export function canDeleteOrganization(
  currentRole: OrgRole | null | undefined,
): boolean {
  return can(currentRole, "organization:delete");
}

/**
 * Передача владения: только текущий владелец и только другому участнику.
 * Передать владение самому себе нельзя — иначе операция не меняет состояние,
 * но сбрасывает роль владельца на admin.
 */
export function canTransferOwnership(
  currentRole: OrgRole | null | undefined,
  targetRole: OrgRole,
  isSelf: boolean,
): boolean {
  if (!can(currentRole, "organization:transfer")) return false;
  if (isSelf) return false;
  return targetRole !== "owner";
}

/**
 * Разрешённые переходы ролей обычной сменой роли:
 *
 *   member → admin
 *   admin  → member
 *
 * Владельца нельзя ни понизить, ни назначить этой операцией: owner появляется
 * только через `transferOwnership()`. Поэтому `newRole === "owner"` запрещён
 * всегда, а `targetRole === "owner"` — тем более (владельца не трогаем).
 *
 * Администратор меняет роли только обычным участникам: роль администратора
 * меняет владелец. Иначе администратор мог бы в одиночку понизить другого
 * администратора.
 */
export function canUpdateMemberRole(args: {
  currentRole: OrgRole | null | undefined;
  targetRole: OrgRole;
  newRole: OrgRole;
  isSelf: boolean;
}): boolean {
  const { currentRole, targetRole, newRole, isSelf } = args;

  if (!can(currentRole, "member:update")) return false;
  if (isSelf) return false; // свою роль менять нельзя
  if (targetRole === "owner") return false; // владельца не понижаем
  if (newRole === "owner") return false; // владение — только transferOwnership
  if (newRole === targetRole) return true; // no-op, но не ошибка

  if (currentRole === "owner") {
    return (
      (targetRole === "member" && newRole === "admin") ||
      (targetRole === "admin" && newRole === "member")
    );
  }

  return currentRole === "admin" && targetRole === "member" && newRole === "admin";
}

/**
 * Исключение участника.
 *
 *   * владельца нельзя исключить никому — организация осталась бы без owner;
 *   * себя нельзя исключить (для «выйти из организации» нужна отдельная
 *     операция, которой пока нет);
 *   * owner исключает admin и member;
 *   * admin исключает только member.
 */
export function canRemoveMember(args: {
  currentRole: OrgRole | null | undefined;
  targetRole: OrgRole;
  isSelf: boolean;
}): boolean {
  const { currentRole, targetRole, isSelf } = args;

  if (!can(currentRole, "member:remove")) return false;
  if (isSelf) return false;
  if (targetRole === "owner") return false;

  if (currentRole === "owner") return true;
  return currentRole === "admin" && targetRole === "member";
}

/**
 * Роль приглашения. Ownership приглашением не передаётся: `organization_invites`
 * в БД ограничена CHECK-констрейнтом (admin | member).
 */
export type InviteRole = Extract<OrgRole, "admin" | "member">;

export const INVITE_ROLES: readonly InviteRole[] = ["admin", "member"];

export function isInviteRole(value: string): value is InviteRole {
  return value === "admin" || value === "member";
}

export function isOrgRole(value: string): value is OrgRole {
  return value === "owner" || value === "admin" || value === "member";
}
