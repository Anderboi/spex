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
  /**
   * Ключ React: номер разделителя плюс `createdAt` первой записи дня.
   * Номер гарантирует уникальность даже при повторе записи в ленте.
   */
  id: string;
  label: string;
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
 * Порядок ленты: `createdAt DESC, id DESC` — тот же, что в read-layer'е.
 *
 * Оба сравнения — по строке, без разбора в `Date`: разбор потерял бы
 * микросекунды, и две записи одной миллисекунды получили бы порядок, которого
 * нет в БД. Тогда место записи разошлось бы с порядком сервера.
 */
function isNewerFirst(a: ActivityRecord, b: ActivityRecord): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/**
 * Поставить запись в ленту: создать, заменить существующую или заменить
 * optimistic-предпросмотр подтверждённой записью.
 *
 * ── Почему вставка, а не сортировка ───────────────────────────────────────
 *
 * Порядок ленты — серверный (`createdAt DESC, id DESC`), и клиент его не
 * пересчитывает: сортировать весь массив значило бы завести второй источник
 * истины для порядка и молча переупорядочить то, что уже пришло проверенным.
 * Здесь меняется ровно одно: определяется МЕСТО одной записи, а все остальные
 * остаются на своих позициях в исходном порядке.
 *
 * ── Почему это касается не только optimistic ──────────────────────────────
 *
 * Тот же вопрос встаёт при СОЗДАНИИ: подтверждённую серверную запись тоже надо
 * поставить на её место. Дописать её в конец (как было раньше) — значит сломать
 * инвариант `createdAt DESC`: первый комментарий оказался бы внизу ленты, а
 * каждый следующий — выше предыдущего, то есть лента показывала бы комментарии
 * в обратном порядке. Поэтому создание, правка и optimistic-предпросмотр идут
 * через одну функцию: правило места одно и то же.
 *
 * Запись с тем же `id` не добавляется второй раз (дедупликация ниже — вторая
 * линия на случай гонки, когда одна запись пришла двумя путями).
 *
 * Если `createdAt` записи больше, чем у подтверждённых (часы клиента отстали,
 * на странице запись «из будущего»), она встанет после них: правило порядка без
 * исключений для optimistic-записей.
 */
export function placeActivityRecord(
  records: readonly ActivityRecord[],
  record: ActivityRecord,
): ActivityRecord[] {
  // Та же запись могла уже лежать в ленте: optimistic-предпросмотр заменяется
  // серверным результатом, а не дополняется им.
  const rest = records.filter((item) => item.id !== record.id);

  const at = rest.findIndex((item) => isNewerFirst(record, item));
  if (at < 0) return [...rest, record];
  return [...rest.slice(0, at), record, ...rest.slice(at)];
}

/**
 * Вставить незавершённую optimistic-запись в ленту.
 *
 * Отдельное имя нужно там, где речь именно о предпросмотре до ответа сервера;
 * правило места — общее с подтверждёнными записями (`placeActivityRecord`).
 */
export function insertOptimisticRecord(
  records: readonly ActivityRecord[],
  optimistic: ActivityRecord,
): ActivityRecord[] {
  return placeActivityRecord(records, optimistic);
}

/**
 * Уникальные записи, первое вхождение сохраняет позицию.
 *
 * `id` записи уникален по построению (UUID из БД), поэтому повтор — это одна и
 * та же запись, пришедшая дважды: оптимистичная запись, которую не убрали после
 * подтверждения, повторная страница пагинации, гонка двух загрузок. Дедупликация
 * нужна не косметики ради: два одинаковых `id` дают два одинаковых ключа React,
 * а два одинаковых дня — ещё и два одинаковых разделителя, и лента начинает
 * дублировать или терять записи (именно это ломало добавление комментария).
 *
 * Первое вхождение оставляем как есть: порядок ленты — серверный, и
 * переупорядочивать его клиент не имеет права.
 */
function dedupeById<T extends { id: string }>(records: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
  }
  return out;
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
 * тестом и чтобы все разделители ОДНОГО вызова считались от одного момента.
 * Набор подписей при этом всегда согласован внутри вызова: даже если сборка
 * пришлась на полночь, «Сегодня» и «Вчера» не могут перемешаться между
 * группами одного дня. Обновляются подписи только при следующей сборке ленты —
 * как и у любой ленты, открытой в фоне.
 */
export function buildActivityFeed(
  records: readonly ActivityRecord[],
  now: Date = new Date(),
): ActivityFeedItem[] {
  // Дальше работаем с уникальными записями: повтор `id` дал бы повтор ключа
  // React и повтор разделителя дня.
  const unique = dedupeById(records);

  /** Комментарии текущей страницы по id — источник цитат для ответов. */
  const commentsById = new Map<string, HistoryCommentEntry>();
  for (const record of unique) {
    if (record.source === "comment") commentsById.set(record.id, record);
  }

  // ── ветки: корни в порядке ленты, ответы — по родителю ────────────────────
  const threads = new Map<string, ActivityCommentItem>();
  for (const record of unique) {
    if (record.source !== "comment" || !isRootComment(record)) continue;
    threads.set(record.id, {
      kind: "comment",
      id: record.id,
      comment: record,
      replies: [],
    });
  }

  for (const record of unique) {
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
  /**
   * Номер разделителя. В ключ идёт вместе с записью, чтобы ключ был уникален
   * БЕЗ опоры на данные: React требует уникальность только среди соседей, а
   * дубликат записи (или её `createdAt`) больше не может её нарушить.
   */
  let separatorIndex = 0;

  for (const record of unique) {
    const day = dayKeyOf(record.createdAt);

    // Разделитель ставится перед первой записью дня. Подпись считается по
    // `createdAt` самой записи, а не по «сегодня» отрисовки.
    if (day !== currentDay) {
      currentDay = day;
      items.push({
        kind: "date",
        // Полная ISO-дата вместо короткого `day`: он не несёт год и часовой
        // пояс, поэтому два разных дня могли дать один ключ.
        id: `date:${separatorIndex++}:${record.createdAt}`,
        label: formatActivityDate(record.createdAt, now),
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
