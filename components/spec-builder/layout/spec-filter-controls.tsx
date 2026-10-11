"use client";

import { useMemo } from "react";
import {
  FilterSelect,
  type FilterSelectOption,
} from "@/components/layout/filter-select";
import { SPEC_STATUSES, type SpecStatus } from "@/lib/constants";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import {
  countDrafts,
  specStatusCounts,
  specSupplierOptions,
} from "@/lib/spec/list-filters";
import { cn } from "@/lib/utils";
import type { SpecFilters } from "@/hooks/use-spec-filters";
import type { SpecItem } from "@/lib/types";

const ALL_STATUSES = "Все статусы";
const ALL_SUPPLIERS = "Все поставщики";

/**
 * Контролы фильтров спецификации: статус, поставщик и «черновики».
 *
 * Один компонент на два места — тулбар на широких экранах и шторку на узких:
 * в тулбаре `side="bottom"`, в шторке `side="top"` (под триггером места нет).
 * Подписи пунктов, счётчики и разбор значений из URL живут здесь, а не
 * дублируются в двух разметках.
 */
type SpecFilterControlProps = {
  filters: SpecFilters;
  /** Позиции проекта: по ним считаются счётчики пунктов. */
  items: SpecItem[];
  /** Сторона открытия попапа: в нижней шторке — `top`. */
  side?: "top" | "bottom";
  className?: string;
};

export function SpecStatusSelect({
  filters,
  items,
  side = "bottom",
  className,
}: SpecFilterControlProps) {
  const counts = useMemo(() => specStatusCounts(items), [items]);

  const options = useMemo<FilterSelectOption<SpecStatus>[]>(
    () => [
      { value: null, label: `${ALL_STATUSES} (${items.length})` },
      ...SPEC_STATUSES.map((status) => ({
        value: status,
        label: `${SPEC_STATUS_CONFIG[status].label} (${counts[status] ?? 0})`,
      })),
    ],
    [items.length, counts],
  );

  return (
    <FilterSelect
      ariaLabel="Статус"
      placeholder={ALL_STATUSES}
      side={side}
      className={cn("shrink-0", className)}
      value={filters.statusFilter}
      onChange={filters.setStatusFilter}
      options={options}
    />
  );
}

export function SpecSupplierSelect({
  filters,
  items,
  side = "bottom",
  className,
}: SpecFilterControlProps) {
  const suppliers = useMemo(() => specSupplierOptions(items), [items]);

  // Активный фильтр из URL может не встретиться в позициях: у последней позиции
  // этого поставщика его сняли, или список сузил другой фильтр. Значение всё
  // равно показываем — иначе оно не видно и его нечем снять (то же правило, что
  // у производителя в библиотеке материалов).
  const stale =
    filters.company && !suppliers.some((s) => s.name === filters.company)
      ? filters.company
      : null;
  const hasOptions = suppliers.length > 0 || Boolean(stale);

  const options = useMemo<FilterSelectOption<string>[]>(
    () => [
      { value: null, label: `${ALL_SUPPLIERS} (${items.length})` },
      ...(stale ? [{ value: stale, label: stale }] : []),
      ...suppliers.map((s) => ({
        value: s.name,
        label: `${s.name} (${s.count})`,
      })),
    ],
    [items.length, suppliers, stale],
  );

  return (
    <FilterSelect
      ariaLabel="Поставщик"
      // Пустой фильтр объясняет причину, а не выглядит «незагруженным»:
      // пунктов нет, поэтому подпись берётся из placeholder.
      placeholder={hasOptions ? ALL_SUPPLIERS : "Поставщики не указаны"}
      side={side}
      className={cn("shrink-0", className)}
      disabled={!hasOptions}
      value={filters.company}
      onChange={filters.setCompany}
      options={hasOptions ? options : []}
    />
  );
}

/**
 * «Черновики» — быстрый фильтр позиций со статусом «Не выбрано» (`draft`):
 * материал ещё не подобран. Отдельного измерения здесь нет: кнопка — псевдоним
 * статуса (`setDraftOnly` в `use-spec-filters`), поэтому тот же выбор виден и в
 * селекте статусов, а противоречивых фильтров в URL не бывает.
 *
 * Пустой фильтр не показываем — как пустые категории в чипсах типов:
 * «Черновики (0)» обещали бы позиции, которых нет.
 */
export function SpecDraftsToggle({
  filters,
  items,
  className,
}: SpecFilterControlProps) {
  const count = useMemo(() => countDrafts(items), [items]);
  if (count === 0 && !filters.draftOnly) return null;

  return (
    <button
      type="button"
      aria-pressed={filters.draftOnly}
      onClick={() => filters.setDraftOnly(!filters.draftOnly)}
      className={cn(
        "flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors",
        filters.draftOnly
          ? "border-fg-brand bg-bg-brand font-semibold"
          : "border-border-muted text-fg-secondary",
        className,
      )}
    >
      Черновики
      <span className="text-[11px] opacity-60">{count}</span>
    </button>
  );
}
