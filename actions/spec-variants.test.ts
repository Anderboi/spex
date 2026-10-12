import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Тесты ворот смены варианта в server action'е `switchVariant` (ADR 0008).
 *
 * Проверяется то, что нельзя проверить в чистом правиле
 * (`lib/spec/status.ts`, покрыто в `status.test.ts`): что отказ по заказанному
 * материалу выходит ДО первой записи, что согласование снимается тем же
 * действием, что запись статуса условная и что сбой этого шага виден
 * пользователю, а не проглатывается.
 *
 * `requireOrgBySlug` и `createAdminClient` подменяются модульными моками:
 * реальная сессия требует next-auth и живой БД, а интересует решение действия по
 * готовому контексту. Подставной клиент отвечает на те цепочки
 * (`select/eq/neq/is/update/insert`), которые действие действительно зовёт, и
 * записывает применённые UPDATE'ы — тест «ничего не записано» держится на этом
 * списке, а не на догадке.
 */

const sessionMock = vi.hoisted(() => ({
  current: {
    userId: "user-1",
    user: { name: "Анна", email: "anna@studio.ru" },
    orgId: "11111111-1111-4111-8111-111111111111",
    orgSlug: "org-1",
    role: "member" as "owner" | "admin" | "member" | "viewer",
  },
}));

const adminMock = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/auth/session", () => ({
  requireOrgBySlug: async () => ({ ...sessionMock.current }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminMock.client,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { switchVariant } from "./spec-variants";

/* ------------------------------------------------------------------ */
/*  Подставной клиент                                                  */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const VARIANT_A = "55555555-5555-4555-8555-555555555555";
const VARIANT_B = "66666666-6666-4666-8666-666666666666";

/** Позиция: статус — то, ради чего написан весь файл. */
function itemRow(over: Row = {}): Row {
  return {
    id: ITEM,
    org_id: ORG,
    project_id: PROJECT,
    status: "picked",
    deleted_at: null,
    ...over,
  };
}

/** Вариант: `VARIANT_A` — активный по умолчанию, как и в жизни. */
function variantRow(id: string, over: Row = {}): Row {
  return {
    id,
    org_id: ORG,
    spec_item_id: ITEM,
    name: id === VARIANT_A ? "Керамогранит Blanco" : "Finex Дуб Роял",
    label: "",
    is_active: id === VARIANT_A,
    position: id === VARIANT_A ? 0 : 1,
    ...over,
  };
}

/**
 * Подставной admin-клиент: цепочки PostgREST над таблицами в памяти.
 *
 * `updates` — применённые UPDATE'ы с их фильтрами: по ним видно и что запись
 * была, и по какому условию. Две ручки управляют редкими случаями:
 * `raceStatus` имитирует чужую правку между чтением позиции и записью, а
 * `failStatusWrite` — сбой самой записи.
 */
function fakeAdmin(seed: { items?: Row[]; variants?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    spec_items: seed.items ?? [itemRow()],
    projects: [{ id: PROJECT, org_id: ORG, created_by: "user-1" }],
    spec_item_variants: seed.variants ?? [
      variantRow(VARIANT_A),
      variantRow(VARIANT_B),
    ],
    spec_item_events: [],
  };

  const updates: { table: string; patch: Row; filters: [string, unknown][] }[] =
    [];

  /** Следующая запись статуса позиции отвечает ошибкой. */
  let statusWriteFails = false;

  /** Чужая правка перед записью статуса: статус «уехал» между чтением и UPDATE. */
  let beforeStatusWrite: (() => void) | null = null;

  function from(table: string) {
    const eqs: [string, unknown][] = [];
    const neqs: [string, unknown][] = [];
    const isNull: string[] = [];
    let operation: "select" | "update" | "insert" = "select";
    let patch: Row | null = null;
    let inserted: Row[] = [];

    const matches = (row: Row) =>
      eqs.every(([column, value]) => row[column] === value) &&
      neqs.every(([column, value]) => row[column] !== value) &&
      isNull.every((column) => (row[column] ?? null) === null);

    const first = (data: Row[] | Row | null) =>
      Array.isArray(data) ? (data[0] ?? null) : data;

    const finish = () => {
      if (operation === "insert") {
        tables[table] = [...(tables[table] ?? []), ...inserted];
        return { data: inserted, error: null };
      }

      if (operation === "update") {
        const isStatusWrite =
          table === "spec_items" && patch !== null && "status" in patch;

        if (isStatusWrite) {
          beforeStatusWrite?.();
          beforeStatusWrite = null;

          if (statusWriteFails) {
            statusWriteFails = false;
            return { data: null, error: { message: "status write failed" } };
          }
        }

        const touched = (tables[table] ?? []).filter(matches);
        for (const row of touched) {
          tables[table][tables[table].indexOf(row)] = {
            ...row,
            ...(patch ?? {}),
          };
        }
        updates.push({ table, patch: patch ?? {}, filters: [...eqs] });
        return { data: touched.map((row) => ({ id: row.id })), error: null };
      }

      return { data: (tables[table] ?? []).filter(matches), error: null };
    };

    const chain = {
      select: () => chain,
      eq(column: string, value: unknown) {
        eqs.push([column, value]);
        return chain;
      },
      neq(column: string, value: unknown) {
        neqs.push([column, value]);
        return chain;
      },
      is(column: string, value: unknown) {
        if (value === null) isNull.push(column);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      insert(rows: Row | Row[]) {
        operation = "insert";
        inserted = Array.isArray(rows) ? rows : [rows];
        return chain;
      },
      update(next: Row) {
        operation = "update";
        patch = next;
        return chain;
      },
      maybeSingle: () => {
        const { data, error } = finish();
        return Promise.resolve({ data: first(data), error });
      },
      single: () => {
        const { data, error } = finish();
        return Promise.resolve({ data: first(data), error });
      },
      then: (resolve: (value: { data: Row[]; error: unknown }) => unknown) =>
        Promise.resolve(resolve(finish() as { data: Row[]; error: unknown })),
    };

    return chain;
  }

  return {
    client: { from },
    tables,
    updates,
    /** Имитирует чужую правку статуса между его чтением и записью. */
    raceStatus(next: string) {
      beforeStatusWrite = () => {
        tables.spec_items[0].status = next;
      };
    },
    /** Следующая запись статуса позиции падает. */
    failStatusWrite() {
      statusWriteFails = true;
    },
  };
}

let admin: ReturnType<typeof fakeAdmin>;

beforeEach(() => {
  admin = fakeAdmin();
  adminMock.client = admin.client;
  sessionMock.current.orgId = ORG;
  sessionMock.current.role = "member";
});

/** Статус позиции после действия. */
const itemStatus = () => admin.tables.spec_items[0].status;

/** Активный вариант после действия. */
const activeVariant = () =>
  (admin.tables.spec_item_variants ?? []).find((v) => v.is_active === true)?.id;

/** События журнала: их пишет только настоящее переключение. */
const events = () => admin.tables.spec_item_events ?? [];

/* ------------------------------------------------------------------ */
/*  Ворота статуса                                                     */
/* ------------------------------------------------------------------ */

describe("switchVariant: заказанный и доставленный материал не меняют", () => {
  for (const [status, word] of [
    ["ordered", "заказан"],
    ["delivered", "доставлен"],
  ] as const) {
    it(`«${status}» — отказ без единой записи`, async () => {
      admin = fakeAdmin({ items: [itemRow({ status })] });
      adminMock.client = admin.client;

      const res = await switchVariant("org-1", ITEM, VARIANT_B);

      expect(res.success).toBe(false);
      // Отказ по состоянию, а не по формату ввода: UI показывает его словами.
      expect(res.success === false && res.code).toBe("NOT_ALLOWED");
      expect(res.success === false && res.error).toContain(word);

      // Ворота стоят до первой мутации: ни флагов варианта, ни статуса, ни
      // события. Иначе позиция осталась бы без активного варианта или в
      // журнале появилось бы переключение, которого не было.
      expect(admin.updates).toEqual([]);
      expect(events()).toEqual([]);
      expect(activeVariant()).toBe(VARIANT_A);
    });
  }

  it("текст отказа — тот же, что показывает интерфейс", async () => {
    admin = fakeAdmin({ items: [itemRow({ status: "ordered" })] });
    adminMock.client = admin.client;

    const res = await switchVariant("org-1", ITEM, VARIANT_B);

    // Вторая копия текста разошлась бы с первой молча: и интерфейс, и сервер
    // берут слова из одного правила (`variantSwitchDecision`).
    expect(res.success === false && res.error).toBe(
      "Смена варианта недоступна: материал уже заказан.",
    );
  });
});

/* ------------------------------------------------------------------
    Согласование
   ------------------------------------------------------------------ */

describe("switchVariant: согласование снимается вместе со сменой материала", () => {
  it("согласованную позицию переключает и возвращает в «Подобрано»", async () => {
    admin = fakeAdmin({ items: [itemRow({ status: "approved" })] });
    adminMock.client = admin.client;

    const res = await switchVariant("org-1", ITEM, VARIANT_B);

    expect(res.success).toBe(true);
    expect(activeVariant()).toBe(VARIANT_B);
    expect(itemStatus()).toBe("picked");
    // Вариант уже переключён: событие об этом есть, и ровно одно. Второго
    // события на смену статуса быть не должно — следствие жеста, а не
    // отдельная смена статуса (ADR 0008).
    expect(events()).toHaveLength(1);
    expect(events()[0].kind).toBe("variant_switched");
  });

  it("запись статуса условная: статус, уехавший дальше, не откатывается", async () => {
    admin = fakeAdmin({ items: [itemRow({ status: "approved" })] });
    adminMock.client = admin.client;
    // Между чтением позиции и UPDATE статус ушёл в «Доставлено» — например,
    // отметкой исполненной доставки в другой вкладке.
    admin.raceStatus("delivered");

    const res = await switchVariant("org-1", ITEM, VARIANT_B);

    expect(res.success).toBe(true);
    expect(itemStatus()).toBe("delivered");
  });

  it("статус до согласования смена варианта не трогает", async () => {
    admin = fakeAdmin({ items: [itemRow({ status: "picked" })] });
    adminMock.client = admin.client;

    const res = await switchVariant("org-1", ITEM, VARIANT_B);

    expect(res.success).toBe(true);
    expect(itemStatus()).toBe("picked");
    // Ни одной записи в spec_items: статус не менялся, и лишний UPDATE
    // сдвинул бы `updated_at` и прошёл бы в журнал как изменение.
    expect(admin.updates.filter((u) => u.table === "spec_items")).toEqual([]);
  });

  it("сбой записи статуса не молчит: текст называет расхождение", async () => {
    admin = fakeAdmin({ items: [itemRow({ status: "approved" })] });
    adminMock.client = admin.client;
    admin.failStatusWrite();

    const res = await switchVariant("org-1", ITEM, VARIANT_B);

    // Вариант переключён, позиция осталась согласованной. Сказать «не удалось
    // переключить» значило бы соврать про вариант, а промолчать — оставить
    // клиент с «Подобрано» на экране и «Согласовано» в базе.
    expect(res.success).toBe(false);
    expect(res.success === false && res.error).toContain("Подобрано");
    expect(activeVariant()).toBe(VARIANT_B);
    expect(events()).toHaveLength(1);
    expect(itemStatus()).toBe("approved");
  });

  it("выбор уже активного варианта согласование не снимает", async () => {
    admin = fakeAdmin({ items: [itemRow({ status: "approved" })] });
    adminMock.client = admin.client;

    // A → A: материала никто не менял, значит и согласование снимать не за что.
    const res = await switchVariant("org-1", ITEM, VARIANT_A);

    expect(res.success).toBe(true);
    expect(itemStatus()).toBe("approved");
    expect(events()).toEqual([]);
  });

  it("чужой вариант по-прежнему не переключается", async () => {
    admin = fakeAdmin({ items: [itemRow({ status: "approved" })] });
    adminMock.client = admin.client;

    const res = await switchVariant("org-1", ITEM, "77777777-7777-4777-8777-777777777777");

    expect(res.success).toBe(false);
    expect(res.success === false && res.error).toBe("Вариант не найден");
    // Отказ по чужому варианту выходит до ворот статуса: активность ни с кого не
    // снята, статус не тронут.
    expect(itemStatus()).toBe("approved");
    expect(activeVariant()).toBe(VARIANT_A);
  });
});
