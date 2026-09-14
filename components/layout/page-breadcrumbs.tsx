import { Fragment } from "react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface BreadcrumbEntry {
  /** Текст пункта. */
  label: string;
  /** Куда ведёт пункт. Без `href` пункт считается текущей страницей. */
  href?: string;
}

/**
 * Хлебные крошки для страниц-деталей (`PageHeader` принимает их как `breadcrumbs`).
 *
 * Навигация построена на `<Link>`, а не на `router.back()`: ссылка работает при
 * прямом заходе по URL (когда истории браузера ещё нет), не уводит на внешний
 * сайт и не ломает prefetch. Последний пункт — `aria-current="page"`, поэтому
 * скринридеры читают его как текущую страницу, а не как ссылку.
 *
 * Список не переносится на вторую строку: `PageHeader` отводит крошкам фиксированную
 * высоту, поэтому длинный заголовок обрезается (`truncate`), а не ломает шапку.
 */
export function PageBreadcrumbs({ items }: { items: BreadcrumbEntry[] }) {
  if (items.length === 0) return null;

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {items.map((item, index) => (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 && <BreadcrumbSeparator className="shrink-0" />}
            <BreadcrumbItem
              className={item.href ? "shrink-0" : "min-w-0"}
            >
              {item.href ? (
                <BreadcrumbLink
                  className="truncate"
                  render={<Link href={item.href} />}
                >
                  {item.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
