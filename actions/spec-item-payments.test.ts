import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Тесты server action'ов фактических оплат: сессия, права, валидация формы и
 * запись журнала.
 *
 * Ядро (`lib/spec/payment-mutations.ts`) покрыто отдельно и работает на
 * подставном клиенте. Здесь проверяется ровно слой НАД ним — то, что нельзя
 * проверить в ядре:
 *
 *   * `viewer` не пишет и не правит даже свою запись (граница прав);
 *   * чужую запись не правит участник, а владелец и администратор — правят;
 *   * успешное действие попадает в журнал позиции одним INSERT, а повтор с тем
 *     же ключом идемпотентности — не попадает вовсе;
 *   * отказ ядра доходит до клиента своим текстом и кодом.
 *
 * `requireOrgBySlug` и `createAdminClient` подменяются модульными моками:
 * реальная сессия требует next-auth и БД, а интересует решение action'а по
 * готовому контексту.
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

import {
  createPayment,
  deletePayment,
  listPayments,
  updatePayment,
} from "./spec-item-payments";

type Row = Record<string, unknown>;

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const PLAN_A = "55555555-5555-4555-8555-555555555555";
const PAYMENT_A = "66666666-6666-4666-8666-666666666666";
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Повторяет приведение к uuid в Postgres: не-uuid значение не совпадёт ни с чем. */
function asUuid(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

/** Строка оплаты в том виде, в каком её отдаёт PostgREST. */
function paymentRow(over: Row = {}): Row {
  return {
    id: PAYMENT_A,
    org_id: ORG,
    project_id: PROJECT,
    spec_item_id: ITEM,
    kind: "payment",
    amount: "4000.00",
    paid_at: "2026-10-05",
    payment_plan_id: PLAN_A,
    comment: null,
    created_by: "user-1",
    author_name_snapshot: "Анна",
    code_snapshot: "М-01",
    name_snapshot: "Керамогранит",
    project_title_snapshot: "Кухня",
    created_at: "2026-10-05T10:00:00.000Z",
    updated_at: "2026-10-05T10:00:00.000Z",
    deleted_at: null,
    idempotency_key: null,
    ...over,
  };
}

/**
 * Подставной клиент: позиция, график, оплаты и журнал событий.
 *
 * Счётчик `select(..., { count, head })` воспроизведён явно — по нему action
 * решает, можно ли удалять строку графика; без него тест подтверждал бы
 * заглушку, а не правило решения Q9.
 */
function fakeAdmin(seed: Row[] = []) {
  const tables: Record<string, Row[]> = {
    spec_items: [
      {
        id: ITEM,
        org_id: ORG,
        project_id: PROJECT,
        // Статус и заглушка нужны воротам оплаты (ADR 0007): без них запись
        // факта отказывала бы по любой позиции.
        status: "approved",
        is_placeholder: false,
        deleted_at: null,
      },
    ],
    spec_item_payment_plans: [
      {
        id: PLAN_A,
        org_id: ORG,
        spec_item_id: ITEM,
        deleted_at: null,
      },
    ],
    spec_item_payments: seed,
    spec_item_events: [],
  };

  let counter = 0;
  const generatedId = () =>
    `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

  function from(table: string) {
    const eqs: [string, unknown][] = [];
    const isNull: string[] = [];
    let insertRows: Row[] | null = null;
    let patch: Row | null = null;
    let operation: "select" | "insert" | "update" = "select";
    let countRequested = false;
    let headOnly = false;

    /**
     * Приведение к uuid — только для uuid-значений: по нему «не-uuid строка» не
     * совпадает ни с чем, как в Postgres. Остальные колонки (статус, вид записи)
     * сравниваются как есть — ворота оплаты фильтруют именно статусом.
     */
    const matches = (row: Row) =>
      eqs.every(([column, value]) => {
        const actual =
          typeof row[column] === "string"
            ? (row[column] as string).toLowerCase()
            : row[column];
        if (typeof value === "string" && UUID_RE.test(value)) {
          return actual === asUuid(value);
        }
        return actual === value;
      }) && isNull.every((column) => (row[column] ?? null) === null);

    const matched = () => (tables[table] ?? []).filter(matches);

    const finish = (): { data: Row[] | Row | null; count?: number } => {
      if (operation === "insert") {
        const rows = Array.isArray(insertRows) ? insertRows : [insertRows ?? {}];
        const stored = rows.map((row) => ({ id: generatedId(), ...row }));
        tables[table] = [...(tables[table] ?? []), ...stored];
        return { data: stored };
      }
      if (operation === "update") {
        const patched = matched().map((row) => {
          const next = { ...row, ...(patch ?? {}) };
          const at = tables[table].indexOf(row);
          tables[table][at] = next;
          return next;
        });
        return { data: patched };
      }
      return { data: matched(), count: matched().length };
    };

    const chain = {
      select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
        countRequested = options?.count === "exact";
        headOnly = options?.head === true;
        return chain;
      },
      eq(column: string, value: unknown) {
        eqs.push([column, value]);
        return chain;
      },
      is(column: string, value: unknown) {
        if (value === null) isNull.push(column);
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      insert(row: Row | Row[]) {
        operation = "insert";
        insertRows = Array.isArray(row) ? row : [row];
        return chain;
      },
      update(next: Row) {
        operation = "update";
        patch = next;
        return chain;
      },
      maybeSingle: async () => {
        const result = finish();
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return { data, error: null };
      },
      single: async () => {
        const result = finish();
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return { data, error: null };
      },
      then: (
        resolve: (value: {
          data: Row[] | null;
          error: null;
          count?: number | null;
        }) => unknown,
      ) => {
        const result = finish();
        return Promise.resolve(
          resolve({
            data: headOnly ? null : ((result.data as Row[]) ?? null),
            error: null,
            ...(countRequested ? { count: result.count ?? 0 } : {}),
          }),
        );
      },
    };

    return chain;
  }

  return { client: { from } as unknown, tables };
}

beforeEach(() => {
  sessionMock.current.userId = "user-1";
  sessionMock.current.role = "member";
  sessionMock.current.orgId = ORG;
});

/* ------------------------------------------------------------------ */
/*  list                                                               */
/* ------------------------------------------------------------------ */

describe("listPayments", () => {
  it("отдаёт оплаты позиции члену организации", async () => {
    const { client } = fakeAdmin([paymentRow()]);
    adminMock.client = client;

    const result = await listPayments("org-1", ITEM);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: PAYMENT_A, amount: 4000 });
  });

  it("чужой организации позиция не находится", async () => {
    const { client } = fakeAdmin([paymentRow()]);
    adminMock.client = client;
    sessionMock.current.orgId = OTHER_ORG;

    const result = await listPayments("org-1", ITEM);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  create                                                             */
/* ------------------------------------------------------------------ */

describe("createPayment", () => {
  /** Данные формы: оплата 4000 ₽ по строке графика. */
  const form = {
    kind: "payment" as const,
    amount: 4000,
    paidAt: "2026-10-05",
    paymentPlanId: PLAN_A,
    comment: null,
    idempotencyKey: KEY,
  };

  it("вносит оплату и пишет событие журнала", async () => {
    const { client, tables } = fakeAdmin();
    adminMock.client = client;

    const result = await createPayment("org-1", ITEM, form);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ amount: 4000, authorId: "user-1" });

    // Событие пишет действие, одним INSERT: ядро возвращает готовый ввод.
    expect(tables.spec_item_events).toHaveLength(1);
    expect(tables.spec_item_events[0]).toMatchObject({
      kind: "payment_added",
      spec_item_id: ITEM,
      org_id: ORG,
    });
  });

  it("наблюдатель не вносит оплату", async () => {
    const { client, tables } = fakeAdmin();
    adminMock.client = client;
    sessionMock.current.role = "viewer";

    const result = await createPayment("org-1", ITEM, form);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("FORBIDDEN");
    // Отказ приходит ДО записи: в журнале и в таблице ничего не появилось.
    expect(tables.spec_item_payments).toHaveLength(0);
    expect(tables.spec_item_events).toHaveLength(0);
  });

  it("повтор с тем же ключом возвращает запись и НЕ пишет второе событие", async () => {
    const { client, tables } = fakeAdmin();
    adminMock.client = client;

    const first = await createPayment("org-1", ITEM, form);
    const second = await createPayment("org-1", ITEM, form);

    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success) return;

    expect(first.data.id).toBe(second.data.id);
    expect(tables.spec_item_payments).toHaveLength(1);
    // Действия не было — записи о нём в журнале тоже нет.
    expect(tables.spec_item_events).toHaveLength(1);
  });

  it("повтор с другим телом — отказ с текстом ядра", async () => {
    const { client } = fakeAdmin();
    adminMock.client = client;

    await createPayment("org-1", ITEM, form);
    const second = await createPayment("org-1", ITEM, {
      ...form,
      amount: 5000,
    });

    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error).toContain("ключ");
  });

  it("мусор вместо формы отклоняется схемой до записи", async () => {
    const { client, tables } = fakeAdmin();
    adminMock.client = client;

    const result = await createPayment("org-1", ITEM, {
      ...form,
      amount: 0,
      idempotencyKey: "не-uuid",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
    expect(tables.spec_item_payments).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  update                                                             */
/* ------------------------------------------------------------------ */

describe("updatePayment", () => {
  const form = {
    kind: "payment" as const,
    amount: 4500,
    paidAt: "2026-10-06",
    paymentPlanId: PLAN_A,
    comment: null,
  };

  it("автор правит свою запись и пишет событие", async () => {
    const { client, tables } = fakeAdmin([paymentRow({ created_by: "user-1" })]);
    adminMock.client = client;

    const result = await updatePayment("org-1", ITEM, PAYMENT_A, form);

    expect(result.success).toBe(true);
    expect(tables.spec_item_events.map((row) => row.kind)).toEqual([
      "payment_changed",
    ]);
  });

  it("участник не правит чужую запись", async () => {
    const { client, tables } = fakeAdmin([paymentRow({ created_by: "user-2" })]);
    adminMock.client = client;

    const result = await updatePayment("org-1", ITEM, PAYMENT_A, form);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("FORBIDDEN");
    expect(tables.spec_item_events).toHaveLength(0);
    // Запись не тронута: отказ случился до вызова ядра.
    expect(tables.spec_item_payments[0].amount).toBe("4000.00");
  });

  it("администратор правит чужую запись", async () => {
    const { client } = fakeAdmin([paymentRow({ created_by: "user-2" })]);
    adminMock.client = client;
    sessionMock.current.role = "admin";

    const result = await updatePayment("org-1", ITEM, PAYMENT_A, form);

    expect(result.success).toBe(true);
  });

  it("наблюдатель не правит даже свою запись", async () => {
    const { client } = fakeAdmin([paymentRow({ created_by: "user-1" })]);
    adminMock.client = client;
    sessionMock.current.role = "viewer";

    const result = await updatePayment("org-1", ITEM, PAYMENT_A, form);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("FORBIDDEN");
  });

  it("несуществующая запись — NOT_FOUND, а не «нельзя»", async () => {
    const { client } = fakeAdmin([]);
    adminMock.client = client;

    const result = await updatePayment("org-1", ITEM, PAYMENT_A, form);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  delete                                                             */
/* ------------------------------------------------------------------ */

describe("deletePayment", () => {
  it("автор отменяет свою запись, событие уходит в журнал", async () => {
    const { client, tables } = fakeAdmin([paymentRow({ created_by: "user-1" })]);
    adminMock.client = client;

    const result = await deletePayment("org-1", ITEM, PAYMENT_A);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.deleted).toBe(true);
    expect(tables.spec_item_events.map((row) => row.kind)).toEqual([
      "payment_removed",
    ]);
  });

  it("участник не отменяет чужую запись", async () => {
    const { client, tables } = fakeAdmin([paymentRow({ created_by: "user-2" })]);
    adminMock.client = client;

    const result = await deletePayment("org-1", ITEM, PAYMENT_A);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("FORBIDDEN");
    expect(tables.spec_item_payments[0].deleted_at).toBeNull();
    expect(tables.spec_item_events).toHaveLength(0);
  });

  it("наблюдатель не отменяет оплату", async () => {
    const { client } = fakeAdmin([paymentRow({ created_by: "user-1" })]);
    adminMock.client = client;
    sessionMock.current.role = "viewer";

    const result = await deletePayment("org-1", ITEM, PAYMENT_A);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("FORBIDDEN");
  });
});
