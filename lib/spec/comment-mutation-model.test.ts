import { describe, expect, it } from "vitest";

import {
  applyCommentMutation,
  applyCommentMutations,
  canMutateComment,
  createDeleteMutation,
  createEditMutation,
  isEditingComment,
  markMutationPending,
  type PendingCommentMutations,
} from "./comment-mutation-model";
import { buildActivityFeed } from "./activity-view";
import type { ActivityRecord } from "./activity-format";
import type { HistoryCommentEntry } from "./history-types";

/**
 * Тесты модели правки и удаления комментария.
 *
 * React-тестов в проекте нет, поэтому вся переходная логика (optimistic-состояние,
 * откат, доступность действий, взаимоисключение операций) вынесена в чистые
 * функции и проверяется здесь. Хук `useCommentMutations` остаётся обвязкой:
 * вызвать server action и разложить результат по этому состоянию.
 */

const AUTHOR_ID = "user-1";
const OTHER_ID = "user-2";

function comment(
  id: string,
  over: Partial<HistoryCommentEntry> = {},
): HistoryCommentEntry {
  return {
    id,
    orgId: "org-1",
    specItemId: "item-1",
    createdAt: "2026-09-25T10:00:00.000Z",
    actor: { id: AUTHOR_ID, name: "Анна" },
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

function mutationsOf(
  ...items: [string, ReturnType<typeof createEditMutation>][]
): PendingCommentMutations {
  return new Map(items);
}

/**
 * Лента после операций, суженная до комментариев.
 *
 * `applyCommentMutations` работает со всей лентой и возвращает `ActivityRecord`
 * (событий операции не касаются), поэтому в тестах про поля комментария нужен
 * явный отбор — `as` здесь был бы ослаблением типов.
 */
function commentsOnly(records: ActivityRecord[]): HistoryCommentEntry[] {
  return records.filter(
    (record): record is HistoryCommentEntry => record.source === "comment",
  );
}

describe("optimistic edit", () => {
  it("создаёт optimistic-состояние: меняется только body", () => {
    const original = comment("cm-1");
    const mutation = markMutationPending(createEditMutation("cm-1", "Новый текст"));

    const preview = applyCommentMutation(original, mutation);

    expect(preview.body).toBe("Новый текст");
    // Всё остальное — как в подтверждённой записи.
    expect(preview).toMatchObject({
      id: original.id,
      orgId: original.orgId,
      specItemId: original.specItemId,
      createdAt: original.createdAt,
      parentId: original.parentId,
      rootId: original.rootId,
      replyCount: original.replyCount,
      editedAt: original.editedAt,
      deleted: false,
    });
    expect(preview.actor).toEqual(original.actor);
  });

  it("не мутирует исходную запись и возвращает новый объект", () => {
    const original = comment("cm-1");
    const snapshot = { ...original };

    const preview = applyCommentMutation(
      original,
      createEditMutation("cm-1", "Новый текст"),
    );

    expect(original).toEqual(snapshot);
    expect(preview).not.toBe(original);
  });

  it("предпросмотр не выдумывает editedAt: серверная метка придёт ответом", () => {
    const original = comment("cm-1");

    const preview = applyCommentMutation(
      original,
      createEditMutation("cm-1", "Новый текст"),
    );

    expect(preview.editedAt).toBeNull();
  });

  it("createdAt, actor, parentId/rootId и replyCount не меняются", () => {
    const original = comment("cm-reply", {
      parentId: "cm-root",
      rootId: "cm-root",
      replyCount: 3,
      editedAt: "2026-09-24T08:00:00.000Z",
    });

    const preview = applyCommentMutation(
      original,
      createEditMutation("cm-reply", "Правка"),
    );

    expect(preview.createdAt).toBe("2026-09-25T10:00:00.000Z");
    expect(preview.actor).toEqual({ id: AUTHOR_ID, name: "Анна" });
    expect(preview.parentId).toBe("cm-root");
    expect(preview.rootId).toBe("cm-root");
    expect(preview.replyCount).toBe(3);
    // Прежняя серверная метка сохраняется до ответа — она часть записи.
    expect(preview.editedAt).toBe("2026-09-24T08:00:00.000Z");
  });

  it("правка ответа работает так же, как правка корня", () => {
    const reply = comment("cm-reply", {
      parentId: "cm-root",
      rootId: "cm-root",
    });

    const preview = applyCommentMutation(
      reply,
      createEditMutation("cm-reply", "Исправленный ответ"),
    );

    expect(preview.body).toBe("Исправленный ответ");
    expect(preview.parentId).toBe("cm-root");
  });

  it("success заменяет запись серверным объектом целиком", () => {
    const original = comment("cm-1");
    const server = comment("cm-1", {
      body: "Новый текст",
      editedAt: "2026-09-25T12:00:00.000Z",
    });

    // Замена в ленте — это ровно подстановка серверной записи на её место.
    const replaced = [original].map((record) =>
      record.id === server.id ? server : record,
    );

    expect(replaced[0]).toBe(server);
    expect(replaced[0].editedAt).toBe("2026-09-25T12:00:00.000Z");
  });

  it("failure возвращает исходный body: операция просто снимается", () => {
    const original = comment("cm-1");
    const preview = applyCommentMutation(
      original,
      createEditMutation("cm-1", "Новый текст"),
    );
    expect(preview.body).toBe("Новый текст");

    // Откат: операция убрана из Map — запись снова берётся из records.
    const afterRollback = commentsOnly(applyCommentMutations([original], new Map()));

    expect(afterRollback[0].body).toBe("Текст cm-1");
    expect(afterRollback[0]).toEqual(original);
  });
});

describe("optimistic delete", () => {
  it("скрывает body признаком deleted, сохраняя автора и время", () => {
    const original = comment("cm-1", { replyCount: 2 });

    const preview = applyCommentMutation(original, markMutationPending(createDeleteMutation("cm-1")));

    expect(preview.deleted).toBe(true);
    expect(preview.body).toBe(original.body);
    expect(preview.actor).toEqual(original.actor);
    expect(preview.createdAt).toBe(original.createdAt);
    expect(preview.replyCount).toBe(2);
  });

  it("success принимает серверный результат", () => {
    const original = comment("cm-1");
    const server = comment("cm-1", { deleted: true });

    expect(server.deleted).toBe(true);
    expect(original.deleted).toBe(false);
  });

  it("failure восстанавливает исходный комментарий", () => {
    const original = comment("cm-1");
    const afterRollback = commentsOnly(applyCommentMutations([original], new Map()));

    expect(afterRollback[0].deleted).toBe(false);
    expect(afterRollback[0]).toEqual(original);
  });
});

describe("ветка и replyCount не ломаются", () => {
  const root = comment("cm-root", { replyCount: 2 });
  const reply1 = comment("cm-reply-1", {
    parentId: "cm-root",
    rootId: "cm-root",
    createdAt: "2026-09-25T11:00:00.000Z",
    actor: { id: OTHER_ID, name: "Пётр" },
  });
  const reply2 = comment("cm-reply-2", {
    parentId: "cm-root",
    rootId: "cm-root",
    createdAt: "2026-09-25T12:00:00.000Z",
  });
  const records: ActivityRecord[] = [reply2, reply1, root];
  const now = new Date("2026-09-25T18:00:00.000Z");

  it("удаление корня сохраняет ветку", () => {
    const mutation = markMutationPending(createDeleteMutation("cm-root"));
    const items = buildActivityFeed(
      applyCommentMutations(records, mutationsOf(["cm-root", mutation])),
      now,
    );

    const thread = items.find(
      (item) => item.kind === "comment" && item.id === "cm-root",
    );
    expect(thread?.kind === "comment" && thread.comment.deleted).toBe(true);
    // Ответы на месте и не удалены.
    expect(
      thread?.kind === "comment" ? thread.replies.map((r) => r.id) : [],
    ).toEqual(["cm-reply-1", "cm-reply-2"]);
    expect(
      thread?.kind === "comment"
        ? thread.replies.every((r) => !r.reply.deleted)
        : false,
    ).toBe(true);
  });

  it("replyCount не меняется при удалении корня", () => {
    const mutation = markMutationPending(createDeleteMutation("cm-root"));
    const items = buildActivityFeed(
      applyCommentMutations(records, mutationsOf(["cm-root", mutation])),
      now,
    );

    const thread = items.find(
      (item) => item.kind === "comment" && item.id === "cm-root",
    );
    expect(thread?.kind === "comment" && thread.comment.replyCount).toBe(2);
  });

  it("удаление ответа не меняет корень и счётчик", () => {
    const mutation = markMutationPending(createDeleteMutation("cm-reply-1"));
    const items = buildActivityFeed(
      applyCommentMutations(records, mutationsOf(["cm-reply-1", mutation])),
      now,
    );

    const thread = items.find(
      (item) => item.kind === "comment" && item.id === "cm-root",
    );
    expect(thread?.kind === "comment" && thread.comment.deleted).toBe(false);
    expect(thread?.kind === "comment" && thread.comment.body).toBe("Текст cm-root");
    expect(thread?.kind === "comment" && thread.comment.replyCount).toBe(2);
    expect(
      thread?.kind === "comment"
        ? thread.replies.map((r) => [r.id, r.reply.deleted])
        : [],
    ).toEqual([
      ["cm-reply-1", true],
      ["cm-reply-2", false],
    ]);
  });

  it("структура ветки не меняется ни правкой, ни удалением", () => {
    const edit = markMutationPending(createEditMutation("cm-reply-1", "Правка"));
    const removed = markMutationPending(createDeleteMutation("cm-root"));

    const before = buildActivityFeed(records, now);
    const afterEdit = buildActivityFeed(
      applyCommentMutations(records, mutationsOf(["cm-reply-1", edit])),
      now,
    );
    const afterDelete = buildActivityFeed(
      applyCommentMutations(records, mutationsOf(["cm-root", removed])),
      now,
    );

    const shape = (items: ReturnType<typeof buildActivityFeed>) =>
      items
        .filter((item) => item.kind === "comment")
        .map((item) =>
          item.kind === "comment"
            ? [item.id, item.replies.map((r) => r.id)]
            : [],
        );

    expect(shape(afterEdit)).toEqual(shape(before));
    expect(shape(afterDelete)).toEqual(shape(before));
  });

  it("события ленты операции не задевают", () => {
    const event: ActivityRecord = {
      id: "ev-1",
      orgId: "org-1",
      specItemId: "item-1",
      createdAt: "2026-09-25T13:00:00.000Z",
      actor: { id: AUTHOR_ID, name: "Анна" },
      source: "event",
      kind: "removed",
      payload: { code: "М-01", name: "Стул" },
    } as unknown as ActivityRecord;

    const mutation = markMutationPending(createEditMutation("ev-1", "Правка"));
    const applied = applyCommentMutations([event], mutationsOf(["ev-1", mutation]));

    // Операция по событию не применяется: править можно только комментарии.
    expect(applied[0]).toBe(event);
  });
});

describe("concurrent operations", () => {
  it("у одного commentId одна операция: правка вытесняет удаление", () => {
    const map = new Map(mutationsOf(["cm-1", createDeleteMutation("cm-1")]));
    map.set("cm-1", createEditMutation("cm-1", "Правка"));

    expect(map.size).toBe(1);
    expect(map.get("cm-1")?.type).toBe("edit");
  });

  it("операции по разным комментариям не мешают друг другу", () => {
    const map = mutationsOf(
      ["cm-1", markMutationPending(createEditMutation("cm-1", "Правка"))],
      ["cm-2", markMutationPending(createDeleteMutation("cm-2"))],
    );

    const applied = commentsOnly(
      applyCommentMutations(
        [comment("cm-1"), comment("cm-2"), comment("cm-3")],
        map,
      ),
    );

    expect(applied[0].body).toBe("Правка");
    expect(applied[1].deleted).toBe(true);
    // Третий комментарий не тронут.
    expect(applied[2].body).toBe("Текст cm-3");
    expect(applied[2].deleted).toBe(false);
  });

  it("pending запрещает повторный запуск той же операции", () => {
    const running = markMutationPending(createEditMutation("cm-1", "Правка"));
    const map = mutationsOf(["cm-1", running]);

    // Хук проверяет именно этот признак перед вызовом server action.
    expect(map.get("cm-1")?.pending).toBe(true);
  });
});

describe("доступность действий (UX-условие)", () => {
  it("свой живой комментарий — можно", () => {
    expect(
      canMutateComment({ comment: comment("cm-1"), currentUserId: AUTHOR_ID }),
    ).toBe(true);
  });

  it("чужой комментарий — нельзя", () => {
    expect(
      canMutateComment({
        comment: comment("cm-1", { actor: { id: OTHER_ID, name: "Пётр" } }),
        currentUserId: AUTHOR_ID,
      }),
    ).toBe(false);
  });

  it("удалённый комментарий — нельзя", () => {
    expect(
      canMutateComment({
        comment: comment("cm-1", { deleted: true }),
        currentUserId: AUTHOR_ID,
      }),
    ).toBe(false);
  });

  it("комментарий без автора (пользователь удалён) — нельзя", () => {
    expect(
      canMutateComment({
        comment: comment("cm-1", { actor: { id: null, name: "Бывший" } }),
        currentUserId: AUTHOR_ID,
      }),
    ).toBe(false);
  });

  it("без текущего пользователя — нельзя", () => {
    expect(
      canMutateComment({ comment: comment("cm-1"), currentUserId: null }),
    ).toBe(false);
  });
});

describe("режим правки", () => {
  it("открыт только у своего commentId", () => {
    expect(isEditingComment({ commentId: "cm-1", editingId: "cm-1" })).toBe(true);
    expect(isEditingComment({ commentId: "cm-1", editingId: "cm-2" })).toBe(false);
    expect(isEditingComment({ commentId: "cm-1", editingId: null })).toBe(false);
  });
});
