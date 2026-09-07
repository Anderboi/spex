"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Поле названия для позиции-черновика (`isPlaceholder`). В отличие от
 * `InlineCode`, поле сразу редактируемое — черновик создаётся именно затем,
 * чтобы быстро зафиксировать намерение («гигиенический душ»), не открывая
 * модалку выбора материала. Сохраняется по blur/Enter, Escape откатывает.
 */
export function DraftNameField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          ref.current?.blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          ref.current?.blur();
        }
      }}
      placeholder="Например: гигиенический душ"
      aria-label="Название позиции (черновик)"
      className={cn(
        "-mx-1 w-full truncate rounded px-1 py-0.5 text-[14px] font-medium text-fg outline-none",
        "placeholder:font-normal placeholder:text-fg-muted",
        "hover:bg-bg-card focus-visible:bg-bg focus-visible:ring-1 focus-visible:ring-fg-brand",
      )}
    />
  );
}
