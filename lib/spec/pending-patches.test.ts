import { describe, expect, it } from "vitest";
import type { SpecItemPatch } from "../types";
import {
  mergePendingPatch,
  takePendingPatches,
  type PendingPatchEntry,
  type PendingPatchOptions,
} from "./pending-patches";

/**
 * Очередь в том виде, в каком её держит `useSpecPersistence`: одна карта на все
 * позиции, ключ — `spec_item_id`. Хук целиком в тест не загрузить (он тянет
 * server action и `server-only`), поэтому проверяем ровно ту часть, которая
 * решает задачу: склейку серии правок одной позиции и независимость позиций.
 */
function makeQueue() {
  let queue: Map<string, PendingPatchEntry> = new Map();
  return {
    push(id: string, patch: SpecItemPatch, options?: PendingPatchOptions) {
      queue = mergePendingPatch(queue, id, patch, options);
    },
    take() {
      return takePendingPatches(queue);
    },
    size: () => queue.size,
  };
}

/** Хук считает новое количество локально и кладёт в очередь абсолютное значение. */
const nextQty = (current: number, delta: number) =>
  Math.max(0.01, Math.round((current + delta) * 100) / 100);

const parseQty = (raw: string) =>
  Math.round(Number(raw.replace(/\s/g, "").replace(",", ".")) * 100) / 100;

describe("mergePendingPatch", () => {
  it("пять быстрых «+» дают одну мутацию 1 → 6", () => {
    const queue = makeQueue();
    let local = 1;

    for (let click = 0; click < 5; click++) {
      local = nextQty(local, 1);
      queue.push("item-1", { qty: local }, { explicitQuantity: true });
    }

    expect(queue.size()).toBe(1);
    const batch = queue.take();

    expect(batch).toHaveLength(1);
    expect(batch[0][0]).toBe("item-1");
    // Итоговое значение серии, а не пять промежуточных: одна mutation, одно
    // событие «1 → 6» (from сервер прочитает из БД).
    expect(batch[0][1].patch).toEqual({ qty: 6 });
    expect(batch[0][1].explicitQuantity).toBe(true);
  });

  it("пять «+» и один «−» дают итог 5", () => {
    const queue = makeQueue();
    let local = 1;

    for (const delta of [1, 1, 1, 1, 1, -1]) {
      local = nextQty(local, delta);
      queue.push("item-1", { qty: local }, { explicitQuantity: true });
    }

    expect(queue.take()[0][1].patch).toEqual({ qty: 5 });
  });

  it("разные позиции не объединяются и не блокируют друг друга", () => {
    const queue = makeQueue();
    let a = 1;
    let b = 5;

    a = nextQty(a, 1);
    b = nextQty(b, 1);
    queue.push("item-a", { qty: a }, { explicitQuantity: true });
    queue.push("item-b", { qty: b }, { explicitQuantity: true });
    a = nextQty(a, 1);
    queue.push("item-a", { qty: a }, { explicitQuantity: true });

    const batch = queue.take();

    expect(batch).toHaveLength(2);
    expect(batch.map(([id, entry]) => [id, entry.patch])).toEqual([
      ["item-a", { qty: 3 }],
      ["item-b", { qty: 6 }],
    ]);
  });

  it("ручной ввод внутри серии сохраняет только последнее значение", () => {
    const queue = makeQueue();

    for (const raw of ["12", "123"]) {
      queue.push("item-1", { qty: parseQty(raw) }, { explicitQuantity: true });
    }

    expect(queue.take()[0][1].patch).toEqual({ qty: 123 });
  });

  it("«+» и ручной ввод в одной серии дают один итог", () => {
    const queue = makeQueue();
    let local = 1;

    local = nextQty(local, 1);
    queue.push("item-1", { qty: local }, { explicitQuantity: true });
    local = nextQty(local, 1);
    queue.push("item-1", { qty: local }, { explicitQuantity: true });
    local = parseQty("5");
    queue.push("item-1", { qty: local }, { explicitQuantity: true });
    local = nextQty(local, 1);
    queue.push("item-1", { qty: local }, { explicitQuantity: true });

    const batch = queue.take();

    expect(batch).toHaveLength(1);
    expect(batch[0][1].patch).toEqual({ qty: 6 });
  });

  it("правка после сброса очереди начинает новую мутацию", () => {
    const queue = makeQueue();

    queue.push("item-1", { qty: 2 }, { explicitQuantity: true });
    expect(queue.take()).toHaveLength(1);

    queue.push("item-1", { qty: 3 }, { explicitQuantity: true });
    const second = queue.take();

    // Дебаунс истёк — это отдельный жест, отдельная mutation и отдельное
    // событие «2 → 3».
    expect(second).toHaveLength(1);
    expect(second[0][1].patch).toEqual({ qty: 3 });
  });

  it("одиночное изменение ведёт себя как раньше", () => {
    const queue = makeQueue();

    queue.push("item-1", { qty: 4 }, { explicitQuantity: true });
    const batch = queue.take();

    expect(batch).toHaveLength(1);
    expect(batch[0][1]).toEqual({
      patch: { qty: 4 },
      explicitQuantity: true,
      explicitSupplier: false,
      composite: false,
      cleared: false,
    });
  });

  it("сливает разные поля одной позиции в один патч", () => {
    const queue = makeQueue();

    queue.push("item-1", { qty: 3 }, { explicitQuantity: true });
    queue.push("item-1", { unit: "м²" });

    const batch = queue.take();

    expect(batch).toHaveLength(1);
    expect(batch[0][1].patch).toEqual({ qty: 3, unit: "м²" });
  });

  it("пометка количества накапливается по серии", () => {
    const markedFirst = makeQueue();
    markedFirst.push("item-1", { qty: 3 }, { explicitQuantity: true });
    markedFirst.push("item-1", { unit: "м²" });
    expect(markedFirst.take()[0][1].explicitQuantity).toBe(true);

    const markedLast = makeQueue();
    markedLast.push("item-1", { unit: "м²" });
    markedLast.push("item-1", { qty: 3 }, { explicitQuantity: true });
    expect(markedLast.take()[0][1].explicitQuantity).toBe(true);
  });

  it("составной жест без пометки остаётся без пометки", () => {
    // Ручное заполнение заглушки пишет qty, но событием количества не является:
    // оно остаётся за будущим filled.
    const queue = makeQueue();

    queue.push("item-1", { qty: 2, isPlaceholder: false, name: "Диван" });

    const entry = queue.take()[0][1];
    expect(entry.explicitQuantity).toBe(false);
    expect(entry.explicitSupplier).toBe(false);
  });

  it("пометки доменов независимы", () => {
    const quantityOnly = makeQueue();
    quantityOnly.push("item-1", { qty: 3 }, { explicitQuantity: true });
    const qEntry = quantityOnly.take()[0][1];
    expect(qEntry.explicitQuantity).toBe(true);
    expect(qEntry.explicitSupplier).toBe(false);

    const supplierOnly = makeQueue();
    supplierOnly.push(
      "item-1",
      { companyId: "c-a", contactId: "k-x" },
      { explicitSupplier: true },
    );
    const sEntry = supplierOnly.take()[0][1];
    expect(sEntry.explicitQuantity).toBe(false);
    expect(sEntry.explicitSupplier).toBe(true);
  });

  it("пометка поставщика накапливается по серии", () => {
    // Компания и менеджер выбираются двумя шагами, но остаются одним доменом:
    // серия должна дать одно событие supplier_changed с полными from/to.
    const queue = makeQueue();

    queue.push("item-1", { companyId: "c-b" }, { explicitSupplier: true });
    queue.push("item-1", { contactId: "k-y" }, { explicitSupplier: true });

    const batch = queue.take();

    expect(batch).toHaveLength(1);
    expect(batch[0][1].patch).toEqual({ companyId: "c-b", contactId: "k-y" });
    expect(batch[0][1].explicitSupplier).toBe(true);
  });

  it("серия обычных полей сохраняет последнее значение каждого", () => {
    // name: A → B → C внутри debounce: сервер получит C, а `from` прочитает из
    // БД, поэтому в истории окажется A → C, а не промежуточное A → B.
    const queue = makeQueue();

    queue.push("item-1", { name: "B" });
    queue.push("item-1", { name: "C" });
    queue.push("item-1", { brand: "Y" });

    const batch = queue.take();

    expect(batch).toHaveLength(1);
    expect(batch[0][1].patch).toEqual({ name: "C", brand: "Y" });
    expect(batch[0][1].composite).toBe(false);
  });

  it("составной жест помечается явно", () => {
    const queue = makeQueue();

    // Заполнение заглушки меняет сразу много обычных полей — но это `filled`,
    // а не набор полевых событий.
    queue.push("item-1", { name: "Диван", brand: "A" }, { composite: true });
    queue.push("item-1", { attrs: { цвет: "дуб" } });

    const batch = queue.take();

    expect(batch).toHaveLength(1);
    expect(batch[0][1].composite).toBe(true);
  });

  it("составной жест не помечает домены как явные", () => {
    const queue = makeQueue();

    queue.push("item-1", { qty: 2, companyId: "c-a" }, { composite: true });

    const entry = queue.take()[0][1];
    expect(entry.explicitQuantity).toBe(false);
    expect(entry.explicitSupplier).toBe(false);
  });

  it("происхождение заполнения переживает серию", () => {
    const queue = makeQueue();

    queue.push(
      "item-1",
      { name: "Диван", price: 15_500 },
      { composite: true, fillOrigin: "placeholder" },
    );
    // Следом в ту же серию попадает правка другого поля: событие заполнения
    // должно остаться заполнением из библиотеки.
    queue.push("item-1", { notes: "уточнить цвет" });

    const entry = queue.take()[0][1];
    expect(entry.fillOrigin).toBe("placeholder");
    expect(entry.composite).toBe(true);
  });

  it("обычная правка происхождения не получает", () => {
    const queue = makeQueue();

    queue.push("item-1", { name: "Стол" });

    const entry = queue.take()[0][1];
    expect(entry.fillOrigin).toBeUndefined();
    expect(entry.cleared).toBe(false);
  });

  it("очистка помечается отдельно от заполнения", () => {
    const queue = makeQueue();

    queue.push(
      "item-1",
      { name: "", brand: "", price: 0, isPlaceholder: true },
      { composite: true, cleared: true },
    );

    const entry = queue.take()[0][1];
    expect(entry.cleared).toBe(true);
    expect(entry.composite).toBe(true);
    // Очистка не заполняет: происхождения заполнения у неё нет.
    expect(entry.fillOrigin).toBeUndefined();
  });

  it("отмена очистки несёт своё происхождение заполнения", () => {
    const queue = makeQueue();

    queue.push(
      "item-1",
      { name: "Диван", isPlaceholder: false },
      { composite: true, fillOrigin: "undo" },
    );

    const entry = queue.take()[0][1];
    expect(entry.fillOrigin).toBe("undo");
    expect(entry.cleared).toBe(false);
  });

  it("не мутирует переданную очередь", () => {
    const first = new Map<string, PendingPatchEntry>();
    const second = mergePendingPatch(
      first,
      "item-1",
      { qty: 2 },
      { explicitQuantity: true },
    );

    expect(first.size).toBe(0);
    expect(second.size).toBe(1);
  });
});

describe("takePendingPatches", () => {
  it("очищает очередь: следующая правка не склеивается с отправленной", () => {
    const queue = mergePendingPatch(
      new Map<string, PendingPatchEntry>(),
      "item-1",
      { qty: 2 },
      { explicitQuantity: true },
    );

    const batch = takePendingPatches(queue);

    expect(batch).toHaveLength(1);
    expect(queue.size).toBe(0);
  });

  it("на пустой очереди возвращает пустой список", () => {
    expect(takePendingPatches(new Map())).toEqual([]);
  });
});
