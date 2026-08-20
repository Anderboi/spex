"use client";

import { memo } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { SpecRow, type SpecRowHandlers } from "./spec-row";
import { fmt, plural, cn } from "@/lib/utils";
import { SpecItem } from '@/lib/types';
import { SpecCard } from './spec-card';

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
              "size-4 text-fg-muted transition-transform",
              collapsed && "-rotate-90",
            )}
          />
          <span className="font-heading text-[16px] font-semibold">{type}</span>
          <span className="text-[13px] text-fg-muted">
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
