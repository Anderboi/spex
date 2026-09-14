"use client";

import { LayoutGrid, Rows3, StretchHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SpecDensity } from "@/hooks/use-spec-density";

const OPTIONS: {
  value: SpecDensity;
  label: string;
  hint: string;
  Icon: typeof Rows3;
}[] = [
  {
    value: "row",
    label: "Строками",
    hint: "Максимум позиций на экране, вместо превью — марка",
    Icon: Rows3,
  },
  {
    value: "compact",
    label: "Компактно",
    hint: "Превью и количество, но меньше высоты карточки",
    Icon: StretchHorizontal,
  },
  {
    value: "card",
    label: "Карточками",
    hint: "Полная карточка с ценой и статусом",
    Icon: LayoutGrid,
  },
];

/** Переключатель плотности списка. Показывается только на узких экранах,
 *  где список рисуется не таблицей. */
export function DensitySwitcher({
  value,
  onChange,
  className,
}: {
  value: SpecDensity;
  onChange: (next: SpecDensity) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Вид списка позиций"
      className={cn(
        "flex h-10 shrink-0 items-center gap-0.5 rounded-lg border border-border-muted bg-bg-card p-1",
        className,
      )}
    >
      {OPTIONS.map(({ value: v, label, hint, Icon }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={`${label} — ${hint}`}
            onClick={() => onChange(v)}
            className={cn(
              "flex size-8 items-center justify-center rounded-md transition-colors",
              active
                ? "bg-bg-select text-fg"
                : "text-fg-muted hover:bg-bg-select/60 hover:text-fg-secondary",
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
