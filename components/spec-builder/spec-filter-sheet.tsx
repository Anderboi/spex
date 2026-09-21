"use client";

import { useMemo, useState } from "react";
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
import {
  FilterSelect,
  type FilterSelectOption,
} from "@/components/layout/filter-select";
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

const SORT_OPTIONS: FilterSelectOption<SpecSort>[] = [
  { value: "code", label: "По марке" },
  { value: "az", label: "А→Я" },
  { value: "sum", label: "По сумме" },
];

/**
 * Фильтры спецификации (категория, статус) и сортировка в нижней шторке — так
 * же, как в тулбарах материалов, контактов и проектов.
 *
 * На узких экранах в тулбаре остаётся только поиск с кнопкой: чипсы типов,
 * статус и сортировка не помещаются в одну строку и переезжают сюда. На
 * широких экранах шторка не рендерится вовсе — там чипсы типов остаются
 * на виду.
 *
 * Контролы — те же `FilterSelect`, что и в остальных фильтрах приложения;
 * попап открывается вверх (`side="top"`), потому что под триггером в шторке
 * места нет. Счётчики в подписях пунктов считаются по позициям спецификации —
 * их не видно на чипсах, когда те скрыты на телефоне.
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

  // Пустые типы не показываем (как и чипсы), кроме выбранного: иначе на
  // устаревшем значении из URL селект показывал бы «Все категории».
  const typeOptions = useMemo<FilterSelectOption<string>[]>(() => {
    const count = (type: string) =>
      items.reduce((n, item) => n + (item.type === type ? 1 : 0), 0);

    return [
      { value: null, label: `${ALL_CATEGORIES} (${items.length})` },
      ...TYPE_ORDER.filter(
        (type) => count(type) > 0 || type === filters.activeType,
      ).map((type) => ({ value: type, label: `${type} (${count(type)})` })),
    ];
  }, [items, filters.activeType]);

  const statusOptions = useMemo<FilterSelectOption<SpecStatus>[]>(() => {
    const count = (status: SpecStatus) =>
      items.reduce((n, item) => n + (item.status === status ? 1 : 0), 0);

    return [
      { value: null, label: `Все статусы (${items.length})` },
      ...SPEC_STATUSES.map((status) => ({
        value: status,
        label: `${SPEC_STATUS_CONFIG[status].label} (${count(status)})`,
      })),
    ];
  }, [items]);

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
              <FilterSelect
                ariaLabel="Категория"
                placeholder={ALL_CATEGORIES}
                side="top"
                className="w-full"
                value={hasType ? filters.activeType : null}
                onChange={(value) =>
                  filters.setActiveType(value ?? ALL_CATEGORIES)
                }
                options={typeOptions}
              />
            </FilterField>

            <FilterField label="Статус">
              <FilterSelect
                ariaLabel="Статус"
                placeholder="Все статусы"
                side="top"
                className="w-full"
                value={filters.statusFilter}
                onChange={filters.setStatusFilter}
                options={statusOptions}
              />
            </FilterField>

            <FilterField label="Сортировка">
              <FilterSelect
                ariaLabel="Сортировка"
                placeholder="Сортировка"
                side="top"
                className="w-full"
                value={filters.sort}
                onChange={(value) => filters.setSort(value ?? "code")}
                options={SORT_OPTIONS}
              />
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
