"use client";

import { useSearchParams } from "next/navigation";
import { ALL_CATEGORIES, TYPE_ORDER } from "@/lib/constants";
import { useMaterialsUrl } from "../../hooks/use-materials-url";
import {
  FilterSelect,
  type FilterSelectOption,
} from "@/components/layout/filter-select";
import { cn } from "@/lib/utils";

const CATEGORY_OPTIONS: FilterSelectOption<string>[] = [
  { label: ALL_CATEGORIES, value: null },
  ...TYPE_ORDER.map((t) => ({ label: t, value: t })),
];

/**
 * Категория библиотеки одним селектом — мобильный экземпляр для ряда тулбара.
 *
 * Отделён от `MaterialsCategoryFilter` (чипсы с drag-to-scroll для `sm+`):
 * в ряду на телефоне контрол стоит рядом с иконкой поиска, и его видимость
 * задаёт вызывающая сторона через `className` (`sm:hidden`), а не сама
 * разметка чипсов.
 */
export function MaterialsCategorySelect({ className }: { className?: string }) {
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();

  const category = searchParams.get("category") ?? null;

  return (
    <FilterSelect
      ariaLabel="Категория"
      placeholder={ALL_CATEGORIES}
      className={cn("w-full", className)}
      value={category}
      onChange={(value) => update({ category: value })}
      options={CATEGORY_OPTIONS}
    />
  );
}
