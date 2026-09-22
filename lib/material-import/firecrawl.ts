/**
 * Firecrawl Scrape — внешний читатель страницы (fallback).
 *
 * Зачем: часть магазинов отдаёт товар только после исполнения JavaScript, и в
 * исходном HTML нужных полей просто нет. Firecrawl рендерит страницу и отдаёт
 * markdown, который дальше уходит в существующий слой DeepSeek.
 *
 * Используется ТОЛЬКО обычный Scrape (`POST /v2/scrape`) с форматом `markdown`.
 * Search / Crawl / Map / Agent / Interact и LLM-извлечение на стороне Firecrawl
 * не нужны: у нас своя модель и свой контракт извлечения, а каждый
 * дополнительный режим — лишние кредиты и лишняя зависимость.
 *
 * Контракт API (по официальной схеме):
 *   POST https://api.firecrawl.dev/v2/scrape
 *   Authorization: Bearer <FIRECRAWL_API_KEY>
 *   { "url": "...", "formats": ["markdown"], "onlyMainContent": true }
 *   → { "success": true, "data": { "markdown": "...", "metadata": { ... } } }
 *
 * Важно: результат — UNTRUSTED PAGE CONTENT. Он попадает в модель как данные
 * для извлечения (роль user), а не в системный промпт. Никакой разметки оттуда
 * не исполняется.
 *
 * SSRF: Firecrawl делает запрос со своей инфраструктуры, но это НЕ отменяет
 * нашу проверку — URL приходит в конвейер уже прошедшим `parseImportUrl` +
 * resolve, и здесь мы её не ослабляем. Считать Firecrawl частью доверенной сети
 * нельзя.
 *
 * Один импорт — максимум один запрос к Firecrawl. Повторов нет.
 */

import type { PageReadResult, PageReader, PageSource } from "./page-reader";

/** Потолок markdown от Firecrawl: больше в модель всё равно не поместится. */
export const FIRECRAWL_MAX_BYTES = 400_000;
export const FIRECRAWL_TIMEOUT_MS = 30_000;

export const FIRECRAWL_SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

export type FirecrawlOptions = {
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxBytes?: number;
};

/**
 * Читает тело ответа с ограничением, как и остальные сетевые слои проекта.
 * Обрезанный текст полезнее отказа: модель всё равно получит начало.
 */
async function readCapped(response: Response, limit: number): Promise<string | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
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
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Достаёт markdown из ответа Scrape API.
 *
 * Разбор отдельной функцией: структура ответа — единственное место, которое
 * может незаметно измениться, и её стоит проверять тестами независимо от сети.
 */
export function parseFirecrawlResponse(payload: unknown): PageReadResult {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, reason: "malformed-json-shape" };
  }

  const root = payload as { success?: unknown; data?: unknown; error?: unknown };

  // `success: false` — валидный JSON с отказом: причину сохраняем для лога.
  if (root.success === false) {
    const message = typeof root.error === "string" && root.error.trim() ? root.error.trim() : "unsuccessful";
    return { ok: false, reason: `firecrawl-unsuccessful: ${message.slice(0, 200)}` };
  }

  const data = root.data;
  if (typeof data !== "object" || data === null) {
    return { ok: false, reason: "malformed-json-data" };
  }

  const markdown = (data as { markdown?: unknown }).markdown;
  if (typeof markdown !== "string") {
    return { ok: false, reason: "missing-markdown" };
  }

  const content = markdown.trim();
  if (!content) return { ok: false, reason: "firecrawl-empty" };

  return { ok: true, content, source: "firecrawl" };
}

/**
 * Firecrawl как `PageReader`.
 *
 * Никогда не бросает: недоступность провайдера — ожидаемый сценарий, и импорт
 * должен продолжиться на детерминированных данных. Ключ в лог не попадает.
 */
export function createFirecrawlReader(options: FirecrawlOptions = {}): PageReader {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? FIRECRAWL_SCRAPE_ENDPOINT;
  const maxBytes = options.maxBytes ?? FIRECRAWL_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? FIRECRAWL_TIMEOUT_MS;
  const apiKey = options.apiKey ?? process.env.FIRECRAWL_API_KEY?.trim();

  return {
    name: "firecrawl",

    async read(url: string): Promise<PageReadResult> {
      // Без ключа провайдер недоступен. Это не ошибка приложения: конвейер
      // просто останется на детерминированном слое.
      if (!apiKey) return { ok: false, reason: "firecrawl-no-api-key" };

      try {
        const response = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            url,
            // Только markdown: JSON-извлечение на стороне Firecrawl не нужно —
            // структуру даёт наша модель, а лишние режимы стоят кредитов.
            formats: ["markdown"],
            // Отбрасываем навигацию, cookie-плашки и подвал: это тот же
            // boilerplate, который мы вырезаем для direct-страницы.
            onlyMainContent: true,
          }),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });

        if (!response.ok) {
          // Тело ошибки полезно в логе для диагностики, но наружу не уходит.
          const detail = await readCapped(response, 2_000).catch(() => null);
          return {
            ok: false,
            reason: `firecrawl-http-${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
          };
        }

        const raw = await readCapped(response, maxBytes);
        if (!raw) return { ok: false, reason: "firecrawl-empty-body" };

        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return { ok: false, reason: "firecrawl-malformed-json" };
        }

        return parseFirecrawlResponse(payload);
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        return {
          ok: false,
          reason:
            name === "TimeoutError" || name === "AbortError"
              ? "firecrawl-timeout"
              : "firecrawl-network",
        };
      }
    },
  };
}

/**
 * Читатель по умолчанию для server action.
 *
 * Отдельная функция, чтобы выбор провайдера жил в одном месте: сейчас это
 * Firecrawl, позже рядом может появиться self-hosted reader — конвейер об этом
 * знать не будет.
 */
export function createDefaultPageReader(): PageReader {
  return createFirecrawlReader();
}

/** Доступен ли внешний читатель (есть ключ). Для предупреждений и smoke. */
export function isPageReaderConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

/** Имя провайдера по умолчанию — для диагностики. */
export const DEFAULT_PAGE_SOURCE: Exclude<PageSource, "direct"> = "firecrawl";
