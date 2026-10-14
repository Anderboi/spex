import { describe, expect, it } from "vitest";

import {
  cheapestMaterialSupplier,
  materialSupplierCountLabel,
  materialSupplierMirror,
  normalizeMaterialSuppliers,
  primaryMaterialSupplier,
  type MaterialSupplierDraft,
} from "./suppliers";

/**
 * Поставщики материала: правила выбора основного, «дешевле всех» и сборки зеркала
 * в колонки `materials`.
 *
 * Зеркало — не украшение: по нему список библиотеки показывает поставщика и цену,
 * по нему же материал попадает в проект и в фильтр «по компании». Поэтому здесь
 * отдельно закреплено, что пустой список не затирает собственную цену материала:
 * иначе материал, у которого сняли последнего поставщика, молча терял бы цену.
 */

const draft = (
  companyId: string | null,
  overrides: Partial<MaterialSupplierDraft> = {},
): MaterialSupplierDraft => ({
  company_id: companyId,
  contact_id: null,
  price: 0,
  product_url: null,
  ...overrides,
});

describe("normalizeMaterialSuppliers", () => {
  it("расставляет порядок по индексу", () => {
    const rows = normalizeMaterialSuppliers([
      draft("c-1"),
      draft("c-2"),
      draft("c-3"),
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("выбрасывает строки без компании", () => {
    // Так выглядит только что добавленная и ещё не заполненная строка формы.
    const rows = normalizeMaterialSuppliers([draft("c-1"), draft(null)]);
    expect(rows.map((r) => r.company_id)).toEqual(["c-1"]);
    // Порядок пересобирается: дыры после выброшенной строки не остаются.
    expect(rows[0].position).toBe(0);
  });

  it("схлопывает повтор компании в первое вхождение", () => {
    // Частичный уникальный индекс в БД не даст сохранить дубль: лучше схлопнуть
    // его здесь, чем показать пользователю ошибку констрейнта.
    const rows = normalizeMaterialSuppliers([
      draft("c-1", { price: 100 }),
      draft("c-1", { price: 200 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe(100);
  });

  it("пустая ссылка становится null, пробелы по краям срезаются", () => {
    const rows = normalizeMaterialSuppliers([
      draft("c-1", { product_url: "   " }),
      draft("c-2", { product_url: " https://example.com/x " }),
    ]);
    expect(rows[0].product_url).toBeNull();
    expect(rows[1].product_url).toBe("https://example.com/x");
  });

  it("на пустом списке отдаёт пустой список", () => {
    expect(normalizeMaterialSuppliers([])).toEqual([]);
  });
});

describe("primaryMaterialSupplier", () => {
  it("основной — первая строка", () => {
    const rows = normalizeMaterialSuppliers([
      draft("c-1", { price: 300 }),
      draft("c-2", { price: 100 }),
    ]);
    // Именно первый, а не самый дешёвый: пользователь расставляет порядок сам.
    expect(primaryMaterialSupplier(rows)?.company_id).toBe("c-1");
  });

  it("без поставщиков основного нет", () => {
    expect(primaryMaterialSupplier([])).toBeNull();
  });
});

describe("cheapestMaterialSupplier", () => {
  it("находит самую дешёвую цену", () => {
    const rows = normalizeMaterialSuppliers([
      draft("c-1", { price: 3500 }),
      draft("c-2", { price: 3200 }),
    ]);
    const cheapest = cheapestMaterialSupplier(rows);
    expect(cheapest?.row.company_id).toBe("c-2");
    expect(cheapest?.unique).toBe(true);
  });

  it("при равных минимальных ценах бейджа нет ни у кого", () => {
    const rows = normalizeMaterialSuppliers([
      draft("c-1", { price: 3200 }),
      draft("c-2", { price: 3200 }),
    ]);
    expect(cheapestMaterialSupplier(rows)?.unique).toBe(false);
  });

  it("единственная цена — ещё не «дешевле всех»", () => {
    const rows = normalizeMaterialSuppliers([
      draft("c-1", { price: 3200 }),
      draft("c-2", { price: 0 }),
    ]);
    const cheapest = cheapestMaterialSupplier(rows);
    expect(cheapest?.row.company_id).toBe("c-1");
    expect(cheapest?.unique).toBe(false);
  });

  it("нулевая цена предложением не считается", () => {
    // Ноль в библиотеке значит «цена не указана», а не «бесплатно».
    const rows = normalizeMaterialSuppliers([draft("c-1"), draft("c-2")]);
    expect(cheapestMaterialSupplier(rows)).toBeNull();
  });
});

describe("materialSupplierMirror", () => {
  it("зеркалит основного поставщика целиком", () => {
    const rows = normalizeMaterialSuppliers([
      draft("c-1", {
        contact_id: "k-1",
        price: 3500,
        product_url: "https://a.example/x",
      }),
      draft("c-2", { price: 3200 }),
    ]);

    expect(materialSupplierMirror(rows)).toEqual({
      company_id: "c-1",
      contact_id: "k-1",
      supplier_company_ids: ["c-1", "c-2"],
      price: 3500,
      product_url: "https://a.example/x",
    });
  });

  it("пустой список не затирает собственную цену материала", () => {
    // У материала без поставщика цена своя, и снятие последнего поставщика её не
    // трогает — как и раньше, когда компанию удаляли из справочника.
    expect(materialSupplierMirror([])).toEqual({
      company_id: null,
      contact_id: null,
      supplier_company_ids: [],
    });
  });

  it("массив компаний не содержит дублей и идёт в порядке строк", () => {
    const rows = normalizeMaterialSuppliers([
      draft("c-b"),
      draft("c-a"),
      draft("c-b"),
    ]);
    expect(materialSupplierMirror(rows).supplier_company_ids).toEqual([
      "c-b",
      "c-a",
    ]);
  });
});

describe("materialSupplierCountLabel", () => {
  it("выбирает русскую форму по числу", () => {
    expect(materialSupplierCountLabel(1)).toBe("1 поставщик");
    expect(materialSupplierCountLabel(2)).toBe("2 поставщика");
    expect(materialSupplierCountLabel(4)).toBe("4 поставщика");
    expect(materialSupplierCountLabel(5)).toBe("5 поставщиков");
    expect(materialSupplierCountLabel(11)).toBe("11 поставщиков");
    expect(materialSupplierCountLabel(21)).toBe("21 поставщик");
    expect(materialSupplierCountLabel(0)).toBe("0 поставщиков");
  });
});
