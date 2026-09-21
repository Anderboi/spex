"use client";

import { useSearchParams } from "next/navigation";
import { useContactsUrl } from "./use-contacts-url";
import {
  CONTACTS_SORTS,
  CONTACTS_SORT_OPTIONS,
  DEFAULT_CONTACTS_SORT,
} from "@/lib/contacts/filters";
import type { ContactsSort as ContactsSortValue } from "@/lib/types";
import { FilterSelect } from "@/components/layout/filter-select";
import { cn } from "@/lib/utils";

const DEFAULT_SORT: ContactsSortValue = DEFAULT_CONTACTS_SORT;

/**
 * Сортировка каталога контактов — тот же селект, что и в библиотеке материалов.
 *
 * «Без сортировки» не существует: сервер всегда сортирует, а неизвестное
 * значение в URL заменяет на дефолт (`parseContactsFilters` →
 * `.catch(DEFAULT_CONTACTS_SORT)`) — триггер должен показывать то же самое.
 *
 * Экземпляров два: в верхней строке тулбара (виден на `sm+`) и в нижней шторке
 * фильтров (виден всегда, шторка мобильная). Раскладку задаёт внешний `div`,
 * поэтому в шторку передаётся `containerClassName="flex"` — иначе унаследованный
 * `hidden sm:flex` спрятал бы селект на телефоне. `className` при этом уходит
 * самому триггеру: так ширина задаётся отдельно от видимости.
 */
export function ContactsSort({
  isMobile = true,
  side,
  className,
  containerClassName,
}: {
  /** `true` — мобильный экземпляр (`< sm`), `false` — десктопный. */
  isMobile?: boolean;
  /** Сторона открытия попапа: в нижней шторке — `top`, под триггером места нет. */
  side?: "top" | "bottom";
  /** Классы триггера (ширина, растяжение). */
  className?: string;
  /** Классы обёртки, управляющей видимостью контрола. */
  containerClassName?: string;
}) {
  const searchParams = useSearchParams();
  const { update } = useContactsUrl();
  const raw = searchParams.get("sort") ?? "";

  const sort = (CONTACTS_SORTS as readonly string[]).includes(raw)
    ? (raw as ContactsSortValue)
    : DEFAULT_SORT;

  return (
    <div
      className={cn(
        "items-center",
        isMobile ? "flex sm:hidden" : "hidden sm:flex",
        containerClassName,
      )}
    >
      <FilterSelect
        ariaLabel="Сортировка"
        placeholder="Сортировка"
        side={side}
        className={className}
        value={sort}
        onChange={(value) => update({ sort: value ?? DEFAULT_SORT })}
        options={CONTACTS_SORT_OPTIONS}
      />
    </div>
  );
}
