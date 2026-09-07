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

export function QtyStepper({
  qty,
  unit,
  onChange,
  editable,
  showUnit = true,
}: {
  qty: number;
  unit: string;
  editable: boolean;
  showUnit?: boolean;
  onChange: (d: number) => void;
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

  return (
    <ButtonGroup>
      <Button
        className="size-7 bg-bg-card"
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
      <InputGroup className="h-7 min-w-16 items-center bg-bg-card">
        <InputGroupInput
          className="text-center font-mono px-0! text-[12px] tabular-nums"
          value={draft ?? qty}
          readOnly={!editable}
          inputMode="decimal"
          aria-label="Количество"
          onFocus={(e) => {
            if (!editable) return;
            setDraft(String(qty));
            requestAnimationFrame(() => e.currentTarget.select());
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
        className="size-7 bg-bg-card"
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
