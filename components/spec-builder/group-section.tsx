"use client";

import { memo } from "react";
import { ChevronDown } from "lucide-react";
import { SpecRow, type SpecRowHandlers } from "./spec-row";
import { fmt, plural, cn } from "@/lib/utils";
import { SpecItem } from '@/lib/types';
import { SpecCard } from './spec-card';
import { SpecListRow } from './spec-list-row';
import { SpecCompactCard } from './spec-compact-card';
import {
  SPEC_TABLE_CLASS,
  SPEC_TABLE_MIN_CONTAINER,
  SPEC_TABLE_SCROLL,
  type SpecListLayout,
} from "./spec-table";
import { Checkbox } from '../ui/checkbox';
import type { ServiceOperation } from "@/actions/service-operations";

export const GroupSection = memo(function GroupSection({
  type,
  items,
  allItems,
  sum,
  collapsed,
  onToggle,
  selected,
  layout,
  showServices,
  opsByItem,
  h,
}: {
  type: string;
  items: SpecItem[];
  allItems: SpecItem[];
  sum: number;
  collapsed: boolean;
  onToggle: () => void;
  selected: ReadonlySet<string>;
  /** Раскладка списка: таблица — только когда контейнер её вмещает. */
  layout: SpecListLayout;
  /** Показывать колонку «услуги»: решается по ширине контейнера в spec-builder. */
  showServices: boolean;
  /** Операции доп. расходов, сгруппированные по позициям. */
  opsByItem?: Record<string, ServiceOperation[]>;
  h: SpecRowHandlers;
}) {
  const sectionId = `group-${type}`;

  const groupIds = items.map((i) => i.id);
  const selectedCount = items.reduce(
    (n, i) => n + (selected.has(i.id) ? 1 : 0),
    0,
  );
  const allSelected = items.length > 0 && selectedCount === items.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <section className="mt-6">
      <div className="flex items-center gap-3 border-b border-fg pb-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls={sectionId}
          className="flex items-center gap-2 text-left"
        >
          <ChevronDown
            className={cn(
              "size-3 text-fg-muted transition-transform",
              collapsed && "-rotate-90",
            )}
          />
          <span className="font-mono text-[13px] tracking-wide uppercase font-semibold">
            {type}
          </span>
          <span className="text-[11px] border border-border-muted rounded-full px-2 py-0.5 text-fg-muted">
            {items.length}{" "}
            {plural(items.length, "позиция", "позиции", "позиций")}
          </span>
        </button>

        <span className="ml-auto font-mono text-[13.5px] font-semibold tabular-nums">
          {sum > 0 ? `${fmt(sum)} ₽` : ""}
        </span>

        {/* <button
          type="button"
          onClick={onAddPlaceholder}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[12.5px] text-fg-secondary hover:bg-bg-card"
        >
          <Plus className="size-3.5" /> Пустая марка
        </button> */}
      </div>

      {!collapsed && (
        <div id={sectionId}>
          {layout === "table" ? (
            <div
              // `overflow-x-auto` — страховка: если таблица всё же шире
              // контейнера (зум, крупный минимальный шрифт), её прокручивают,
              // а не теряют колонку наименования. Фокусируемая область нужна,
              // чтобы до правых колонок можно было добраться с клавиатуры.
              role="region"
              aria-label={`${type} — таблица позиций`}
              tabIndex={0}
              className={SPEC_TABLE_SCROLL}
            >
              <table
                className={SPEC_TABLE_CLASS}
                // min-width вместо класса: значение обязано совпадать с
                // SPEC_TABLE_MIN_CONTAINER, иначе таблица либо появится
                // раньше, чем влезает, либо получит постоянный скролл.
                style={{ minWidth: SPEC_TABLE_MIN_CONTAINER }}
              >
                <caption className="sr-only">
                  {type} — позиции спецификации
                </caption>
                <thead className="text-[10px] font-mono text-fg-muted uppercase border-b border-border-muted">
                  <tr>
                    <th className="w-6 p-2 text-left">
                      <Checkbox
                        className="border-border border-2 data-indeterminate:bg-primary/50 data-indeterminate:text-fg-body"
                        checked={allSelected}
                        indeterminate={someSelected}
                        onCheckedChange={() => h.onToggleSelGroup(groupIds)}
                        aria-label={`Выбрать все позиции типа ${type}`}
                      />
                    </th>
                    <th className="w-20 p-2 text-left">изобр</th>
                    <th className="w-14 p-2 text-left">марка</th>
                    {/* Наименование — единственная колонка без своей ширины:
                        весь остаток контейнера достаётся ей, а «пол» задаёт
                        min-width самой таблицы (см. spec-table.tsx). */}
                    <th className="w-auto p-2 text-left">наименование</th>
                    {/* Необязательная колонка: флаг приходит из spec-builder,
                        разметка `th` и `td` включается одним и тем же
                        значением, поэтому шапка не разъедется с телом. */}
                    {showServices && (
                      <th className="w-24 p-2 text-left">услуги</th>
                    )}
                    <th className="w-34 p-2 text-left">кол-во</th>
                    <th className="w-28 p-2 text-left">цена</th>
                    <th className="w-28 p-2 text-right">итого</th>
                    <th className="w-34 p-2 text-left">Статус</th>
                    <th className="w-12 p-2 text-left"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <SpecRow
                      key={it.id}
                      item={it}
                      allItems={allItems}
                      selected={selected.has(it.id)}
                      showServices={showServices}
                      ops={opsByItem?.[it.id]}
                      h={h}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : layout === "list" ? (
            <div className="flex flex-col">
              {items.map((it) => (
                <SpecListRow
                  key={it.id}
                  item={it}
                  allItems={allItems}
                  selected={selected.has(it.id)}
                  ops={opsByItem?.[it.id]}
                  h={h}
                />
              ))}
            </div>
          ) : layout === "compact" ? (
            <div className="flex flex-col gap-2 pt-2">
              {items.map((it) => (
                <SpecCompactCard
                  key={it.id}
                  item={it}
                  allItems={allItems}
                  selected={selected.has(it.id)}
                  ops={opsByItem?.[it.id]}
                  h={h}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2 pt-2">
              {items.map((it) => (
                <SpecCard
                  key={it.id}
                  item={it}
                  allItems={allItems}
                  selected={selected.has(it.id)}
                  ops={opsByItem?.[it.id]}
                  h={h}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
});
