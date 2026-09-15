"use client";

import { memo } from "react";
import {
  Circle,
  CornerDownRight,
  Dot,
  Image as ImageIcon,
  Layers,
  Wrench,
} from "lucide-react";
import Image from "next/image";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineCode } from "./layout/inline-code";
import { StatusMenu } from "./layout/status-menu";
import { SpecItemActions } from "./layout/spec-item-actions";
import { QtyStepper } from "../layout/qty-stepper";
import { isLocked } from "@/lib/spec/status";
import { priceOf } from "@/lib/spec/pricing";
import { cn, fmt, fmtQty } from "@/lib/utils";
import type { SpecRowHandlers } from "./spec-row";
import { SpecItem } from "@/lib/types";
import type { ServiceOperation } from "@/actions/service-operations";

/**
 * Средняя плотность: превью 64px вместо 96px, количество одной строкой вместо
 * блока «количество + цена за единицу». Правка количества и статуса остаётся
 * на месте — это рабочий режим для обхода спецификации.
 *
 * Сверху идентификация (превью, марка, статус, название, бренд), снизу за
 * линией — количество и сумма. Сумма не переносится и прижата вправо, поэтому
 * строка всегда одной высоты; надбавки запас/скидка ушли в строку бренда,
 * чтобы не раздувать правый столбец.
 */
export const SpecCompactCard = memo(function SpecCompactCard({
  item,
  allItems,
  selected,
  ops,
  h,
}: {
  item: SpecItem;
  /** Все позиции проекта — нужны для выбора родителя в меню действий. */
  allItems: SpecItem[];
  selected: boolean;
  /** Операции доп. расходов, связанные с этой позицией. */
  ops?: ServiceOperation[];
  h: SpecRowHandlers;
}) {
  const p = priceOf(item);
  const brandSpec = [item.brand, item.spec].filter(Boolean).join(" · ");
  const variantsCount = item.variants?.length ?? 0;
  const opsCount = ops?.length ?? 0;
  const fill = item.isPlaceholder;

  return (
    <article
      className={cn(
        // `overflow-hidden` — страховка от горизонтального переполнения: при
        // узком экране и длинных числах карточка не должна растягивать страницу.
        "relative overflow-hidden rounded-2xl border border-transparent bg-bg-card p-2.5 shadow-lg",
        selected && "border-fg-brand bg-bg-brand/30",
        fill && "border-dashed",
      )}
    >
      {/* Вся карточка — кнопка «открыть», интерактивные элементы выше оверлея. */}
      <button
        type="button"
        onClick={() => (fill ? h.onFill(item.id) : h.onOpen(item.id))}
        aria-label={
          fill
            ? `Заполнить позицию ${item.code}`
            : `Открыть позицию ${item.code}: ${item.name}`
        }
        className="absolute inset-0 z-0 cursor-pointer rounded-2xl outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fg-brand"
      />

      <div className="relative flex items-start gap-2.5">
        <div className="relative z-10 flex shrink-0 items-center self-stretch pr-0.5">
          <Checkbox
            className="size-4 cursor-pointer border-border border-2"
            checked={selected}
            onCheckedChange={() => h.onToggleSel(item.id)}
            aria-label={`Выбрать ${item.code}`}
          />
        </div>

        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            height={64}
            width={64}
            className="size-16 shrink-0 rounded-xl border object-cover"
          />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border bg-bg-brand2/50">
            <ImageIcon className="size-5 text-fg-muted" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* {item.parentId && (
              <CornerDownRight className="size-3 shrink-0 text-fg-muted" />
            )} */}
            <span className="relative z-10 min-w-0">
              <InlineCode
                code={item.code}
                locked={isLocked(item.status)}
                onCommit={(c) => h.onCode(item.id, c)}
              />
            </span>
            <StatusMenu
              variant="dot"
              className="relative z-10 size-7"
              item={item}
              onChange={(s) => h.onStatus(item.id, s)}
            />
            <SpecItemActions
              className="relative z-10 -mt-0.5 -mr-1 ml-auto size-8"
              item={item}
              allItems={allItems}
              h={h}
              deleteLabel="Удалить позицию"
            />
          </div>

          <span
            className={cn(
              "mt-0.5 line-clamp-2 block text-[14px] font-medium leading-snug wrap-break-word",
              fill && "text-fg-muted italic",
            )}
          >
            {item.name}
          </span>

          {/* Бренд и служебные пометки — одной строкой мелким текстом, чтобы
              карточка не росла в высоту. `overflow-hidden`: длинный бренд
              обрезается, а не растягивает карточку. */}
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[12px] text-fg-muted">
            <span className="min-w-0 truncate">
              {fill ? "Позиция не заполнена" : brandSpec || "—"}
            </span>
            {/* {item.product_type && (
              <span
                className="flex shrink-0 items-center gap-1 font-mono text-[12px]"
                // title={`Тип: ${item.product_type}`}
              >
                <Circle className="size-1.5" fill="#9a958a" /> */}
                {/* <Layers className="size-2.5" /> */}
                {/* {item.product_type} */}
              {/* </span>
            )} */}
            {/* {p.hasQtyMod && (
              <span
                className="shrink-0 font-mono text-[11px]"
                title={`Запас +${item.stockPct}%: ${fmtQty(p.qtyBase)} ${item.unit} по плану, ${fmtQty(p.qtyFinal)} ${item.unit} к закупке`}
              >
                +{item.stockPct}%
              </span>
            )} */}
            {/* {p.hasPriceMod && (
              <span
                className="shrink-0 font-mono text-[11px]"
                title={`Скидка клиенту −${item.clientDiscountPct}%: ${fmt(p.priceFinal)} ₽ за ${item.unit}`}
              >
                −{item.clientDiscountPct}%
              </span>
            )} */}

            {opsCount > 0 && (
              <span
                className="flex shrink-0 items-center gap-0.5 rounded border border-border-muted px-1 font-mono text-[10.5px]"
                title={`Доп. расходы по позиции: ${opsCount}`}
              >
                <Wrench className="size-2.5" />
                {opsCount}
              </span>
            )}
            {variantsCount > 1 && (
              <span
                className="flex shrink-0 items-center gap-0.5 rounded border border-border-muted px-1 font-mono text-[10.5px]"
                title={`Вариантов замены: ${variantsCount}`}
              >
                <Layers className="size-2.5" />
                {variantsCount}
              </span>
            )}
          </span>
        </div>
      </div>

      {!fill && (
        <div className="mt-2 flex items-center gap-3 border-t border-border-muted pt-2">
          {/* Ширину задаём явно: внутренний `InputGroup` тянется на `w-full`,
              и без ограничения степпер занимал всю строку, выдавливая сумму. */}
          <QtyStepper
            dense
            qty={item.qty}
            unit={item.unit}
            editable
            onChange={(d) => h.onQty(item.id, d)}
            className="relative z-10 w-36"
          />

          <span className="relative z-10 ml-auto min-w-0 font-mono text-[16px] font-semibold whitespace-nowrap tabular-nums">
            {p.total > 0 ? `${fmt(Math.round(p.total))} ₽` : "—"}
          </span>
        </div>
      )}
    </article>
  );
});
