"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import type { SpecFilters } from "@/hooks/use-spec-filters";

/**
 * Сводка активных фильтров, спрятанных в шторке на узких экранах: видно, что
 * именно отфильтровано, и снять фильтр можно одним тапом, не открывая шторку.
 * На широких экранах не нужна — там чипсы типов и сортировка на виду.
 */
export function ActiveFilterChips({
  filters,
  className,
}: {
  filters: SpecFilters;
  className?: string;
}) {
  const chips: { key: string; label: string; clear: () => void }[] = [];

  if (filters.activeType !== "Все типы") {
    chips.push({
      key: "type",
      label: filters.activeType,
      clear: () => filters.setActiveType("Все типы"),
    });
  }
  if (filters.statusFilter) {
    chips.push({
      key: "status",
      label: SPEC_STATUS_CONFIG[filters.statusFilter].label,
      clear: () => filters.setStatusFilter(null),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div
      className={cn("flex min-w-0 items-center gap-1.5 overflow-x-auto", className)}
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.clear}
          aria-label={`Снять фильтр «${chip.label}»`}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-border-muted bg-bg-card pr-2 pl-2.5 text-[12px] text-fg-secondary"
        >
          {chip.label}
          <X className="size-3 text-fg-muted" />
        </button>
      ))}
    </div>
  );
}
