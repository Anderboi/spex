"use client";

import { useRef, useState } from "react";
import { cn, fmt, plural } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { SpecBuilderContext } from "@/hooks/use-spec-builder";
import {
  ChevronUp,
  ListChecks,
  MoreHorizontal,
  Trash2,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { SPEC_STATUSES } from "@/lib/constants";

/** Текстовая кнопка массового действия (десктопная строка). */
const barButton =
  "flex h-9 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[13px]";

/** Иконочная кнопка (мобильная строка): 36×36 — палец попадает без промаха. */
const iconButton =
  "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-muted transition-colors";

/** Строка действия в нижней шторке. */
const sheetAction =
  "flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[14.5px] font-medium transition-colors hover:bg-bg-select active:bg-bg-select";

/**
 * Нижняя панель спецификации: итоги проекта без выделения и массовые действия
 * при выделении.
 *
 * Высота панели не зависит от состояния: на телефоне это всегда одна строка
 * (60px). Второстепенные массовые действия (монтаж, доставка, статус, «выбрать
 * все видимые») уезжают в нижнюю шторку по кнопке «…» — тот же приём, что в
 * `spec-filter-sheet.tsx` и `materials-filter-sheet.tsx`: раскладывать панель в
 * колонку нельзя, она съедала треть экрана и перекрывала список.
 *
 * На широких экранах (`sm`) всё остаётся в одну строку с подписями — там места
 * хватает и лишний тап не нужен.
 */
export default function BottomBar({ ctx }: { ctx: SpecBuilderContext }) {
  const selCount = ctx.selectedItems.length;
  const selSum = ctx.selectedItems.reduce((s, i) => s + i.qty * i.price, 0);
  const [actionsOpen, setActionsOpen] = useState(false);
  /** Действие, отложенное до конца анимации закрытия шторки. */
  const pendingAction = useRef<(() => void) | null>(null);

  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" || isMobile;

  /**
   * Действие из шторки: закрываем её и выполняем после анимации
   * (`onOpenChangeComplete`) — иначе следующая модалка монтируется поверх ещё
   * не размонтированной шторки и фокус возвращается на кнопку «…».
   */
  const runFromSheet = (action: () => void) => {
    pendingAction.current = action;
    setActionsOpen(false);
  };

  const handleOpenChangeComplete = (open: boolean) => {
    // Шторку открыли заново, пока шла анимация закрытия, — отложенное действие
    // отменяем, иначе оно выстрелит при следующем закрытии.
    if (open) {
      pendingAction.current = null;
      return;
    }
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  };

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
            {/* ── телефон: одна строка, второстепенное — в шторке ── */}
            <div className="flex w-full items-center gap-1.5 sm:hidden">
              <button
                type="button"
                onClick={ctx.clearSelection}
                aria-label="Снять выделение"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-bg-select/15"
              >
                <X className="size-4" />
              </button>

              {/* Счётчик и сумма — двумя строками: сумма не обрезается на
                  узких экранах, а высота строки остаётся прежней. */}
              <div
                className="min-w-0 flex-1"
                role="status"
                aria-live="polite"
                aria-label={`Выбрано позиций: ${selCount}, на сумму ${fmt(selSum)} рублей`}
              >
                <p className="truncate text-[13px] font-semibold leading-tight">
                  Выбрано: {selCount}
                </p>
                <p className="truncate font-mono text-[12px] tabular-nums leading-tight text-bg/70">
                  {fmt(selSum)} ₽
                </p>
              </div>

              <button
                type="button"
                onClick={ctx.openBulkDelete}
                aria-label="Удалить выбранные"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg-red text-bg-delete transition-colors hover:bg-bg-red/85"
              >
                <Trash2 className="size-4" />
              </button>

              <button
                type="button"
                onClick={() => setActionsOpen(true)}
                aria-label="Ещё действия"
                aria-haspopup="dialog"
                aria-expanded={actionsOpen}
                className={cn(iconButton, "hover:bg-bg-select/15")}
              >
                <MoreHorizontal className="size-4" />
              </button>
            </div>

            {/* ── широкие экраны: как было, всё в одну строку с подписями ── */}
            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={ctx.clearSelection}
                aria-label="Снять выделение"
                className="flex size-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-bg-select/15"
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

            <div className="hidden items-center gap-2 sm:ml-auto sm:flex sm:flex-nowrap">
              <button
                type="button"
                onClick={() => ctx.openServiceOperation("installation")}
                className={barButton}
              >
                <Wrench className="size-3.5" /> Монтаж
              </button>
              <button
                type="button"
                onClick={() => ctx.openServiceOperation("delivery")}
                className={barButton}
              >
                <Truck className="size-3.5" /> Доставка
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(barButton, "aria-expanded:bg-bg-select/15")}
                >
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

            {/* Нижняя шторка: второстепенные действия на телефоне. Рендерится
                всегда, но открыть её можно только мобильной кнопкой «…». */}
            <Sheet
              open={actionsOpen}
              onOpenChange={setActionsOpen}
              onOpenChangeComplete={handleOpenChangeComplete}
            >
              <SheetContent
                side="bottom"
                className="gap-0 border-t border-border bg-bg-card p-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              >
                <SheetHeader className="border-b border-border-subtle p-4 pr-12">
                  <SheetTitle className="text-[15px]">
                    Выбрано: {selCount} · {fmt(selSum)} ₽
                  </SheetTitle>
                </SheetHeader>

                <div className="flex flex-col gap-1 p-3">
                  <button
                    type="button"
                    onClick={() => runFromSheet(ctx.toggleSelectAll)}
                    className={sheetAction}
                  >
                    <ListChecks className="size-4 shrink-0 text-fg-muted" />
                    {ctx.allVisibleSelected
                      ? "Снять выделение со всех"
                      : "Выбрать все видимые"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      runFromSheet(() =>
                        ctx.openServiceOperation("installation"),
                      )
                    }
                    className={sheetAction}
                  >
                    <Wrench className="size-4 shrink-0 text-fg-muted" />
                    Монтаж
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      runFromSheet(() => ctx.openServiceOperation("delivery"))
                    }
                    className={sheetAction}
                  >
                    <Truck className="size-4 shrink-0 text-fg-muted" />
                    Доставка
                  </button>

                  {/* Статусы — сразу списком, без вложенного меню: на телефоне
                      так короче на один тап и видно все варианты. */}
                  <div className="px-1 pt-1">
                    <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
                      Статус
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {SPEC_STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => runFromSheet(() => ctx.bulkStatus(s))}
                          className="flex h-9 items-center gap-1.5 rounded-full border border-border-muted bg-bg-card2 px-3 text-[13px] transition-colors hover:bg-bg-select"
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              SPEC_STATUS_CONFIG[s].dot,
                            )}
                          />
                          {SPEC_STATUS_CONFIG[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </>
        )}
      </div>
    </div>
  );
}
