"use client";

import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FilterField } from "@/components/layout/filter-field";
import { useMaterialsUrl } from "@/hooks/use-materials-url";
import type { MaterialBrands } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { MaterialsManufacturerFilter } from "./materials-manufacturer-filter";
import { MaterialsStatusFilter } from "./materials-status-filter";
import { MaterialsSort } from "./materials-sort";

/**
 * Вторичные фильтры (производитель, статус) и сортировка в нижней шторке.
 *
 * На мобильной ширине четыре контрола в одну строку не помещаются и переносятся
 * «лестницей», поэтому в тулбаре остаётся только поиск с кнопкой, а сами
 * контролы переезжают в шторку. Категория остаётся снаружи: это основной разрез
 * библиотеки, и прятать её за лишний тап незачем.
 *
 * Кнопка живёт в мобильном ряду `SearchBlock` и на `sm+` скрыта (`sm:hidden`):
 * там вторичные фильтры стоят в тулбаре, и шторка не нужна.
 *
 * Изменения применяются сразу (URL-состояние), «Готово» просто закрывает шторку.
 */
export function MaterialsFilterSheet({
  brands,
  className,
}: {
  brands: MaterialBrands;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();

  const manufacturer = searchParams.get("manufacturer");
  const status = searchParams.get("status");
  const activeCount =
    Number(Boolean(manufacturer)) + Number(Boolean(status));

  const handleReset = () => update({ manufacturer: null, status: null });

  return (
    <>
      <Button
        variant="outline"
        className={cn("h-10 shrink-0 gap-2", className)}
        aria-label={
          activeCount > 0
            ? `Фильтры, активно ${activeCount}`
            : "Фильтры и сортировка"
        }
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="size-4" />
        {/* Фильтры */}
        {activeCount > 0 && (
          <span className="flex size-5 items-center justify-center rounded-full bg-bg-accent text-[11px] font-medium text-bg">
            {activeCount}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] gap-0 overflow-y-auto border-t border-border bg-bg-card p-0"
        >
          <SheetHeader className="border-b border-border-subtle p-4 pr-12">
            <SheetTitle>Фильтры и сортировка</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-4 p-4">
            <FilterField
              label="Производитель"
              hint={
                brands.items.length === 0
                  ? brands.failed
                    ? "Не удалось загрузить список производителей — обновите страницу."
                    : "Ни у одного материала не заполнен бренд."
                  : undefined
              }
            >
              <MaterialsManufacturerFilter
                brands={brands}
                side="top"
                className="w-full"
              />
            </FilterField>
            <FilterField label="Статус">
              <MaterialsStatusFilter side="top" className="w-full" />
            </FilterField>
            <FilterField label="Сортировка">
              <MaterialsSort side="top" className="w-full" />
            </FilterField>
          </div>

          <SheetFooter className="flex-row gap-2 border-t border-border-subtle p-4">
            <Button
              size="lg"
              variant="outline"
              className="flex-1"
              onClick={handleReset}
              disabled={activeCount === 0}
            >
              <RotateCcw className="mr-2 size-4" /> Сбросить
            </Button>
            <Button size="lg" className="flex-1" onClick={() => setOpen(false)}>
              Готово
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
