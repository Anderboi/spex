/**
 * Роли организации и права на операции.
 *
 * Роли: owner (владелец) / admin (администратор) / member (пользователь) /
 * viewer (наблюдатель) — ровно тот набор, что и в enum `public.org_role`.
 * В организации ровно один owner — инвариант закреплён в БД частичным
 * уникальным индексом `organization_members_single_owner_idx`.
 *
 * `viewer` — ЗАРЕГИСТРИРОВАННЫЙ участник организации с доступом только на
 * чтение. Он проходит проверки членства, поэтому видит проекты, материалы,
 * контакты и спецификации, но не получает ни одного права на запись. Это не
 * анонимный доступ и не публичная ссылка: гостевого/клиентского доступа в
 * системе пока нет.
 *
 * Чтение правами не описывается: страницы и запросы открыты любому участнику
 * организации (`requireOrgBySlug`), поэтому отдельного `record:read` в матрице
 * нет — его отсутствие ничего не запрещает наблюдателю.
 *
 * Публикация спецификации по ссылке (кнопки «Поделиться» и «PDF» в сводке)
 * тоже отнесена к чтению: `generatePublicLink` (actions/spec-export.ts) требует
 * только членства, поэтому наблюдатель МОЖЕТ создать публичную ссылку. Это
 * осознанное правило: право записи отвечает за изменение данных организации, а
 * ссылка лишь открывает на чтение то, что участник и так видит. Правило стоит
 * пересмотреть вместе с клиентским/гостевым доступом — тогда у публикации
 * появится собственное право (например, `link:create`).
 *
 * `can()` — это UI-гейт и ПРЕДВАРИТЕЛЬНАЯ проверка. Он не является механизмом
 * безопасности: каждый server action обязан повторить проверку у себя, а
 * операции, затрагивающие владение или состав команды, дополнительно
 * проверяются в БД (RLS + SECURITY DEFINER RPC).
 */

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export const ORG_ROLES: readonly OrgRole[] = [
  "owner",
  "admin",
  "member",
  "viewer",
];

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Пользователь",
  viewer: "Наблюдатель",
};

/**
 * Ранг роли. `viewer` — нижняя ступень: любое право требует роль не ниже
 * member, поэтому прав на запись у наблюдателя нет по построению матрицы.
 */
const RANK: Record<OrgRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

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
  /** Создание записей организации. */
  | "record:create"
  /**
   * Изменение СВОЕЙ записи (пользователь — автор записи). Нужно отдельным
   * правом, потому что авторство не зависит от роли: без него участник,
   * понижённый до `viewer`, сохранил бы запись в свои прежние проекты,
   * материалы и контакты.
   */
  | "record:update:own"
  | "record:mutate:any";

/**
 * Матрица прав. Ранг роли достаточен: чтобы получить право, нужна роль не ниже
 * указанной.
 *
 * | permission            | owner | admin | member | viewer |
 * | --------------------- | ----: | ----: | -----: | -----: |
 * | organization:update   |   yes |    no |     no |     no |
 * | organization:delete   |   yes |    no |     no |     no |
 * | organization:transfer |   yes |    no |     no |     no |
 * | member:invite         |   yes |   yes |     no |     no |
 * | member:update         |   yes |   yes |     no |     no |
 * | member:remove         |   yes |   yes |     no |     no |
 * | record:create         |   yes |   yes |    yes |     no |
 * | record:update:own     |   yes |   yes |    yes |     no |
 * | record:mutate:any     |   yes |   yes |     no |     no |
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
  "record:update:own": "member",
  "record:mutate:any": "admin",
};

export function can(role: OrgRole | null | undefined, p: Permission): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[MIN_ROLE[p]];
}

/**
 * Проверка прав на изменение записи (проект, материал, контакт, позиция).
 *
 * Автор записи может менять её сам; чужие записи — только admin и выше.
 * Авторство НЕ даёт права записи роли без права на запись: у `viewer` нет
 * `record:update:own`, поэтому «я автор» не превращается в разрешение.
 */
export function canMutateRecord(args: {
  role: OrgRole | null | undefined;
  userId: string;
  createdBy: string | null;
}): boolean {
  if (!can(args.role, "record:update:own")) return false;
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
 *   member → viewer      (только владелец)
 *   admin  → viewer      (только владелец)
 *   viewer → member      (только владелец)
 *   viewer → admin       (только владелец)
 *
 * Владельца нельзя ни понизить, ни назначить этой операцией: owner появляется
 * только через `transferOwnership()`. Поэтому `newRole === "owner"` запрещён
 * всегда, а `targetRole === "owner"` — тем более (владельца не трогаем).
 *
 * Администратор меняет роли только обычным участникам: роль администратора
 * меняет владелец. Иначе администратор мог бы в одиночку понизить другого
 * администратора. Наблюдателя администратор тоже не трогает: он не может ни
 * назначить его (это понижение), ни повысить — та же граница, что и в RLS,
 * где администратор удаляет только `member`. Наблюдателя вводит и выводит
 * владелец, иначе роль стала бы односторонней ловушкой.
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
    // viewer — нижняя ступень: владелец и назначает его, и снимает.
    if (targetRole === "viewer")
      return newRole === "member" || newRole === "admin";
    if (newRole === "viewer")
      return targetRole === "member" || targetRole === "admin";

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
 *   * owner исключает admin, member и viewer;
 *   * admin исключает только member.
 *
 * Ограничение администратора совпадает с RLS-политикой
 * `organization_members_delete_manager` (admin → role = 'member'), поэтому
 * наблюдателя из команды убирает владелец.
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
 *
 * `viewer` приглашением тоже не назначается — его вводит владелец сменой роли.
 * Приглашение наблюдателя потребовало бы менять CHECK в БД (отдельная задача).
 */
export type InviteRole = Extract<OrgRole, "admin" | "member">;

export const INVITE_ROLES: readonly InviteRole[] = ["admin", "member"];

export function isInviteRole(value: string): value is InviteRole {
  return value === "admin" || value === "member";
}

/** Роль из БД (`public.org_role`) — четыре значения, включая viewer. */
export function isOrgRole(value: string): value is OrgRole {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "viewer"
  );
}
