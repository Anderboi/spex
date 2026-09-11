"use client";

import { memo } from "react";
import {
  Copy,
  Eraser,
  MoreHorizontal,
  Plus,
  Share2,
  Trash2,
  Image as ImageIcon,
  Link,
} from "lucide-react";
import Image from "next/image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InlineCode } from "./inline-code";
import { StatusMenu } from "./status-menu";
import { QtyStepper } from "../layout/qty-stepper";
import { isLocked } from "@/lib/spec/status";
import { fmt, cn, fmtQty } from "@/lib/utils";
import type { SpecRowHandlers } from "./spec-row";
import { ParentSubMenu } from "./parent-submenu";
import { SpecItem } from "@/lib/types";
import { priceOf } from "@/lib/spec/pricing";
import type { ServiceOperation } from "@/actions/service-operations";
import { PriceField } from "./price-field";
import { Button } from "../ui/button";

export const SpecCard = memo(function SpecCard({
  item,
  allItems,
  selected,
  ops,
  h,
}: {
  item: SpecItem;
  allItems: SpecItem[];
  selected: boolean;
  /** Операции доп. расходов, связанные с этой позицией. */
  ops?: ServiceOperation[];
  h: SpecRowHandlers;
}) {
  const p = priceOf(item);

  return (
    <article
      className={cn(
        "rounded-3xl shadow-lg border border-transparent bg-bg-card p-3",
        selected && "border-fg-brand bg-bg-brand/30",
        item.isPlaceholder && "border-dashed",
      )}
    >
      {/* Header: identity — checkbox, code, name/brand, actions */}
      <div className="flex items-start gap-3">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            height={120}
            width={120}
            className="size-30 object-cover border rounded-xl"
          />
        ) : (
          <div className="size-30! aspect-square bg-bg-brand2/50 border items-center flex justify-center rounded-xl">
            <ImageIcon className="size-6 text-fg-muted" />
          </div>
        )}
        <div className="flex flex-col w-full">
          <div className="flex">
            <div className="min-w-0 flex-1">
              <InlineCode
                code={item.code}
                locked={isLocked(item.status)}
                onCommit={(c) => h.onCode(item.id, c)}
              />
              {item.isPlaceholder ? (
                <span
                  // type="button"
                  // onClick={() => h.onFill(item.id)}
                  className="mt-1 block text-left text-[13.5px] font-medium text-fg-muted underline decoration-dotted underline-offset-4"
                >
                  Позиция не заполнена — выбрать материал
                </span>
              ) : (
                <span
                  // type="button"
                  // onClick={() => h.onOpen(item.id)}
                  className="mt-1 block w-full text-left"
                >
                  <span className="line-clamp-2 //text-[14px] font-semibold text-fg">
                    {item.name}
                  </span>
                  {(item.brand || item.spec) && (
                    <span className="mt-1 block truncate text-[13px] text-fg-secondary">
                      {[item.brand, item.spec].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              )}

              {/* {item.rooms.length > 0 && (
            <p className="mt-1 truncate text-[11.5px] text-fg-secondary">
              {item.rooms.join(", ")}
            </p>
          )} */}
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
          <article className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {/* × */}
              <QtyStepper
                isMobile
                qty={item.qty}
                unit={item.unit}
                showUnit={false}
                editable
                onChange={(d) => h.onQty(item.id, d)}
              />
              {/* <span className="font-mono text-[12.5px] text-fg-secondary"> */}
              {/* {fmtQty(p.qtyFinal)}  */}
              {/* {item.unit} */}
              {/* × {fmt(p.priceFinal)} ₽ */}
              {/* </span> */}
            </div>
            <div className="text-lg font-semibold flex items-center">
              <PriceField
                value={p.priceBase}
                readOnly={p.hasPriceMod}
                className="text-lg! pr-2 text-right!"
                onCommit={(v) => h.onPrice(item.id, v)}
              />
              ₽
            </div>
          </article>
        </div>
      </div>

      {/* Price line: qty × price = total, with modifier footnote */}
      <div className="mt-3 border-t border-border-muted pt-2">
        <div className="flex">
          <div>
            <div className="flex flex-col">
              <span className="text-fg-muted font-mono leading-4 text-sm">
                Итого
              </span>
              <span className="mr-auto font-mono text-xl font-semibold tabular-nums">
                {p.total > 0 ? `${fmt(p.total)} ₽` : "—"}
              </span>
            </div>

            {(p.hasQtyMod || p.hasPriceMod) && (
              <p className="mt-1 font-mono text-[10.5px] leading-3 text-fg-dim">
                {[
                  `${fmtQty(p.qtyFinal)} ${item.unit} × ${fmt(p.priceFinal)} ₽`,
                  p.hasQtyMod && `+${item.stockPct}% запас`,
                  p.hasPriceMod && `−${item.clientDiscountPct}% скидка`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          <div className="ml-auto">
            <StatusMenu item={item} onChange={(s) => h.onStatus(item.id, s)} />
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex w-full border-t border-border-muted gap-4 pt-2.5">
        {/* <StatusMenu item={item} onChange={(s) => h.onStatus(item.id, s)} /> */}

        <Button
          size="lg"
          onClick={() => h.onOpen(item.id)}
          className="rounded-xl h-10 flex-1 px-8"
        >
          Детали
        </Button>
        <Button
          size="icon-lg"
          variant="secondary"
          className="rounded-xl h-10 px-8"
          onClick={() => h.onOpen(item.id)}
        >
          <Link className="size-4" />
        </Button>
      </div>

      {/* {ops && ops.length > 0 && ( */}
      {/* <ServiceOperationBadges ops={ops} onOpen={h.onEditOperation} /> */}

      {/* )}  */}
    </article>
  );
});
