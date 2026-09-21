"use client";

import { useSearchParams } from "next/navigation";
import { useMaterialsUrl } from "../../hooks/use-materials-url";
import {
  MATERIALS_STATUSES,
  type MaterialStatus,
} from "@/lib/materials/filters";
import { FilterSelect } from "@/components/layout/filter-select";

const STATUS_OPTIONS: { label: string; value: MaterialStatus | null }[] = [
  { label: "Все статусы", value: null },
  { label: "Активные", value: "active" },
  { label: "В архиве", value: "archived" },
];

function isMaterialStatus(value: string): value is MaterialStatus {
  return (MATERIALS_STATUSES as readonly string[]).includes(value);
}

export function MaterialsStatusFilter({
  side,
  className,
}: {
  side?: "top" | "bottom";
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();
  const raw = searchParams.get("status") ?? "";

  // Неизвестное значение в URL сервер трактует как «без фильтра»
  // (`parseMaterialsFilters` → `.catch(null)`), поэтому и триггер должен
  // показывать «Все статусы», а не пустую подпись.
  const status = isMaterialStatus(raw) ? raw : null;

  return (
    <FilterSelect
      ariaLabel="Статус"
      placeholder="Все статусы"
      side={side}
      className={className}
      value={status}
      onChange={(value) => update({ status: value })}
      options={STATUS_OPTIONS}
    />
  );
}
