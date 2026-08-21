import { UNIT_OPTIONS } from '../constants';

/** Единицы, которые нельзя купить дробно: запас округляется вверх. */
const INTEGER_UNITS = new Set(UNIT_OPTIONS);

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type PriceInput = {
  qty: number;
  unit: string;
  price: number;
  stockPct?: number;
  clientDiscountPct?: number;
  supplierDiscountPct?: number;
};

export type PriceBreakdown = {
  qtyBase: number; // по плану
  qtyFinal: number; // с запасом, округлённое по единице
  stockQty: number; // добавка
  priceBase: number; // до скидки
  priceFinal: number; // после скидки заказчику
  discountAmount: number; // сколько скидка стоит в рублях
  total: number; // qtyFinal × priceFinal — то, что видит заказчик
  purchaseTotal: number; // закупка со скидкой студии
  margin: number; // внутреннее, в спецификацию не выводится
  hasQtyMod: boolean;
  hasPriceMod: boolean;
};

export function priceOf(i: PriceInput): PriceBreakdown {
  const stock = i.stockPct ?? 0;
  const cd = i.clientDiscountPct ?? 0;
  const sd = i.supplierDiscountPct ?? 0;

  const qtyBase = Number(i.qty) || 0;
  const raw = qtyBase * (1 + stock / 100);
  const qtyFinal = INTEGER_UNITS.has(i.unit) ? Math.ceil(raw) : round2(raw);

  const priceBase = Number(i.price) || 0;
  const priceFinal = round2(priceBase * (1 - cd / 100));
  const purchase = round2(priceBase * (1 - sd / 100));

  const total = round2(qtyFinal * priceFinal);
  const purchaseTotal = round2(qtyFinal * purchase);

  return {
    qtyBase,
    qtyFinal,
    stockQty: round2(qtyFinal - qtyBase),
    priceBase,
    priceFinal,
    discountAmount: round2(qtyFinal * (priceBase - priceFinal)),
    total,
    purchaseTotal,
    margin: round2(total - purchaseTotal),
    hasQtyMod: stock > 0,
    hasPriceMod: cd > 0,
  };
}

export function sumItems(items: PriceInput[]) {
  return items.reduce(
    (acc, i) => {
      const p = priceOf(i);
      acc.total = round2(acc.total + p.total);
      acc.purchase = round2(acc.purchase + p.purchaseTotal);
      acc.discount = round2(acc.discount + p.discountAmount);
      return acc;
    },
    { total: 0, purchase: 0, discount: 0 },
  );
}
