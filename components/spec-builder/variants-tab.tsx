"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SpecItem } from "@/lib/types";
import VariantCard from "./variant-card";

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

  return (
    <article className="flex flex-col gap-3 px-4">
      <div className="flex pt-4 items-center justify-between">
        <p className="text-[13px] text-fg-muted">
          Кликните по карточке, чтобы сделать вариант активным. Он отображается
          в спецификации и экспортах.
        </p>
        <Button
          size="lg"
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
            <VariantCard
              key={v.id}
              item={v}
              onSwitch={onSwitch}
              onEdit={onEdit}
              onDelete={onDelete}
              delta={delta}
              variants={variants}
            />
          );
        })}
      </div>
    </article>
  );
}
