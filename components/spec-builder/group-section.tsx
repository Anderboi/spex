"use client";

import { memo } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { SpecRow, type SpecRowHandlers } from "./spec-row";
import { fmt, plural, cn } from "@/lib/utils";
import { SpecItem } from '@/lib/types';
import { SpecCard } from './spec-card';
import { Checkbox } from '../ui/checkbox';

export const GroupSection = memo(function GroupSection({
  type,
  items,
  sum,
  collapsed,
  onToggle,
  onAddPlaceholder,
  selected,
  isDesktop,
  h,
}: {
  type: string;
  items: SpecItem[];
  sum: number;
  collapsed: boolean;
  onToggle: () => void;
  onAddPlaceholder: () => void;
  selected: ReadonlySet<string>;
  isDesktop: boolean;
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
      <div className="flex items-center gap-3 border-b border-border-muted pb-2">
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
          <span className="font-mono text-[13px] uppercase font-semibold">
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

        <button
          type="button"
          onClick={onAddPlaceholder}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[12.5px] text-fg-secondary hover:bg-bg-card"
        >
          <Plus className="size-3.5" /> Пустая марка
        </button>
      </div>

      {!collapsed && (
        <div id={sectionId}>
          {isDesktop ? (
            <table className="w-full table-fixed">
              <caption className="sr-only">
                {type} — позиции спецификации
              </caption>
              <thead className="text-[10px] table-fixed font-mono text-fg-muted uppercase border-b border-border-muted //p-2">
                <tr>
                  <th className="text-left w-10 px-3 py-2">
                    <Checkbox
                      className="border-border border-2 data-indeterminate:bg-primary/50 data-indeterminate:text-primary-foreground"
                      checked={allSelected}
                      indeterminate={someSelected}
                      onCheckedChange={() => h.onToggleSelGroup(groupIds)}
                      aria-label={`Выбрать все позиции типа ${type}`}
                    />
                  </th>
                  <th className="text-left w-13 p-2">избр</th>
                  <th className="text-left w-1/14 p-2">марка</th>
                  <th className="text-left w-1/4 p-2">наименование</th>
                  <th className="text-right w-1/8 p-2">кол-во</th>
                  <th className="text-right w-1/7 p-2">цена</th>
                  <th className="text-right w-1/7 p-2">итого</th>
                  <th className="text-left w-1/6 p-2">Статус</th>
                  <th className="text-left w-13 p-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <SpecRow
                    key={it.id}
                    item={it}
                    selected={selected.has(it.id)}
                    h={h}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col gap-2 pt-2">
              {items.map((it) => (
                <SpecCard
                  key={it.id}
                  item={it}
                  selected={selected.has(it.id)}
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
