import { describe, expect, it } from "vitest";
import { TYPE_ORDER, UNIT_OPTIONS } from "../constants";
import type { MaterialImportDraft } from "./draft";
import {
  MATERIAL_FORM_DEFAULTS,
  materialImportDraftToFormValues,
  materialImportDraftToManualItemValues,
} from "./mapper";

/** Полный черновик: все поля заполнены. */
function fullDraft(overrides: Partial<MaterialImportDraft> = {}): MaterialImportDraft {
  return {
    sourceUrl: "https://shop.example.com/product/1",
    productUrl: "https://shop.example.com/product/1",
    name: "Керамогранит Calacatta",
    brand: "ABK",
    article: "KM-1024",
    category: "Отделка",
    productType: "Керамогранит",
    price: 6500,
    priceCurrency: "RUB",
    unit: "м²",
    imageUrl: "https://project.supabase.co/storage/v1/object/public/material-images/o/a.jpg",
    attrs: { "Формат": "120×278", "Поверхность": "Матовая" },
    ambiguous: [],
    requiresReview: false,
    evidence: [],
    usedSources: ["json-ld"],
    ...overrides,
  };
}

/** Пустой черновик: ничего не извлекли. */
function emptyDraft(overrides: Partial<MaterialImportDraft> = {}): MaterialImportDraft {
  return {
    sourceUrl: "https://shop.example.com/product/1",
    productUrl: "https://shop.example.com/product/1",
    name: null,
    brand: null,
    article: null,
    category: null,
    productType: null,
    price: null,
    priceCurrency: null,
    unit: null,
    imageUrl: null,
    attrs: {},
    ambiguous: [],
    requiresReview: true,
    evidence: [],
    usedSources: [],
    ...overrides,
  };
}

describe("materialImportDraftToFormValues: полный черновик", () => {
  it("переносит общие поля", () => {
    const values = materialImportDraftToFormValues(fullDraft());

    expect(values.name).toBe("Керамогранит Calacatta");
    expect(values.brand).toBe("ABK");
    expect(values.article).toBe("KM-1024");
    expect(values.category).toBe("Отделка");
    expect(values.product_type).toBe("Керамогранит");
    expect(values.price).toBe(6500);
    expect(values.unit).toBe("м²");
    expect(values.product_url).toBe("https://shop.example.com/product/1");
    expect(values.attrs).toEqual({ "Формат": "120×278", "Поверхность": "Матовая" });
  });

  it("не подставляет поставщика: его выбирает пользователь", () => {
    const values = materialImportDraftToFormValues(fullDraft());
    expect(values.company_id).toBeNull();
    expect(values.contact_id).toBeNull();
  });

  it("не назначает id: это создание, а не редактирование", () => {
    expect(materialImportDraftToFormValues(fullDraft()).id).toBeUndefined();
  });

  it("переносит Supabase-изображение", () => {
    const values = materialImportDraftToFormValues(fullDraft());
    expect(values.image_url).toContain("supabase.co");
  });
});

describe("materialImportDraftToFormValues: неполный черновик", () => {
  it("подставляет дефолты формы вместо пустых значений", () => {
    const values = materialImportDraftToFormValues(emptyDraft());

    // Текстовые поля в форме — строки, а не null.
    expect(values.name).toBe("");
    expect(values.brand).toBe("");
    expect(values.article).toBe("");
    // Дефолты ровно те же, что у формы создания.
    expect(values.category).toBe(MATERIAL_FORM_DEFAULTS.category);
    expect(values.unit).toBe(MATERIAL_FORM_DEFAULTS.unit);
    expect(values.price).toBe(0);
    expect(values.attrs).toEqual({});
    expect(values.product_type).toBeNull();
    expect(values.image_url).toBeNull();
  });

  it("null-цена превращается в 0, а не в null", () => {
    const values = materialImportDraftToFormValues(emptyDraft({ price: null }));
    expect(values.price).toBe(0);
    expect(typeof values.price).toBe("number");
  });

  it("цена в иностранной валюте остаётся нулевой — конвертации нет", () => {
    // Конвейер уже обнулил цену, оставив валюту для предпросмотра.
    const values = materialImportDraftToFormValues(
      emptyDraft({ price: null, priceCurrency: "EUR" }),
    );
    expect(values.price).toBe(0);
  });

  it("null-единица превращается в дефолт формы", () => {
    expect(materialImportDraftToFormValues(emptyDraft({ unit: null })).unit).toBe(
      MATERIAL_FORM_DEFAULTS.unit,
    );
  });

  it("null-категория превращается в дефолт формы", () => {
    expect(materialImportDraftToFormValues(emptyDraft({ category: null })).category).toBe(
      MATERIAL_FORM_DEFAULTS.category,
    );
  });

  it("категория вне TYPE_ORDER не попадает в форму", () => {
    const values = materialImportDraftToFormValues(
      emptyDraft({ category: "Ванная комната" }),
    );
    expect(values.category).toBe(MATERIAL_FORM_DEFAULTS.category);
    expect(TYPE_ORDER).toContain(values.category);
  });

  it("сохраняет любую категорию из TYPE_ORDER", () => {
    for (const category of TYPE_ORDER) {
      const values = materialImportDraftToFormValues(emptyDraft({ category }));
      expect(values.category, category).toBe(category);
    }
  });

  it("сохраняет свободный product_type", () => {
    const values = materialImportDraftToFormValues(
      emptyDraft({ category: "Сантехника", productType: "Смеситель для раковины" }),
    );
    // Значение может не совпадать ни с одним пресетом — UI разрешает free text.
    expect(values.product_type).toBe("Смеситель для раковины");
  });

  it("сохраняет attrs как есть", () => {
    const attrs = { "порода": "Дуб", "толщина": "13 мм", "RAL": "9003" };
    expect(materialImportDraftToFormValues(emptyDraft({ attrs })).attrs).toEqual(attrs);
  });

  it("не отдаёт внешнюю ссылку на изображение в форму", () => {
    // Конвейер обнуляет `imageUrl`, если перехостинг не удался. Даже если бы
    // внешний URL как-то дошёл до черновика, маппер его не «придумывает»:
    // он переносит ровно то, что лежит в черновике.
    const values = materialImportDraftToFormValues(
      emptyDraft({ imageUrl: null }),
    );
    expect(values.image_url).toBeNull();
  });
});

describe("materialImportDraftToFormValues: чистота", () => {
  it("не мутирует черновик", () => {
    const draft = fullDraft();
    const snapshot = JSON.parse(JSON.stringify(draft));

    const values = materialImportDraftToFormValues(draft);
    values.attrs["Новый ключ"] = "значение";

    expect(JSON.parse(JSON.stringify(draft))).toEqual(snapshot);
  });

  it("возвращает новый объект attrs, а не ссылку на черновик", () => {
    const draft = fullDraft();
    const values = materialImportDraftToFormValues(draft);
    expect(values.attrs).not.toBe(draft.attrs);
  });

  it("детерминирована: одинаковый вход — одинаковый выход", () => {
    const draft = fullDraft();
    expect(materialImportDraftToFormValues(draft)).toEqual(
      materialImportDraftToFormValues(draft),
    );
  });
});

describe("materialImportDraftToManualItemValues: перенос в форму позиции", () => {
  it("переименовывает поля в имена ManualItemForm", () => {
    const values = materialImportDraftToManualItemValues(fullDraft());

    expect(values).toEqual({
      name: "Керамогранит Calacatta",
      brand: "ABK",
      article: "KM-1024",
      type: "Отделка",
      productType: "Керамогранит",
      unit: "м²",
      price: 6500,
      imageUrl:
        "https://project.supabase.co/storage/v1/object/public/material-images/o/a.jpg",
      productUrl: "https://shop.example.com/product/1",
      attrs: { "Формат": "120×278", "Поверхность": "Матовая" },
    });
  });

  it("не отдаёт описание: в черновике его нет", () => {
    // `spec` — «Описание» формы позиции. Конвейер описания не сохраняет, и
    // выдумывать его нельзя: поле остаётся дефолтным (пустым).
    expect(
      Object.prototype.hasOwnProperty.call(
        materialImportDraftToManualItemValues(fullDraft()),
        "spec",
      ),
    ).toBe(false);
  });

  it("неполный импорт даёт значения формы, а не ошибку", () => {
    const values = materialImportDraftToManualItemValues(emptyDraft());

    expect(values.name).toBe("");
    expect(values.brand).toBe("");
    expect(values.article).toBe("");
    expect(values.type).toBe(MATERIAL_FORM_DEFAULTS.category);
    expect(values.productType).toBe("");
    expect(values.unit).toBe(MATERIAL_FORM_DEFAULTS.unit);
    expect(values.price).toBe(0);
    expect(values.imageUrl).toBeNull();
    expect(values.productUrl).toBe("https://shop.example.com/product/1");
    expect(values.attrs).toEqual({});
  });

  it("категория вне TYPE_ORDER не попадает в форму", () => {
    const values = materialImportDraftToManualItemValues(
      emptyDraft({ category: "Ванная комната" }),
    );
    expect(TYPE_ORDER).toContain(values.type);
    expect(values.type).toBe(MATERIAL_FORM_DEFAULTS.category);
  });

  it("единица вне UNIT_OPTIONS не попадает в форму", () => {
    // В форме единица — закрытый `<select>` по UNIT_OPTIONS.
    const values = materialImportDraftToManualItemValues(
      emptyDraft({ unit: "банка" }),
    );
    expect(UNIT_OPTIONS).toContain(values.unit);
    expect(values.unit).toBe(MATERIAL_FORM_DEFAULTS.unit);
  });

  it("сохраняет свободный тип внутри категории", () => {
    const values = materialImportDraftToManualItemValues(
      emptyDraft({ category: "Сантехника", productType: "Смеситель для раковины" }),
    );
    expect(values.productType).toBe("Смеситель для раковины");
  });

  it("возвращает новый объект attrs и не мутирует черновик", () => {
    const draft = fullDraft();
    const snapshot = JSON.parse(JSON.stringify(draft));

    const values = materialImportDraftToManualItemValues(draft);
    values.attrs["Новый ключ"] = "значение";

    expect(values.attrs).not.toBe(draft.attrs);
    expect(JSON.parse(JSON.stringify(draft))).toEqual(snapshot);
  });
});
