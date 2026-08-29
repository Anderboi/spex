// components/spec-builder/variant-switcher.tsx
"use client";

import { Layers, Check, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmt, cn } from "@/lib/utils";
import { SpecItem } from '@/lib/types';

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
  if (variants.length < 2) return null;

  const active = variants.find((v) => v.isActive);
  const cheapest = [...variants].sort((a, b) => a.price - b.price)[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Варианты замены"
        className="flex h-6 items-center gap-1 rounded-md border border-border-muted px-1.5 text-[11px] font-medium text-fg-muted hover:border-fg hover:text-fg"
      >
        <Layers className="size-3" />
        {variants.length}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 bg-bg-card">
        {variants.map((v) => {
          const delta = active ? v.price - active.price : 0;
          return (
            <DropdownMenuItem
              key={v.id}
              onClick={() => !v.isActive && onSwitch(v.id)}
              className="flex flex-col items-start gap-0.5 py-2"
            >
              <div className="flex w-full items-center gap-2">
                <span
                  className={cn(
                    "size-3.5 flex-none",
                    v.isActive ? "text-fg" : "text-transparent",
                  )}
                >
                  <Check className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {v.name || "Без названия"}
                </span>
                <span className="flex-none font-mono text-[12px] tabular-nums">
                  {fmt(v.price)} ₽
                </span>
              </div>
              <div className="flex w-full items-center gap-2 pl-5.5">
                <span className="truncate text-[11px] text-fg-dim">
                  {v.brand || "—"}
                  {v.label ? ` · ${v.label}` : ""}
                </span>
                {!v.isActive && delta !== 0 && (
                  <span
                    className={cn(
                      "ml-auto flex-none font-mono text-[10.5px]",
                      delta < 0 ? "text-fg-approved" : "text-fg-red",
                    )}
                  >
                    {delta < 0 ? "−" : "+"}
                    {fmt(Math.abs(delta))} ₽
                  </span>
                )}
                {v.id === cheapest.id && variants.length > 1 && (
                  <span className="flex-none rounded bg-bg-approved/15 px-1 text-[9.5px] font-semibold uppercase text-fg-approved">
                    дешевле
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
          className="text-[12.5px] text-fg-muted"
        >
          Управление вариантами…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
