import {
  DangerZoneCard,
  OrganizationSettingsCard,
} from "@/components/team/organization-settings";
import { SettingsSection } from "@/components/settings/settings-section";
import { requireOrgBySlug } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

export const metadata = { title: "Студия" };

type Props = { params: Promise<{ orgSlug: string }> };

/**
 * Общие настройки студии: название организации и её удаление.
 *
 * Состав команды живёт на отдельной странице (`settings/team`) — здесь только
 * то, что относится к самой организации. Права проверяются повторно:
 * переименование доступно владельцу (`organization:update`), удаление — только
 * ему (`organization:delete`), и обе операции проверяют роль ещё раз в server
 * action и в БД. Название организации не секрет, поэтому карточку видит и
 * участник без прав — в ней поле выключено с пояснением причины.
 */
export default async function StudioSettingsPage({ params }: Props) {
  const { orgSlug } = await params;
  const { orgId, role, organizations } = await requireOrgBySlug(orgSlug);

  const organization = organizations.find((item) => item.id === orgId) ?? null;
  const organizationName = organization?.name ?? orgSlug;

  return (
    <SettingsSection
      title="Студия"
      description="Название организации и необратимые действия."
    >
      <div className="space-y-6">
        <OrganizationSettingsCard
          orgSlug={orgSlug}
          organizationName={organizationName}
          canUpdate={can(role, "organization:update")}
        />

        {can(role, "organization:delete") && (
          <DangerZoneCard
            orgSlug={orgSlug}
            organizationName={organizationName}
          />
        )}
      </div>
    </SettingsSection>
  );
}
