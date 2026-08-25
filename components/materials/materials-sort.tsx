"use client";

import { ArrowUpDown } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMaterialsUrl } from "../../hooks/use-materials-url";
import { MATERIALS_SORT_OPTIONS } from "@/lib/materials/filters";
import type { MaterialsSort } from "@/lib/types";

export function MaterialsSort() {
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();
  const sort = (searchParams.get("sort") ?? "created_desc") as MaterialsSort;

  return (
    <div className="relative inline-flex items-center">
      <select
        value={sort}
        onChange={(e) => update({ sort: e.target.value as MaterialsSort })}
        aria-label="Сортировка"
        className="h-10 cursor-pointer appearance-none rounded-lg border border-border bg-bg-card pl-3 pr-7 font-mono text-xs text-fg outline-none transition-colors hover:bg-bg-brand/50"
      >
        {MATERIALS_SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ArrowUpDown className="pointer-events-none absolute right-2.5 size-3.5 text-fg-muted" />
    </div>
  );
}
