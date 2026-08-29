"use client";

import {
  Plus,
  Check,
  Trash2,
  Pencil,
  ExternalLink,
  Building2,
  MoreHorizontal,
} from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmt, cn } from "@/lib/utils";
import type { SpecItem } from "@/lib/types";

export function VariantsTab({
  item,
  onSwitch,
  onAdd,
  onEdit,
  onDelete,
}: {
  item: SpecItem;
  onSwitch: (variantId: string) => void;
  onAdd: () => void;
  onEdit: (variantId: string) => void;
  onDelete: (variantId: string) => void;
}) {
  const variants = [...(item.variants ?? [])].sort(
    (a, b) => a.position - b.position,
  );
  const active = variants.find((v) => v.isActive);
  const cheapest =
    variants.length > 1
      ? [...variants].sort((a, b) => a.price - b.price)[0]
      : null;

  return (
    <div className="flex flex-col gap-3 px-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-fg-muted">
          Кликните по карточке, чтобы сделать вариант активным. Он отображается
          в спецификации и экспортах.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={onAdd}
          className="gap-1.5 shrink-0"
        >
          <Plus className="size-3.5" /> Вариант
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {variants.map((v) => {
          const delta = active && !v.isActive ? v.price - active.price : 0;
          return (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={() => !v.isActive && onSwitch(v.id)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !v.isActive) {
                  e.preventDefault();
                  onSwitch(v.id);
                }
              }}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all",
                v.isActive
                  ? "border-fg ring-1 ring-fg cursor-default"
                  : "border-border-muted cursor-pointer hover:border-fg hover:shadow-sm",
              )}
            >
              {/* картинка */}
              <div className="relative aspect-video w-full bg-bg-card">
                {v.imageUrl ? (
                  <Image
                    src={v.imageUrl}
                    alt={v.name}
                    fill
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-fg-dim">
                    <Building2 className="size-8 opacity-40" />
                  </div>
                )}

                {/* бейджи поверх картинки */}
                <div className="absolute left-2 top-2 flex gap-1.5">
                  {v.isActive && (
                    <span className="flex items-center gap-1 rounded-md bg-fg px-2 py-0.5 text-[11px] font-semibold text-bg">
                      <Check className="size-3" /> Активный
                    </span>
                  )}
                  {cheapest?.id === v.id && (
                    <span className="rounded-md bg-bg-approved/90 px-2 py-0.5 text-[11px] font-semibold text-bg">
                      Дешевле всех
                    </span>
                  )}
                </div>

                {/* меню ⋯ */}
                <div
                  className="absolute right-2 top-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label="Действия"
                      className="flex size-7 items-center justify-center rounded-md bg-bg/80 text-fg backdrop-blur hover:bg-bg"
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-44 bg-bg-card"
                    >
                      {!v.isActive && (
                        <DropdownMenuItem
                          onClick={() => onSwitch(v.id)}
                          className="gap-2 text-[13px]"
                        >
                          <Check className="size-3.5" /> Сделать активным
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => onEdit(v.id)}
                        className="gap-2 text-[13px]"
                      >
                        <Pencil className="size-3.5" /> Редактировать
                      </DropdownMenuItem>
                      {variants.length > 1 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onDelete(v.id)}
                            className="gap-2 text-[13px] text-fg-red"
                          >
                            <Trash2 className="size-3.5" /> Удалить
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* тело карточки */}
              <div className="flex flex-1 flex-col gap-1.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {v.name || "Без названия"}
                  </p>
                  {v.productUrl && (
                    <a
                      href={v.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Открыть на сайте"
                      className="shrink-0 text-fg-muted hover:text-fg"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>

                {v.brand && (
                  <p className="truncate text-[12px] text-fg-muted">
                    {v.brand}
                  </p>
                )}

                <div className="mt-auto flex items-end justify-between pt-1.5">
                  <div className="min-w-0">
                    {v.companyName && (
                      <p className="flex items-center gap-1 truncate text-[11.5px] text-fg-dim">
                        <Building2 className="size-3 shrink-0" />
                        {v.companyName}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[15px] font-semibold tabular-nums">
                      {fmt(v.price)} ₽
                    </p>
                    {delta !== 0 && (
                      <p
                        className={cn(
                          "font-mono text-[11px] tabular-nums",
                          delta < 0 ? "text-fg-approved" : "text-fg-red",
                        )}
                      >
                        {delta < 0 ? "−" : "+"}
                        {fmt(Math.abs(delta))} ₽
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
