import { SettingsSection } from "@/components/settings/settings-section";
import { ProfileForm } from "@/components/settings/profile-form";
import { requireOrgBySlug } from "@/lib/auth/session";

export const metadata = { title: "Профиль" };

type Props = { params: Promise<{ orgSlug: string }> };

/**
 * Личный профиль текущего пользователя.
 *
 * Пользователь берётся из сессии (`requireOrgBySlug`), а не из параметров
 * адреса: страница всегда показывает того, кто в неё пришёл. Значения приходят
 * из БД (см. `getSessionContext`), поэтому после сохранения имени здесь сразу
 * видны актуальные данные.
 */
export default async function ProfileSettingsPage({ params }: Props) {
  const { orgSlug } = await params;
  const { user, role, orgId, organizations } = await requireOrgBySlug(orgSlug);

  const organizationName =
    organizations.find((organization) => organization.id === orgId)?.name ??
    null;

  return (
    <SettingsSection
      title="Профиль"
      description="Управляйте информацией своего аккаунта."
    >
      <ProfileForm
        name={user.name ?? ""}
        email={user.email ?? ""}
        image={user.image ?? null}
        role={role}
        organizationName={organizationName}
      />
    </SettingsSection>
  );
}
