"use client";

import { cn, fmt, plural } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { SpecBuilderContext } from "@/hooks/use-spec-builder";
import { ChevronUp, ListChecks, Trash2, Truck, Wrench, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { SPEC_STATUSES } from "@/lib/constants";

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
      className="fixed left-0 right-0 bottom-0  transition-all duration-200 ease-in-out z-40 flex justify-center px-[clamp(16px,4vw,48px)] pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none sm:pb-[clamp(16px,3vw,28px)]"
    >
      <div
        className={cn(
          "w-full max-w-295 flex items-center gap-3 bg-bg-accent text-bg rounded-[16px] py-3 px-[clamp(16px,3vw,30px)] pointer-events-auto shadow-[0_18px_50px_rgba(27,26,23,.28)] sm:gap-4 sm:py-4",
          // Массовые действия не помещаются в одну строку на телефоне —
          // раскладываем панель в колонку, кнопки переносятся во вторую строку.
          selCount > 0 &&
            "flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        )}
      >
        {selCount === 0 ? (
          <>
            <button
              type="button"
              onClick={ctx.openProcure}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[13px]"
            >
              <ListChecks className="size-4" /> Закупка
            </button>
            {/* На телефоне в панели остаётся только итог: описание и
                расшифровка суммы скрыты, чтобы строки не наезжали друг на друга. */}
            <p className="hidden min-w-0 truncate text-[13px] text-fg-muted sm:block">
              {ctx.stats.totalCount}{" "}
              {plural(ctx.stats.totalCount, "позиция", "позиции", "позиций")}
              {ctx.stats.placeholders > 0 &&
                ` · ${ctx.stats.placeholders} не заполнено`}
            </p>

            <div className="ml-auto flex shrink-0 flex-col items-end">
              <p className="hidden items-baseline gap-2 whitespace-nowrap sm:flex">
                <span className="font-mono text-[12px] tabular-nums text-fg-secondary">
                  {fmt(ctx.stats.totalSum)} ₽ + {fmt(ctx.servicesTotal)} ₽
                </span>
              </p>
              <p className="flex items-baseline gap-2 whitespace-nowrap">
                <span className="text-[11px] uppercase tracking-wider text-fg-secondary">
                  Итого
                </span>
                <span className="font-mono text-[18px] font-semibold tabular-nums sm:text-[20px]">
                  {fmt(ctx.projectTotal)} ₽
                </span>
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
              <button
                type="button"
                onClick={ctx.clearSelection}
                aria-label="Снять выделение"
                className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-bg-select"
              >
                <X className="size-4" />
              </button>

              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">
                  Выбрано: {selCount} · {fmt(selSum)} ₽
                </p>
                <button
                  type="button"
                  onClick={ctx.toggleSelectAll}
                  className="truncate text-[12px] text-fg-brand hover:underline"
                >
                  {ctx.allVisibleSelected ? "Снять всё" : "Выбрать все видимые"}
                </button>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
              <button
                type="button"
                onClick={() => ctx.openServiceOperation("installation")}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[13px]"
              >
                <Wrench className="size-3.5" /> Монтаж
              </button>
              <button
                type="button"
                onClick={() => ctx.openServiceOperation("delivery")}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[13px]"
              >
                <Truck className="size-3.5" /> Доставка
              </button>
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
