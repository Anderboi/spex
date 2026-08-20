"use client";

import { cn, fmt, plural } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { SpecBuilderContext } from '@/hooks/use-spec-builder';
import { ChevronUp, ListChecks, Trash2, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { SPEC_STATUS_CONFIG } from '@/lib/spec/status';
import { SPEC_STATUSES } from '@/lib/constants';

interface BottomBarProps {
  totalCount: number;
  totalSum: string;
  selectionActive: boolean;
  selCount: number;
  selSumStr: string;
  allVisibleSelected: boolean;
  visIds: string[];
  selected: Record<string, boolean>;
  bulkMenuOpen: boolean;
  setBulkMenuOpen: (v: boolean) => void;
  onClearSel: () => void;
  onSelectAllVisible: () => void;
  onBulkDelete: () => void;
  bulkStatus: (s: string) => void;
}

export default function BottomBar({ ctx }: { ctx: SpecBuilderContext }) {
  const selCount = ctx.selectedItems.length;
  const selSum = ctx.selectedItems.reduce((s, i) => s + i.qty * i.price, 0);
  
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" || isMobile;

  return (
    <div
      style={{
        left: isCollapsed ? "0px" : "var(--sidebar-width, 0px)",
      }}
      className="fixed left-0 right-0 bottom-0  transition-all duration-200 ease-in-out z-40 flex justify-center px-[clamp(16px,4vw,48px)] pb-[clamp(16px,3vw,28px)] pointer-events-none"
    >
      <div className="w-full max-w-295 flex items-center justify-between gap-4 bg-bg-accent text-bg rounded-[16px] py-4 px-[clamp(18px,3vw,30px)] pointer-events-auto shadow-[0_18px_50px_rgba(27,26,23,.28)]">
        {selCount === 0 ? (
          <>
            <div className="min-w-0">
              <p className="text-[12px] uppercase tracking-wider text-fg-muted">
                Итого
              </p>
              <p className="font-mono text-[18px] font-semibold tabular-nums">
                {fmt(ctx.stats.totalSum)} ₽
              </p>
            </div>
            <p className="ml-auto text-[13px] text-fg-muted">
              {ctx.stats.totalCount}{" "}
              {plural(ctx.stats.totalCount, "позиция", "позиции", "позиций")}
              {ctx.stats.placeholders > 0 &&
                ` · ${ctx.stats.placeholders} не заполнено`}
            </p>
            <button
              type="button"
              onClick={ctx.openProcure}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[13px]"
            >
              <ListChecks className="size-4" /> Закупка
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={ctx.clearSelection}
              aria-label="Снять выделение"
              className="flex size-8 items-center justify-center rounded-md hover:bg-bg-select"
            >
              <X className="size-4" />
            </button>

            <div className="min-w-0">
              <p className="text-[13px] font-semibold">
                Выбрано: {selCount} · {fmt(selSum)} ₽
              </p>
              <button
                type="button"
                onClick={ctx.toggleSelectAll}
                className="text-[12px] text-fg-brand hover:underline"
              >
                {ctx.allVisibleSelected ? "Снять всё" : "Выбрать все видимые"}
              </button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex h-9 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[13px]">
                  Статус <ChevronUp className="size-3.5 opacity-60" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  side="top"
                  className="w-52 bg-bg-card"
                >
                  {SPEC_STATUSES.map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onClick={() => ctx.bulkStatus(s)}
                      className="gap-2 text-[13px]"
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          SPEC_STATUS_CONFIG[s].dot,
                        )}
                      />
                      {SPEC_STATUS_CONFIG[s].label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                type="button"
                onClick={ctx.openBulkDelete}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-bg-red px-3 text-[13px] font-semibold text-bg-delete"
              >
                <Trash2 className="size-3.5" /> Удалить
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
