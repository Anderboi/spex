"use client";

import { memo } from "react";
import { Copy, Eraser, MoreHorizontal, Plus, Share2, Trash2 } from "lucide-react";
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
import { QtyStepper } from "./qty-stepper";
import { PriceField } from "./price-field";
import { isLocked } from "@/lib/spec/status";
import { fmt, cn, fmtQty } from "@/lib/utils";
import type { SpecRowHandlers } from "./spec-row";
import { ParentSubMenu } from "./parent-submenu";
import { SpecItem } from "@/lib/types";
import { priceOf } from "@/lib/spec/pricing";

export const SpecCard = memo(function SpecCard({
  item,
  allItems,
  selected,
  h,
}: {
  item: SpecItem;
  allItems: SpecItem[];
  selected: boolean;
  h: SpecRowHandlers;
}) {
  const p = priceOf(item);

  return (
    <article
      className={cn(
        "rounded-xl border border-border-muted bg-bg-card p-3",
        selected && "border-fg-brand bg-bg-brand/30",
        item.isPlaceholder && "border-dashed",
      )}
    >
      <div className="flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={() => h.onToggleSel(item.id)}
          aria-label={`Выбрать ${item.code}`}
          className="mt-0.5"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <InlineCode
              code={item.code}
              locked={isLocked(item.status)}
              onCommit={(c) => h.onCode(item.id, c)}
            />
            {/* <span className="ml-auto font-mono text-[14px] font-semibold tabular-nums">
              {sum > 0 ? `${fmt(sum)} ₽` : "—"}
            </span> */}
            <div className="mt-3 border-t border-border-muted pt-2.5">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[12.5px] text-fg-secondary">
                  {fmtQty(p.qtyFinal)} {item.unit} × {fmt(p.priceFinal)} ₽
                </span>
                <span className="ml-auto font-mono text-[15px] font-semibold tabular-nums">
                  {p.total > 0 ? `${fmt(p.total)} ₽` : "—"}
                </span>
              </div>

              {(p.hasQtyMod || p.hasPriceMod) && (
                <p className="mt-0.5 font-mono text-[10.5px] text-fg-dim">
                  {[
                    p.hasQtyMod &&
                      `${fmtQty(p.qtyBase)} ${item.unit} +${item.stockPct}% запас`,
                    p.hasPriceMod && `−${item.clientDiscountPct}% скидка`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}

              <div className="mt-2 flex items-center gap-3">
                <QtyStepper
                  qty={p.qtyFinal}
                  unit={item.unit}
                  editable={false}
                  onChange={(d) => h.onQty(item.id, d)}
                />
                <div className="ml-auto">
                  <StatusMenu
                    item={item}
                    onChange={(s) => h.onStatus(item.id, s)}
                  />
                </div>
              </div>
            </div>
          </div>

          {item.isPlaceholder ? (
            <button
              type="button"
              onClick={() => h.onFill(item.id)}
              className="mt-1.5 text-left text-[13.5px] font-medium text-fg-muted underline decoration-dotted underline-offset-4"
            >
              Позиция не заполнена — выбрать материал
            </button>
          ) : (
            <button
              type="button"
              onClick={() => h.onOpen(item.id)}
              className="mt-1.5 block w-full text-left"
            >
              <span className="line-clamp-2 text-[14px] font-medium text-fg">
                {item.name}
              </span>
              {(item.brand || item.article) && (
                <span className="mt-0.5 block truncate text-[12px] text-fg-muted">
                  {[item.brand, item.article].filter(Boolean).join(" · ")}
                </span>
              )}
            </button>
          )}

          {item.rooms.length > 0 && (
            <p className="mt-1.5 truncate text-[11.5px] text-fg-muted">
              {item.rooms.join(", ")}
            </p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Действия для ${item.code}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-select"
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
            <ParentSubMenu
              item={item}
              allItems={allItems}
              onSetParent={(parentId) => h.onSetParent(item.id, parentId)}
            />
            <DropdownMenuItem
              onClick={() => h.onAddChild(item.id)}
              className="gap-2 text-[13px]"
            >
              <Plus className="size-3.5" /> Добавить субэлемент
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
              <Trash2 className="size-3.5" /> Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-muted pt-2.5">
        <QtyStepper
          qty={item.qty}
          editable={false}
          unit={item.unit}
          onChange={(d) => h.onQty(item.id, d)}
        />
        <div className="flex items-center gap-1 text-[12px] text-fg-muted">
          <span>×</span>
          <PriceField
            readOnly={p.hasPriceMod}
            value={item.price}
            onCommit={(v) => h.onPrice(item.id, v)}
          />
        </div>
        <div className="ml-auto">
          <StatusMenu item={item} onChange={(s) => h.onStatus(item.id, s)} />
        </div>
      </div>
    </article>
  );
});
