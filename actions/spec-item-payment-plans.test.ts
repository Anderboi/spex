import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Тесты server action'ов графика платежей: сессия, права, валидация формы и
 * запись журнала.
 *
 * Ядро (`lib/spec/payment-plan-mutations.ts`) покрыто отдельно и работает на
 * подставном клиенте. Здесь проверяется ровно слой НАД ним — то, что нельзя
 * проверить в ядре: граница прав (`can`), организация из сессии, тексты отказов
 * и то, что действие попадает в журнал событий позиции.
 *
 * `requireOrgBySlug` и `createAdminClient` подменяются модульными моками:
 * реальная сессия требует next-auth и БД, а интересует решение action'а по
 * готовому контексту.
 */

const sessionMock = vi.hoisted(() => ({
  current: {
    userId: "user-1",
    user: { name: "Анна", email: "anna@studio.ru" },
    // Настоящие uuid подставляются в `beforeEach`: orgId обязан совпадать с
    // `ORG`, иначе action честно ответит NOT_FOUND.
    orgId: "00000000-0000-4000-8000-000000000000",
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

import {
  createPaymentPlan,
  deletePaymentPlan,
  listPaymentPlans,
  movePaymentPlan,
  updatePaymentPlan,
} from "./spec-item-payment-plans";

/* ------------------------------------------------------------------ */
/*  Подставной клиент                                                  */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const PLAN_A = "55555555-5555-4555-8555-555555555555";
const PLAN_B = "66666666-6666-4666-8666-666666666666";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Повторяет приведение к uuid в Postgres: не-uuid значение не совпадёт ни с чем. */
function asUuid(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

function planRow(over: Row = {}): Row {
  return {
    id: PLAN_A,
    org_id: ORG,
    project_id: PROJECT,
    spec_item_id: ITEM,
    title: "Аванс",
    amount: "12000.00",
    condition: "После подписания договора",
    due_date: "2026-11-01",
    position: 0,
    created_by: "user-1",
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

function fakeAdmin(seed: Row[] = [planRow()]) {
  const tables: Record<string, Row[]> = {
    spec_items: [
      { id: ITEM, org_id: ORG, project_id: PROJECT, deleted_at: null },
    ],
    spec_item_payment_plans: seed,
    // Журнал событий: сюда падают события действий.
    spec_item_events: [],
  };

  function from(table: string) {
    const eqs: [string, unknown][] = [];
    const isNull: string[] = [];
    const inFilter: [string, unknown[]][] = [];
    let insertRow: Row | null = null;
    let patch: Row | null = null;
    let operation: "select" | "insert" | "update" = "select";
    const orderBy: { column: string; ascending: boolean }[] = [];
    let limitCount: number | null = null;

    const matches = (row: Row) =>
      eqs.every(([column, value]) => {
        const expected = asUuid(value);
        if (expected === null) return false;
        const actual =
          typeof row[column] === "string"
            ? (row[column] as string).toLowerCase()
            : row[column];
        return actual === expected;
      }) &&
      isNull.every(
        (column) => row[column] === null || row[column] === undefined,
      ) &&
      inFilter.every(([column, values]) => values.includes(row[column]));

    const matched = () => (tables[table] ?? []).filter(matches);

    const sorted = () => {
      const rows = matched();
      const ordered =
        orderBy.length === 0
          ? rows
          : [...rows].sort((a, b) => {
              for (const { column, ascending } of orderBy) {
                const left = a[column] as never;
                const right = b[column] as never;
                if (left === right) continue;
                const result = left < right ? -1 : 1;
                return ascending ? result : -result;
              }
              return 0;
            });
      return limitCount === null ? ordered : ordered.slice(0, limitCount);
    };

    const finish = () => {
      if (operation === "insert") {
        const rows = Array.isArray(insertRow) ? insertRow : [insertRow ?? {}];
        const stored = rows.map((row, index) => ({
          id: `${PLAN_B}-${index}`,
          ...row,
        }));
        tables[table] = [...(tables[table] ?? []), ...stored];
        return { data: stored, error: null };
      }
      if (operation === "update") {
        const patched = matched().map((row) => {
          const next = { ...row, ...(patch ?? {}) };
          const at = tables[table].indexOf(row);
          tables[table][at] = next;
          return next;
        });
        return { data: patched, error: null };
      }
      return { data: sorted(), error: null };
    };

    const chain = {
      select: () => chain,
      eq(column: string, value: unknown) {
        eqs.push([column, value]);
        return chain;
      },
      is(column: string, value: unknown) {
        if (value === null) isNull.push(column);
        return chain;
      },
      in(column: string, values: unknown[]) {
        inFilter.push([column, values]);
        return chain;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderBy.push({ column, ascending: options?.ascending !== false });
        return chain;
      },
      limit(count: number) {
        limitCount = count;
        return chain;
      },
      insert(row: Row) {
        operation = "insert";
        insertRow = row;
        return chain;
      },
      update(next: Row) {
        operation = "update";
        patch = next;
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: first(finish()), error: null }),
      single: () => Promise.resolve({ data: first(finish()), error: null }),
      then: (
        resolve: (value: { data: Row[] | null; error: null }) => unknown,
      ) => Promise.resolve(resolve(finish() as { data: Row[] | null; error: null })),
    };

    function first(result: { data: unknown; error: unknown }) {
      const data = result.data;
      return Array.isArray(data) ? (data[0] ?? null) : data;
    }

    return chain;
  }

  /**
   * RPC вместо сети: перестановка строки графика — это вызов функции БД
   * (`move_spec_item_payment_plan`), потому что частичный уникальный индекс
   * порядка проверяется построчно и обменять две строки серией UPDATE'ов нельзя.
   * Подставной клиент отвечает так, как ответила бы функция: применяет обмен к
   * своей таблице и возвращает исход.
   */
  async function rpc(name: string, args: Record<string, unknown>) {
    if (name !== "move_spec_item_payment_plan") {
      throw new Error(`неожиданный вызов функции: ${name}`);
    }

    const active = (tables.spec_item_payment_plans ?? [])
      .filter((row) => row.deleted_at === null)
      .sort((a, b) => Number(a.position) - Number(b.position));
    const at = active.findIndex((row) => row.id === args.p_plan);
    if (at === -1) {
      return {
        data: [{ result: "not_found", target_id: null, target_position: null, neighbour_id: null, neighbour_position: null }],
        error: null,
      };
    }

    const to = args.p_dir === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= active.length) {
      return {
        data: [{ result: "unchanged", target_id: args.p_plan, target_position: null, neighbour_id: null, neighbour_position: null }],
        error: null,
      };
    }

    const target = active[at];
    const neighbour = active[to];
    const targetPosition = target.position;
    target.position = neighbour.position;
    neighbour.position = targetPosition;

    // В ответе — те же номера, что теперь лежат в таблице: клиент берёт из них
    // таблицу изменений для журнала.
    return {
      data: [
        {
          result: "moved",
          target_id: target.id,
          target_position: target.position,
          neighbour_id: neighbour.id,
          neighbour_position: neighbour.position,
        },
      ],
      error: null,
    };
  }

  return { client: { from, rpc }, tables };
}

let admin: ReturnType<typeof fakeAdmin>;

beforeEach(() => {
  admin = fakeAdmin();
  adminMock.client = admin.client;
  sessionMock.current.role = "member";
  sessionMock.current.orgId = ORG;
  sessionMock.current.orgSlug = "org-1";
});

/** Данные строки графика в том виде, в каком их шлёт вкладка. */
const input = {
  title: "Второй платёж",
  amount: 3500,
  condition: null,
  dueDate: null,
};

const events = () => admin.tables.spec_item_events;

/* ------------------------------------------------------------------ */
/*  Права                                                              */
/* ------------------------------------------------------------------ */

describe("права", () => {
  it("viewer не может добавить платёж", async () => {
    sessionMock.current.role = "viewer";

    const result = await createPaymentPlan(ORG, ITEM, input);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("FORBIDDEN");
    // Ни строки, ни события: отказ вынесен до записи.
    expect(admin.tables.spec_item_payment_plans).toHaveLength(1);
    expect(events()).toHaveLength(0);
  });

  it("viewer не может изменить, переставить и удалить платёж", async () => {
    sessionMock.current.role = "viewer";

    const updated = await updatePaymentPlan(ORG, ITEM, PLAN_A, input);
    const moved = await movePaymentPlan(ORG, ITEM, PLAN_A, "down");
    const removed = await deletePaymentPlan(ORG, ITEM, PLAN_A);

    for (const result of [updated, moved, removed]) {
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("FORBIDDEN");
    }
    expect(events()).toHaveLength(0);
    expect(admin.tables.spec_item_payment_plans[0].deleted_at).toBeNull();
  });

  it("viewer читает график: чтение правами не описывается", async () => {
    sessionMock.current.role = "viewer";

    const result = await listPaymentPlans(ORG, ITEM);

    // Решение O9: суммы плана видны всем членам организации, включая
    // наблюдателей — деньги организации не секрет от её участника.
    expect(result.success).toBe(true);
  });

  it("member, admin и owner вносят платежи", async () => {
    for (const role of ["member", "admin", "owner"] as const) {
      admin = fakeAdmin();
      adminMock.client = admin.client;
      sessionMock.current.role = role;

      const result = await createPaymentPlan(ORG, ITEM, input);

      expect(result.success, role).toBe(true);
      expect(events(), role).toHaveLength(1);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Доступ                                                             */
/* ------------------------------------------------------------------ */

describe("доступ", () => {
  it("чужая организация: позиция не находится", async () => {
    sessionMock.current.orgId = OTHER_ORG;

    const result = await createPaymentPlan(ORG, ITEM, input);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("NOT_FOUND");
    expect(events()).toHaveLength(0);
  });

  it("org_id и project_id берутся из строки позиции, а не из формы", async () => {
    const result = await createPaymentPlan(ORG, ITEM, {
      ...input,
      orgId: OTHER_ORG,
      projectId: "99999999-9999-4999-8999-999999999999",
      position: 42,
      createdBy: "user-99",
    });

    expect(result.success).toBe(true);
    const inserted = admin.tables.spec_item_payment_plans.at(-1)!;
    expect(inserted.org_id).toBe(ORG);
    expect(inserted.project_id).toBe(PROJECT);
    expect(inserted.created_by).toBe("user-1");
    // Порядок считает сервер (конец графика), а не клиент.
    expect(inserted.position).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Валидация                                                          */
/* ------------------------------------------------------------------ */

describe("валидация", () => {
  it("пустое название отклоняется с текстом схемы", async () => {
    const result = await createPaymentPlan(ORG, ITEM, {
      ...input,
      title: "   ",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
    expect(result.error).toBe("Укажите название платежа");
    expect(admin.tables.spec_item_payment_plans).toHaveLength(1);
  });

  it("нулевая и отрицательная сумма отклоняются", async () => {
    for (const amount of [0, -1]) {
      const result = await createPaymentPlan(ORG, ITEM, { ...input, amount });

      expect(result.success, String(amount)).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("INVALID_INPUT");
    }
  });

  it("мусорная дата отклоняется, а пустая становится null", async () => {
    const bad = await createPaymentPlan(ORG, ITEM, {
      ...input,
      dueDate: "01.11.2026",
    });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.code).toBe("INVALID_INPUT");

    const empty = await createPaymentPlan(ORG, ITEM, {
      ...input,
      condition: "   ",
      dueDate: "",
    });
    expect(empty.success).toBe(true);
    const inserted = admin.tables.spec_item_payment_plans.at(-1)!;
    expect(inserted.condition).toBeNull();
    expect(inserted.due_date).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Журнал событий                                                     */
/* ------------------------------------------------------------------ */

describe("журнал событий", () => {
  it("добавление пишет payment_plan_added со снимком записанной строки", async () => {
    const result = await createPaymentPlan(ORG, ITEM, {
      title: "  Второй платёж  ",
      amount: 3500,
      condition: "До поставки",
      dueDate: "2026-12-01",
    });

    expect(result.success).toBe(true);
    expect(events()).toHaveLength(1);

    const event = events()[0];
    expect(event).toMatchObject({
      org_id: ORG,
      spec_item_id: ITEM,
      kind: "payment_plan_added",
      actor_id: "user-1",
    });
    // Снимок из строки БД: текст уже обрезан записью, а не тем, что прислал
    // клиент.
    expect(event.payload).toMatchObject({
      title: "Второй платёж",
      amount: 3500,
      condition: "До поставки",
      due_date: "2026-12-01",
    });
  });

  it("правка пишет payment_plan_changed с таблицей изменений", async () => {
    const result = await updatePaymentPlan(ORG, ITEM, PLAN_A, {
      title: "Аванс",
      amount: 15000,
      condition: "После подписания договора",
      dueDate: "2026-11-01",
    });

    expect(result.success).toBe(true);
    expect(events()).toHaveLength(1);
    expect(events()[0].kind).toBe("payment_plan_changed");
    expect(events()[0].payload).toMatchObject({
      plan_id: PLAN_A,
      changes: [{ field: "amount", from: 12000, to: 15000 }],
    });
  });

  it("сохранение без изменений журнал не пополняет", async () => {
    const result = await updatePaymentPlan(ORG, ITEM, PLAN_A, {
      title: "Аванс",
      amount: 12000,
      condition: "После подписания договора",
      dueDate: "2026-11-01",
    });

    expect(result.success).toBe(true);
    // «Сохранил, ничего не поменяв» — не событие: тем же правилом живут
    // price_changed и variant_updated.
    expect(events()).toHaveLength(0);
  });

  it("в графике из одной строки переставлять нечего", async () => {
    const result = await movePaymentPlan(ORG, ITEM, PLAN_A, "down");

    // В графике всего одна строка: переставлять некуда.
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.moved).toBe(false);
    expect(events()).toHaveLength(0);
  });

  it("перестановка двух строк пишет событие и меняет порядок", async () => {
    admin = fakeAdmin([
      planRow({ id: PLAN_A, position: 0 }),
      planRow({ id: PLAN_B, position: 1 }),
    ]);
    adminMock.client = admin.client;

    const result = await movePaymentPlan(ORG, ITEM, PLAN_B, "up");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.moved).toBe(true);

    const positions = Object.fromEntries(
      admin.tables.spec_item_payment_plans.map((row) => [row.id, row.position]),
    );
    expect(positions).toEqual({ [PLAN_B]: 0, [PLAN_A]: 1 });
    expect(events()).toHaveLength(1);
    expect(events()[0].payload).toMatchObject({
      plan_id: PLAN_B,
      changes: [{ field: "position", from: 1, to: 0 }],
    });
  });

  it("удаление пишет payment_plan_removed и остаётся мягким", async () => {
    const result = await deletePaymentPlan(ORG, ITEM, PLAN_A);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.deleted).toBe(true);
    expect(admin.tables.spec_item_payment_plans[0].deleted_at).not.toBeNull();
    expect(events()).toHaveLength(1);
    expect(events()[0].kind).toBe("payment_plan_removed");
  });

  it("повторное удаление идемпотентно и события не повторяет", async () => {
    await deletePaymentPlan(ORG, ITEM, PLAN_A);
    const second = await deletePaymentPlan(ORG, ITEM, PLAN_A);

    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.data.deleted).toBe(false);
    expect(events()).toHaveLength(1);
  });

  it("чужой план не удаляется: NOT_FOUND и ни одного события", async () => {
    const result = await deletePaymentPlan(
      ORG,
      ITEM,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("NOT_FOUND");
    expect(events()).toHaveLength(0);
  });
});
