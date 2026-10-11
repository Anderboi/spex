import { describe, expect, it } from "vitest";

import { listCancelledPayments } from "./payment-mutations";
import { PAYMENT_ENTRY_COLUMNS } from "./payment-mutations";

/**
 * Отменённые оплаты, привязанные к строкам графика.
 *
 * ── Зачем отдельное чтение ─────────────────────────────────────────────────
 *
 * Отмена оплаты (мягкое удаление) возвращает её строку графика в «Не оплачено» —
 * это решение Q29: обязательство снова открыто. Но правило «связь с отменённой
 * оплатой показывается пометкой, а не исчезает молча» продолжает действовать, и
 * чтобы пометка появилась, отменённые факты нужно прочитать: в список живых
 * оплат они не попадают.
 *
 * ── Что здесь проверяется ──────────────────────────────────────────────────
 *
 * Только выборка: отменённые строки по этой позиции и в серверном порядке.
 * Соединение пометки со строкой плана — дело чистой функции
 * (`./payment-rows`), и второй её копии в запросе быть не должно.
 *
 * Идентификаторы — настоящие UUID: `uuid`-колонки Postgres сравнивает как uuid,
 * и строки вида `item-1` проверяли бы форму, а не правило.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const OTHER_ITEM = "44444444-4444-4444-8444-444444444444";
const PLAN_A = "55555555-5555-4555-8555-555555555555";
const PAYMENT_A = "66666666-6666-4666-8666-666666666666";
const PAYMENT_B = "66666666-6666-4666-8666-777777777777";
const PAYMENT_LIVE = "66666666-6666-4666-8666-888888888888";

type Row = Record<string, unknown>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Повторяет приведение к uuid в Postgres: не-uuid значение не совпадёт ни с чем. */
function asUuid(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

/** Строка оплаты, как её отдаёт PostgREST. */
function paymentRow(over: Row = {}): Row {
  return {
    id: PAYMENT_A,
    org_id: ORG,
    project_id: PROJECT,
    spec_item_id: ITEM,
    kind: "payment",
    amount: "10000.00",
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
 * Подставной клиент: выборка с фильтрами, «не пусто/пусто» и порядком.
 *
 * Повторяет ровно то, чем пользуется чтение, и ничего сверх: подставной клиент,
 * умеющий больше ядра, проверял бы сам себя.
 */
function fakeAdmin(seed: { payments?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    spec_items: [
      { id: ITEM, org_id: ORG, project_id: PROJECT, deleted_at: null },
      { id: OTHER_ITEM, org_id: ORG, project_id: PROJECT, deleted_at: null },
    ],
    spec_item_payments: seed.payments ?? [],
  };

  function from(table: string) {
    const eqs: [string, unknown][] = [];
    const notNull: string[] = [];
    const orderBy: { column: string; ascending: boolean }[] = [];

    const matches = (row: Row) =>
      eqs.every(([column, value]) => {
        const expected = asUuid(value);
        if (expected === null) return false;
        const actual =
          typeof row[column] === "string"
            ? (row[column] as string).toLowerCase()
            : row[column];
        return actual === expected;
      }) && notNull.every((column) => (row[column] ?? null) !== null);

    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        eqs.push([column, value]);
        return chain;
      },
      not(column: string, operator: string, value: unknown) {
        if (operator === "is" && value === null) notNull.push(column);
        return chain;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderBy.push({ column, ascending: options?.ascending !== false });
        return chain;
      },
      maybeSingle: async () => {
        const rows = (tables[table] ?? []).filter(matches);
        return { data: rows[0] ?? null, error: null };
      },
      then: (
        resolve: (value: { data: Row[] | null; error: unknown }) => unknown,
      ) => {
        const rows = (tables[table] ?? []).filter(matches);
        const ordered = [...rows].sort((a, b) => {
          for (const { column, ascending } of orderBy) {
            const left = a[column] as never;
            const right = b[column] as never;
            if (left === right) continue;
            const result = left < right ? -1 : 1;
            return ascending ? result : -result;
          }
          return 0;
        });
        return Promise.resolve(resolve({ data: ordered, error: null }));
      },
    };

    return chain;
  }

  return { client: { from } as never };
}

describe("listCancelledPayments", () => {
  it("отдаёт только отменённые записи, поздние по дате — первыми", async () => {
    const { client } = fakeAdmin({
      payments: [
        paymentRow({ id: PAYMENT_A, paid_at: "2026-10-01" }),
        paymentRow({
          id: PAYMENT_B,
          paid_at: "2026-10-08",
          deleted_at: "2026-10-09T10:00:00.000Z",
        }),
      ],
    });

    const result = await listCancelledPayments(client, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payments.map((payment) => payment.id)).toEqual([PAYMENT_B]);
    // Пометка называет дату ПРОВОДКИ: «оплата от 8 октября отменена» — дата
    // отмены ничего не говорит о том, какое обязательство снова открыто.
    expect(result.payments[0]).toMatchObject({
      paidAt: "2026-10-08",
      amount: 10000,
      paymentPlanId: PLAN_A,
    });
  });

  it("отменённые записи БЕЗ плана не отдаются: строки им в списке нет", async () => {
    // Строку в списке составляет план. Отменённая оплата без плана не
    // прикреплена ни к чему, и показать её значило бы показать одну пометку без
    // обязательства, к которому она относится.
    const { client } = fakeAdmin({
      payments: [
        paymentRow({
          id: PAYMENT_B,
          payment_plan_id: null,
          deleted_at: "2026-10-09T10:00:00.000Z",
        }),
      ],
    });

    const result = await listCancelledPayments(client, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payments).toEqual([]);
  });

  it("живые записи в отменённые не попадают", async () => {
    const { client } = fakeAdmin({
      payments: [paymentRow({ id: PAYMENT_LIVE })],
    });

    const result = await listCancelledPayments(client, {
      orgId: ORG,
      specItemId: ITEM,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payments).toEqual([]);
  });

  it("чужая позиция — NOT_FOUND", async () => {
    const { client } = fakeAdmin();

    const result = await listCancelledPayments(client, {
      orgId: ORG,
      specItemId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("чужая организация — NOT_FOUND", async () => {
    const { client } = fakeAdmin();

    const result = await listCancelledPayments(client, {
      orgId: OTHER_ORG,
      specItemId: ITEM,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("колонки чтения не расходятся с колонками остальных операций", async () => {
    // Отменённая запись — та же строка таблицы: своего списка колонок у неё
    // быть не должно, иначе одно из двух чтений отдавало бы клиенту другую
    // запись под тем же `PaymentEntry`.
    expect(PAYMENT_ENTRY_COLUMNS).toContain("deleted_at");
  });
});
