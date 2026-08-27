import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { priceOf } from "@/lib/spec/pricing";
import { fmt, fmtQty, cn } from "@/lib/utils";
import { SpecItem } from "@/lib/types";

export function SummaryItemRow({
  item,
  clientView = false,
}: {
  item: SpecItem;
  clientView?: boolean;
}) {
  const p = priceOf(item);
  const status = SPEC_STATUS_CONFIG[item.status];

  return (
    <>
      {/* ── таблица: только на широком контейнере ─────────── */}
      <div
        className={cn(
          "hidden items-center gap-3 border-b border-border-muted py-2.5 text-[13.5px] @[600px]:grid print:grid",
          clientView
            ? "grid-cols-[minmax(140px,1.6fr)_78px_100px_120px]"
            : "grid-cols-[48px_minmax(120px,1.4fr)_60px_84px_96px_96px]",
        )}
      >
        {!clientView && (
          <span className="font-mono text-[11.5px] text-fg-secondary">
            {item.code}
          </span>
        )}

        <span className="min-w-0 flex flex-col items-start truncate font-semibold">
          {item.name}
          {item.brand && (
            <span className="font-mono text-[10.5px] font-normal text-fg-dim">
              {item.brand}
            </span>
          )}
          <span className="truncate text-[12.5px] text-fg-secondary">
            {item.spec || "—"}
          </span>
        </span>

        <span className="text-right font-mono text-[12.5px] tabular-nums">
          {fmtQty(p.qtyFinal)} {item.unit}
        </span>

        <span className="text-right font-mono text-[12.5px] tabular-nums text-fg-secondary">
          {fmt(p.priceFinal)}
        </span>

        <span className="text-right text-[14px] font-bold tabular-nums">
          {fmt(p.total)} ₽
        </span>

        {!clientView && (
          <span className="flex items-center justify-end gap-2">
            <span className={cn("size-1.5 rounded-full", status.dot)} />
            <span className="whitespace-nowrap text-[11.5px] text-fg-secondary">
              {status.label}
            </span>
          </span>
        )}
      </div>

      {/* ── карточка: узкий контейнер ─────────────────────── */}
      <div className="border-b border-border-muted py-3 @[600px]:hidden print:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-baseline gap-2">
              {!clientView && (
                <span className="flex-none font-mono text-[11px] text-fg-secondary">
                  {item.code}
                </span>
              )}
              <span className="truncate text-[14px] font-semibold">
                {item.name}
              </span>
            </p>
            {(item.brand || item.spec) && (
              <p className="mt-0.5 truncate font-mono text-[10.5px] text-fg-dim">
                {[item.brand, item.spec].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <span className="flex-none text-right text-[15px] font-bold tabular-nums">
            {fmt(p.total)} ₽
          </span>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span className="font-mono text-[11.5px] text-fg-secondary tabular-nums">
            {fmtQty(p.qtyFinal)} {item.unit} × {fmt(p.priceFinal)} ₽
          </span>
          {!clientView && (
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", status.dot)} />
              <span className="whitespace-nowrap text-[11px] text-fg-secondary">
                {status.label}
              </span>
            </span>
          )}
        </div>
      </div>
    </>
  );
}
