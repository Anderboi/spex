"use client";
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "../ui/button";
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
  revealOnHover,
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
  /** В спокойном состоянии видны только число и единица измерения, а кнопки
   *  +/− и рамка поля проявляются при наведении на строку-`group`. Фокус
   *  внутри строки раскрывает их так же: иначе до «−» и «+» нельзя было бы
   *  добраться с клавиатуры, а невидимая кнопка остаётся кликабельной. */
  revealOnHover?: boolean;
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

  /** Скрытое состояние кнопок: место в раскладке сохраняется (иначе строка
   *  «прыгала» бы при наведении), но кнопка не видна и не ловит клики.
   *
   *  `invisible` тут не дублирует `opacity-0`, а обязателен: в базовых стилях
   *  `Button` есть `disabled:opacity-50`, и в собранном CSS оно идёт позже
   *  `opacity-0` — неактивный «−» при `qty = 1` остался бы виден наполовину. */
  const hiddenBtn = revealOnHover
    ? "invisible opacity-0 transition-[opacity,visibility] duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    : undefined;

  /** Поле в спокойном состоянии — просто число с единицей: без рамки и без
   *  фона, которые появляются вместе с кнопками. */
  const boxLook = revealOnHover
    ? "border-transparent bg-transparent transition-colors group-hover:border-input group-hover:bg-bg-card group-focus-within:border-input group-focus-within:bg-bg-card"
    : "bg-bg-card";

  return (
    <div className="flex items-center gap-1">
      <Button
        className={cn("bg-bg-card", btnSize, hiddenBtn)}
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
          "min-w-14 items-baseline sm:items-center rounded bg-transparent! border border-transparent focus:outline-none! hover:border-border-muted focus:border-fg-brand",
          fieldSize,
          boxLook,
        )}
      >
        <InputGroupInput
          className={cn("text-right font-mono px-0! tabular-nums", fieldText)}
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
        className={cn("bg-bg-card", btnSize, hiddenBtn)}
        variant="outline"
        onClick={() => {
          commitDraft();
          onChange(1);
        }}
        aria-label="Увеличить количество"
      >
        <Plus className="size-3" />
      </Button>
    </div>
  );
}
