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

export type FetchFailureCode = SafeFetchFailureCode | "UNSUPPORTED_CONTENT_TYPE" | "EMPTY_RESPONSE";

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
  /**
   * Тело было обрезано по лимиту: `html` — это первые `MAX_RESPONSE_BYTES` байт,
   * а не вся страница. Признак нужен и для предупреждения пользователю, и для
   * решения о fallback: обрезанный HTML мог не содержать нужных данных.
   */
  truncated: boolean;
};

export type FetchPageResult =
  | { ok: true; page: FetchedPage }
  | { ok: false; code: FetchFailureCode; status?: number; detail?: string };

/** Результат чтения тела: либо полный текст, либо усечённый по лимиту. */
export type CappedBody =
  | { ok: true; text: string; bytes: number; truncated: boolean }
  | { ok: false; code: "EMPTY_RESPONSE" };

/**
 * Читает тело ответа, обрывая чтение при превышении лимита.
 *
 * `response.text()` здесь не годится: он вычитывает сколько угодно данных в
 * память, и лимит пришлось бы проверять уже после. Читаем поток вручную и
 * останавливаемся на первом блоке, который перевёл сумму за предел.
 *
 * Важно: при превышении лимита уже прочитанные байты НЕ выбрасываются. Раньше
 * здесь возвращался отказ, из-за чего большая карточка товара терялась целиком —
 * хотя `<head>` с JSON-LD и OpenGraph почти всегда умещается в первые
 * мегабайты. Теперь возвращается усечённый текст и признак `truncated`, а
 * решение «достаточно ли данных» принимает конвейер. Лимит при этом не
 * увеличивается, и дальше предела мы не читаем.
 */
export async function readBodyCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<CappedBody> {
  if (!body) return { ok: false, code: "EMPTY_RESPONSE" };

  const reader = body.getReader();

  try {
    const chunks: Uint8Array[] = [];
    let total = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      // Блок сохраняем ВСЕГДА, включая тот, что перевёл сумму за предел: часто
      // весь ответ приходит одним блоком, и выбросить его значило бы потерять
      // страницу целиком. Память всё равно ограничена: усечение делается при
      // декодировании, а чтение прекращается сразу после.
      chunks.push(value);
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }

    // Декодируем ровно то, что прочитали, для усечённого ответа — первые
    // `limit` байт. `fatal: false` обязателен: на границе многобайтовый символ
    // может разорваться, и декодер должен заменить хвост, а не бросить исключение.
    const decoded = concat(chunks, Math.min(total, limit));
    const text = new TextDecoder("utf-8", { fatal: false }).decode(decoded);

    if (!text.trim()) return { ok: false, code: "EMPTY_RESPONSE" };
    // `bytes` — сколько байт реально осталось в буфере (для усечённого ответа
    // это первые `limit` байт, а не весь размер страницы).
    return { ok: true, text, bytes: decoded.byteLength, truncated: total > limit };
  } finally {
    reader.releaseLock();
  }
}

/** Склеивает прочитанные блоки в один буфер указанного размера. */
function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= length) break;
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, length - offset));
    out.set(slice, offset);
    offset += slice.byteLength;
  }
  return out;
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
    return { ok: false, code: body.code };
  }

  return {
    ok: true,
    page: {
      requestedUrl: result.requestedUrl,
      finalUrl: result.finalUrl,
      html: body.text,
      status: result.status,
      bytes: body.bytes,
      // Усечение — не отказ: страница уходит дальше усечённой, а конвейер
      // решает, хватает ли данных и нужен ли внешний читатель.
      truncated: body.truncated,
    },
  };
}
