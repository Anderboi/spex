import type { SpecItem } from "@/lib/types";

/**
 * Позиция спецификации для тестов: по умолчанию — заполненная позиция «Отделка»
 * с маркой ОТ-01. Тест переопределяет только те поля, о которых он сам, — так
 * fixture не приходится переписывать при каждом новом поле `SpecItem`.
 *
 * Лежит в одном месте нарочно: фабрика нужна и unit-тестам правил выборки
 * (`lib/spec/list-filters.test.ts`), и тестам контролов фильтров, а копия
 * разошлась бы при первом же добавленном поле.
 */
export function specItem(overrides: Partial<SpecItem> = {}): SpecItem {
  return {
    id: "item-1",
    projectId: "project-1",
    materialId: null,
    companyId: null,
    contactId: null,
    companyName: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    imageUrl: null,
    code: "ОТ-01",
    type: "Отделка",
    name: "Керамогранит",
    brand: "ABK",
    spec: "60×60",
    article: "A-1",
    qty: 1,
    unit: "м²",
    price: 1000,
    stockPct: 0,
    clientDiscountPct: 0,
    supplierDiscountPct: 0,
    status: "picked",
    isPlaceholder: false,
    position: 1,
    rooms: [],
    notes: "",
    leadTime: "",
    avail: "",
    attrs: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
    product_url: "",
    product_type: "",
    variants: [],
    activeVariantId: null,
    parentId: null,
    ...overrides,
  };
}
