"use client";

import { useState, useTransition } from "react";
import { FileDown, Printer, X, Share2, Loader2, XIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { SPEC_STATUSES, TYPE_ORDER } from "@/lib/constants";
import { priceOf } from "@/lib/spec/pricing";
import type { SpecBuilderContext } from "@/hooks/use-spec-builder";
import { fmt, fmtQty, cn } from "@/lib/utils";
import {
  exportSpecToExcel,
  generatePublicLink,
  generateSpecPdf,
} from "@/actions/spec-export";
import { ScrollArea } from "../ui/scroll-area";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";

export function SpecSummary({
  ctx,
  project,
  onClose,
}: {
  ctx: SpecBuilderContext;
  project: { title: string; client_name: string | null };
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [linkCopied, setLinkCopied] = useState(false);

  const isMobile = useIsMobile();

  const byStatus = SPEC_STATUSES.map((s) => {
    const items = ctx.items.filter((i) => i.status === s && !i.isPlaceholder);
    const sum = items.reduce((a, i) => a + priceOf(i).total, 0);
    const pct = ctx.stats.totalSum
      ? Math.round((sum / ctx.stats.totalSum) * 100)
      : 0;
    return {
      status: s,
      label: SPEC_STATUS_CONFIG[s].label,
      color: SPEC_STATUS_CONFIG[s].dot,
      count: items.length,
      sum,
      pct,
    };
  }).filter((b) => b.count > 0);

  const byType = TYPE_ORDER.map((type) => {
    const items = ctx.items.filter((i) => i.type === type && !i.isPlaceholder);
    const sum = items.reduce((a, i) => a + priceOf(i).total, 0);
    return { type, items, count: items.length, sum };
  }).filter((g) => g.count > 0);

  const handleExcel = () => {
    startTransition(async () => {
      const res = await exportSpecToExcel(ctx.orgSlug, ctx.projectId);
      if (!res.success) {
        ctx.showToast(res.error);
        return;
      }
      // триггер скачивания
      const a = document.createElement("a");
      a.href = `data:application/vnd.ms-excel;base64,${res.data.base64}`;
      a.download = res.data.filename;
      a.click();
    });
  };

  const handlePdf = () => {
    startTransition(async () => {
      const res = await generateSpecPdf(ctx.orgSlug, ctx.projectId);
      if (!res.success) {
        ctx.showToast(res.error);
        return;
      }
      window.open(`/api/spec-pdf/${res.data.token}`, "_blank");
    });
  };

  const handleShare = () => {
    startTransition(async () => {
      const res = await generatePublicLink(ctx.orgSlug, ctx.projectId);
      if (!res.success) {
        ctx.showToast(res.error);
        return;
      }
      const url = `${location.origin}/share/spec/${res.data.token}`;

      if (navigator.share) {
        await navigator.share({
          title: `${project.title} · Спецификация`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      }
    });
  };

  const handlePrint = () => window.print();

  return (
    <Drawer
      swipeDirection={isMobile ? "down" : "right"}
      showSwipeHandle={isMobile}
      open
      onOpenChange={(v) => !v && onClose()}
    >
      <DrawerContent className="flex //max-h-[90vh] w-120 max-w-225 flex-col bg-bg gap-0 m-0 //p-0 overflow-hidden print:max-h-none print:shadow-none">
        {/* ── шапка ───────────────────────────────────── */}
        <DrawerHeader className="//sticky //top-0 //z-10 flex flex-col items-start //justify-between gap-4 border-b border-border-subtle p-4 print:hidden">
          <DrawerTitle className="font-mono text-[12px] uppercase tracking-widest text-fg-dim">
            Сводка спецификации
          </DrawerTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExcel}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileDown className="size-4" />
              )}
              Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
              disabled={isPending}
            >
              {linkCopied ? (
                "Скопировано"
              ) : (
                <>
                  <Share2 className="size-4" /> Поделиться
                </>
              )}
            </Button>
            <Button size="sm" onClick={handlePdf} disabled={isPending}>
              <Printer className="size-4" /> PDF
            </Button>
            {/* <button
              type="button"
              onClick={onClose}
              className="ml-2 text-[20px]"
              aria-label="Закрыть"
            >
              <X className="size-5" />
            </button> */}
          </div>
          {/* <DrawerClose>
            <XIcon className='size-5'/>
          </DrawerClose> */}
        </DrawerHeader>
        {/* <ScrollArea className="h-[60vh] w-fit"> */}
        {/* ── содержимое ──────────────────────────────── */}

        <div className="//min-h-0 flex-1 overflow-y-auto p-4 print:overflow-visible">
          {/* заголовок */}
          <div className="flex items-end justify-between gap-5 border-b border-fg pb-3 print:break-inside-avoid">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-fg-dim">
                {project.client_name || "Без заказчика"}
              </p>
              <h1 className="mt-2 text-[clamp(28px,5vw,40px)] font-bold leading-none tracking-[-.02em]">
                {project.title}
              </h1>
            </div>
            <div className="text-right font-mono text-[11px] leading-relaxed text-fg-dim">
              <p>Дата · {new Date().toLocaleDateString("ru")}</p>
              <p>
                Позиций · {ctx.items.filter((i) => !i.isPlaceholder).length}
              </p>
            </div>
          </div>

          {/* итого */}
          {/* <div className="mt-6 flex items-baseline justify-between gap-4 print:break-inside-avoid">
            <span className="font-mono text-[11px] uppercase tracking-[.12em] text-fg-dim">
              Итого по спецификации
            </span>
            <span className="text-[clamp(30px,6vw,44px)] font-bold tracking-[-.02em]">
              {fmt(ctx.stats.totalSum)} ₽
            </span>
          </div> */}

          {/* полоса по статусам */}
          <div className="mt-4 flex h-3 overflow-hidden rounded-lg bg-bg-select print:break-inside-avoid">
            {byStatus.map((b) => (
              <div
                key={b.status}
                style={{ width: `${b.pct}%`, background: b.color }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-5 print:break-inside-avoid">
            {byStatus.map((b) => (
              <div key={b.status} className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", b.color)} />
                <span className="text-[13.5px] font-semibold">{b.label}</span>
                <span className="font-mono text-[12px] text-fg-dim tabular-nums">
                  {b.count} · {fmt(b.sum)} ₽ · {b.pct}%
                </span>
              </div>
            ))}
          </div>

          {/* группы */}
          {byType.map((g) => (
            <div key={g.type} className="mt-8 print:break-inside-avoid-page">
              <div className="flex items-center justify-between border-b border-fg pb-2">
                <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[.12em]">
                  {g.type} <span className="text-fg-dim">· {g.count}</span>
                </span>
                <span className="font-mono text-[13px] font-semibold tabular-nums">
                  {fmt(g.sum)} ₽
                </span>
              </div>

              {g.items.map((it) => {
                const p = priceOf(it);
                const config = SPEC_STATUS_CONFIG[it.status];
                return (
                  <div
                    key={it.id}
                    className="grid grid-cols-[56px_minmax(140px,1.5fr)_1fr_78px_92px_110px_118px] items-center gap-3 border-b border-border-muted py-2.5 text-[13.5px]"
                  >
                    <span className="font-mono text-[11.5px] text-fg-secondary">
                      {it.code}
                    </span>
                    <span className="font-semibold">
                      {it.name}{" "}
                      {it.brand && (
                        <span className="font-mono text-[10.5px] font-normal text-fg-dim">
                          {it.brand}
                        </span>
                      )}
                    </span>
                    <span className="text-[12.5px] text-fg-secondary">
                      {it.spec || "—"}
                    </span>
                    <span className="font-mono text-[12.5px] text-right tabular-nums">
                      {fmtQty(p.qtyFinal)} {it.unit}
                    </span>
                    <span className="font-mono text-[12.5px] text-right tabular-nums text-fg-secondary">
                      {fmt(p.priceFinal)}
                    </span>
                    <span className="text-right text-[14px] font-bold tabular-nums">
                      {fmt(p.total)} ₽
                    </span>
                    <span className="flex items-center justify-end gap-2">
                      <span
                        className={cn("size-1.5 rounded-full", config.dot)}
                      />
                      <span className="whitespace-nowrap text-[11.5px] text-fg-secondary">
                        {config.label}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* подвал */}
        <DrawerFooter>
          <div className="mt-2 flex items-end justify-between border-t-2 border-fg pt-4 print:break-inside-avoid">
            <span className="text-[16px] font-mono tracking-[-.01em] text-fg-muted uppercase font-bold">
              Итого
            </span>
            <span className="text-[24px] font-mono font-bold tracking-[-.01em]">
              {fmt(ctx.stats.totalSum)} ₽
            </span>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
