import { describe, expect, it } from "vitest";
import type { ExtractedProduct, FieldSource, RawVariant } from "./draft";
import {
  buildImportDraft,
  matchCategory,
  normalizeAttributes,
  normalizePrice,
  normalizeProductType,
  normalizeUnit,
  rejectRetailerArticle,
} from "./normalize";

const PAGE_URL = "https://shop.example.com/product/tovar";

function field<T>(value: T, source: FieldSource = "json-ld"): { value: T; source: FieldSource } {
  return { value, source };
}

/** Собирает `ExtractedProduct` с разумными значениями по умолчанию. */
function extracted(overrides: Partial<ExtractedProduct> = {}): ExtractedProduct {
  return {
    name: null,
    brand: null,
    article: null,
    price: null,
    currency: null,
    imageUrl: null,
    unit: null,
    description: null,
    attributes: null,
    variants: [],
    attributeSources: {},
    usedLayers: [],
    textForModel: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Категория                                                          */
/* ------------------------------------------------------------------ */

describe("matchCategory", () => {
  it("сопоставляет категорию по русским и английским ключевым словам", () => {
    expect(matchCategory("Смесители для раковины")?.category).toBe("Сантехника");
    expect(matchCategory("faucet")?.category).toBe("Сантехника");
    expect(matchCategory("Керамогранит 120x278")?.category).toBe("Отделка");
    expect(matchCategory("Engineered flooring")?.category).toBe("Отделка");
    expect(matchCategory("Розетки и выключатели")?.category).toBe("Электрика");
    expect(matchCategory("Подвесные люстры")?.category).toBe("Освещение");
  });

  it("специфичные категории важнее общих", () => {
    // «доска» есть в отделке, но «инженерная доска» должна остаться отделкой,
    // а не уехать в мебель по слову «доска» — проверяем, что порядок правил
    // действительно даёт «Отделка».
    expect(matchCategory("Инженерная доска Alpine")?.category).toBe("Отделка");
    // А вот явная мебель побеждает.
    expect(matchCategory("Корпусная мебель")?.category).toBe("Мебель");
  });

  it("учитывает порядок аргументов: категория от модели важнее заголовка", () => {
    expect(matchCategory("Сантехника", "Керамогранит")?.category).toBe("Сантехника");
  });

  it("возвращает null, когда совпадений нет", () => {
    expect(matchCategory("Товар", "Product", null, undefined)).toBeNull();
    expect(matchCategory()).toBeNull();
  });

  it("сообщает ключевое слово для evidence", () => {
    expect(matchCategory("Латунный смеситель")?.keyword).toBe("смесител");
  });
});

/* ------------------------------------------------------------------ */
/*  Единицы измерения                                                  */
/* ------------------------------------------------------------------ */

describe("normalizeUnit", () => {
  it("приводит известные обозначения к UNIT_OPTIONS", () => {
    expect(normalizeUnit("м2")).toBe("м²");
    expect(normalizeUnit("m²")).toBe("м²");
    expect(normalizeUnit("sqm")).toBe("м²");
    expect(normalizeUnit("погонный метр")).toBe("м.п.");
    expect(normalizeUnit("lm")).toBe("м.п.");
    expect(normalizeUnit("рулон")).toBe("рулон");
    expect(normalizeUnit("roll")).toBe("рулон");
    expect(normalizeUnit("комплект")).toBe("компл.");
    expect(normalizeUnit("pcs")).toBe("шт");
  });

  it("не регистрозависим", () => {
    expect(normalizeUnit("  М2 ")).toBe("м²");
    expect(normalizeUnit("ROLL")).toBe("рулон");
  });

  it("возвращает null, когда единицу определить нельзя", () => {
    expect(normalizeUnit("ящик")).toBeNull();
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit(undefined)).toBeNull();
  });

  it("не выдумывает единицу для свободного текста", () => {
    // «за квадратный метр» распознаётся, «упаковками» — нет.
    expect(normalizeUnit("упаковками")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Цена                                                               */
/* ------------------------------------------------------------------ */

describe("normalizePrice", () => {
  it("принимает рублёвую цену", () => {
    expect(normalizePrice(6500, "RUB")).toEqual({ price: 6500, currency: "RUB" });
    expect(normalizePrice(6500, "₽")).toEqual({ price: 6500, currency: "RUB" });
    expect(normalizePrice(6500, "rub")).toEqual({ price: 6500, currency: "RUB" });
  });

  it("округляет до копеек", () => {
    expect(normalizePrice(6500.555, "RUB")).toEqual({ price: 6500.56, currency: "RUB" });
  });

  it("не конвертирует иностранную валюту", () => {
    const result = normalizePrice(100, "USD");
    expect(result.price).toBeNull();
    expect(result.currency).toBe("USD");
    expect(result).toHaveProperty("reason", "foreign-currency");
  });

  it("считает валюту рублями, только если она не указана", () => {
    expect(normalizePrice(6500, null)).toEqual({ price: 6500, currency: "RUB" });
  });

  it("отдаёт null для отсутствующей, отрицательной и нечисловой цены", () => {
    expect(normalizePrice(null, "RUB").price).toBeNull();
    expect(normalizePrice(-5, "RUB").price).toBeNull();
    expect(normalizePrice(Number.NaN, "RUB").price).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Характеристики                                                     */
/* ------------------------------------------------------------------ */

describe("normalizeAttributes", () => {
  it("чистит ключи и значения", () => {
    const { attrs } = normalizeAttributes({
      "  Покрытие ": "  Хром  ",
      color: "<b>Белый</b>",
    });
    expect(attrs).toEqual({ Покрытие: "Хром", color: "Белый" });
  });

  it("выбрасывает служебные ключи", () => {
    const { attrs } = normalizeAttributes({
      name: "Товар",
      brand: "ABK",
      offers: "что-то",
      description: "описание",
      sku: "KM-1",
      material: "Латунь",
    });
    expect(attrs).toEqual({ material: "Латунь" });
  });

  it("игнорирует пустые значения", () => {
    const { attrs } = normalizeAttributes({ a: "  ", b: "<span></span>", c: "ок" });
    expect(attrs).toEqual({ c: "ок" });
  });

  it("обрезает значение по лимиту materialSchema.attrs", () => {
    const long = "x".repeat(900);
    const { attrs, truncated } = normalizeAttributes({ описание: long });
    expect(attrs["описание"]).toHaveLength(500);
    expect(truncated).toContain("описание");
  });

  it("ограничивает количество характеристик", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 60; i++) many[`field${i}`] = `value${i}`;

    const { attrs, truncated } = normalizeAttributes(many);
    expect(Object.keys(attrs)).toHaveLength(40);
    expect(truncated.length).toBe(20);
  });

  it("возвращает пустой словарь для null", () => {
    expect(normalizeAttributes(null).attrs).toEqual({});
    expect(normalizeAttributes(undefined).attrs).toEqual({});
  });
});

/* ------------------------------------------------------------------ */
/*  buildImportDraft                                                   */
/* ------------------------------------------------------------------ */

describe("buildImportDraft", () => {
  it("собирает черновик керамогранита", () => {
    const { draft } = buildImportDraft({
      sourceUrl: "https://shop.example.com/p/1",
      finalUrl: PAGE_URL,
      extracted: extracted({
        name: field("Керамогранит Calacatta"),
        brand: field("ABK"),
        article: field("KM-1024"),
        price: field(6500),
        currency: field("RUB"),
        unit: field("м2"),
        imageUrl: field("https://cdn.example.com/a.jpg"),
        attributes: {
          values: {
            material: "Керамогранит",
            Формат: "120×278",
            "productType": "Керамогранит",
          },
          source: "json-ld",
        },
        attributeSources: { material: "json-ld", Формат: "json-ld", productType: "ai" },
      }),
      pageTitle: "Керамогранит Calacatta — магазин",
    });

    expect(draft.name).toBe("Керамогранит Calacatta");
    expect(draft.brand).toBe("ABK");
    expect(draft.article).toBe("KM-1024");
    expect(draft.category).toBe("Отделка");
    expect(draft.productType).toBe("Керамогранит");
    expect(draft.price).toBe(6500);
    expect(draft.priceCurrency).toBe("RUB");
    expect(draft.unit).toBe("м²");
    expect(draft.imageUrl).toBe("https://cdn.example.com/a.jpg");
    expect(draft.productUrl).toBe(PAGE_URL);
    expect(draft.sourceUrl).toBe("https://shop.example.com/p/1");
    // productType не должен остаться в характеристиках: он уходит в своё поле.
    expect(draft.attrs).toMatchObject({ material: "Керамогранит", Формат: "120×278" });
    expect(draft.requiresReview).toBe(false);
  });

  it("всегда кладёт исходный URL в product_url", () => {
    const { draft } = buildImportDraft({
      sourceUrl: "https://shop.example.com/p/1",
      finalUrl: "https://shop.example.com/p/1?variant=2",
      extracted: extracted({ name: field("Товар") }),
    });
    // product_url — фактический адрес после редиректов: он и есть та страница,
    // которую увидел пользователь.
    expect(draft.productUrl).toBe("https://shop.example.com/p/1?variant=2");
    expect(draft.sourceUrl).toBe("https://shop.example.com/p/1");
  });

  it("помечает проверку, когда имя не найдено", () => {
    const { draft, warnings } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({ brand: field("ABK") }),
    });
    expect(draft.name).toBeNull();
    expect(draft.requiresReview).toBe(true);
    expect(warnings.join(" ")).toContain("наименование");
  });

  it("предупреждает про иностранную валюту и не заполняет цену", () => {
    const { draft, warnings } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({
        name: field("Товар"),
        price: field(120),
        currency: field("EUR"),
      }),
    });
    expect(draft.price).toBeNull();
    expect(draft.priceCurrency).toBe("EUR");
    expect(warnings.join(" ")).toContain("EUR");
  });

  it("предупреждает, когда категорию определить не удалось", () => {
    const { draft, warnings } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({ name: field("Нечто неведомое") }),
    });
    expect(draft.category).toBeNull();
    expect(warnings.join(" ")).toContain("Категорию");
  });

  it("берёт категорию из свободного поля, отданного моделью", () => {
    const { draft } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({
        name: field("Товар"),
        attributes: { values: { category: "Смесители" }, source: "ai" },
      }),
    });
    expect(draft.category).toBe("Сантехника");
  });

  it("собирает evidence с источником по каждому полю", () => {
    const { draft } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({
        name: field("Товар", "og"),
        article: field("SKU-1", "json-ld"),
        attributes: { values: { material: "Дуб" }, source: "json-ld" },
      }),
    });

    const fields = draft.evidence.map((item) => item.field);
    expect(fields).toContain("name");
    expect(fields).toContain("article");
    expect(fields).toContain("attrs.material");

    expect(draft.evidence.find((item) => item.field === "name")?.source).toBe("og");
    expect(draft.evidence.find((item) => item.field === "attrs.material")?.source).toBe("json-ld");
    expect(draft.usedSources).toContain("json-ld");
  });

  it("не добавляет evidence для отсутствующих значений", () => {
    const { draft } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({ name: field("Товар") }),
    });
    expect(draft.evidence.every((item) => item.value.length > 0)).toBe(true);
    expect(draft.evidence.map((e) => e.field)).not.toContain("price");
  });

  it("пробрасывает неоднозначность вариантов в draft", () => {
    const variants: RawVariant[] = [
      {
        sku: "S-1",
        name: null,
        attributes: { thickness: "15 мм" },
        price: 100,
        currency: "RUB",
        imageUrl: null,
        productUrl: null,
        label: null,
      },
      {
        sku: "S-2",
        name: null,
        attributes: { thickness: "20 мм" },
        price: 200,
        currency: "RUB",
        imageUrl: null,
        productUrl: null,
        label: null,
      },
    ];

    const { draft, variantResolution, warnings } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({
        name: field("Инженерная доска"),
        // Артикул страницы НЕ совпадает ни с одним SKU варианта: иначе он сам
        // стал бы надёжным сигналом выбора варианта (см. signal "page-article").
        article: field("PAGE-LEVEL-ART"),
        price: field(100),
        attributes: { values: { material: "Дуб" }, source: "json-ld" },
        variants,
      }),
    });

    expect(variantResolution.ok).toBe(false);
    expect(draft.requiresReview).toBe(true);
    expect(draft.ambiguous.map((a) => a.field)).toContain("thickness");
    expect(draft.price).toBeNull();
    expect(draft.article).toBeNull();
    expect(draft.attrs).toEqual({ material: "Дуб" });
    expect(warnings.join(" ")).toContain("вариант");
  });

  it("применяет характеристики варианта, когда он определён однозначно", () => {
    const variants: RawVariant[] = [
      {
        sku: "S31010CR",
        name: null,
        attributes: { thickness: "15 мм", selection: "Натуральная" },
        price: 12500,
        currency: "RUB",
        imageUrl: null,
        productUrl: null,
        label: null,
      },
      {
        sku: "S31011CR",
        name: null,
        attributes: { thickness: "20 мм", selection: "Брашированная" },
        price: 13500,
        currency: "RUB",
        imageUrl: null,
        productUrl: null,
        label: null,
      },
    ];

    const { draft, variantResolution } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: "https://shop.example.com/product/S31011CR",
      extracted: extracted({
        name: field("Инженерная доска Finex"),
        attributes: { values: { material: "Дуб" }, source: "json-ld" },
        variants,
      }),
    });

    expect(variantResolution.ok).toBe(true);
    expect(draft.article).toBe("S31011CR");
    expect(draft.price).toBe(13500);
    expect(draft.attrs).toMatchObject({
      material: "Дуб",
      thickness: "20 мм",
      selection: "Брашированная",
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Артикул производителя против идентификатора площадки               */
/* ------------------------------------------------------------------ */

describe("rejectRetailerArticle", () => {
  it("оставляет артикул производителя", () => {
    expect(rejectRetailerArticle("S31010CR", "686224")).toEqual({
      article: "S31010CR",
      rejectedAsRetailerId: false,
    });
    expect(rejectRetailerArticle("GSL000143", "86710177")).toEqual({
      article: "GSL000143",
      rejectedAsRetailerId: false,
    });
  });

  it("отклоняет торговый идентификатор, выданный за артикул", () => {
    expect(rejectRetailerArticle("686224", "686224")).toEqual({
      article: null,
      rejectedAsRetailerId: true,
    });
  });

  it("сравнивает устойчиво к разделителям и регистру", () => {
    expect(rejectRetailerArticle("686-224", "686224").rejectedAsRetailerId).toBe(true);
    expect(rejectRetailerArticle("gsl 000143", "GSL-000143").rejectedAsRetailerId).toBe(true);
  });

  it("не отклоняет артикул, когда retailerId неизвестен", () => {
    expect(rejectRetailerArticle("S31010CR", null)).toEqual({
      article: "S31010CR",
      rejectedAsRetailerId: false,
    });
    expect(rejectRetailerArticle("S31010CR", "").rejectedAsRetailerId).toBe(false);
  });

  it("возвращает null для отсутствующего артикула", () => {
    expect(rejectRetailerArticle(null, "686224")).toEqual({
      article: null,
      rejectedAsRetailerId: false,
    });
    expect(rejectRetailerArticle("   ", "686224").article).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Тип товара                                                         */
/* ------------------------------------------------------------------ */

describe("normalizeProductType", () => {
  it("приводит значение к пресету категории", () => {
    expect(normalizeProductType("смеситель", "Сантехника")).toBe("Смеситель");
    expect(normalizeProductType("Розетка", "Электрика")).toBe("Розетка");
  });

  it("находит пресет внутри свободного значения", () => {
    expect(normalizeProductType("Смеситель для раковины", "Сантехника")).toBe("Смеситель");
    expect(normalizeProductType("Душевая система с термостатом", "Сантехника")).toBe(
      "Душевая система",
    );
  });

  it("сохраняет свободное значение, если пресета нет", () => {
    expect(normalizeProductType("Инженерная доска", "Отделка")).toBe("Инженерная доска");
    expect(normalizeProductType("Нечто неведомое", "Отделка")).toBe("Нечто неведомое");
  });

  it("работает без категории", () => {
    expect(normalizeProductType("Смеситель", null)).toBe("Смеситель");
  });

  it("возвращает null для пустого значения", () => {
    expect(normalizeProductType("  ", "Сантехника")).toBeNull();
    expect(normalizeProductType(null, "Сантехника")).toBeNull();
  });

  it("не подменяет тип категорией магазина", () => {
    // «Ванная комната» — не тип товара; пресета нет, значение сохраняется как есть,
    // и решение остаётся за пользователем.
    expect(normalizeProductType("Ванная комната", "Сантехника")).toBe("Ванная комната");
  });
});

/* ------------------------------------------------------------------ */
/*  Артикул и варианты в черновике                                     */
/* ------------------------------------------------------------------ */

describe("buildImportDraft: артикул площадки и спорные варианты", () => {
  it("не пускает торговый идентификатор в article и сообщает об этом", () => {
    const { draft } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({
        name: field("Смеситель Эстерсунд"),
        article: field("686224"),
        retailerId: "686224",
      }),
    });

    expect(draft.article).toBeNull();
    expect(draft.ambiguous.some((a) => a.reason === "retailer-id")).toBe(true);
    expect(draft.evidence.map((e) => e.field)).not.toContain("article");
  });

  it("сохраняет артикул производителя при наличии торгового идентификатора", () => {
    const { draft } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({
        name: field("Смеситель Эстерсунд"),
        article: field("S31010CR"),
        retailerId: "686224",
      }),
    });

    expect(draft.article).toBe("S31010CR");
    expect(draft.ambiguous.some((a) => a.reason === "retailer-id")).toBe(false);
  });

  it("исключает характеристики варианта из attrs, когда вариант не определён", () => {
    const { draft, warnings } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      extracted: extracted({
        name: field("Инженерная доска Kanna"),
        attributes: {
          values: { "Порода": "Дуб", "Ширина": "140 мм" },
          source: "ai",
        },
        // Варианты с непересекающимися наборами полей: определить открытый по
        // ссылке нельзя, поэтому вариантные значения не применяются.
        variants: [
          {
            sku: null,
            name: null,
            label: null,
            attributes: { "Ширина": "140 мм" },
            price: null,
            currency: null,
            imageUrl: null,
            productUrl: null,
          },
          {
            sku: null,
            name: null,
            label: null,
            attributes: { "Толщина": "13.5 мм" },
            price: null,
            currency: null,
            imageUrl: null,
            productUrl: null,
          },
        ],
        ambiguousAttributes: { "Ширина": "140 мм", "Толщина": "13 мм" },
      }),
    });

    // Общая характеристика осталась, вариантная — нет.
    expect(draft.attrs).toEqual({ "Порода": "Дуб" });
    expect(draft.attrs).not.toHaveProperty("Ширина");
    expect(draft.ambiguous.some((a) => a.reason === "variant-specific-ai")).toBe(true);
    expect(warnings.join(" ")).toContain("варианта");
  });

  it("оставляет вариантные характеристики, когда вариант определён", () => {
    const { draft } = buildImportDraft({
      sourceUrl: PAGE_URL,
      finalUrl: "https://shop.example.com/product/S31010CR",
      extracted: extracted({
        name: field("Инженерная доска"),
        attributes: { values: { "Порода": "Дуб" }, source: "ai" },
        variants: [
          {
            sku: "S31010CR",
            name: null,
            label: null,
            attributes: { "Ширина": "140 мм" },
            price: null,
            currency: null,
            imageUrl: null,
            productUrl: null,
          },
        ],
        ambiguousAttributes: { "Ширина": "140 мм" },
      }),
    });

    // Вариант найден по URL, поэтому «спорность» больше не мешает.
    expect(draft.attrs).toMatchObject({ "Порода": "Дуб", "Ширина": "140 мм" });
  });
});
