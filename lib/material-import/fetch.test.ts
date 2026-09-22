import { describe, expect, it, vi } from "vitest";
import { readBodyCapped } from "./fetch";

/**
 * Тесты чтения тела с ограничением.
 *
 * Проверяется главное следствие правки: при превышении лимита уже прочитанные
 * байты НЕ выбрасываются. Раньше здесь возвращался отказ, и большая карточка
 * товара терялась целиком, хотя `<head>` с JSON-LD почти всегда умещается в
 * первые мегабайты.
 *
 * Лимит не увеличивается, и чтение дальше предела не продолжается — это тоже
 * проверяется (по числу прочитанных из потока блоков).
 */

/** Собирает поток из блоков заданного размера. */
function streamOf(chunks: Uint8Array[]): {
  stream: ReadableStream<Uint8Array>;
  readCount: () => number;
  cancelled: () => boolean;
} {
  let reads = 0;
  let cancelled = false;
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      reads += 1;
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel() {
      cancelled = true;
    },
  });

  return { stream, readCount: () => reads, cancelled: () => cancelled };
}

function repeated(byte: number, length: number): Uint8Array {
  return new Uint8Array(length).fill(byte);
}

describe("readBodyCapped: тело меньше лимита", () => {
  it("возвращает весь текст без признака усечения", async () => {
    const text = "<html><head><title>Товар</title></head></html>";
    const bytes = new TextEncoder().encode(text);
    const { stream } = streamOf([bytes]);

    const result = await readBodyCapped(stream, 2_000_000);

    // `bytes` — именно байты тела, а не длина строки в символах.
    expect(result).toEqual({
      ok: true,
      text,
      bytes: bytes.byteLength,
      truncated: false,
    });
  });

  it("склеивает текст из нескольких блоков", async () => {
    const encoder = new TextEncoder();
    const { stream } = streamOf([
      encoder.encode("<html>"),
      encoder.encode("<head>"),
      encoder.encode("</head></html>"),
    ]);

    const result = await readBodyCapped(stream, 1_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("<html><head></head></html>");
    expect(result.truncated).toBe(false);
  });
});

describe("readBodyCapped: тело больше лимита", () => {
  it("возвращает первые байты и признак усечения", async () => {
    const { stream } = streamOf([repeated(0x61, 100), repeated(0x62, 100), repeated(0x63, 100)]);

    const result = await readBodyCapped(stream, 150);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Первые 100 байт целиком + блок, переведший сумму за предел.
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text.startsWith("a".repeat(100))).toBe(true);
    expect(result.truncated).toBe(true);
    // Отдаём не больше лимита.
    expect(result.bytes).toBeLessThanOrEqual(150);
  });

  it("прекращает чтение и отменяет поток, не вычитывая остаток", async () => {
    // Десять блоков по 100 байт при лимите 150: читаться должны только два.
    const { stream, readCount, cancelled } = streamOf(
      Array.from({ length: 10 }, () => repeated(0x61, 100)),
    );

    const result = await readBodyCapped(stream, 150);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    // Дальше предела не читаем.
    expect(readCount()).toBeLessThanOrEqual(2);
    expect(cancelled()).toBe(true);
  });

  it("сохраняет JSON-LD из начала страницы, когда дальше идёт мусор", async () => {
    const encoder = new TextEncoder();
    const head = `<html><head><script type="application/ld+json">{"@type":"Product","name":"Товар"}</script></head>`;
    const { stream } = streamOf([
      encoder.encode(head),
      repeated(0x20, 5_000),
      repeated(0x20, 5_000),
    ]);

    const result = await readBodyCapped(stream, head.length + 100);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    // Ключевое: разметка из начала страницы не потеряна.
    expect(result.text).toContain('"@type":"Product"');
    expect(result.text).toContain("Товар");
  });

  /**
   * Регрессия: весь ответ приходит ОДНИМ блоком, и он же переводит сумму за
   * предел. Раньше такой блок отбрасывался целиком, и слишком большая страница
   * превращалась в `EMPTY_RESPONSE` — то есть терялась полностью.
   */
  it("не теряет страницу, когда весь ответ пришёл одним большим блоком", async () => {
    const { stream } = streamOf([repeated(0x61, 500_000)]);

    const result = await readBodyCapped(stream, 1_000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(1_000);
    expect(result.bytes).toBe(1_000);
  });

  it("подтверждает это же на реальном Response", async () => {
    // 3 МБ тела: среда отдаёт его одним блоком, что и было источником регрессии.
    const html = "<html><body>" + "x".repeat(3_000_000) + "</body></html>";
    const result = await readBodyCapped(
      new Response(html, { headers: { "content-type": "text/html" } }).body,
      2_000_000,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBe(2_000_000);
    expect(result.text.length).toBe(2_000_000);
  });

  it("не падает, если лимит разрезал многобайтовый символ", async () => {
    const encoder = new TextEncoder();
    const cyrillic = encoder.encode("Товар");
    // Лимит приходится на середину двухбайтового символа.
    const { stream } = streamOf([cyrillic, cyrillic]);

    const result = await readBodyCapped(stream, cyrillic.length + 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    // Замена невалидного хвоста, а не исключение.
    expect(result.text.length).toBeGreaterThan(0);
  });
});

describe("readBodyCapped: пустой ответ", () => {
  it("сообщает об отсутствии тела", async () => {
    expect(await readBodyCapped(null, 1_000)).toEqual({ ok: false, code: "EMPTY_RESPONSE" });
  });

  it("сообщает о пустом теле", async () => {
    const { stream } = streamOf([repeated(0x20, 10)]);
    expect(await readBodyCapped(stream, 1_000)).toEqual({
      ok: false,
      code: "EMPTY_RESPONSE",
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Взаимодействие с сетью                                             */
/* ------------------------------------------------------------------ */

describe("fetchImportPage: усечённый ответ не считается отказом", () => {
  it("возвращает ok с признаком truncated вместо RESPONSE_TOO_LARGE", async () => {
    const { fetchImportPage, ...rest } = await import("./fetch");
    void rest;

    const html = "<html><body>" + "x".repeat(3_000_000) + "</body></html>";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof globalThis.fetch;

    try {
      const result = await fetchImportPage("https://example.com/product", {
        // Хост уже публичный; резолвер подменяем, чтобы тест не ходил в DNS.
        resolveHost: async () => ({ ok: true as const, addresses: ["93.184.216.34"] }),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.page.truncated).toBe(true);
      expect(result.page.status).toBe(200);
      expect(result.page.finalUrl).toBe("https://example.com/product");
      // HTML усечён, но не пуст.
      expect(result.page.html.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
