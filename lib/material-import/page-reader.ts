/**
 * Граница «внешний читатель страницы».
 *
 * Конвейер знает только этот интерфейс: он не в курсе, кто именно отдал текст —
 * Firecrawl, self-hosted reader или что-то ещё. Конкретную реализацию
 * подставляет server action, поэтому:
 *
 *  * `runImportPipeline` не привязан к провайдеру;
 *  * тесты подставляют заглушку и не ходят в сеть;
 *  * добавить второго провайдера можно, не меняя доменную логику импорта.
 *
 * Читатель вызывается ТОЛЬКО как fallback: если детерминированный слой
 * (JSON-LD / OpenGraph / meta / title) уже дал достаточно данных, внешний запрос
 * не делается вовсе — это и быстрее, и дешевле, и меньше внешних зависимостей.
 */

/** Откуда пришло содержимое страницы. */
export const PAGE_SOURCES = ["direct", "firecrawl"] as const;
export type PageSource = (typeof PAGE_SOURCES)[number];

export type PageReadResult =
  | {
      ok: true;
      /** Очищенный текст страницы (markdown). Дальше идёт в LLM как данные. */
      content: string;
      /** Какой провайдер отработал — для диагностики и сообщений. */
      source: Exclude<PageSource, "direct">;
    }
  | {
      ok: false;
      /**
       * Техническая причина для серверного лога. Наружу не показывается:
       * пользователю уходит общая формулировка.
       */
      reason: string;
    };

/**
 * Читатель страницы. Один метод, один смысл: «дай содержимое этого URL».
 */
export type PageReader = {
  readonly name: Exclude<PageSource, "direct">;
  read(url: string): Promise<PageReadResult>;
};

/* ------------------------------------------------------------------ */
/*  Нужен ли вообще внешний читатель                                   */
/* ------------------------------------------------------------------ */

/**
 * Порог «детерминированного слоя достаточно».
 *
 * Считаем значимые поля, а не размер HTML: большой документ с одной вёрсткой
 * всё равно бесполезен. Если имени нет или подтверждающих признаков меньше
 * двух — зовём читателя.
 */
export function needsPageReaderFallback(input: {
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

/* ------------------------------------------------------------------ */
/*  Заглушка «читателя нет»                                            */
/* ------------------------------------------------------------------ */

/**
 * Читатель, которого нет. Нужен, чтобы конвейер не ветвился на `undefined`:
 * без ключа провайдера слой просто выключается.
 */
export function createNoopPageReader(name: Exclude<PageSource, "direct"> = "firecrawl"): PageReader {
  return {
    name,
    async read(): Promise<PageReadResult> {
      return { ok: false, reason: `${name}-not-configured` };
    },
  };
}
