"use client";

import { memo } from "react";
import { Copy, Eraser, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineCode } from "./inline-code";
import { StatusMenu } from "./status-menu";
import { isLocked } from "@/lib/spec/status";
import { fmt, fmtQty } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { SpecStatus } from "@/lib/constants";
import { SpecItem } from "@/lib/types";
import { PriceField } from "./price-field";
import { QtyStepper } from "./qty-stepper";
import { priceOf } from '@/lib/spec/pricing';

export type SpecRowHandlers = {
  onOpen: (id: string) => void;
  onCode: (id: string, code: string) => void;
  onQty: (id: string, delta: number) => void;
  onPrice: (id: string, value: string) => void;
  onStatus: (id: string, s: SpecStatus) => void;
  onToggleSel: (id: string) => void;
  onDuplicate: (id: string) => void;
  onClear: (id: string) => void;
  onDelete: (id: string) => void;
  onShare: (item: SpecItem) => void;
  onFill: (id: string) => void;
};

export const SpecRow = memo(function SpecRow({
  item,
  selected,
  h,
}: {
  item: SpecItem;
  selected: boolean;
  h: SpecRowHandlers;
}) {
  const sum = item.qty * item.price;
  const p = priceOf(item);

  return (
    <tr
      className={cn(
        "group border-b border-border-muted last:border-0 transition-colors hover:bg-bg-card/60",
        selected && "bg-bg-brand/40",
        item.isPlaceholder &&
          "bg-[repeating-linear-gradient(45deg,transparent,transparent_7px,var(--color-bg-card)_7px,var(--color-bg-card)_14px)]",
      )}
    >
      <td className="w-10 px-3 py-2.5">
        <Checkbox
          checked={selected}
          onCheckedChange={() => h.onToggleSel(item.id)}
          aria-label={`Выбрать ${item.code}`}
        />
      </td>
      <td className="w-24 px-2 py-2.5">
        <InlineCode
          code={item.code}
          locked={isLocked(item.status)}
          onCommit={(c) => h.onCode(item.id, c)}
        />
      </td>
      <td className="min-w-0 px-2 py-2.5">
        {item.isPlaceholder ? (
          <button
            type="button"
            onClick={() => h.onFill(item.id)}
            className="text-[14px] font-medium text-fg-muted hover:text-fg-brand hover:underline"
          >
            Позиция не заполнена — выбрать материал
          </button>
        ) : (
          <button
            type="button"
            onClick={() => h.onOpen(item.id)}
            className="block max-w-full text-left"
          >
            <span className="block truncate text-[14px] font-medium text-fg">
              {item.name}
            </span>
            <span className="block truncate text-[12.5px] text-fg-muted">
              {[item.brand, item.article].filter(Boolean).join(" · ") || "—"}
            </span>
          </button>
        )}
      </td>
      <td className="px-3 text-right align-middle">
        <div className="flex flex-col items-end leading-tight">
          <QtyStepper
            qty={p.qtyFinal}
            unit={item.unit}
            editable={false}
            onChange={(d) => h.onQty(item.id, d)}
          />
          {p.hasQtyMod && (
            <span
              className="mt-0.5 font-mono text-[10.5px] text-fg-dim"
              title={`По плану ${fmtQty(p.qtyBase)} ${item.unit}, запас ${item.stockPct}% (+${fmtQty(p.stockQty)})`}
            >
              {fmtQty(p.qtyBase)} +{item.stockPct}%
            </span>
          )}
        </div>
      </td>
      <td className="px-3 text-right align-middle">
        <div className="flex flex-col items-end leading-tight">
          <PriceField
            value={p.priceFinal}
            readOnly={p.hasPriceMod}
            onCommit={(v) => h.onPrice(item.id, v)}
          />
          {p.hasPriceMod && (
            <span
              className="mt-0.5 font-mono text-[10.5px] text-fg-dim"
              title={`Базовая ${fmt(p.priceBase)} ₽, скидка ${item.clientDiscountPct}% (−${fmt(p.discountAmount)} ₽)`}
            >
              {fmt(p.priceBase)} −{item.clientDiscountPct}%
            </span>
          )}
        </div>
      </td>
      {/* <td className="w-32 px-2 py-2.5 text-right font-mono text-[13.5px] font-semibold tabular-nums">
        {sum > 0 ? `${fmt(sum)} ₽` : <span className="text-fg-muted">—</span>}
      </td> */}
      <td className="px-3 text-right align-middle">
        <span className="font-mono text-[14px] font-semibold tabular-nums">
          {p.total > 0 ? `${fmt(p.total)} ₽` : "—"}
        </span>
      </td>
      <td className="w-40 px-2 py-2.5">
        <StatusMenu item={item} onChange={(s) => h.onStatus(item.id, s)} />
      </td>
      <td className="w-10 px-2 py-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Действия для ${item.code}`}
            className="flex size-8 items-center justify-center rounded-md text-fg-muted opacity-0 transition-opacity hover:bg-bg-select group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 bg-bg-card">
            <DropdownMenuItem
              onClick={() => h.onOpen(item.id)}
              className="text-[13px]"
            >
              Открыть карточку
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => h.onDuplicate(item.id)}
              className="gap-2 text-[13px]"
            >
              <Copy className="size-3.5" /> Дублировать
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => h.onShare(item)}
              className="gap-2 text-[13px]"
            >
              <Share2 className="size-3.5" /> Поделиться
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => h.onClear(item.id)}
              className="gap-2 text-[13px]"
            >
              <Eraser className="size-3.5" /> Очистить, оставив марку
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => h.onDelete(item.id)}
              className="gap-2 text-[13px] text-fg-red"
            >
              <Trash2 className="size-3.5" /> Удалить позицию
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
});
