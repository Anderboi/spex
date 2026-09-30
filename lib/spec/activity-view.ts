/**
 * Сборка ленты активности: плоский список записей → то, что рисует UI.
 *
 * Сервер отдаёт ОДНУ хронологию (`createdAt DESC, id DESC`): события и
 * комментарии вперемешку, ответы идут отдельными записями в общем потоке.
 * Клиент её не пересортировывает — он только достраивает то, что из плоского
 * списка не видно:
 *
 *   * разделители дней между группами;
 *   * ветку: корневой комментарий вместе со своими ответами
 *     (`createdAt ASC`, то есть внутри ветки от старого к новому);
 *   * компактную цитату родителя для ответа.
 *
 * Дерево здесь НЕ строится деревом на произвольную глубину: третьего уровня
 * вложенности в интерфейсе нет. Ответ, у которого родитель не попал на текущую
 * страницу, показывается самостоятельной записью — терять его нельзя.
 *
 * Порядок элементов ленты (`date` → `entry`) сохраняется ровно таким, каким
 * пришёл с сервера: перестановка сломала бы и пагинацию, и смысл «новые сверху».
 */

import type { ActivityRecord } from "./activity-format";
import { formatActivityDate } from "./activity-format";
import type { HistoryCommentEntry, HistoryEntry } from "./history-types";

/** Разделитель дней: «Сегодня», «Вчера», «25 сентября». */
export type ActivityDateSeparatorItem = {
  kind: "date";
  /** Ключ React: день одинаковых подписей в разных годах не совпадёт. */
  id: string;
  label: string;
  /** ISO-дата записи, с которой началась группа. */
  date: string;
};

export type ActivityEventItem = {
  kind: "event";
  id: string;
  record: Extract<HistoryEntry, { source: "event" }>;
};

/** Ответ в ветке: цитата родителя берётся только из того, что уже прочитано. */
export type ActivityReplyItem = {
  id: string;
  reply: HistoryCommentEntry;
  /** Снимок родителя для цитаты; `null` — родителя нет в прочитанном. */
  parent: HistoryCommentEntry | null;
};

export type ActivityCommentItem = {
  kind: "comment";
  id: string;
  comment: HistoryCommentEntry;
  /** Ответы этой ветки, от старого к новому. Пустой массив — ответов нет. */
  replies: ActivityReplyItem[];
};

export type ActivityFeedItem =
  | ActivityDateSeparatorItem
  | ActivityEventItem
  | ActivityCommentItem;

/** Ключ календарного дня — по локальному времени, как и подпись. */
function dayKeyOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Корневой ли это комментарий.
 *
 * Признак — отсутствие `parentId`: `rootId` у корня тоже `null`, но полагаться
 * только на него нельзя, потому что FK `root_id` в БД нет и значение проставляет
 * server action. Ответ — это ровно тот комментарий, у которого есть родитель.
 */
function isRootComment(comment: HistoryCommentEntry): boolean {
  return !comment.parentId;
}

/** Ответы ветки: внутри ветки строго `createdAt ASC`. */
function sortReplies(replies: ActivityReplyItem[]): ActivityReplyItem[] {
  return replies.sort((a, b) => {
    if (a.reply.createdAt !== b.reply.createdAt) {
      return a.reply.createdAt < b.reply.createdAt ? -1 : 1;
    }
    if (a.reply.id !== b.reply.id) return a.reply.id < b.reply.id ? -1 : 1;
    return 0;
  });
}

/**
 * Записи → элементы ленты.
 *
 * `now` передаётся параметром, чтобы «Сегодня» / «Вчера» можно было проверить
 * тестом и чтобы все разделители одной отрисовки считались от одного момента.
 */
export function buildActivityFeed(
  records: readonly ActivityRecord[],
  now: Date = new Date(),
): ActivityFeedItem[] {
  /** Комментарии текущей страницы по id — источник цитат для ответов. */
  const commentsById = new Map<string, HistoryCommentEntry>();
  for (const record of records) {
    if (record.source === "comment") commentsById.set(record.id, record);
  }

  // ── ветки: корни в порядке ленты, ответы — по родителю ────────────────────
  const threads = new Map<string, ActivityCommentItem>();
  for (const record of records) {
    if (record.source !== "comment" || !isRootComment(record)) continue;
    threads.set(record.id, {
      kind: "comment",
      id: record.id,
      comment: record,
      replies: [],
    });
  }

  for (const record of records) {
    if (record.source !== "comment" || isRootComment(record)) continue;

    // Ответ прикрепляется к своему корню (`rootId`, иначе родителю): корень
    // может стоять в ленте и позже ответа — при `newest first` это обычное дело.
    const rootId = record.rootId ?? record.parentId;
    const thread = rootId ? threads.get(rootId) : undefined;
    if (!thread) continue;

    thread.replies.push({
      id: record.id,
      reply: record,
      parent: record.parentId
        ? (commentsById.get(record.parentId) ?? null)
        : null,
    });
  }

  for (const thread of threads.values()) sortReplies(thread.replies);

  const attached = new Set<string>();
  for (const thread of threads.values()) {
    for (const item of thread.replies) attached.add(item.id);
  }

  // ── лента: те же позиции, что пришли с сервера, плюс разделители дней ─────
  const items: ActivityFeedItem[] = [];
  let currentDay: string | null = null;

  for (const record of records) {
    const day = dayKeyOf(record.createdAt);

    // Разделитель ставится перед первой записью дня. Подпись считается по
    // `createdAt` самой записи, а не по «сегодня» отрисовки.
    if (day !== currentDay) {
      currentDay = day;
      items.push({
        kind: "date",
        id: `date:${day}`,
        label: formatActivityDate(record.createdAt, now),
        date: record.createdAt,
      });
    }

    if (record.source === "event") {
      items.push({ kind: "event", id: record.id, record });
      continue;
    }

    if (isRootComment(record)) {
      const thread = threads.get(record.id);
      // Ветка создана на предыдущем проходе для каждого корня — `??` только
      // для типовой полноты.
      items.push(
        thread ?? {
          kind: "comment",
          id: record.id,
          comment: record,
          replies: [],
        },
      );
      continue;
    }

    // Ответ, чей корень не на этой странице: показывается сам по себе, иначе
    // запись молча пропала бы из ленты.
    if (!attached.has(record.id)) {
      items.push({
        kind: "comment",
        id: record.id,
        comment: record,
        replies: [],
      });
    }
  }

  return items;
}

/**
 * Текст цитаты родителя для ответа.
 *
 * Удалённый родитель не раскрывает своё содержимое — ровно та же политика, что
 * и в самом комментарии. Если снимка родителя нет, показывается `—`: выдумывать
 * текст (или искать его отдельным запросом) нельзя.
 */
export function activityQuoteText(parent: HistoryCommentEntry | null): string {
  if (!parent) return "—";
  return parent.deleted ? "Комментарий удалён" : parent.body;
}
