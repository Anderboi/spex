"use client";
import { Minus, Plus } from "lucide-react";

export function QtyStepper({
  qty,
  unit,
  onChange,
}: {
  qty: number;
  unit: string;
  onChange: (d: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(-1)}
        disabled={qty <= 1}
        aria-label="Уменьшить количество"
        className="flex size-6 items-center justify-center rounded border border-border-muted text-fg-secondary disabled:opacity-35"
      >
        <Minus className="size-3" />
      </button>
      <span className="min-w-14 text-center font-mono text-[13px] tabular-nums">
        {qty} <span className="text-[11px] text-fg-muted">{unit}</span>
      </span>
      <button
        type="button"
        onClick={() => onChange(1)}
        aria-label="Увеличить количество"
        className="flex size-6 items-center justify-center rounded border border-border-muted text-fg-secondary"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}
