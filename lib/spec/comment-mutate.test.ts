import { describe, expect, it } from "vitest";

import {
  canEditComment,
  deleteSpecItemComment,
  editSpecItemComment,
  type CommentMutateDb,
} from "./comment-mutate";
import { mapSpecItemComment } from "./history-mappers";
import { COMMENT_LIMITS } from "../validations";

/**
 * Тесты правки и мягкого удаления комментария.
 *
 * Подставной клиент умеет ровно то, что нужно операциям: `select().eq()...`
 * и `update().eq()...select().maybeSingle()`. `update` применяется к строкам
 * таблицы, поэтому проверяется ФАКТИЧЕСКАЯ строка после операции, а не её
 * пересказ: «строка физически не удалена», «`created_at` не изменился»,
 * «ответы остались» — это утверждения о содержимом таблицы.
 */

type Row = Record<string, unknown>;

type Call = {
  kind: "select" | "update" | "count";
  eqs: [string, unknown][];
  isNull: string[];
  /** Что записал бы UPDATE (только для `kind: "update"`). */
  patch?: Row;
};

type FakeOptions = {
  /** Смоделировать ошибку ответа для конкретного вида запроса. */
  failWhen?: (call: Call) => boolean;
};

function fakeDb(rows: Row[] = [], options: FakeOptions = {}) {
  const table = rows.map((row) => ({ ...row }));
  const calls: Call[] = [];

  function from() {
    const call: Call = { kind: "select", eqs: [], isNull: [] };
    let isCount = false;
    let patch: Row | null = null;

    const matched = () =>
      table.filter(
        (row) =>
          call.eqs.every(([column, value]) => row[column] === value) &&
          call.isNull.every(
            (column) => row[column] === null || row[column] === undefined,
          ),
      );

    const builder = {
      select(columns?: string) {
        // Счётчик ответов выбирает только `id` — отличаем его от чтения строки.
        isCount = columns === "id";
        return builder;
      },
      update(next: Row) {
        call.kind = "update";
        call.patch = next;
        patch = next;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.eqs.push([column, value]);
        return builder;
      },
      is(column: string, value: unknown) {
        if (value === null) call.isNull.push(column);
        return builder;
      },
      maybeSingle() {
        calls.push(isCount ? { ...call, kind: "count" } : call);

        if (options.failWhen?.(call)) {
          return Promise.resolve({ data: null, error: { message: "ошибка БД" } });
        }
        if (isCount) return Promise.resolve({ data: null, error: null });

        if (call.kind === "update") {
          const rows2 = matched();
          // UPDATE без подходящей строки: у вызывающего это «ничего не
          // затронуто» — так же ведёт себя PostgREST.
          if (rows2.length === 0) return Promise.resolve({ data: null, error: null });
          for (const row of rows2) Object.assign(row, patch);
          return Promise.resolve({ data: { ...rows2[0] }, error: null });
        }

        const rows2 = matched();
        return Promise.resolve({
          data: rows2[0] ? { ...rows2[0] } : null,
          error: null,
        });
      },
      /**
       * Счётчик ответов ждут как thenable (`await db.select("id")...`), а не
       * через `maybeSingle`. Список строк — тот же ответ PostgREST.
       */
      then(
        resolve: (value: { data: Row[] | null; error: { message: string } | null }) => void,
      ) {
        calls.push({ ...call, kind: "count" });
        if (options.failWhen?.(call)) {
          resolve({ data: null, error: { message: "ошибка БД" } });
          return;
        }
        resolve({ data: matched().map((row) => ({ ...row })), error: null });
      },
    };

    return builder;
  }

  return {
    db: { from } as unknown as CommentMutateDb,
    table,
    calls,
    row: (id: string) => table.find((row) => row.id === id),
    updates: () => calls.filter((call) => call.kind === "update"),
  };
}

const ORG = "org-1";
const ITEM = "item-1";
const AUTHOR = { id: "user-1" };

function commentRow(id: string, over: Row = {}): Row {
  return {
    id,
    org_id: ORG,
    spec_item_id: ITEM,
    parent_id: null,
    root_id: null,
    author_id: AUTHOR.id,
    author_name_snapshot: "Анна",
    body: `Текст ${id}`,
    created_at: "2026-09-25T10:00:00.000000+00:00",
    edited_at: null,
    deleted_at: null,
    ...over,
  };
}

const target = { orgId: ORG, specItemId: ITEM, commentId: "cm-1", actor: AUTHOR };

describe("editSpecItemComment: успех", () => {
  it("редактирует корневой комментарий", async () => {
    const { db, row } = fakeDb([commentRow("cm-1")]);

    const result = await editSpecItemComment(db, { ...target, body: "Новый текст" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comment.body).toBe("Новый текст");
    expect(row("cm-1")?.body).toBe("Новый текст");
  });

  it("редактирует ответ, не трогая ветку", async () => {
    const { db, row } = fakeDb([
      commentRow("cm-root"),
      commentRow("cm-reply", { parent_id: "cm-root", root_id: "cm-root" }),
    ]);

    const result = await editSpecItemComment(db, {
      ...target,
      commentId: "cm-reply",
      body: "Исправленный ответ",
    });

    expect(result.ok).toBe(true);
    expect(row("cm-reply")).toMatchObject({
      body: "Исправленный ответ",
      parent_id: "cm-root",
      root_id: "cm-root",
    });
  });

  it("границы текста обрезаются, внутренний текст не переписывается", async () => {
    const { db, row } = fakeDb([commentRow("cm-1")]);

    await editSpecItemComment(db, {
      ...target,
      body: "  Первая\nВторая   строка  ",
    });

    expect(row("cm-1")?.body).toBe("Первая\nВторая   строка");
  });

  it("editedAt ставит сервер, и он же возвращается клиенту", async () => {
    const { db, row } = fakeDb([commentRow("cm-1")]);

    const result = await editSpecItemComment(db, { ...target, body: "Текст" });

    expect(result.ok).toBe(true);
    const stored = row("cm-1")?.edited_at;
    expect(typeof stored).toBe("string");
    expect(Number.isFinite(Date.parse(String(stored)))).toBe(true);
    expect(result.ok && result.comment.editedAt).toBe(stored);
  });

  it("меняет только body и edited_at", async () => {
    const { db, updates, row } = fakeDb([
      commentRow("cm-1", { parent_id: "cm-root", root_id: "cm-root" }),
    ]);
    const before = { ...row("cm-1") };

    await editSpecItemComment(db, { ...target, body: "Правка" });

    // В UPDATE попадают ровно два поля — остальное изменить нечем.
    expect(Object.keys(updates()[0].patch ?? {}).sort()).toEqual([
      "body",
      "edited_at",
    ]);
    expect(row("cm-1")).toMatchObject({
      id: before.id,
      created_at: before.created_at,
      author_id: before.author_id,
      author_name_snapshot: before.author_name_snapshot,
      parent_id: before.parent_id,
      root_id: before.root_id,
      deleted_at: before.deleted_at,
    });
  });

  it("client-supplied editedAt не проходит: в типе входа его нет", async () => {
    const { db, updates } = fakeDb([commentRow("cm-1")]);

    // Единственный способ передать лишнее — расширить объект; ядро читает из
    // него только `body`, поэтому подсунутое значение игнорируется.
    await editSpecItemComment(db, {
      ...target,
      body: "Текст",
      ...({ editedAt: "2000-01-01T00:00:00.000Z" } as object),
    });

    expect(updates()[0].patch?.edited_at).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("actor и снимок имени не меняются", async () => {
    const { db, row } = fakeDb([
      commentRow("cm-1", { author_name_snapshot: "Пётр" }),
    ]);

    const result = await editSpecItemComment(db, { ...target, body: "Текст" });

    expect(result.ok && result.comment.actor).toEqual({
      id: AUTHOR.id,
      name: "Пётр",
    });
    expect(row("cm-1")?.author_name_snapshot).toBe("Пётр");
  });
});

describe("editSpecItemComment: валидация текста", () => {
  it("пустой текст не принимается", async () => {
    const { db, updates } = fakeDb([commentRow("cm-1")]);

    const result = await editSpecItemComment(db, { ...target, body: "" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Комментарий не может быть пустым",
      },
    });
    expect(updates()).toHaveLength(0);
  });

  it("текст из одних пробелов не принимается", async () => {
    const { db, updates } = fakeDb([commentRow("cm-1")]);

    const result = await editSpecItemComment(db, { ...target, body: "  \n\t " });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("INVALID_INPUT");
    expect(updates()).toHaveLength(0);
  });

  it("слишком длинный текст не принимается, граница принимается", async () => {
    const tooLong = fakeDb([commentRow("cm-1")]);
    const atLimit = fakeDb([commentRow("cm-1")]);

    const rejected = await editSpecItemComment(tooLong.db, {
      ...target,
      body: "я".repeat(COMMENT_LIMITS.bodyMax + 1),
    });
    const accepted = await editSpecItemComment(atLimit.db, {
      ...target,
      body: "я".repeat(COMMENT_LIMITS.bodyMax),
    });

    expect(rejected).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", message: "Комментарий слишком длинный" },
    });
    expect(tooLong.updates()).toHaveLength(0);
    expect(accepted.ok).toBe(true);
  });
});

describe("editSpecItemComment: доступ и состояния", () => {
  it("чужой комментарий не редактируется", async () => {
    const { db, row } = fakeDb([commentRow("cm-1", { author_id: "user-2" })]);

    const result = await editSpecItemComment(db, { ...target, body: "Правка" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Можно изменять только свои комментарии",
      },
    });
    expect(row("cm-1")?.body).toBe("Текст cm-1");
  });

  it("комментарий без автора (пользователь удалён) не редактируется", async () => {
    const { db } = fakeDb([commentRow("cm-1", { author_id: null })]);

    const result = await editSpecItemComment(db, { ...target, body: "Правка" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("FORBIDDEN");
  });

  it("удалённый комментарий не редактируется", async () => {
    const { db, updates } = fakeDb([
      commentRow("cm-1", { deleted_at: "2026-09-25T11:00:00.000000+00:00" }),
    ]);

    const result = await editSpecItemComment(db, { ...target, body: "Правка" });

    expect(result).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", message: "Комментарий удалён" },
    });
    expect(updates()).toHaveLength(0);
  });

  it("комментарий другой позиции не редактируется", async () => {
    const { db, updates } = fakeDb([commentRow("cm-1", { spec_item_id: "item-2" })]);

    const result = await editSpecItemComment(db, { ...target, body: "Правка" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
    expect(updates()).toHaveLength(0);
  });

  it("комментарий другой организации не редактируется", async () => {
    const { db, updates } = fakeDb([commentRow("cm-1", { org_id: "org-2" })]);

    const result = await editSpecItemComment(db, { ...target, body: "Правка" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
    expect(updates()).toHaveLength(0);
  });

  it("несуществующий комментарий даёт NOT_FOUND, а не FORBIDDEN", async () => {
    const { db } = fakeDb([]);

    const result = await editSpecItemComment(db, { ...target, body: "Правка" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
  });

  it("ошибка записи не раскрывается клиенту", async () => {
    const { db } = fakeDb([commentRow("cm-1")], {
      failWhen: (call) => call.kind === "update",
    });

    const result = await editSpecItemComment(db, { ...target, body: "Правка" });

    expect(result).toEqual({
      ok: false,
      error: { code: "FAILED", message: "Не удалось сохранить комментарий" },
    });
  });

  it("запросы фильтруются по организации и позиции", async () => {
    const { db, updates } = fakeDb([commentRow("cm-1")]);

    await editSpecItemComment(db, { ...target, body: "Правка" });

    expect(updates()[0].eqs).toEqual([
      ["id", "cm-1"],
      ["org_id", ORG],
      ["spec_item_id", ITEM],
    ]);
    // Удалённый комментарий не должен попасть под UPDATE.
    expect(updates()[0].isNull).toEqual(["deleted_at"]);
  });
});

describe("deleteSpecItemComment: мягкое удаление", () => {
  it("проставляет deleted_at и возвращает запись с deleted = true", async () => {
    const { db, row } = fakeDb([commentRow("cm-1")]);

    const result = await deleteSpecItemComment(db, { ...target });

    expect(result.ok).toBe(true);
    expect(result.ok && result.comment.deleted).toBe(true);
    expect(typeof row("cm-1")?.deleted_at).toBe("string");
  });

  it("строка физически не удаляется", async () => {
    const { db, table } = fakeDb([commentRow("cm-1")]);

    await deleteSpecItemComment(db, { ...target });

    expect(table).toHaveLength(1);
    expect(table[0].id).toBe("cm-1");
  });

  it("меняет только deleted_at", async () => {
    const { db, updates, row } = fakeDb([commentRow("cm-1")]);
    const before = { ...row("cm-1") };

    await deleteSpecItemComment(db, { ...target });

    expect(Object.keys(updates()[0].patch ?? {})).toEqual(["deleted_at"]);
    expect(row("cm-1")).toMatchObject({
      body: before.body,
      created_at: before.created_at,
      author_id: before.author_id,
      author_name_snapshot: before.author_name_snapshot,
      edited_at: before.edited_at,
    });
  });

  it("сохраняет автора, ветку и время создания", async () => {
    const { db } = fakeDb([
      commentRow("cm-reply", {
        parent_id: "cm-root",
        root_id: "cm-root",
        author_name_snapshot: "Пётр",
      }),
    ]);

    const result = await deleteSpecItemComment(db, {
      ...target,
      commentId: "cm-reply",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comment).toMatchObject({
      id: "cm-reply",
      createdAt: "2026-09-25T10:00:00.000000+00:00",
      parentId: "cm-root",
      rootId: "cm-root",
      body: "Текст cm-reply",
      deleted: true,
    });
    expect(result.comment.actor).toEqual({ id: AUTHOR.id, name: "Пётр" });
  });

  it("удаление корня не удаляет ответы", async () => {
    const { db, table } = fakeDb([
      commentRow("cm-root"),
      commentRow("cm-r1", { parent_id: "cm-root", root_id: "cm-root" }),
      commentRow("cm-r2", { parent_id: "cm-root", root_id: "cm-root" }),
    ]);

    const result = await deleteSpecItemComment(db, { ...target, commentId: "cm-root" });

    expect(result.ok).toBe(true);
    expect(table).toHaveLength(3);
    // Ответы остались живыми: FK на parent_id cascade сработал бы только при
    // физическом удалении, а его не происходит.
    expect(table.filter((row) => row.parent_id === "cm-root")).toHaveLength(2);
    expect(
      table.filter((row) => row.parent_id === "cm-root").every((row) => row.deleted_at === null),
    ).toBe(true);
  });

  it("replyCount не уменьшается после удаления корня", async () => {
    const { db } = fakeDb([
      commentRow("cm-root"),
      commentRow("cm-r1", { parent_id: "cm-root", root_id: "cm-root" }),
      commentRow("cm-r2", { parent_id: "cm-root", root_id: "cm-root" }),
    ]);

    const result = await deleteSpecItemComment(db, { ...target, commentId: "cm-root" });

    // Тот же счётчик, что был бы у живого корня: удаление ответов не касается.
    expect(result.ok && result.comment.replyCount).toBe(2);
  });

  it("повторный delete: строка не меняется второй раз, ответ «удалён»", async () => {
    const { db, row } = fakeDb([commentRow("cm-1")]);

    const first = await deleteSpecItemComment(db, { ...target });
    const deletedAt = row("cm-1")?.deleted_at;
    const second = await deleteSpecItemComment(db, { ...target });

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", message: "Комментарий удалён" },
    });
    // Повторный вызов не перезаписал метку.
    expect(row("cm-1")?.deleted_at).toBe(deletedAt);
  });

  it("чужой комментарий не удаляется", async () => {
    const { db, row } = fakeDb([commentRow("cm-1", { author_id: "user-2" })]);

    const result = await deleteSpecItemComment(db, { ...target });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("FORBIDDEN");
    expect(row("cm-1")?.deleted_at).toBeNull();
  });

  it("комментарий другой позиции не удаляется", async () => {
    const { db, row } = fakeDb([commentRow("cm-1", { spec_item_id: "item-2" })]);

    const result = await deleteSpecItemComment(db, { ...target });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
    expect(row("cm-1")?.deleted_at).toBeNull();
  });

  it("комментарий другой организации не удаляется", async () => {
    const { db, updates } = fakeDb([commentRow("cm-1", { org_id: "org-2" })]);

    const result = await deleteSpecItemComment(db, { ...target });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
    expect(updates()).toHaveLength(0);
  });

  it("ошибка записи не раскрывается клиенту", async () => {
    const { db } = fakeDb([commentRow("cm-1")], {
      failWhen: (call) => call.kind === "update",
    });

    const result = await deleteSpecItemComment(db, { ...target });

    expect(result).toEqual({
      ok: false,
      error: { code: "FAILED", message: "Не удалось удалить комментарий" },
    });
  });
});

describe("согласованность с read-layer'ом", () => {
  it("результат edit совпадает с mapSpecItemComment для сохранённой строки", async () => {
    const { db, row } = fakeDb([commentRow("cm-1")]);

    const result = await editSpecItemComment(db, { ...target, body: "Правка" });
    expect(result.ok).toBe(true);

    const stored = row("cm-1")!;
    const fromReadLayer = mapSpecItemComment(
      stored as unknown as Parameters<typeof mapSpecItemComment>[0],
      0,
    );

    expect(result.ok && result.comment).toEqual(fromReadLayer);
  });

  it("результат delete совпадает с mapSpecItemComment для сохранённой строки", async () => {
    const { db, row } = fakeDb([commentRow("cm-1")]);

    const result = await deleteSpecItemComment(db, { ...target });
    expect(result.ok).toBe(true);

    const stored = row("cm-1")!;
    const fromReadLayer = mapSpecItemComment(
      stored as unknown as Parameters<typeof mapSpecItemComment>[0],
      0,
    );

    expect(result.ok && result.comment).toEqual(fromReadLayer);
    // Чтение и мутация согласны в главном: запись удалена, текст не вычищен —
    // скрывает его отображение, а не данные.
    expect(fromReadLayer.deleted).toBe(true);
    expect(fromReadLayer.body).toBe("Текст cm-1");
  });

  it("replyCount считается по той же таблице, что читает лента", async () => {
    const { db, calls } = fakeDb([
      commentRow("cm-root"),
      commentRow("cm-r1", { parent_id: "cm-root", root_id: "cm-root" }),
    ]);

    const result = await editSpecItemComment(db, { ...target, commentId: "cm-root", body: "Правка" });

    const counts = calls.filter((call) => call.kind === "count");
    expect(counts).toHaveLength(1);
    expect(counts[0].eqs).toEqual([
      ["org_id", ORG],
      ["spec_item_id", ITEM],
      ["parent_id", "cm-root"],
    ]);
    expect(result.ok && result.comment.replyCount).toBe(1);
  });
});

describe("правило прав", () => {
  it("изменять может только автор записи", () => {
    expect(canEditComment({ actor: AUTHOR, comment: { authorId: AUTHOR.id } })).toBe(true);
    expect(canEditComment({ actor: AUTHOR, comment: { authorId: "user-2" } })).toBe(false);
    expect(canEditComment({ actor: AUTHOR, comment: { authorId: null } })).toBe(false);
  });

  it("результат правки несёт все поля домена, а не подмножество", async () => {
    const { db } = fakeDb([
      commentRow("cm-reply", {
        parent_id: "cm-root",
        root_id: "cm-root",
        author_id: AUTHOR.id,
        // Снимок имени может отличаться от текущего имени пользователя: он
        // остаётся тем, что было записано, и правка его не трогает.
        author_name_snapshot: "Пётр",
        edited_at: "2026-09-24T08:00:00.000000+00:00",
      }),
    ]);

    const result = await editSpecItemComment(db, {
      ...target,
      commentId: "cm-reply",
      body: "Правка",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Проверяются сразу обе стороны контракта: набор ключей домена и то, что
    // ни одно значение не потерялось по дороге из строки.
    expect(Object.keys(result.comment).sort()).toEqual(
      [
        "actor",
        "body",
        "createdAt",
        "deleted",
        "editedAt",
        "id",
        "orgId",
        "parentId",
        "replyCount",
        "rootId",
        "source",
        "specItemId",
      ].sort(),
    );
    expect(result.comment).toMatchObject({
      id: "cm-reply",
      orgId: ORG,
      specItemId: ITEM,
      createdAt: "2026-09-25T10:00:00.000000+00:00",
      parentId: "cm-root",
      rootId: "cm-root",
      body: "Правка",
      deleted: false,
      replyCount: 0,
    });
    expect(result.comment.actor).toEqual({ id: AUTHOR.id, name: "Пётр" });
  });
});
