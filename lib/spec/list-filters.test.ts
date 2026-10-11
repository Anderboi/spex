import { describe, expect, it } from "vitest";

import { ALL_CATEGORIES } from "@/lib/constants";
import { specItem as item } from "@/tests/factories/spec-item";
import {
  DRAFT_STATUS,
  countDrafts,
  selectSpecList,
  specStatusCounts,
  specSupplierOptions,
  specTypeCounts,
  type SpecListFilters,
} from "./list-filters";

/**
 * Правила выборки списка позиций: фильтры, сортировка и счётчики для контролов.
 *
 * Проверяются здесь, а не в разметке, потому что это и есть ответ на вопрос
 * «что видит пользователь»: чипсы, селекты и шторка только читают результат.
 * Отдельно закреплено, что поставщик сравнивается с именем, а не с id: у
 * позиции с удалённым из справочника поставщиком id уже нет, и фильтр по id
 * терял бы её молча.
 */

/** Фильтры «по умолчанию»: ничего не выбрано, сортировка по марке. */
const base: SpecListFilters = {
  query: "",
  type: ALL_CATEGORIES,
  status: null,
  company: null,
  sort: "code",
};

describe("selectSpecList · фильтры", () => {
  it("без фильтров отдаёт все позиции и не меняет исходный массив", () => {
    const items = [item({ id: "a" }), item({ id: "b" })];
    const selected = selectSpecList(items, base);

    expect(selected).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("категория сужает список до раздела, «Все категории» — не фильтр", () => {
    const items = [
      item({ id: "a", type: "Отделка" }),
      item({ id: "b", type: "Мебель" }),
    ];

    expect(
      selectSpecList(items, { ...base, type: "Мебель" }).map((i) => i.id),
    ).toEqual(["b"]);
    expect(
      selectSpecList(items, { ...base, type: ALL_CATEGORIES }),
    ).toHaveLength(2);
  });

  it("статус сужает список до одного статуса", () => {
    const items = [
      item({ id: "a", status: "picked" }),
      item({ id: "b", status: "draft" }),
      item({ id: "c", status: "approved" }),
    ];

    expect(
      selectSpecList(items, { ...base, status: DRAFT_STATUS }).map(
        (i) => i.id,
      ),
    ).toEqual(["b"]);
  });

  it("поставщик сравнивается с именем и переживает лишние пробелы", () => {
    const items = [
      item({ id: "a", companyId: null, companyName: "Керама" }),
      item({ id: "b", companyId: "c-2", companyName: "Ромашка" }),
      // Поставщик удалён из справочника: `companyId` уже null, имя осталось.
      item({ id: "c", companyId: null, companyName: " Ромашка " }),
      item({ id: "d", companyName: "" }),
    ];

    expect(
      selectSpecList(items, { ...base, company: "Ромашка" }).map((i) => i.id),
    ).toEqual(["b", "c"]);
    expect(selectSpecList(items, { ...base, company: "" })).toHaveLength(4);
  });

  it("фильтры складываются: поиск, поставщик и статус действуют вместе", () => {
    const items = [
      item({ id: "a", companyName: "Ромашка", name: "Плитка", status: "draft" }),
      item({ id: "b", companyName: "Ромашка", name: "Плитка", status: "picked" }),
      item({ id: "c", companyName: "Керама", name: "Плитка", status: "draft" }),
      item({ id: "d", companyName: "Ромашка", name: "Клей", status: "draft" }),
    ];

    expect(
      selectSpecList(items, {
        ...base,
        query: "плитка",
        company: "Ромашка",
        status: DRAFT_STATUS,
      }).map((i) => i.id),
    ).toEqual(["a"]);
  });

  it("поиск идёт по названию, бренду, марке, характеристикам и артикулу", () => {
    const items = [
      item({ id: "name", name: "Дуб натуральный" }),
      item({ id: "brand", name: "Плитка", brand: "Marazzi" }),
      item({ id: "code", name: "Плитка", code: "МБ-07" }),
      item({ id: "spec", name: "Плитка", spec: "ректификат" }),
      item({ id: "article", name: "Плитка", article: "XZ-900" }),
    ];

    for (const [needle, id] of [
      ["дуб", "name"],
      ["marazzi", "brand"],
      ["мб-07", "code"],
      ["ректификат", "spec"],
      ["xz-900", "article"],
    ]) {
      expect(
        selectSpecList(items, { ...base, query: needle }).map((i) => i.id),
      ).toEqual([id]);
    }
  });
});

describe("selectSpecList · сортировка", () => {
  const items = [
    item({ id: "b", code: "ОТ-2", name: "Бетон", qty: 1, price: 500 }),
    item({ id: "a", code: "ОТ-10", name: "Армия", qty: 2, price: 100 }),
    item({ id: "c", code: "ОТ-1", name: "Вода", qty: 1, price: 900 }),
  ];

  it("по марке — с числовым сравнением: ОТ-2 идёт перед ОТ-10", () => {
    expect(
      selectSpecList(items, { ...base, sort: "code" }).map((i) => i.id),
    ).toEqual(["c", "b", "a"]);
  });

  it("А→Я — по названию", () => {
    expect(
      selectSpecList(items, { ...base, sort: "az" }).map((i) => i.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("по сумме — от большей к меньшей", () => {
    expect(
      selectSpecList(items, { ...base, sort: "sum" }).map((i) => i.id),
    ).toEqual(["c", "b", "a"]);
  });
});

describe("счётчики для контролов фильтров", () => {
  const items = [
    item({ type: "Отделка", status: "draft" }),
    item({ type: "Отделка", status: "picked" }),
    item({ type: "Мебель", status: "draft" }),
  ];

  it("считает позиции по категориям и статусам", () => {
    expect(specTypeCounts(items)).toEqual({ Отделка: 2, Мебель: 1 });
    expect(specStatusCounts(items)).toEqual({ draft: 2, picked: 1 });
  });

  it("«черновиков» ровно столько, сколько позиций со статусом draft", () => {
    expect(countDrafts(items)).toBe(2);
    expect(DRAFT_STATUS).toBe("draft");
  });
});

describe("specSupplierOptions", () => {
  it("отдаёт компании позиций по алфавиту, со счётчиками", () => {
    const options = specSupplierOptions([
      item({ companyName: "Ромашка" }),
      item({ companyName: "Керама" }),
      item({ companyName: "Ромашка" }),
    ]);

    expect(options).toEqual([
      { name: "Керама", count: 1 },
      { name: "Ромашка", count: 2 },
    ]);
  });

  it("позиции без поставщика в список не попадают", () => {
    const options = specSupplierOptions([
      item({ companyName: "" }),
      item({ companyName: "   " }),
      item({ companyName: "Керама" }),
    ]);

    expect(options).toEqual([{ name: "Керама", count: 1 }]);
  });

  it("пробелы вокруг имени не создают вторую компанию", () => {
    const options = specSupplierOptions([
      item({ companyName: "Ромашка" }),
      item({ companyName: " Ромашка " }),
    ]);

    expect(options).toEqual([{ name: "Ромашка", count: 2 }]);
  });
});
