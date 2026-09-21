/**
 * Загрузка внешней страницы с защитой от SSRF.
 *
 * Модуль только для сервера: он делает исходящие запросы и использует
 * `node:`-модули. Директиву `server-only` здесь не ставим намеренно — она
 * резолвится сборщиком Next и ломает импорт модуля в Node-тестах, а пользы
 * почти не добавляет: `node:dns`/`node:stream` сами по себе не соберутся в
 * клиентский бандл. Роль «маркера серверности» играет `actions/material-import.ts`
 * с директивой `"use server"`.
 *
 * Что закрыто:
 *   * только http/https, у пользователя — только https;
 *   * запрет localhost, приватных, loopback, link-local и metadata-адресов;
 *   * проверка КАЖДОГО редиректа, а не только исходного URL;
 *   * ограничение числа редиректов, общего времени и размера тела;
 *   * allow-list Content-Type;
 *   * HTML никогда не исполняется — он только разбирается как данные.
 *
 * Что осознанно не закрыто в MVP: между DNS-проверкой и самим запросом
 * остаётся окно, в котором адрес может смениться (DNS rebinding в его «TOCTOU»
 * варианте). Полностью это лечится только пиннингом адреса на уровне
 * HTTP-диспетчера; для MVP риск принят и зафиксирован здесь, чтобы решение
 * было явным, а не забытым.
 */

import {
  assertPublicHost,
  bareHostname,
  evaluateHostPolicy,
  FETCH_TIMEOUT_MS,
  isExtractableContentType,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  parseImportUrl,
  type HostCheck,
  type ImportUrlErrorCode,
} from "./guards";

export type FetchFailureCode =
  | ImportUrlErrorCode
  | "NETWORK_ERROR"
  | "FETCH_TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "REDIRECT_WITHOUT_LOCATION"
  | "HTTP_ERROR"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "EMPTY_RESPONSE";

export type FetchedPage = {
  /** Исходный (канонизированный) URL, который ввёл пользователь. */
  requestedUrl: string;
  /** URL после редиректов — он же попадает в `product_url`. */
  finalUrl: string;
  html: string;
  status: number;
  bytes: number;
};

/**
 * Резолвер имени хоста. Внедряется, чтобы конвейер проверялся без настоящего
 * DNS: в офлайн-окружении `shop.example.com` не резолвится, и любой тест
 * импорта падал бы на `DNS_RESOLUTION_FAILED` вместо проверяемого сценария.
 */
export type HostResolver = (hostname: string) => Promise<HostCheck>;

export type FetchPageOptions = {
  /** Переопределить проверку хоста (тесты). По умолчанию — реальный DNS. */
  resolveHost?: HostResolver;
};

export type FetchPageResult =
  | { ok: true; page: FetchedPage }
  | { ok: false; code: FetchFailureCode; status?: number; detail?: string };

/** Заголовки обычного браузерного запроса — часть сайтов без них отдаёт 403. */
const REQUEST_HEADERS: Record<string, string> = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  "user-agent":
    "Mozilla/5.0 (compatible; SpecTrackBot/0.1; +https://spectrack.app/bot)",
};

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
  const resolveHost = options.resolveHost ?? assertPublicHost;

  const initial = parseImportUrl(rawUrl);
  if (!initial.ok) return { ok: false, code: initial.code };

  const requestedUrl = initial.href;
  let current = initial.url;
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Синхронная политика + резолв: проверяем хост перед КАЖДЫМ запросом, а не
    // только исходный URL, иначе редирект уводил бы запрос внутрь сети.
    const policy = evaluateHostPolicy(current);
    if (!policy.ok) return { ok: false, code: policy.code };

    const hostCheck: HostCheck = await resolveHost(bareHostname(current));
    if (!hostCheck.ok) return { ok: false, code: hostCheck.code };

    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: REQUEST_HEADERS,
        signal,
        cache: "no-store",
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return { ok: false, code: "FETCH_TIMEOUT" };
      }
      return {
        ok: false,
        code: "NETWORK_ERROR",
        detail: error instanceof Error ? error.message : undefined,
      };
    }

    // ── редирект ──
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      // Тело редиректа не нужно, но поток лучше закрыть явно.
      await response.body?.cancel().catch(() => undefined);

      if (!location) return { ok: false, code: "REDIRECT_WITHOUT_LOCATION" };

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, code: "REDIRECT_WITHOUT_LOCATION" };
      }

      // Редирект может увести как на http, так и внутрь сети — политику
      // применяем к цели, а не к исходной ссылке. `allowHttp` тут не нужен:
      // `evaluateHostPolicy` внутри `assertSafeRequestUrl` пропускает http,
      // а запрет http для пользовательского ввода обеспечен на входе.
      current = next;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, code: "HTTP_ERROR", status: response.status };
    }

    const contentType = response.headers.get("content-type");
    if (!isExtractableContentType(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, code: "UNSUPPORTED_CONTENT_TYPE", detail: contentType ?? undefined };
    }

    const body = await readBodyCapped(response.body, MAX_RESPONSE_BYTES);
    if (!body.ok) {
      return {
        ok: false,
        code: body.code,
        detail:
          body.code === "RESPONSE_TOO_LARGE"
            ? `> ${MAX_RESPONSE_BYTES} байт`
            : undefined,
      };
    }

    return {
      ok: true,
      page: {
        requestedUrl,
        finalUrl: current.href,
        html: body.text,
        status: response.status,
        bytes: body.bytes,
      },
    };
  }

  return { ok: false, code: "TOO_MANY_REDIRECTS" };
}
