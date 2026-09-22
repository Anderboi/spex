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
  ROLE_LABELS,
  type OrgRole,
  type Permission,
} from "./permissions";

/**
 * Матрица прав из требований. Здесь она зафиксирована как данные: если кто-то
 * поменяет MIN_ROLE в permissions.ts, тест покажет расхождение с ТЗ.
 */
const MATRIX: Record<Permission, Record<OrgRole, boolean>> = {
  "organization:update": { owner: true, admin: false, member: false },
  "organization:delete": { owner: true, admin: false, member: false },
  "organization:transfer": { owner: true, admin: false, member: false },
  "member:invite": { owner: true, admin: true, member: false },
  "member:update": { owner: true, admin: true, member: false },
  "member:remove": { owner: true, admin: true, member: false },
  "record:create": { owner: true, admin: true, member: true },
  "record:mutate:any": { owner: true, admin: true, member: false },
};

const ROLES: OrgRole[] = ["owner", "admin", "member"];

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
  });
});

describe("управление организацией", () => {
  it("переименование и удаление — только owner", () => {
    expect(canUpdateOrganization("owner")).toBe(true);
    expect(canUpdateOrganization("admin")).toBe(false);
    expect(canUpdateOrganization("member")).toBe(false);

    expect(canDeleteOrganization("owner")).toBe(true);
    expect(canDeleteOrganization("admin")).toBe(false);
    expect(canDeleteOrganization("member")).toBe(false);
  });
});

describe("canManageMembers", () => {
  it("owner и admin управляют командой, member — нет", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("member")).toBe(false);
    expect(canManageMembers(null)).toBe(false);
  });
});

describe("canTransferOwnership", () => {
  it("owner передаёт владение другому участнику", () => {
    expect(canTransferOwnership("owner", "member", false)).toBe(true);
    expect(canTransferOwnership("owner", "admin", false)).toBe(true);
  });

  it("себе передать нельзя", () => {
    expect(canTransferOwnership("owner", "owner", true)).toBe(false);
  });

  it("admin и member передать владение не могут", () => {
    expect(canTransferOwnership("admin", "member", false)).toBe(false);
    expect(canTransferOwnership("member", "admin", false)).toBe(false);
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
});

describe("canRemoveMember", () => {
  it("owner удаляет admin и member", () => {
    expect(
      canRemoveMember({ currentRole: "owner", targetRole: "admin", isSelf: false }),
    ).toBe(true);
    expect(
      canRemoveMember({ currentRole: "owner", targetRole: "member", isSelf: false }),
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
});

describe("canMutateRecord", () => {
  it("автор меняет свою запись при любой роли", () => {
    for (const role of ROLES) {
      expect(
        canMutateRecord({ role, userId: "u1", createdBy: "u1" }),
        role,
      ).toBe(true);
    }
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
  it("owner приглашением не назначается", () => {
    expect(INVITE_ROLES).toEqual(["admin", "member"]);
    expect(isInviteRole("owner")).toBe(false);
    expect(isInviteRole("admin")).toBe(true);
    expect(isInviteRole("member")).toBe(true);
  });
});

describe("isOrgRole", () => {
  it("знает три роли модели", () => {
    expect(isOrgRole("owner")).toBe(true);
    expect(isOrgRole("admin")).toBe(true);
    expect(isOrgRole("member")).toBe(true);
  });

  it("не пропускает роли вне модели", () => {
    expect(isOrgRole("viewer")).toBe(false);
    expect(isOrgRole("")).toBe(false);
    expect(isOrgRole("OWNER")).toBe(false);
  });
});
