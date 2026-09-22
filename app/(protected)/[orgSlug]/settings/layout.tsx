import PageContainer from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import {
  SettingsNav,
  type SettingsNavItem,
} from "@/components/settings/settings-nav";
import { requireOrgBySlug } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

export const metadata = { title: "Настройки" };

type Props = {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
};

/**
 * Общий каркас раздела «Настройки»: заголовок, локальная навигация и контент.
 *
 * Состав навигации считается здесь, на сервере: участник без прав на управление
 * студией видит только «Профиль». Это лишь видимость — каждая страница раздела
 * заново проверяет сессию (`requireOrgBySlug`), а каждое изменение — права
 * (`can()` в server action), поэтому скрытый пункт нельзя «открыть» ссылкой.
 */
export default async function SettingsLayout({ children, params }: Props) {
  const { orgSlug } = await params;
  const { role } = await requireOrgBySlug(orgSlug);

  const items: SettingsNavItem[] = [
    { href: `/${orgSlug}/settings/profile`, label: "Профиль" },
  ];

  // Управление студией и составом команды — admin и owner (см. lib/permissions).
  if (can(role, "member:invite")) {
    items.push(
      { href: `/${orgSlug}/settings/studio`, label: "Студия" },
      { href: `/${orgSlug}/settings/team`, label: "Команда" },
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Настройки" />
      <div className="mt-4 flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        <SettingsNav items={items} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PageContainer>
  );
}
