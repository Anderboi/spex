"use client";

import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FilterField } from "@/components/layout/filter-field";
import { SheetSelect } from "@/components/layout/sheet-select";
import { cn } from "@/lib/utils";
import {
  ALL_CATEGORIES,
  SPEC_STATUSES,
  TYPE_ORDER,
  type SpecStatus,
} from "@/lib/constants";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import type { SpecItem } from "@/lib/types";
import type { SpecFilters, SpecSort } from "@/hooks/use-spec-filters";

const SORT_OPTIONS: { value: SpecSort; label: string }[] = [
  { value: "code", label: "По марке" },
  { value: "az", label: "А→Я" },
  { value: "sum", label: "По сумме" },
];

/**
 * Фильтры спецификации (тип, статус) и сортировка в нижней шторке — так же,
 * как на страницах материалов и контактов.
 *
 * На узких экранах в тулбаре остаётся только поиск с кнопкой: чипсы типов,
 * статус и сортировка не помещаются в одну строку и переезжают сюда. На
 * широких экранах шторка не рендерится вовсе — там чипсы типов остаются
 * на виду.
 *
 * Изменения применяются сразу (состояние в URL), «Готово» просто закрывает.
 */
export function SpecFilterSheet({
  filters,
  items,
  className,
}: {
  filters: SpecFilters;
  /** Позиции проекта — для счётчиков по типам и статусам. */
  items: SpecItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const hasType = filters.activeType !== ALL_CATEGORIES;
  const hasStatus = filters.statusFilter !== null;
  const hasSort = filters.sort !== "code";
  const activeCount = Number(hasType) + Number(hasStatus) + Number(hasSort);

  const typeCount = (t: string) =>
    items.reduce((n, i) => n + (i.type === t ? 1 : 0), 0);
  const statusCount = (s: SpecStatus) =>
    items.reduce((n, i) => n + (i.status === s ? 1 : 0), 0);

  // Пустые типы не показываем (как и чипсы), кроме выбранного: иначе на
  // устаревшем значении из URL селект показывал бы «Все категории».
  const typeOptions = TYPE_ORDER.filter(
    (t) => typeCount(t) > 0 || t === filters.activeType,
  );

  return (
    <>
      <Button
        variant="secondary"
        className={cn("h-10 shrink-0 gap-2 border border-border", className)}
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
            <FilterField label="Категория">
              <SheetSelect
                ariaLabel="Категория"
                value={filters.activeType}
                onChange={(v) => filters.setActiveType(v || ALL_CATEGORIES)}
              >
                <option value={ALL_CATEGORIES}>
                  {ALL_CATEGORIES} ({items.length})
                </option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t} ({typeCount(t)})
                  </option>
                ))}
              </SheetSelect>
            </FilterField>

            <FilterField label="Статус">
              <SheetSelect
                ariaLabel="Статус"
                value={filters.statusFilter ?? ""}
                onChange={(v) =>
                  filters.setStatusFilter((v || null) as SpecStatus | null)
                }
              >
                <option value="">Все статусы ({items.length})</option>
                {SPEC_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SPEC_STATUS_CONFIG[s].label} ({statusCount(s)})
                  </option>
                ))}
              </SheetSelect>
            </FilterField>

            <FilterField label="Сортировка">
              <SheetSelect
                ariaLabel="Сортировка"
                value={filters.sort}
                onChange={(v) => filters.setSort(v as SpecSort)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SheetSelect>
            </FilterField>
          </div>

          <SheetFooter className="flex-row gap-2 border-t border-border-subtle p-4">
            <Button
              size="lg"
              variant="outline"
              className="flex-1"
              disabled={activeCount === 0}
              onClick={() => {
                // Сброс только фильтров из шторки: строка поиска не трогается
                // (как «Сбросить» в шторке материалов).
                filters.setActiveType(ALL_CATEGORIES);
                filters.setStatusFilter(null);
                filters.setSort("code");
              }}
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
