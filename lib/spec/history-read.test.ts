import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "./history-types";
import {
  getSpecItemHistory,
  type HistoryCursor,
  type HistoryReadDb,
} from "./history-read";

/**
 * Тесты чтения ленты.
 *
 * Запросы проверяются на подставном клиенте, который ведёт себя как PostgREST в
 * той части, которая нужна read-layer: `eq`, `not is null`, `or` с курсором,
 * `order`, `limit`. Это позволяет проходить пагинацию по-настоящему — двумя
 * запросами с курсором, — а не подсовывать заранее нарезанные страницы.
 */

type Row = Record<string, unknown>;

type QueryCall = {
  table: string;
  select: string | null;
  eqs: [string, unknown][];
  notNull: string[];
  or: string | null;
  orders: [string, boolean][];
  limit: number | null;
};

type FakeOptions = {
  events?: Row[];
  comments?: Row[];
  /** Смоделировать ошибку ответа для конкретного запроса. */
  failWhen?: (call: QueryCall) => boolean;
};

const ORG = "org-1";
const ITEM = "item-1";

const EVENT_COLUMNS =
  "id, org_id, spec_item_id, kind, actor_id, actor_name_snapshot, payload, created_at";
const COMMENT_COLUMNS =
  "id, org_id, spec_item_id, parent_id, root_id, author_id, author_name_snapshot, body, created_at, edited_at, deleted_at";

function compareValues(a: unknown, b: unknown, ascending: boolean): number {
  if (a === b) return 0;
  const cmp = String(a) < String(b) ? -1 : 1;
  return ascending ? cmp : -cmp;
}

/** Курсорная часть — ровно тот фильтр, который строит read-layer. */
function matchesCursor(row: Row, filter: string): boolean {
  const match =
    /^created_at\.lt\."(.+)",and\(created_at\.eq\."(.+)",id\.lt\."(.+)"\)$/.exec(
      filter,
    );
  if (!match) throw new Error(`Неожиданный cursor-фильтр: ${filter}`);

  const [, beforeCreatedAt, sameCreatedAt, beforeId] = match;
  const createdAt = String(row.created_at);
  const id = String(row.id);
  return (
    createdAt < beforeCreatedAt ||
    (createdAt === sameCreatedAt && id < beforeId)
  );
}

function resolveRows(rows: Row[], call: QueryCall): Row[] {
  let out = rows.slice();

  for (const [column, value] of call.eqs) {
    out = out.filter((row) => row[column] === value);
  }
  for (const column of call.notNull) {
    out = out.filter((row) => row[column] !== null && row[column] !== undefined);
  }
  if (call.or) {
    const filter = call.or;
    out = out.filter((row) => matchesCursor(row, filter));
  }

  // Сортировка по нескольким ключам: устойчивая сортировка применяется от
  // последнего ключа к первому — как в SQL `order by a, b`.
  for (const [column, ascending] of [...call.orders].reverse()) {
    out.sort((a, b) => compareValues(a[column], b[column], ascending));
  }

  return call.limit === null ? out : out.slice(0, call.limit);
}

function fakeDb(options: FakeOptions = {}) {
  const tables: Record<string, Row[]> = {
    spec_item_events: options.events ?? [],
    spec_item_comments: options.comments ?? [],
  };
  const calls: QueryCall[] = [];

  function from(table: string) {
    const call: QueryCall = {
      table,
      select: null,
      eqs: [],
      notNull: [],
      or: null,
      orders: [],
      limit: null,
    };
    calls.push(call);

    const builder = {
      select(columns?: string) {
        call.select = columns ?? "*";
        return builder;
      },
      eq(column: string, value: unknown) {
        call.eqs.push([column, value]);
        return builder;
      },
      not(column: string, operator: string, value: unknown) {
        if (operator === "is" && value === null) call.notNull.push(column);
        return builder;
      },
      or(filter: string) {
        call.or = filter;
        return builder;
      },
      order(column: string, config?: { ascending?: boolean }) {
        call.orders.push([column, config?.ascending !== false]);
        return builder;
      },
      limit(count: number) {
        call.limit = count;
        return builder;
      },
      then(
        resolve: (value: {
          data: Row[] | null;
          error: { message: string } | null;
        }) => void,
      ) {
        if (options.failWhen?.(call)) {
          resolve({ data: null, error: { message: "ошибка БД" } });
          return;
        }
        resolve({ data: resolveRows(tables[table] ?? [], call), error: null });
      },
    };

    return builder;
  }

  // Единственный каст в тестах: подставной клиент повторяет только нужную нам
  // часть цепочки PostgREST, но структурно им не является.
  return { db: { from } as unknown as HistoryReadDb, calls };
}

/** Метка времени с микросекундами: тот же формат, что отдаёт PostgREST. */
const at = (second: number, micro = 0) =>
  `2026-09-25T10:00:${String(second).padStart(2, "0")}.${String(micro).padStart(6, "0")}+00:00`;

function eventRow(id: string, createdAt: string, over: Row = {}): Row {
  return {
    id,
    org_id: ORG,
    spec_item_id: ITEM,
    kind: "created",
    actor_id: "user-1",
    actor_name_snapshot: "Анна",
    payload: { code: "М-01", name: "Диван" },
    created_at: createdAt,
    ...over,
  };
}

function commentRow(id: string, createdAt: string, over: Row = {}): Row {
  return {
    id,
    org_id: ORG,
    spec_item_id: ITEM,
    parent_id: null,
    root_id: null,
    author_id: "user-2",
    author_name_snapshot: "Борис",
    body: "Комментарий",
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    ...over,
  };
}

/** Запрос конкретного вида: отсутствие — ошибка теста, а не undefined. */
function findCall(
  calls: QueryCall[],
  match: (call: QueryCall) => boolean,
): QueryCall {
  const call = calls.find(match);
  if (!call) throw new Error("ожидаемого запроса не было");
  return call;
}

const eventsCall = (calls: QueryCall[]) =>
  findCall(calls, (call) => call.table === "spec_item_events");
const commentsCall = (calls: QueryCall[]) =>
  findCall(
    calls,
    (call) =>
      call.table === "spec_item_comments" && call.select === COMMENT_COLUMNS,
  );
const countsCall = (calls: QueryCall[]) =>
  findCall(
    calls,
    (call) =>
      call.table === "spec_item_comments" && call.select === "parent_id",
  );

/** Пройти всю ленту страницами — для проверок на дубли и пропуски. */
async function readAll(db: HistoryReadDb, limit: number) {
  const collected: HistoryEntry[] = [];
  const cursors: (HistoryCursor | null)[] = [];
  let before: HistoryCursor | undefined;

  for (let guard = 0; guard < 50; guard++) {
    const page = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit,
      before,
    });
    collected.push(...page.entries);
    cursors.push(page.nextCursor);
    if (!page.nextCursor) return { collected, cursors };
    before = page.nextCursor;
  }

  throw new Error("пагинация не завершилась");
}

/* ------------------------------------------------------------------ */
/*  Базовые сценарии                                                   */
/* ------------------------------------------------------------------ */

describe("getSpecItemHistory: базовые сценарии", () => {
  it("пустая история", async () => {
    const { db } = fakeDb();

    await expect(
      getSpecItemHistory(db, { orgId: ORG, specItemId: ITEM }),
    ).resolves.toEqual({ entries: [], nextCursor: null });
  });

  it("только события", async () => {
    const { db } = fakeDb({
      events: [eventRow("e-1", at(1)), eventRow("e-2", at(2))],
    });

    const { entries, nextCursor } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["e-2", "e-1"]);
    expect(entries.every((entry) => entry.source === "event")).toBe(true);
    expect(nextCursor).toBeNull();
  });

  it("только комментарии", async () => {
    const { db } = fakeDb({
      comments: [commentRow("c-1", at(1)), commentRow("c-2", at(2))],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["c-2", "c-1"]);
    expect(
      entries.every(
        (entry) => entry.source === "comment" && entry.replyCount === 0,
      ),
    ).toBe(true);
  });

  it("события и комментарии вместе", async () => {
    const { db } = fakeDb({
      events: [eventRow("e-1", at(1))],
      comments: [commentRow("c-1", at(2))],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => [entry.id, entry.source])).toEqual([
      ["c-1", "comment"],
      ["e-1", "event"],
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  Порядок                                                            */
/* ------------------------------------------------------------------ */

describe("getSpecItemHistory: порядок", () => {
  it("разные timestamps — свежие сверху", async () => {
    const { db } = fakeDb({
      events: [eventRow("e-1", at(10)), eventRow("e-3", at(30)), eventRow("e-2", at(20))],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["e-3", "e-2", "e-1"]);
  });

  it("одинаковый createdAt — порядок по id по убыванию", async () => {
    const stamp = at(10);
    const { db } = fakeDb({
      events: [
        eventRow("b", stamp),
        eventRow("c", stamp),
        eventRow("a", stamp),
      ],
    });

    const first = await getSpecItemHistory(db, { orgId: ORG, specItemId: ITEM });
    const second = await getSpecItemHistory(db, { orgId: ORG, specItemId: ITEM });

    expect(first.entries.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
    // Повторное чтение даёт тот же порядок: id — детерминированный тай-брейкер.
    expect(second.entries.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
  });

  it("id сравнивается как строка, а не как время", async () => {
    // UUID не является временным значением: «младший» id — это меньшая строка,
    // а не более старая запись.
    const stamp = at(10);
    const { db } = fakeDb({
      events: [eventRow("ffffffff-0000", stamp), eventRow("00000000-ffff", stamp)],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      "ffffffff-0000",
      "00000000-ffff",
    ]);
  });

  it("события и комментарии перемешиваются по времени", async () => {
    const { db } = fakeDb({
      events: [eventRow("e-1", at(10)), eventRow("e-3", at(30))],
      comments: [commentRow("c-2", at(20)), commentRow("c-4", at(40))],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["c-4", "e-3", "c-2", "e-1"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Пагинация                                                          */
/* ------------------------------------------------------------------ */

describe("getSpecItemHistory: пагинация", () => {
  it("первая страница: ровно limit записей и курсор из последней", async () => {
    const { db } = fakeDb({
      events: [eventRow("e-1", at(10)), eventRow("e-2", at(20)), eventRow("e-3", at(30))],
    });

    const { entries, nextCursor } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 2,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["e-3", "e-2"]);
    expect(nextCursor).toEqual({ createdAt: at(20), id: "e-2" });
  });

  it("вторая страница по курсору, дальше курсора нет", async () => {
    const { db } = fakeDb({
      events: [eventRow("e-1", at(10)), eventRow("e-2", at(20)), eventRow("e-3", at(30))],
    });

    const second = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 2,
      before: { createdAt: at(20), id: "e-2" },
    });

    expect(second.entries.map((entry) => entry.id)).toEqual(["e-1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("постраничное чтение не даёт дублей и пропусков", async () => {
    const { db } = fakeDb({
      events: [
        eventRow("e-1", at(10)),
        eventRow("e-2", at(20)),
        eventRow("e-3", at(30)),
        eventRow("e-4", at(40)),
        eventRow("e-5", at(50)),
      ],
    });

    const { collected, cursors } = await readAll(db, 2);

    expect(collected.map((entry) => entry.id)).toEqual([
      "e-5",
      "e-4",
      "e-3",
      "e-2",
      "e-1",
    ]);
    expect(new Set(collected.map((entry) => entry.id)).size).toBe(5);
    expect(cursors.filter(Boolean)).toHaveLength(2);
    expect(cursors[cursors.length - 1]).toBeNull();
  });

  it("курсор на одинаковом timestamp не теряет и не дублирует записи", async () => {
    const stamp = at(15);
    const { db } = fakeDb({
      events: [
        eventRow("e-a", stamp),
        eventRow("e-b", stamp),
        eventRow("e-c", stamp),
        eventRow("e-d", stamp),
      ],
    });

    const { collected, cursors } = await readAll(db, 2);

    expect(collected.map((entry) => entry.id)).toEqual([
      "e-d",
      "e-c",
      "e-b",
      "e-a",
    ]);
    expect(new Set(collected.map((entry) => entry.id)).size).toBe(4);
    expect(cursors[0]).toEqual({ createdAt: stamp, id: "e-c" });
    expect(cursors[cursors.length - 1]).toBeNull();
  });

  it("пагинация только по комментариям", async () => {
    const { db } = fakeDb({
      comments: [
        commentRow("c-1", at(10)),
        commentRow("c-2", at(20)),
        commentRow("c-3", at(30)),
      ],
    });

    const { collected, cursors } = await readAll(db, 1);

    expect(collected.map((entry) => entry.id)).toEqual(["c-3", "c-2", "c-1"]);
    expect(cursors.filter(Boolean)).toHaveLength(2);
  });

  it("пагинация смешанной ленты", async () => {
    const { db } = fakeDb({
      events: [eventRow("e-1", at(50)), eventRow("e-2", at(30)), eventRow("e-3", at(10))],
      comments: [commentRow("c-1", at(40)), commentRow("c-2", at(20))],
    });

    const { collected } = await readAll(db, 2);

    expect(collected.map((entry) => entry.id)).toEqual([
      "e-1",
      "c-1",
      "e-2",
      "c-2",
      "e-3",
    ]);
  });

  it("курсор определяется после объединения, а не по одной таблице", async () => {
    // 100 событий и ни одного комментария: страница полная, курсор есть.
    const onlyEvents = fakeDb({
      events: Array.from({ length: 100 }, (_, index) =>
        eventRow(`e-${String(index).padStart(3, "0")}`, at(0, index * 1000)),
      ),
    });
    const eventsPage = await getSpecItemHistory(onlyEvents.db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 50,
    });
    expect(eventsPage.entries).toHaveLength(50);
    expect(eventsPage.nextCursor).not.toBeNull();

    // 0 событий и 100 комментариев: то же самое.
    const onlyComments = fakeDb({
      comments: Array.from({ length: 100 }, (_, index) =>
        commentRow(`c-${String(index).padStart(3, "0")}`, at(0, index * 1000)),
      ),
    });
    const commentsPage = await getSpecItemHistory(onlyComments.db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 50,
    });
    expect(commentsPage.entries).toHaveLength(50);
    expect(commentsPage.nextCursor).not.toBeNull();

    // 50 и 50: каждая таблица отдала свою страницу + лишнюю запись.
    const both = fakeDb({
      events: Array.from({ length: 50 }, (_, index) =>
        eventRow(`e-${String(index).padStart(3, "0")}`, at(0, index * 2000)),
      ),
      comments: Array.from({ length: 50 }, (_, index) =>
        commentRow(`c-${String(index).padStart(3, "0")}`, at(1, index * 2000)),
      ),
    });
    const bothPage = await getSpecItemHistory(both.db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 50,
    });
    expect(bothPage.entries).toHaveLength(50);
    expect(bothPage.nextCursor).not.toBeNull();

    // Меньше limit суммарно — курсора нет, хотя лишних строк не было ни в одной
    // таблице.
    const few = fakeDb({
      events: Array.from({ length: 20 }, (_, index) =>
        eventRow(`e-${index}`, at(0, index * 1000)),
      ),
      comments: Array.from({ length: 20 }, (_, index) =>
        commentRow(`c-${index}`, at(1, index * 1000)),
      ),
    });
    const fewPage = await getSpecItemHistory(few.db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 50,
    });
    expect(fewPage.entries).toHaveLength(40);
    expect(fewPage.nextCursor).toBeNull();
  });

  it("лишняя строка в одной таблице не создаёт курсор, если в ленту она не попала", async () => {
    // Событий 51 (страница + лишняя), комментариев 0, лимит 50: лишняя строка
    // есть — курсор есть.
    const { db } = fakeDb({
      events: Array.from({ length: 51 }, (_, index) =>
        eventRow(`e-${String(index).padStart(3, "0")}`, at(0, index * 1000)),
      ),
    });

    const page = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 50,
    });

    expect(page.entries).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Limit                                                             */
/* ------------------------------------------------------------------ */

describe("getSpecItemHistory: limit", () => {
  const many = () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      eventRow(`e-${String(index).padStart(3, "0")}`, at(0, index * 1000)),
    );
    return fakeDb({ events: rows });
  };

  it("по умолчанию 50 (из каждой таблицы берётся 51 запись)", async () => {
    const { db, calls } = many();

    const page = await getSpecItemHistory(db, { orgId: ORG, specItemId: ITEM });

    expect(page.entries).toHaveLength(50);
    expect(eventsCall(calls).limit).toBe(51);
    expect(commentsCall(calls).limit).toBe(51);
  });

  it("limit = 1", async () => {
    const { db, calls } = many();

    const page = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 1,
    });

    expect(page.entries).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(eventsCall(calls).limit).toBe(2);
  });

  it("limit = 100 (верхняя граница)", async () => {
    const { db, calls } = many();

    const page = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 100,
    });

    expect(page.entries).toHaveLength(100);
    expect(page.nextCursor).not.toBeNull();
    expect(eventsCall(calls).limit).toBe(101);
  });

  it("limit > 100 обрезается до 100", async () => {
    const { db, calls } = many();

    const page = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 1000,
    });

    expect(page.entries).toHaveLength(100);
    expect(eventsCall(calls).limit).toBe(101);
  });

  it("limit <= 0 поднимается до 1", async () => {
    for (const limit of [0, -5]) {
      const { db, calls } = many();

      const page = await getSpecItemHistory(db, {
        orgId: ORG,
        specItemId: ITEM,
        limit,
      });

      expect(page.entries, String(limit)).toHaveLength(1);
      expect(eventsCall(calls).limit, String(limit)).toBe(2);
    }
  });

  it("limit не число — берётся значение по умолчанию", async () => {
    const { db, calls } = many();

    const page = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: Number.NaN,
    });

    expect(page.entries).toHaveLength(50);
    expect(eventsCall(calls).limit).toBe(51);
  });
});

/* ------------------------------------------------------------------ */
/*  Комментарии                                                        */
/* ------------------------------------------------------------------ */

describe("getSpecItemHistory: комментарии", () => {
  it("replyCount берётся из отдельного запроса, а не со страницы", async () => {
    const { db, calls } = fakeDb({
      comments: [
        commentRow("c-1", at(30)),
        commentRow("c-2", at(20)),
        // Ответы c-1 лежат в БД и на страницу не попадают: c-1 старый.
        commentRow("r-1", at(10), { parent_id: "c-1", root_id: "c-1" }),
        commentRow("r-2", at(5), { parent_id: "c-1", root_id: "c-1" }),
      ],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    expect(byId.get("c-1")).toMatchObject({ replyCount: 2 });
    expect(byId.get("c-2")).toMatchObject({ replyCount: 0 });
    expect(byId.get("r-1")).toMatchObject({ replyCount: 0 });

    // Счётчики считаются по всей позиции: фильтров по времени/странице нет.
    const counts = countsCall(calls);
    expect(counts.eqs).toEqual([
      ["org_id", ORG],
      ["spec_item_id", ITEM],
    ]);
    expect(counts.notNull).toEqual(["parent_id"]);
    expect(counts.or).toBeNull();
    expect(counts.limit).toBeNull();
  });

  it("удалённый ответ остаётся ответом и учитывается в replyCount", async () => {
    const { db, calls } = fakeDb({
      comments: [
        commentRow("c-1", at(30)),
        commentRow("r-1", at(20), {
          parent_id: "c-1",
          root_id: "c-1",
          deleted_at: at(25),
        }),
      ],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.find((entry) => entry.id === "c-1")).toMatchObject({
      replyCount: 1,
    });
    expect(entries.find((entry) => entry.id === "r-1")).toMatchObject({
      deleted: true,
    });
    // deleted_at в агрегате не фильтруется — иначе ответ «исчез» бы из счётчика.
    expect(countsCall(calls).notNull).toEqual(["parent_id"]);
  });

  it("удалённый комментарий возвращается с deleted = true", async () => {
    const { db } = fakeDb({
      comments: [
        commentRow("c-1", at(10), { deleted_at: at(11), body: "Текст был" }),
      ],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries[0]).toMatchObject({
      source: "comment",
      deleted: true,
      body: "Текст был",
      editedAt: null,
    });
  });

  it("ответ на удалённый комментарий остаётся в ленте", async () => {
    const { db } = fakeDb({
      comments: [
        commentRow("c-1", at(20), { deleted_at: at(21) }),
        commentRow("r-1", at(10), { parent_id: "c-1", root_id: "c-1" }),
      ],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["c-1", "r-1"]);
    // `source` сужает union: `deleted` есть только у комментария.
    expect(
      entries.map((entry) => (entry.source === "comment" ? entry.deleted : null)),
    ).toEqual([true, false]);
  });

  it("ошибка запроса счётчиков не роняет чтение", async () => {
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({
      comments: [commentRow("c-1", at(10))],
      failWhen: (call) => call.select === "parent_id",
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ replyCount: 0 });
    expect(onError).toHaveBeenCalled();
    onError.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  События                                                            */
/* ------------------------------------------------------------------ */

describe("getSpecItemHistory: события", () => {
  it("неизвестный kind пропускается, остальные записи остаются", async () => {
    const { db } = fakeDb({
      events: [
        eventRow("e-1", at(30)),
        eventRow("e-2", at(20), { kind: "invented_kind", payload: { any: 1 } }),
        eventRow("e-3", at(10)),
      ],
      comments: [commentRow("c-1", at(5))],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["e-1", "e-3", "c-1"]);
  });

  it("пропущенное событие не создаёт ложный курсор", async () => {
    // Все три строки попали в выборку, но одна не смаппилась: известных
    // записей ровно limit, значит следующей страницы нет.
    const { db } = fakeDb({
      events: [
        eventRow("e-1", at(30)),
        eventRow("e-2", at(20), { kind: "invented_kind" }),
        eventRow("e-3", at(10)),
      ],
    });

    const { entries, nextCursor } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 2,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["e-1", "e-3"]);
    expect(nextCursor).toBeNull();
  });

  it("мусорный payload не ломает чтение", async () => {
    const { db } = fakeDb({
      events: [
        eventRow("e-1", at(20), { payload: null }),
        eventRow("e-2", at(10), { payload: "не объект" }),
      ],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["e-1", "e-2"]);
    expect(entries[0]).toMatchObject({
      kind: "created",
      payload: { code: null, name: null, type: null, origin: null },
    });
  });

  it("ошибка чтения событий пробрасывается", async () => {
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({
      events: [eventRow("e-1", at(10))],
      failWhen: (call) => call.table === "spec_item_events",
    });

    await expect(
      getSpecItemHistory(db, { orgId: ORG, specItemId: ITEM }),
    ).rejects.toThrow(/Не удалось загрузить историю \(события\)/);
    onError.mockRestore();
  });

  it("ошибка чтения комментариев пробрасывается", async () => {
    const { db } = fakeDb({
      comments: [commentRow("c-1", at(10))],
      failWhen: (call) => call.select === COMMENT_COLUMNS,
    });

    await expect(
      getSpecItemHistory(db, { orgId: ORG, specItemId: ITEM }),
    ).rejects.toThrow(/Не удалось загрузить историю \(комментарии\)/);
  });
});

/* ------------------------------------------------------------------ */
/*  Изоляция и форма запросов                                          */
/* ------------------------------------------------------------------ */

describe("getSpecItemHistory: изоляция и запросы", () => {
  it("чужая организация не попадает в ленту", async () => {
    const { db } = fakeDb({
      events: [
        eventRow("e-1", at(20)),
        eventRow("e-2", at(10), { org_id: "org-2" }),
      ],
      comments: [
        commentRow("c-1", at(5)),
        commentRow("c-2", at(4), { org_id: "org-2" }),
      ],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["e-1", "c-1"]);
  });

  it("другая позиция с тем же id в чужой организации не попадает", async () => {
    const { db } = fakeDb({
      events: [
        eventRow("e-1", at(20)),
        eventRow("e-2", at(10), { org_id: "org-2", spec_item_id: ITEM }),
      ],
    });

    const { entries } = await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["e-1"]);
  });

  it("запросы фильтруются по организации и позиции, сортируются и ограничены", async () => {
    const { db, calls } = fakeDb();

    await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      limit: 10,
    });

    for (const call of [eventsCall(calls), commentsCall(calls)]) {
      expect(call.eqs).toEqual([
        ["org_id", ORG],
        ["spec_item_id", ITEM],
      ]);
      expect(call.orders).toEqual([
        ["created_at", false],
        ["id", false],
      ]);
      expect(call.limit).toBe(11);
      expect(call.or).toBeNull();
    }

    expect(eventsCall(calls).select).toBe(EVENT_COLUMNS);
    expect(commentsCall(calls).select).toBe(COMMENT_COLUMNS);
  });

  it("курсор превращается в фильтр PostgREST с закавыченными значениями", async () => {
    const { db, calls } = fakeDb();

    await getSpecItemHistory(db, {
      orgId: ORG,
      specItemId: ITEM,
      before: { createdAt: at(20), id: "e-2" },
    });

    const expected = `created_at.lt."${at(20)}",and(created_at.eq."${at(20)}",id.lt."e-2")`;
    expect(eventsCall(calls).or).toBe(expected);
    expect(commentsCall(calls).or).toBe(expected);
  });

  it("уходят три запроса: события, страница комментариев и счётчики", async () => {
    const { db, calls } = fakeDb();

    await getSpecItemHistory(db, { orgId: ORG, specItemId: ITEM });

    expect(calls.map((call) => call.table)).toEqual([
      "spec_item_events",
      "spec_item_comments",
      "spec_item_comments",
    ]);
    expect(eventsCall(calls).select).toBe(EVENT_COLUMNS);
    expect(commentsCall(calls).select).toBe(COMMENT_COLUMNS);
    expect(countsCall(calls).select).toBe("parent_id");
  });
});
