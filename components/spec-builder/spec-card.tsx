"use client";

import { memo } from "react";
import { Image as ImageIcon } from "lucide-react";
import Image from "next/image";
import { InlineCode } from "./inline-code";
import { StatusMenu } from "./status-menu";
import { SpecItemActions } from "./spec-item-actions";
import { QtyStepper } from "../layout/qty-stepper";
import { isLocked } from "@/lib/spec/status";
import { fmt, cn, fmtQty } from "@/lib/utils";
import type { SpecRowHandlers } from "./spec-row";
import { SpecItem } from "@/lib/types";
import { priceOf } from "@/lib/spec/pricing";
import type { ServiceOperation } from "@/actions/service-operations";
import { PriceField } from "./price-field";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";

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
        // `relative` — чтобы бейдж-чекбокс позиционировался от карточки,
        // а не от ближайшего positioned-предка страницы.
        "relative rounded-3xl shadow-lg border border-transparent bg-bg-card p-3",
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
            height={96}
            width={96}
            className="size-24 shrink-0 rounded-xl border object-cover"
          />
        ) : (
          <div className="flex size-24 shrink-0 items-center justify-center rounded-xl border bg-bg-brand2/50">
            <ImageIcon className="size-6 text-fg-muted" />
          </div>
        )}
        {/* Выбор позиции — тот же чекбокс, что в табличной (web) версии:
            checked из пропа `selected`, переключение через onToggleSel.
            Бейдж лежит поверх угла превью и не участвует в потоке. */}
        <div className="absolute top-3 left-3 rounded-md bg-bg-card p-1.5">
          <Checkbox
            className="size-4 cursor-pointer border-border border-2"
            checked={selected}
            onCheckedChange={() => h.onToggleSel(item.id)}
            aria-label={`Выбрать ${item.code}`}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <div className="min-w-0 flex-1">
            <InlineCode
              code={item.code}
              locked={isLocked(item.status)}
              onCommit={(c) => h.onCode(item.id, c)}
            />
            {item.isPlaceholder ? (
              <button
                type="button"
                onClick={() => h.onFill(item.id)}
                className="mt-1 block text-left text-[14px] font-medium text-fg-muted underline decoration-dotted underline-offset-4"
              >
                Позиция не заполнена — выбрать материал
              </button>
            ) : (
              <button
                type="button"
                onClick={() => h.onOpen(item.id)}
                className="mt-1 block w-full text-left"
              >
                <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-fg text-balance">
                  {item.name}
                </span>
                {(item.brand || item.spec) && (
                  <span className="mt-0.5 block truncate text-[12.5px] text-fg-secondary">
                    {[item.brand, item.spec].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            )}
          </div>
          <SpecItemActions
            className="-mr-1 -mt-1 size-11"
            item={item}
            allItems={allItems}
            h={h}
          />
        </div>
      </div>

      {/* Количество и цена за единицу. Отдельные строки во всю ширину
          карточки: в колонке рядом с превью для них не хватало места и
          сумма цены обрезалась. */}
      {!item.isPlaceholder && (
        <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-border-muted bg-bg-card2/60 px-2 py-2">
          <div className="flex //flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="shrink-0 text-[11px] font-medium font-mono uppercase text-fg-muted">
              Количество
            </span>
            <QtyStepper
              isMobile
              qty={item.qty}
              unit={item.unit}
              editable
              onChange={(d) => h.onQty(item.id, d)}
              className="ml-auto min-w-0 flex-1"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="shrink-0 text-[11px] font-medium font-mono uppercase text-fg-muted">
              Цена за {item.unit}
            </span>
            <div className="ml-auto flex min-w-0 flex-1 items-baseline justify-end gap-1">
              <PriceField
                value={p.priceBase}
                readOnly={p.hasPriceMod}
                className="min-w-0 text-right! text-[16px]!"
                onCommit={(v) => h.onPrice(item.id, v)}
              />
              <span className="shrink-0 font-mono text-[12.5px] text-fg-secondary">
                ₽
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Price line: qty × price = total, with modifier footnote */}
      <div className="mt-3 border-t border-border-muted pt-2">
        <div className="min-w-0 flex-1 flex justify-between">
          <p className="text-[11px] font-medium font-mono uppercase tracking-wider text-fg-muted">
            Итого
          </p>
          <div className="flex flex-col items-end justify-end">
            <p className="font-mono text-[21px] font-semibold leading-tight tabular-nums">
              {p.total > 0 ? `${fmt(p.total)} ₽` : "—"}
            </p>

            {(p.hasQtyMod || p.hasPriceMod) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11.5px] leading-4 text-fg-dim">
                <span className="whitespace-nowrap">
                  {fmtQty(p.qtyFinal)} {item.unit} × {fmt(p.priceFinal)} ₽
                </span>
                {p.hasQtyMod && (
                  <span className="whitespace-nowrap">
                    +{item.stockPct}% запас
                  </span>
                )}
                {p.hasPriceMod && (
                  <span className="whitespace-nowrap">
                    −{item.clientDiscountPct}% скидка
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {/* <div className="shrink-0">
          <StatusMenu item={item} onChange={(s) => h.onStatus(item.id, s)} />
        </div> */}
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-4 border-t border-border-muted pt-2.5">
        <StatusMenu
          className="h-10 px-6"
          item={item}
          onChange={(s) => h.onStatus(item.id, s)}
        />
        <Button
          size="lg"
          onClick={() =>
            item.isPlaceholder ? h.onFill(item.id) : h.onOpen(item.id)
          }
          className="h-10 flex-1 rounded-full"
        >
          {item.isPlaceholder ? "Выбрать материал" : "Детали"}
        </Button>

        {/* <Button
          type="button"
          variant="outline"
          size="icon-lg"
          onClick={() => h.onShare(item)}
          title="Поделиться"
          aria-label={`Скопировать ссылку на позицию ${item.code}`}
          className="size-11 shrink-0 rounded-xl border-border-muted bg-bg-card text-fg-secondary hover:text-fg"
        >
          <Link className="size-4" />
        </Button> */}
      </div>

      {/* {ops && ops.length > 0 && ( */}
      {/* <ServiceOperationBadges ops={ops} onOpen={h.onEditOperation} /> */}

      {/* )}  */}
    </article>
  );
});
