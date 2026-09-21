import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickPrimaryImage, rehostImage, sniffImageMime } from "./image";

/**
 * Тесты перехостинга изображений.
 *
 * Реальная сеть и реальный Supabase Storage не используются: сеть подменяется
 * `resolveHost` + `globalThis.fetch`, а запись в bucket — моком модуля хранения.
 * Так проверяется именно логика отбора и валидации, а не доступность сервисов.
 */

const publicResolver = async () => ({ ok: true as const, addresses: ["93.184.216.34"] });

/** Мок записи в bucket: путь `реальный` код не выполняет. */
const storeMock = vi.hoisted(() => vi.fn());
vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  return { ...actual, storeMaterialImage: storeMock };
});

const ORG = "org-1";
const IMAGE_URL = "https://cdn.example.com/photo.jpg";

/** Байты настоящих форматов: проверяются сигнатурой. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00]);

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  storeMock.mockReset();
  storeMock.mockResolvedValue({
    ok: true,
    url: "https://project.supabase.co/storage/v1/object/public/material-images/org-1/x.jpg",
    path: "org-1/x.jpg",
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/**
 * Собирает байты в ArrayBuffer.
 *
 * `Uint8Array<ArrayBufferLike>` не проходит проверку `BodyInit`/`BlobPart`
 * (в теории он может лежать на SharedArrayBuffer), поэтому копируем в обычный
 * ArrayBuffer — это и типобезопасно, и однозначно.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function imageResponse(
  bytes: Uint8Array,
  init: { status?: number; contentType?: string | null; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers ?? {});
  if (init.contentType !== null) {
    headers.set("content-type", init.contentType ?? "image/jpeg");
  }
  return new Response(toArrayBuffer(bytes), { status: init.status ?? 200, headers });
}

function mockFetch(response: Response | (() => Response | Promise<Response>)) {
  const fn = vi.fn(async () => (typeof response === "function" ? await response() : response));
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}

/* ------------------------------------------------------------------ */
/*  Успешная загрузка                                                  */
/* ------------------------------------------------------------------ */

describe("rehostImage: успех", () => {
  it("скачивает изображение и возвращает Supabase URL", async () => {
    mockFetch(imageResponse(JPEG));

    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });

    expect(result).toEqual({
      ok: true,
      url: "https://project.supabase.co/storage/v1/object/public/material-images/org-1/x.jpg",
    });
    expect(storeMock).toHaveBeenCalledTimes(1);

    // В bucket уходят именно байты и подтверждённый MIME, а не URL.
    const [orgId, bytes, mime] = storeMock.mock.calls[0];
    expect(orgId).toBe(ORG);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(mime).toBe("image/jpeg");
  });

  it("принимает PNG, WebP и GIF по сигнатуре", async () => {
    for (const [bytes, mime] of [
      [PNG, "image/png"],
      [WEBP, "image/webp"],
      [GIF, "image/gif"],
    ] as const) {
      storeMock.mockClear();
      mockFetch(imageResponse(bytes, { contentType: null }));

      const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
      expect(result.ok, mime).toBe(true);
      expect(storeMock.mock.calls[0][2], mime).toBe(mime);
    }
  });

  it("идёт по разрешённому редиректу на другой публичный хост", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 301,
          headers: { location: "https://cdn2.example.com/final.jpg" },
        });
      }
      return imageResponse(JPEG);
    });

    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  SSRF                                                               */
/* ------------------------------------------------------------------ */

describe("rehostImage: SSRF", () => {
  it("отклоняет запрещённый хост, не выходя в сеть", async () => {
    const fetchSpy = mockFetch(imageResponse(JPEG));

    const result = await rehostImage("http://localhost:8080/secret.jpg", {
      orgId: ORG,
      resolveHost: publicResolver,
    });

    expect(result).toEqual({ ok: false, code: "UNSUPPORTED_PROTOCOL" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("отклоняет приватный, loopback и link-local адрес", async () => {
    for (const url of [
      "https://127.0.0.1/a.jpg",
      "https://10.0.0.1/a.jpg",
      "https://192.168.1.1/a.jpg",
      "https://169.254.169.254/latest/meta-data/a.jpg",
      "https://[::1]/a.jpg",
      "https://[::ffff:169.254.169.254]/a.jpg",
    ]) {
      const fetchSpy = mockFetch(imageResponse(JPEG));
      const result = await rehostImage(url, { orgId: ORG, resolveHost: publicResolver });
      expect(result.ok, url).toBe(false);
      if (!result.ok) expect(result.code, url).toBe("PRIVATE_ADDRESS");
      expect(fetchSpy, url).not.toHaveBeenCalled();
    }
  });

  it("отклоняет хост, который резолвится в приватный адрес", async () => {
    const privateResolver = async () => ({
      ok: false as const,
      code: "PRIVATE_ADDRESS" as const,
    });
    const fetchSpy = mockFetch(imageResponse(JPEG));

    const result = await rehostImage(IMAGE_URL, {
      orgId: ORG,
      resolveHost: privateResolver,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PRIVATE_ADDRESS");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("отклоняет редирект во внутреннюю сеть", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    });

    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PRIVATE_ADDRESS");
    // Ровно один запрос: на внутренний адрес не пошли.
    expect(calls).toBe(1);
  });

  it("отклоняет учётные данные в ссылке", async () => {
    const result = await rehostImage("https://user:pass@example.com/a.jpg", {
      orgId: ORG,
      resolveHost: publicResolver,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CREDENTIALS_NOT_ALLOWED");
  });

  it("ограничивает количество редиректов", async () => {
    mockFetch(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/loop.jpg" },
        }),
    );

    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TOO_MANY_REDIRECTS");
  });
});

/* ------------------------------------------------------------------ */
/*  Содержимое и размер                                                */
/* ------------------------------------------------------------------ */

describe("rehostImage: содержимое", () => {
  it("отклоняет недопустимый Content-Type", async () => {
    mockFetch(imageResponse(JPEG, { contentType: "text/html" }));
    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("не доверяет заголовку: HTML с именем .jpg отклоняется", async () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    mockFetch(imageResponse(html, { contentType: "image/jpeg" }));

    const result = await rehostImage("https://cdn.example.com/fake.jpg", {
      orgId: ORG,
      resolveHost: publicResolver,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("отклоняет SVG (XML со скриптами)", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    mockFetch(imageResponse(svg, { contentType: "image/svg+xml" }));

    const result = await rehostImage("https://cdn.example.com/icon.svg", {
      orgId: ORG,
      resolveHost: publicResolver,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_IMAGE_TYPE");
  });

  it("отклоняет слишком большое изображение по объявленной длине", async () => {
    const fetchSpy = mockFetch(
      imageResponse(JPEG, { headers: { "content-length": String(50 * 1024 * 1024) } }),
    );
    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IMAGE_TOO_LARGE");
    expect(storeMock).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("отклоняет слишком большое изображение по фактическим байтам", async () => {
    // Content-Length не сообщён — лимит обязан сработать при чтении.
    const huge = new Uint8Array(6 * 1024 * 1024);
    huge.set(JPEG.subarray(0, 12), 0);
    mockFetch(imageResponse(huge, { contentType: "image/jpeg", headers: {} }));

    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IMAGE_TOO_LARGE");
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("отклоняет пустой ответ", async () => {
    mockFetch(imageResponse(new Uint8Array(0)));
    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_IMAGE");
  });

  it("отклоняет HTTP-ошибку", async () => {
    mockFetch(imageResponse(new Uint8Array(0), { status: 404 }));
    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HTTP_ERROR");
  });

  it("сообщает об отказе Storage", async () => {
    storeMock.mockResolvedValue({ ok: false, error: "bucket недоступен" });
    mockFetch(imageResponse(JPEG));

    const result = await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
    expect(result).toEqual({ ok: false, code: "STORAGE_FAILED" });
  });

  it("не делает повторных попыток", async () => {
    const fetchSpy = mockFetch(imageResponse(new Uint8Array(0), { status: 500 }));
    await rehostImage(IMAGE_URL, { orgId: ORG, resolveHost: publicResolver });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Сигнатуры                                                          */
/* ------------------------------------------------------------------ */

describe("sniffImageMime", () => {
  it("определяет поддерживаемые форматы", () => {
    expect(sniffImageMime(JPEG)?.mime).toBe("image/jpeg");
    expect(sniffImageMime(PNG)?.mime).toBe("image/png");
    expect(sniffImageMime(WEBP)?.mime).toBe("image/webp");
    expect(sniffImageMime(GIF)?.mime).toBe("image/gif");
  });

  it("возвращает null для всего остального", () => {
    expect(sniffImageMime(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImageMime(new Uint8Array([0x00]))).toBeNull();
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Выбор основного изображения                                        */
/* ------------------------------------------------------------------ */

describe("pickPrimaryImage", () => {
  it("предпочитает детерминированное изображение", () => {
    expect(
      pickPrimaryImage({
        deterministicImageUrl: "https://cdn.example.com/json-ld.jpg",
        aiImageUrl: "https://cdn.example.com/ai.jpg",
      }),
    ).toBe("https://cdn.example.com/json-ld.jpg");
  });

  it("падает до изображения от модели", () => {
    expect(
      pickPrimaryImage({
        deterministicImageUrl: null,
        aiImageUrl: "https://cdn.example.com/ai.jpg",
      }),
    ).toBe("https://cdn.example.com/ai.jpg");
  });

  it("возвращает null, когда изображения нет", () => {
    expect(pickPrimaryImage({ deterministicImageUrl: null, aiImageUrl: null })).toBeNull();
    expect(pickPrimaryImage({ deterministicImageUrl: "", aiImageUrl: undefined })).toBeNull();
  });

  it("игнорирует не-http схемы и мусор", () => {
    expect(
      pickPrimaryImage({
        deterministicImageUrl: "data:image/png;base64,AAAA",
        aiImageUrl: "javascript:alert(1)",
      }),
    ).toBeNull();
    expect(pickPrimaryImage({ deterministicImageUrl: "не url", aiImageUrl: null })).toBeNull();
  });
});
