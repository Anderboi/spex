"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  allowedStatuses,
  SPEC_STATUS_CONFIG,
  statusWarning,
} from "@/lib/spec/status";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { SpecItem } from "@/lib/types";
import { SpecStatus } from "@/lib/constants";

export function StatusMenu({
  item,
  onChange,
  className,
  variant = "chip",
  filled = false,
}: {
  item: SpecItem;
  onChange: (s: SpecStatus) => void;
  className?: string;
  /** `dot` — только цветовая точка в кнопке: для плотных списков, где
   *  подпись статуса не помещается, но меню смены статуса нужно. */
  variant?: "chip" | "dot";
  /**
   * Заливка чипа мягким цветом статуса (12%). Включается точечно — в хедере
   * детализации. В строках таблицы статус намеренно без фона: там он повторяется
   * десятки раз, и залитые плашки превратили бы столбец в россыпь цветных пятен.
   */
  filled?: boolean;
}) {
  const [pending, setPending] = useState<{
    status: SpecStatus;
    warning: string;
  } | null>(null);
  const cfg = SPEC_STATUS_CONFIG[item.status];

  const pick = (s: SpecStatus) => {
    if (s === item.status) return;
    const w = statusWarning(item.status, s);
    if (w) {
      setPending({ status: s, warning: w });
      return;
    }
    onChange(s);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Статус: ${cfg.label}`}
          title={`Статус: ${cfg.label}`}
          className={cn(
            "flex items-center",
            variant === "dot"
              ? "size-7 justify-center rounded-full border border-border-muted bg-bg-card"
              : cn(
                  "h-7 gap-1.5 rounded-full px-2.5 text-[12px] font-medium",
                  // У залитого чипа hover остаётся текстовым: подкрашивать
                  // прозрачную плашку сильнее некуда, а цвет уже читается точкой.
                  !filled && cfg.chip,
                ),
            className,
          )}
          // Оттенок берём из `bar` — того же цвета, что у точки и полосы статуса:
          // один источник цвета на все состояния, без второй палитры в конфиге.
          // `color-mix` вместо Tailwind-утилиты: hex из конфига не проходит
          // через `@theme`, и класс вида `bg-[#3b82f6]/12` зависел бы от того,
          // сгенерирует ли его Tailwind для этого файла.
          style={
            filled && variant === "chip"
              ? {
                  backgroundColor: `color-mix(in oklab, ${cfg.bar} 12%, transparent)`,
                }
              : undefined
          }
        >
          {variant === "dot" ? (
            <span className={cn("size-3 rounded-full", cfg.dot)} />
          ) : (
            <>
              <span className={cn("size-1.5 rounded-full", cfg.dot)} />
              {cfg.label}
              <ChevronDown className="size-3 opacity-60" />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-52 bg-bg-card">
          {allowedStatuses(item).map((s) => (
            <DropdownMenuItem
              key={s}
              onClick={() => pick(s)}
              className="gap-2 text-[13px]"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  SPEC_STATUS_CONFIG[s].dot,
                )}
              />
              {SPEC_STATUS_CONFIG[s].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={pending !== null}
        title={`Сменить статус на «${pending ? SPEC_STATUS_CONFIG[pending.status].label : ""}»?`}
        description={pending?.warning ?? ""}
        confirmLabel="Сменить статус"
        onConfirm={() => {
          if (pending) onChange(pending.status);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
