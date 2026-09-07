"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { TYPE_ORDER, type SpecType } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

/**
 * Черновик как способ «завести» пустую секцию.
 *
 * Отдельной сущности «секция» в модели нет — группа в ctx.groups
 * является чистой производной от items (TYPE_ORDER.filter(...)).
 * Поэтому «добавить пустую секцию» реализовано как создание одного
 * пустого черновика (isPlaceholder: true) выбранного типа: он и
 * держит группу видимой, пока дизайнер не заполнит позицию или не
 * удалит её. Никакого дополнительного состояния или сущности не
 * заводится — то же самое действие, что делает «+» внутри уже
 * существующей секции (ctx.addPlaceholder), только для типа, у
 * которого пока нет ни одной позиции.
 */
export default function AddSectionPicker({
  usedTypes,
  onPick,
  onAddPlaceholder,
}: {
  usedTypes: string[];
  onPick: (type: SpecType) => void;
  onAddPlaceholder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const available = TYPE_ORDER.filter((t) => !usedTypes.includes(t));

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (available.length === 0) return null;

  return (
    <div ref={ref} className="relative mt-3">
      <div className='flex gap-2'>
        <Button
          variant="secondary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center justify-center gap-1.5 border-border-muted text-fg-secondary hover:border-border"
        >
          <Plus className="size-4" />
          Добавить секцию
        </Button>
        <Button
          variant="secondary"
          onClick={onAddPlaceholder}
          className="flex items-center gap-1.5 border-border-muted text-fg-secondary hover:border-border"
        >
          <Plus className="size-4" /> Пустая марка
        </Button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-border-muted bg-bg-card p-1.5 shadow-[0_8px_24px_rgba(27,26,23,.12)]"
        >
          {available.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(t);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center rounded-md px-3 py-2 text-left text-[13.5px] text-fg",
                "hover:bg-bg-select",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
