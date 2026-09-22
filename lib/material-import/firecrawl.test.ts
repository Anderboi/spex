import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultPageReader,
  createFirecrawlReader,
  FIRECRAWL_SCRAPE_ENDPOINT,
  isPageReaderConfigured,
  parseFirecrawlResponse,
} from "./firecrawl";
import { createNoopPageReader, needsPageReaderFallback } from "./page-reader";

/**
 * Тесты адаптера Firecrawl.
 *
 * Ни одного настоящего запроса: транспорт подменяется `fetchImpl`. Живой вызов
 * проверяется отдельно скриптом `npm run import:smoke`.
 */

const URL_TO_SCRAPE = "https://shop.example.com/product/1";
const MARKDOWN = `# Смеситель
STWORKI
S31010CR

- Материал: Латунь
- Покрытие: Глянцевое`;

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Ответ Scrape API в официальной форме. */
function scrapeResponse(markdown: unknown, status = 200) {
  return new Response(
    JSON.stringify({ success: true, data: { markdown, metadata: { statusCode: 200 } } }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function fakeFetch(response: Response | (() => Response | Promise<Response>)) {
  return vi.fn(async () =>
    typeof response === "function" ? await response() : response,
  ) as unknown as typeof globalThis.fetch;
}

function lastRequest(fetchImpl: typeof globalThis.fetch) {
  const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const [url, init] = calls[0] as [string, RequestInit];
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

/* ------------------------------------------------------------------ */
/*  Успех                                                              */
/* ------------------------------------------------------------------ */

describe("createFirecrawlReader: успех", () => {
  it("возвращает markdown страницы", async () => {
    const fetchImpl = fakeFetch(scrapeResponse(MARKDOWN));
    const reader = createFirecrawlReader({ apiKey: "fc-test", fetchImpl });

    const result = await reader.read(URL_TO_SCRAPE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain("STWORKI");
    expect(result.content).toContain("S31010CR");
    expect(result.source).toBe("firecrawl");
  });

  it("обращается к официальному Scrape API с ключом и нужным телом", async () => {
    const fetchImpl = fakeFetch(scrapeResponse(MARKDOWN));
    await createFirecrawlReader({ apiKey: "fc-secret", fetchImpl }).read(URL_TO_SCRAPE);

    const { url, init, headers, body } = lastRequest(fetchImpl);

    expect(url).toBe(FIRECRAWL_SCRAPE_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(headers.authorization).toBe("Bearer fc-secret");
    expect(body.url).toBe(URL_TO_SCRAPE);
    // Только markdown: JSON-извлечение на стороне Firecrawl не используется.
    expect(body.formats).toEqual(["markdown"]);
    expect(body).not.toHaveProperty("jsonOptions");
    expect(body).not.toHaveProperty("extract");
    expect(body).not.toHaveProperty("actions");
  });

  it("обрезает markdown-обёртку из пробелов", async () => {
    const fetchImpl = fakeFetch(scrapeResponse("\n\n  # Товар  \n\n"));
    const result = await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe("# Товар");
  });

  it("не отправляет ключ в теле запроса", async () => {
    const fetchImpl = fakeFetch(scrapeResponse(MARKDOWN));
    await createFirecrawlReader({ apiKey: "super-secret", fetchImpl }).read(URL_TO_SCRAPE);

    expect(String(lastRequest(fetchImpl).init.body)).not.toContain("super-secret");
  });
});

/* ------------------------------------------------------------------ */
/*  Отказы провайдера                                                  */
/* ------------------------------------------------------------------ */

describe("createFirecrawlReader: пустой ответ", () => {
  it("сообщает об ошибке на пустой markdown", async () => {
    const fetchImpl = fakeFetch(scrapeResponse("   \n  "));
    const result = await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);

    expect(result).toEqual({ ok: false, reason: "firecrawl-empty" });
  });

  it("сообщает об ошибке, когда markdown отсутствует", async () => {
    const fetchImpl = fakeFetch(
      new Response(JSON.stringify({ success: true, data: { metadata: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-markdown");
  });

  it("сообщает об ошибке на пустом теле ответа", async () => {
    const fetchImpl = fakeFetch(new Response("", { status: 200 }));
    const result = await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);

    expect(result).toEqual({ ok: false, reason: "firecrawl-empty-body" });
  });
});

describe("createFirecrawlReader: non-2xx", () => {
  it("сообщает об ошибке и сохраняет причину для лога", async () => {
    const fetchImpl = fakeFetch(
      new Response(JSON.stringify({ error: "Payment required" }), { status: 402 }),
    );
    const result = await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("firecrawl-http-402");
  });

  it("не делает повторных попыток", async () => {
    const fetchImpl = fakeFetch(new Response("nope", { status: 500 }));
    await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createFirecrawlReader: malformed JSON", () => {
  it("сообщает об ошибке на битом JSON", async () => {
    const fetchImpl = fakeFetch(new Response("{ это не json }", { status: 200 }));
    const result = await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);

    expect(result).toEqual({ ok: false, reason: "firecrawl-malformed-json" });
  });

  it("сообщает об ошибке на JSON без ожидаемой структуры", async () => {
    const fetchImpl = fakeFetch(new Response(JSON.stringify([1, 2, 3]), { status: 200 }));
    const result = await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Массив — валидный JSON, но не объект с полем `data`.
    expect(result.reason).toBe("malformed-json-data");
  });
});

describe("createFirecrawlReader: timeout и сеть", () => {
  it("сообщает о таймауте", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof globalThis.fetch;

    const result = await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);
    expect(result).toEqual({ ok: false, reason: "firecrawl-timeout" });
  });

  it("сообщает о сетевой ошибке и не бросает", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;

    const result = await createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE);
    expect(result).toEqual({ ok: false, reason: "firecrawl-network" });
  });

  it("никогда не бросает наружу", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;

    await expect(
      createFirecrawlReader({ apiKey: "k", fetchImpl }).read(URL_TO_SCRAPE),
    ).resolves.toMatchObject({ ok: false });
  });
});

/* ------------------------------------------------------------------ */
/*  Ключ API                                                           */
/* ------------------------------------------------------------------ */

describe("createFirecrawlReader: отсутствие ключа", () => {
  it("провайдер недоступен и запрос не делается", async () => {
    const fetchImpl = fakeFetch(scrapeResponse(MARKDOWN));
    const reader = createFirecrawlReader({ apiKey: "", fetchImpl });

    const result = await reader.read(URL_TO_SCRAPE);

    expect(result).toEqual({ ok: false, reason: "firecrawl-no-api-key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("берёт ключ из окружения", async () => {
    const previous = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = "env-key";
    const fetchImpl = fakeFetch(scrapeResponse(MARKDOWN));

    try {
      expect(isPageReaderConfigured()).toBe(true);
      await createFirecrawlReader({ fetchImpl }).read(URL_TO_SCRAPE);
      expect(lastRequest(fetchImpl).headers.authorization).toBe("Bearer env-key");
    } finally {
      if (previous === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = previous;
    }
  });

  it("без ключа в окружении читатель не считается настроенным", () => {
    const previous = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;

    try {
      expect(isPageReaderConfigured()).toBe(false);
      expect(createDefaultPageReader().name).toBe("firecrawl");
    } finally {
      if (previous !== undefined) process.env.FIRECRAWL_API_KEY = previous;
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Разбор ответа                                                      */
/* ------------------------------------------------------------------ */

describe("parseFirecrawlResponse", () => {
  it("принимает официальную форму ответа", () => {
    const result = parseFirecrawlResponse({ success: true, data: { markdown: "# Товар" } });
    expect(result).toEqual({ ok: true, content: "# Товар", source: "firecrawl" });
  });

  it("различает отказ API и отсутствие данных", () => {
    expect(parseFirecrawlResponse({ success: false, error: "Blocked" })).toMatchObject({
      ok: false,
    });
    expect(parseFirecrawlResponse({ success: true })).toMatchObject({ ok: false });
    expect(parseFirecrawlResponse(null)).toMatchObject({ ok: false });
    expect(parseFirecrawlResponse("строка")).toMatchObject({ ok: false });
  });
});

/* ------------------------------------------------------------------ */
/*  Заглушка и порог                                                   */
/* ------------------------------------------------------------------ */

describe("createNoopPageReader", () => {
  it("сообщает, что провайдер не настроен", async () => {
    const reader = createNoopPageReader();
    await expect(reader.read(URL_TO_SCRAPE)).resolves.toEqual({
      ok: false,
      reason: "firecrawl-not-configured",
    });
  });
});

describe("needsPageReaderFallback", () => {
  const base = {
    name: null,
    price: null,
    article: null,
    attributesCount: 0,
    variantsCount: 0,
    htmlBytes: 50_000,
  };

  it("не нужен, когда есть имя и подтверждающий признак", () => {
    expect(needsPageReaderFallback({ ...base, name: "Товар", article: "SKU-1" })).toBe(false);
    expect(needsPageReaderFallback({ ...base, name: "Товар", attributesCount: 2 })).toBe(false);
    expect(needsPageReaderFallback({ ...base, name: "Товар", variantsCount: 1 })).toBe(false);
  });

  it("нужен, когда данных мало", () => {
    expect(needsPageReaderFallback(base)).toBe(true);
    expect(needsPageReaderFallback({ ...base, name: "Товар" })).toBe(true);
    expect(needsPageReaderFallback({ ...base, price: 100 })).toBe(true);
  });

  it("нужен для пустой оболочки SPA независимо от полей", () => {
    expect(
      needsPageReaderFallback({ ...base, name: "Магазин", htmlBytes: 300 }),
    ).toBe(true);
  });
});
