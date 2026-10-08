import { describe, expect, it } from "vitest";

import {
  hasServiceNamed,
  isReservedServiceName,
  isServiceLinkedToItem,
  matchesServiceQuery,
  normalizeServiceName,
  serviceCatalog,
  serviceUpdateFields,
  toCatalogEntry,
} from "./service-catalog";
import type { ServiceOperation } from "@/actions/service-operations";

/**
 * Справочник услуг карточки материала строится из операций проекта: отдельной
 * таблицы услуг нет, и каталог — это те же `service_operations`.
 *
 * Здесь проверяются правила, на которые опирается combobox: порядок групп,
 * поиск, распознавание дубликата по названию, зарезервированные имена
 * фиксированных типов и поля обновления при привязке существующей услуги к
 * материалу. Ни одно из этих правил не живёт в компоненте — иначе его нельзя
 * было бы проверить без рендера.
 */

function op(overrides: Partial<ServiceOperation> = {}): ServiceOperation {
  return {
    id: "op-1",
    type: "service",
    name: "Подъём на этаж",
    amount: 3000,
    completed: false,
    deadline: null,
    contractor_company_id: null,
    contractor_name: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    spec_item_ids: ["item-1"],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Порядок                                                           */
/* ------------------------------------------------------------------ */

describe("serviceCatalog · порядок", () => {
  it("«Доставка» и «Монтаж» идут первыми, свои услуги — после них", () => {
    const catalog = serviceCatalog([
      op({ id: "s-1", name: "Подъём на этаж" }),
      op({ id: "i-1", type: "installation", name: null }),
      op({ id: "s-2", name: "Хранение на складе" }),
      op({ id: "d-1", type: "delivery", name: null }),
    ]);

    expect(catalog.map((e) => e.key)).toEqual(["d-1", "i-1", "s-1", "s-2"]);
    expect(catalog.map((e) => e.label)).toEqual([
      "Доставка",
      "Монтаж",
      "Подъём на этаж",
      "Хранение на складе",
    ]);
  });

  it("порядок внутри группы — серверный, клиент его не меняет", () => {
    const catalog = serviceCatalog([
      op({ id: "d-new", type: "delivery", name: null }),
      op({ id: "d-old", type: "delivery", name: null }),
    ]);

    expect(catalog.map((e) => e.key)).toEqual(["d-new", "d-old"]);
  });

  it("подпись своей услуги — её название; у доставки и монтажа — из конфига", () => {
    const [delivery, own] = serviceCatalog([
      op({ id: "d-1", type: "delivery", name: null }),
      op({ id: "s-1", name: "Уборка" }),
    ]);

    expect(delivery.label).toBe("Доставка");
    expect(own.label).toBe("Уборка");
  });

  it("пустой каталог — пустой список", () => {
    expect(serviceCatalog([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Связь с материалом                                                */
/* ------------------------------------------------------------------ */

describe("serviceCatalog · связь с материалом", () => {
  it("материал уже в услуге — строка помечена как связанная", () => {
    const entry = toCatalogEntry(
      op({ id: "d-1", type: "delivery", name: null, spec_item_ids: ["item-1"] }),
    );

    expect(isServiceLinkedToItem(entry, "item-1")).toBe(true);
    expect(isServiceLinkedToItem(entry, "item-2")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Поиск                                                             */
/* ------------------------------------------------------------------ */

describe("serviceCatalog · поиск", () => {
  const catalog = serviceCatalog([
    op({ id: "d-1", type: "delivery", name: null }),
    op({ id: "i-1", type: "installation", name: null }),
    op({ id: "s-1", name: "Подъём на этаж" }),
  ]);

  it("пустой запрос не фильтрует", () => {
    expect(catalog.filter((e) => matchesServiceQuery(e, ""))).toHaveLength(3);
    expect(catalog.filter((e) => matchesServiceQuery(e, "   "))).toHaveLength(3);
  });

  it("«мон» оставляет только «Монтаж»", () => {
    const found = catalog.filter((e) => matchesServiceQuery(e, "мон"));

    expect(found.map((e) => e.label)).toEqual(["Монтаж"]);
  });

  it("регистр запроса не важен", () => {
    const found = catalog.filter((e) => matchesServiceQuery(e, "ПОДЪЁМ"));

    expect(found.map((e) => e.label)).toEqual(["Подъём на этаж"]);
  });

  it("совпадение по подстроке внутри названия", () => {
    const found = catalog.filter((e) => matchesServiceQuery(e, "ъём"));

    expect(found.map((e) => e.label)).toEqual(["Подъём на этаж"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Дубликаты                                                         */
/* ------------------------------------------------------------------ */

describe("serviceCatalog · дубликаты", () => {
  const catalog = serviceCatalog([
    op({ id: "d-1", type: "delivery", name: null }),
    op({ id: "s-1", name: "Подъём на этаж" }),
  ]);

  it("точное название своей услуги — дубликат", () => {
    expect(hasServiceNamed(catalog, "Подъём на этаж")).toBe(true);
  });

  it("регистр и пробелы по краям не делают название новым", () => {
    expect(hasServiceNamed(catalog, "  подъём НА этаж ")).toBe(true);
  });

  it("подпись фиксированной услуги — тоже дубликат", () => {
    expect(hasServiceNamed(catalog, "доставка")).toBe(true);
    expect(hasServiceNamed(catalog, "Монтаж")).toBe(false);
  });

  it("новое название дубликатом не считается", () => {
    expect(hasServiceNamed(catalog, "Монтаж стен")).toBe(false);
  });

  it("пустой ввод дубликатом не считается", () => {
    expect(hasServiceNamed(catalog, "   ")).toBe(false);
  });

  it("нормализация сравнивает только регистр и края", () => {
    expect(normalizeServiceName("  Доставка ")).toBe("доставка");
    expect(normalizeServiceName("Подъём  на этаж")).toBe("подъём  на этаж");
  });
});

/* ------------------------------------------------------------------ */
/*  Зарезервированные имена                                           */
/* ------------------------------------------------------------------ */

describe("serviceCatalog · имена фиксированных типов", () => {
  it("«Доставка» и «Монтаж» зарезервированы за своими типами", () => {
    expect(isReservedServiceName("Доставка")).toBe(true);
    expect(isReservedServiceName("  монтаж ")).toBe(true);
  });

  it("название, лишь начинающееся с зарезервированного, свободно", () => {
    expect(isReservedServiceName("Доставка материалов")).toBe(false);
    expect(isReservedServiceName("Монтаж стен")).toBe(false);
    expect(isReservedServiceName("Подъём на этаж")).toBe(false);
  });

  it("пустой ввод зарезервированным не считается", () => {
    expect(isReservedServiceName("   ")).toBe(false);
  });

  it("имя занято и без услуг в проекте: проверка не зависит от каталога", () => {
    // hasServiceNamed смотрит в существующие операции, а зарезервированное имя
    // нельзя занять всегда — иначе своя услуга «Доставка» появилась бы раньше
    // самой доставки и подменила её.
    expect(hasServiceNamed([], "Доставка")).toBe(false);
    expect(isReservedServiceName("Доставка")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Привязка существующей услуги                                      */
/* ------------------------------------------------------------------ */

describe("serviceUpdateFields · привязка существующей услуги", () => {
  it("материал добавляется к позициям операции, остальное не меняется", () => {
    const fields = serviceUpdateFields(
      op({
        id: "s-1",
        name: "Уборка",
        amount: 4500,
        deadline: "2026-05-01",
        contractor_company_id: "company-1",
        notes: "после монтажа",
        spec_item_ids: ["item-1"],
      }),
      "item-2",
    );

    expect(fields).toEqual({
      type: "service",
      name: "Уборка",
      specItemIds: ["item-1", "item-2"],
      amount: 4500,
      completed: false,
      deadline: "2026-05-01",
      contractorCompanyId: "company-1",
      notes: "после монтажа",
    });
  });

  it("уже связанный материал не дублируется — повторный выбор безопасен", () => {
    const fields = serviceUpdateFields(
      op({ spec_item_ids: ["item-1", "item-2"] }),
      "item-2",
    );

    expect(fields.specItemIds).toEqual(["item-1", "item-2"]);
  });

  it("у доставки и монтажа название остаётся null: подпись фиксирована", () => {
    const fields = serviceUpdateFields(
      op({ id: "d-1", type: "delivery", name: null, spec_item_ids: ["item-1"] }),
      "item-2",
    );

    expect(fields.type).toBe("delivery");
    expect(fields.name).toBeNull();
    expect(fields.specItemIds).toEqual(["item-1", "item-2"]);
  });

  it("отметка «исполнено» у доставки сохраняется", () => {
    const fields = serviceUpdateFields(
      op({ id: "d-1", type: "delivery", name: null, completed: true }),
      "item-2",
    );

    expect(fields.completed).toBe(true);
  });

  it("пустой комментарий передаётся пустой строкой, а не null", () => {
    const fields = serviceUpdateFields(op({ notes: null }), "item-2");

    expect(fields.notes).toBe("");
  });
});
