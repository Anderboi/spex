"use client";

import { useMemo, useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ALL_CATEGORIES, TYPE_ORDER } from "@/lib/constants";
import {
  countDrafts,
  specTypeCounts,
  type SpecSort,
} from "@/lib/spec/list-filters";
import type { SpecItem } from "@/lib/types";
import type { SpecFilters } from "@/hooks/use-spec-filters";
import {
  SpecStatusSelect,
  SpecSupplierSelect,
} from "./layout/spec-filter-controls";

const SORT_OPTIONS: FilterSelectOption<SpecSort>[] = [
  { value: "code", label: "По марке" },
  { value: "az", label: "А→Я" },
  { value: "sum", label: "По сумме" },
];

/**
 * Панель «Все фильтры» на узких экранах: категория, статус, поставщик,
 * черновики и сортировка в нижней шторке — так же, как в тулбарах материалов,
 * контактов и проектов.
 *
 * На узких экранах в тулбаре остаётся только поиск с кнопкой: четыре контрола
 * не помещаются в одну строку и переезжают сюда. На широких экранах шторка не
 * рендерится вовсе — те же контролы стоят прямо в тулбаре (`spec-builder.tsx`),
 * поэтому подписи и счётчики живут в `layout/spec-filter-controls.tsx`, а не
 * дублируются здесь.
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
  /** Позиции проекта — для счётчиков по типам, статусам и поставщикам. */
  items: SpecItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const hasType = filters.activeType !== ALL_CATEGORIES;
  const hasStatus = filters.statusFilter !== null;
  const hasCompany = filters.company !== null;
  const hasSort = filters.sort !== "code";
  const activeCount =
    Number(hasType) + Number(hasStatus) + Number(hasCompany) + Number(hasSort);

  const typeCounts = useMemo(() => specTypeCounts(items), [items]);
  const draftCount = useMemo(() => countDrafts(items), [items]);

  // Пустые типы не показываем (как и чипсы), кроме выбранного: иначе на
  // устаревшем значении из URL селект показывал бы «Все категории».
  const typeOptions = useMemo<FilterSelectOption<string>[]>(
    () => [
      { value: null, label: `${ALL_CATEGORIES} (${items.length})` },
      ...TYPE_ORDER.filter(
        (type) => (typeCounts[type] ?? 0) > 0 || type === filters.activeType,
      ).map((type) => ({
        value: type,
        label: `${type} (${typeCounts[type] ?? 0})`,
      })),
    ],
    [items.length, typeCounts, filters.activeType],
  );

  return (
    <>
      <Button
        variant="secondary"
        className={cn("h-10 shrink-0 gap-2 border border-border", className)}
        aria-label={
          activeCount > 0
            ? `Все фильтры, активно ${activeCount}`
            : "Все фильтры"
        }
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="size-4" />
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
            <SheetTitle>Все фильтры</SheetTitle>
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
              <SpecStatusSelect
                filters={filters}
                items={items}
                side="top"
                className="w-full"
              />
            </FilterField>

            <FilterField label="Поставщик">
              <SpecSupplierSelect
                filters={filters}
                items={items}
                side="top"
                className="w-full"
              />
            </FilterField>

            {/* Галочка несёт собственную подпись, поэтому поле — `div`:
                вложенный `<label>` невалиден. */}
            <FilterField
              as="div"
              label="Черновики"
              hint={
                draftCount > 0
                  ? "Позиции со статусом «Не выбрано» — материал ещё не подобран."
                  : "Черновиков нет: во всех позициях материал уже подобран."
              }
            >
              <label className="flex items-center gap-3 text-[13px] text-fg-body">
                <Checkbox
                  checked={filters.draftOnly}
                  disabled={draftCount === 0}
                  onCheckedChange={(checked) =>
                    filters.setDraftOnly(checked === true)
                  }
                />
                Только черновики
              </label>
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
                filters.setCompany(null);
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
