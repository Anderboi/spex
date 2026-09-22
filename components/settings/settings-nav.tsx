"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type SettingsNavItem = {
  href: string;
  label: string;
};

/**
 * Локальная навигация раздела «Настройки».
 *
 * Список пунктов собирает сервер (`settings/layout.tsx`) — он же решает, что
 * доступно роли пользователя. Здесь остаётся только подсветка активного пункта,
 * поэтому компонент ничего не знает о правах и не может показать лишнее.
 *
 * На узких экранах список прокручивается по горизонтали внутри себя, чтобы
 * страница настроек не получала горизонтальный overflow.
 */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname();

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Разделы настроек"
      className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 md:mx-0 md:w-52 md:shrink-0 md:overflow-visible md:px-0"
    >
      <ul className="flex w-max items-center gap-1 md:w-full md:flex-col md:items-stretch md:gap-0.5">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center rounded-lg border border-transparent px-3 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-border bg-bg-card text-fg"
                    : "text-fg-secondary hover:bg-bg-select hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
