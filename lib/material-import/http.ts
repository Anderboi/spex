/**
 * Общий сетевой примитив для всех исходящих запросов импортёра.
 *
 * Модуль отвечает ровно за одно: выполнить GET по внешнему адресу так, чтобы
 * запрос не мог уйти внутрь инфраструктуры. Политика адресов берётся из
 * `guards.ts` и применяется к КАЖДОМУ шагу — и к исходной ссылке, и к каждой
 * цели редиректа.
 *
 * Зачем отдельный модуль: страницу и изображение качают разные части кода, но
 * правила безопасности у них обязаны совпадать. Дублировать SSRF-проверки
 * нельзя — расхождение между копиями и есть та ошибка, из-за которой однажды
 * находится лазейка.
 *
 * Модуль не читает тело: лимит размера и разбор содержимого — дело вызывающего,
 * потому что у страницы и у картинки они разные.
 */

import {
  bareHostname,
  evaluateHostPolicy,
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  parseImportUrl,
  type HostCheck,
  type ImportUrlErrorCode,
} from "./guards";
import { assertPublicHost } from "./guards";

/**
 * Резолвер имени хоста. Внедряется, чтобы конвейер проверялся без настоящего
 * DNS: в офлайн-окружении `shop.example.com` не резолвится, и любой тест
 * импорта падал бы на `DNS_RESOLUTION_FAILED` вместо проверяемого сценария.
 */
export type HostResolver = (hostname: string) => Promise<HostCheck>;

export type SafeFetchFailureCode =
  | ImportUrlErrorCode
  | "NETWORK_ERROR"
  | "FETCH_TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "REDIRECT_WITHOUT_LOCATION"
  | "HTTP_ERROR";

export type SafeFetchResult =
  | {
      ok: true;
      response: Response;
      requestedUrl: string;
      finalUrl: string;
      status: number;
    }
  | { ok: false; code: SafeFetchFailureCode; status?: number; detail?: string };

export type SafeFetchOptions = {
  /** Разрешить ли `http:` для ИСХОДНОГО адреса (редиректы всегда допускают). */
  allowHttp?: boolean;
  /** Куда сообщать о неудачном статусе: страница и картинка реагируют по-разному. */
  acceptStatus?: (status: number) => boolean;
  /** Переопределить проверку хоста (тесты). */
  resolveHost?: HostResolver;
  /** Дополнительные заголовки запроса. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
};

/** Заголовки обычного браузерного запроса — часть сайтов без них отдаёт 403. */
export const BROWSER_HEADERS: Record<string, string> = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  "user-agent":
    "Mozilla/5.0 (compatible; SpecTrackBot/0.1; +https://spectrack.app/bot)",
};

/**
 * Выполняет защищённый GET и возвращает ОТКРЫТЫЙ ответ — читать тело должен
 * вызывающий, иначе пришлось бы либо буферизовать всё в память, либо
 * возвращать уже прочитанный текст.
 *
 * Ошибки возвращаются кодом: недоступный сайт и «слишком много редиректов» —
 * ожидаемые исходы импорта, а не исключительные ситуации.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const resolveHost = options.resolveHost ?? assertPublicHost;
  const acceptStatus = options.acceptStatus ?? ((status: number) => status >= 200 && status < 300);
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  const initial = parseImportUrl(rawUrl, { allowHttp: options.allowHttp ?? false });
  if (!initial.ok) return { ok: false, code: initial.code };

  const requestedUrl = initial.href;
  let current = initial.url;
  const signal = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Синхронная политика + резолв перед КАЖДЫМ запросом: проверять только
    // исходный адрес нельзя — редирект увёл бы запрос внутрь сети.
    const policy = evaluateHostPolicy(current);
    if (!policy.ok) return { ok: false, code: policy.code };

    const hostCheck: HostCheck = await resolveHost(bareHostname(current));
    if (!hostCheck.ok) return { ok: false, code: hostCheck.code };

    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { ...BROWSER_HEADERS, ...options.headers },
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

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) return { ok: false, code: "REDIRECT_WITHOUT_LOCATION" };

      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, code: "REDIRECT_WITHOUT_LOCATION" };
      }
      continue;
    }

    if (!acceptStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, code: "HTTP_ERROR", status: response.status };
    }

    return {
      ok: true,
      response,
      requestedUrl,
      finalUrl: current.href,
      status: response.status,
    };
  }

  return { ok: false, code: "TOO_MANY_REDIRECTS" };
}
