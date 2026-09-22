import { describe, expect, it } from "vitest";
import {
  can,
  canDeleteOrganization,
  canManageMembers,
  canMutateRecord,
  canRemoveMember,
  canTransferOwnership,
  canUpdateMemberRole,
  canUpdateOrganization,
  INVITE_ROLES,
  isInviteRole,
  isOrgRole,
  ORG_ROLES,
  ROLE_LABELS,
  type OrgRole,
  type Permission,
} from "./permissions";

/**
 * Матрица прав из требований. Здесь она зафиксирована как данные: если кто-то
 * поменяет MIN_ROLE в permissions.ts, тест покажет расхождение с ТЗ.
 *
 * `viewer` — роль из enum `public.org_role` с доступом только на чтение: во
 * всех строках матрицы у неё `false`. Чтение правами не описывается (страницы
 * открыты любому участнику организации), поэтому отдельной строки на него нет.
 */
const MATRIX: Record<Permission, Record<OrgRole, boolean>> = {
  "organization:update": {
    owner: true,
    admin: false,
    member: false,
    viewer: false,
  },
  "organization:delete": {
    owner: true,
    admin: false,
    member: false,
    viewer: false,
  },
  "organization:transfer": {
    owner: true,
    admin: false,
    member: false,
    viewer: false,
  },
  "member:invite": { owner: true, admin: true, member: false, viewer: false },
  "member:update": { owner: true, admin: true, member: false, viewer: false },
  "member:remove": { owner: true, admin: true, member: false, viewer: false },
  "record:create": { owner: true, admin: true, member: true, viewer: false },
  "record:update:own": {
    owner: true,
    admin: true,
    member: true,
    viewer: false,
  },
  "record:mutate:any": {
    owner: true,
    admin: true,
    member: false,
    viewer: false,
  },
};

const ROLES: OrgRole[] = ["owner", "admin", "member", "viewer"];

describe("can()", () => {
  it("совпадает с матрицей прав", () => {
    for (const [permission, byRole] of Object.entries(MATRIX)) {
      for (const role of ROLES) {
        expect(
          can(role, permission as Permission),
          `${role} / ${permission}`,
        ).toBe(byRole[role]);
      }
    }
  });

  it("без роли прав нет", () => {
    for (const permission of Object.keys(MATRIX) as Permission[]) {
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
    }
  });
});

describe("названия ролей", () => {
  it("использует формулировки из требований", () => {
    expect(ROLE_LABELS.owner).toBe("Владелец");
    expect(ROLE_LABELS.admin).toBe("Администратор");
    expect(ROLE_LABELS.member).toBe("Пользователь");
    expect(ROLE_LABELS.viewer).toBe("Наблюдатель");
  });

  it("описывает все четыре роли из public.org_role", () => {
    expect([...ORG_ROLES].sort()).toEqual(
      ["admin", "member", "owner", "viewer"].sort(),
    );
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ORG_ROLES].sort());
  });
});

describe("управление организацией", () => {
  it("переименование и удаление — только owner", () => {
    expect(canUpdateOrganization("owner")).toBe(true);
    expect(canUpdateOrganization("admin")).toBe(false);
    expect(canUpdateOrganization("member")).toBe(false);
    expect(canUpdateOrganization("viewer")).toBe(false);

    expect(canDeleteOrganization("owner")).toBe(true);
    expect(canDeleteOrganization("admin")).toBe(false);
    expect(canDeleteOrganization("member")).toBe(false);
    expect(canDeleteOrganization("viewer")).toBe(false);
  });
});

describe("canManageMembers", () => {
  it("owner и admin управляют командой, member и viewer — нет", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("member")).toBe(false);
    expect(canManageMembers("viewer")).toBe(false);
    expect(canManageMembers(null)).toBe(false);
  });
});

describe("canTransferOwnership", () => {
  it("owner передаёт владение другому участнику", () => {
    expect(canTransferOwnership("owner", "member", false)).toBe(true);
    expect(canTransferOwnership("owner", "admin", false)).toBe(true);
    expect(canTransferOwnership("owner", "viewer", false)).toBe(true);
  });

  it("себе передать нельзя", () => {
    expect(canTransferOwnership("owner", "owner", true)).toBe(false);
  });

  it("admin, member и viewer передать владение не могут", () => {
    expect(canTransferOwnership("admin", "member", false)).toBe(false);
    expect(canTransferOwnership("member", "admin", false)).toBe(false);
    expect(canTransferOwnership("viewer", "member", false)).toBe(false);
  });

  it("владение не передаётся текущему владельцу", () => {
    expect(canTransferOwnership("owner", "owner", false)).toBe(false);
  });
});

describe("canUpdateMemberRole", () => {
  it("разрешены переходы member ↔ admin", () => {
    expect(
      canUpdateMemberRole({
        currentRole: "owner",
        targetRole: "member",
        newRole: "admin",
        isSelf: false,
      }),
    ).toBe(true);

    expect(
      canUpdateMemberRole({
        currentRole: "owner",
        targetRole: "admin",
        newRole: "member",
        isSelf: false,
      }),
    ).toBe(true);
  });

  it("owner не понижается обычной сменой роли", () => {
    for (const newRole of ["admin", "member"] as OrgRole[]) {
      expect(
        canUpdateMemberRole({
          currentRole: "owner",
          targetRole: "owner",
          newRole,
          isSelf: false,
        }),
        `owner → ${newRole}`,
      ).toBe(false);
    }
  });

  it("owner не назначается обычной сменой роли", () => {
    for (const targetRole of ["admin", "member"] as OrgRole[]) {
      expect(
        canUpdateMemberRole({
          currentRole: "owner",
          targetRole,
          newRole: "owner",
          isSelf: false,
        }),
        `${targetRole} → owner`,
      ).toBe(false);
    }
  });

  it("себе роль менять нельзя", () => {
    expect(
      canUpdateMemberRole({
        currentRole: "owner",
        targetRole: "owner",
        newRole: "admin",
        isSelf: true,
      }),
    ).toBe(false);
    expect(
      canUpdateMemberRole({
        currentRole: "admin",
        targetRole: "admin",
        newRole: "member",
        isSelf: true,
      }),
    ).toBe(false);
  });

  it("member не меняет роли вообще", () => {
    expect(
      canUpdateMemberRole({
        currentRole: "member",
        targetRole: "member",
        newRole: "admin",
        isSelf: false,
      }),
    ).toBe(false);
  });

  it("admin не трогает владельца и не трогает другого администратора", () => {
    expect(
      canUpdateMemberRole({
        currentRole: "admin",
        targetRole: "owner",
        newRole: "member",
        isSelf: false,
      }),
    ).toBe(false);

    // понижение «равного по рангу» не разрешено: права admin ограничены
    // targetRole = member
    expect(
      canUpdateMemberRole({
        currentRole: "admin",
        targetRole: "admin",
        newRole: "member",
        isSelf: false,
      }),
    ).toBe(false);
  });

  it("владелец назначает и снимает наблюдателя", () => {
    expect(
      canUpdateMemberRole({
        currentRole: "owner",
        targetRole: "member",
        newRole: "viewer",
        isSelf: false,
      }),
    ).toBe(true);
    expect(
      canUpdateMemberRole({
        currentRole: "owner",
        targetRole: "admin",
        newRole: "viewer",
        isSelf: false,
      }),
    ).toBe(true);
    expect(
      canUpdateMemberRole({
        currentRole: "owner",
        targetRole: "viewer",
        newRole: "member",
        isSelf: false,
      }),
    ).toBe(true);
    expect(
      canUpdateMemberRole({
        currentRole: "owner",
        targetRole: "viewer",
        newRole: "admin",
        isSelf: false,
      }),
    ).toBe(true);
  });

  it("владелец не превращает в наблюдателя себя", () => {
    expect(
      canUpdateMemberRole({
        currentRole: "owner",
        targetRole: "owner",
        newRole: "viewer",
        isSelf: false,
      }),
    ).toBe(false);
    expect(
      canUpdateMemberRole({
        currentRole: "owner",
        targetRole: "viewer",
        newRole: "member",
        isSelf: true,
      }),
    ).toBe(false);
  });

  it("наблюдателя не трогает никто, кроме владельца", () => {
    // администратор наблюдателей не назначает и не повышает: его граница —
    // обычный участник (member), как и в RLS-политике удаления
    expect(
      canUpdateMemberRole({
        currentRole: "admin",
        targetRole: "member",
        newRole: "viewer",
        isSelf: false,
      }),
    ).toBe(false);
    expect(
      canUpdateMemberRole({
        currentRole: "admin",
        targetRole: "viewer",
        newRole: "member",
        isSelf: false,
      }),
    ).toBe(false);
    expect(
      canUpdateMemberRole({
        currentRole: "admin",
        targetRole: "viewer",
        newRole: "admin",
        isSelf: false,
      }),
    ).toBe(false);
    expect(
      canUpdateMemberRole({
        currentRole: "viewer",
        targetRole: "member",
        newRole: "admin",
        isSelf: false,
      }),
    ).toBe(false);
  });
});

describe("canRemoveMember", () => {
  it("owner удаляет admin, member и viewer", () => {
    expect(
      canRemoveMember({ currentRole: "owner", targetRole: "admin", isSelf: false }),
    ).toBe(true);
    expect(
      canRemoveMember({ currentRole: "owner", targetRole: "member", isSelf: false }),
    ).toBe(true);
    expect(
      canRemoveMember({ currentRole: "owner", targetRole: "viewer", isSelf: false }),
    ).toBe(true);
  });

  it("владельца не удаляет никто", () => {
    for (const currentRole of ROLES) {
      expect(
        canRemoveMember({
          currentRole,
          targetRole: "owner",
          isSelf: false,
        }),
        `${currentRole} удаляет owner`,
      ).toBe(false);
    }
  });

  it("себя не удаляет никто", () => {
    for (const role of ROLES) {
      expect(
        canRemoveMember({ currentRole: role, targetRole: role, isSelf: true }),
        `${role} удаляет себя`,
      ).toBe(false);
    }
  });

  it("admin удаляет только member", () => {
    expect(
      canRemoveMember({ currentRole: "admin", targetRole: "member", isSelf: false }),
    ).toBe(true);
    expect(
      canRemoveMember({ currentRole: "admin", targetRole: "admin", isSelf: false }),
    ).toBe(false);
  });

  it("member никого не удаляет", () => {
    expect(
      canRemoveMember({ currentRole: "member", targetRole: "member", isSelf: false }),
    ).toBe(false);
  });

  it("admin удаляет только member, наблюдателя — нет", () => {
    expect(
      canRemoveMember({ currentRole: "admin", targetRole: "viewer", isSelf: false }),
    ).toBe(false);
  });

  it("viewer никого не удаляет", () => {
    for (const targetRole of ROLES) {
      expect(
        canRemoveMember({ currentRole: "viewer", targetRole, isSelf: false }),
        `viewer удаляет ${targetRole}`,
      ).toBe(false);
    }
  });
});

describe("canMutateRecord", () => {
  it("автор меняет свою запись, если у роли есть право записи", () => {
    for (const role of ["owner", "admin", "member"] as OrgRole[]) {
      expect(
        canMutateRecord({ role, userId: "u1", createdBy: "u1" }),
        role,
      ).toBe(true);
    }
  });

  it("viewer не меняет даже свою запись", () => {
    // Роль выдали после того, как записи уже созданы: авторство не должно
    // сохранять доступ на запись у роли, которая читает организацию.
    expect(
      canMutateRecord({ role: "viewer", userId: "u1", createdBy: "u1" }),
    ).toBe(false);
    expect(
      canMutateRecord({ role: "viewer", userId: "u1", createdBy: "u2" }),
    ).toBe(false);
    expect(
      canMutateRecord({ role: "viewer", userId: "u1", createdBy: null }),
    ).toBe(false);
  });

  it("чужие записи меняют owner и admin", () => {
    expect(
      canMutateRecord({ role: "admin", userId: "u1", createdBy: "u2" }),
    ).toBe(true);
    expect(
      canMutateRecord({ role: "member", userId: "u1", createdBy: "u2" }),
    ).toBe(false);
  });

  it("запись без автора меняют только admin и выше", () => {
    expect(
      canMutateRecord({ role: "member", userId: "u1", createdBy: null }),
    ).toBe(false);
    expect(
      canMutateRecord({ role: "owner", userId: "u1", createdBy: null }),
    ).toBe(true);
  });
});

describe("роли приглашения", () => {
  it("owner и viewer приглашением не назначаются", () => {
    expect(INVITE_ROLES).toEqual(["admin", "member"]);
    expect(isInviteRole("owner")).toBe(false);
    expect(isInviteRole("viewer")).toBe(false);
    expect(isInviteRole("admin")).toBe(true);
    expect(isInviteRole("member")).toBe(true);
  });
});

describe("isOrgRole", () => {
  it("знает все роли из public.org_role", () => {
    expect(isOrgRole("owner")).toBe(true);
    expect(isOrgRole("admin")).toBe(true);
    expect(isOrgRole("member")).toBe(true);
    expect(isOrgRole("viewer")).toBe(true);
  });

  it("не пропускает роли вне модели", () => {
    expect(isOrgRole("")).toBe(false);
    expect(isOrgRole("OWNER")).toBe(false);
    expect(isOrgRole("guest")).toBe(false);
  });
});

/**
 * Контракт роли `viewer` (наблюдатель): полное чтение и ни одной записи.
 *
 * Чтение в приложении определяется членством (`requireOrgBySlug`), а не правами:
 * наблюдатель — обычный участник организации, поэтому видит проекты, материалы,
 * контакты и спецификации. Записи закрыты матрицей прав выше; здесь собраны
 * требования из ТЗ по пунктам.
 *
 * Публичная ссылка на спецификацию («Поделиться»/«PDF») в матрицу не входит:
 * `generatePublicLink` требует только членства, поэтому наблюдатель может
 * поделиться спецификацией. Это осознанное правило — публикация отнесена к
 * чтению (см. lib/permissions.ts), а не пропущенная проверка.
 */
describe("viewer (наблюдатель)", () => {
  it("валидная роль организации с понятной подписью", () => {
    expect(ORG_ROLES).toContain("viewer");
    expect(isOrgRole("viewer")).toBe(true);
    expect(ROLE_LABELS.viewer).toBe("Наблюдатель");
  });

  it("не имеет ни одного права, кроме чтения", () => {
    const permissions = Object.keys(MATRIX) as Permission[];
    for (const p of permissions) {
      expect(can("viewer", p), p).toBe(false);
    }
  });

  it("не приглашает участников", () => {
    expect(can("viewer", "member:invite")).toBe(false);
    expect(canManageMembers("viewer")).toBe(false);
  });

  it("не меняет и не удаляет организацию", () => {
    expect(can("viewer", "organization:update")).toBe(false);
    expect(can("viewer", "organization:delete")).toBe(false);
    expect(can("viewer", "organization:transfer")).toBe(false);
    expect(canUpdateOrganization("viewer")).toBe(false);
    expect(canDeleteOrganization("viewer")).toBe(false);
  });

  it("не меняет роли и не исключает участников", () => {
    for (const targetRole of ROLES) {
      expect(
        canUpdateMemberRole({
          currentRole: "viewer",
          targetRole,
          newRole: "admin",
          isSelf: false,
        }),
        `viewer меняет роль ${targetRole}`,
      ).toBe(false);
      expect(
        canRemoveMember({ currentRole: "viewer", targetRole, isSelf: false }),
        `viewer исключает ${targetRole}`,
      ).toBe(false);
    }
  });

  it("не создаёт и не меняет записи организации", () => {
    expect(can("viewer", "record:create")).toBe(false);
    expect(
      canMutateRecord({ role: "viewer", userId: "u1", createdBy: "u1" }),
    ).toBe(false);
  });

  it("остаётся ролью в составе организации, а не анонимным доступом", () => {
    // viewer — участник: он проходит проверку членства, и именно членство (а не
    // права) открывает чтение и личный профиль. Гостевого доступа в системе нет.
    expect(isOrgRole("viewer")).toBe(true);
    expect(can("viewer", "record:update:own")).toBe(false);
  });
});
