/**
 * Три реальные страницы из постановки как acceptance-сценарии.
 *
 * Здесь нет ни одного настоящего сетевого запроса: транспорт страницы и
 * транспорт модели подменены, а ответ модели воспроизводит то, что DeepSeek
 * возвращает на этих страницах. Так проверяется вся цепочка
 * (fetch → JSON-LD/OG → читатель → модель → Zod → нормализация → draft) без
 * стоимости и без зависимости от доступности сайтов.
 *
 * Живая проверка против настоящих сайтов и настоящего API — отдельный скрипт
 * `npm run import:smoke`, он в `npm test` не входит.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runImportPipeline } from "./pipeline";
import type { AiExtractInput, ProductDataExtractor } from "./ai";
import type { RawExtractedProduct } from "./draft";

const publicResolver = async () => ({ ok: true as const, addresses: ["93.184.216.34"] });
const DEPS = { resolveHost: publicResolver, disableReader: true };

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Адаптер модели, возвращающий заранее заданный ответ. */
function extractorWith(product: Partial<RawExtractedProduct>): ProductDataExtractor {
  return {
    name: "deepseek",
    async extractProductData(input: AiExtractInput) {
      // Аргумент нужен только для типизации: проверяется форма вызова.
      void input;
      return {
        name: null,
        brand: null,
        article: null,
        category: null,
        productType: null,
        price: null,
        currency: null,
        unit: null,
        imageUrl: null,
        description: null,
        attributes: {},
        variants: [],
        retailerId: null,
        variantLabel: null,
        ambiguousAttributes: {},
        ...product,
      };
    },
  };
}

function htmlPage(head: string, body: string): string {
  return `<!doctype html><html><head><title>Магазин</title>${head}</head><body>${body}</body></html>`;
}

function pageFetch(html: string) {
  return vi.fn(async () =>
    new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  ) as unknown as typeof globalThis.fetch;
}

/* ================================================================== */
/*  Case 1 — Santehnika Online, STWORKI Эстерсунд S31010CR             */
/* ================================================================== */

describe("Case 1: STWORKI Эстерсунд S31010CR", () => {
  const PAGE_URL = "https://santehnika-online.ru/product/smesitel_stworki_estersund/";

  const HTML = htmlPage(
    `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Смеситель для раковины STWORKI Эстерсунд S31010CR",
      sku: "S31010CR",
      brand: { "@type": "Brand", name: "STWORKI" },
      offers: { "@type": "Offer", price: "18990", priceCurrency: "RUB" },
    })}</script>`,
    `<div class="product">Смеситель для раковины STWORKI Эстерсунд</div>
     <div class="product-specs">
       <div>Артикул производителя: S31010CR</div>
       <div>Код товара: 686224</div>
       <div>Материал: Латунь</div>
       <div>Покрытие: Глянцевое</div>
       <div>Тип управления: Рычажное</div>
       <div>Способ монтажа: На раковину</div>
       <div>Высота излива: 8.55 см</div>
       <div>Длина излива: 12.55 см</div>
     </div>`,
  );

  it("извлекает производителя, артикул производителя и характеристики", async () => {
    globalThis.fetch = pageFetch(HTML);

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      extractor: extractorWith({
        name: "Смеситель для раковины STWORKI Эстерсунд S31010CR",
        brand: "STWORKI",
        article: "S31010CR",
        category: "Сантехника",
        productType: "Смеситель для раковины",
        price: 18990,
        currency: "RUB",
        unit: "шт",
        // Модель отметила торговый код отдельно — он не должен стать артикулом.
        retailerId: "686224",
        attributes: {
          "материал": "Латунь",
          "покрытие": "Глянцевое",
          "управление": "Рычажное",
          "монтаж": "На раковину",
          "высота излива": "8.55 см",
          "длина излива": "12.55 см",
        },
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { draft } = result;
    expect(draft.brand).toBe("STWORKI");
    expect(draft.article).toBe("S31010CR");
    // Главное требование кейса: торговый ID не подменил артикул.
    expect(draft.article).not.toBe("686224");
    expect(draft.category).toBe("Сантехника");
    expect(draft.productType).toBe("Смеситель");
    expect(draft.unit).toBe("шт");
    expect(draft.price).toBe(18990);
    expect(draft.attrs).toMatchObject({
      "материал": "Латунь",
      "покрытие": "Глянцевое",
      "высота излива": "8.55 см",
      "длина излива": "12.55 см",
    });
    expect(result.layers.ai).toBe(true);
  });

  it("не пускает торговый код в артикул, даже если модель их перепутала", async () => {
    globalThis.fetch = pageFetch(HTML);

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      extractor: extractorWith({
        name: "Смеситель Эстерсунд",
        brand: "STWORKI",
        // Модель поддалась искушению и вернула код товара как артикул.
        article: "686224",
        retailerId: "686224",
        category: "Сантехника",
        productType: "Смеситель",
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Заявка модели отклонена: торговый код в артикул не попал. При этом
    // настоящий артикул производителя взят из машинной разметки JSON-LD —
    // она надёжнее, и портить её значением модели нельзя.
    expect(result.draft.article).toBe("S31010CR");
    expect(result.draft.article).not.toBe("686224");
    // О попытке сообщено в отчёте о черновике.
    expect(result.draft.ambiguous.some((a) => a.reason === "retailer-id")).toBe(true);
    expect(result.draft.evidence.find((e) => e.field === "article")?.value).toBe("S31010CR");
  });

  it("оставляет артикул пустым, когда кроме торгового кода ничего нет", async () => {
    // Ни JSON-LD, ни OG артикула не дают — единственный кандидат от модели
    // оказывается кодом площадки.
    const htmlWithoutSku = htmlPage("", `<div>Смеситель Эстерсунд</div>`);
    globalThis.fetch = pageFetch(htmlWithoutSku);

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      extractor: extractorWith({
        name: "Смеситель Эстерсунд",
        brand: "STWORKI",
        article: "686224",
        retailerId: "686224",
        category: "Сантехника",
        productType: "Смеситель",
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.article).toBeNull();
    expect(result.draft.ambiguous.some((a) => a.reason === "retailer-id")).toBe(true);
    // Артикул не заполнен — в предупреждениях это должно быть видно.
    expect(result.warnings.join(" ")).toContain("артикул");
  });

  it("отклоняет категорию магазина и берёт нормальную из JSON-LD/модели", async () => {
    globalThis.fetch = pageFetch(HTML);

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      extractor: extractorWith({
        name: "Смеситель Эстерсунд",
        // Модель вернула категорию магазина: схема обязана её отбросить,
        // а нормализация — определить раздел по названию.
        category: "Ванная комната" as unknown as string,
        productType: "Смеситель для раковины",
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.category).toBe("Сантехника");
    expect(result.draft.category).not.toBe("Ванная комната");
  });
});

/* ================================================================== */
/*  Case 2 — FINEX, инженерная доска Kanna Brushed, SKU 143834          */
/* ================================================================== */

describe("Case 2: FINEX Kanna Brushed, SKU 143834", () => {
  const FAMILY_URL = "https://finex.ru/catalog/inzhenernaya-doska/kanna-brushed/";
  const SKU_URL = "https://finex.ru/catalog/inzhenernaya-doska/kanna-brushed/143834/";

  const HTML = htmlPage(
    `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Инженерная доска Kanna Brushed",
      brand: { "@type": "Brand", name: "FINEX" },
      material: "Дуб",
      offers: { "@type": "Offer", price: "12900", priceCurrency: "RUB" },
    })}</script>`,
    `<div>Инженерная доска Kanna Brushed</div>
     <div>Порода: Дуб</div>
     <div>Дизайн: Kanna</div>
     <div>Поверхность: Брашированная</div>`,
  );

  /**
   * Семейство вариантов из постановки. Обратите внимание: ширина и толщина
   * РАЗЛИЧАЮТСЯ между вариантами, а порода и дизайн — общие.
   */
  const VARIANTS = [
    {
      sku: "143833",
      name: "Kanna Brushed 13",
      label: "Дуб · 13 мм · 140 мм",
      attributes: { "Толщина": "13 мм", "Ширина": "140 мм", "Селекция": "Rustic" },
      price: 12900,
      currency: "RUB",
      imageUrl: null,
      productUrl: null,
    },
    {
      sku: "143834",
      name: "Kanna Brushed 13.5",
      label: "Дуб · 13.5 мм · 180 мм",
      attributes: { "Толщина": "13.5 мм", "Ширина": "180 мм", "Селекция": "Select" },
      price: 14900,
      currency: "RUB",
      imageUrl: null,
      productUrl: null,
    },
  ];

  it("определяет вариант 143834 по URL и берёт ЕГО характеристики", async () => {
    globalThis.fetch = pageFetch(HTML);

    const result = await runImportPipeline(SKU_URL, {
      ...DEPS,
      extractor: extractorWith({
        name: "Инженерная доска Kanna Brushed",
        brand: "FINEX",
        article: "143834",
        category: "Отделка",
        productType: "Инженерная доска",
        unit: "м²",
        price: 14900,
        currency: "RUB",
        variantLabel: "Дуб · 13.5 мм · 180 мм",
        attributes: { "Порода": "Дуб", "Дизайн": "Kanna", "Поверхность": "Брашированная" },
        variants: VARIANTS,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { draft } = result;
    expect(draft.category).toBe("Отделка");
    expect(draft.productType).toBe("Инженерная доска");
    expect(draft.article).toBe("143834");
    expect(draft.price).toBe(14900);

    // Характеристики именно 143834, а не смесь с 143833.
    expect(draft.attrs).toMatchObject({
      "Порода": "Дуб",
      "Дизайн": "Kanna",
      "Толщина": "13.5 мм",
      "Ширина": "180 мм",
      "Селекция": "Select",
    });
    expect(draft.attrs["Ширина"]).not.toBe("140 мм");
    expect(draft.attrs["Толщина"]).not.toBe("13 мм");
  });

  it("НЕ смешивает варианты, когда ссылка ведёт только на семейство", async () => {
    globalThis.fetch = pageFetch(HTML);

    const result = await runImportPipeline(FAMILY_URL, {
      ...DEPS,
      extractor: extractorWith({
        name: "Инженерная доска Kanna Brushed",
        brand: "FINEX",
        // Ссылка не указывает вариант: модель не должна выбирать артикул.
        article: null,
        category: "Отделка",
        productType: "Инженерная доска",
        unit: "м²",
        price: null,
        currency: null,
        variantLabel: null,
        // Общие характеристики семейства.
        attributes: { "Порода": "Дуб", "Дизайн": "Kanna", "Поверхность": "Брашированная" },
        variants: VARIANTS,
        // Модель отметила, что эти характеристики зависят от варианта.
        ambiguousAttributes: {
          "Толщина": "13 мм / 13.5 мм",
          "Ширина": "140 мм / 180 мм",
          "Селекция": "Rustic / Select",
        },
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { draft } = result;

    // Общее сохранено.
    expect(draft.attrs).toMatchObject({
      "Порода": "Дуб",
      "Дизайн": "Kanna",
      "Поверхность": "Брашированная",
    });

    // Вариантное — не попало.
    expect(draft.attrs).not.toHaveProperty("Ширина");
    expect(draft.attrs).not.toHaveProperty("Толщина");
    expect(draft.attrs).not.toHaveProperty("Селекция");

    // Артикул и цена не выбраны наугад.
    expect(draft.article).toBeNull();
    expect(draft.price).toBeNull();

    // Спорные поля перечислены, черновик помечен как требующий проверки.
    expect(draft.ambiguous.length).toBeGreaterThan(0);
    expect(draft.requiresReview).toBe(true);
  });

  it("определяет вариант по подписи, когда в URL его нет", async () => {
    globalThis.fetch = pageFetch(HTML);

    const result = await runImportPipeline(FAMILY_URL, {
      ...DEPS,
      extractor: extractorWith({
        name: "Инженерная доска Kanna Brushed",
        brand: "FINEX",
        category: "Отделка",
        productType: "Инженерная доска",
        // Модель уверенно указала открытую подпись варианта.
        variantLabel: "Дуб · 13.5 мм · 180 мм",
        price: 14900,
        currency: "RUB",
        attributes: { "Порода": "Дуб" },
        variants: VARIANTS,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Вариант определён однозначно по подписи → его значения применены.
    expect(result.draft.attrs).toMatchObject({
      "Толщина": "13.5 мм",
      "Ширина": "180 мм",
      "Селекция": "Select",
    });
  });
});

/* ================================================================== */
/*  Case 3 — Lemana PRO, Systeme Electric Glossa GSL000143             */
/* ================================================================== */

describe("Case 3: Systeme Electric Glossa GSL000143", () => {
  const PAGE_URL = "https://lemanapro.ru/product/rozetka-systeme-electric-glossa-gsl000143-86710177/";

  const HTML = htmlPage(
    `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Розетка с заземлением Systeme Electric Glossa GSL000143 белая",
      sku: "GSL000143",
      brand: { "@type": "Brand", name: "Systeme Electric" },
      offers: { "@type": "Offer", price: "349", priceCurrency: "RUB" },
    })}</script>`,
    `<div class="product-specs">
       <div>Артикул: GSL000143</div>
       <div>Код товара: 86710177</div>
       <div>Номинальный ток: 16 А</div>
       <div>Напряжение: 250 В</div>
       <div>Заземление: Да</div>
       <div>Способ монтажа: Встраиваемый</div>
       <div>Цвет: Белый</div>
       <div>RAL: 9003</div>
       <div>Степень защиты: IP20</div>
     </div>`,
  );

  it("извлекает бренд, артикул и технические характеристики", async () => {
    globalThis.fetch = pageFetch(HTML);

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      extractor: extractorWith({
        name: "Розетка с заземлением Systeme Electric Glossa GSL000143 белая",
        brand: "Systeme Electric",
        article: "GSL000143",
        category: "Электрика",
        productType: "Розетка с заземлением",
        price: 349,
        currency: "RUB",
        unit: "шт",
        retailerId: "86710177",
        attributes: {
          "номинальный ток": "16 А",
          "напряжение": "250 В",
          "заземление": "Да",
          "монтаж": "Встраиваемый",
          "цвет": "Белый",
          "RAL": "9003",
          "IP": "IP20",
        },
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { draft } = result;
    expect(draft.brand).toBe("Systeme Electric");
    expect(draft.article).toBe("GSL000143");
    // Код товара площадки не стал артикулом.
    expect(draft.article).not.toBe("86710177");
    expect(draft.category).toBe("Электрика");
    expect(draft.productType).toBe("Розетка");
    expect(draft.price).toBe(349);
    expect(draft.attrs).toMatchObject({
      "номинальный ток": "16 А",
      "напряжение": "250 В",
      "RAL": "9003",
    });
    // Маркетинговый мусор в характеристики не попадает.
    expect(Object.keys(draft.attrs).length).toBeLessThanOrEqual(7);
  });

  it("не превращает код товара площадки в артикул", async () => {
    globalThis.fetch = pageFetch(HTML);

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      extractor: extractorWith({
        name: "Розетка Glossa",
        brand: "Systeme Electric",
        article: "86710177",
        retailerId: "86710177",
        category: "Электрика",
        productType: "Розетка",
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Код площадки отклонён, настоящий артикул взят из JSON-LD.
    expect(result.draft.article).toBe("GSL000143");
    expect(result.draft.article).not.toBe("86710177");
    expect(result.draft.ambiguous.some((a) => a.reason === "retailer-id")).toBe(true);
  });
});
