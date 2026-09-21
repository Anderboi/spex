"use client";

import { useSearchParams } from "next/navigation";
import { useContactsUrl } from "./use-contacts-url";
import { CONTACTS_SORTS, CONTACTS_SORT_OPTIONS } from "@/lib/contacts/filters";
import type { ContactsSort as ContactsSortValue } from "@/lib/types";
import { FilterSelect } from "@/components/layout/filter-select";
import { cn } from "@/lib/utils";

const DEFAULT_SORT: ContactsSortValue = "created_desc";

/**
 * Сортировка каталога контактов — тот же селект, что и в библиотеке материалов.
 *
 * «Без сортировки» не существует: сервер всегда сортирует, а неизвестное
 * значение в URL заменяет на дефолт (`parseContactsFilters` →
 * `.catch("created_desc")`) — триггер должен показывать то же самое.
 *
 * Контрол рендерится дважды: в верхней строке тулбара (`isMobile={false}`) и в
 * мобильной строке рядом с категориями. Видимость задаётся обёрткой, как у
 * `MaterialsCategoryFilter`, — разметка самого селекта остаётся неизменной.
 */
export function ContactsSort({ isMobile = true }: { isMobile?: boolean }) {
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
      )}
    >
      <FilterSelect
        ariaLabel="Сортировка"
        placeholder="Сортировка"
        value={sort}
        onChange={(value) => update({ sort: value ?? DEFAULT_SORT })}
        options={CONTACTS_SORT_OPTIONS}
      />
    </div>
  );
}
