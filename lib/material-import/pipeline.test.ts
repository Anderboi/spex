import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawExtractedProduct } from "./draft";
import type { ProductDataExtractor, AiExtractInput } from "./ai";
import { applyAiResult, mergeExtracted, runImportPipeline, toExtractedProduct } from "./pipeline";
import type { DeterministicExtractedProduct } from "./draft";

const PAGE_URL = "https://shop.example.com/product/keramogranit";

function htmlResponse(html: string, init: { status?: number; contentType?: string } = {}) {
  return new Response(html, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/html; charset=utf-8" },
  });
}

function ldPage(product: Record<string, unknown>): string {
  return `<!doctype html><html><head>
    <title>Страница товара</title>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      ...product,
    })}</script>
  </head><body>${"описание товара ".repeat(60)}</body></html>`;
}

/** Пустая SPA-оболочка: детерминированному слою взять нечего. */
const SPARSE_PAGE =
  '<!doctype html><html><head><title>Магазин</title></head><body><div id="app"></div></body></html>';

/**
 * Фейковый адаптер LLM с типизированным моком: без аннотации аргумента `vi.fn()`
 * выводит тип вызова как пустой кортеж, и `mock.calls[0][0]` не проверяется.
 */
function fakeExtractor(product: Partial<RawExtractedProduct> = {}) {
  const extractProductData = vi.fn(async (input: AiExtractInput): Promise<RawExtractedProduct> => {
    // Аргумент нужен только для типизации мока: `mock.calls[0][0]` должен
    // проверяться типами, иначе тест на подсказки ничего не доказывает.
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
  });
  const extractor: ProductDataExtractor = { name: "deepseek", extractProductData };
  return { extractor, extractProductData };
}

/**
 * Резолвер без сети: все публичные имена «резолвятся» в публичный адрес.
 * В офлайн-окружении настоящий DNS для `shop.example.com` не работает, поэтому
 * без подмены конвейер падал бы на `DNS_RESOLUTION_FAILED` вместо проверяемого
 * сценария. Приватные адреса до DNS не доходят — их отсекает политика хоста.
 */
const publicResolver = async () => ({ ok: true as const, addresses: ["93.184.216.34"] });

/** Резолвер по умолчанию для большинства сценариев. */
const DEPS = { resolveHost: publicResolver };

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Слияние слоёв                                                      */
/* ------------------------------------------------------------------ */

describe("mergeExtracted", () => {
  const base: DeterministicExtractedProduct = {
    name: { value: "Из JSON-LD", source: "json-ld" },
    brand: { value: "ABK", source: "json-ld" },
    article: null,
    price: { value: 6500, source: "json-ld" },
    currency: { value: "RUB", source: "json-ld" },
    imageUrl: null,
    unit: null,
    description: null,
    attributes: { values: { Формат: "120×278" }, source: "json-ld" },
    variants: [],
  };

  it("сохраняет значения базового слоя", () => {
    const merged = mergeExtracted(base, {
      ...base,
      name: { value: "Из Jina", source: "jina" },
      price: { value: 9999, source: "jina" },
    });
    expect(merged!.name?.value).toBe("Из JSON-LD");
    expect(merged!.price?.value).toBe(6500);
  });

  it("дополняет отсутствующие поля", () => {
    const merged = mergeExtracted(base, {
      ...base,
      name: null,
      brand: null,
      article: { value: "J-1", source: "jina" },
      unit: { value: "м2", source: "jina" },
      attributes: { values: { Поверхность: "Матовая" }, source: "jina" },
    });
    expect(merged!.article?.value).toBe("J-1");
    expect(merged!.unit?.value).toBe("м2");
    expect(merged!.attributes!.values).toEqual({
      Формат: "120×278",
      Поверхность: "Матовая",
    });
    expect(merged!.name?.value).toBe("Из JSON-LD");
  });

  it("возвращает непустой слой, если второй пуст", () => {
    expect(mergeExtracted(base, null)).toBe(base);
    expect(mergeExtracted(null, base)).toBe(base);
    expect(mergeExtracted(null, null)).toBeNull();
  });
});

describe("applyAiResult", () => {
  const base = toExtractedProduct(
    {
      name: { value: "Товар", source: "json-ld" },
      brand: null,
      article: null,
      price: null,
      currency: null,
      imageUrl: null,
      unit: null,
      description: null,
      attributes: { values: { Формат: "120×278" }, source: "json-ld" },
      variants: [],
    },
    { modelText: null, usedLayers: ["json-ld"] },
  );

  it("не затирает детерминированные значения", () => {
    const { product } = applyAiResult(base, {
      name: "Из модели",
      brand: "GESSI",
      article: null,
      category: null,
      productType: null,
      price: 100,
      currency: "RUB",
      unit: null,
      imageUrl: null,
      description: null,
      attributes: { Формат: "999×999" },
      variants: [],
    });

    expect(product.name?.value).toBe("Товар");
    expect(product.name?.source).toBe("json-ld");
    expect(product.brand?.value).toBe("GESSI");
    expect(product.brand?.source).toBe("ai");
    // Характеристика из JSON-LD приоритетнее значения модели.
    expect(product.attributes!.values["Формат"]).toBe("120×278");
  });

  it("кладёт свободные категорию и тип в слоты, ожидаемые нормализацией", () => {
    const { product } = applyAiResult(base, {
      name: null,
      brand: null,
      article: null,
      category: "Смесители",
      productType: "Смеситель для раковины",
      price: null,
      currency: null,
      unit: null,
      imageUrl: null,
      description: null,
      attributes: {},
      variants: [],
    });

    expect(product.attributes!.values["category"]).toBe("Смесители");
    expect(product.attributes!.values["productType"]).toBe("Смеситель для раковины");
  });

  it("приводит нестроковые характеристики к строкам", () => {
    const { product } = applyAiResult(base, {
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
      attributes: { Мощность: 60 as unknown as string, Диммирование: true as unknown as string },
      variants: [],
    });

    expect(product.attributes!.values["Мощность"]).toBe("60");
    expect(product.attributes!.values["Диммирование"]).toBe("true");
  });

  it("использует варианты модели, когда детерминированный слой их не нашёл", () => {
    const { product } = applyAiResult(base, {
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
      variants: [
        {
          sku: "S-1",
          name: null,
          label: null,
          attributes: { Толщина: "15 мм" },
          price: null,
          currency: null,
          imageUrl: null,
          productUrl: null,
        },
      ],
    });
    expect(product.variants).toHaveLength(1);
    expect(product.usedLayers).toContain("ai");
  });
});

/* ------------------------------------------------------------------ */
/*  Конвейер целиком                                                   */
/* ------------------------------------------------------------------ */

describe("runImportPipeline", () => {
  it("отказывает на приватном адресе, не выходя в сеть", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline("https://169.254.169.254/latest/meta-data/");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("PRIVATE_ADDRESS");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("отказывает на не-http схеме", async () => {
    const result = await runImportPipeline("file:///etc/passwd");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("UNSUPPORTED_PROTOCOL");
  });

  it("собирает черновик из JSON-LD и не зовёт модель при выключенном LLM", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(
        ldPage({
          name: "Керамогранит Calacatta",
          sku: "KM-1024",
          brand: { name: "ABK" },
          offers: { price: "6500", priceCurrency: "RUB" },
          image: "https://cdn.example.com/a.jpg",
          material: "Керамогранит",
        }),
      ),
    ) as unknown as typeof globalThis.fetch;

    const { extractor, extractProductData } = fakeExtractor();
    const result = await runImportPipeline(PAGE_URL, { ...DEPS, extractor, disableAi: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.name).toBe("Керамогранит Calacatta");
    expect(result.draft.article).toBe("KM-1024");
    expect(result.draft.brand).toBe("ABK");
    expect(result.draft.price).toBe(6500);
    expect(result.draft.category).toBe("Отделка");
    expect(result.draft.imageUrl).toBe("https://cdn.example.com/a.jpg");
    expect(result.draft.productUrl).toBe(PAGE_URL);
    expect(result.draft.attrs["material"]).toBe("Керамогранит");
    expect(result.layers).toEqual({ deterministic: true, jina: false, ai: false });
    expect(extractProductData).not.toHaveBeenCalled();
  });

  it("дополняет детерминированные данные ответом модели", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(
        ldPage({
          name: "Смеситель Gessi",
          offers: { price: "24900", priceCurrency: "RUB" },
        }),
      ),
    ) as unknown as typeof globalThis.fetch;

    const { extractor, extractProductData } = fakeExtractor({
      article: "G-100",
      productType: "Смеситель",
      category: "Смесители",
      attributes: { Покрытие: "Хром", "Тип управления": "Однорычажный" },
    });

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, extractor, disableJina: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(extractProductData).toHaveBeenCalledTimes(1);
    expect(result.draft.article).toBe("G-100");
    expect(result.draft.category).toBe("Сантехника");
    expect(result.draft.productType).toBe("Смеситель");
    expect(result.draft.attrs).toMatchObject({
      Покрытие: "Хром",
      "Тип управления": "Однорычажный",
    });
    expect(result.layers.ai).toBe(true);
  });

  it("передаёт модели подсказки от детерминированного слоя", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(ldPage({ name: "Товар", sku: "SKU-1" })),
    ) as unknown as typeof globalThis.fetch;

    const { extractor, extractProductData } = fakeExtractor();
    await runImportPipeline(PAGE_URL, { ...DEPS, extractor, disableJina: true });

    const call = extractProductData.mock.calls[0][0];
    expect(call.pageUrl).toBe(PAGE_URL);
    expect(call.hints.name).toBe("Товар");
    expect(call.hints.article).toBe("SKU-1");
  });

  it("зовёт Jina на пустой SPA-странице и использует её данные", async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse(SPARSE_PAGE)) as unknown as typeof globalThis.fetch;

    const jinaText = `<meta property="og:title" content="Розетка с заземлением" />
      <meta property="product:price:amount" content="1 290" />
      <meta property="product:price:currency" content="RUB" />`;
    const jinaFetch = vi.fn(async () => new Response(jinaText, { status: 200 }));

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      jina: { fetchImpl: jinaFetch as unknown as typeof globalThis.fetch },
      disableAi: true,
    });

    expect(jinaFetch).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.name).toBe("Розетка с заземлением");
    expect(result.draft.price).toBe(1290);
    expect(result.draft.category).toBe("Электрика");
    expect(result.layers.jina).toBe(true);
    // Источник полей, пришедших из пересказа страницы, помечен как jina.
    expect(result.draft.evidence.some((item) => item.source === "jina")).toBe(true);
  });

  it("не зовёт Jina, когда детерминированных данных достаточно", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(
        ldPage({
          name: "Керамогранит",
          sku: "KM-1",
          offers: { price: "100", priceCurrency: "RUB" },
          material: "Керамогранит",
          color: "Белый",
        }),
      ),
    ) as unknown as typeof globalThis.fetch;

    const jinaFetch = vi.fn();
    await runImportPipeline(PAGE_URL, {
      ...DEPS,
      jina: { fetchImpl: jinaFetch as unknown as typeof globalThis.fetch },
      disableAi: true,
    });

    expect(jinaFetch).not.toHaveBeenCalled();
  });

  it("продолжает импорт, когда Jina недоступна", async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse(SPARSE_PAGE)) as unknown as typeof globalThis.fetch;

    const jinaFetch = vi.fn(async () => new Response("nope", { status: 503 }));

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      jina: { fetchImpl: jinaFetch as unknown as typeof globalThis.fetch },
      disableAi: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toContain("Jina");
    expect(result.layers.jina).toBe(false);
    expect(result.draft.requiresReview).toBe(true);
  });

  it("продолжает импорт, когда модель падает", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(ldPage({ name: "Товар", sku: "T-1" })),
    ) as unknown as typeof globalThis.fetch;

    const failing: ProductDataExtractor = {
      name: "deepseek",
      extractProductData: vi.fn(async () => {
        throw new Error("deepseek-http-500");
      }),
    };

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      extractor: failing,
      disableJina: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.name).toBe("Товар");
    expect(result.layers.ai).toBe(false);
    expect(result.warnings.join(" ")).toContain("модель");
  });

  it("отказывает, когда страница отдала не HTML", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse("PDF", { contentType: "application/pdf" }),
    ) as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, disableAi: true, disableJina: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("отказывает на HTTP-ошибке и сохраняет статус", async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse("Not found", { status: 404 })) as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, disableAi: true, disableJina: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("HTTP_ERROR");
    expect(result.failure.status).toBe(404);
  });

  it("идёт по редиректу и сохраняет итоговый URL в product_url", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === PAGE_URL) {
        return new Response(null, {
          status: 301,
          headers: { location: "https://shop.example.com/product/new-url" },
        });
      }
      return htmlResponse(ldPage({ name: "Товар после редиректа" }));
    }) as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, disableAi: true, disableJina: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.productUrl).toBe("https://shop.example.com/product/new-url");
    expect(result.draft.sourceUrl).toBe(PAGE_URL);
  });

  it("не следует за редиректом во внутреннюю сеть", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    ) as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, disableAi: true, disableJina: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("PRIVATE_ADDRESS");
    // Ровно один запрос: на внутренний адрес мы не пошли.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
