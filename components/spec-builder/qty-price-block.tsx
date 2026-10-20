import { priceOf } from "@/lib/spec/pricing";
import { QtyStepper } from "../layout/qty-stepper";
import Field from "../layout/modal-field";
import { UNIT_OPTIONS } from "@/lib/constants";
import { PriceField } from "./layout/price-field";
import { PercentPicker } from "./layout/percent-picker";
import { fmt, fmtQty } from "@/lib/utils";
import { SpecItem, SpecItemPatch } from "@/lib/types";

/** Быстрые проценты: закрывают типовые случаи, остальное — через «…». */
const STOCK_PCT_OPTIONS = [0, 5, 10, 15] as const;
const DISCOUNT_PCT_OPTIONS = [0, 5, 10, 20] as const;

/** Подпись блока внутри блока: у «Запаса» и «Скидки» она мельче, чем у полей. */
const pctLabel =
  "font-mono text-[11px] text-fg-muted tracking-wider uppercase";

interface Props {
  item: SpecItem;
  onQty: (delta: number) => void;
  onPrice: (raw: string) => void;
  onPatch: (patch: SpecItemPatch) => void;
}
const QtyPriceBlock = ( { item, onQty, onPrice, onPatch }: Props) => {
  const p = priceOf(item);

  /** Подпись под запасом: к закупке пойдёт `qtyFinal`, а не план. */
  const stockNote = `${item.stockPct}% · ${fmtQty(p.qtyFinal)} ${item.unit}`;
  /** Подпись под скидкой: сколько рублей она стоит по всей строке. */
  const discountNote =
    item.clientDiscountPct > 0
      ? `${item.clientDiscountPct}% · −${fmt(p.discountAmount)} ₽`
      : "Без скидки";

  return (
    <div
      key={`qp-${item.activeVariantId ?? "base"}`}
      className="overflow-clip rounded-xl border border-border-muted bg-bg-card"
    >
      {/* Две колонки с общей вертикалью: слева количество, цена и оба процента,
          справа «Сумма». Итог тянется на всю высоту блока, а не занимает один
          верхний ряд: под ним в макете нет светлой пустоты. */}
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 border-border-muted sm:border-r">
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <div className="border-border-muted p-3 sm:border-r">
              <Field label="Кол-во">
                <div className="flex items-center justify-between gap-1">
                  <QtyStepper
                    dense
                    editable
                    qty={item.qty}
                    unit={item.unit}
                    onChange={onQty}
                    showUnit={false}
                  />
                  <select
                    value={item.unit}
                    onChange={(e) => onPatch({ unit: e.target.value })}
                    aria-label="Единица измерения"
                    className="h-8 font-mono bg-bg-card text-sm"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            </div>
            <div className="border-t border-border-muted p-3 sm:border-t-0">
              <Field label="Цена за ед.">
                <PriceField
                  readOnly={false}
                  // readOnly={p.hasPriceMod}
                  value={p.priceBase}
                  onCommit={onPrice}
                  className="text-[18px]! p-0! text-left! font-semibold tabular-nums"
                />
              </Field>
            </div>
          </div>

          {/* Проценты, из которых сложился итог: запас к количеству, скидка к
              цене. Подпись под чипами показывает, во что обошлась надбавка, —
              процент не приходится считать в голове. */}
          <div className="grid grid-cols-1 border-t border-border-muted sm:grid-cols-2 bg-bg-card2">
            <div className="flex flex-col gap-2 border-border-muted p-3 sm:border-r">
              <Field label={`Запас ${stockNote}`}>
                <PercentPicker
                  label="Запас"
                  value={item.stockPct}
                  options={STOCK_PCT_OPTIONS}
                  onChange={(stockPct) => onPatch({ stockPct })}
                />
              </Field>
              {/* <p className={pctLabel}>{stockNote}</p> */}
            </div>
            <div className="flex flex-col gap-2 border-t border-border-muted p-3 sm:border-t-0 bg-bg-card2">
              <Field label={`Скидка ${discountNote}`}>
                <PercentPicker
                  label="Скидка"
                  value={item.clientDiscountPct}
                  options={DISCOUNT_PCT_OPTIONS}
                  onChange={(clientDiscountPct) =>
                    onPatch({ clientDiscountPct })
                  }
                />
              </Field>
              {/* <p className="font-mono text-[11px] text-fg-muted">
                {discountNote}
              </p> */}
            </div>
          </div>
        </div>

        {/* Итог: то, что видит заказчик — уже с запасом и скидкой. */}
        <div className="flex flex-col gap-2 justify-between bg-bg-accent p-3 text-right text-bg">
          <span className="text-[11px] font-mono tracking-wider text-bg/60 uppercase">
            Сумма
          </span>
          <div className="flex flex-col items-end gap-1">
            {(p.hasQtyMod || p.hasPriceMod) && (
              <span className="font-mono text-xs text-bg/70 tabular-nums">
                {p.hasQtyMod && `${fmtQty(p.qtyFinal)} ${item.unit}`}
                {p.hasQtyMod && p.hasPriceMod && " · "}
                {p.hasPriceMod && `−${item.clientDiscountPct}%`}
              </span>
            )}
            <span className="text-xl font-semibold font-mono tabular-nums">
              {fmt(p.total)} ₽
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default QtyPriceBlock
