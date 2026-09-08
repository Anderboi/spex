"use client";

import { useEffect, useRef, useState } from "react";
import { CODE_PATTERN } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function InlineCode({
  code,
  locked,
  onCommit,
  className,
}: {
  code: string;
  locked: boolean;
  onCommit: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(code);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(code), [code]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const commit = () => {
    const next = value.trim().toUpperCase();
    setEditing(false);
    if (!next || next === code) {
      setValue(code);
      return;
    }
    if (!CODE_PATTERN.test(next)) {
      setValue(code);
      return;
    }
    onCommit(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={
          locked
            ? "Марка согласована — изменение затронет чертежи"
            : "Изменить марку"
        }
        className={cn(
          "font-mono text-[12px] font-semibold tabular-nums rounded px-1 py-0.5 //-mx-1.5",
          "hover:bg-fg-body focus-visible:outline //focus-visible:outline-2 focus-visible:outline-fg-brand",
          className,
          locked &&
            "underline decoration-dotted decoration-fg-muted underline-offset-4",
        )}
      >
        {code || "—"}
      </button>
    );
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value.toUpperCase())}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setValue(code);
          setEditing(false);
        }
      }}
      aria-label="Марка позиции"
      className="w-13 rounded border border-fg-brand bg-bg px-1.5 py-0.5 font-mono text-[13px] font-semibold uppercase tabular-nums outline-none"
    />
  );
}
