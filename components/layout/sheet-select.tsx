"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Нативный селект для полей внутри нижней шторки.
 *
 * Не base-ui `FilterSelect`: внутри уже залоченного модального drawer'а
 * анкорный поп-ап правит `overflow` и компенсирует скроллбар (см. комментарий в
 * `filter-select.tsx`) — из-за этого шторка «уезжает». Нативный селект открывает
 * системный пикер и от блокировки скролла не зависит.
 *
 * Общий для шторок спецификации и проектов: раньше жил приватно в
 * `spec-filter-sheet.tsx`.
 */
export function SheetSelect({
  ariaLabel,
  value,
  onChange,
  className,
  children,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-10 w-full cursor-pointer appearance-none rounded-lg border border-border bg-bg-card pr-9 pl-3 font-mono text-sm text-fg outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring",
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-muted" />
    </div>
  );
}
