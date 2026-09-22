"use client";
import { useState } from "react";
import { cn, fmt } from "@/lib/utils";
import { Input } from '@/components/ui/input';

export function PriceField({
  value,
  onCommit,
  readOnly,
  className,
}: {
  value: number;
  readOnly: boolean;
  onCommit: (raw: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [prevValue, setPrevValue] = useState(value);

  // Цена изменилась извне (модификатор, сохранение, соседняя карточка) —
  // сбрасываем черновик. Правка состояния во время рендера вместо useEffect:
  // так не бывает лишнего каскадного рендера.
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(null);
  }

  return (
    <Input
      inputMode="decimal"
      aria-label="Цена за единицу"
      readOnly={readOnly}
      value={draft ?? (value ? fmt(value) : "")}
      placeholder="—"
      onFocus={(e) => {
        if (readOnly) return;
        const target = e.target;

        setDraft(value ? String(value) : "");
        setTimeout(() => {
          target.select();
        }, 0);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={cn(
        className,
        "w-full min-w-0 rounded border border-transparent bg-transparent focus:px-1 py-1 text-left font-mono text-[13px] tabular-nums focus:outline-none h-6",
        readOnly
          ? "cursor-default text-fg-secondary"
          : "hover:border-border-muted focus:border-fg-brand",
      )}
    />
  );
}
