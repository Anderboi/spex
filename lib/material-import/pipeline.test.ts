import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawExtractedProduct } from "./draft";
import type { ProductDataExtractor, AiExtractInput } from "./ai";
import type { PageReader } from "./page-reader";
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

/**
 * Заглушка внешнего читателя страницы.
 *
 * Конвейер работает с интерфейсом `PageReader`, поэтому в тестах важен не
 * провайдер, а поведение: отдал markdown или отказал. Реальные запросы к
 * Firecrawl в unit-тестах не делаются.
 */
function fakePageReader(
  outcome: { content: string } | { error: string },
): { reader: PageReader; read: ReturnType<typeof vi.fn> } {
  const read = vi.fn(async () =>
    "content" in outcome
      ? { ok: true as const, content: outcome.content, source: "firecrawl" as const }
      : { ok: false as const, reason: outcome.error },
  );
  return { reader: { name: "firecrawl", read }, read };
}

/** Перехостинг-заглушка: подтверждает вызов и отдаёт «supabase-подобный» URL. */
function fakeRehoster(
  result: { url: string } | { code: string } = {
    url: "https://x.supabase.co/storage/v1/object/public/material-images/org/a.jpg",
  },
) {
  return vi.fn(async (imageUrl: string) => {
    // Аргумент нужен для типизации мока: тесты проверяют, ЧТО именно
    // передано в перехостинг (`mock.calls[0][0]`).
    void imageUrl;
    return "url" in result
      ? { ok: true as const, url: result.url }
      : { ok: false as const, code: result.code as never };
  });
}

/** Дефолтные зависимости: страница + перехостинг изображения в Storage. */
const FULL_DEPS = { ...DEPS, orgId: "org-1", rehostImage: fakeRehoster() };

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
      name: { value: "От читателя", source: "reader" },
      price: { value: 9999, source: "reader" },
    });
    expect(merged!.name?.value).toBe("Из JSON-LD");
    expect(merged!.price?.value).toBe(6500);
  });

  it("дополняет отсутствующие поля", () => {
    const merged = mergeExtracted(base, {
      ...base,
      name: null,
      brand: null,
      article: { value: "R-1", source: "reader" },
      unit: { value: "м2", source: "reader" },
      attributes: { values: { Поверхность: "Матовая" }, source: "reader" },
    });
    expect(merged!.article?.value).toBe("R-1");
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
    const result = await runImportPipeline(PAGE_URL, { ...FULL_DEPS, extractor, disableAi: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.name).toBe("Керамогранит Calacatta");
    expect(result.draft.article).toBe("KM-1024");
    expect(result.draft.brand).toBe("ABK");
    expect(result.draft.price).toBe(6500);
    expect(result.draft.category).toBe("Отделка");
    // Изображение перенесено в Storage: в черновике — Supabase URL,
    // внешняя ссылка вендора дальше не идёт.
    expect(result.draft.imageUrl).toBe(
      "https://x.supabase.co/storage/v1/object/public/material-images/org/a.jpg",
    );
    expect(result.draft.productUrl).toBe(PAGE_URL);
    expect(result.draft.attrs["material"]).toBe("Керамогранит");
    expect(result.layers).toEqual({ deterministic: true, reader: false, ai: false });
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

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, extractor, disableReader: true });

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
    await runImportPipeline(PAGE_URL, { ...DEPS, extractor, disableReader: true });

    const call = extractProductData.mock.calls[0][0];
    expect(call.pageUrl).toBe(PAGE_URL);
    expect(call.hints.name).toBe("Товар");
    expect(call.hints.article).toBe("SKU-1");
  });

  it("зовёт внешнего читателя на пустой SPA-странице и использует его данные", async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse(SPARSE_PAGE)) as unknown as typeof globalThis.fetch;

    // Читатель отдаёт markdown; какой провайдер за ним стоит — конвейеру
    // неизвестно, поэтому в тесте это просто заглушка интерфейса.
    const readerText = `<meta property="og:title" content="Розетка с заземлением" />
      <meta property="product:price:amount" content="1 290" />
      <meta property="product:price:currency" content="RUB" />`;
    const { reader, read } = fakePageReader({ content: readerText });

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      reader,
      disableAi: true,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.name).toBe("Розетка с заземлением");
    expect(result.draft.price).toBe(1290);
    expect(result.draft.category).toBe("Электрика");
    expect(result.layers.reader).toBe(true);
    // Источник полей, пришедших от читателя, помечен как `reader`, а не
    // именем конкретного провайдера.
    expect(result.draft.evidence.some((item) => item.source === "reader")).toBe(true);
  });

  it("НЕ зовёт внешнего читателя, когда детерминированных данных достаточно", async () => {
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

    const { reader, read } = fakePageReader({ content: "не должно использоваться" });
    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      reader,
      disableAi: true,
    });

    // Это ключевое требование: fallback не должен становиться обязательным
    // запросом на каждый импорт.
    expect(read).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers.reader).toBe(false);
  });

  it("продолжает импорт, когда внешний читатель недоступен", async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse(SPARSE_PAGE)) as unknown as typeof globalThis.fetch;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { reader } = fakePageReader({ error: "firecrawl-http-503" });

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      reader,
      disableAi: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Пользователю — понятная фраза без внутренних кодов и имени провайдера.
    const warnings = result.warnings.join(" ");
    expect(warnings).toContain("очищенный текст страницы");
    expect(warnings).not.toContain("firecrawl");
    expect(warnings).not.toContain("503");
    expect(result.layers.reader).toBe(false);
    expect(result.draft.requiresReview).toBe(true);
  });

  it("не зовёт читателя, когда он не подключён", async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse(SPARSE_PAGE)) as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, disableAi: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers.reader).toBe(false);
    // Предупреждения о недоступном читателе быть не должно: его просто нет.
    expect(result.warnings.join(" ")).not.toContain("очищенный текст");
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
      disableReader: true,
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

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, disableAi: true, disableReader: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("отказывает на HTTP-ошибке и сохраняет статус", async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse("Not found", { status: 404 })) as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, disableAi: true, disableReader: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("HTTP_ERROR");
    expect(result.failure.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/*  Слишком большой HTML: разбираем первые байты, а не отказываем      */
/* ------------------------------------------------------------------ */

/**
 * Реалистичный «балласт»: много разметки и мало видимого текста, как в настоящей
 * карточке товара. Важно, что это именно разметка — если набить страницу
 * видимым текстом, детектор SPA-оболочки справедливо решит, что содержимое
 * отрендерено, и внешний читатель не понадобится.
 */
function markupFiller(bytes: number): string {
  return `<div class="row"><span class="p"> </span></div>`.repeat(
    Math.ceil(bytes / 43),
  );
}

/** Большая страница с валидным JSON-LD в начале: `<head>` умещается в лимит. */
function oversizedPageWithJsonLd(fillerBytes: number): string {
  const head = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Ламинат SPC Norland Sigrid",
    sku: "817741",
    brand: { name: "Mirto" },
    offers: { price: "1990", priceCurrency: "RUB" },
    material: "SPC",
    color: "Дуб",
  })}</script>`;
  return `<!doctype html><html><head>${head}</head><body>${markupFiller(fillerBytes)}</body></html>`;
}

/** Оболочка SPA, растянутая за лимит: полезных данных в начале нет. */
const OVERSIZED_SHELL = `<!doctype html><html><head><title>Магазин</title></head><body><div id="app"></div>${markupFiller(3_000_000)}</body></html>`;

describe("runImportPipeline: страница больше лимита", () => {
  it("извлекает JSON-LD из первых байт и НЕ зовёт внешнего читателя", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(oversizedPageWithJsonLd(3_000_000)),
    ) as unknown as typeof globalThis.fetch;

    const { reader, read } = fakePageReader({ content: "не должно использоваться" });

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, reader, disableAi: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Главное: страница не потеряна целиком.
    expect(result.draft.name).toBe("Ламинат SPC Norland Sigrid");
    expect(result.draft.article).toBe("817741");
    expect(result.draft.brand).toBe("Mirto");
    expect(result.draft.price).toBe(1990);

    // Данных хватило — внешний запрос не нужен.
    expect(read).not.toHaveBeenCalled();
    expect(result.layers.reader).toBe(false);
  });

  it("предупреждает об усечении понятной фразой без внутренних кодов", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(oversizedPageWithJsonLd(3_000_000)),
    ) as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      disableAi: true,
      disableReader: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const warnings = result.warnings.join(" ");
    expect(warnings).toContain("очень большой");
    // Ни кодов, ни байтовых лимитов, ни имён провайдеров.
    expect(warnings).not.toContain("RESPONSE_TOO_LARGE");
    expect(warnings).not.toContain("2000000");
    expect(warnings).not.toContain("firecrawl");
  });

  it("переходит к внешнему читателю, когда первых байт не хватило", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(OVERSIZED_SHELL),
    ) as unknown as typeof globalThis.fetch;

    const { reader, read } = fakePageReader({
      content: `<meta property="og:title" content="Ламинат SPC Norland" />
        <meta property="product:price:amount" content="1 990" />
        <meta property="product:price:currency" content="RUB" />`,
    });

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, reader, disableAi: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(read).toHaveBeenCalledTimes(1);
    expect(result.layers.reader).toBe(true);
    expect(result.draft.name).toBe("Ламинат SPC Norland");
    expect(result.draft.price).toBe(1990);
    // Черновик пригоден: предупреждение не мешает сохранению.
    expect(result.draft.requiresReview).toBe(false);
  });

  it("передаёт читателю исходный URL, а не обрезанный HTML", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(OVERSIZED_SHELL),
    ) as unknown as typeof globalThis.fetch;

    const { reader, read } = fakePageReader({ content: "# Товар" });
    await runImportPipeline(PAGE_URL, { ...DEPS, reader, disableAi: true });

    const [passedUrl] = read.mock.calls[0] as [string];
    expect(passedUrl).toBe(PAGE_URL);
    // Никакого усечённого HTML читателю не уходит.
    expect(passedUrl).not.toContain("xxxx");
    expect(passedUrl.length).toBeLessThan(200);
  });

  it("даёт user-safe результат, когда и читатель не помог", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    globalThis.fetch = vi.fn(async () =>
      htmlResponse(OVERSIZED_SHELL),
    ) as unknown as typeof globalThis.fetch;

    const { reader } = fakePageReader({ error: "firecrawl-http-402" });

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, reader, disableAi: true });

    // Импорт не падает: результат есть, просто данных мало.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers.reader).toBe(false);

    const text = result.warnings.join(" ");
    // Понятное предупреждение о том, что страницу разобрать не удалось.
    expect(text).toContain("очищенный текст");
    // Ни кодов, ни имени провайдера, ни HTTP-статусов.
    expect(text).not.toContain("firecrawl");
    expect(text).not.toContain("402");
    expect(text).not.toContain("RESPONSE_TOO_LARGE");
  });

  it("не зовёт читателя для обычной небольшой страницы", async () => {
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

    const { reader, read } = fakePageReader({ content: "не нужно" });
    const result = await runImportPipeline(PAGE_URL, { ...DEPS, reader, disableAi: true });

    expect(read).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Предупреждения об усечении тоже нет: страница уместилась.
    expect(result.warnings.join(" ")).not.toContain("очень большой");
  });
});

/* ------------------------------------------------------------------ */
/*  Изображение: неудача не ломает импорт                              */
/* ------------------------------------------------------------------ */

describe("runImportPipeline: перехостинг изображения", () => {
  const PAGE_WITH_IMAGE = ldPage({
    name: "Керамогранит Calacatta",
    sku: "KM-1024",
    image: "https://cdn.example.com/a.jpg",
  });

  it("переносит изображение и подменяет URL на Supabase", async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse(PAGE_WITH_IMAGE)) as unknown as typeof globalThis.fetch;

    const rehost = fakeRehoster({ url: "https://p.supabase.co/storage/v1/object/public/material-images/o/a.jpg" });
    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      orgId: "o",
      rehostImage: rehost,
      disableAi: true,
      disableReader: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rehost).toHaveBeenCalledTimes(1);
    // Переносится именно то изображение, что нашёл детерминированный слой.
    expect(rehost.mock.calls[0][0]).toBe("https://cdn.example.com/a.jpg");
    expect(result.draft.imageUrl).toContain("supabase.co");
    expect(result.imageRehosted).toBe(true);
  });

  it("не ломает импорт, когда изображение не перенеслось", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = vi.fn(async () => htmlResponse(PAGE_WITH_IMAGE)) as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      orgId: "o",
      rehostImage: fakeRehoster({ code: "PRIVATE_ADDRESS" }),
      disableAi: true,
      disableReader: true,
    });

    // Главное: импорт товара состоялся, черновик пригоден.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.name).toBe("Керамогранит Calacatta");
    expect(result.draft.article).toBe("KM-1024");
    expect(result.draft.requiresReview).toBe(false);

    // Картинки нет, и внешняя ссылка в форму не попала.
    expect(result.draft.imageUrl).toBeNull();
    expect(result.imageRehosted).toBe(false);
    expect(result.warnings.join(" ")).toContain("изображение");
  });

  it("оставляет image_url пустым, когда перехостинг не подключён", async () => {
    globalThis.fetch = vi.fn(async () => htmlResponse(PAGE_WITH_IMAGE)) as unknown as typeof globalThis.fetch;

    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      disableAi: true,
      disableReader: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Без `rehostImage`/`orgId` внешний URL в черновик не попадает.
    expect(result.draft.imageUrl).toBeNull();
    expect(result.imageRehosted).toBe(false);
  });

  it("не ругается на изображение, когда его на странице нет", async () => {
    globalThis.fetch = vi.fn(async () =>
      htmlResponse(ldPage({ name: "Товар", sku: "T-1" })),
    ) as unknown as typeof globalThis.fetch;

    const rehost = fakeRehoster();
    const result = await runImportPipeline(PAGE_URL, {
      ...DEPS,
      orgId: "o",
      rehostImage: rehost,
      disableAi: true,
      disableReader: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rehost).not.toHaveBeenCalled();
    expect(result.draft.imageUrl).toBeNull();
    expect(result.imageRehosted).toBe(false);
    // Предупреждения об изображении быть не должно: переносить было нечего.
    expect(result.warnings.join(" ")).not.toContain("изображение");
  });
});

describe("runImportPipeline", () => {
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

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, disableAi: true, disableReader: true });

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

    const result = await runImportPipeline(PAGE_URL, { ...DEPS, disableAi: true, disableReader: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("PRIVATE_ADDRESS");
    // Ровно один запрос: на внутренний адрес мы не пошли.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
