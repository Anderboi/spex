import { describe, expect, it } from "vitest";
import type { RawVariant } from "./draft";
import {
  normalizeSku,
  resolveVariant,
  variantSpecificFields,
  type ResolveVariantInput,
} from "./variants";

const PAGE_URL = "https://finex.example.com/catalog/engineered-wood";

function variant(partial: Partial<RawVariant> & { sku?: string | null }): RawVariant {
  return {
    sku: null,
    name: null,
    attributes: {},
    price: null,
    currency: null,
    imageUrl: null,
    productUrl: null,
    label: null,
    ...partial,
  };
}

function input(overrides: Partial<ResolveVariantInput> = {}): ResolveVariantInput {
  return {
    pageUrl: PAGE_URL,
    variants: [],
    productAttributes: {},
    product: { article: null, price: null, currency: null, imageUrl: null },
    ...overrides,
  };
}

/**
 * Сценарий из требований: страница FINEX содержит несколько SKU одного дизайна.
 * Характеристики разных SKU не должны попасть в один материал.
 */
const FINEX_VARIANTS: RawVariant[] = [
  variant({
    sku: "S31010CR",
    attributes: {
      "Порода": "Дуб",
      "Толщина": "15 мм",
      "Ширина": "190 мм",
      "Селекция": "Натуральная",
    },
    price: 12500,
    currency: "RUB",
  }),
  variant({
    sku: "S31011CR",
    attributes: {
      "Порода": "Дуб",
      "Толщина": "20 мм",
      "Ширина": "240 мм",
      "Селекция": "Брашированная",
    },
    price: 13500,
    currency: "RUB",
  }),
];

describe("normalizeSku", () => {
  it("приводит артикулы к сравнимому виду", () => {
    expect(normalizeSku("s31010cr")).toBe("S31010CR");
    expect(normalizeSku("S-31010-CR")).toBe("S31010CR");
    expect(normalizeSku(" S 31010 CR ")).toBe("S31010CR");
    expect(normalizeSku("KM_1024")).toBe("KM1024");
  });

  it("отбрасывает слишком короткие и пустые значения", () => {
    expect(normalizeSku("A")).toBeNull();
    expect(normalizeSku("")).toBeNull();
    expect(normalizeSku(null)).toBeNull();
  });
});

describe("variantSpecificFields", () => {
  it("оставляет только различающиеся характеристики", () => {
    const specific = variantSpecificFields(FINEX_VARIANTS);
    expect([...specific.keys()].sort()).toEqual(["Селекция", "Толщина", "Ширина"].sort());
    // «Порода» одинакова у обоих вариантов — она общая, а не спорная.
    expect(specific.has("Порода")).toBe(false);
  });

  it("считает поле специфичным при трёх и более значениях", () => {
    const specific = variantSpecificFields([
      variant({ attributes: { color: "Белый" } }),
      variant({ attributes: { color: "Чёрный" } }),
      variant({ attributes: { color: "Серый" } }),
    ]);
    expect(specific.get("color")).toEqual(["белый", "серый", "чёрный"]);  });
});

describe("resolveVariant", () => {
  it("без вариантов отдаёт характеристики товара", () => {
    const result = resolveVariant(
      input({
        productAttributes: { material: "Латунь" },
        product: { article: "T-1", price: 100, currency: "RUB", imageUrl: null },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variantIndex).toBeNull();
    expect(result.attributes).toEqual({ material: "Латунь" });
    expect(result.article).toBe("T-1");
    expect(result.price).toBe(100);
  });

  it("находит вариант по SKU в URL", () => {
    const result = resolveVariant(
      input({
        pageUrl: "https://finex.example.com/catalog/engineered-wood/S31011CR",
        variants: FINEX_VARIANTS,
        productAttributes: { "Порода": "Дуб" },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("url-sku");
    expect(result.variantIndex).toBe(1);
    expect(result.article).toBe("S31011CR");
    expect(result.price).toBe(13500);
    expect(result.attributes["Толщина"]).toBe("20 мм");
  });

  it("находит вариант по SKU в query-параметре", () => {
    const result = resolveVariant(
      input({
        pageUrl: "https://shop.example.com/product?sku=S31010CR&color=oak",
        variants: FINEX_VARIANTS,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variantIndex).toBe(0);
  });

  it("находит вариант по артикулу страницы", () => {
    const result = resolveVariant(
      input({
        variants: FINEX_VARIANTS,
        product: { article: "s-31011-cr", price: null, currency: null, imageUrl: null },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("page-article");
    expect(result.variantIndex).toBe(1);
  });

  it("находит вариант по значениям характеристик в URL", () => {
    const result = resolveVariant(
      input({
        pageUrl: "https://shop.example.com/product?thickness=20+%D0%BC%D0%BC&width=240+%D0%BC%D0%BC",
        variants: FINEX_VARIANTS,
        productAttributes: { "Порода": "Дуб" },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("url-attributes");
    expect(result.variantIndex).toBe(1);
  });

  it("НЕ смешивает характеристики, когда вариант не определён", () => {
    const result = resolveVariant(
      input({
        variants: FINEX_VARIANTS,
        productAttributes: { "Порода": "Дуб", "Дизайн": "Alpine" },
        // Артикул страницы намеренно НЕ равен SKU варианта: иначе это был бы
        // надёжный сигнал «page-article», и вариант определился бы законно.
        product: {
          article: "PAGE-LEVEL-ART",
          price: 12500,
          currency: "RUB",
          imageUrl: "https://x/i.jpg",
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Общие характеристики остаются, спорные не подставляются вообще.
    expect(result.attributes).toEqual({ "Порода": "Дуб", "Дизайн": "Alpine" });
    expect(result.attributes).not.toHaveProperty("Толщина");
    expect(result.attributes).not.toHaveProperty("Ширина");
    expect(result.attributes).not.toHaveProperty("Селекция");

    // Артикул и цена принадлежат конкретному варианту — их не угадываем.
    expect(result.article).toBeNull();
    expect(result.price).toBeNull();

    const ambiguousFields = result.ambiguous.map((a) => a.field).sort();
    expect(ambiguousFields).toEqual(["Селекция", "Толщина", "Ширина"].sort());
    expect(result.reason).toContain("no-url-signal");
  });

  it("перечисляет встреченные значения спорных полей", () => {
    const result = resolveVariant(input({ variants: FINEX_VARIANTS }));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const thickness = result.ambiguous.find((a) => a.field === "Толщина");
    expect(thickness?.values).toEqual(["15 мм", "20 мм"]);
  });

  it("считает неоднозначным совпадение по нескольким вариантам", () => {
    const variants = [
      variant({ sku: "A-1", attributes: { color: "Белый", size: "S" } }),
      variant({ sku: "A-2", attributes: { color: "Белый", size: "M" } }),
    ];
    // «Белый» есть в URL, но он не различает варианты — сигнала нет.
    const result = resolveVariant(
      input({ pageUrl: "https://shop.example.com/p?color=Белый", variants }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no-url-signal");
  });

  it("определяет вариант, когда все отличительные значения есть в URL", () => {
    const variants = [
      variant({ sku: null, attributes: { color: "Белый", size: "S" } }),
      variant({ sku: null, attributes: { color: "Чёрный", size: "M" } }),
    ];
    const result = resolveVariant(
      input({ pageUrl: "https://shop.example.com/p?color=Чёрный&size=M", variants }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variantIndex).toBe(1);
  });

  it("не путает похожие числовые значения в URL", () => {
    const variants = [
      variant({ sku: null, attributes: { width: "240" } }),
      variant({ sku: null, attributes: { width: "2400" } }),
    ];
    const result = resolveVariant(
      input({ pageUrl: "https://shop.example.com/p?width=2400", variants }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variantIndex).toBe(1);
    expect(result.attributes["width"]).toBe("2400");
  });

  it("вариант перекрывает характеристики товара своими", () => {
    const result = resolveVariant(
      input({
        pageUrl: "https://shop.example.com/p/S31011CR",
        variants: FINEX_VARIANTS,
        productAttributes: { "Порода": "Дуб", "Толщина": "10 мм" },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 20 мм из варианта точнее, чем 10 мм со страницы товара.
    expect(result.attributes["Толщина"]).toBe("20 мм");
    expect(result.attributes["Порода"]).toBe("Дуб");
  });

  it("не падает на некорректном URL страницы", () => {
    const result = resolveVariant(
      input({ pageUrl: "не url", variants: FINEX_VARIANTS }),
    );
    expect(result.ok).toBe(false);
  });

  it("работает, когда у вариантов нет SKU и общих характеристик", () => {
    const variants = [
      variant({ attributes: { size: "S" } }),
      variant({ attributes: { size: "L" } }),
    ];
    const result = resolveVariant(
      input({ pageUrl: "https://shop.example.com/p?size=L", variants }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attributes).toEqual({ size: "L" });
  });
});

describe("resolveVariant: подпись варианта от модели", () => {
  it("определяет вариант по точной подписи, когда URL её не содержит", () => {
    const variants = [
      variant({ sku: "143833", label: "Дуб · 13 мм · 140 мм", attributes: { width: "140" } }),
      variant({ sku: "143834", label: "Дуб · 13.5 мм · 180 мм", attributes: { width: "180" } }),
    ];

    const result = resolveVariant(
      input({ variants, variantLabel: "Дуб · 13.5 мм · 180 мм" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("variant-label");
    expect(result.variantIndex).toBe(1);
    expect(result.article).toBe("143834");
  });

  it("нормализует подпись перед сравнением", () => {
    const variants = [
      variant({ sku: "143834", label: "Дуб · 13.5 мм · 180 мм" }),
      variant({ sku: "143833", label: "Дуб · 13 мм · 140 мм" }),
    ];

    const result = resolveVariant(input({ variants, variantLabel: "дуб 13.5 мм 180 мм" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variantIndex).toBe(0);
  });

  it("не угадывает вариант по частичному совпадению подписи", () => {
    // «Дуб 13 мм» не должно совпасть с «Дуб 13.5 мм».
    const variants = [
      variant({ sku: "143833", label: "Дуб · 13 мм · 140 мм" }),
      variant({ sku: "143834", label: "Дуб · 13.5 мм · 180 мм" }),
    ];

    const result = resolveVariant(input({ variants, variantLabel: "Дуб · 13 мм" }));
    expect(result.ok).toBe(false);
  });

  it("совпадает по имени или SKU варианта", () => {
    const variants = [
      variant({ sku: "143834", name: "Kanna Brushed 13.5" }),
      variant({ sku: "143833", name: "Kanna Brushed 13" }),
    ];

    const byName = resolveVariant(input({ variants, variantLabel: "Kanna Brushed 13.5" }));
    expect(byName.ok).toBe(true);
    if (!byName.ok) return;
    expect(byName.variantIndex).toBe(0);

    const bySku = resolveVariant(input({ variants, variantLabel: "143833" }));
    expect(bySku.ok).toBe(true);
    if (!bySku.ok) return;
    expect(bySku.variantIndex).toBe(1);
  });

  it("URL важнее подписи", () => {
    const variants = [
      variant({ sku: "143833", label: "Дуб · 13 мм", attributes: { width: "140" } }),
      variant({ sku: "143834", label: "Дуб · 13.5 мм", attributes: { width: "180" } }),
    ];

    const result = resolveVariant(
      input({
        pageUrl: "https://shop.example.com/product/143833",
        variants,
        // Подпись указывает на другой вариант, но URL однозначен.
        variantLabel: "Дуб · 13.5 мм",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("url-sku");
    expect(result.variantIndex).toBe(0);
  });

  it("слишком короткую подпись игнорирует", () => {
    const variants = [
      variant({ sku: "A-1", label: "A" }),
      variant({ sku: "A-2", label: "B" }),
    ];
    expect(resolveVariant(input({ variants, variantLabel: "A" })).ok).toBe(false);
  });
});
