/**
 * Чтение истории позиции: системные события и комментарии одной лентой.
 *
 * Слой только читает: клиент БД приходит аргументом (DI, как в
 * `recordSpecItemEvent` из `./history`), запросов «наружу» модуль не делает, а
 * преобразование строк в домен целиком лежит в `./history-mappers` — там же
 * живёт терпимость к историческим payload'ам.
 *
 * ── Почему две выборки, а не одна ──────────────────────────────────────────
 *
 * События и комментарии лежат в разных таблицах (разная природа: журнал
 * append-only против пользовательского контента с ответами), общей таблицы и
 * вью у них нет. Поэтому лента собирается на чтении: две страницы из БД →
 * mapper → merge → сортировка → page. Объединение на чтении дешевле, чем
 * денормализация на записи, и не требует менять producers.
 *
 * ── Пагинация ──────────────────────────────────────────────────────────────
 *
 * Курсор — пара `(createdAt, id)` последней ВЫДАННОЙ записи. Он не делится
 * между источниками: каждая таблица отдаёт свою страницу размером `limit + 1`
 * (лишняя строка нужна, чтобы отличить «ровно limit и это всё» от «есть ещё»),
 * после merge сортировка и `take(limit)`. Так результат не зависит от того,
 * как записи распределены между событиями и комментариями: 100 событий и 0
 * комментариев, 0 и 100, 50 и 50 — все случаи дают корректную страницу и
 * честный `nextCursor`.
 *
 * ── Детерминированный порядок ──────────────────────────────────────────────
 *
 * Сортировка строго `createdAt DESC, id DESC`. `id` здесь только тай-брейкер:
 * UUID не является временным значением, но сравнение канонических
 * lowercase-UUID строками совпадает с сравнением `uuid` в Postgres (шестнадца-
 * теричные цифры упорядочены монотонно, дефисы стоят в одних и тех же
 * позициях). `createdAt` — ISO-строка из одного столбца БД с одним форматом
 * (UTC), поэтому лексикографическое сравнение совпадает с хронологическим, а
 * порядок одинаков при повторном чтении.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import type {
  HistoryCommentEntry,
  HistoryEntry,
  HistoryEventEntry,
} from "./history-types";
import {
  mapSpecItemComment,
  mapSpecItemEvent,
  type SpecItemCommentRow,
  type SpecItemEventRow,
} from "./history-mappers";

/** Клиент БД: как у write-хелперов, приходит аргументом. */
export type HistoryReadDb = SupabaseClient<Database>;

/** Позиция в ленте, с которой продолжается следующая страница. */
export type HistoryCursor = {
  createdAt: string;
  id: string;
};

export type GetSpecItemHistoryOptions = {
  /** Размер страницы; по умолчанию 50, допускается 1…100. */
  limit?: number;
  /** Читать записи строго после этой позиции (в порядке ленты). */
  before?: HistoryCursor;
};

/** Входные данные чтения: позиция плюс параметры страницы. */
export type GetSpecItemHistoryInput = {
  orgId: string;
  specItemId: string;
} & GetSpecItemHistoryOptions;

export type GetSpecItemHistoryResult = {
  entries: HistoryEntry[];
  nextCursor: HistoryCursor | null;
};

/** Размер страницы по умолчанию и границы (как у остальных списочных чтений). */
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/** Колонки выбираем поимённо: забирать из БД лишнее незачем. */
const EVENT_COLUMNS =
  "id, org_id, spec_item_id, kind, actor_id, actor_name_snapshot, payload, created_at";
const COMMENT_COLUMNS =
  "id, org_id, spec_item_id, parent_id, root_id, author_id, author_name_snapshot, body, created_at, edited_at, deleted_at";

/**
 * Приводит `limit` к допустимому диапазону: `1 ≤ limit ≤ 100`.
 * Не задан или не число — значение по умолчанию.
 */
function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(value)));
}

/**
 * Условие продолжения страницы одним фильтром PostgREST.
 *
 * Значения закавычены: в фильтр попадают `:` и `+` из таймстампа, а кавычки —
 * штатный способ PostgREST передать значение с зарезервированными символами.
 */
function cursorFilter(before: HistoryCursor): string {
  const at = `"${before.createdAt}"`;
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt."${before.id}")`;
}

function readError(subject: string, error: { message: string }): Error {
  return new Error(`Не удалось загрузить историю (${subject}): ${error.message}`, {
    cause: error,
  });
}

/** Страница событий: свежие сверху, `created_at DESC, id DESC`. */
async function queryEvents(
  db: HistoryReadDb,
  input: GetSpecItemHistoryInput,
  pageSize: number,
): Promise<SpecItemEventRow[]> {
  const base = db
    .from("spec_item_events")
    .select(EVENT_COLUMNS)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId);
  const scoped = input.before ? base.or(cursorFilter(input.before)) : base;

  const { data, error } = await scoped
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize);

  if (error) throw readError("события", error);
  return data ?? [];
}

/** Страница комментариев: та же семантика курсора и порядок. */
async function queryComments(
  db: HistoryReadDb,
  input: GetSpecItemHistoryInput,
  pageSize: number,
): Promise<SpecItemCommentRow[]> {
  const base = db
    .from("spec_item_comments")
    .select(COMMENT_COLUMNS)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId);
  const scoped = input.before ? base.or(cursorFilter(input.before)) : base;

  const { data, error } = await scoped
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize);

  if (error) throw readError("комментарии", error);
  return data ?? [];
}

/**
 * Число ответов на каждый комментарий позиции.
 *
 * Считается по всей позиции, а не по странице: ответ может оказаться на
 * другой странице, и тогда счётчик на первой был бы неполным. PostgREST не
 * умеет `GROUP BY`, поэтому берём узкую проекцию (`parent_id`) и считаем в JS.
 *
 * Мягко удалённые ответы НЕ исключаются: удалённый ответ остаётся ответом.
 * Ошибка этого запроса не роняет чтение — комментарии показываются со
 * счётчиком 0 (тем же приёмом, что и варианты в `getProjectSpecItems`).
 */
async function queryReplyCounts(
  db: HistoryReadDb,
  orgId: string,
  specItemId: string,
): Promise<Map<string, number>> {
  const { data, error } = await db
    .from("spec_item_comments")
    .select("parent_id")
    .eq("org_id", orgId)
    .eq("spec_item_id", specItemId)
    .not("parent_id", "is", null);

  if (error) {
    console.error("[getSpecItemHistory] replies", error.message);
    return new Map();
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const parentId = row.parent_id;
    if (!parentId) continue;
    counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Порядок ленты: `createdAt DESC, id DESC`.
 *
 * Оба сравнения — по строке, без разбора в `Date`: разбор потерял бы
 * микросекунды, и две записи одной миллисекунды получили бы порядок, которого
 * нет в БД. Тогда граница страницы могла бы разойтись с курсором.
 */
function compareEntries(a: HistoryEntry, b: HistoryEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/**
 * Лента позиции: события и комментарии одной страницей.
 *
 * Ошибка чтения не превращается в пустую историю — она бросает исключение:
 * «нет записей» и «не удалось прочитать» должны различаться. Единственное
 * исключение — счётчики ответов, без них лента остаётся читаемой.
 */
export async function getSpecItemHistory(
  db: HistoryReadDb,
  input: GetSpecItemHistoryInput,
): Promise<GetSpecItemHistoryResult> {
  const limit = clampLimit(input.limit);
  // +1 запись с каждого источника: лишняя строка показывает, что за страницей
  // есть ещё записи. Делить limit между источниками нельзя.
  const pageSize = limit + 1;

  const [eventRows, commentRows, replyCounts] = await Promise.all([
    queryEvents(db, input, pageSize),
    queryComments(db, input, pageSize),
    queryReplyCounts(db, input.orgId, input.specItemId),
  ]);

  // Неизвестный kind mapper отдаёт как null: одна плохая историческая запись
  // пропускается, остальная лента остаётся.
  const eventEntries: HistoryEventEntry[] = eventRows
    .map(mapSpecItemEvent)
    .filter((entry): entry is HistoryEventEntry => entry !== null);

  const commentEntries: HistoryCommentEntry[] = commentRows.map((row) =>
    mapSpecItemComment(row, replyCounts.get(row.id) ?? 0),
  );

  const merged = [...eventEntries, ...commentEntries].sort(compareEntries);
  const entries = merged.slice(0, limit);
  const last = entries[entries.length - 1];

  return {
    entries,
    // Решение о следующей странице принимается после объединения: наличие
    // лишней строки в одной таблице ещё не значит, что она попадает в ленту.
    nextCursor: merged.length > limit && last
      ? { createdAt: last.createdAt, id: last.id }
      : null,
  };
}
