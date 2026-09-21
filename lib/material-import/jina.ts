/**
 * Jina Reader — fallback для получения очищенного текста страницы.
 *
 * Зачем: часть магазинов отдаёт товар только после исполнения JavaScript, и в
 * исходном HTML нужных полей просто нет. Jina Reader (`https://r.jina.ai/<url>`)
 * сам исполняет страницу и возвращает markdown/текст. Это второй слой
 * конвейера: он вызывается только если детерминированный слой дал мало данных.
 *
 * Важно: полученный текст — по-прежнему UNTRUSTED DATA. Он попадает в модель
 * как данные для извлечения, а не как инструкции.
 *
 * Сетевые зависимости внедряются через `JinaDeps`, чтобы адаптер проверялся
 * unit-тестами без настоящей сети — иначе тесты стали бы сетевыми и хрупкими.
 */

/** Потолок текста от Jina: больше в модель всё равно не поместится. */
export const JINA_MAX_BYTES = 400_000;
export const JINA_TIMEOUT_MS = 20_000;

export type JinaDeps = {
  fetchImpl?: typeof globalThis.fetch;
};

export type JinaResult =
  | { ok: true; text: string; finalUrl: string | null }
  | { ok: false; reason: string };

/**
 * Читает тело ответа с ограничением, как и основной загрузчик страниц.
 * Возвращает читаемый текст.
 */
async function readCapped(
  response: Response,
  limit: number,
): Promise<string | null> {
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
        // Обрезанный текст полезнее отказа: модель всё равно получит начало.
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
 * Забирает у Jina Reader читаемое представление страницы.
 *
 * Никогда не бросает: недоступность Jina — ожидаемый сценарий, и импорт должен
 * продолжиться на детерминированных данных.
 */
export async function fetchViaJina(
  url: string,
  deps: JinaDeps = {},
): Promise<JinaResult> {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const apiKey = process.env.JINA_API_KEY?.trim();

  const headers: Record<string, string> = {
    accept: "text/plain",
    "x-respond-with": "text",
  };
  // Ключ необязателен: без него Jina работает в бесплатном режиме.
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  try {
    const response = await doFetch(`https://r.jina.ai/${url}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: `jina-http-${response.status}` };
    }

    const text = await readCapped(response, JINA_MAX_BYTES);
    if (!text) return { ok: false, reason: "jina-empty" };

    // Jina отдаёт заголовки вида «Title: …\nURL Source: …\n\n<текст>».
    return { ok: true, text, finalUrl: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      ok: false,
      reason: name === "TimeoutError" || name === "AbortError" ? "jina-timeout" : "jina-network",
    };
  }
}

/**
 * Есть ли смысл звать Jina: детерминированный слой дал мало данных.
 * Порог измеряется «сколько значимых полей заполнено», а не размером HTML:
 * большой HTML с одной лишь вёрсткой всё равно бесполезен.
 */
export function needsJinaFallback(input: {
  name: string | null;
  price: number | null;
  article: string | null;
  attributesCount: number;
  variantsCount: number;
  htmlBytes: number;
}): boolean {
  const meaningfulFields = [
    input.name !== null,
    input.price !== null,
    input.article !== null,
    input.attributesCount >= 2,
    input.variantsCount > 0,
  ].filter(Boolean).length;

  // Есть имя и ещё один признак товара — детерминированного слоя достаточно.
  if (input.name !== null && meaningfulFields >= 2) return false;

  // Пустая заготовка страницы (SPA-оболочка): без рендера делать нечего.
  if (input.htmlBytes < 512) return true;

  return meaningfulFields < 2;
}
