import { priceOf } from '@/lib/spec/pricing';
import { QtyStepper } from '../layout/qty-stepper';
import Field from '../layout/modal-field';
import { UNIT_OPTIONS } from '@/lib/constants';
import { PriceField } from './layout/price-field';
import { fmt } from '@/lib/utils';
import { SpecItem, SpecItemPatch } from '@/lib/types';

interface Props {
  item: SpecItem;
  onQty: (delta: number) => void;
  onPrice: (raw: string) => void;
  onPatch: (patch: SpecItemPatch) => void;
}
const QtyPriceBlock = ( { item, onQty, onPrice, onPatch }: Props) => {
  const p = priceOf(item);

  return (
    <div
      key={`qp-${item.activeVariantId ?? "base"}`}
      className="flex flex-col sm:flex-row items-center rounded-xl overflow-clip border border-border-muted"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3">
        <div className="bg-bg-card h-20 p-3 w-full border-r">
          <Field label="Кол-во">
            <div className="flex items-center gap-2">
              <QtyStepper
                className="flex-1"
                dense
                editable
                qty={item.qty}
                unit={item.unit}
                onChange={onQty}
                showUnit={false}
              />
              <select
                defaultValue={item.unit}
                onChange={(e) => onPatch({ unit: e.target.value })}
                className="h-6 flex-1 font-mono bg-bg-card text-sm"
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
        <div className="bg-bg-card h-20 p-3 w-full">
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
        <div className="sm:ml-auto h-20 text-right sm:text-left font-mono bg-bg-accent p-3 text-bg w-full col-span-2 sm:col-span-1">
          <Field label="Сумма">
            <div className="flex flex-col">
              <span className="text-[18px] font-semibold tabular-nums">
                {fmt(p.total)} ₽
              </span>
              {(p.hasQtyMod || p.hasPriceMod) && (
                <span className="font-mono text-[10.5px] text-bg/70 tabular-nums">
                  {p.hasQtyMod && `×${p.qtyFinal} ед.`}
                  {p.hasQtyMod && p.hasPriceMod && " · "}
                  {p.hasPriceMod && `−${item.clientDiscountPct}%`}
                </span>
              )}
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

export default QtyPriceBlock