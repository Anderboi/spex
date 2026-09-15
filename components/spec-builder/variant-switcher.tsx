// components/spec-builder/variant-switcher.tsx
"use client";

import { Layers, Check, Plus, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmt, cn, plural } from "@/lib/utils";
import { SpecItem } from "@/lib/types";
import Image from "next/image";

export function VariantSwitcher({
  item,
  onSwitch,
  onAdd,
  onOpenVariants,
}: {
  item: SpecItem;
  onSwitch: (variantId: string) => void;
  onAdd: () => void;
  onOpenVariants: () => void;
}) {
  const variants = item.variants ?? [];
  // Единственный вариант — это сам базовый материал позиции («Основной»),
  // выбирать нечего: пилюля появляется со второй записи, то есть с первой
  // замены, и из неё же добавляют следующие.
  if (variants.length < 2) return null;

  const active = variants.find((v) => v.isActive);
  const cheapest = [...variants].sort((a, b) => a.price - b.price)[0];
  const bestSaving =
    active && cheapest.price < active.price ? active.price - cheapest.price : 0;

  return (
    <DropdownMenu>
      {/* Compact pill trigger, not full-width — sized to its content so it
          never reads as an empty input field. Surfaces the best available
          saving so the designer doesn't have to open the menu to see it. */}
      <DropdownMenuTrigger
        aria-label="Варианты замены"
        className="inline-flex h-7 w-fit items-center gap-1.5 rounded-full border border-border-muted bg-bg-card px-2.5 text-[12px] font-medium text-fg hover:border-fg-muted"
      >
        <Layers className="size-3.5 text-fg-muted" />
        {variants.length}{" "}
        {plural(variants.length, "вариант", "варианта", "вариантов")}
        {bestSaving > 0 && (
          <span className="rounded-full bg-bg-green-light px-1.5 py-0.5 text-[11px] font-semibold text-fg-green">
            −{fmt(bestSaving)} ₽
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 bg-bg-card p-1.5">
        {variants.map((v) => {
          const delta = active ? v.price - active.price : 0;
          const meta = [v.brand, v.label].filter(Boolean).join(" · ");
          // снимок базового материала уже подписан «Основной» — не дублируем
          const activeNote = v.isActive && v.label !== "Основной";
          return (
            <DropdownMenuItem
              key={v.id}
              onClick={() => !v.isActive && onSwitch(v.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md py-2 px-2",
                v.isActive && "bg-bg-brand/40",
              )}
            >
              {/* Thumbnail helps recognize the material at a glance instead
                  of reading names. Falls back to a neutral tile. */}
              {v.imageUrl ? (
                <Image
                  src={v.imageUrl}
                  alt=""
                  height={36}
                  width={36}
                  className="size-9 flex-none rounded-md border object-cover"
                />
              ) : (
                <div className="size-9 flex-none rounded-md border bg-bg-brand2/50" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {v.isActive && (
                    <Check className="size-3.5 flex-none text-fg" />
                  )}
                  <span
                    className={cn(
                      "truncate text-[13px]",
                      v.isActive ? "font-medium text-fg" : "text-fg",
                    )}
                  >
                    {v.name || "Без названия"}
                  </span>
                </div>
                <span
                  className="block truncate text-[11.5px] text-fg-dim"
                  title={meta}
                >
                  {meta || "—"}
                  {activeNote && " · Основной"}
                </span>
              </div>

              <div className="flex flex-none flex-col items-end gap-0.5">
                <span className="font-mono text-[12.5px] font-medium tabular-nums">
                  {fmt(v.price)} ₽
                </span>
                {!v.isActive && delta !== 0 && (
                  <span
                    className={cn(
                      "rounded px-1 font-mono text-[10.5px] font-medium",
                      delta < 0
                        ? "bg-bg-green-light text-fg-green"
                        : "text-fg-red",
                    )}
                  >
                    {delta < 0 ? "−" : "+"}
                    {fmt(Math.abs(delta))} ₽
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onAdd} className="gap-2 text-[12.5px]">
          <Plus className="size-3.5" /> Добавить вариант
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onOpenVariants}
          className="gap-2 text-[12.5px] text-fg-brand"
        >
          <ExternalLink className="size-3.5" /> Управление вариантами
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
