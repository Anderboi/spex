import { describe, expect, it } from "vitest";

import {
  buildOptimisticComment,
  checkComposerBody,
  isOptimisticCommentId,
  optimisticCommentId,
} from "./comment-write";
import { buildActivityFeed } from "./activity-view";
import type { ActivityRecord } from "./activity-format";
import type { HistoryCommentEntry } from "./history-types";

/**
 * Тесты поведения composer'а на уровне модели.
 *
 * Сам `useCommentComposer` — оркестрация над server action, и проверять его в
 * проекте нечем: React-тестов в `npm test` нет, а временную инфраструктуру
 * заводить нельзя. Поэтому здесь закреплены ровно те правила, которые хук
 * использует и на которых держится его поведение:
 *
 *   * что считается готовым к отправке текстом (пустое и пробельное — нет);
 *   * как выглядит временная optimistic-запись и чем она отличается от
 *     серверной;
 *   * куда `buildActivityFeed` её раскладывает: новый корень — вверх, ответ —
 *     в конец своей ветки, ответ на ответ — в ту же ветку.
 */

const NOW = new Date("2026-09-25T18:00:00.000Z");
const AUTHOR = { id: "user-1", name: "Анна" };

function comment(
  id: string,
  createdAt: string,
  over: Partial<HistoryCommentEntry> = {},
): HistoryCommentEntry {
  return {
    id,
    orgId: "org-1",
    specItemId: "item-1",
    createdAt,
    actor: AUTHOR,
    source: "comment",
    parentId: null,
    rootId: null,
    body: `Текст ${id}`,
    editedAt: null,
    deleted: false,
    replyCount: 0,
    ...over,
  };
}

describe("composer: готовность к отправке", () => {
  it("пустой текст не отправляется", () => {
    expect(checkComposerBody("")).toEqual({
      ok: false,
      message: "Комментарий не может быть пустым",
    });
  });

  it("текст из одних пробелов не отправляется", () => {
    expect(checkComposerBody("   \n\t ").ok).toBe(false);
  });

  it("текст с пробелами по краям отправляется обрезанным", () => {
    expect(checkComposerBody("  Привет  ")).toEqual({ ok: true, body: "Привет" });
  });
});

describe("composer: временная optimistic-запись", () => {
  it("идентификатор явно клиентский", () => {
    const id = optimisticCommentId();
    expect(isOptimisticCommentId(id)).toBe(true);
    // Сервер выдаёт UUID, поэтому настоящий id оптимистичным быть не может.
    expect(isOptimisticCommentId("a1b2c3d4-0000-4000-8000-000000000000")).toBe(
      false,
    );
  });

  it("корневой комментарий: без родителя и ветки, replyCount = 0", () => {
    const optimistic = buildOptimisticComment({
      orgId: "org-1",
      specItemId: "item-1",
      author: AUTHOR,
      body: "Новый корень",
      parent: null,
      createdAt: "2026-09-25T17:00:00.000Z",
    });

    expect(optimistic.parentId).toBeNull();
    expect(optimistic.rootId).toBeNull();
    expect(optimistic.replyCount).toBe(0);
    expect(optimistic.deleted).toBe(false);
    expect(optimistic.editedAt).toBeNull();
    expect(optimistic.actor).toEqual(AUTHOR);
  });

  it("ответ на корень: ветка — сам корень", () => {
    const optimistic = buildOptimisticComment({
      orgId: "org-1",
      specItemId: "item-1",
      author: AUTHOR,
      body: "Ответ",
      parent: { id: "root", parentId: null, rootId: null },
      createdAt: "2026-09-25T17:00:00.000Z",
    });

    expect(optimistic.parentId).toBe("root");
    expect(optimistic.rootId).toBe("root");
  });

  it("ответ на ответ остаётся в той же ветке (третьего уровня нет)", () => {
    const optimistic = buildOptimisticComment({
      orgId: "org-1",
      specItemId: "item-1",
      author: AUTHOR,
      body: "Ответ на ответ",
      parent: { id: "reply", parentId: "root", rootId: "root" },
      createdAt: "2026-09-25T17:00:00.000Z",
    });

    // На сервер уйдёт `parentId: "reply"`, а он нормализует его к корню —
    // предпросмотр показывает уже нормализованный результат.
    expect(optimistic.rootId).toBe("root");
  });
});

describe("composer: место записи в ленте", () => {
  /**
   * Лента приходит с сервера в порядке `createdAt DESC`: optimistic-запись
   * встаёт в тот же список, поэтому и здесь он собирается так же.
   */
  function asFeed(records: ActivityRecord[]): ActivityRecord[] {
    return [...records].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
  }

  const existing: ActivityRecord[] = asFeed([
    comment("root", "2026-09-25T10:00:00.000Z"),
    comment("reply-1", "2026-09-25T11:00:00.000Z", {
      parentId: "root",
      rootId: "root",
    }),
  ]);

  it("новый корневой комментарий появляется сверху", () => {
    const optimistic = buildOptimisticComment({
      orgId: "org-1",
      specItemId: "item-1",
      author: AUTHOR,
      body: "Новый корень",
      parent: null,
      // Свежее всех подтверждённых записей.
      createdAt: "2026-09-25T12:00:00.000Z",
    });

    const items = buildActivityFeed(asFeed([...existing, optimistic]), NOW);
    const comments = items.filter((item) => item.kind === "comment");

    // Сначала разделитель дня, затем — свежая запись, потом прежний корень.
    expect(items[0].kind).toBe("date");
    expect(comments.map((item) => (item.kind === "comment" ? item.id : ""))).toEqual([
      optimistic.id,
      "root",
    ]);
  });

  it("новый ответ появляется в конце своей ветки", () => {
    const optimistic = buildOptimisticComment({
      orgId: "org-1",
      specItemId: "item-1",
      author: AUTHOR,
      body: "Новый ответ",
      parent: { id: "root", parentId: null, rootId: null },
      createdAt: "2026-09-25T12:00:00.000Z",
    });

    const items = buildActivityFeed(asFeed([...existing, optimistic]), NOW);
    const root = items.find(
      (item) => item.kind === "comment" && item.id === "root",
    );

    expect(root).toBeDefined();
    // От старого к новому: существующий ответ, затем новый.
    expect(
      root && root.kind === "comment"
        ? root.replies.map((r) => r.id)
        : [],
    ).toEqual(["reply-1", optimistic.id]);
  });

  it("ответ на ответ не создаёт третий уровень и попадает в ту же ветку", () => {
    const optimistic = buildOptimisticComment({
      orgId: "org-1",
      specItemId: "item-1",
      author: AUTHOR,
      body: "Ответ на ответ",
      parent: { id: "reply-1", parentId: "root", rootId: "root" },
      createdAt: "2026-09-25T12:00:00.000Z",
    });

    const items = buildActivityFeed(asFeed([...existing, optimistic]), NOW);
    const comments = items.filter((item) => item.kind === "comment");

    // Ветка по-прежнему одна, ответ ушёл в неё же.
    expect(comments).toHaveLength(1);
    expect(comments[0].kind === "comment" && comments[0].id).toBe("root");
    expect(
      comments[0].kind === "comment"
        ? comments[0].replies.map((r) => r.id)
        : [],
    ).toEqual(["reply-1", optimistic.id]);
  });

  it("подменённая серверная запись встаёт на то же место, что и предпросмотр", () => {
    const optimistic = buildOptimisticComment({
      orgId: "org-1",
      specItemId: "item-1",
      author: AUTHOR,
      body: "Новый корень",
      parent: null,
      createdAt: "2026-09-25T12:00:00.000Z",
    });

    // Сервер вернул свою запись: тот же смысл, но его id и снимок автора.
    const confirmed = comment(optimistic.id.replace("optimistic:", "cm-"), optimistic.createdAt, {
      actor: { id: AUTHOR.id, name: "Анна Петровна" },
    });

    const before = buildActivityFeed(asFeed([...existing, optimistic]), NOW);
    const after = buildActivityFeed(asFeed([...existing, confirmed]), NOW);

    // Место в ленте не изменилось — изменилась только отображаемая запись.
    expect(after.map((item) => item.kind)).toEqual(
      before.map((item) => item.kind),
    );
    const confirmedItem = after.find((item) => item.kind === "comment");
    expect(
      confirmedItem && confirmedItem.kind === "comment"
        ? confirmedItem.comment.actor.name
        : null,
    ).toBe("Анна Петровна");
  });
});
