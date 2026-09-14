"use client";

import { memo } from "react";
import { Layers, Wrench } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineCode } from "./inline-code";
import { StatusMenu } from "./status-menu";
import { isLocked } from "@/lib/spec/status";
import { priceOf } from "@/lib/spec/pricing";
import { cn, fmt } from "@/lib/utils";
import type { SpecRowHandlers } from "./spec-row";
import { SpecItem } from "@/lib/types";
import type { ServiceOperation } from "@/actions/service-operations";

/**
 * Самая плотная раскладка: одна позиция — одна строка (~64px). На месте
 * превью стоит марка, поэтому в экран влезает в 4–5 раз больше позиций,
 * чем в карточках.
 *
 * Режим обзорный: количество и цена здесь только читаются, правка — в
 * детализации (тап по строке). Смена статуса и действия позиции остаются
 * в строке, чтобы не гонять пользователя в модалку по каждому шагу.
 */
export const SpecListRow = memo(function SpecListRow({
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
        "relative flex min-h-16 items-center gap-1.5 border-b border-border-muted px-0.5 py-1.5",
        selected && "bg-bg-brand/40",
        fill &&
          "bg-[repeating-linear-gradient(45deg,transparent,transparent_7px,var(--color-bg-card)_7px,var(--color-bg-card)_14px)]",
      )}
    >
      {/* Вся строка — одна кнопка «открыть»; интерактивные элементы лежат
          выше оверлея (z-10) и забирают тап себе. */}
      <button
        type="button"
        onClick={() => (fill ? h.onFill(item.id) : h.onOpen(item.id))}
        aria-label={
          fill
            ? `Заполнить позицию ${item.code}`
            : `Открыть позицию ${item.code}: ${item.name}`
        }
        className="absolute inset-0 z-0 cursor-pointer rounded-lg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fg-brand"
      />

      <div className="relative z-10 flex shrink-0 items-center">
        <Checkbox
          className="border-border border-2"
          checked={selected}
          onCheckedChange={() => h.onToggleSel(item.id)}
          aria-label={`Выбрать ${item.code}`}
        />
      </div>

      {/* Слот превью в карточке — здесь марка. */}
      <div className="relative z-10 flex w-14 shrink-0 justify-center">
        <InlineCode
          code={item.code}
          locked={isLocked(item.status)}
          onCommit={(c) => h.onCode(item.id, c)}
          className="max-w-full truncate"
        />
      </div>

      <div className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1">
         
          <span
            className={cn(
              "truncate text-[14px] font-medium",
              fill && "text-fg-muted italic",
            )}
          >
            {item.name}
          </span>
        </span>

        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-fg-muted">
          {/* <span className="min-w-0 truncate">
            {fill
              ? "Позиция не заполнена"
              : [
                  `${fmtQty(p.qtyBase)} ${item.unit}${p.hasQtyMod ? ` +${item.stockPct}%` : ""}`,
                  brandSpec,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </span> */}
          <span>{brandSpec}</span>
          {variantsCount > 1 && (
            <span
              className="flex shrink-0 items-center gap-0.5 rounded border border-border-muted px-1 font-mono text-[10.5px]"
              title={`Вариантов замены: ${variantsCount}`}
            >
              <Layers className="size-2.5" />
              {variantsCount}
            </span>
          )}
          {opsCount > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 rounded border border-border-muted px-1 font-mono text-[10.5px]"
              title={`Доп. расходы по позиции: ${opsCount}`}
            >
              <Wrench className="size-2.5" />
              {opsCount}
            </span>
          )}
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center">
        <span className="font-mono text-[14px] font-semibold tabular-nums">
          {fill ? "" : p.total > 0 ? `${fmt(p.total)} ₽` : "—"}
        </span>
        <span className="mt-0.5 flex items-center gap-0.5">
          <StatusMenu
            variant="chip"
            className="relative z-10 //size-8"
            item={item}
            onChange={(s) => h.onStatus(item.id, s)}
          />
          {/* <SpecItemActions
            className="relative z-10 size-8"
            item={item}
            allItems={allItems}
            h={h}
            deleteLabel="Удалить позицию"
          /> */}
        </span>
      </div>
    </article>
  );
});
