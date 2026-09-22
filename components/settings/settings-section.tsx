import type { ReactNode } from "react";

/**
 * Раздел внутри «Настроек»: заголовок страницы и, при необходимости, действие
 * справа (например, «Пригласить» на странице команды).
 *
 * Общий заголовок «Настройки» и навигацию рисует layout раздела, поэтому
 * страницы не повторяют `PageHeader` и не создают вторую конкурирующую шапку.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-medium tracking-tight text-fg">{title}</h2>
          {description && <p className="text-sm text-fg-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
