import { describe, expect, it } from "vitest";

import {
  activityQuoteText,
  buildActivityFeed,
  type ActivityCommentItem,
  type ActivityEventItem,
  type ActivityFeedItem,
} from "./activity-view";
import type { ActivityRecord } from "./activity-format";
import type { HistoryCommentEntry, HistoryEventEntry } from "./history-types";

/**
 * Тесты раскладки ленты: разделители дней и ветки ответов.
 *
 * Проверяется то, что нельзя вывести из одной записи: границы дней, привязка
 * ответов к корню и порядок внутри ветки (`createdAt ASC`). Порядок самих
 * записей ленты — серверный (`createdAt DESC, id DESC`), и здесь он только
 * сохраняется.
 */

const NOW = new Date("2026-09-25T18:00:00.000Z");

function comment(
  id: string,
  createdAt: string,
  overrides: Partial<HistoryCommentEntry> = {},
): HistoryCommentEntry {
  return {
    id,
    orgId: "org-1",
    specItemId: "item-1",
    createdAt,
    actor: { id: "u-1", name: "Анна Петрова" },
    source: "comment",
    parentId: null,
    rootId: null,
    body: `Текст ${id}`,
    editedAt: null,
    deleted: false,
    replyCount: 0,
    ...overrides,
  };
}

function event(id: string, createdAt: string): HistoryEventEntry {
  return {
    id,
    orgId: "org-1",
    specItemId: "item-1",
    createdAt,
    actor: { id: "u-1", name: "Анна Петрова" },
    source: "event",
    kind: "removed",
    payload: { code: "М-01", name: "Стул" },
  } as unknown as HistoryEventEntry;
}

/** Только комментарии-ветки из результата, в порядке ленты. */
function threads(items: ActivityFeedItem[]): ActivityCommentItem[] {
  return items.filter(
    (item): item is ActivityCommentItem => item.kind === "comment",
  );
}

function separators(items: ActivityFeedItem[]) {
  return items.filter((item) => item.kind === "date");
}

function events(items: ActivityFeedItem[]): ActivityEventItem[] {
  return items.filter((item): item is ActivityEventItem => item.kind === "event");
}

describe("buildActivityFeed: разделители дней", () => {
  it("группа открывается разделителем, подпись — «Сегодня» / «Вчера» / дата", () => {
    const records: ActivityRecord[] = [
      event("ev-2", "2026-09-25T14:03:00.000Z"),
      event("ev-1", "2026-09-24T09:00:00.000Z"),
      event("ev-0", "2026-09-20T09:00:00.000Z"),
    ];

    const items = buildActivityFeed(records, NOW);

    expect(separators(items).map((s) => s.label)).toEqual([
      "Сегодня",
      "Вчера",
      "20 сентября",
    ]);
  });

  it("разделитель один на день, даже если записей несколько", () => {
    const records: ActivityRecord[] = [
      event("ev-3", "2026-09-25T14:03:00.000Z"),
      event("ev-2", "2026-09-25T12:00:00.000Z"),
      event("ev-1", "2026-09-25T09:00:00.000Z"),
    ];

    const items = buildActivityFeed(records, NOW);

    expect(separators(items)).toHaveLength(1);
    expect(events(items)).toHaveLength(3);
  });

  it("разделитель стоит перед первой записью дня, а не вместо неё", () => {
    const items = buildActivityFeed(
      [event("ev-1", "2026-09-25T14:03:00.000Z")],
      NOW,
    );

    expect(items.map((item) => item.kind)).toEqual(["date", "event"]);
  });

  it("порядок записей сервера сохраняется как есть", () => {
    const items = buildActivityFeed(
      [
        event("ev-3", "2026-09-25T14:03:00.000Z"),
        event("ev-2", "2026-09-25T12:00:00.000Z"),
        event("ev-1", "2026-09-25T09:00:00.000Z"),
      ],
      NOW,
    );

    expect(events(items).map((item) => item.id)).toEqual([
      "ev-3",
      "ev-2",
      "ev-1",
    ]);
  });
});

describe("buildActivityFeed: ветки ответов", () => {
  it("ответы собираются под своим корнем в порядке createdAt ASC", () => {
    const records: ActivityRecord[] = [
      // Лента «новые сверху»: корень ниже своих ответов — обычное дело.
      comment("reply-late", "2026-09-25T13:00:00.000Z", {
        parentId: "root",
        rootId: "root",
      }),
      comment("reply-early", "2026-09-25T11:00:00.000Z", {
        parentId: "root",
        rootId: "root",
      }),
      comment("root", "2026-09-25T10:00:00.000Z"),
    ];

    const items = buildActivityFeed(records, NOW);
    const [thread] = threads(items);

    expect(thread.id).toBe("root");
    // Внутри ветки — от старого к новому, хотя в ленте порядок обратный.
    expect(thread.replies.map((r) => r.id)).toEqual(["reply-early", "reply-late"]);
    // Ответы не появляются в ленте отдельными записями.
    expect(threads(items)).toHaveLength(1);
  });

  it("ответ ссылается на снимок родителя для цитаты", () => {
    const records: ActivityRecord[] = [
      comment("reply", "2026-09-25T13:00:00.000Z", {
        parentId: "root",
        rootId: "root",
      }),
      comment("root", "2026-09-25T10:00:00.000Z"),
    ];

    const [thread] = threads(buildActivityFeed(records, NOW));

    expect(thread.replies[0].parent?.id).toBe("root");
    expect(activityQuoteText(thread.replies[0].parent)).toBe("Текст root");
  });

  it("ответ без корня на странице остаётся самостоятельной записью", () => {
    const records: ActivityRecord[] = [
      comment("orphan", "2026-09-25T13:00:00.000Z", {
        parentId: "root-not-loaded",
        rootId: "root-not-loaded",
      }),
    ];

    const [thread] = threads(buildActivityFeed(records, NOW));

    expect(thread.id).toBe("orphan");
    expect(thread.replies).toEqual([]);
    expect(thread.comment.id).toBe("orphan");
  });

  it("третьего уровня вложенности не появляется", () => {
    const records: ActivityRecord[] = [
      comment("reply-2", "2026-09-25T13:00:00.000Z", {
        parentId: "reply-1",
        rootId: "root",
      }),
      comment("root", "2026-09-25T12:00:00.000Z"),
      comment("reply-1", "2026-09-25T11:00:00.000Z", {
        parentId: "root",
        rootId: "root",
      }),
    ];

    const [thread] = threads(buildActivityFeed(records, NOW));

    // Ответ на ответ остаётся плоским ответом ветки — на одном уровне.
    expect(thread.replies.map((r) => r.id)).toEqual(["reply-1", "reply-2"]);
    expect(thread.replies.every((r) => !("replies" in r))).toBe(true);
  });

  it("replyCount и editedAt/удалённость доходят до ветки без изменений", () => {
    const records: ActivityRecord[] = [
      comment("root", "2026-09-25T12:00:00.000Z", {
        replyCount: 3,
        editedAt: "2026-09-25T12:30:00.000Z",
      }),
      comment("reply", "2026-09-25T11:00:00.000Z", {
        parentId: "root",
        rootId: "root",
        deleted: true,
        body: "текст, который показывать нельзя",
      }),
    ];

    const [thread] = threads(buildActivityFeed(records, NOW));

    expect(thread.comment.replyCount).toBe(3);
    expect(thread.comment.editedAt).toBe("2026-09-25T12:30:00.000Z");
    expect(thread.replies[0].reply.deleted).toBe(true);
    // Удалённый ответ остаётся в ветке — он часть хронологии.
    expect(thread.replies[0].reply.body).toBe(
      "текст, который показывать нельзя",
    );
  });

  it("replyCount = 0 при ошибке подсчёта ничего не ломает", () => {
    const [thread] = threads(
      buildActivityFeed([comment("root", "2026-09-25T12:00:00.000Z")], NOW),
    );

    expect(thread.comment.replyCount).toBe(0);
  });
});

describe("buildActivityFeed: ключи элементов уникальны", () => {
  it("повтор записи не удваивает ни запись, ни разделитель дня", () => {
    // Именно этот случай ломал добавление комментария: одна и та же запись,
    // пришедшая дважды, давала два ключа `date:…`, React ругался на
    // неуникальные ключи, а лента дублировала записи.
    const duplicate = comment("cm-1", "2026-09-01T10:00:00.000Z");
    const records: ActivityRecord[] = [duplicate, duplicate];

    const items = buildActivityFeed(records, NOW);
    const keys = items.map((item) => item.id);

    expect(new Set(keys).size).toBe(keys.length);
    expect(separators(items)).toHaveLength(1);
    expect(threads(items)).toHaveLength(1);
  });

  it("повтор записи вперемешку с другими не сдвигает порядок", () => {
    const records: ActivityRecord[] = [
      event("ev-2", "2026-09-25T14:00:00.000Z"),
      comment("cm-1", "2026-09-25T13:00:00.000Z"),
      event("ev-2", "2026-09-25T14:00:00.000Z"),
      comment("cm-1", "2026-09-25T13:00:00.000Z"),
    ];

    const items = buildActivityFeed(records, NOW);

    expect(items.map((item) => item.id)).toEqual([
      "date:0:2026-09-25T14:00:00.000Z",
      "ev-2",
      "cm-1",
    ]);
  });

  it("ключи разделителей уникальны и различают дни и годы", () => {
    const records: ActivityRecord[] = [
      event("ev-3", "2026-09-01T10:00:00.000Z"),
      event("ev-2", "2025-09-01T10:00:00.000Z"),
      event("ev-1", "2025-09-02T10:00:00.000Z"),
    ];

    const keys = buildActivityFeed(records, NOW).map((item) => item.id);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("записи одного дня делят один разделитель, соседний день даёт свой", () => {
    // Время берётся «серединой» суток, а не границей: локальная зона сдвигает
    // UTC-полночь на соседний день, и тест стал бы зависеть от пояса машины.
    const records: ActivityRecord[] = [
      event("ev-3", "2026-09-25T12:00:00.000Z"),
      event("ev-2", "2026-09-25T10:00:00.000Z"),
      event("ev-1", "2026-09-24T12:00:00.000Z"),
    ];

    const items = buildActivityFeed(records, NOW);

    // Два дня — два разделителя; записи одного дня второго не получают.
    expect(separators(items)).toHaveLength(2);
    expect(items.map((item) => item.id)).toEqual([
      // Ключ разделителя — номер плюс `createdAt` первой записи дня.
      "date:0:2026-09-25T12:00:00.000Z",
      "ev-3",
      "ev-2",
      "date:1:2026-09-24T12:00:00.000Z",
      "ev-1",
    ]);
  });
});

describe("activityQuoteText", () => {
  it("удалённый родитель не раскрывает текст", () => {
    expect(
      activityQuoteText(
        comment("root", "2026-09-25T12:00:00.000Z", {
          deleted: true,
          body: "секрет",
        }),
      ),
    ).toBe("Комментарий удалён");
  });

  it("отсутствующий снимок родителя — «—»", () => {
    expect(activityQuoteText(null)).toBe("—");
  });
});

describe("buildActivityFeed: устойчивость", () => {
  it("пустой список даёт пустую ленту без разделителя", () => {
    expect(buildActivityFeed([], NOW)).toEqual([]);
  });

  it("смешанная лента сохраняет и события, и ветки", () => {
    const records: ActivityRecord[] = [
      comment("reply", "2026-09-25T13:00:00.000Z", {
        parentId: "root",
        rootId: "root",
      }),
      event("ev-1", "2026-09-25T12:30:00.000Z"),
      comment("root", "2026-09-25T12:00:00.000Z"),
    ];

    const items = buildActivityFeed(records, NOW);

    // Порядок — серверный: ответ (13:00) ушёл в ветку корня и в ленте отдельной
    // записью не появился, поэтому в ленте остались событие (12:30) и корень
    // (12:00) — ровно в том порядке, в каком их отдал сервер.
    expect(items.map((item) => item.kind)).toEqual([
      "date",
      "event",
      "comment",
    ]);
    expect(threads(items)[0].replies).toHaveLength(1);
    expect(events(items)[0].id).toBe("ev-1");
  });
});
