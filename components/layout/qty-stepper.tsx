"use client";
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";
import { cn } from "@/lib/utils";

export function QtyStepper({
  qty,
  unit,
  onChange,
  editable,
  showUnit = true,
  isMobile,
  dense,
  className,
}: {
  qty: number;
  unit: string;
  editable: boolean;
  showUnit?: boolean;
  onChange: (d: number) => void;
  isMobile?: boolean;
  /** Средний размер (32px) — для компактных раскладок, где `isMobile`
   *  (40px) не помещается, но тач-таргет ещё нужен. */
  dense?: boolean;
  className?: string;
}) {
  /** Черновик текста пока пользователь печатает; null = показываем `qty`. */
  const [draft, setDraft] = useState<string | null>(null);
  const [prevQty, setPrevQty] = useState(qty);

  // Количество изменилось извне (кнопки +/−, другие источники) —
  // сбрасываем черновик и показываем актуальное значение.
  if (prevQty !== qty) {
    setPrevQty(qty);
    setDraft(null);
  }

  /** Применяет набранное значение: переводим его в дельту от текущего qty. */
  const commitDraft = () => {
    if (draft === null) return;
    const n = Number(draft.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) {
      const delta = Math.round((n - qty) * 100) / 100;
      if (delta !== 0) onChange(delta);
    }
    setDraft(null);
  };

  const btnSize = isMobile ? "size-10" : dense ? "size-8" : "size-6";
  const fieldSize = isMobile ? "h-10" : dense ? "h-8" : "h-6";
  const fieldText = isMobile
    ? "text-[15px]!"
    : dense
      ? "text-[14px]!"
      : "text-[13px]!";

  return (
    <ButtonGroup className={cn("shrink-0", className)}>
      <Button
        className={cn("bg-bg-card", btnSize)}
        size="sm"
        variant="outline"
        onClick={() => {
          commitDraft();
          onChange(-1);
        }}
        disabled={qty <= 1}
        aria-label="Уменьшить количество"
      >
        <Minus className="size-3" />
      </Button>
      <InputGroup
        className={cn(
          "min-w-14 items-baseline sm:items-center bg-bg-card",
          fieldSize,
        )}
      >
        <InputGroupInput
          className={cn(
            "text-right font-mono px-0! tabular-nums",
            fieldText,
          )}
          value={draft ?? qty}
          readOnly={!editable}
          inputMode="decimal"
          aria-label="Количество"
          onFocus={(e) => {
            if (!editable) return;
            setDraft(String(qty));
            // `currentTarget` обнуляется после обработчика события, поэтому
            // в rAF передаём сам элемент, а не синтетическое событие.
            const input = e.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
          onChange={(e) => {
            if (editable) setDraft(e.target.value);
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (!editable) return;
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          {showUnit && (
            <span className="text-[11px] ml-1 text-fg-muted">{unit}</span>
          )}
        </InputGroupAddon>
      </InputGroup>
      <Button
        size="sm"
        className={cn("bg-bg-card", btnSize)}
        variant="outline"
        onClick={() => {
          commitDraft();
          onChange(1);
        }}
        aria-label="Увеличить количество"
      >
        <Plus className="size-3" />
      </Button>
    </ButtonGroup>
  );
}
