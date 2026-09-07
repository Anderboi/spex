"use client";

import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { PROCUREMENT_FLOW } from "@/lib/constants";
import { priceOf } from "@/lib/spec/pricing";
import type { SpecBuilderContext } from "@/hooks/use-spec-builder";
import { fmt, fmtQty, cn } from "@/lib/utils";
import { Drawer, DrawerContent, DrawerHeader } from '../ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';

export function ProcureModal({
  ctx,
  onClose,
}: {
  ctx: SpecBuilderContext;
  onClose: () => void;
}) {
  const {
    scopeSum,
    scopeCount,
    deliveredPct,
    procurement,
    picking,
    pickingCount,
    pickingSum,
    replace,
  } = ctx.stats;

    const isMobile = useIsMobile();
    
  if (scopeCount === 0) {
    return (
      <Drawer
        swipeDirection={isMobile ? "down" : "right"}
        open
        onOpenChange={(v) => !v && onClose()}
      >
        <DrawerContent className="sm:max-w-190">
          <div className="py-12 text-center">
            <p className="text-lg font-semibold">Закупка ещё не началась</p>
            <p className="mt-2 text-[14px] text-fg-muted">
              Как только позиции получат статус «Согласовано», они появятся
              <br />в воронке закупки и поставки.
            </p>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  const bars = PROCUREMENT_FLOW.map((s) => {
    const pct = scopeSum ? (procurement[s].sum / scopeSum) * 100 : 0;
    return { status: s, width: `${pct}%`, color: SPEC_STATUS_CONFIG[s].dot };
  }).filter((b) => parseFloat(b.width) > 0);

  return (
    <Drawer
      swipeDirection={isMobile ? "down" : "right"}
      showSwipeHandle={isMobile}
      open
      onOpenChange={(v) => !v && onClose()}
    >
      <DrawerContent className="flex @container flex-col bg-bg gap-0 p-0 overflow-hidden max-w-225 sm:w-170 sm:max-w-[90vw]">
        {/* ── шапка ───────────────────────────────────── */}
        <DrawerHeader className="flex items-start justify-between border-b border-border-subtle p-4">
          <span className="font-mono text-[12px] uppercase tracking-[.1em] text-fg-dim">
            Закупка и поставка
          </span>
        </DrawerHeader>

        {/* ── контент ─────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {/* прогресс */}
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[clamp(24px,4vw,34px)] font-bold leading-none tracking-[-.02em]">
                {deliveredPct}%
              </p>
              <p className="mt-1.5 text-[14px] text-fg-secondary">
                {ctx.stats.deliveredCount} из {scopeCount} позиций доставлено
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-[.1em] text-fg-dim">
                Сумма в закупке
              </p>
              <p className="mt-1 text-[20px] font-bold tracking-[-.01em]">
                {fmt(scopeSum)} ₽
              </p>
            </div>
          </div>

          {/* полоса */}
          <div className="mt-4 flex h-3 overflow-hidden rounded-lg bg-bg-select">
            {bars.map((b) => (
              <div
                key={b.status}
                style={{ width: b.width, background: b.color }}
              />
            ))}
          </div>

          {/* стадии */}
          {PROCUREMENT_FLOW.map((s) => {
            const stage = procurement[s];
            if (stage.count === 0) return null;
            const config = SPEC_STATUS_CONFIG[s];

            return (
              <div key={s} className="mt-6">
                <div className="flex items-center justify-between border-b border-fg pb-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className={cn("size-2.5 rounded-full", config.dot)} />
                    <div>
                      <p className="text-[15.5px] font-bold tracking-[-.01em]">
                        {config.label}{" "}
                        <span className="font-mono text-[11px] font-medium text-fg-dim">
                          · {stage.count}
                        </span>
                      </p>
                      {config.sub && (
                        <p className="font-mono text-[10.5px] tracking-[.02em] text-fg-dim">
                          {config.sub}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-[13px] font-semibold tabular-nums">
                    {fmt(stage.sum)} ₽
                  </span>
                </div>

                {stage.items.map((it) => {
                  const p = priceOf(it);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => ctx.openDetail(it.id)}
                      className="grid w-full grid-cols-[56px_minmax(120px,1.6fr)_116px_116px] items-center gap-3 border-b border-border-muted py-2.5 text-left transition-colors hover:bg-bg-select"
                    >
                      <span className="font-mono text-[12px] font-medium text-fg-secondary">
                        {it.code}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold">
                          {it.name}
                        </p>
                        {it.brand && (
                          <p className="font-mono text-[10.5px] text-fg-dim">
                            {it.brand}
                          </p>
                        )}
                      </div>
                      <span className="font-mono text-[12.5px] text-right text-fg-secondary tabular-nums">
                        {fmtQty(p.qtyFinal)} {it.unit} × {fmt(p.priceFinal)}
                      </span>
                      <span className="text-right text-[15px] font-bold tabular-nums">
                        {fmt(p.total)} ₽
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* требуют замены */}
          {replace.count > 0 && (
            <div className="mt-6 rounded-xl border border-border-red bg-bg-red-light p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-full bg-fg-red" />
                  <span className="text-[14.5px] font-bold text-fg-red">
                    Требуют замены · {replace.count}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    ctx.filters.setStatusFilter("replace");
                    onClose();
                  }}
                  className="whitespace-nowrap text-[13px] font-semibold text-fg-red hover:underline"
                >
                  Открыть в списке →
                </button>
              </div>
              {replace.items.slice(0, 3).map((it) => {
                const p = priceOf(it);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => ctx.openDetail(it.id)}
                    className="mt-2 flex w-full items-center gap-3 text-left"
                  >
                    <span className="font-mono text-[11.5px] font-medium text-fg-red">
                      {it.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg-dim-text">
                      {it.name}
                    </span>
                    <span className="font-mono text-[11.5px] tabular-nums text-fg-dim-text">
                      {fmt(p.total)} ₽
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* в подборе */}
          {pickingCount > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border-muted bg-bg-card px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="size-2 rounded-full bg-fg-dim" />
                <span className="text-[13.5px] text-fg-secondary">
                  Ещё в подборе · {pickingCount}
                </span>
              </div>
              <span className="font-mono text-[12px] text-fg-dim tabular-nums">
                {fmt(pickingSum)} ₽ · до закупки
              </span>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
