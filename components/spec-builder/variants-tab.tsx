"use client";

import { Plus, Check, Trash2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmt, cn } from "@/lib/utils";
import { SpecItem, SpecVariant } from '@/lib/types';

export function VariantsTab({
  item,
  onSwitch,
  onAdd,
  onUpdate,
  onDelete,
}: {
  item: SpecItem;
  onSwitch: (variantId: string) => void;
  onAdd: () => void;
  onUpdate: (variantId: string, patch: Partial<SpecVariant>) => void;
  onDelete: (variantId: string) => void;
}) {
  const variants = [...(item.variants ?? [])].sort(
    (a, b) => a.position - b.position,
  );
  const active = variants.find((v) => v.isActive);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-fg-muted">
          Активный вариант отображается в спецификации и экспортах.
        </p>
        <Button size="sm" variant="outline" onClick={onAdd} className="gap-1.5">
          <Plus className="size-3.5" /> Вариант
        </Button>
      </div>

      {variants.map((v) => {
        const delta = active && !v.isActive ? v.price - active.price : 0;
        return (
          <div
            key={v.id}
            className={cn(
              "rounded-xl border p-3",
              v.isActive ? "border-fg bg-bg-card" : "border-border-muted",
            )}
          >
            <div className="mb-2 flex items-center gap-2">
              {v.isActive ? (
                <span className="flex items-center gap-1 rounded-md bg-fg px-2 py-0.5 text-[11px] font-semibold text-bg">
                  <Check className="size-3" /> Активный
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSwitch(v.id)}
                  className="flex items-center gap-1 rounded-md border border-border-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted hover:border-fg hover:text-fg"
                >
                  <Star className="size-3" /> Сделать активным
                </button>
              )}
              <Input
                defaultValue={v.label}
                placeholder="Метка (Основной, Бюджетный…)"
                onBlur={(e) => onUpdate(v.id, { label: e.target.value.trim() })}
                className="h-7 max-w-40 text-[12px]"
              />
              {delta !== 0 && (
                <span
                  className={cn(
                    "ml-auto font-mono text-[12px]",
                    delta < 0 ? "text-fg-approved" : "text-fg-red",
                  )}
                >
                  {delta < 0 ? "−" : "+"}
                  {fmt(Math.abs(delta))} ₽ к активному
                </span>
              )}
              {variants.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDelete(v.id)}
                  className="ml-1 text-fg-muted hover:text-fg-red"
                  aria-label="Удалить вариант"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Input
                defaultValue={v.name}
                placeholder="Наименование"
                onBlur={(e) => onUpdate(v.id, { name: e.target.value.trim() })}
                className="col-span-2"
              />
              <Input
                defaultValue={v.brand}
                placeholder="Производитель"
                onBlur={(e) => onUpdate(v.id, { brand: e.target.value.trim() })}
              />
              <Input
                defaultValue={v.article}
                placeholder="Артикул"
                onBlur={(e) =>
                  onUpdate(v.id, { article: e.target.value.trim() })
                }
              />
              <Input
                type="number"
                defaultValue={v.price}
                placeholder="Цена за ед."
                onBlur={(e) =>
                  onUpdate(v.id, { price: Number(e.target.value) || 0 })
                }
                className="font-mono tabular-nums"
              />
              <Input
                defaultValue={v.productUrl}
                placeholder="Ссылка"
                onBlur={(e) =>
                  onUpdate(v.id, { productUrl: e.target.value.trim() })
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
