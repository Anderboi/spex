import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { priceOf } from "@/lib/spec/pricing";
import { fmt, fmtQty, cn } from "@/lib/utils";
import { SpecItem } from "@/lib/types";
import type { SpecSummaryCompositionNode } from "@/lib/spec/summary-composition";

export function SummaryItemRow({
  item,
  clientView = false,
  composition,
}: {
  item: SpecItem;
  clientView?: boolean;
  /** Состав позиции (уже собранное дерево) — блок рисуется, если не пуст. */
  composition?: SpecSummaryCompositionNode[] | null;
}) {
  const p = priceOf(item);
  const status = SPEC_STATUS_CONFIG[item.status];
  const nodes = composition && composition.length > 0 ? composition : null;

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

      {/* ── состав позиции ───────────────────────────────── */}
      {nodes && (
        <SummaryCompositionBlock nodes={nodes} clientView={clientView} />
      )}
    </>
  );
}

/** Блок «Состав» под позицией: группы, компоненты и ссылки на SpecItem. */
function SummaryCompositionBlock({
  nodes,
  clientView,
}: {
  nodes: SpecSummaryCompositionNode[];
  clientView: boolean;
}) {
  return (
    <div className="mt-0.5 rounded-lg border border-border-muted bg-bg-card2/40 px-3 py-2 print:mt-1 print:break-inside-avoid print:bg-transparent">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-fg-dim">
        Состав
      </p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {nodes.map((node, i) => (
          <SummaryCompositionRow
            key={`${node.kind}-${i}`}
            node={node}
            clientView={clientView}
          />
        ))}
      </div>
    </div>
  );
}

/** Одна строка дерева состава (группа, компонент или ссылка на позицию). */
function SummaryCompositionRow({
  node,
  clientView,
}: {
  node: SpecSummaryCompositionNode;
  clientView: boolean;
}) {
  if (node.kind === "group") {
    return (
      <div>
        <p className="text-[12.5px] font-bold leading-snug text-fg">
          {node.name}
        </p>
        {node.children.length > 0 ? (
          <div className="ml-3 mt-1 flex flex-col gap-1.5 border-l border-border-muted pl-3">
            {node.children.map((child, i) => (
              <SummaryCompositionRow
                key={`${child.kind}-${i}`}
                node={child}
                clientView={clientView}
              />
            ))}
          </div>
        ) : (
          <p className="ml-3 mt-0.5 text-[12px] text-fg-muted">
            Нет элементов
          </p>
        )}
      </div>
    );
  }

  if (node.kind === "component") {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 break-words text-[12.5px] font-medium leading-snug text-fg">
          {node.name}
        </span>
        {node.cost != null && (
          <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-fg-secondary">
            {fmt(node.cost)} ₽
          </span>
        )}
      </div>
    );
  }

  // kind === "spec_ref": название/код берутся из связанного SpecItem,
  // учитывается только additional_cost (стоимость исходной позиции нет).
  if (!node.available) {
    return (
      <p className="text-[12.5px] font-medium leading-snug text-fg-muted">
        Исходная позиция недоступна
      </p>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 flex-1 break-words text-[12.5px] font-medium leading-snug text-fg">
        {!clientView && node.code && (
          <span className="font-mono text-[11px] text-fg-dim">
            {node.code} ·{" "}
          </span>
        )}
        {node.name}
      </span>
      {node.additional_cost != null && (
        <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-fg-secondary">
          {fmt(node.additional_cost)} ₽ доп.
        </span>
      )}
    </div>
  );
}

