"use client";

import { useSearchParams } from "next/navigation";
import { useMaterialsUrl } from "../../hooks/use-materials-url";
import {
  MATERIALS_SORTS,
  MATERIALS_SORT_OPTIONS,
} from "@/lib/materials/filters";
import type { MaterialsSort as MaterialsSortValue } from "@/lib/types";
import { MaterialsFilterSelect } from "./materials-filter-select";

const DEFAULT_SORT: MaterialsSortValue = "created_desc";

export function MaterialsSort({
  side,
  className,
}: {
  side?: "top" | "bottom";
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();
  const raw = searchParams.get("sort") ?? "";

  // «Без сортировки» не существует: сервер всегда сортирует, а неизвестное
  // значение в URL заменяет на дефолт (`parseMaterialsFilters` →
  // `.catch("created_desc")`) — триггер должен показывать то же самое.
  const sort = (MATERIALS_SORTS as readonly string[]).includes(raw)
    ? (raw as MaterialsSortValue)
    : DEFAULT_SORT;

  return (
    <MaterialsFilterSelect
      ariaLabel="Сортировка"
      placeholder="Сортировка"
      side={side}
      className={className}
      value={sort}
      onChange={(value) => update({ sort: value ?? DEFAULT_SORT })}
      options={MATERIALS_SORT_OPTIONS}
    />
  );
}
