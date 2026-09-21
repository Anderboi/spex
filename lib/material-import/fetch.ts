/**
 * Загрузка внешней страницы товара.
 *
 * Сетевая защита (SSRF, редиректы, таймаут) живёт в `http.ts`, и этот модуль
 * ей пользуется — так правила для страницы и для изображения гарантированно
 * совпадают. Здесь остаётся специфика страницы: проверка `Content-Type`,
 * ограничение размера тела и чтение HTML как ДАННЫХ (он никогда не
 * исполняется).
 *
 * Что осознанно не закрыто в MVP: между DNS-проверкой и самим запросом
 * остаётся окно, в котором адрес может смениться (DNS rebinding в его «TOCTOU»
 * варианте). Полностью это лечится только пиннингом адреса на уровне
 * HTTP-диспетчера; для MVP риск принят и зафиксирован здесь, чтобы решение
 * было явным, а не забытым.
 */

import {
  isExtractableContentType,
  MAX_RESPONSE_BYTES,
} from "./guards";
import { safeFetch, type HostResolver, type SafeFetchFailureCode } from "./http";

export type FetchFailureCode = SafeFetchFailureCode | "UNSUPPORTED_CONTENT_TYPE" | "RESPONSE_TOO_LARGE" | "EMPTY_RESPONSE";

/**
 * Резолвер имени хоста. Внедряется, чтобы конвейер проверялся без настоящего
 * DNS: в офлайн-окружении `shop.example.com` не резолвится, и любой тест
 * импорта падал бы на `DNS_RESOLUTION_FAILED` вместо проверяемого сценария.
 */
export type { HostResolver };

export type FetchPageOptions = {
  /** Переопределить проверку хоста (тесты). По умолчанию — реальный DNS. */
  resolveHost?: HostResolver;
};

export type FetchedPage = {
  /** Исходный (канонизированный) URL, который ввёл пользователь. */
  requestedUrl: string;
  /** URL после редиректов — он же попадает в `product_url`. */
  finalUrl: string;
  html: string;
  status: number;
  bytes: number;
};

export type FetchPageResult =
  | { ok: true; page: FetchedPage }
  | { ok: false; code: FetchFailureCode; status?: number; detail?: string };

/**
 * Читает тело ответа, обрывая чтение при превышении лимита.
 *
 * `response.text()` здесь не годится: он вычитывает сколько угодно данных в
 * память, и лимит пришлось бы проверять уже после. Читаем поток вручную и
 * останавливаемся на первом блоке, который перевёл сумму за предел.
 */
async function readBodyCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<{ ok: true; text: string; bytes: number } | { ok: false; code: "RESPONSE_TOO_LARGE" | "EMPTY_RESPONSE" }> {
  if (!body) return { ok: false, code: "EMPTY_RESPONSE" };

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let bytes = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "RESPONSE_TOO_LARGE" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  if (!text.trim()) return { ok: false, code: "EMPTY_RESPONSE" };
  return { ok: true, text, bytes };
}

/**
 * Скачивает страницу по пользовательскому URL.
 *
 * Ошибки возвращаются кодом, а не исключением: это ожидаемые исходы импорта
 * (сайт недоступен, отдал PDF, слишком большой ответ), и вызывающий код должен
 * уметь показать их пользователю по-разному.
 */
export async function fetchImportPage(
  rawUrl: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult> {
  const result = await safeFetch(rawUrl, { resolveHost: options.resolveHost });
  if (!result.ok) {
    return { ok: false, code: result.code, status: result.status, detail: result.detail };
  }

  const contentType = result.response.headers.get("content-type");
  if (!isExtractableContentType(contentType)) {
    await result.response.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      code: "UNSUPPORTED_CONTENT_TYPE",
      detail: contentType ?? undefined,
    };
  }

  const body = await readBodyCapped(result.response.body, MAX_RESPONSE_BYTES);
  if (!body.ok) {
    return {
      ok: false,
      code: body.code,
      detail:
        body.code === "RESPONSE_TOO_LARGE" ? `> ${MAX_RESPONSE_BYTES} байт` : undefined,
    };
  }

  return {
    ok: true,
    page: {
      requestedUrl: result.requestedUrl,
      finalUrl: result.finalUrl,
      html: body.text,
      status: result.status,
      bytes: body.bytes,
    },
  };
}
