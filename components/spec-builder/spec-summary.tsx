"use client";

import { useState, useTransition } from "react";
import {
  FileDown,
  Printer,
  X,
  Share2,
  Loader2,
  EyeOff,
  Eye,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { SPEC_STATUSES, TYPE_ORDER } from "@/lib/constants";
import { priceOf } from "@/lib/spec/pricing";
import type { SpecBuilderContext } from "@/hooks/use-spec-builder";
import { fmt, cn } from "@/lib/utils";
import {
  exportSpecToExcel,
  generatePublicLink,
  generateSpecPdf,
} from "@/actions/spec-export";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { SummaryItemRow } from "./summary-item-row";

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
  const [clientView, setClientView] = useState(false);

  const isMobile = useIsMobile();

  const [busy, setBusy] = useState<null | "excel" | "pdf" | "share">(null);

  const run = (kind: "excel" | "pdf" | "share", fn: () => Promise<void>) => {
    setBusy(kind);
    startTransition(async () => {
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    });
  };

  const byStatus = SPEC_STATUSES.map((s) => {
    const items = ctx.items.filter((i) => i.status === s && !i.isPlaceholder);
    const sum = items.reduce((a, i) => a + priceOf(i).total, 0);
    const pct = ctx.stats.totalSum
      ? Math.round((sum / ctx.stats.totalSum) * 100)
      : 0;
    return {
      status: s,
      label: SPEC_STATUS_CONFIG[s].label,
      dot: SPEC_STATUS_CONFIG[s].dot,
      color: SPEC_STATUS_CONFIG[s].bar,
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

  const handleExcel = () =>
    run("excel", async () => {
      const res = await exportSpecToExcel(ctx.orgSlug, ctx.projectId, {
        clientView,
      });
      if (!res.success) {
        ctx.showToast(res.error);
        return;
      }
      const bytes = Uint8Array.from(atob(res.data.base64), (c) =>
        c.charCodeAt(0),
      );
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.data.filename;
      a.click();
      URL.revokeObjectURL(url);
    });

  const handlePdf = () =>
    run("pdf", async () => {
      const res = await generateSpecPdf(ctx.orgSlug, ctx.projectId, {
        clientView,
      });
      if (!res.success) {
        ctx.showToast(res.error);
        return;
      }
      window.open(`/api/spec-pdf/${res.data.token}`, "_blank");
    });

  const handleShare = () =>
    run("share", async () => {
      const res = await generatePublicLink(ctx.orgSlug, ctx.projectId, {
        clientView,
      });
      if (!res.success) {
        ctx.showToast(res.error);
        return;
      }
      const url = `${location.origin}/share/spec/${res.data.token}`;
      try {
        if (navigator.share)
          await navigator.share({
            title: `${project.title} · Спецификация`,
            url,
          });
        else throw new Error("no share");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        await navigator.clipboard.writeText(url);
        ctx.showToast(
          `Ссылка скопирована · ${clientView ? "версия для клиента" : "рабочая"} · 7 дней`,
        );
      }
    });

  return (
    <Drawer
      swipeDirection={isMobile ? "down" : "right"}
      showSwipeHandle={isMobile}
      open
      onOpenChange={(v) => !v && onClose()}
    >
      <DrawerContent className="flex w-full max-w-225 @container sm:w-170 sm:max-w-[90vw] flex-col bg-bg gap-0 m-0 overflow-hidden print:max-h-none print:shadow-none">
        {/* ── шапка ───────────────────────────────────── */}
        <DrawerHeader className="flex flex-col items-start gap-4 border-b border-border-subtle p-4 print:hidden">
          <DrawerTitle className="sr-only">
            Сводка спецификации · {project.title}
          </DrawerTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={handleExcel}
              disabled={isPending}
            >
              {busy === "excel" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileDown className="size-4" />
              )}
              Excel
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={handleShare}
              disabled={isPending}
            >
              {linkCopied ? (
                "Скопировано"
              ) : (
                <>
                  {busy === "share" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Share2 className="size-4" />
                  )}{" "}
                  Поделиться
                </>
              )}
            </Button>
            <Button size="lg" onClick={handlePdf} disabled={!!busy}>
              {busy === "pdf" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Printer className="size-4" />
              )}{" "}
              PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setClientView((v) => !v)}
              className={cn(
                clientView
                  ? "border-fg bg-bg-accent text-bg"
                  : "border-border-muted text-fg-secondary hover:border-fg",
              )}
              aria-pressed={clientView}
            >
              {clientView ? (
                <Eye className="size-4" />
              ) : (
                <EyeOff className="size-4" />
              )}
              <span className={cn(isMobile && 'hidden')}>
                {clientView ? "Версия для клиента" : "Рабочая версия"}
              </span>
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
        </DrawerHeader>
        {/* ── содержимое ──────────────────────────────── */}

        <div className=" flex-1 overflow-y-auto p-4 print:overflow-visible">
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
          {/*           {/* итого */}
          {/* <div className="text-right mt-2">
            <p className="font-mono text-[11px] uppercase tracking-widest text-fg-dim">
              Итого
            </p>
            <p className=" font-mono text-[clamp(22px,4vw,32px)] font-bold tabular-nums">
              {fmt(ctx.stats.totalSum)} ₽
            </p>
          </div> */}

          {/* полоса по статусам */}
          {!clientView && byStatus.length > 0 && (
            <>
              <div className="mt-4 flex h-3 overflow-hidden rounded-lg bg-bg-select print:break-inside-avoid">
                {byStatus.map((b) => (
                  <div
                    key={b.status}
                    style={{ width: `${b.pct}%`, background: b.color }}
                  />
                ))}
              </div>
              <div className="mt-3 flex flex-col flex-wrap gap-2 print:break-inside-avoid">
                {byStatus.map((b) => (
                  <div key={b.status} className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", b.dot)} />
                    <span className="text-[13.5px] font-semibold">
                      {b.label}
                    </span>
                    <span className="font-mono text-[12px] text-fg-dim tabular-nums">
                      {b.count} · {fmt(b.sum)} ₽ · {b.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* группы */}
          {byType.map((g) => (
            <div key={g.type} className="mt-6 print:break-inside-avoid-page">
              <div className="flex items-center justify-between border-b border-fg pb-2">
                <span className="font-mono text-[12px] font-semibold uppercase tracking-[.12em]">
                  {g.type} <span className="text-fg-dim">· {g.count}</span>
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  {fmt(g.sum)} ₽
                </span>
              </div>

              {g.items.map((it) => (
                <SummaryItemRow key={it.id} item={it} clientView={clientView} />
              ))}
            </div>
          ))}
        </div>
        {/* подвал */}
        <DrawerFooter className="border-t border-fg">
          <div className="mt-2 flex items-end justify-between border-fg pt-4 print:break-inside-avoid">
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
