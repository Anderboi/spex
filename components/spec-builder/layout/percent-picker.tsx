"use client";

import { useId, useState } from "react";
import { Ellipsis } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toggle } from "@/components/ui/toggle";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, parseCommittedNumber } from "@/lib/utils";
import { Button } from '@/components/ui/button';

const chip =
  "h-9 min-w-0 justify-center rounded-md px-1 font-mono text-[13px] tabular-nums " +
  "ring-1 ring-border-muted hover:bg-bg-select sm:h-8";

/** Выбранный чип: мягкая подсветка бренда. Чёрный остаётся за «Суммой». */
const chipSelected =
  "bg-bg-brand ring-fg-brand font-semibold text-fg hover:bg-bg-brand";

interface Props {
  /** Текущий процент позиции; может не совпасть ни с одним быстрым. */
  value: number;
  options: readonly number[];
  onChange: (pct: number) => void;
  /** Подпись для скринридера: их две на экране — запас и скидка. */
  label: string;
  className?: string;
}

/**
 * Быстрый выбор процента: пресеты одной кнопкой + свой процент через «…».
 *
 * Значение управляемое и приходит из позиции, а не живёт в состоянии: своё
 * число, открытое заново, должно подсветиться, а правку снаружи (история,
 * отмена) блок обязан показать.
 */
export function PercentPicker({
  value,
  options,
  onChange,
  label,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
   const inputId = useId();
   
  const presets = options.slice(0, 4);
  const isPreset = presets.includes(value);

  const parsed = draft.trim() === "" ? null : parseCommittedNumber(draft);

  /**
   * Повторное нажатие на выбранный чип Base UI понимает как снятие выбора и
   * отдаёт пустой массив. Но процент — не флажок: позиция всегда без запаса
   * (0 %) или без скидки, поэтому пустой выбор игнорируем — чип остаётся
   * нажатым.
   */
 const select = (next: string[]) => {
   const raw = next[0];
   if (raw === undefined) return; // повторный клик не снимает выбор
   const pct = Number(raw);
   if (Number.isFinite(pct) && pct !== value) onChange(pct);
 };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setDraft(isPreset ? "" : String(value));
  };

  const commitCustom = () => {
    if (parsed === null) return;
    const pct = Math.min(100, Math.max(0, Math.round(parsed)));
    if (pct !== value) onChange(pct);
    setOpen(false);
  };

  return (
    // Ширина — на всю ячейку, а не по содержимому: только тогда пятерым чипам
    // есть что делить поровну. `w-full` в том числе на `sm`: с `w-auto` группа
    // сжималась до суммы своих чипов, а «…» стояла фиксированной — пресеты
    // выходили шире неё. Своей рамки у ряда нет: рамку носит каждый чип, и
    // вторая, общая, давала бы двойной контур, которого в макете нет.
    <div className={cn("flex w-full grid-cols-5  gap-1", className)}>
      {/* Группа — только пресеты: она держит роль, стрелки и «нажат ровно
          один». «…» стоит рядом, а не внутри: кнопка, открывающая попап,
          внутри роли `group` читалась бы как ещё один вариант процента. */}
      <ToggleGroup
        multiple={false}
        value={isPreset ? [String(value)] : []}
        onValueChange={select}
        aria-label={label}
        className="col-span-4 grid w-full grid-cols-4 gap-1"
      >
        {presets.map((pct) => (
          <ToggleGroupItem
            key={pct}
            value={String(pct)}
            className={cn(
              chip,
              // `!` нужен: у toggleVariants фон уже задан и перебивает утилиту
              "data-pressed:bg-bg-brand! data-pressed:ring-fg-brand",
              "data-pressed:font-semibold data-pressed:text-fg",
            )}
          >
            {pct}%
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          aria-label={`${label}: свой процент`}
          className={cn(
            chip,
            "flex cursor-pointer items-center justify-center px-3.5",
            !isPreset && chipSelected,
          )}
        >
          {isPreset ? (
            <Ellipsis className="size-3.5 text-fg-secondary" />
          ) : (
            `${value}%`
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 gap-2">
          <label
            htmlFor={inputId}
            className="font-mono text-[11px] tracking-wider text-fg-muted uppercase"
          >
            {label}, %
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={inputId}
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              placeholder="7"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCustom();
                }
              }}
              className="h-8 w-16 text-center font-mono text-[13px] tabular-nums"
            />
            <span className="font-mono text-[13px] text-fg-muted">%</span>
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              disabled={parsed === null}
              onClick={commitCustom}
            >
              Применить
            </Button>
          </div>
          <p className="text-[11px] text-fg-muted">От 0 до 100</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
