import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { patchToRow } from "./mappers";
import { SPEC_STATUS_CONFIG } from "./status";
import type { SpecItemPatch } from "../types";
import {
  buildClearedEvents,
  buildCodeChangedEvents,
  buildComponentAddedEvents,
  buildComponentRemovedEvents,
  buildCreatedEvents,
  buildDetailsChangedEvents,
  buildFilledEvents,
  buildParentChangedEvents,
  buildPriceChangedEvents,
  buildQuantityChangedEvents,
  buildRemovedEvents,
  buildRestoredEvents,
  buildServiceAddedEvents,
  buildServiceCompletedEvents,
  buildServiceRemovedEvents,
  buildStatusChangedEvents,
  buildSupplierChangedEvents,
  buildVariantAddedEvents,
  buildVariantRemovedEvents,
  buildVariantSwitchedEvents,
  buildVariantUpdatedEvents,
  eventActorOf,
  recordSpecItemEvent,
  recordSpecItemEvents,
  SPEC_ITEM_DETAIL_FIELDS,
  SPEC_ITEM_EVENT_KINDS,
  SPEC_VARIANT_PATCH_FIELDS,
  type SpecItemEventInput,
  type SpecItemLifecycleRow,
} from "./history";

/**
 * Схему истории и обсуждения нельзя проверить в отрыве от БД, поэтому
 * контракт между миграцией и кодом закреплён здесь статически: тест читает
 * SQL и сверяет его с TS. Это ловит самый неприятный класс ошибок —
 * «событие пишется, а CHECK его не пропускает», который иначе всплывёт
 * только в рантайме на живых данных.
 *
 * Путь собирается через fileURLToPath, а не `new URL(..., import.meta.url)`:
 * второй вариант перехватывает vite:asset-import-meta-url и уводит чтение в
 * ресолв ассетов, где нам делать нечего.
 */
const MIGRATION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations/20260918_001_add_spec_item_events_and_comments.sql",
);

const sql = readFileSync(MIGRATION_PATH, "utf8");

/**
 * Все миграции по порядку: CHECK для `kind` мог быть переписан более поздней
 * (`20260919_001` добавила `parent_changed`), поэтому сверяемся с последним
 * определением, а не с первым.
 */
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

const allSql = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
  .join("\n");

/** Значения из последнего CHECK-ограничения `spec_item_events_kind_check`. */
function kindsFromCheck(source: string): string[] {
  const start = source.lastIndexOf("spec_item_events_kind_check");
  expect(start, "CHECK для kind не найден в миграции").toBeGreaterThan(-1);

  // До `);`, закрывающей create table: внутри этого отрезка встречаются
  // только литералы типов, поэтому посторонние строки в выборку не попадут.
  const end = source.indexOf(");", start);
  const block = source.slice(start, end);

  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Имена всех создаваемых политик. */
const policyNames = [...sql.matchAll(/create policy "([^"]+)"/g)].map(
  (m) => m[1],
);

describe("spec_item_events: kind", () => {
  it("CHECK в миграции совпадает со SPEC_ITEM_EVENT_KINDS", () => {
    // Сверяемся с последним определением ограничения по всем миграциям.
    expect(kindsFromCheck(allSql)).toEqual([...SPEC_ITEM_EVENT_KINDS]);
  });

  it("список типов не содержит дублей и записан в snake_case", () => {
    expect(new Set(SPEC_ITEM_EVENT_KINDS).size).toBe(
      SPEC_ITEM_EVENT_KINDS.length,
    );
    for (const kind of SPEC_ITEM_EVENT_KINDS) {
      expect(kind, `тип «${kind}» не в snake_case`).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

describe("RLS", () => {
  it("RLS включён на обеих таблицах", () => {
    expect(sql).toContain(
      "alter table public.spec_item_events enable row level security;",
    );
    expect(sql).toContain(
      "alter table public.spec_item_comments enable row level security;",
    );
  });

  it("журнал событий доступен только на чтение: ни одной пишущей политики", () => {
    // Append-only — это свойство схемы, а не соглашение: писать события
    // должен только service role, который RLS обходит.
    const eventPolicies = policyNames
      .filter((name) => name.startsWith("spec_item_events_"))
      .sort();
    expect(eventPolicies).toEqual(["spec_item_events_select_own_org"]);
  });

  it("у комментариев ровно четыре политики: чтение, создание, правка, удаление", () => {
    const commentPolicies = policyNames
      .filter((name) => name.startsWith("spec_item_comments_"))
      .sort();
    expect(commentPolicies).toEqual([
      "spec_item_comments_delete_author",
      "spec_item_comments_insert_member",
      "spec_item_comments_select_own_org",
      "spec_item_comments_update_author",
    ]);
  });

  it("создание комментария требует автора и блокирует наблюдателя", () => {
    const start = sql.indexOf('create policy "spec_item_comments_insert_member"');
    const block = sql.slice(start, sql.indexOf(";", start));

    // author_id = auth.uid() — нельзя подписать комментарий чужим именем;
    // role <> 'viewer' — наблюдатель прав записи не имеет (lib/permissions.ts).
    expect(block).toContain("author_id = auth.uid()");
    expect(block).toContain("m.role <> 'viewer'");
  });
});

/* ------------------------------------------------------------------ */
/*  Запись событий                                                     */
/* ------------------------------------------------------------------ */

/** Клиент БД, который ждёт helper (выводим из сигнатуры — не дублируем тип). */
type EventsDb = Parameters<typeof recordSpecItemEvent>[0];

/** Мок PostgREST-цепочки: запоминает вставки и возвращает заданную ошибку. */
function fakeDb(error: { message: string } | null = null) {
  const calls: { table: string; rows: unknown }[] = [];

  const db = {
    from(table: string) {
      return {
        insert(rows: unknown) {
          calls.push({ table, rows });
          return Promise.resolve({ error });
        },
      };
    },
  };

  return { db: db as unknown as EventsDb, calls };
}

const ACTOR = { id: "user-1", name: "Анна", email: "anna@studio.ru" };

const baseEvent: SpecItemEventInput = {
  orgId: "org-1",
  specItemId: "item-1",
  actor: ACTOR,
  kind: "price_changed",
  payload: { from: 12_000, to: 15_500 },
};

/** Событие с типом, которого нет в SPEC_ITEM_EVENT_KINDS (проверка рантайма). */
const invalidKindEvent = {
  ...baseEvent,
  kind: "invented_kind",
} as unknown as SpecItemEventInput;

describe("recordSpecItemEvent", () => {
  it("пишет событие в spec_item_events с org_id и spec_item_id", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvent(db, baseEvent);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toMatchObject({
      org_id: "org-1",
      spec_item_id: "item-1",
      kind: "price_changed",
    });
  });

  it("берёт actor_id из сессии и не ходит за профилем пользователя", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvent(db, baseEvent);

    // Ровно один запрос: если бы helper читал users, мок без такой таблицы
    // упал бы, а счётчик вызовов вырос.
    expect(calls).toHaveLength(1);
    expect((calls[0].rows as { actor_id: string }).actor_id).toBe("user-1");
  });

  it("кладёт снимок имени автора", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvent(db, baseEvent);

    expect(
      (calls[0].rows as { actor_name_snapshot: string }).actor_name_snapshot,
    ).toBe("Анна");
  });

  it("подставляет почту, если имя не задано", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvent(db, {
      ...baseEvent,
      actor: { ...ACTOR, name: null },
    });

    expect(
      (calls[0].rows as { actor_name_snapshot: string }).actor_name_snapshot,
    ).toBe("anna@studio.ru");
  });

  it("подставляет «Пользователь», если нет ни имени, ни почты", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvent(db, {
      ...baseEvent,
      actor: { id: "user-2", name: null },
    });

    expect(
      (calls[0].rows as { actor_name_snapshot: string }).actor_name_snapshot,
    ).toBe("Пользователь");
  });

  it("передаёт payload без изменений", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvent(db, baseEvent);

    expect((calls[0].rows as { payload: unknown }).payload).toEqual({
      from: 12_000,
      to: 15_500,
    });
  });

  it("превращает отсутствующий payload в пустой объект", async () => {
    const { db, calls } = fakeDb();
    const withoutPayload: SpecItemEventInput = { ...baseEvent };
    delete withoutPayload.payload;

    await recordSpecItemEvent(db, withoutPayload);

    expect((calls[0].rows as { payload: unknown }).payload).toEqual({});
  });

  it("пробрасывает ошибку INSERT наружу", async () => {
    const { db } = fakeDb({ message: "permission denied" });

    await expect(recordSpecItemEvent(db, baseEvent)).rejects.toThrow(
      /Не удалось записать событие истории: permission denied/,
    );
  });

  it("отклоняет неизвестный kind до обращения к БД", async () => {
    const { db, calls } = fakeDb();

    await expect(recordSpecItemEvent(db, invalidKindEvent)).rejects.toThrow(
      /Неизвестный тип события истории/,
    );

    expect(calls).toHaveLength(0);
  });
});

describe("recordSpecItemEvents", () => {
  it("пишет несколько событий одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(db, [
      baseEvent,
      { ...baseEvent, specItemId: "item-2", kind: "status_changed" },
    ]);

    // Один вызов — один HTTP-запрос: N отдельных INSERT недопустимы.
    expect(calls).toHaveLength(1);
    expect(Array.isArray(calls[0].rows)).toBe(true);
    expect(calls[0].rows).toHaveLength(2);
    expect(calls[0].rows).toMatchObject([
      { spec_item_id: "item-1", kind: "price_changed" },
      { spec_item_id: "item-2", kind: "status_changed" },
    ]);
  });

  it("ничего не пишет на пустом списке", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(db, []);

    // `insert([])` в PostgREST — ошибка, а не пустой результат.
    expect(calls).toHaveLength(0);
  });

  it("пробрасывает ошибку INSERT наружу", async () => {
    const { db } = fakeDb({ message: "check constraint violated" });

    await expect(recordSpecItemEvents(db, [baseEvent])).rejects.toThrow(
      /Не удалось записать событие истории/,
    );
  });

  it("отклоняет неизвестный kind до обращения к БД", async () => {
    const { db, calls } = fakeDb();

    await expect(
      recordSpecItemEvents(db, [baseEvent, invalidKindEvent]),
    ).rejects.toThrow(/Неизвестный тип события истории/);

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Payload'ы жизненного цикла                                         */
/* ------------------------------------------------------------------ */

const CREATED_BY = { id: "user-1", name: "Анна", email: "anna@studio.ru" };

const ROWS: SpecItemLifecycleRow[] = [
  { id: "item-1", code: "М-01", name: "Диван", type: "Мебель" },
  { id: "item-2", code: "М-02", name: "Кресло", type: "Мебель" },
];

describe("eventActorOf", () => {
  it("собирает автора из контекста сессии", () => {
    expect(
      eventActorOf({ userId: "u1", user: { name: "Анна", email: "a@b.ru" } }),
    ).toEqual({ id: "u1", name: "Анна", email: "a@b.ru" });
  });

  it("сохраняет отсутствие имени как null, а не пустую строку", () => {
    expect(eventActorOf({ userId: "u1", user: {} })).toEqual({
      id: "u1",
      name: null,
      email: null,
    });
  });
});

describe("buildCreatedEvents", () => {
  it("обычное создание даёт ровно одно событие", () => {
    const events = buildCreatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "placeholder",
      items: [ROWS[0]],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "created",
      payload: {
        code: "М-01",
        name: "Диван",
        type: "Мебель",
        origin: "placeholder",
      },
    });
  });

  it("одиночная операция не помечается как групповая", () => {
    const [event] = buildCreatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "placeholder",
      items: [ROWS[0]],
    });

    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("batch: по одному событию на позицию с размером операции", () => {
    const events = buildCreatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "library",
      items: ROWS,
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    for (const event of events) {
      expect(event.kind).toBe("created");
      expect(event.payload).toMatchObject({ batch: true, batch_size: 2 });
    }
  });

  it("переносит origin дубликата и ручного создания", () => {
    const originOf = (origin: "duplicate" | "manual") =>
      buildCreatedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        origin,
        items: [ROWS[0]],
      })[0].payload?.origin;

    expect(originOf("duplicate")).toBe("duplicate");
    expect(originOf("manual")).toBe("manual");
  });

  it("не дублирует событие при повторном id в списке", () => {
    const events = buildCreatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "library",
      items: [ROWS[0], ROWS[0]],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildCreatedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        origin: "library",
        items: [],
      }),
    ).toEqual([]);
  });

  it("пустые марка, название и раздел записываются как null", () => {
    // Одно и то же «не заполнено» не должно приезжать в ленту двумя способами
    // (`""` и `null`): мапперу иначе пришлось бы знать про оба.
    const [event] = buildCreatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "placeholder",
      items: [{ id: "item-9", code: null, name: "", type: "" }],
    });

    expect(event.payload).toEqual({
      code: null,
      name: null,
      type: null,
      origin: "placeholder",
    });
  });

  it("непустые значения остаются как есть", () => {
    const [event] = buildCreatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "library",
      items: [ROWS[0]],
    });

    expect(event.payload).toMatchObject({
      code: "М-01",
      name: "Диван",
      type: "Мебель",
    });
  });
});

describe("buildRemovedEvents / buildRestoredEvents", () => {
  it("удаление одной позиции: код и имя без флагов групповой операции", () => {
    const events = buildRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [ROWS[0]],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "removed",
      payload: { code: "М-01", name: "Диван" },
    });
    // Единый формат размера операции: N = 1 → полей нет.
    expect(events[0].payload).not.toHaveProperty("batch");
    expect(events[0].payload).not.toHaveProperty("batch_size");
  });

  it("одиночное восстановление тоже без флагов групповой операции", () => {
    const [event] = buildRestoredEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [ROWS[0]],
    });

    expect(event.kind).toBe("restored");
    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("групповое удаление: событие на каждую позицию", () => {
    const events = buildRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: ROWS,
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    for (const event of events) {
      expect(event.payload).toMatchObject({ batch: true, batch_size: 2 });
    }
  });

  it("групповое восстановление: batch_size равен числу событий", () => {
    const events = buildRestoredEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: ROWS,
    });

    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.kind).toBe("restored");
      expect(event.payload).toMatchObject({ batch: true, batch_size: 2 });
    }
  });

  it("batch_size считает события, а не повторы в списке", () => {
    const events = buildRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [ROWS[0], ROWS[0]],
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload).not.toHaveProperty("batch_size");
  });

  it("пустой список (ничего не удалилось) не даёт событий", () => {
    expect(
      buildRemovedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  filled                                                             */
/* ------------------------------------------------------------------ */

const FILLED_ROW: SpecItemLifecycleRow = {
  id: "item-1",
  code: "М-01",
  name: "Диван",
};

describe("buildFilledEvents", () => {
  it("заполнение из библиотеки даёт одно событие с origin", () => {
    const events = buildFilledEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "placeholder",
      items: [FILLED_ROW],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "filled",
      payload: { code: "М-01", name: "Диван", origin: "placeholder" },
    });
  });

  it("ручное заполнение отличается только origin", () => {
    const [event] = buildFilledEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "manual",
      items: [FILLED_ROW],
    });

    expect(event.payload).toEqual({
      code: "М-01",
      name: "Диван",
      origin: "manual",
    });
  });

  it("сколько бы полей ни заполнилось, событие одно", () => {
    // Билдер получает результат целиком, а не список полей: составной жест —
    // это одно событие по определению.
    const events = buildFilledEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "placeholder",
      items: [FILLED_ROW],
    });

    expect(events).toHaveLength(1);
    expect(Object.keys(events[0].payload ?? {})).toEqual([
      "code",
      "name",
      "origin",
    ]);
  });

  it("одиночное заполнение не помечается как групповое", () => {
    const [event] = buildFilledEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "placeholder",
      items: [FILLED_ROW],
    });

    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("batch: по одному событию на каждую заполненную позицию", () => {
    const events = buildFilledEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "manual",
      items: [FILLED_ROW, { id: "item-2", code: "М-02", name: "Кресло" }],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    for (const event of events) {
      expect(event.payload).toMatchObject({ batch: true, batch_size: 2 });
    }
  });

  it("не дублирует событие при повторном id в списке", () => {
    const events = buildFilledEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "placeholder",
      items: [FILLED_ROW, FILLED_ROW],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildFilledEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        origin: "placeholder",
        items: [],
      }),
    ).toEqual([]);
  });

  it("пустые марка и название записываются как null", () => {
    const [event] = buildFilledEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "manual",
      items: [{ id: "item-9", code: null, name: "" }],
    });

    expect(event.payload).toEqual({
      code: null,
      name: null,
      origin: "manual",
    });
  });
});

describe("связка filled-билдера и записи", () => {
  it("заполнение уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildFilledEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        origin: "placeholder",
        items: [FILLED_ROW],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  cleared                                                            */
/* ------------------------------------------------------------------ */

/** Снимок до очистки: марка и имя того, что было в позиции. */
const CLEARED_ROW: SpecItemLifecycleRow = {
  id: "item-1",
  code: "М-01",
  name: "Диван",
};

describe("buildClearedEvents", () => {
  it("очистка даёт одно событие с маркой и именем очищенного", () => {
    const events = buildClearedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [CLEARED_ROW],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "cleared",
      payload: { code: "М-01", name: "Диван" },
    });
  });

  it("payload не содержит ничего лишнего", () => {
    const [event] = buildClearedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [CLEARED_ROW],
    });

    // Только то, что нужно для чтения события: имя очищенного и марка, которая
    // очистку переживает.
    expect(Object.keys(event.payload ?? {})).toEqual(["code", "name"]);
  });

  it("одиночная очистка не помечается как групповая", () => {
    const [event] = buildClearedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [CLEARED_ROW],
    });

    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("несколько позиций: по событию на каждую, с batch и batch_size", () => {
    const events = buildClearedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [CLEARED_ROW, { id: "item-2", code: "М-02", name: "Кресло" }],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    for (const event of events) {
      expect(event.payload).toMatchObject({ batch: true, batch_size: 2 });
    }
  });

  it("не дублирует событие при повторном id в списке", () => {
    const events = buildClearedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [CLEARED_ROW, CLEARED_ROW],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список (очищать было нечего) не даёт событий", () => {
    expect(
      buildClearedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });

  it("пустые марка и название записываются как null", () => {
    // Марку очистка сохраняет, но у позиции её может не быть вовсе; имя после
    // очистки пустое — в снимке «что было очищено» это `null`, а не `""`.
    const [event] = buildClearedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-9", code: null, name: "" }],
    });

    expect(event.payload).toEqual({ code: null, name: null });
  });
});

describe("связка cleared-билдера и записи", () => {
  it("очистка уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildClearedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [CLEARED_ROW],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });
});

describe("Undo очистки", () => {
  it("отмена — это заполнение с собственным origin", () => {
    // Фактический mutation path: отмена возвращает содержимое в опустевшую
    // позицию, то есть заполняет её. Отдельного lifecycle-события для отмены
    // нет, а `cleared` тут был бы неверен: позиция снова заполнена.
    const [event] = buildFilledEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      origin: "undo",
      items: [FILLED_ROW],
    });

    expect(event.kind).toBe("filled");
    expect(event.payload).toMatchObject({ origin: "undo" });
  });
});

/* ------------------------------------------------------------------ */
/*  variant_switched                                                   */
/* ------------------------------------------------------------------ */

const variantRef = (variantId: string, name: string | null) => ({
  variantId,
  name,
});

const VARIANT_A = variantRef("v-a", "Керамогранит Blanco");
const VARIANT_B = variantRef("v-b", "Finex Дуб Роял");

describe("buildVariantSwitchedEvents", () => {
  it("A → B даёт одно событие", () => {
    const events = buildVariantSwitchedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ specItemId: "item-1", from: VARIANT_A, to: VARIANT_B }],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      kind: "variant_switched",
      payload: {
        from: { variant_id: "v-a", name: "Керамогранит Blanco" },
        to: { variant_id: "v-b", name: "Finex Дуб Роял" },
      },
    });
  });

  it("событие привязано к ленте позиции", () => {
    const [event] = buildVariantSwitchedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ specItemId: "item-1", from: VARIANT_A, to: VARIANT_B }],
    });

    expect(event.specItemId).toBe("item-1");
  });

  it("payload содержит только id и название с обеих сторон", () => {
    const [event] = buildVariantSwitchedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ specItemId: "item-1", from: VARIANT_A, to: VARIANT_B }],
    });

    expect(Object.keys(event.payload ?? {})).toEqual(["from", "to"]);
    expect(Object.keys((event.payload?.from ?? {}) as object)).toEqual([
      "variant_id",
      "name",
    ]);
  });

  it("последующее переименование варианта не меняет записанный payload", () => {
    // Название хранится снимком: событие остаётся читаемым и после правки
    // варианта.
    const to = variantRef("v-b", "Finex Дуб Роял");
    const [event] = buildVariantSwitchedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ specItemId: "item-1", from: VARIANT_A, to }],
    });

    to.name = "Переименованный вариант";
    expect(event.payload?.to).toEqual({
      variant_id: "v-b",
      name: "Finex Дуб Роял",
    });
  });

  it("A → A события не даёт", () => {
    expect(
      buildVariantSwitchedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ specItemId: "item-1", from: VARIANT_A, to: VARIANT_A }],
      }),
    ).toEqual([]);
  });

  it("активного варианта не было — from равен null", () => {
    const [event] = buildVariantSwitchedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ specItemId: "item-1", from: null, to: VARIANT_A }],
    });

    expect(event.payload).toEqual({
      from: null,
      to: { variant_id: "v-a", name: "Керамогранит Blanco" },
    });
  });

  it("активного варианта не стало — to равен null", () => {
    const [event] = buildVariantSwitchedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ specItemId: "item-1", from: VARIANT_A, to: null }],
    });

    expect(event.payload).toEqual({
      from: { variant_id: "v-a", name: "Керамогранит Blanco" },
      to: null,
    });
  });

  it("оба пустых — не переключение", () => {
    expect(
      buildVariantSwitchedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ specItemId: "item-1", from: null, to: null }],
      }),
    ).toEqual([]);
  });

  it("пустое название нормализуется в null", () => {
    const [event] = buildVariantSwitchedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        { specItemId: "item-1", from: null, to: variantRef("v-b", "") },
      ],
    });

    expect(event.payload?.to).toEqual({ variant_id: "v-b", name: null });
  });

  it("позиции не смешиваются: по событию на каждую", () => {
    const events = buildVariantSwitchedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        { specItemId: "item-1", from: VARIANT_A, to: VARIANT_B },
        { specItemId: "item-2", from: VARIANT_B, to: VARIANT_A },
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
  });

  it("не дублирует событие при повторном spec_item_id", () => {
    const events = buildVariantSwitchedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        { specItemId: "item-1", from: VARIANT_A, to: VARIANT_B },
        { specItemId: "item-1", from: VARIANT_A, to: VARIANT_B },
      ],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildVariantSwitchedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

describe("связка switch-билдера и записи", () => {
  it("переключение уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildVariantSwitchedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ specItemId: "item-1", from: VARIANT_A, to: VARIANT_B }],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("переключение на текущий вариант не делает запроса", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildVariantSwitchedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ specItemId: "item-1", from: VARIANT_A, to: VARIANT_A }],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  variant_added                                                      */
/* ------------------------------------------------------------------ */

const variantAdded = (
  specItemId: string,
  variantId: string,
  label: string | null,
  baseSnapshotCreated = false,
) => ({ specItemId, variantId, label, baseSnapshotCreated });

describe("buildVariantAddedEvents", () => {
  it("добавление варианта даёт одно событие", () => {
    const events = buildVariantAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantAdded("item-1", "v-1", "Finex Дуб Роял")],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      kind: "variant_added",
      payload: {
        variant_id: "v-1",
        label: "Finex Дуб Роял",
        base_snapshot_created: false,
      },
    });
  });

  it("событие привязано к ленте позиции, а не варианта", () => {
    const [event] = buildVariantAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantAdded("item-1", "v-1", "Finex")],
    });

    expect(event.specItemId).toBe("item-1");
  });

  it("payload содержит только id, label и признак снимка", () => {
    const [event] = buildVariantAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantAdded("item-1", "v-1", "Finex")],
    });

    // name, price, article и поставщик сюда не попадают: на момент создания они
    // ещё скопированы у активного варианта и будут перезаписаны вторым вызовом
    // того же жеста — снимок зафиксировал бы невиданное пользователем состояние.
    expect(Object.keys(event.payload ?? {})).toEqual([
      "variant_id",
      "label",
      "base_snapshot_created",
    ]);
  });

  it("отмечает снимок «Основной», созданный тем же жестом", () => {
    const [event] = buildVariantAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantAdded("item-1", "v-1", "Finex", true)],
    });

    expect(event.payload).toMatchObject({ base_snapshot_created: true });
  });

  it("пустая подпись нормализуется в null", () => {
    const [event] = buildVariantAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantAdded("item-1", "v-1", "")],
    });

    expect(event.payload).toMatchObject({ label: null });
  });

  it("варианты разных позиций дают независимые события", () => {
    const events = buildVariantAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantAdded("item-1", "v-1", "Finex"),
        variantAdded("item-2", "v-2", "Kronospan"),
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    expect(events.map((e) => e.payload?.variant_id)).toEqual(["v-1", "v-2"]);
  });

  it("не дублирует событие при повторном variant_id", () => {
    const events = buildVariantAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantAdded("item-1", "v-1", "Finex"),
        variantAdded("item-1", "v-1", "Finex"),
      ],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildVariantAddedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

describe("связка variant-билдера и записи", () => {
  it("добавление варианта уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildVariantAddedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [variantAdded("item-1", "v-1", "Finex")],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("пустой список не делает запроса", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildVariantAddedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  variant_updated                                                    */
/* ------------------------------------------------------------------ */

/**
 * Строка варианта в том виде, в каком её отдаёт БД: отслеживаемые поля плюс
 * служебные, которые в `changes` попасть не должны.
 */
const variantRow = (over: Record<string, unknown> = {}) => ({
  id: "v-1",
  org_id: "org-1",
  spec_item_id: "item-1",
  position: 0,
  is_active: false,
  created_at: "2026-09-01T10:00:00.000Z",
  updated_at: "2026-09-01T10:00:00.000Z",
  name: "Керамогранит Blanco",
  brand: "Cersanit",
  article: "ART-1",
  spec: "600×600, полированный",
  price: 1200,
  product_url: "https://example.com/blanco",
  image_url: null as string | null,
  lead_time: "2 недели",
  company_id: null as string | null,
  company_name_snapshot: "",
  contact_id: null as string | null,
  label: "Основной",
  ...over,
});

const variantUpdate = (
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  variantId = "v-1",
  specItemId = "item-1",
) => ({ specItemId, variantId, from, to });

describe("buildVariantUpdatedEvents", () => {
  it("изменение одного поля даёт одно событие", () => {
    const events = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantUpdate(variantRow(), variantRow({ price: 1500 }))],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      kind: "variant_updated",
      payload: {
        variant_id: "v-1",
        changes: { price: { from: 1200, to: 1500 } },
      },
    });
  });

  it("несколько полей одним жестом дают одно событие", () => {
    const events = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(
          variantRow(),
          variantRow({ name: "Finex Дуб Роял", brand: "Finex", price: 9900 }),
        ),
      ],
    });

    // Один жест — одна запись: иначе правка из формы варианта (там меняются
    // сразу название, бренд, артикул, спецификация и цена) засыпала бы ленту.
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0].payload?.changes ?? {})).toEqual([
      "name",
      "brand",
      "price",
    ]);
    expect(events[0].payload?.changes).toEqual({
      name: { from: "Керамогранит Blanco", to: "Finex Дуб Роял" },
      brand: { from: "Cersanit", to: "Finex" },
      price: { from: 1200, to: 9900 },
    });
  });

  it("в changes попадают только изменившиеся поля", () => {
    const [event] = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(variantRow(), variantRow({ lead_time: "5 недель" })),
      ],
    });

    expect(Object.keys(event.payload?.changes ?? {})).toEqual(["lead_time"]);
  });

  it("событие лежит в ленте позиции, а вариант назван в payload", () => {
    const [event] = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(
          variantRow(),
          variantRow({ price: 1500 }),
          "v-7",
          "item-42",
        ),
      ],
    });

    expect(event.specItemId).toBe("item-42");
    expect(event.payload).toMatchObject({ variant_id: "v-7" });
  });

  it("from и to берутся из переданных строк как есть", () => {
    const [event] = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(
          variantRow({ article: "ART-1" }),
          variantRow({ article: "ART-2" }),
        ),
      ],
    });

    expect(event.payload?.changes).toEqual({
      article: { from: "ART-1", to: "ART-2" },
    });
  });

  it("снимок не меняется при последующей правке строки варианта", () => {
    const before = variantRow();
    const after = variantRow({ price: 1500, name: "Finex Дуб Роял" });

    const [event] = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantUpdate(before, after)],
    });

    // Строки варианта живут дальше: если бы билдер положил в payload ссылку на
    // них, следующая правка переписала бы уже записанное событие.
    before.price = 1;
    after.price = 2;
    after.name = "Другое";

    expect(event.payload?.changes).toEqual({
      name: { from: "Керамогранит Blanco", to: "Finex Дуб Роял" },
      price: { from: 1200, to: 1500 },
    });
  });

  it("повторное сохранение тех же данных события не даёт", () => {
    const events = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantUpdate(variantRow(), variantRow())],
    });

    expect(events).toEqual([]);
  });

  it("пустая строка и null — одно и то же «не заполнено»", () => {
    const events = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(
          variantRow({ image_url: null, company_id: null }),
          variantRow({ image_url: "", company_id: null }),
        ),
      ],
    });

    expect(events).toEqual([]);
  });

  it("снятие поставщика нормализуется в null", () => {
    const [event] = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(
          variantRow({ company_id: "c-1", company_name_snapshot: "Ромашка" }),
          variantRow({ company_id: null, company_name_snapshot: "" }),
        ),
      ],
    });

    expect(event.payload?.changes).toEqual({
      company_id: { from: "c-1", to: null },
      company_name_snapshot: { from: "Ромашка", to: null },
    });
  });

  it("смена артикула на пустое значение остаётся изменением", () => {
    const [event] = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(variantRow({ article: "ART-1" }), variantRow({ article: "" })),
      ],
    });

    expect(event.payload?.changes).toEqual({
      article: { from: "ART-1", to: null },
    });
  });

  it("служебные поля варианта событием не становятся", () => {
    // Меняются только технические колонки: ни одно отслеживаемое поле не
    // отличается, а `updated_at` mutation пишет всегда — события быть не должно.
    const events = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(
          variantRow(),
          variantRow({
            updated_at: "2026-09-02T10:00:00.000Z",
            position: 3,
            is_active: true,
          }),
        ),
      ],
    });

    expect(events).toEqual([]);
  });

  it("список отслеживаемых полей — только пользовательские колонки", () => {
    expect([...SPEC_VARIANT_PATCH_FIELDS]).toEqual([
      "name",
      "brand",
      "article",
      "spec",
      "price",
      "product_url",
      "image_url",
      "lead_time",
      "company_id",
      "company_name_snapshot",
      "contact_id",
      "label",
    ]);

    for (const service of [
      "id",
      "org_id",
      "spec_item_id",
      "position",
      "is_active",
      "created_at",
      "updated_at",
    ]) {
      expect(SPEC_VARIANT_PATCH_FIELDS as readonly string[]).not.toContain(
        service,
      );
    }
  });

  it("изменения количества и марки к варианту не относятся", () => {
    // У `spec_item_variants` нет ни `qty`, ни `code`: эти поля принадлежат
    // позиции и логируются своими событиями.
    const events = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(variantRow(), variantRow({ qty: 5, code: "О-03" })),
      ],
    });

    expect(events).toEqual([]);
  });

  it("варианты разных позиций дают независимые события", () => {
    const events = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(variantRow(), variantRow({ price: 1500 }), "v-1", "item-1"),
        variantUpdate(variantRow(), variantRow({ price: 700 }), "v-2", "item-2"),
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    expect(events.map((e) => e.payload?.variant_id)).toEqual(["v-1", "v-2"]);
  });

  it("не дублирует событие при повторном variant_id", () => {
    const events = buildVariantUpdatedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantUpdate(variantRow(), variantRow({ price: 1500 })),
        variantUpdate(variantRow(), variantRow({ price: 1500 })),
      ],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildVariantUpdatedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

describe("связка variant_updated-билдера и записи", () => {
  it("правка варианта уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildVariantUpdatedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [variantUpdate(variantRow(), variantRow({ price: 1500 }))],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("сохранение без изменений не делает запроса", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildVariantUpdatedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [variantUpdate(variantRow(), variantRow())],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  variant_removed                                                    */
/* ------------------------------------------------------------------ */

const variantRemoved = (
  variantId: string,
  name: string | null,
  label: string | null,
  wasActive = false,
  nextActive: { variantId: string; name: string | null } | null = null,
  specItemId = "item-1",
) => ({ specItemId, variantId, name, label, wasActive, nextActive });

describe("buildVariantRemovedEvents", () => {
  it("удаление обычного варианта даёт одно событие", () => {
    const events = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantRemoved("v-1", "Finex Дуб Роял", "Альтернатива")],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      kind: "variant_removed",
      payload: {
        variant_id: "v-1",
        name: "Finex Дуб Роял",
        label: "Альтернатива",
        was_active: false,
        next_active: null,
      },
    });
  });

  it("событие привязано к ленте позиции, а не к удалённому варианту", () => {
    const [event] = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantRemoved("v-1", "Finex", null, false, null, "item-42")],
    });

    expect(event.specItemId).toBe("item-42");
  });

  it("payload — снимок удалённого варианта", () => {
    const [event] = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantRemoved("v-7", "Керамогранит Blanco", "Основной")],
    });

    // Строки в spec_item_variants больше нет: всё, что нужно строке истории,
    // лежит в самом событии — повторно запрашивать нечего.
    expect(event.payload).toEqual({
      variant_id: "v-7",
      name: "Керамогранит Blanco",
      label: "Основной",
      was_active: false,
      next_active: null,
    });
  });

  it("пустые название и подпись нормализуются в null", () => {
    const [event] = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantRemoved("v-1", "", "")],
    });

    expect(event.payload).toMatchObject({ name: null, label: null });
  });

  it("was_active отмечает удаление активного варианта", () => {
    const [event] = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantRemoved("v-a", "Керамогранит Blanco", "Основной", true, {
          variantId: "v-b",
          name: "Finex Дуб Роял",
        }),
      ],
    });

    expect(event.payload).toMatchObject({
      was_active: true,
      next_active: { variant_id: "v-b", name: "Finex Дуб Роял" },
    });
  });

  it("неактивный вариант преемника не имеет", () => {
    const [event] = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantRemoved("v-b", "Finex Дуб Роял", "Альтернатива")],
    });

    expect(event.payload).toMatchObject({
      was_active: false,
      next_active: null,
    });
  });

  it("преемника назначить не удалось — next_active пуст", () => {
    // Удаление состоялось, а назначение активного — нет. Событие не должно
    // утверждать, что замена произошла.
    const [event] = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [variantRemoved("v-a", "Blanco", "Основной", true, null)],
    });

    expect(event.payload).toMatchObject({
      was_active: true,
      next_active: null,
    });
  });

  it("снимок не меняется при последующих изменениях источника", () => {
    const next = variantRef("v-b", "Finex Дуб Роял");

    const [event] = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantRemoved("v-a", "Керамогранит Blanco", "Основной", true, next),
      ],
    });

    // Удалённая строка уже исчезла, а живой вариант-преемник продолжает
    // меняться: событие должно остаться снимком момента удаления.
    next.name = "Переименован";

    expect(event.payload).toEqual({
      variant_id: "v-a",
      name: "Керамогранит Blanco",
      label: "Основной",
      was_active: true,
      next_active: { variant_id: "v-b", name: "Finex Дуб Роял" },
    });
  });

  it("позиции не смешиваются: по событию на каждую", () => {
    const events = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantRemoved("v-1", "Finex", null, false, null, "item-1"),
        variantRemoved("v-2", "Blanco", null, false, null, "item-2"),
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    expect(events.map((e) => e.payload?.variant_id)).toEqual(["v-1", "v-2"]);
  });

  it("не дублирует событие при повторном variant_id", () => {
    const events = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantRemoved("v-1", "Finex", null),
        variantRemoved("v-1", "Finex", null),
      ],
    });

    expect(events).toHaveLength(1);
  });

  it("batch-полей нет: группового удаления вариантов в приложении нет", () => {
    // Удаляется всегда один вариант: и mutation, и интерфейс работают с одним
    // id, поэтому `batch` / `batch_size` здесь не появляются.
    const events = buildVariantRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        variantRemoved("v-1", "Finex", null, false, null, "item-1"),
        variantRemoved("v-2", "Blanco", null, false, null, "item-2"),
      ],
    });

    for (const event of events) {
      expect(Object.keys(event.payload ?? {})).toEqual([
        "variant_id",
        "name",
        "label",
        "was_active",
        "next_active",
      ]);
    }
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildVariantRemovedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

describe("связка variant_removed-билдера и записи", () => {
  it("удаление варианта уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildVariantRemovedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [variantRemoved("v-1", "Finex", "Альтернатива")],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("пустой список не делает запроса", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildVariantRemovedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  component_added                                                    */
/* ------------------------------------------------------------------ */

const componentAdded = (
  componentId: string,
  kind: "component" | "group" | "spec_ref" = "component",
  name: string | null = "Корпус",
  ref: { specItemId: string; code: string | null; name: string | null } | null = null,
  specItemId = "item-1",
) => ({ specItemId, componentId, kind, name, ref });

describe("buildComponentAddedEvents", () => {
  it("добавление компонента даёт одно событие", () => {
    const events = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1")],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      kind: "component_added",
      payload: {
        component_id: "c-1",
        kind: "component",
        name: "Корпус",
        ref: null,
      },
    });
  });

  it("событие привязано к позиции-владельцу состава", () => {
    const [event] = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1", "component", "Корпус", null, "item-42")],
    });

    // Строка состава не является строкой spec_items, поэтому в ленте позиции
    // она названа отдельно.
    expect(event.specItemId).toBe("item-42");
    expect(event.payload?.component_id).toBe("c-1");
  });

  it("payload — снимок созданной строки", () => {
    const [event] = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-7", "component", "Столешница")],
    });

    expect(event.payload).toEqual({
      component_id: "c-7",
      kind: "component",
      name: "Столешница",
      ref: null,
    });
  });

  it("группа отличается видом строки", () => {
    const [event] = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-2", "group", "Техника")],
    });

    expect(event.payload).toMatchObject({ kind: "group", name: "Техника" });
  });

  it("у ссылки подпись едет в ref, а технический маркер в name не попадает", () => {
    const [event] = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        componentAdded("c-3", "spec_ref", "spec_ref", {
          specItemId: "item-9",
          code: "О-03",
          name: "Духовой шкаф",
        }),
      ],
    });

    // В БД у ссылки name — технический маркер 'spec_ref'; показывает её
    // название связанной позиции.
    expect(event.payload).toEqual({
      component_id: "c-3",
      kind: "spec_ref",
      name: null,
      ref: { spec_item_id: "item-9", code: "О-03", name: "Духовой шкаф" },
    });
  });

  it("ссылка без доступной подписи сохраняет хотя бы id", () => {
    const [event] = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        componentAdded("c-3", "spec_ref", "spec_ref", {
          specItemId: "item-9",
          code: null,
          name: null,
        }),
      ],
    });

    expect(event.payload?.ref).toEqual({
      spec_item_id: "item-9",
      code: null,
      name: null,
    });
  });

  it("пустое название нормализуется в null", () => {
    const [event] = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1", "component", "")],
    });

    expect(event.payload).toMatchObject({ name: null });
  });

  it("снимок не меняется после последующей правки строки состава", () => {
    const ref = { specItemId: "item-9", code: "О-03", name: "Духовой шкаф" };
    const item = componentAdded("c-3", "spec_ref", "spec_ref", ref);

    const [event] = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [item],
    });

    // Строку состава потом переименуют, а связанную позицию — удалят: событие
    // должно остаться снимком момента добавления.
    item.name = "Переименовано";
    ref.code = "О-99";
    ref.name = "Другое";

    expect(event.payload).toEqual({
      component_id: "c-3",
      kind: "spec_ref",
      name: null,
      ref: { spec_item_id: "item-9", code: "О-03", name: "Духовой шкаф" },
    });
  });

  it("позиции не смешиваются: по событию на каждую", () => {
    const events = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        componentAdded("c-1", "component", "Корпус", null, "item-1"),
        componentAdded("c-2", "component", "Фасад", null, "item-2"),
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    expect(events.map((e) => e.payload?.component_id)).toEqual(["c-1", "c-2"]);
  });

  it("не дублирует событие при повторном component_id", () => {
    const events = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1"), componentAdded("c-1")],
    });

    expect(events).toHaveLength(1);
  });

  it("batch-полей нет: строки состава добавляются по одной", () => {
    // Каждая форма добавляет ровно одну строку, поэтому `batch` / `batch_size`
    // здесь не появляются в отличие от `created` / `removed`.
    const events = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        componentAdded("c-1", "component", "Корпус", null, "item-1"),
        componentAdded("c-2", "component", "Фасад", null, "item-2"),
      ],
    });

    for (const event of events) {
      expect(Object.keys(event.payload ?? {})).toEqual([
        "component_id",
        "kind",
        "name",
        "ref",
      ]);
    }
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildComponentAddedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

describe("связка component_added-билдера и записи", () => {
  it("добавление компонента уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildComponentAddedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [componentAdded("c-1")],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("пустой список не делает запроса", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildComponentAddedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  component_removed                                                  */
/* ------------------------------------------------------------------ */

describe("buildComponentRemovedEvents", () => {
  it("удаление обычного компонента даёт одно событие", () => {
    const events = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1")],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      kind: "component_removed",
      payload: {
        component_id: "c-1",
        kind: "component",
        name: "Корпус",
        ref: null,
      },
    });
  });

  it("событие привязано к позиции-владельцу состава", () => {
    const [event] = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1", "component", "Корпус", null, "item-42")],
    });

    expect(event.specItemId).toBe("item-42");
    expect(event.payload?.component_id).toBe("c-1");
  });

  it("payload — снимок удалённой строки", () => {
    const [event] = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-7", "component", "Столешница")],
    });

    // Строки в spec_item_components больше нет: лента должна показывать то, что
    // пользователь видел до удаления.
    expect(event.payload).toEqual({
      component_id: "c-7",
      kind: "component",
      name: "Столешница",
      ref: null,
    });
  });

  it("удаление группы отличается видом строки", () => {
    const [event] = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-2", "group", "Техника")],
    });

    expect(event.payload).toMatchObject({ kind: "group", name: "Техника" });
  });

  it("у удалённой ссылки подпись едет в ref, а техмаркер в name не попадает", () => {
    const [event] = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        componentAdded("c-3", "spec_ref", "spec_ref", {
          specItemId: "item-9",
          code: "О-03",
          name: "Духовой шкаф",
        }),
      ],
    });

    expect(event.payload).toEqual({
      component_id: "c-3",
      kind: "spec_ref",
      name: null,
      ref: { spec_item_id: "item-9", code: "О-03", name: "Духовой шкаф" },
    });
  });

  it("ссылка без доступной подписи сохраняет хотя бы id", () => {
    const [event] = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        componentAdded("c-3", "spec_ref", "spec_ref", {
          specItemId: "item-9",
          code: null,
          name: null,
        }),
      ],
    });

    expect(event.payload?.ref).toEqual({
      spec_item_id: "item-9",
      code: null,
      name: null,
    });
  });

  it("пустое название нормализуется в null", () => {
    const [event] = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1", "component", "")],
    });

    expect(event.payload).toMatchObject({ name: null });
  });

  it("снимок не меняется после удаления и последующих правок источника", () => {
    const ref = { specItemId: "item-9", code: "О-03", name: "Духовой шкаф" };
    const item = componentAdded("c-3", "spec_ref", "spec_ref", ref);

    const [event] = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [item],
    });

    item.name = "Другое";
    ref.code = "О-99";
    ref.name = "Удалено";

    expect(event.payload).toEqual({
      component_id: "c-3",
      kind: "spec_ref",
      name: null,
      ref: { spec_item_id: "item-9", code: "О-03", name: "Духовой шкаф" },
    });
  });

  it("состав полей совпадает с component_added: лента читается парно", () => {
    const [added] = buildComponentAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1")],
    });
    const [removed] = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1")],
    });

    expect(Object.keys(removed.payload ?? {})).toEqual(
      Object.keys(added.payload ?? {}),
    );
    expect(removed.payload).toEqual(added.payload);
  });

  it("позиции не смешиваются: по событию на каждую", () => {
    const events = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        componentAdded("c-1", "component", "Корпус", null, "item-1"),
        componentAdded("c-2", "component", "Фасад", null, "item-2"),
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
  });

  it("не дублирует событие при повторном component_id", () => {
    const events = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1"), componentAdded("c-1")],
    });

    expect(events).toHaveLength(1);
  });

  it("batch-полей нет: одно удаление — одна строка", () => {
    const events = buildComponentRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [componentAdded("c-1"), componentAdded("c-2", "group", "Техника")],
    });

    for (const event of events) {
      expect(Object.keys(event.payload ?? {})).toEqual([
        "component_id",
        "kind",
        "name",
        "ref",
      ]);
    }
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildComponentRemovedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

describe("связка component_removed-билдера и записи", () => {
  it("удаление строки состава уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildComponentRemovedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [componentAdded("c-1")],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("пустой список не делает запроса", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildComponentRemovedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  service_added                                                      */
/* ------------------------------------------------------------------ */

const serviceRef = (
  type: "delivery" | "installation" | "service" = "delivery",
  name: string | null = null,
  amount = 5000,
  serviceId = "srv-1",
) => ({ serviceId, type, name, amount });

describe("buildServiceAddedEvents", () => {
  it("добавление операции даёт событие в ленте позиции", () => {
    const events = buildServiceAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef(),
      specItemIds: ["item-1"],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "service_added",
      payload: {
        service_id: "srv-1",
        type: "delivery",
        name: null,
        amount: 5000,
      },
    });
  });

  it("payload — снимок созданной операции", () => {
    const [event] = buildServiceAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("service", "Подъём на этаж", 12_500.5, "srv-9"),
      specItemIds: ["item-1"],
    });

    // Операция принадлежит проекту и после создания живёт своей жизнью:
    // в ленте должно остаться то, что добавили.
    expect(event.payload).toEqual({
      service_id: "srv-9",
      type: "service",
      name: "Подъём на этаж",
      amount: 12_500.5,
    });
  });

  it("подпись доставки и монтажа в payload не дублируется", () => {
    // «Доставка»/«Монтаж» — подписи из SERVICE_OPERATION_CONFIG, единственная
    // точка перевода типа в текст — operationLabel(). В событии остаётся тип.
    for (const type of ["delivery", "installation"] as const) {
      const [event] = buildServiceAddedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef(type, null, 3000),
        specItemIds: ["item-1"],
      });

      expect(Object.keys(event.payload ?? {})).toEqual([
        "service_id",
        "type",
        "name",
        "amount",
      ]);
      expect(event.payload).toMatchObject({ type, name: null, amount: 3000 });
    }
  });

  it("пустое название нормализуется в null", () => {
    const [event] = buildServiceAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("service", "", 1000),
      specItemIds: ["item-1"],
    });

    expect(event.payload).toMatchObject({ name: null });
  });

  it("нулевая сумма остаётся нулём, а не «не заполнено»", () => {
    const [event] = buildServiceAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("installation", null, 0),
      specItemIds: ["item-1"],
    });

    expect(event.payload).toMatchObject({ amount: 0 });
  });

  it("N позиций дают N событий с флагами групповой операции", () => {
    const events = buildServiceAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("delivery", null, 7000),
      specItemIds: ["item-1", "item-2", "item-3"],
    });

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.specItemId)).toEqual([
      "item-1",
      "item-2",
      "item-3",
    ]);
    for (const event of events) {
      expect(event.payload).toMatchObject({ batch: true, batch_size: 3 });
    }
  });

  it("одна позиция флагов групповой операции не получает", () => {
    const [event] = buildServiceAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("delivery", null, 7000),
      specItemIds: ["item-1"],
    });

    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("batch_size считает события, а не повторы в списке позиций", () => {
    // Повтор id не должен дать две строки в ленте одной позиции и завышенный
    // размер группы: связка «операция ⇄ позиция» уникальна и в БД.
    const events = buildServiceAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("installation", null, 7000),
      specItemIds: ["item-1", "item-1", "item-2"],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    for (const event of events) {
      expect(event.payload).toMatchObject({ batch_size: 2 });
    }
  });

  it("своя услуга без позиций событий не даёт", () => {
    // «Хранение на складе» — расход проекта целиком: лента персональная, и
    // такому расходу в ней негде лежать.
    expect(
      buildServiceAddedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef("service", "Хранение на складе", 4000),
        specItemIds: [],
      }),
    ).toEqual([]);
  });

  it("снимок не меняется после последующих правок операции", () => {
    const service = serviceRef("service", "Подъём на этаж", 5000, "srv-3");

    const [event] = buildServiceAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service,
      specItemIds: ["item-1"],
    });

    service.name = "Другое";
    service.amount = 1;
    service.type = "delivery";

    expect(event.payload).toEqual({
      service_id: "srv-3",
      type: "service",
      name: "Подъём на этаж",
      amount: 5000,
    });
  });

  it("разные позиции получают каждое своё событие", () => {
    const events = buildServiceAddedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("service", "Сборка", 2000, "srv-7"),
      specItemIds: ["item-9", "item-4"],
    });

    expect(events.map((e) => e.specItemId)).toEqual(["item-9", "item-4"]);
    for (const event of events) {
      expect(event.payload?.service_id).toBe("srv-7");
    }
  });
});

describe("связка service_added-билдера и записи", () => {
  it("операция на несколько позиций уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildServiceAddedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef(),
        specItemIds: ["item-1", "item-2", "item-3"],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(3);
  });

  it("без связанных позиций запроса нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildServiceAddedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef("service", "Хранение", 100),
        specItemIds: [],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  service_completed                                                  */
/* ------------------------------------------------------------------ */

describe("buildServiceCompletedEvents", () => {
  it("завершение доставки даёт событие в ленте позиции", () => {
    const events = buildServiceCompletedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef(),
      specItemIds: ["item-1"],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "service_completed",
      payload: {
        service_id: "srv-1",
        type: "delivery",
        name: null,
        amount: 5000,
      },
    });
  });

  it("монтаж и своя услуга завершаются теми же данными", () => {
    const [installation] = buildServiceCompletedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("installation", null, 9000),
      specItemIds: ["item-1"],
    });
    const [service] = buildServiceCompletedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("service", "Подъём на этаж", 2500, "srv-4"),
      specItemIds: ["item-1"],
    });

    expect(installation.payload).toMatchObject({
      type: "installation",
      name: null,
      amount: 9000,
    });
    expect(service.payload).toEqual({
      service_id: "srv-4",
      type: "service",
      name: "Подъём на этаж",
      amount: 2500,
    });
  });

  it("payload не дублирует completed: завершение сказано типом события", () => {
    const [event] = buildServiceCompletedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("delivery", null, 3000),
      specItemIds: ["item-1"],
    });

    expect(Object.keys(event.payload ?? {})).toEqual([
      "service_id",
      "type",
      "name",
      "amount",
    ]);
    expect(event.payload).not.toHaveProperty("completed");
  });

  it("N позиций дают N событий с флагами групповой операции", () => {
    const events = buildServiceCompletedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("delivery", null, 7000),
      specItemIds: ["item-1", "item-2", "item-3"],
    });

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.specItemId)).toEqual([
      "item-1",
      "item-2",
      "item-3",
    ]);
    for (const event of events) {
      expect(event.payload).toMatchObject({ batch: true, batch_size: 3 });
    }
  });

  it("одна связанная позиция флагов групповой операции не получает", () => {
    const [event] = buildServiceCompletedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef(),
      specItemIds: ["item-1"],
    });

    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("batch_size считает события, а не повторы в списке позиций", () => {
    const events = buildServiceCompletedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef(),
      specItemIds: ["item-1", "item-1"],
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload).not.toHaveProperty("batch");
  });

  it("операция без связанных позиций событий не даёт", () => {
    // Своя услуга-расход проекта: завершать её можно, но персональной ленты у
    // неё нет.
    expect(
      buildServiceCompletedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef("service", "Хранение на складе", 4000),
        specItemIds: [],
      }),
    ).toEqual([]);
  });

  it("снимок не меняется после последующих правок операции", () => {
    const service = serviceRef("delivery", null, 7000, "srv-5");

    const [event] = buildServiceCompletedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service,
      specItemIds: ["item-1"],
    });

    service.amount = 1;
    service.type = "service";
    service.name = "Другое";

    expect(event.payload).toEqual({
      service_id: "srv-5",
      type: "delivery",
      name: null,
      amount: 7000,
    });
  });

  it("разные позиции получают каждое своё событие", () => {
    const events = buildServiceCompletedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("installation", null, 1000, "srv-8"),
      specItemIds: ["item-9", "item-4"],
    });

    expect(events.map((e) => e.specItemId)).toEqual(["item-9", "item-4"]);
  });

  it("состав полей совпадает с service_added: одна операция в двух событиях", () => {
    const args = {
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("delivery", null, 7000),
      specItemIds: ["item-1", "item-2"],
    };

    const [added] = buildServiceAddedEvents(args);
    const [completed] = buildServiceCompletedEvents(args);

    expect(completed.payload).toEqual(added.payload);
    expect(added.kind).toBe("service_added");
    expect(completed.kind).toBe("service_completed");
  });
});

describe("связка service_completed-билдера и записи", () => {
  it("завершение на несколько позиций уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildServiceCompletedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef(),
        specItemIds: ["item-1", "item-2"],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(2);
  });

  it("без связанных позиций запроса нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildServiceCompletedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef("service", "Хранение", 100),
        specItemIds: [],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  service_removed                                                    */
/* ------------------------------------------------------------------ */

describe("buildServiceRemovedEvents", () => {
  it("удаление доставки даёт событие в ленте позиции", () => {
    const events = buildServiceRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef(),
      specItemIds: ["item-1"],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "service_removed",
      payload: {
        service_id: "srv-1",
        type: "delivery",
        name: null,
        amount: 5000,
      },
    });
  });

  it("удаление монтажа и своей услуги несут свой тип и название", () => {
    const [installation] = buildServiceRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("installation", null, 9000),
      specItemIds: ["item-1"],
    });
    const [service] = buildServiceRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("service", "Подъём на этаж", 2500, "srv-4"),
      specItemIds: ["item-1"],
    });

    expect(installation.payload).toMatchObject({
      type: "installation",
      name: null,
      amount: 9000,
    });
    expect(service.payload).toEqual({
      service_id: "srv-4",
      type: "service",
      name: "Подъём на этаж",
      amount: 2500,
    });
  });

  it("payload не несёт признаков удаления: они в типе события", () => {
    const [event] = buildServiceRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("delivery", null, 3000),
      specItemIds: ["item-1"],
    });

    expect(Object.keys(event.payload ?? {})).toEqual([
      "service_id",
      "type",
      "name",
      "amount",
    ]);
    expect(event.payload).not.toHaveProperty("completed");
    expect(event.payload).not.toHaveProperty("removed");
  });

  it("N позиций дают N событий с флагами групповой операции", () => {
    const events = buildServiceRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("delivery", null, 7000),
      specItemIds: ["item-1", "item-2", "item-3"],
    });

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.specItemId)).toEqual([
      "item-1",
      "item-2",
      "item-3",
    ]);
    for (const event of events) {
      expect(event.payload).toMatchObject({ batch: true, batch_size: 3 });
    }
  });

  it("одна связанная позиция флагов групповой операции не получает", () => {
    const [event] = buildServiceRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef(),
      specItemIds: ["item-1"],
    });

    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("batch_size считает события, а не повторы в списке позиций", () => {
    const events = buildServiceRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef(),
      specItemIds: ["item-1", "item-1"],
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload).not.toHaveProperty("batch");
  });

  it("операция без связанных позиций событий не даёт", () => {
    // Своя услуга-расход проекта: удалить её можно, но персональной ленты у неё
    // нет.
    expect(
      buildServiceRemovedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef("service", "Хранение на складе", 4000),
        specItemIds: [],
      }),
    ).toEqual([]);
  });

  it("снимок не меняется после физического удаления операции", () => {
    const service = serviceRef("service", "Сборка", 3300, "srv-6");

    const [event] = buildServiceRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service,
      specItemIds: ["item-1"],
    });

    // Строки в service_operations больше нет: лента живёт только снимком.
    service.name = "Другое";
    service.amount = 0;
    service.type = "delivery";

    expect(event.payload).toEqual({
      service_id: "srv-6",
      type: "service",
      name: "Сборка",
      amount: 3300,
    });
  });

  it("разные позиции получают каждое своё событие", () => {
    const events = buildServiceRemovedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("installation", null, 1000, "srv-8"),
      specItemIds: ["item-9", "item-4"],
    });

    expect(events.map((e) => e.specItemId)).toEqual(["item-9", "item-4"]);
  });

  it("состав полей совпадает у всех трёх событий операции", () => {
    const args = {
      orgId: "org-1",
      actor: CREATED_BY,
      service: serviceRef("delivery", null, 7000),
      specItemIds: ["item-1", "item-2"],
    };

    const [added] = buildServiceAddedEvents(args);
    const [completed] = buildServiceCompletedEvents(args);
    const [removed] = buildServiceRemovedEvents(args);

    expect(completed.payload).toEqual(added.payload);
    expect(removed.payload).toEqual(added.payload);
    expect([added.kind, completed.kind, removed.kind]).toEqual([
      "service_added",
      "service_completed",
      "service_removed",
    ]);
  });
});

describe("связка service_removed-билдера и записи", () => {
  it("удаление операции на несколько позиций уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildServiceRemovedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef(),
        specItemIds: ["item-1", "item-2"],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(2);
  });

  it("без связанных позиций запроса нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildServiceRemovedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        service: serviceRef("service", "Хранение", 100),
        specItemIds: [],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  parent_changed                                                     */
/* ------------------------------------------------------------------ */

const parentRef = (specItemId: string, code: string | null, name: string | null) => ({
  specItemId,
  code,
  name,
});

/** Ожидаемая форма родителя в payload: ключ колонки, а не доменное имя. */
const parentPayload = (ref: { specItemId: string; code: string | null; name: string | null }) => ({
  spec_item_id: ref.specItemId,
  code: ref.code,
  name: ref.name,
});

const PARENT_A = parentRef("p-a", "М-01", "Кухня");
const PARENT_B = parentRef("p-b", "М-02", "Шкаф");

describe("buildParentChangedEvents", () => {
  it("null → parent даёт одно событие", () => {
    const events = buildParentChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-1", from: null, to: PARENT_A }],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "parent_changed",
      payload: { from: null, to: parentPayload(PARENT_A) },
    });
  });

  it("parent A → parent B переносит оба читаемых снимка", () => {
    const [event] = buildParentChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-1", from: PARENT_A, to: PARENT_B }],
    });

    expect(event.payload).toEqual({
      from: parentPayload(PARENT_A),
      to: parentPayload(PARENT_B),
    });
  });

  it("в payload родитель назван ключом колонки, а не доменным полем", () => {
    // У остальных ссылок истории ключ тот же (`variant_id`, `component_id`,
    // `ref.spec_item_id`), поэтому читающему коду не нужен частный случай.
    const [event] = buildParentChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-1", from: null, to: PARENT_A }],
    });

    expect(event.payload?.to).toMatchObject({ spec_item_id: "p-a" });
    expect(event.payload?.to).not.toHaveProperty("id");
    expect(event.payload?.to).not.toHaveProperty("specItemId");
  });

  it("parent → null снимает родителя", () => {
    const [event] = buildParentChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-1", from: PARENT_A, to: null }],
    });

    expect(event.payload).toEqual({
      from: parentPayload(PARENT_A),
      to: null,
    });
  });

  it("payload содержит марку и название, а не только uuid", () => {
    const [event] = buildParentChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-1", from: null, to: PARENT_A }],
    });

    // Иначе история нечитаема: голый uuid ничего не говорит пользователю.
    expect(event.payload?.to).toMatchObject({
      code: "М-01",
      name: "Кухня",
    });
  });

  it("тот же родитель события не даёт", () => {
    expect(
      buildParentChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ id: "item-1", from: PARENT_A, to: PARENT_A }],
      }),
    ).toEqual([]);
  });

  it("оба родителя отсутствуют — не изменение", () => {
    expect(
      buildParentChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ id: "item-1", from: null, to: null }],
      }),
    ).toEqual([]);
  });

  it("пустая марка нормализуется в null", () => {
    const [event] = buildParentChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-1", from: null, to: parentRef("p-a", "", "Кухня") }],
    });

    expect(event.payload?.to).toMatchObject({ code: null, name: "Кухня" });
  });

  it("смена родителя на позицию без марки всё равно читается по названию", () => {
    const [event] = buildParentChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: null,
          to: parentRef("p-a", null, "Позиция без марки"),
        },
      ],
    });

    expect(event.payload?.to).toEqual({
      spec_item_id: "p-a",
      code: null,
      name: "Позиция без марки",
    });
  });

  it("не дублирует событие при повторном id в списке", () => {
    const events = buildParentChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        { id: "item-1", from: null, to: PARENT_A },
        { id: "item-1", from: null, to: PARENT_A },
      ],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildParentChangedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

describe("связка parent-билдера и записи", () => {
  it("смена родителя уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildParentChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ id: "item-1", from: null, to: PARENT_A }],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("когда родитель не изменился, запроса к БД нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildParentChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ id: "item-1", from: PARENT_A, to: PARENT_A }],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  code_changed                                                       */
/* ------------------------------------------------------------------ */

const codeChange = (id: string, from: string | null, to: string | null) => ({
  id,
  from,
  to,
});

describe("buildCodeChangedEvents", () => {
  it("обычная смена марки даёт одно событие", () => {
    const events = buildCodeChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [codeChange("item-1", "М-01", "М-05")],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "code_changed",
      payload: { from: "М-01", to: "М-05" },
    });
  });

  it("payload содержит только from и to", () => {
    const [event] = buildCodeChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [codeChange("item-1", "М-01", "М-05")],
    });

    expect(Object.keys(event.payload ?? {})).toEqual(["from", "to"]);
  });

  it("actor переносится в событие", () => {
    const [event] = buildCodeChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [codeChange("item-1", "М-01", "М-05")],
    });

    expect(event.actor).toEqual(CREATED_BY);
  });

  it("from === to события не даёт", () => {
    expect(
      buildCodeChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [codeChange("item-1", "М-01", "М-01")],
      }),
    ).toEqual([]);
  });

  it("поддерживает переход null → значение", () => {
    const [event] = buildCodeChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [codeChange("item-1", null, "М-05")],
    });

    expect(event.payload).toEqual({ from: null, to: "М-05" });
  });

  it("поддерживает переход значение → null", () => {
    const [event] = buildCodeChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [codeChange("item-1", "М-01", null)],
    });

    expect(event.payload).toEqual({ from: "М-01", to: null });
  });

  it("пустая строка нормализуется в null и не считается изменением", () => {
    expect(
      buildCodeChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [codeChange("item-1", null, "")],
      }),
    ).toEqual([]);

    const [event] = buildCodeChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [codeChange("item-1", "", "М-05")],
    });
    expect(event.payload).toEqual({ from: null, to: "М-05" });
  });

  it("обмен марками: по событию на каждую из двух позиций", () => {
    // RPC меняет марку у обеих позиций, поэтому история каждой должна знать
    // свою пару from → to.
    const events = buildCodeChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        codeChange("item-1", "М-01", "М-05"),
        codeChange("item-2", "М-05", "М-01"),
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
    expect(events[1].payload).toEqual({ from: "М-05", to: "М-01" });
  });

  it("не дублирует событие при повторном id в списке", () => {
    const events = buildCodeChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        codeChange("item-1", "М-01", "М-05"),
        codeChange("item-1", "М-01", "М-05"),
      ],
    });

    expect(events).toHaveLength(1);
  });

  it("из смешанного списка событие получает только изменившаяся позиция", () => {
    const events = buildCodeChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        codeChange("item-1", "М-01", "М-01"),
        codeChange("item-2", "М-02", "М-05"),
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0].specItemId).toBe("item-2");
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildCodeChangedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

describe("связка code-билдера и записи", () => {
  it("смена марки уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildCodeChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [codeChange("item-1", "М-01", "М-05")],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("обмен марками уходит одним INSERT на две записи", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildCodeChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          codeChange("item-1", "М-01", "М-05"),
          codeChange("item-2", "М-05", "М-01"),
        ],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].rows).toHaveLength(2);
  });

  it("когда марка не изменилась, запроса к БД нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildCodeChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [codeChange("item-1", "М-01", "М-01")],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

describe("связка билдера и записи", () => {
  it("batch-создание уходит одним INSERT, а не N запросами", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildCreatedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        origin: "library",
        items: ROWS,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].rows).toHaveLength(2);
  });

  it("когда позиций не оказалось, запроса к БД нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildRemovedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  status_changed                                                     */
/* ------------------------------------------------------------------ */

const fromStatus = (id: string, from: "draft" | "picked" | "approved") => ({
  id,
  from,
});

describe("buildStatusChangedEvents", () => {
  it("обычное изменение A → B даёт одно событие", () => {
    const events = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "approved",
      items: [fromStatus("item-1", "draft")],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "status_changed",
    });
  });

  it("переносит from и to", () => {
    const [event] = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "ordered",
      items: [fromStatus("item-1", "picked")],
    });

    expect(event.payload).toMatchObject({ from: "picked", to: "ordered" });
  });

  it("подписи берёт из общего словаря статусов", () => {
    const [event] = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "approved",
      items: [fromStatus("item-1", "draft")],
    });

    // Подписи не дублируются в истории: их источник — SPEC_STATUS_CONFIG,
    // тот же, которым подписан интерфейс.
    expect(event.payload).toMatchObject({
      from_label: SPEC_STATUS_CONFIG.draft.label,
      to_label: SPEC_STATUS_CONFIG.approved.label,
    });
    expect(event.payload?.from_label).not.toBe(event.payload?.to_label);
  });

  it("повторная установка того же статуса события не даёт", () => {
    const events = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "approved",
      items: [fromStatus("item-1", "approved"), fromStatus("item-2", "approved")],
    });

    expect(events).toEqual([]);
  });

  it("из смешанного списка событие получает только изменившаяся позиция", () => {
    const events = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "approved",
      items: [fromStatus("item-1", "approved"), fromStatus("item-2", "draft")],
    });

    expect(events).toHaveLength(1);
    expect(events[0].specItemId).toBe("item-2");
  });

  it("массовое изменение: событие на каждую позицию", () => {
    const events = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "approved",
      items: [
        fromStatus("item-1", "draft"),
        fromStatus("item-2", "picked"),
        fromStatus("item-3", "draft"),
      ],
    });

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.specItemId)).toEqual([
      "item-1",
      "item-2",
      "item-3",
    ]);
  });

  it("массовое изменение помечается batch и batch_size", () => {
    const events = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "approved",
      items: [fromStatus("item-1", "draft"), fromStatus("item-2", "picked")],
    });

    for (const event of events) {
      expect(event.payload).toMatchObject({ batch: true, batch_size: 2 });
    }
  });

  it("одиночное изменение batch не получает", () => {
    const [event] = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "approved",
      items: [fromStatus("item-1", "draft")],
    });

    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("batch_size считает только изменившиеся позиции", () => {
    const events = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "approved",
      items: [
        fromStatus("item-1", "draft"),
        fromStatus("item-2", "picked"),
        fromStatus("item-3", "approved"),
      ],
    });

    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.payload).toMatchObject({ batch_size: 2 });
    }
  });

  it("не дублирует событие при повторном id в списке", () => {
    const events = buildStatusChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      to: "approved",
      items: [fromStatus("item-1", "draft"), fromStatus("item-1", "draft")],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildStatusChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        to: "approved",
        items: [],
      }),
    ).toEqual([]);
  });
});

describe("связка status-билдера и записи", () => {
  it("массовая смена статуса уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildStatusChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        to: "approved",
        items: [fromStatus("item-1", "draft"), fromStatus("item-2", "picked")],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].rows).toHaveLength(2);
  });

  it("когда менять нечего, запроса к БД нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildStatusChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        to: "approved",
        items: [fromStatus("item-1", "approved")],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  price_changed                                                      */
/* ------------------------------------------------------------------ */

const priceChange = (
  id: string,
  from: number | null,
  to: number | null,
): { id: string; from: number | null; to: number | null } => ({
  id,
  from,
  to,
});

describe("buildPriceChangedEvents", () => {
  it("100 → 150 даёт одно событие", () => {
    const events = buildPriceChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [priceChange("item-1", 100, 150)],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "price_changed",
    });
  });

  it("переносит from и to", () => {
    const [event] = buildPriceChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [priceChange("item-1", 100, 150)],
    });

    expect(event.payload).toMatchObject({ from: 100, to: 150 });
  });

  it("указывает валюту", () => {
    const [event] = buildPriceChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [priceChange("item-1", 100, 150)],
    });

    expect(event.payload).toMatchObject({ currency: "RUB" });
  });

  it("поддерживает переход null → 100", () => {
    const events = buildPriceChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [priceChange("item-1", null, 100)],
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ from: null, to: 100 });
  });

  it("поддерживает переход 100 → null", () => {
    const events = buildPriceChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [priceChange("item-1", 100, null)],
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ from: 100, to: null });
  });

  it("100 → 100 события не даёт", () => {
    expect(
      buildPriceChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [priceChange("item-1", 100, 100)],
      }),
    ).toEqual([]);
  });

  it("null → null события не даёт", () => {
    expect(
      buildPriceChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [priceChange("item-1", null, null)],
      }),
    ).toEqual([]);
  });

  it("из смешанного списка событие получает только изменившаяся позиция", () => {
    const events = buildPriceChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [priceChange("item-1", 100, 100), priceChange("item-2", 100, 150)],
    });

    expect(events).toHaveLength(1);
    expect(events[0].specItemId).toBe("item-2");
  });

  it("не дублирует событие при повторном id в списке", () => {
    const events = buildPriceChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [priceChange("item-1", 100, 150), priceChange("item-1", 100, 150)],
    });

    expect(events).toHaveLength(1);
  });

  it("не помечает изменение как групповое: массовой правки цены нет", () => {
    const [event] = buildPriceChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [priceChange("item-1", 100, 150)],
    });

    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildPriceChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [],
      }),
    ).toEqual([]);
  });
});

describe("связка price-билдера и записи", () => {
  it("изменение цены уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildPriceChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [priceChange("item-1", 100, 150)],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("когда цена не изменилась, запроса к БД нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildPriceChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [priceChange("item-1", 100, 100)],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  quantity_changed                                                   */
/* ------------------------------------------------------------------ */

const qtyChange = (id: string, from: number, to: number, unit = "шт") => ({
  id,
  from,
  to,
  unit,
});

describe("buildQuantityChangedEvents", () => {
  it("1 → 2 даёт одно событие", () => {
    const events = buildQuantityChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [qtyChange("item-1", 1, 2)],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "quantity_changed",
    });
  });

  it("переносит from, to и unit", () => {
    const [event] = buildQuantityChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [qtyChange("item-1", 1, 2, "м²")],
    });

    expect(event.payload).toEqual({ from: 1, to: 2, unit: "м²" });
  });

  it("поддерживает уменьшение 2 → 1", () => {
    const [event] = buildQuantityChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [qtyChange("item-1", 2, 1)],
    });

    expect(event.payload).toMatchObject({ from: 2, to: 1 });
  });

  it("1 → 1 события не даёт", () => {
    expect(
      buildQuantityChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [qtyChange("item-1", 1, 1)],
      }),
    ).toEqual([]);
  });

  it("из смешанного списка событие получает только изменившаяся позиция", () => {
    const events = buildQuantityChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [qtyChange("item-1", 2, 2), qtyChange("item-2", 1, 3)],
    });

    expect(events).toHaveLength(1);
    expect(events[0].specItemId).toBe("item-2");
  });

  it("не дублирует событие при повторном id в списке", () => {
    const events = buildQuantityChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [qtyChange("item-1", 1, 2), qtyChange("item-1", 1, 2)],
    });

    expect(events).toHaveLength(1);
  });

  it("не помечает изменение как групповое: массовой правки количества нет", () => {
    const [event] = buildQuantityChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [qtyChange("item-1", 1, 2)],
    });

    expect(event.payload).not.toHaveProperty("batch");
    expect(event.payload).not.toHaveProperty("batch_size");
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildQuantityChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [],
      }),
    ).toEqual([]);
  });
});

describe("связка quantity-билдера и записи", () => {
  it("изменение количества уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildQuantityChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [qtyChange("item-1", 1, 2)],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("когда количество не изменилось, запроса к БД нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildQuantityChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [qtyChange("item-1", 1, 1)],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  supplier_changed                                                   */
/* ------------------------------------------------------------------ */

/** Поставщик в том виде, в каком его отдаёт строка spec_items. */
const supplier = (
  companyId: string | null,
  companyName: string | null,
  contactId: string | null,
  contactName: string | null,
) => ({
  company_id: companyId,
  company_name: companyName,
  contact_id: contactId,
  contact_name: contactName,
});

const SAME_SUPPLIER = supplier("c-a", "Ромашка", "k-x", "Иван");

describe("buildSupplierChangedEvents", () => {
  it("A/X → B/Y даёт одно событие с полными from и to", () => {
    const to = supplier("c-b", "Василёк", "k-y", "Пётр");
    const events = buildSupplierChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-1", from: SAME_SUPPLIER, to }],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "supplier_changed",
      payload: { from: SAME_SUPPLIER, to },
    });
  });

  it("компания и контакт одновременно — это одно событие, а не два", () => {
    const events = buildSupplierChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: SAME_SUPPLIER,
          to: supplier("c-b", "Василёк", "k-y", "Пётр"),
        },
      ],
    });

    // Отдельных company_changed / contact_changed не существует вовсе.
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("supplier_changed");
  });

  it("изменение только компании даёт событие", () => {
    const events = buildSupplierChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: SAME_SUPPLIER,
          to: supplier("c-b", "Василёк", "k-x", "Иван"),
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload?.to).toMatchObject({ company_id: "c-b" });
  });

  it("изменение только контакта даёт событие", () => {
    const events = buildSupplierChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: SAME_SUPPLIER,
          to: supplier("c-a", "Ромашка", "k-y", "Пётр"),
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload?.to).toMatchObject({ contact_id: "k-y" });
  });

  it("смена только имени компании тоже считается изменением", () => {
    // Сравниваются фактические значения, а не наличие company_id: компания та
    // же, но снапшот имени обновился после переименования в справочнике.
    const events = buildSupplierChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: SAME_SUPPLIER,
          to: supplier("c-a", "Ромашка Плюс", "k-x", "Иван"),
        },
      ],
    });

    expect(events).toHaveLength(1);
  });

  it("A/X → A/X события не даёт", () => {
    expect(
      buildSupplierChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ id: "item-1", from: SAME_SUPPLIER, to: SAME_SUPPLIER }],
      }),
    ).toEqual([]);
  });

  it("отсутствующий поставщик передаётся как null", () => {
    const empty = supplier(null, null, null, null);
    const [event] = buildSupplierChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-1", from: empty, to: supplier("c-a", "Ромашка", null, null) }],
    });

    expect(event.payload).toEqual({
      from: { company_id: null, company_name: null, contact_id: null, contact_name: null },
      to: { company_id: "c-a", company_name: "Ромашка", contact_id: null, contact_name: null },
    });
  });

  it("пустая строка имени нормализуется в null и не считается изменением", () => {
    const withEmpty = supplier("c-a", "", "k-x", "");
    expect(
      buildSupplierChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          {
            id: "item-1",
            from: supplier("c-a", null, "k-x", null),
            to: withEmpty,
          },
        ],
      }),
    ).toEqual([]);

    const [event] = buildSupplierChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [{ id: "item-1", from: withEmpty, to: supplier("c-b", "", null, null) }],
    });
    expect(event.payload?.from).toMatchObject({
      company_name: null,
      contact_name: null,
    });
  });

  it("из смешанного списка событие получает только изменившаяся позиция", () => {
    const events = buildSupplierChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        { id: "item-1", from: SAME_SUPPLIER, to: SAME_SUPPLIER },
        {
          id: "item-2",
          from: SAME_SUPPLIER,
          to: supplier("c-b", "Василёк", "k-x", "Иван"),
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0].specItemId).toBe("item-2");
  });

  it("не дублирует событие при повторном id в списке", () => {
    const changed = supplier("c-b", "Василёк", "k-y", "Пётр");
    const events = buildSupplierChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        { id: "item-1", from: SAME_SUPPLIER, to: changed },
        { id: "item-1", from: SAME_SUPPLIER, to: changed },
      ],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildSupplierChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [],
      }),
    ).toEqual([]);
  });
});

describe("связка supplier-билдера и записи", () => {
  it("смена поставщика уходит одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildSupplierChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          {
            id: "item-1",
            from: SAME_SUPPLIER,
            to: supplier("c-b", "Василёк", "k-y", "Пётр"),
          },
        ],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("когда поставщик не изменился, запроса к БД нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildSupplierChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ id: "item-1", from: SAME_SUPPLIER, to: SAME_SUPPLIER }],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  details_changed                                                    */
/* ------------------------------------------------------------------ */

/** Патч деталей в том виде, в каком его собирает action: только изменённые поля. */
const details = (values: Record<string, unknown>) => values;

describe("SPEC_ITEM_DETAIL_FIELDS", () => {
  it("набор полей зафиксирован", () => {
    expect([...SPEC_ITEM_DETAIL_FIELDS]).toEqual([
      "name",
      "brand",
      "article",
      "spec",
      "product_type",
      "product_url",
      "image_url",
      "lead_time",
      "unit",
      "notes",
      "rooms",
      "attrs",
      "stock_pct",
      "client_discount_pct",
    ]);
  });

  it("домены с собственными событиями и служебные поля в список не входят", () => {    const excluded = [
      // свои события
      "status",
      "price",
      "qty",
      "code",
      "company_id",
      "company_name_snapshot",
      "contact_id",
      "contact_name_snapshot",
      // не значение, а состояние или связь
      "parent_id",
      "material_id",
      "is_placeholder",
      "type",
      "supplier_discount_pct",
      "avail",
      // служебные
      "id",
      "org_id",
      "project_id",
      "position",
      "created_at",
      "updated_at",
      "deleted_at",
      "attachments",
      "base_price",
      "cutting_stock",
      "client_discount",
      "supplier_discount",
    ];

    for (const field of excluded) {
      expect(
        SPEC_ITEM_DETAIL_FIELDS as readonly string[],
        `${field} не должен попадать в details_changed`,
      ).not.toContain(field);
    }
  });

  it("каждое поле списка действительно пишется patchToRow", () => {
    // Иначе поле попало бы в контракт события, но патч его никогда не несёт:
    // сравнение `from`/`to` до него бы не дошло.
    const row = patchToRow({
      name: "Стол",
      brand: "Bosch",
      article: "ART-1",
      spec: "дуб",
      product_type: "Столешница",
      product_url: "https://example.com",
      imageUrl: "https://example.com/i.png",
      leadTime: "3 недели",
      unit: "шт",
      notes: "заметка",
      rooms: ["Кухня"],
      attrs: { цвет: "дуб" },
      stockPct: 10,
      clientDiscountPct: 5,
    } as SpecItemPatch);

    for (const field of SPEC_ITEM_DETAIL_FIELDS) {
      expect(row[field], `${field} не пишется patchToRow`).not.toBeUndefined();
    }
  });
});

describe("buildDetailsChangedEvents", () => {
  it("изменение одного поля даёт одно событие с одной записью", () => {
    const events = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: details({ name: "Стол" }),
          to: details({ name: "Стол дубовый" }),
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: "org-1",
      specItemId: "item-1",
      kind: "details_changed",
      payload: { changes: { name: { from: "Стол", to: "Стол дубовый" } } },
    });
  });

  it("изменение двух полей — одно событие с двумя записями", () => {
    const events = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: details({ name: "A", brand: "X" }),
          to: details({ name: "B", brand: "Y" }),
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      changes: {
        name: { from: "A", to: "B" },
        brand: { from: "X", to: "Y" },
      },
    });
  });

  it("итог серии: from — исходное значение, to — последнее", () => {
    // Очередь склеила A → B → C в один патч со значением C (см. тест очереди),
    // а `from` сервер прочитал из БД до записи.
    const [event] = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: details({ name: "A" }),
          to: details({ name: "C" }),
        },
      ],
    });

    expect(event.payload).toEqual({ changes: { name: { from: "A", to: "C" } } });
  });

  it("одинаковое значение события не даёт", () => {
    expect(
      buildDetailsChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          {
            id: "item-1",
            from: details({ name: "Стол", spec: "Дуб" }),
            to: details({ name: "Стол", spec: "Дуб" }),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("неизменившиеся поля не попадают в changes", () => {
    const [event] = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: details({ name: "A", brand: "X", unit: "шт" }),
          to: details({ name: "B", brand: "X", unit: "шт" }),
        },
      ],
    });

    expect(Object.keys(event.payload?.changes as object)).toEqual(["name"]);
  });

  it("пустая строка и null значат одно и то же", () => {
    expect(
      buildDetailsChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          {
            id: "item-1",
            from: details({ brand: null, article: "" }),
            to: details({ brand: "", article: null }),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("переход «не заполнено» → значение и обратно", () => {
    const [cleared] = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: details({ brand: "Bosch" }),
          to: details({ brand: "" }),
        },
      ],
    });
    expect(cleared.payload).toEqual({
      changes: { brand: { from: "Bosch", to: null } },
    });

    const [filled] = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: details({ brand: null }),
          to: details({ brand: "Bosch" }),
        },
      ],
    });
    expect(filled.payload).toEqual({
      changes: { brand: { from: null, to: "Bosch" } },
    });
  });

  it("порядок помещений значением не является", () => {
    expect(
      buildDetailsChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          {
            id: "item-1",
            from: details({ rooms: ["Кухня", "Спальня"] }),
            to: details({ rooms: ["Спальня", "Кухня"] }),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("порядок ключей характеристик значением не является", () => {
    expect(
      buildDetailsChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          {
            id: "item-1",
            from: details({ attrs: { цвет: "дуб", длина: "2 м" } }),
            to: details({ attrs: { длина: "2 м", цвет: "дуб" } }),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("изменение характеристики попадает в changes", () => {
    const [event] = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: details({ attrs: { цвет: "дуб" } }),
          to: details({ attrs: { цвет: "орех" } }),
        },
      ],
    });

    expect(event.payload).toEqual({
      changes: { attrs: { from: { цвет: "дуб" }, to: { цвет: "орех" } } },
    });
  });

  it("числовые поля сравниваются по значению", () => {
    const [event] = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        {
          id: "item-1",
          from: details({ stock_pct: 0, client_discount_pct: 5 }),
          to: details({ stock_pct: 30, client_discount_pct: 5 }),
        },
      ],
    });

    expect(event.payload).toEqual({
      changes: { stock_pct: { from: 0, to: 30 } },
    });
  });

  it("чужие домены в changes не попадают", () => {
    // quantity, price, supplier и status ведут собственные события: даже если
    // такие ключи окажутся в словаре, details_changed их не касается.
    expect(
      buildDetailsChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          {
            id: "item-1",
            from: details({ qty: 1, price: 100, status: "draft", company_id: "c-a" }),
            to: details({ qty: 2, price: 150, status: "picked", company_id: "c-b" }),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("поле, которого нет в патче, не сравнивается", () => {
    expect(
      buildDetailsChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [{ id: "item-1", from: details({}), to: details({}) }],
      }),
    ).toEqual([]);
  });

  it("разные позиции дают разные события", () => {
    const events = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        { id: "item-1", from: details({ name: "A" }), to: details({ name: "B" }) },
        { id: "item-2", from: details({ name: "C" }), to: details({ name: "D" }) },
      ],
    });

    expect(events.map((e) => e.specItemId)).toEqual(["item-1", "item-2"]);
  });

  it("не дублирует событие при повторном id в списке", () => {
    const events = buildDetailsChangedEvents({
      orgId: "org-1",
      actor: CREATED_BY,
      items: [
        { id: "item-1", from: details({ name: "A" }), to: details({ name: "B" }) },
        { id: "item-1", from: details({ name: "A" }), to: details({ name: "B" }) },
      ],
    });

    expect(events).toHaveLength(1);
  });

  it("пустой список не даёт событий", () => {
    expect(
      buildDetailsChangedEvents({ orgId: "org-1", actor: CREATED_BY, items: [] }),
    ).toEqual([]);
  });
});

describe("связка details-билдера и записи", () => {
  it("несколько изменённых полей уходят одним INSERT", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildDetailsChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          {
            id: "item-1",
            from: details({ name: "A", brand: "X" }),
            to: details({ name: "B", brand: "Y" }),
          },
        ],
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("spec_item_events");
    expect(calls[0].rows).toHaveLength(1);
  });

  it("когда значений не изменилось, запроса к БД нет", async () => {
    const { db, calls } = fakeDb();

    await recordSpecItemEvents(
      db,
      buildDetailsChangedEvents({
        orgId: "org-1",
        actor: CREATED_BY,
        items: [
          { id: "item-1", from: details({ name: "A" }), to: details({ name: "A" }) },
        ],
      }),
    );

    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Порядок вызова в actions                                           */
/* ------------------------------------------------------------------ */

/**
 * Действия со спецификацией нельзя импортировать в тест: `lib/auth/session.ts`
 * помечен `server-only` (пакет существует только внутри сборки Next), а сам
 * вызов идёт через service-role клиент. Поэтому инвариант «событие пишется
 * только после успешной мутации» закреплён чтением исходника: у каждого
 * вызова `recordSpecItemEvents` в теле функции обязан быть якорь успеха ВЫШЕ
 * по тексту. Это защита от правки, при которой запись истории уезжает перед
 * проверкой ошибки, — такую ошибку ревью пропускает.
 */
const successAnchors: {
  file: ActionFile;
  fn: string;
  anchor: string;
}[] = [
  {
    file: "specifications",
    fn: "createSpecItems",
    anchor: 'return fail("Не удалось добавить позиции");',
  },
  {
    file: "specifications",
    fn: "createManualSpecItem",
    anchor: 'return fail("Не удалось добавить позицию");',
  },
  {
    file: "specifications",
    fn: "deleteSpecItems",
    anchor: 'return fail("Не удалось удалить");',
  },
  {
    file: "specifications",
    fn: "restoreSpecItems",
    anchor: 'return fail("Не удалось восстановить");',
  },
  {
    file: "specifications",
    fn: "setSpecItemsStatus",
    anchor: 'return fail("Не удалось изменить статус");',
  },
  {
    file: "specifications",
    fn: "setSpecItemPrice",
    anchor: 'return fail("Не удалось изменить цену");',
  },
  {
    file: "specifications",
    fn: "saveSpecItemPatch",
    anchor: 'return fail("Не удалось сохранить изменения");',
  },
  {
    file: "specifications",
    fn: "setSpecItemCode",
    anchor: 'return fail("Не удалось изменить марку");',
  },
  {
    file: "spec-variants",
    fn: "addVariant",
    anchor: 'return fail("Не удалось добавить вариант");',
  },
  {
    file: "spec-variants",
    fn: "switchVariant",
    anchor: 'return fail("Не удалось переключить вариант");',
  },
  {
    file: "spec-variants",
    fn: "updateVariant",
    anchor: 'return fail("Не удалось сохранить вариант");',
  },
  {
    file: "spec-variants",
    fn: "deleteVariant",
    anchor: 'return fail("Не удалось удалить вариант");',
  },
  {
    file: "spec-components",
    fn: "createSpecItemComponent",
    anchor: 'return fail("Не удалось добавить компонент");',
  },
  {
    file: "spec-components",
    fn: "createSpecItemComponentGroup",
    anchor: 'return fail("Не удалось создать группу");',
  },
  {
    file: "spec-components",
    fn: "createSpecItemComponentRef",
    anchor: 'return fail("Не удалось добавить ссылку");',
  },
  {
    file: "spec-components",
    fn: "deleteSpecItemComponent",
    anchor: 'return fail("Не удалось удалить компонент");',
  },
  {
    file: "spec-components",
    fn: "deleteSpecItemComponentGroup",
    anchor: 'return fail("Не удалось удалить группу");',
  },
  {
    file: "spec-components",
    fn: "deleteSpecItemComponentRef",
    anchor: 'return fail("Не удалось удалить ссылку");',
  },
  {
    file: "service-operations",
    fn: "createServiceOperation",
    anchor: "return fail(marked.error);",
  },
  {
    file: "service-operations",
    fn: "updateServiceOperation",
    anchor: 'return fail("Не удалось связать позиции с операцией");',
  },
  {
    file: "service-operations",
    fn: "deleteServiceOperation",
    anchor: 'return fail("Не удалось удалить операцию");',
  },
  {
    file: "materials",
    fn: "addMaterialToProject",
    anchor: "if (!error) {",
  },
];

type ActionFile =
  | "specifications"
  | "materials"
  | "service-operations"
  | "spec-variants"
  | "spec-components";

function sourceOf(file: ActionFile): string {
  return readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      `../../actions/${file}.ts`,
    ),
    "utf8",
  );
}

/** Исходник хука: пометки доменов ставятся там, а не в actions. */
function builderHookSource(): string {
  return readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../hooks/use-spec-builder.ts",
    ),
    "utf8",
  );
}

/** Тело колбэка хука: от `const name = useCallback(` до закрывающей `);`. */
function hookCallbackBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  expect(start, `в хуке нет ${name}`).toBeGreaterThan(-1);

  const end = source.indexOf("\n  );", start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

/**
 * Тело функции верхнего уровня — экспортированной или приватной.
 *
 * Границу берём по `}` в нулевой колонке, а не по следующему `async function`:
 * иначе в срез попадает doc-комментарий следующей функции, и проверка «этот
 * код не упоминает status_changed» ловит чужой текст.
 */
function functionBody(source: string, fn: string): string {
  const exported = source.indexOf(`export async function ${fn}(`);
  const start =
    exported === -1 ? source.indexOf(`\nasync function ${fn}(`) : exported;
  expect(start, `в исходнике нет функции ${fn}`).toBeGreaterThan(-1);

  const end = source.indexOf("\n}", start);
  return end === -1 ? source.slice(start) : source.slice(start, end + 2);
}

describe("история пишется после успешной мутации", () => {
  for (const { file, fn, anchor } of successAnchors) {
    it(`${fn}: запись события идёт после проверки ошибки`, () => {
      const body = functionBody(sourceOf(file), fn);
      const recordAt = body.indexOf("recordSpecItemEvents(");
      const anchorAt = body.lastIndexOf(anchor);

      expect(anchorAt, `якорь «${anchor}» не найден в ${fn}`).toBeGreaterThan(
        -1,
      );
      expect(recordAt, `${fn} не пишет событие`).toBeGreaterThan(-1);
      expect(recordAt).toBeGreaterThan(anchorAt);
    });
  }
});

/**
 * Пути, которые МЕНЯЮТ статус как побочный эффект и намеренно не пишут
 * `status_changed`. Проверка текстовая по той же причине, что и выше, и
 * защищает от «допишу-ка событие сюда» — иначе на одну очистку позиции или
 * одну исполненную доставку в ленте появились бы лишние записи рядом с
 * будущими `cleared` / `filled` / `service_completed`.
 */
describe("status_changed пишет только явная смена статуса", () => {
  it("в specifications.ts единственный производитель — setSpecItemsStatus", () => {
    const source = sourceOf("specifications");
    const producers = [...source.matchAll(/buildStatusChangedEvents\(/g)];

    expect(producers).toHaveLength(1);
    expect(functionBody(source, "setSpecItemsStatus")).toContain(
      "buildStatusChangedEvents(",
    );
  });

  it("общий сейвер патчей статус не логирует", () => {
    // Через saveSpecItemPatch идут очистка позиции и заполнение заглушки:
    // у них свои агрегированные события, а не status_changed.
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");

    expect(body).not.toContain("buildStatusChangedEvents");
    expect(body).not.toContain("status_changed");
  });

  it("исполнение доставки статус не логирует", () => {
    // markLinkedItemsDelivered переводит пачку позиций в delivered; событие
    // остаётся за будущим service_completed, иначе одна доставка дала бы
    // N лишних записей.
    const source = sourceOf("service-operations");

    expect(source).not.toContain("buildStatusChangedEvents");
    expect(source).not.toContain("status_changed");
  });
});

/**
 * Цена — поле материала, и у неё несколько владельцев записи: плоская колонка
 * `spec_items.price`, вариант и составные жесты (создание, заполнение,
 * очистка). Событие должен писать ровно один из них.
 */
describe("price_changed пишет только явная смена цены", () => {
  it("в specifications.ts единственный производитель — setSpecItemPrice", () => {
    const source = sourceOf("specifications");
    const producers = [...source.matchAll(/buildPriceChangedEvents\(/g)];

    expect(producers).toHaveLength(1);
    expect(functionBody(source, "setSpecItemPrice")).toContain(
      "buildPriceChangedEvents(",
    );
  });

  it("общий сейвер патчей цену не логирует", () => {
    // Через saveSpecItemPatch проходят заполнение заглушки и очистка позиции:
    // цена меняется там как побочный эффект и остаётся в filled / cleared.
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");

    expect(body).not.toContain("buildPriceChangedEvents");
    expect(body).not.toContain("price_changed");
  });

  it("варианты цену позиции не логируют", () => {
    // updateVariant пишет только spec_item_variants, switchVariant меняет
    // флаги is_active. Цена spec_items от них не меняется, а зеркалирование
    // в вариант идёт из setSpecItemPrice — второго события быть не должно.
    const source = sourceOf("spec-variants");

    expect(source).not.toContain("buildPriceChangedEvents");
    expect(source).not.toContain("price_changed");
  });
});

/**
 * Количество меняют и явная правка, и составной жест (ручное заполнение
 * заглушки). Оба идут через `saveSpecItemPatch`, поэтому событие разрешено
 * только для патча с пометкой `explicitQuantity`: очередь проставляет её для
 * `incQty` / `setQty` и не проставляет для заполнения.
 */
describe("quantity_changed пишет только явная смена количества", () => {
  it("в specifications.ts единственный производитель — saveSpecItemPatch", () => {
    const source = sourceOf("specifications");
    const producers = [...source.matchAll(/buildQuantityChangedEvents\(/g)];

    expect(producers).toHaveLength(1);
    expect(functionBody(source, "saveSpecItemPatch")).toContain(
      "buildQuantityChangedEvents(",
    );
  });

  it("событие стоит под условием реального изменения", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const guardAt = body.indexOf("quantity.qty !== nextQty");
    const recordAt = body.indexOf("buildQuantityChangedEvents(");

    expect(guardAt, "нет проверки from !== to").toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("снимок количества читается только у помеченного патча", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const gateAt = body.indexOf("options.explicitQuantity");
    const readAt = body.indexOf("quantitySnapshot(");

    // Без пометки — ни лишнего SELECT, ни события: заполнение заглушки
    // остаётся за будущим filled.
    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(gateAt);
  });

  it("варианты количество не логируют", () => {
    // У spec_item_variants нет колонки qty — вариант количество позиции
    // изменить не может, значит и события оттуда быть не должно.
    const source = sourceOf("spec-variants");

    expect(source).not.toContain("buildQuantityChangedEvents");
    expect(source).not.toContain("quantity_changed");
  });
});

/**
 * Поставщик — один домен из четырёх значений, и у него тоже несколько
 * владельцев записи: `spec_items`, вариант позиции и составные жесты. Событие
 * должен писать ровно один из них, и только для явной правки.
 */
describe("supplier_changed пишет только явная смена поставщика", () => {
  it("в specifications.ts единственный производитель — saveSpecItemPatch", () => {
    const source = sourceOf("specifications");
    const producers = [...source.matchAll(/buildSupplierChangedEvents\(/g)];

    expect(producers).toHaveLength(1);
    expect(functionBody(source, "saveSpecItemPatch")).toContain(
      "buildSupplierChangedEvents(",
    );
  });

  it("снимок поставщика читается только у помеченного патча", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const gateAt = body.indexOf("options.explicitSupplier");
    const readAt = body.indexOf("supplierSnapshot(");

    // Без пометки — ни лишнего SELECT, ни события: заполнение заглушки
    // остаётся за будущим filled.
    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(gateAt);
  });

  it("событие стоит под условием наличия снимка", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const guardAt = body.indexOf("if (supplierBefore)");
    const recordAt = body.indexOf("buildSupplierChangedEvents(");

    expect(guardAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("пометку ставит только явная правка поставщика", () => {
    const source = builderHookSource();
    const marks = [...source.matchAll(/explicitSupplier: true/g)];

    // Ровно одна точка: `setSupplier`. Составные жесты (fillPlaceholder,
    // fillManual) пишут те же поля, но без пометки.
    expect(marks).toHaveLength(1);

    const at = source.indexOf("explicitSupplier: true");
    const owner = source.lastIndexOf("const setSupplier", at);
    expect(owner, "пометка стоит не в setSupplier").toBeGreaterThan(-1);
    // Между объявлением и пометкой нет другого объявления — значит пометка
    // действительно принадлежит setSupplier.
    expect([...source.slice(owner, at).matchAll(/\bconst /g)]).toHaveLength(1);
  });

  it("никакой другой action поставщика не логирует", () => {
    for (const file of [
      "materials",
      "spec-variants",
      "spec-components",
      "service-operations",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildSupplierChangedEvents");
    }
  });

  it("варианты поставщика позиции не логируют", () => {
    // updateVariant пишет только spec_item_variants: у варианта свой поставщик,
    // и supplier_changed к нему не относится.
    const source = sourceOf("spec-variants");

    expect(source).not.toContain("supplier_changed");
  });
});

/**
 * Обычные поля меняет и штатная правка, и составные жесты (заполнение заглушки,
 * очистка). Событие разрешено только для несоставного патча — причём составной
 * помечается явно, а не угадывается по набору полей.
 */
describe("details_changed пишет только обычное редактирование", () => {
  it("в specifications.ts единственный производитель — saveSpecItemPatch", () => {
    const source = sourceOf("specifications");
    const producers = [...source.matchAll(/buildDetailsChangedEvents\(/g)];

    expect(producers).toHaveLength(1);
    expect(functionBody(source, "saveSpecItemPatch")).toContain(
      "buildDetailsChangedEvents(",
    );
  });

  it("снимок полей читается только у несоставного патча", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const gateAt = body.indexOf("const fieldEvents = !options.composite;");
    const readAt = body.indexOf("detailsSnapshot(");

    expect(gateAt, "нет общей отсечки составного жеста").toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(gateAt);
  });

  it("составной жест не порождает полевых событий вообще", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");

    // Одна отсечка на все три домена: количество, поставщик и детали.
    for (const marker of [
      "fieldEvents && options.explicitQuantity",
      "fieldEvents && options.explicitSupplier",
      "fieldEvents && detailsTouched.length > 0",
    ]) {
      expect(body, marker).toContain(marker);
    }
  });

  it("событие стоит под условием наличия снимка", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const guardAt = body.indexOf("if (detailsBefore)");
    const recordAt = body.indexOf("buildDetailsChangedEvents(");

    expect(guardAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("составные жесты помечены явно", () => {
    const source = builderHookSource();

    for (const fn of ["fillPlaceholder", "fillManual", "clearContent"]) {
      expect(hookCallbackBody(source, fn), fn).toContain("composite: true");
    }
  });

  it("пометка composite не разошлась по другим правкам", () => {
    // Три жеста плюс отмена очистки. Новый `composite: true` — это осознанное
    // решение, и тест заставляет его подтвердить.
    const marks = [...builderHookSource().matchAll(/composite: true/g)];

    expect(marks).toHaveLength(4);
  });

  it("создание позиции деталей не логирует", () => {
    // Ни один путь создания не проходит через помеченный патч: `created`
    // пишется отдельно, а `buildDetailsChangedEvents` живёт только в
    // saveSpecItemPatch.
    expect(sourceOf("materials")).not.toContain("buildDetailsChangedEvents");
    expect([...sourceOf("specifications").matchAll(/buildDetailsChangedEvents\(/g)])
      .toHaveLength(1);
  });

  it("варианты обычные поля позиции не логируют", () => {
    // Правка варианта пишет spec_item_variants и spec_items не трогает.
    const source = sourceOf("spec-variants");

    expect(source).not.toContain("buildDetailsChangedEvents");
    expect(source).not.toContain("details_changed");
  });
});

/**
 * `filled` — lifecycle-событие составного жеста: заполнение заглушки пишет
 * много полей сразу, но история должна получить одно событие, а полевые
 * события по такому патчу подавлены пометкой `composite`.
 */
describe("filled пишет только заполнение заглушки", () => {
  it("в specifications.ts единственный производитель — saveSpecItemPatch", () => {
    const source = sourceOf("specifications");
    const producers = [...source.matchAll(/buildFilledEvents\(/g)];

    expect(producers).toHaveLength(1);
    expect(functionBody(source, "saveSpecItemPatch")).toContain(
      "buildFilledEvents(",
    );
  });

  it("заполнение требует, чтобы позиция была заглушкой", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const guardAt = body.indexOf("contentBefore?.is_placeholder === true");
    const recordAt = body.indexOf("buildFilledEvents(");

    expect(guardAt, "нет условия «была заглушка»").toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("оба заполнения помечают происхождение и составной жест", () => {
    const source = builderHookSource();

    expect(hookCallbackBody(source, "fillPlaceholder")).toContain(
      '{ composite: true, fillOrigin: "placeholder" }',
    );
    expect(hookCallbackBody(source, "fillManual")).toContain(
      '{ composite: true, fillOrigin: "manual" }',
    );
  });

  it("заполнение не ходит в действия статуса и цены", () => {
    // Их события пишутся отдельными действиями, а не патчем: заполнение их не
    // вызывает, значит price_changed и status_changed из него не появятся.
    const source = builderHookSource();

    for (const fn of ["fillPlaceholder", "fillManual"]) {
      const body = hookCallbackBody(source, fn);
      expect(body, fn).not.toContain("setSpecItemsStatus");
      expect(body, fn).not.toContain("setSpecItemPrice");
    }
  });

  it("полевые события по составному патчу подавлены одной отсечкой", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");

    // details_changed, quantity_changed и supplier_changed живут за `fieldEvents`,
    // а `composite` снимает её целиком — второй эвристики не нужно.
    expect(body).toContain("const fieldEvents = !options.composite;");
    for (const marker of [
      "fieldEvents && options.explicitQuantity",
      "fieldEvents && options.explicitSupplier",
      "fieldEvents && detailsTouched.length > 0",
    ]) {
      expect(body, marker).toContain(marker);
    }
  });
});

/**
 * `cleared` — второй lifecycle-жест той же природы: очистка одним действием.
 * Условие «позиция была заполнена» берётся из серверного снимка до UPDATE,
 * поэтому повторный вызов, уже пустая и удалённая позиция события не дают.
 */
describe("cleared пишет только настоящую очистку", () => {
  it("в specifications.ts единственный производитель — saveSpecItemPatch", () => {
    const source = sourceOf("specifications");
    const producers = [...source.matchAll(/buildClearedEvents\(/g)];

    expect(producers).toHaveLength(1);
    expect(functionBody(source, "saveSpecItemPatch")).toContain(
      "buildClearedEvents(",
    );
  });

  it("снимок читается и для заполнения, и для очистки", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const gateAt = body.indexOf("options.fillOrigin || options.cleared");
    const readAt = body.indexOf("contentSnapshot(");

    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(gateAt);
  });

  it("очистка требует, чтобы позиция была заполнена", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const guardAt = body.indexOf(
      "options.cleared && contentBefore?.is_placeholder === false",
    );
    const recordAt = body.indexOf("buildClearedEvents(");

    // Уже пустая заглушка и повторный вызов: is_placeholder === true — очищать
    // нечего, события нет.
    expect(guardAt, "нет условия «была заполнена»").toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("заполнение требует, чтобы позиция стала не-заглушкой", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");

    // Ключ к отмене очистки: она возвращает `isPlaceholder: true`, если
    // очищали пустую заглушку, — тогда заполнением это не считается.
    expect(body).toContain("row.is_placeholder === false");
  });

  it("очистка и отмена помечены по-разному", () => {
    const body = hookCallbackBody(builderHookSource(), "clearContent");

    expect(body).toContain("{ composite: true, cleared: true }");
    expect(body).toContain('{ composite: true, fillOrigin: "undo" }');
  });

  it("очистка не ходит в действия статуса и цены", () => {
    const body = hookCallbackBody(builderHookSource(), "clearContent");

    // Их события пишутся отдельными действиями: патч очистки содержит
    // `price: 0` и `status: "draft"`, но событий из него не будет.
    expect(body).not.toContain("setSpecItemsStatus");
    expect(body).not.toContain("setSpecItemPrice");
  });

  it("никакой другой action очистку не логирует", () => {
    for (const file of [
      "materials",
      "spec-variants",
      "spec-components",
      "service-operations",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildClearedEvents");
    }
  });
});

/**
 * Марка меняется своим RPC, а не патчем: её уникальность и обмен проверяются в
 * БД. Событие поэтому живёт в отдельном действии, а не в `saveSpecItemPatch`.
 */
describe("code_changed пишет только смена марки", () => {
  it("единственный производитель — setSpecItemCode", () => {
    const source = sourceOf("specifications");
    const producers = [...source.matchAll(/buildCodeChangedEvents\(/g)];

    expect(producers).toHaveLength(1);
    expect(functionBody(source, "setSpecItemCode")).toContain(
      "buildCodeChangedEvents(",
    );
  });

  it("общий сейвер патчей марку не логирует", () => {
    // `code` остаётся отдельным mutation path: через патч марка не меняется,
    // и своего события там быть не должно.
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");

    expect(body).not.toContain("buildCodeChangedEvents");
    expect(body).not.toContain("code_changed");
  });

  it("прежняя марка читается из БД до mutation", () => {
    const body = functionBody(sourceOf("specifications"), "setSpecItemCode");
    const readAt = body.indexOf('.select("id, code")');
    const mutationAt = body.indexOf('callRpc(c.supabase, "set_spec_item_code"');

    expect(readAt).toBeGreaterThan(-1);
    expect(mutationAt).toBeGreaterThan(readAt);
  });

  it("снимок ограничен организацией, проектом и неудалённой позицией", () => {
    const body = functionBody(sourceOf("specifications"), "setSpecItemCode");

    // Чужая или удалённая позиция в снимок не попадает — и события не будет.
    for (const filter of [
      '.eq("org_id", c.orgId)',
      '.eq("project_id", projectId)',
      '.is("deleted_at", null)',
    ]) {
      expect(body, filter).toContain(filter);
    }
  });

  it("событие пишется после успешной mutation", () => {
    const body = functionBody(sourceOf("specifications"), "setSpecItemCode");
    const failAt = body.lastIndexOf('return fail("Не удалось изменить марку")');
    const guardAt = body.indexOf('return fail("Пустой ответ сервера")');
    const recordAt = body.indexOf("buildCodeChangedEvents(");

    expect(failAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(failAt);
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("обмен пишет событие и второй позиции", () => {
    const body = functionBody(sourceOf("specifications"), "setSpecItemCode");

    // Без этого в истории занявшей позиции смена марки не отразилась бы.
    expect(body).toContain('row.result === "swapped"');
    expect(body).toContain("row.swapped_id");
  });

  it("другие actions марку не логируют", () => {
    for (const file of [
      "materials",
      "spec-variants",
      "spec-components",
      "service-operations",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildCodeChangedEvents");
      expect(sourceOf(file), file).not.toContain("code_changed");
    }
  });
});

/**
 * `parent_id` — связь, а не значение: её меняет отдельный жест «В состав…».
 * Событие живёт в общем сейвере, но в полевое `details_changed` поле не
 * попадает, а составные жесты родителя не трогают вовсе.
 */
describe("parent_changed пишет только смена родителя", () => {
  it("единственный производитель — saveSpecItemPatch", () => {
    const source = sourceOf("specifications");
    const producers = [...source.matchAll(/buildParentChangedEvents\(/g)];

    expect(producers).toHaveLength(1);
    expect(functionBody(source, "saveSpecItemPatch")).toContain(
      "buildParentChangedEvents(",
    );
  });

  it("родителя нет среди полей details_changed", () => {
    // Иначе смена родителя давала бы ещё и details_changed.
    expect(SPEC_ITEM_DETAIL_FIELDS as readonly string[]).not.toContain(
      "parent_id",
    );
  });

  it("снимок родителя читается только когда патч несёт parent_id", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const gateAt = body.indexOf("row.parent_id !== undefined");
    const readAt = body.indexOf("parentChangeSnapshot(");

    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(gateAt);
  });

  it("новый родитель проверяется до mutation", () => {
    const body = functionBody(sourceOf("specifications"), "saveSpecItemPatch");
    const guardAt = body.indexOf("if (parentChange && !parentChange.ok)");
    const updateAt = body.indexOf('.update({ ...row, updated_at');

    // Недоступный или чужой родитель — mutation не проходит вовсе.
    expect(guardAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(guardAt);
  });

  it("проверка родителя ограничена организацией, проектом и удалением", () => {
    const body = functionBody(sourceOf("specifications"), "parentChangeSnapshot");

    for (const filter of [
      '.eq("project_id", projectId)',
      '.eq("org_id", orgId)',
      "deleted",
    ]) {
      expect(body, filter).toContain(filter);
    }
  });

  it("смена родителя не трогает другие поля позиции", () => {
    // Ни position, ни status, ни что-либо ещё: патч несёт только parent_id.
    expect(patchToRow({ parentId: "p-a" })).toEqual({ parent_id: "p-a" });
    expect(patchToRow({ parentId: null })).toEqual({ parent_id: null });
  });

  it("составные жесты родителя не трогают", () => {
    // Поэтому отдельной пометки для parent_changed не нужно: поле пишет ровно
    // один путь.
    const source = builderHookSource();

    for (const fn of ["fillPlaceholder", "fillManual", "clearContent"]) {
      expect(hookCallbackBody(source, fn), fn).not.toContain("parentId");
    }
  });

  it("никакой другой action иерархию не логирует", () => {
    for (const file of [
      "materials",
      "spec-variants",
      "spec-components",
      "service-operations",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildParentChangedEvents");
    }
  });
});

/**
 * Вариант — отдельная таблица со своим owner'ом: добавление живёт в
 * `addVariant` (actions/spec-variants.ts), а не в патч-пути позиции.
 */
describe("variant_added пишет только добавление варианта", () => {
  it("единственный производитель — addVariant", () => {
    const source = sourceOf("spec-variants");

    expect([...source.matchAll(/buildVariantAddedEvents\(/g)]).toHaveLength(1);
    expect(functionBody(source, "addVariant")).toContain(
      "buildVariantAddedEvents(",
    );
  });

  it("в патч-пути позиции вариантов нет", () => {
    const source = sourceOf("specifications");

    expect(source).not.toContain("buildVariantAddedEvents");
    expect(source).not.toContain("variant_added");
  });

  it("снимок берётся из вернувшейся строки, а не из аргумента", () => {
    const body = functionBody(sourceOf("spec-variants"), "addVariant");
    const insertAt = body.indexOf('.select("id, label")');
    const recordAt = body.indexOf("buildVariantAddedEvents(");

    expect(insertAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(insertAt);
    expect(body).toContain("label: data.label");
  });

  it("событие пишется после проверки ошибки вставки", () => {
    const body = functionBody(sourceOf("spec-variants"), "addVariant");
    const failAt = body.indexOf('return fail("Не удалось добавить вариант")');
    const recordAt = body.indexOf("buildVariantAddedEvents(");

    expect(failAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(failAt);
  });

  it("отказ снимка «Основной» выходит до вставки", () => {
    const body = functionBody(sourceOf("spec-variants"), "addVariant");
    const baseAt = body.indexOf("if (!base.success) return base;");
    const insertAt = body.indexOf('.insert({');

    // Вариант не создан — и события нет.
    expect(baseAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(baseAt);
  });

  it("контекст вариантов отдаёт актора для истории", () => {
    const body = functionBody(sourceOf("spec-variants"), "assertSpecItem");

    expect(body).toContain("userId: ctx.userId");
    expect(body).toContain("user: ctx.user,");
  });
});

/**
 * Переключение активного варианта — своя mutation (`switchVariant`), не патч
 * позиции, поэтому и событие живёт там же.
 */
describe("variant_switched пишет только переключение варианта", () => {
  it("единственный производитель — switchVariant", () => {
    const source = sourceOf("spec-variants");

    expect([...source.matchAll(/buildVariantSwitchedEvents\(/g)]).toHaveLength(1);
    expect(functionBody(source, "switchVariant")).toContain(
      "buildVariantSwitchedEvents(",
    );
  });

  it("в патч-пути позиции переключения нет", () => {
    const source = sourceOf("specifications");

    expect(source).not.toContain("buildVariantSwitchedEvents");
    expect(source).not.toContain("variant_switched");
  });

  it("прежний активный вариант читается до mutation", () => {
    const body = functionBody(sourceOf("spec-variants"), "switchVariant");
    const readAt = body.indexOf('.select("id, name, is_active")');
    const mutationAt = body.indexOf(".update({ is_active: false })");

    expect(readAt).toBeGreaterThan(-1);
    expect(mutationAt).toBeGreaterThan(readAt);
  });

  it("целевой вариант проверяется до mutation", () => {
    const body = functionBody(sourceOf("spec-variants"), "switchVariant");
    const guardAt = body.indexOf('if (!target) return fail("Вариант не найден")');
    const mutationAt = body.indexOf(".update({ is_active: false })");

    // Иначе первый UPDATE снял бы активность со всех и позиция осталась бы без
    // активного варианта.
    expect(guardAt).toBeGreaterThan(-1);
    expect(mutationAt).toBeGreaterThan(guardAt);
  });

  it("переключение на текущий вариант события не пишет", () => {
    const body = functionBody(sourceOf("spec-variants"), "switchVariant");
    const guardAt = body.indexOf("if (active?.id !== target.id)");
    const recordAt = body.indexOf("buildVariantSwitchedEvents(");

    expect(guardAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("событие пишется только после успешной mutation", () => {
    const body = functionBody(sourceOf("spec-variants"), "switchVariant");
    const activatedAt = body.indexOf("(activated ?? []).length !== 1");

    // Если вариант исчез между чтением и записью, активного не осталось ни у
    // кого — событие не пишется.
    expect(activatedAt).toBeGreaterThan(-1);
    expect(body.indexOf("buildVariantSwitchedEvents(")).toBeGreaterThan(
      activatedAt,
    );
  });

  it("другие actions переключение не логируют", () => {
    for (const file of [
      "materials",
      "spec-components",
      "service-operations",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildVariantSwitchedEvents");
    }
  });
});

/**
 * Правка данных варианта — своя mutation (`updateVariant`), не патч позиции:
 * она пишет `spec_item_variants`, а `details_changed` описывает только колонки
 * `spec_items`. Через ту же mutation проходят ещё два внутренних пути, поэтому
 * событие разрешено только для явной правки — её называет клиент (`origin`).
 */
describe("variant_updated пишет только явная правка варианта", () => {
  it("единственный производитель — updateVariant", () => {
    const source = sourceOf("spec-variants");

    expect([...source.matchAll(/buildVariantUpdatedEvents\(/g)]).toHaveLength(1);
    expect(functionBody(source, "updateVariant")).toContain(
      "buildVariantUpdatedEvents(",
    );
  });

  it("в патч-пути позиции правки варианта нет", () => {
    // `details_changed` относится к spec_items, и переносить в него поля
    // варианта нельзя: это разные таблицы и разные владельцы записи.
    const source = sourceOf("specifications");

    expect(source).not.toContain("buildVariantUpdatedEvents");
    expect(source).not.toContain("variant_updated");
  });

  it("прежние значения читаются из БД до mutation", () => {
    const body = functionBody(sourceOf("spec-variants"), "updateVariant");
    const readAt = body.indexOf("if (withHistory) {");
    const mutationAt = body.indexOf(".update({ ...parsed.data");

    expect(readAt, "нет чтения прежней строки").toBeGreaterThan(-1);
    expect(mutationAt).toBeGreaterThan(readAt);
  });

  it("чтение прежней строки проверяет принадлежность позиции и организации", () => {
    const body = functionBody(sourceOf("spec-variants"), "updateVariant");
    const readBlock = body.slice(
      body.indexOf("if (withHistory) {"),
      body.indexOf("if (withHistory && before)"),
    );

    // Вариант другой позиции или другой организации в этот SELECT не попадёт —
    // значит не будет ни mutation, ни события.
    expect(readBlock).toContain(".eq(\"spec_item_id\", specItemId)");
    expect(readBlock).toContain(".eq(\"org_id\", ctx.orgId)");
    expect(readBlock).toContain('if (!data) return fail("Вариант не найден")');
  });

  it("to берётся из применённой строки, а не из патча клиента", () => {
    const body = functionBody(sourceOf("spec-variants"), "updateVariant");
    const mutationAt = body.indexOf(".update({ ...parsed.data");

    expect(mutationAt).toBeGreaterThan(-1);
    expect(body.slice(mutationAt)).toContain('.select("*")');
    expect(body).toContain("from: before");
    expect(body).toContain("to: after");
  });

  it("событие стоит под условием явной правки", () => {
    const body = functionBody(sourceOf("spec-variants"), "updateVariant");
    const gateAt = body.indexOf('const withHistory = origin === "edit";');
    const guardAt = body.indexOf("if (withHistory && before)");
    const recordAt = body.indexOf("buildVariantUpdatedEvents(");

    expect(gateAt, "нет отсечки по происхождению").toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(gateAt);
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("исчезнувший между чтением и записью вариант события не даёт", () => {
    const body = functionBody(sourceOf("spec-variants"), "updateVariant");
    const appliedAt = body.indexOf("const after = (applied ?? [])[0];");
    const recordAt = body.indexOf("buildVariantUpdatedEvents(");

    expect(appliedAt).toBeGreaterThan(-1);
    expect(body.slice(appliedAt, recordAt)).toContain('if (!after) return fail');
  });

  it("происхождение обязательно на обоих концах: и в action, и в хуке", () => {
    for (const source of [sourceOf("spec-variants"), builderHookSource()]) {
      // Умолчание молча решало бы за вызывающего, писать ли историю: патч
      // правки варианта и патч зеркалирования неотличимы.
      expect(source).not.toContain("SpecVariantUpdateOrigin =");
      expect(source).toContain("origin: SpecVariantUpdateOrigin,");
    }
  });

  it("внутренние пути помечены: два заполнения и одно зеркалирование", () => {
    const source = builderHookSource();

    // Заполнение только что созданного варианта — вторая половина жеста
    // `addVariant`, отдельного события у неё нет.
    expect([...source.matchAll(/"create",\s*\)/g)]).toHaveLength(2);
    // Зеркалирование полей позиции в активный вариант: те же поля уже описаны
    // событиями самой позиции.
    expect([...source.matchAll(/"mirror"\)/g)]).toHaveLength(1);
    expect(source).toContain('updateVariantLocal(id, active.id, material, "mirror")');
  });

  it("явную правку помечает только форма варианта", () => {
    const source = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../components/spec-builder/spec-builder.tsx",
      ),
      "utf8",
    );

    // Три точки: переключатель вкладки обзора (мёртвый канал onUpdateVariant) и
    // две кнопки формы редактирования варианта.
    expect([...source.matchAll(/"edit",?\s*\)/g)]).toHaveLength(3);
    // Хук сам такую пометку не ставит — иначе «edit» по умолчанию вернулся бы
    // через чёрный ход.
    expect([...builderHookSource().matchAll(/"edit",?\s*\)/g)]).toHaveLength(0);
  });

  it("никакой другой action вариант не правит и правку не логирует", () => {
    for (const file of [
      "materials",
      "spec-components",
      "service-operations",
      "specifications",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("updateVariant(");
      expect(sourceOf(file), file).not.toContain("buildVariantUpdatedEvents");
    }
  });
});

/**
 * Удаление варианта — своя mutation (`deleteVariant`), и она же владелец
 * `variant_removed`. Строка исчезает физически, поэтому снимок берётся из самой
 * удаляемой записи, а не из входных данных клиента.
 */
describe("variant_removed пишет только удаление варианта", () => {
  it("единственный производитель — deleteVariant", () => {
    const source = sourceOf("spec-variants");

    expect([...source.matchAll(/buildVariantRemovedEvents\(/g)]).toHaveLength(1);
    expect(functionBody(source, "deleteVariant")).toContain(
      "buildVariantRemovedEvents(",
    );
  });

  it("в патч-пути позиции удаления варианта нет", () => {
    const source = sourceOf("specifications");

    expect(source).not.toContain("buildVariantRemovedEvents");
    expect(source).not.toContain("variant_removed");
  });

  it("снимок берётся из удалённой строки, а не из аргументов клиента", () => {
    const body = functionBody(sourceOf("spec-variants"), "deleteVariant");
    const selectAt = body.indexOf('.select("id, name, label, is_active")');

    // `.select()` на DELETE — это и есть снимок: отдельного SELECT до удаления
    // не нужно, а имя/подпись/активность не приходят с клиента.
    expect(selectAt, "DELETE не возвращает удалённую строку").toBeGreaterThan(-1);
    expect(body).toContain("name: snapshot.name");
    expect(body).toContain("label: snapshot.label");
    expect(body).toContain("wasActive: snapshot.is_active");
  });

  it("нулевой DELETE не даёт ни события, ни переназначения", () => {
    const body = functionBody(sourceOf("spec-variants"), "deleteVariant");
    const guardAt = body.indexOf("if (!snapshot) return fail");
    const recordAt = body.indexOf("buildVariantRemovedEvents(");

    expect(guardAt, "нет проверки «строка действительно удалена»").toBeGreaterThan(
      -1,
    );
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("чужой вариант отсекается условиями DELETE", () => {
    const body = functionBody(sourceOf("spec-variants"), "deleteVariant");
    const deleteAt = body.indexOf(".delete()");
    const block = body.slice(deleteAt, body.indexOf('if (error) {', deleteAt));

    // Вариант другой позиции или другой организации в этот DELETE не попадёт —
    // значит удалять нечего и логировать нечего.
    expect(block).toContain('.eq("id", variantId)');
    expect(block).toContain('.eq("spec_item_id", specItemId)');
    expect(block).toContain('.eq("org_id", ctx.orgId)');
  });

  it("последний вариант защищён до mutation", () => {
    const body = functionBody(sourceOf("spec-variants"), "deleteVariant");
    const guardAt = body.indexOf('return fail("Нельзя удалить последний вариант")');
    const deleteAt = body.indexOf(".delete()");

    // Бизнес-правило не менялось: у позиции всегда остаётся активный вариант,
    // поэтому события у такого удаления быть не может — его и не происходит.
    expect(guardAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(guardAt);
  });

  it("несуществующий вариант отсекается до записи события", () => {
    const body = functionBody(sourceOf("spec-variants"), "deleteVariant");
    const failAt = body.indexOf('return fail("Вариант не найден")');
    const recordAt = body.indexOf("buildVariantRemovedEvents(");

    expect(failAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(failAt);
  });

  it("удаление активного варианта не пишет variant_switched", () => {
    const body = functionBody(sourceOf("spec-variants"), "deleteVariant");

    // Преемник выбирается не пользователем, а сервером — как техническое
    // следствие удаления. Поэтому отдельного события переключения нет, а факт
    // уходит в payload удаления.
    expect(body).not.toContain("buildVariantSwitchedEvents");
    expect(body).not.toContain("variant_switched");
    expect(body).toContain("nextActive = { variantId: next.id, name: next.name }");
  });

  it("преемник записывается только при успешном назначении", () => {
    const body = functionBody(sourceOf("spec-variants"), "deleteVariant");
    const activatedAt = body.indexOf("(activated ?? []).length === 1");
    const recordAt = body.indexOf("buildVariantRemovedEvents(");

    // Иначе, если UPDATE не прошёл, payload утверждал бы, что материал позиции
    // сменился, хотя активного варианта не осталось вовсе.
    expect(activatedAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(activatedAt);
  });

  it("группового удаления нет: ни batch-полей, ни второго id", () => {
    const body = functionBody(sourceOf("spec-variants"), "deleteVariant");

    expect(body).not.toContain("batch");
    expect(body).not.toContain("variantIds");
    // Один вызов — один вариант: интерфейс удаляет вариант по одному.
    expect(builderHookSource()).toContain(
      "await deleteVariant(orgSlug, itemId, variantId)",
    );
  });

  it("никакой другой action удаление варианта не логирует", () => {
    for (const file of [
      "materials",
      "spec-components",
      "service-operations",
      "specifications",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildVariantRemovedEvents");
    }
  });
});

/**
 * Состав позиции — отдельная таблица `spec_item_components` со своими
 * mutation: у добавления их три (компонент, группа, ссылка), и каждая создаёт
 * ровно одну строку. Все три и есть владельцы `component_added`.
 */
describe("component_added пишет только добавление строки состава", () => {
  const CREATE_FNS = [
    "createSpecItemComponent",
    "createSpecItemComponentGroup",
    "createSpecItemComponentRef",
  ];

  /** Функции состава, которые строку не создают: события у них быть не должно. */
  const NON_CREATE_FNS = [
    "updateSpecItemComponent",
    "deleteSpecItemComponent",
    "moveSpecItemComponent",
    "updateSpecItemComponentGroup",
    "deleteSpecItemComponentGroup",
    "updateSpecItemComponentRef",
    "deleteSpecItemComponentRef",
  ];

  it("владельцы — три создания строки состава", () => {
    const source = sourceOf("spec-components");

    expect([...source.matchAll(/buildComponentAddedEvents\(/g)]).toHaveLength(3);
    for (const fn of CREATE_FNS) {
      expect(functionBody(source, fn), fn).toContain("buildComponentAddedEvents(");
    }
  });

  it("обновление, перемещение и удаление строк события не пишут", () => {
    // Иначе правка состава выглядела бы в истории как добавление.
    const source = sourceOf("spec-components");

    for (const fn of NON_CREATE_FNS) {
      expect(functionBody(source, fn), fn).not.toContain(
        "buildComponentAddedEvents",
      );
    }
  });

  it("в патч-пути позиции состава нет", () => {
    const source = sourceOf("specifications");

    expect(source).not.toContain("buildComponentAddedEvents");
    expect(source).not.toContain("component_added");
  });

  it("снимок берётся из вернувшейся строки, а не из ввода клиента", () => {
    const source = sourceOf("spec-components");

    for (const fn of CREATE_FNS) {
      const body = functionBody(source, fn);
      const insertAt = body.indexOf(".insert({");
      const recordAt = body.indexOf("buildComponentAddedEvents(");

      // Вернувшаяся из INSERT строка — единственный источник id и названия.
      expect(insertAt, fn).toBeGreaterThan(-1);
      expect(recordAt, fn).toBeGreaterThan(insertAt);
      expect(body, fn).toContain("componentId: data.id");
      expect(body, fn).toContain("name: data.name");
    }
  });

  it("подпись ссылки читается из БД, а не из входных данных", () => {
    const body = functionBody(sourceOf("spec-components"), "createSpecItemComponentRef");

    expect(body).toContain("specItemId: target.ref.id");
    expect(body).toContain("code: target.ref.code");
    expect(body).toContain("name: target.ref.name");
  });

  it("проверки доступа и принадлежности стоят до вставки и до события", () => {
    const source = sourceOf("spec-components");

    for (const fn of CREATE_FNS) {
      const body = functionBody(source, fn);
      const assertAt = body.indexOf("assertSpecItemInProject(");
      const insertAt = body.indexOf(".insert({");
      const recordAt = body.indexOf("buildComponentAddedEvents(");

      // Чужая или несуществующая позиция выходит раньше вставки — значит
      // события от такого вызова не будет.
      expect(assertAt, fn).toBeGreaterThan(-1);
      expect(insertAt, fn).toBeGreaterThan(assertAt);
      expect(recordAt, fn).toBeGreaterThan(insertAt);
    }
  });

  it("повторная ссылка в тот же контейнер события не даёт", () => {
    const body = functionBody(sourceOf("spec-components"), "createSpecItemComponentRef");
    const duplicateAt = body.indexOf("assertNoDuplicateSpecRef(");
    const insertAt = body.indexOf(".insert({");

    // Защита от дублей у ссылок есть (в отличие от компонентов и групп), и она
    // стоит до вставки: при отказе строка не создаётся и события нет.
    expect(duplicateAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(duplicateAt);
  });

  it("batch-полей нет: каждая форма добавляет одну строку", () => {
    const source = sourceOf("spec-components");

    for (const fn of CREATE_FNS) {
      expect(functionBody(source, fn), fn).not.toContain("batch");
    }
  });

  it("никакой другой action состав не логирует", () => {
    for (const file of [
      "materials",
      "service-operations",
      "spec-variants",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildComponentAddedEvents");
    }
  });
});

/**
 * Удаление строки состава — свои mutation (по одной на каждый вид строки), и
 * они же владельцы `component_removed`. Строка исчезает физически, поэтому
 * снимок берётся из удаляемой записи, а не отдельным чтением.
 */
describe("component_removed пишет только удаление строки состава", () => {
  const DELETE_FNS = [
    "deleteSpecItemComponent",
    "deleteSpecItemComponentGroup",
    "deleteSpecItemComponentRef",
  ];

  /** Создание и правка строк: события удаления у них быть не должно. */
  const NON_DELETE_FNS = [
    "createSpecItemComponent",
    "createSpecItemComponentGroup",
    "createSpecItemComponentRef",
    "updateSpecItemComponent",
    "moveSpecItemComponent",
    "updateSpecItemComponentGroup",
    "updateSpecItemComponentRef",
  ];

  it("владельцы — три удаления строки состава", () => {
    const source = sourceOf("spec-components");

    expect([...source.matchAll(/buildComponentRemovedEvents\(/g)]).toHaveLength(3);
    for (const fn of DELETE_FNS) {
      expect(functionBody(source, fn), fn).toContain(
        "buildComponentRemovedEvents(",
      );
    }
  });

  it("создание, правка и перемещение строк удаления не логируют", () => {
    const source = sourceOf("spec-components");

    for (const fn of NON_DELETE_FNS) {
      expect(functionBody(source, fn), fn).not.toContain(
        "buildComponentRemovedEvents",
      );
    }
  });

  it("в патч-пути позиции состава нет", () => {
    const source = sourceOf("specifications");

    expect(source).not.toContain("buildComponentRemovedEvents");
    expect(source).not.toContain("component_removed");
  });

  it("снимок берётся из удалённой строки, а не отдельным чтением", () => {
    const source = sourceOf("spec-components");

    for (const fn of DELETE_FNS) {
      const body = functionBody(source, fn);
      const deleteAt = body.indexOf(".delete()");
      const guardAt = body.indexOf("if (error) {", deleteAt);
      const chain = body.slice(deleteAt, guardAt);

      // `.select(ROW_COLUMNS)` в самой цепочке DELETE — это и есть снимок.
      expect(deleteAt, fn).toBeGreaterThan(-1);
      expect(chain, fn).toContain(".select(ROW_COLUMNS)");
      expect(body, fn).toContain("componentId: snapshot.id");
      expect(body, fn).toContain("name: snapshot.name");
    }
  });

  it("удалять нечего — ни события, ни подмены результата", () => {
    const source = sourceOf("spec-components");

    for (const fn of DELETE_FNS) {
      const body = functionBody(source, fn);
      const guardAt = body.indexOf("if (!snapshot) return fail");
      const recordAt = body.indexOf("buildComponentRemovedEvents(");

      // Чужая, уже удалённая или несуществующая строка: DELETE не тронул ни
      // одной строки, значит и события нет.
      expect(guardAt, fn).toBeGreaterThan(-1);
      expect(recordAt, fn).toBeGreaterThan(guardAt);
    }
  });

  it("подпись ссылки читается из БД после удаления строки", () => {
    const body = functionBody(
      sourceOf("spec-components"),
      "deleteSpecItemComponentRef",
    );

    expect(body).toContain("hydrateRefItems(base.c, [toClientRow(snapshot)])");
    expect(body).toContain("code: refView?.available ? refView.code : null");
    expect(body).toContain("name: refView?.available ? refView.name : null");
  });

  it("группу с элементами не удаляют: каскад дочерних строк недостижим", () => {
    const body = functionBody(
      sourceOf("spec-components"),
      "deleteSpecItemComponentGroup",
    );
    const guardAt = body.indexOf("Нельзя удалить группу");
    const deleteAt = body.indexOf(".delete()");

    // FK `parent_component_id` объявлен с ON DELETE CASCADE, но action до него
    // не доводит: непустая группа отклоняется до DELETE, поэтому одно действие
    // физически удаляет ровно одну строку и снимков «потерять» нельзя.
    expect(guardAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(guardAt);
  });

  it("batch-полей нет: каждая mutation удаляет одну строку", () => {
    const source = sourceOf("spec-components");

    for (const fn of DELETE_FNS) {
      const body = functionBody(source, fn);
      expect(body, fn).not.toContain("batch");
      expect(body, fn).not.toContain(".in("); // массового удаления нет
    }
  });

  it("никакой другой action удаление состава не логирует", () => {
    for (const file of [
      "materials",
      "service-operations",
      "spec-variants",
      "specifications",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildComponentRemovedEvents");
    }
  });
});

/**
 * Сервисная операция принадлежит проекту, а связь с позициями — многие ко
 * многим. Владелец события — единственное создание операции.
 */
describe("service_added пишет только создание операции", () => {
  it("единственный производитель — createServiceOperation", () => {
    const source = sourceOf("service-operations");

    expect([...source.matchAll(/buildServiceAddedEvents\(/g)]).toHaveLength(1);
    expect(functionBody(source, "createServiceOperation")).toContain(
      "buildServiceAddedEvents(",
    );
  });

  it("правка и удаление операции события не пишут", () => {
    const source = sourceOf("service-operations");

    for (const fn of ["updateServiceOperation", "deleteServiceOperation"]) {
      expect(functionBody(source, fn), fn).not.toContain(
        "buildServiceAddedEvents",
      );
    }
  });

  it("в патч-пути позиции услуг нет", () => {
    const source = sourceOf("specifications");

    expect(source).not.toContain("buildServiceAddedEvents");
    expect(source).not.toContain("service_added");
  });

  it("снимок берётся из вернувшейся строки, а не из входных данных", () => {
    const body = functionBody(sourceOf("service-operations"), "createServiceOperation");

    // `created` — строка, которую вернул INSERT: id, тип, название и сумма
    // берутся из неё, а не из `d` (данных клиента) и не из `insertPayload`.
    expect(body).toContain("serviceId: created.id");
    expect(body).toContain("type: toType(created.type)");
    expect(body).toContain("name: created.name");
    expect(body).toContain("amount: created.amount");
  });

  it("событие пишется после авто-отметки «Доставлено»", () => {
    const body = functionBody(sourceOf("service-operations"), "createServiceOperation");
    const markAt = body.indexOf("await markLinkedItemsDelivered(");
    const recordAt = body.indexOf("buildServiceAddedEvents(");

    // Отметка «Доставлено» — последний шаг, который может вернуть fail:
    // пользователь увидит ошибку, значит истории быть не должно.
    expect(markAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(markAt);
  });

  it("проверки позиций и дублей стоят до вставки операции", () => {
    const body = functionBody(sourceOf("service-operations"), "createServiceOperation");
    const insertAt = body.indexOf('.from("service_operations")');

    for (const guard of [
      "assertProjectItems(",
      "assertNoOtherDelivery(",
      "assertNoOtherInstallation(",
      "assertContractorInOrg(",
    ]) {
      const guardAt = body.indexOf(guard);
      expect(guardAt, guard).toBeGreaterThan(-1);
      expect(insertAt, guard).toBeGreaterThan(guardAt);
    }
  });

  it("связки вставляются одним запросом, а событие — после них", () => {
    const body = functionBody(sourceOf("service-operations"), "createServiceOperation");
    const linksAt = body.indexOf('from("service_operation_items")');
    const recordAt = body.indexOf("buildServiceAddedEvents(");

    expect(linksAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(linksAt);
    expect(body).toContain(".insert(links)");
  });

  it("связанные позиции читаются из БД, а не берутся из входных данных", () => {
    const body = functionBody(sourceOf("service-operations"), "createServiceOperation");
    const linksWrittenAt = body.indexOf(".insert(links)");
    const readAt = body.indexOf('.select("spec_item_id")', linksWrittenAt);
    const recordAt = body.indexOf("buildServiceAddedEvents(");

    // Тот же источник, что у завершения и удаления операции: подтверждённое
    // состояние связующей таблицы, а не список из запроса клиента.
    expect(readAt).toBeGreaterThan(linksWrittenAt);
    expect(recordAt).toBeGreaterThan(readAt);
    expect(body).toContain("specItemIds: (linkRows ?? []).map((r) => r.spec_item_id)");
    expect(body).not.toContain("specItemIds: d.specItemIds");
  });

  it("batch-флаги не считаются в action: их даёт общий batchFields", () => {
    const body = functionBody(sourceOf("service-operations"), "createServiceOperation");

    expect(body).not.toContain("batch");
  });

  it("никакой другой action услуги не логирует", () => {
    for (const file of [
      "materials",
      "spec-components",
      "spec-variants",
      "specifications",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildServiceAddedEvents");
    }
  });
});

/**
 * Завершение операции — переход отметки «Исполнено» из false в true, и он
 * происходит только в правке операции. Следствия (доставленные материалы)
 * своего события не получают.
 */
describe("service_completed пишет только завершение операции", () => {
  it("единственный производитель — updateServiceOperation", () => {
    const source = sourceOf("service-operations");

    expect([...source.matchAll(/buildServiceCompletedEvents\(/g)]).toHaveLength(1);
    expect(functionBody(source, "updateServiceOperation")).toContain(
      "buildServiceCompletedEvents(",
    );
  });

  it("создание операции завершением не считается", () => {
    // Созданная сразу «исполненной» операция перехода не совершает: отметка
    // ставится в той же вставке, и жест описывает `service_added`.
    const source = sourceOf("service-operations");
    const body = functionBody(source, "createServiceOperation");

    expect(body).not.toContain("buildServiceCompletedEvents");
    expect(body).not.toContain("service_completed");
    expect(body).toContain("buildServiceAddedEvents(");
  });

  it("удаление операции события не пишет", () => {
    const body = functionBody(sourceOf("service-operations"), "deleteServiceOperation");

    expect(body).not.toContain("buildServiceCompletedEvents");
  });

  it("в патч-пути позиции услуг нет", () => {
    const source = sourceOf("specifications");

    expect(source).not.toContain("buildServiceCompletedEvents");
    // Единственное упоминание в файле — перечисление агрегированных событий в
    // комментарии; производителя там нет.
    expect(source).not.toContain('kind: "service_completed"');
  });

  it("переход считается по БД с обеих сторон", () => {
    const body = functionBody(sourceOf("service-operations"), "updateServiceOperation");

    // false → true: прежняя отметка — из строки, прочитанной до mutation,
    // новая — из результата UPDATE. `true → true` и `true → false` перехода не
    // дают, поэтому и события не будет.
    expect(body).toContain(
      "if (!existing.completed && updated.completed === true)",
    );
    const condAt = body.indexOf(
      "if (!existing.completed && updated.completed === true)",
    );
    const recordAt = body.indexOf("buildServiceCompletedEvents(");
    expect(recordAt).toBeGreaterThan(condAt);
  });

  it("снимок берётся из обновлённой строки, а не из входных данных", () => {
    const body = functionBody(sourceOf("service-operations"), "updateServiceOperation");

    expect(body).toContain("serviceId: updated.id");
    expect(body).toContain("type: toType(updated.type)");
    expect(body).toContain("name: updated.name");
    expect(body).toContain("amount: updated.amount");
  });

  it("связанные позиции читаются из БД после записи связок", () => {
    const body = functionBody(sourceOf("service-operations"), "updateServiceOperation");
    const linksWrittenAt = body.indexOf(".insert(links)");
    // Прежние связи читаются до mutation — ищем чтение ПОСЛЕ записи связок.
    const readAt = body.indexOf('.select("spec_item_id")', linksWrittenAt);
    const recordAt = body.indexOf("buildServiceCompletedEvents(");

    expect(linksWrittenAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(linksWrittenAt);
    expect(recordAt).toBeGreaterThan(readAt);
    expect(body).toContain("specItemIds: (linkRows ?? []).map((r) => r.spec_item_id)");
  });

  it("событие пишется после всех шагов, которые могут вернуть fail", () => {
    const body = functionBody(sourceOf("service-operations"), "updateServiceOperation");
    const recordAt = body.indexOf("buildServiceCompletedEvents(");
    const revalidateAt = body.indexOf("revalidatePath(");

    // Последний fail — неудачная вставка связок: если она не прошла, действие
    // сообщает об ошибке, и истории быть не должно.
    expect(body).toContain('return fail("Не удалось связать позиции с операцией")');
    expect(recordAt).toBeGreaterThan(
      body.indexOf('return fail("Не удалось связать позиции с операцией")'),
    );
    expect(revalidateAt).toBeGreaterThan(recordAt);
  });

  it("побочная отметка «Доставлено» статус не логирует", () => {
    const body = functionBody(sourceOf("service-operations"), "updateServiceOperation");

    // Завершение доставки переводит материалы в «Доставлено», но это часть
    // того же жеста: отдельного status_changed из него не появляется.
    expect(body).toContain("markLinkedItemsDelivered(");
    expect(body).not.toContain("buildStatusChangedEvents");
    expect(body).not.toContain("status_changed");
  });

  it("batch-флаги не считаются в action: их даёт общий batchFields", () => {
    const body = functionBody(sourceOf("service-operations"), "updateServiceOperation");

    expect(body).not.toContain("batch");
  });

  it("никакой другой action завершение не логирует", () => {
    for (const file of [
      "materials",
      "spec-components",
      "spec-variants",
      "specifications",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildServiceCompletedEvents");
    }
  });
});

/**
 * Удаление операции — физическое, вместе со связками (FK `on delete cascade`).
 * Снимок и операции, и связанных позиций снимается в момент удаления.
 */
describe("service_removed пишет только удаление операции", () => {
  it("единственный производитель — deleteServiceOperation", () => {
    const source = sourceOf("service-operations");

    expect([...source.matchAll(/buildServiceRemovedEvents\(/g)]).toHaveLength(1);
    expect(functionBody(source, "deleteServiceOperation")).toContain(
      "buildServiceRemovedEvents(",
    );
  });

  it("создание и правка операции удаления не логируют", () => {
    const source = sourceOf("service-operations");

    for (const fn of ["createServiceOperation", "updateServiceOperation"]) {
      expect(functionBody(source, fn), fn).not.toContain(
        "buildServiceRemovedEvents",
      );
    }
  });

  it("в патч-пути позиции услуг нет", () => {
    const source = sourceOf("specifications");

    expect(source).not.toContain("buildServiceRemovedEvents");
    expect(source).not.toContain('kind: "service_removed"');
  });

  it("снимок операции берётся из удаляемой строки", () => {
    const body = functionBody(sourceOf("service-operations"), "deleteServiceOperation");
    const deleteAt = body.indexOf('from("service_operations")');
    const chain = body.slice(deleteAt, body.indexOf("if (error) {", deleteAt));
    const recordAt = body.indexOf("buildServiceRemovedEvents(");

    // `.select(OP_COLUMNS)` в самой цепочке DELETE — это и есть снимок: после
    // удаления читать нечего.
    expect(chain).toContain(".select(OP_COLUMNS)");
    expect(body).toContain("serviceId: snapshot.id");
    expect(body).toContain("type: toType(snapshot.type)");
    expect(body).toContain("name: snapshot.name");
    expect(body).toContain("amount: snapshot.amount");
    expect(recordAt).toBeGreaterThan(deleteAt);
  });

  it("связки снимаются снимком до удаления операции", () => {
    const body = functionBody(sourceOf("service-operations"), "deleteServiceOperation");
    const linksAt = body.indexOf('from("service_operation_items")');
    const linksChain = body.slice(linksAt, body.indexOf("if (linksErr) {", linksAt));
    // Проверка принадлежности читает service_operations раньше — берём удаление.
    const opDeleteAt = body.indexOf('from("service_operations")', linksAt);
    const recordAt = body.indexOf("buildServiceRemovedEvents(");

    // Каскад по `operation_id` уничтожил бы связки вместе с операцией, поэтому
    // они удаляются первыми — и удалённые строки тут же становятся снимком.
    expect(linksAt).toBeGreaterThan(-1);
    expect(linksChain).toContain('.select("spec_item_id")');
    expect(opDeleteAt).toBeGreaterThan(linksAt);
    expect(body).toContain(
      "specItemIds: (removedLinks ?? []).map((r) => r.spec_item_id)",
    );
    expect(recordAt).toBeGreaterThan(opDeleteAt);
  });

  it("чужая операция отсекается до удаления связок", () => {
    const body = functionBody(sourceOf("service-operations"), "deleteServiceOperation");
    const guardAt = body.indexOf('if (!existing) return fail("Операция не найдена")');
    const linksAt = body.indexOf('from("service_operation_items")');

    // Удаление связок фильтруется только по operation_id, поэтому проверка
    // принадлежности проекту и организации обязана идти раньше.
    expect(guardAt).toBeGreaterThan(-1);
    expect(linksAt).toBeGreaterThan(guardAt);
  });

  it("исчезнувшая между проверкой и удалением операция события не даёт", () => {
    const body = functionBody(sourceOf("service-operations"), "deleteServiceOperation");
    const guardAt = body.indexOf("if (!snapshot) return fail");
    const recordAt = body.indexOf("buildServiceRemovedEvents(");

    expect(guardAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it("сторонние данные при удалении не меняются", () => {
    const body = functionBody(sourceOf("service-operations"), "deleteServiceOperation");

    // Удаление операции не откатывает статусы материалов и не создаёт
    // дополнительных событий.
    expect(body).not.toContain("spec_items");
    expect(body).not.toContain("buildStatusChangedEvents");
    expect(body).not.toContain("status_changed");
  });

  it("batch-флаги не считаются в action: их даёт общий batchFields", () => {
    const body = functionBody(sourceOf("service-operations"), "deleteServiceOperation");

    expect(body).not.toContain("batch");
  });

  it("никакой другой action удаление услуги не логирует", () => {
    for (const file of [
      "materials",
      "spec-components",
      "spec-variants",
      "specifications",
    ] as ActionFile[]) {
      expect(sourceOf(file), file).not.toContain("buildServiceRemovedEvents");
    }
  });
});
