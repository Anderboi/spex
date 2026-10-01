import { describe, expect, it, vi } from "vitest";

import {
  recordSpecItemComment,
  type CommentWriteDb,
  type CreateCommentInput,
} from "./comment-write";
import { mapSpecItemComment } from "./history-mappers";
import { COMMENT_LIMITS, createCommentSchema } from "../validations";
import { can, type OrgRole } from "../permissions";

/**
 * Тесты ядра создания комментария.
 *
 * Проверяются ровно те правила, которые нельзя доверить клиенту: границы
 * текста, выбор корня ветки, принадлежность родителя позиции и организации,
 * снимок автора и форма успешного ответа. Доступ организации проверяет
 * server action — там сессия; здесь проверяется тот же предикат `can`, по
 * которому эта проверка идёт (границу «member и выше»).
 *
 * Запросы идут на подставной клиент, который повторяет нужную часть цепочки
 * PostgREST: `select/eq/is/insert/select/single`. Это позволяет проверять
 * реальный код вставки, а не его пересказ.
 */

type Row = Record<string, unknown>;

type Call = {
  kind: "select" | "insert";
  table: string;
  select: string | null;
  eqs: [string, unknown][];
  isNull: string[];
  insert: Row | null;
};

function fakeDb(rows: Row[] = [], fail: { select?: boolean; insert?: boolean } = {}) {
  const tables: Record<string, Row[]> = { spec_item_comments: rows.slice() };
  const calls: Call[] = [];

  function from(table: string) {
    const call: Call = {
      kind: "select",
      table,
      select: null,
      eqs: [],
      isNull: [],
      insert: null,
    };

    const matched = () =>
      (tables[table] ?? []).filter(
        (row) =>
          call.eqs.every(([column, value]) => row[column] === value) &&
          call.isNull.every(
            (column) => row[column] === null || row[column] === undefined,
          ),
      );

    const builder = {
      select(columns?: string) {
        call.select = columns ?? "*";
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
      insert(row: Row) {
        // `id` в реальной БД выдаёт `gen_random_uuid()`: подставной клиент
        // делает то же самое, иначе строку нельзя вернуть как записанную.
        const stored = { id: `cm-${tables[table]?.length ?? 0}-${calls.length}`, ...row };
        calls.push({ ...call, kind: "insert", insert: stored });
        tables[table] = [...(tables[table] ?? []), stored];
        return builder;
      },
      maybeSingle() {
        calls.push(call);
        if (fail.select) {
          return Promise.resolve({ data: null, error: { message: "ошибка БД" } });
        }
        return Promise.resolve({ data: matched()[0] ?? null, error: null });
      },
      single() {
        // Для INSERT вызывается после insert(): возвращаем записанную строку.
        // PostgREST, в отличие от вставки, отдаёт ВСЕ выбранные колонки, в том
        // числе `null`-овые, поэтому подставной клиент их достраивает — иначе
        // тест проверял бы не тот ответ, который придёт из БД.
        if (!fail.insert) {
          const [stored] = matched();
          return Promise.resolve({
            data: stored
              ? { edited_at: null, deleted_at: null, ...stored }
              : null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: { message: "ошибка БД" } });
      },
    };

    return builder;
  }

  return {
    db: { from } as unknown as CommentWriteDb,
    calls,
    tables,
    /** Все вставки: снимок аргументов, который дальше уже не изменится. */
    inserts: () => calls.filter((c) => c.kind === "insert"),
    selects: () => calls.filter((c) => c.kind === "select"),
  };
}

const ORG = "org-1";
const ITEM = "item-1";
const AUTHOR = { id: "user-1", name: "Анна", email: "anna@studio.ru" };

/** Существующий комментарий в БД (родитель для ответов). */
function commentRow(id: string, over: Row = {}): Row {
  return {
    id,
    org_id: ORG,
    spec_item_id: ITEM,
    parent_id: null,
    root_id: null,
    author_id: "user-9",
    author_name_snapshot: "Пётр",
    body: "Родительский комментарий",
    created_at: "2026-09-25T10:00:00.000000+00:00",
    edited_at: null,
    deleted_at: null,
    ...over,
  };
}

function input(over: Partial<CreateCommentInput> = {}): CreateCommentInput {
  return { orgId: ORG, specItemId: ITEM, author: AUTHOR, body: "Привет", ...over };
}

describe("recordSpecItemComment: корневой комментарий и ответ", () => {
  it("создаёт корневой комментарий без родителя и корня", async () => {
    const { db, inserts } = fakeDb();

    const result = await recordSpecItemComment(db, input());

    expect(result.ok).toBe(true);
    const [insert] = inserts();
    expect(insert.insert).toMatchObject({
      org_id: ORG,
      spec_item_id: ITEM,
      parent_id: null,
      root_id: null,
      body: "Привет",
    });
  });

  it("ответ на корень: parent_id и root_id — сам корень", async () => {
    const { db, inserts } = fakeDb([commentRow("cm-root")]);

    const result = await recordSpecItemComment(
      db,
      input({ parentId: "cm-root", body: "Ответ" }),
    );

    expect(result.ok).toBe(true);
    expect(inserts()[0].insert).toMatchObject({
      parent_id: "cm-root",
      root_id: "cm-root",
    });
  });

  it("ответ на ответ остаётся в той же ветке: parent_id — корень", async () => {
    const { db, inserts } = fakeDb([
      commentRow("cm-root"),
      commentRow("cm-reply", { parent_id: "cm-root", root_id: "cm-root" }),
    ]);

    const result = await recordSpecItemComment(
      db,
      input({ parentId: "cm-reply", body: "Ответ на ответ" }),
    );

    expect(result.ok).toBe(true);
    // Третьего уровня не появляется: ветка плоская, корень тот же.
    expect(inserts()[0].insert).toMatchObject({
      parent_id: "cm-root",
      root_id: "cm-root",
    });
  });

  it("историческая строка без root_id: корнем становится непосредственный родитель", async () => {
    const { db, inserts } = fakeDb([
      commentRow("cm-reply", { parent_id: "cm-root", root_id: null }),
    ]);

    const result = await recordSpecItemComment(
      db,
      input({ parentId: "cm-reply", body: "Ответ" }),
    );

    expect(result.ok).toBe(true);
    expect(inserts()[0].insert).toMatchObject({
      parent_id: "cm-root",
      root_id: "cm-root",
    });
  });
});

describe("recordSpecItemComment: текст", () => {
  it("пустой текст отклоняется", async () => {
    const { db, inserts } = fakeDb();

    const result = await recordSpecItemComment(db, input({ body: "" }));

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Комментарий не может быть пустым",
      },
    });
    expect(inserts()).toHaveLength(0);
  });

  it("текст из одних пробелов — тоже пустой", async () => {
    const { db, inserts } = fakeDb();

    const result = await recordSpecItemComment(db, input({ body: "   \n\t  " }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("INVALID_INPUT");
    expect(inserts()).toHaveLength(0);
  });

  it("границы текста обрезаются, внутренний текст не переписывается", async () => {
    const { db, inserts } = fakeDb();

    const result = await recordSpecItemComment(
      db,
      input({ body: "  Первая строка\nВторая   строка  " }),
    );

    expect(result.ok).toBe(true);
    // `trim` по краям, перевод строки и внутренние пробелы — как ввёл автор.
    expect(inserts()[0].insert?.body).toBe("Первая строка\nВторая   строка");
  });

  it("слишком длинный текст отклоняется до вставки", async () => {
    const { db, inserts } = fakeDb();

    const result = await recordSpecItemComment(
      db,
      input({ body: "я".repeat(COMMENT_LIMITS.bodyMax + 1) }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Комментарий слишком длинный",
      },
    });
    expect(inserts()).toHaveLength(0);
  });

  it("текст на границе длины принимается", async () => {
    const { db } = fakeDb();

    const result = await recordSpecItemComment(
      db,
      input({ body: "я".repeat(COMMENT_LIMITS.bodyMax) }),
    );

    expect(result.ok).toBe(true);
  });

  it("схема валидации проверяет ровно то же, что и ядро", () => {
    expect(createCommentSchema.safeParse({ body: " текст " }).data).toEqual({
      body: "текст",
    });
    expect(createCommentSchema.safeParse({ body: " " }).success).toBe(false);
  });
});

describe("recordSpecItemComment: родитель", () => {
  it("родитель из другой позиции не принимается", async () => {
    // Родитель существует, но принадлежит другой позиции: фильтр запроса
    // (org + spec_item) его не найдёт.
    const { db, inserts } = fakeDb([commentRow("cm-other", { spec_item_id: "item-2" })]);

    const result = await recordSpecItemComment(
      db,
      input({ parentId: "cm-other" }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_PARENT",
        message: "Комментарий, на который вы отвечаете, недоступен",
      },
    });
    expect(inserts()).toHaveLength(0);
  });

  it("родитель из другой организации не принимается", async () => {
    const { db, inserts } = fakeDb([commentRow("cm-other", { org_id: "org-2" })]);

    const result = await recordSpecItemComment(
      db,
      input({ parentId: "cm-other" }),
    );

    expect(result.ok).toBe(false);
    expect(inserts()).toHaveLength(0);
  });

  it("мягко удалённый родитель не принимается", async () => {
    const { db, inserts } = fakeDb([
      commentRow("cm-deleted", { deleted_at: "2026-09-25T11:00:00.000000+00:00" }),
    ]);

    const result = await recordSpecItemComment(
      db,
      input({ parentId: "cm-deleted" }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("INVALID_PARENT");
    expect(inserts()).toHaveLength(0);
  });

  it("несуществующий родитель не принимается", async () => {
    const { db, inserts } = fakeDb();

    const result = await recordSpecItemComment(db, input({ parentId: "нет-такого" }));

    expect(result.ok).toBe(false);
    expect(inserts()).toHaveLength(0);
  });

  it("ошибка чтения родителя не раскрывает внутренний текст", async () => {
    const { db } = fakeDb([], { select: true });

    const result = await recordSpecItemComment(db, input({ parentId: "cm-root" }));

    expect(result).toEqual({
      ok: false,
      error: { code: "INVALID_PARENT", message: "Не удалось создать комментарий" },
    });
  });

  it("родитель ищется в рамках организации и позиции", async () => {
    const { db, selects } = fakeDb([commentRow("cm-root")]);

    await recordSpecItemComment(db, input({ parentId: "cm-root" }));

    const [parentQuery] = selects();
    expect(parentQuery.table).toBe("spec_item_comments");
    expect(parentQuery.eqs).toEqual([
      ["id", "cm-root"],
      ["org_id", ORG],
      ["spec_item_id", ITEM],
    ]);
  });
});

describe("recordSpecItemComment: серверные поля и снимок автора", () => {
  it("организация, автор и время берутся из аргументов, а не из текста", async () => {
    const { db, inserts } = fakeDb();

    await recordSpecItemComment(db, input());

    const row = inserts()[0].insert!;
    expect(row.org_id).toBe(ORG);
    expect(row.author_id).toBe(AUTHOR.id);
    expect(row.author_name_snapshot).toBe("Анна");
    // Время ставит сервер, и строки `deleted_at`/`edited_at` не выставляются.
    expect(typeof row.created_at).toBe("string");
    expect(Number.isFinite(Date.parse(String(row.created_at)))).toBe(true);
    expect(row.edited_at).toBeUndefined();
    expect(row.deleted_at).toBeUndefined();
  });

  it("пользователь без имени подписывается почтой", async () => {
    const { db, inserts } = fakeDb();

    await recordSpecItemComment(
      db,
      input({ author: { id: "user-2", name: null, email: "mail@studio.ru" } }),
    );

    expect(inserts()[0].insert?.author_name_snapshot).toBe("mail@studio.ru");
  });

  it("автор без имени и почты не остаётся безымянным", async () => {
    const { db, inserts } = fakeDb();

    await recordSpecItemComment(
      db,
      input({ author: { id: "user-3", name: null, email: null } }),
    );

    expect(inserts()[0].insert?.author_name_snapshot).toBe("Пользователь");
  });

  it("снимок автора считается тем же правилом, что у событий истории", async () => {
    const { actorNameSnapshot } = await import("./history");
    const { db, inserts } = fakeDb();

    await recordSpecItemComment(db, input());

    expect(inserts()[0].insert?.author_name_snapshot).toBe(
      actorNameSnapshot(AUTHOR),
    );
  });
});

describe("recordSpecItemComment: результат", () => {
  it("успешный результат — доменный HistoryCommentEntry", async () => {
    const { db } = fakeDb();

    const result = await recordSpecItemComment(db, input({ body: "Привет" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.comment.source).toBe("comment");
    expect(result.comment.orgId).toBe(ORG);
    expect(result.comment.specItemId).toBe(ITEM);
    expect(result.comment.parentId).toBeNull();
    expect(result.comment.rootId).toBeNull();
    expect(result.comment.body).toBe("Привет");
    expect(result.comment.actor).toEqual({ id: AUTHOR.id, name: "Анна" });
    expect(result.comment.deleted).toBe(false);
    expect(result.comment.editedAt).toBeNull();
    // Ответов у нового комментария ещё нет — считает их read-layer.
    expect(result.comment.replyCount).toBe(0);
  });

  it("результат совпадает с тем, что построил бы read-layer из той же строки", async () => {
    const { db, inserts } = fakeDb();

    const result = await recordSpecItemComment(db, input({ body: "Привет" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = inserts()[0].insert!;
    // `mapSpecItemComment` — источник истины для чтения: строка в БД и
    // результат mutation обязаны давать один и тот же домен.
    const fromReadLayer = mapSpecItemComment(
      {
        id: String(row.id ?? "generated"),
        org_id: String(row.org_id),
        spec_item_id: String(row.spec_item_id),
        parent_id: (row.parent_id as string | null) ?? null,
        root_id: (row.root_id as string | null) ?? null,
        author_id: (row.author_id as string | null) ?? null,
        author_name_snapshot: (row.author_name_snapshot as string | null) ?? null,
        body: String(row.body),
        created_at: String(row.created_at),
        edited_at: null,
        deleted_at: null,
      },
      0,
    );

    // `id` присваивает БД (в подставном клиенте — его эмуляция), поэтому
    // сравнение идёт по остальным полям: они и определяют совпадение контракта.
    expect({ ...result.comment, id: fromReadLayer.id }).toEqual(fromReadLayer);
  });

  it("ошибка вставки не раскрывает внутренний текст и не бросает", async () => {
    const { db } = fakeDb([], { insert: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await recordSpecItemComment(db, input());

    expect(result).toEqual({
      ok: false,
      error: { code: "FAILED", message: "Не удалось создать комментарий" },
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("ядро не мутирует переданный вход", async () => {
    const { db } = fakeDb();
    const args = input({ body: "  Привет  ", parentId: null });
    const snapshot = JSON.parse(JSON.stringify(args));

    await recordSpecItemComment(db, args);

    expect(args).toEqual(snapshot);
  });
});

describe("comments: граница доступа", () => {
  /**
   * Тот же предикат, по которому server action решает, можно ли писать, и та же
   * граница, что у RLS-политики `spec_item_comments_insert_member`
   * (`m.role <> 'viewer'`). Своей проверки организации здесь нет и быть не
   * должно — её делает действие через `requireOrgBySlug`.
   */
  it("наблюдателю писать нельзя, участнику и выше — можно", () => {
    const allowed: Record<OrgRole, boolean> = {
      viewer: false,
      member: true,
      admin: true,
      owner: true,
    };

    for (const [role, expected] of Object.entries(allowed)) {
      expect(can(role as OrgRole, "record:create"), role).toBe(expected);
    }
  });
});
