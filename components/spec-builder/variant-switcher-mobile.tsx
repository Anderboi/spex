"use client";

import { Layers, Check, Plus, ChevronRight } from "lucide-react";
import Image from "next/image";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { fmt, cn } from "@/lib/utils";
import { SpecItem } from "@/lib/types";

export function VariantSwitcherMobile({
  item,
  onSwitch,
  onAdd,
}: {
  item: SpecItem;
  onSwitch: (variantId: string) => void;
  onAdd: () => void;
}) {
  const variants = item.variants ?? [];
  if (variants.length < 2) return null;

  const active = variants.find((v) => v.isActive);
  const cheapest = [...variants].sort((a, b) => a.price - b.price)[0];
  const bestSaving =
    active && cheapest.price < active.price ? active.price - cheapest.price : 0;

  return (
    <Drawer>
      {/* Строка того же паттерна, что "Количество" и "Цена за м²" в SpecCard:
          подпись слева, значение справа, вся строка — тап-таргет. */}
      <DrawerTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left active:bg-bg-card2"
            aria-label={`Вариант материала: выбрано ${active?.name ?? "—"}, ${variants.length} вариантов`}
          >
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium font-mono uppercase text-fg-muted">
              <Layers className="size-3.5" />
              Вариант
            </span>
            <span className="ml-auto flex min-w-0 items-center gap-2">
              {bestSaving > 0 ? (
                <>
                  <span className="truncate text-[13px] text-fg-secondary">
                    Есть дешевле
                  </span>
                  <span className="shrink-0 rounded-full bg-bg-green-light px-2 py-0.5 text-[11.5px] font-semibold text-fg-green">
                    −{fmt(bestSaving)} ₽
                  </span>
                </>
              ) : (
                <span className="truncate text-[13px] text-fg-secondary">
                  {variants.length} варианта
                </span>
              )}
              <ChevronRight className="size-4 shrink-0 text-fg-muted" />
            </span>
          </button>
        }
      />

      <DrawerContent className='pb-4'>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-[15px]">Вариант материала</DrawerTitle>
        </DrawerHeader>

        <div className="flex flex-col gap-1 px-4 pb-6">
          {variants.map((v) => {
            const delta = active ? v.price - active.price : 0;
            return (
              <DrawerClose
                render={
                  <button
                    type="button"
                    onClick={() => !v.isActive && onSwitch(v.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-bg-card2",
                      v.isActive && "bg-bg-brand/40",
                    )}
                  >
                    {v.imageUrl ? (
                      <Image
                        src={v.imageUrl}
                        alt=""
                        height={44}
                        width={44}
                        className="size-11 shrink-0 rounded-lg border object-cover"
                      />
                    ) : (
                      <div className="size-11 shrink-0 rounded-lg border bg-bg-brand2/50" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {v.isActive && (
                          <Check className="size-4 shrink-0 text-fg" />
                        )}
                        <span
                          className={cn(
                            "truncate text-[14px]",
                            v.isActive ? "font-medium text-fg" : "text-fg",
                          )}
                        >
                          {v.name || "Без названия"}
                        </span>
                      </div>
                      <span className="block truncate text-[12px] text-fg-secondary">
                        {[v.brand, v.label].filter(Boolean).join(" · ") || "—"}
                        {v.isActive && " · Основной"}
                      </span>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-mono text-[13.5px] font-medium tabular-nums">
                        {fmt(v.price)} ₽
                      </span>
                      {!v.isActive && delta !== 0 && (
                        <span
                          className={cn(
                            "rounded px-1 font-mono text-[11px] font-medium",
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
                  </button>
                }
                key={v.id}
              />
            );
          })}

          <button
            type="button"
            onClick={onAdd}
            className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border-muted py-3 text-[13.5px] text-fg-secondary active:bg-bg-card2"
          >
            <Plus className="size-4" /> Добавить вариант
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
