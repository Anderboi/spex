"use client";
import { useEffect, useState } from "react";
import { cn, fmt } from "@/lib/utils";
import { Input } from '../ui/input';

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

  useEffect(() => {
    setDraft(null);
  }, [value]);

  return (
    <input
      inputMode="decimal"
      aria-label="Цена за единицу"
      value={draft ?? (value ? fmt(value) : "")}
      placeholder="—"
      onFocus={() => setDraft(value ? String(value) : "")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={cn(className,"w-full rounded border border-transparent bg-transparent //px-2 py-1 text-right font-mono text-[13px] tabular-nums hover:border-border-muted focus:border-fg-brand focus:outline-none")}
    />
  );
}
