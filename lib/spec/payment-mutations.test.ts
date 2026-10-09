import { describe, expect, it } from "vitest";
import {
  createPayment,
  hasActivePayments,
  listPayments,
  removePayment,
  todayIso,
  updatePayment,
  validatePaymentData,
  type PaymentsDb,
} from "./payment-mutations";
import type { PaymentData, PaymentError } from "./payment-types";
import type { SpecItemEventInput } from "./history";

/**
 * Ядро фактических оплат: запросы, проверки принадлежности, идемпотентность,
 * запись строки и снимок события — на подставном клиенте, без Next и без живой
 * БД.
 *
 * Проверяется ровно то, что нельзя проверить в арифметике (`./payment-schedule`):
 *
 *   * запись ищется по `id + org_id + spec_item_id`, а чужая позиция даёт
 *     `NOT_FOUND` — по коду отказа нельзя узнать о чужой строке ничего лишнего;
 *   * оплата ссылается только на строку графика СВОЕЙ позиции, и удалённая
 *     строка не годится тоже;
 *   * повторный запрос с тем же ключом идемпотентности возвращает уже созданную
 *     запись и НЕ пишет второе событие, а с другим телом — отказывает;
 *   * гонка двух вставок с одним ключом разбирается как «запись уже есть», а не
 *     как ошибка;
 *   * событие журнала получает снимок из СТРОКИ БД, а не из клиентского патча;
 *   * смена вида записи запрещена, удаление мягкое и повторяемо.
 *
 * Идентификаторы — настоящие UUID: Postgres сравнивает `uuid`-колонки как uuid,
 * и строки вида `item-1` проверяли бы форму, а не правило.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const OTHER_ITEM = "44444444-4444-4444-8444-444444444444";
const PLAN_A = "55555555-5555-4555-8555-555555555555";
const PLAN_OTHER_ITEM = "99999999-9999-4999-8999-999999999999";
const PAYMENT_A = "66666666-6666-4666-8666-666666666666";
const PAYMENT_DELETED = "77777777-7777-4777-8777-777777777777";
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-10-10T12:00:00.000Z");

const ACTOR = { id: "user-1", name: "Анна", email: "anna@studio.ru" };

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
    amount: "12000.00",
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

/** Строка графика. */
function planRow(over: Row = {}): Row {
  return {
    id: PLAN_A,
    org_id: ORG,
    project_id: PROJECT,
    spec_item_id: ITEM,
    title: "Аванс",
    amount: "10000.00",
    condition: null,
    due_date: null,
    position: 0,
    created_by: "user-1",
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

/**
 * Подставной клиент.
 *
 * Повторяет ровно те возможности, которыми пользуется ядро: выборку с фильтрами и
 * порядком, `select(..., { count, head })` для проверки «есть ли оплаты по
 * строке», вставку с ответом и `update` с патчем. Триггеры (`payment_sync_scope`)
 * и уникальный индекс идемпотентности воспроизведены явно: без них тест
 * проверял бы не правило, а заглушку.
 */
function fakeAdmin(
  seed: { payments?: Row[]; plans?: Row[] } = {},
) {
  const tables: Record<string, Row[]> = {
    spec_items: [
      { id: ITEM, org_id: ORG, project_id: PROJECT, deleted_at: null },
      { id: OTHER_ITEM, org_id: ORG, project_id: PROJECT, deleted_at: null },
    ],
    spec_item_payment_plans: seed.plans ?? [
      planRow(),
      planRow({ id: PLAN_OTHER_ITEM, spec_item_id: OTHER_ITEM }),
    ],
    spec_item_payments: seed.payments ?? [],
  };

  /** Строки, изменённые UPDATE'ом: по ним видно, что именно записалось. */
  const updated: { id: string; patch: Row }[] = [];

  /** Ошибка, которую следующая вставка отдаст вместо успеха (гонка). */
  let nextInsertError: { code: string; message: string } | null = null;

  /** Сколько раз читали таблицу оплат: по этому видно повторный запрос. */
  const reads: string[] = [];

  function from(table: string) {
    const eqs: [string, unknown][] = [];
    const isNull: string[] = [];
    let insertRow: Row | null = null;
    let patch: Row | null = null;
    let operation: "select" | "insert" | "update" = "select";
    let countRequested = false;
    let headOnly = false;
    let columns = "*";
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
      }) && isNull.every((column) => (row[column] ?? null) === null);

    const matched = () => (tables[table] ?? []).filter(matches);

    /** Вставка: триггер подставляет scope и снимки, индекс ловит дубль ключа. */
    const applyInsert = (row: Row) => {
      if (table === "spec_item_payments") {
        const key = row.idempotency_key ?? null;
        if (
          key !== null &&
          (tables.spec_item_payments ?? []).some(
            (existing) =>
              existing.idempotency_key === key && existing.org_id === row.org_id,
          )
        ) {
          return {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "spec_item_payments_idempotency_uidx"',
            },
          };
        }

        const item = (tables.spec_items ?? []).find(
          (candidate) => candidate.id === row.spec_item_id,
        );
        if (!item) {
          return {
            data: null,
            error: { code: "P0001", message: "SPEC_ITEM_NOT_FOUND" },
          };
        }

        // Триггер `payment_sync_scope`: организация, проект и снимки — из позиции.
        const stored: Row = {
          ...row,
          id: row.id ?? generatedId(),
          org_id: item.org_id,
          project_id: item.project_id,
          author_name_snapshot: row.author_name_snapshot ?? "Анна",
          code_snapshot: row.code_snapshot ?? "М-01",
          name_snapshot: row.name_snapshot ?? "Керамогранит",
          project_title_snapshot: row.project_title_snapshot ?? "Кухня",
          created_at: row.created_at ?? "2026-10-10T12:00:00.000Z",
          updated_at: row.updated_at ?? "2026-10-10T12:00:00.000Z",
          deleted_at: null,
        };
        tables[table] = [...(tables[table] ?? []), stored];
        return { data: stored, error: null };
      }

      const stored = { id: generatedId(), ...row };
      tables[table] = [...(tables[table] ?? []), stored];
      return { data: stored, error: null };
    };

    const finish = (): {
      data: Row[] | Row | null;
      error: unknown;
      count?: number;
    } => {
      if (operation === "insert") {
        if (nextInsertError) {
          const error = nextInsertError;
          nextInsertError = null;
          return { data: null, error };
        }
        return applyInsert(insertRow ?? {});
      }

      if (operation === "update") {
        const rows = matched();
        const patched = rows.map((row) => {
          const next = { ...row, ...(patch ?? {}) };
          const at = tables[table].indexOf(row);
          tables[table][at] = next;
          updated.push({ id: String(next.id), patch: patch ?? {} });
          return next;
        });
        return { data: patched, error: null };
      }

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

      // `head: true` — ответ без строк, но со счётчиком; `data` тогда `null`.
      if (headOnly) return { data: null, error: null, count: ordered.length };
      return { data: ordered, error: null, count: ordered.length };
    };

    /** Проекция колонок: `*` или перечисление — как у PostgREST. */
    const project = (row: Row): Row => {
      if (columns.trim() === "*") return row;
      return Object.fromEntries(
        columns.split(",").map((name) => {
          const key = name.trim();
          return [key, row[key] ?? null];
        }),
      );
    };

    const chain = {
      select(selected?: string, options?: { count?: string; head?: boolean }) {
        if (selected) columns = selected;
        countRequested = options?.count === "exact";
        headOnly = options?.head === true;
        if (table === "spec_item_payments") reads.push(operation);
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
      order(column: string, options?: { ascending?: boolean }) {
        orderBy.push({ column, ascending: options?.ascending !== false });
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
      maybeSingle: async () => {
        const result = finish();
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return { data: data ? project(data) : null, error: result.error };
      },
      single: async () => {
        const result = finish();
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return { data: data ? project(data) : null, error: result.error };
      },
      then: (
        resolve: (value: {
          data: unknown;
          error: unknown;
          count?: number | null;
        }) => unknown,
      ) => {
        const result = finish();
        return Promise.resolve(
          resolve({
            data: result.data,
            error: result.error,
            ...(countRequested ? { count: result.count ?? null } : {}),
          }),
        );
      },
    };

    return chain;
  }

  return {
    client: { from } as unknown as PaymentsDb,
    tables,
    updated,
    reads,
    /** Следующая вставка в оплаты упадёт этой ошибкой (гонка/отказ БД). */
    failNextInsert(error: { code: string; message: string }) {
      nextInsertError = error;
    },
  };
}

function errorCodeOf(result: {
  ok: boolean;
  error?: PaymentError;
}): PaymentError["code"] | undefined {
  return result.ok ? undefined : result.error?.code;
}

/** Данные записи: оплата 12 000 ₽ по строке PLAN_A. */
function data(over: Partial<PaymentData> = {}): PaymentData {
  return {
    kind: "payment",
    amount: 12000,
    paidAt: "2026-10-05",
    paymentPlanId: PLAN_A,
    comment: null,
    ...over,
  };
}

const base = { orgId: ORG, specItemId: ITEM, actor: ACTOR, idempotencyKey: KEY };

function eventOf(events: readonly SpecItemEventInput[]): SpecItemEventInput {
  expect(events).toHaveLength(1);
  return events[0];
}

/** Идентификаторы вставок: детерминированные, чтобы тест не зависел от среды. */
let idCounter = 0;
const generatedId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;

/* ------------------------------------------------------------------ */
/*  list                                                               */
/* ------------------------------------------------------------------ */

describe("listPayments", () => {
  it("отдаёт активные записи, поздние по дате оплаты — первыми", async () => {
    const { client } = fakeAdmin({
      payments: [
        paymentRow({ id: PAYMENT_A, paid_at: "2026-10-01" }),
        paymentRow({ id: PAYMENT_DELETED, paid_at: "2026-10-09" }),
      ],
    });

    const result = await listPayments(client, base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payments.map((payment) => payment.id)).toEqual([
      PAYMENT_DELETED,
      PAYMENT_A,
    ]);
    expect(result.payments[1]).toMatchObject({
      kind: "payment",
      amount: 12000,
      paidAt: "2026-10-01",
      paymentPlanId: PLAN_A,
      authorId: "user-1",
      authorName: "Анна",
      codeSnapshot: "М-01",
    });
  });

  it("мягко удалённые записи в список не попадают", async () => {
    const { client } = fakeAdmin({
      payments: [
        paymentRow({ id: PAYMENT_A }),
        paymentRow({
          id: PAYMENT_DELETED,
          deleted_at: "2026-10-06T10:00:00.000Z",
        }),
      ],
    });

    const result = await listPayments(client, base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payments.map((payment) => payment.id)).toEqual([PAYMENT_A]);
  });

  it("чужая организация — NOT_FOUND", async () => {
    const { client } = fakeAdmin();

    const result = await listPayments(client, {
      orgId: OTHER_ORG,
      specItemId: ITEM,
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  create                                                             */
/* ------------------------------------------------------------------ */

describe("createPayment", () => {
  it("записывает оплату и возвращает снимок записанной строки", async () => {
    const { client, tables } = fakeAdmin();

    const result = await createPayment(client, { ...base, data: data() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existing).toBe(false);
    expect(result.payment).toMatchObject({
      kind: "payment",
      amount: 12000,
      paidAt: "2026-10-05",
      paymentPlanId: PLAN_A,
      authorName: "Анна",
    });

    const stored = tables.spec_item_payments.at(-1)!;
    expect(stored.org_id).toBe(ORG);
    expect(stored.project_id).toBe(PROJECT);
    expect(stored.created_by).toBe("user-1");
    expect(stored.idempotency_key).toBe(KEY);
  });

  it("оплата без плана допустима", async () => {
    const { client } = fakeAdmin();

    const result = await createPayment(client, {
      ...base,
      data: data({ paymentPlanId: null }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment.paymentPlanId).toBeNull();
    expect(eventOf(result.events).payload).toMatchObject({ plan_id: null });
  });

  it("пустая дата означает сегодня, а не «без даты»", async () => {
    const { client, tables } = fakeAdmin();

    await createPayment(client, {
      ...base,
      data: data({ paidAt: "" }),
      now: NOW,
    });

    expect(tables.spec_item_payments.at(-1)!.paid_at).toBe(todayIso(NOW));
  });

  it("план чужой позиции отклоняется", async () => {
    const { client, tables } = fakeAdmin();

    const result = await createPayment(client, {
      ...base,
      data: data({ paymentPlanId: PLAN_OTHER_ITEM }),
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
    // Ничего не записалось: отказ случился до вставки.
    expect(tables.spec_item_payments).toHaveLength(0);
  });

  it("мягко удалённый план не годится для привязки", async () => {
    const { client } = fakeAdmin({
      plans: [
        planRow({ deleted_at: "2026-10-01T10:00:00.000Z" }),
        planRow({ id: PLAN_OTHER_ITEM, spec_item_id: OTHER_ITEM }),
      ],
    });

    const result = await createPayment(client, { ...base, data: data() });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });

  it("повторный запрос с тем же ключом возвращает уже созданную запись", async () => {
    const { client, tables } = fakeAdmin();

    const first = await createPayment(client, { ...base, data: data() });
    const second = await createPayment(client, { ...base, data: data() });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Второй запрос не создал второй оплаты и не написал второго события:
    // писать в журнал нечего, действия не было.
    expect(tables.spec_item_payments).toHaveLength(1);
    expect(second.existing).toBe(true);
    expect(second.events).toEqual([]);
    expect(second.payment.id).toBe(first.payment.id);
  });

  it("повтор с ДРУГИМ телом — отказ, а не чужая запись", async () => {
    const { client, tables } = fakeAdmin();

    await createPayment(client, { ...base, data: data() });
    const second = await createPayment(client, {
      ...base,
      data: data({ amount: 13000 }),
    });

    expect(errorCodeOf(second)).toBe("IDEMPOTENCY_CONFLICT");
    expect(tables.spec_item_payments).toHaveLength(1);
  });

  it("повтор с другим видом записи — тоже конфликт ключа", async () => {
    const { client } = fakeAdmin();

    await createPayment(client, { ...base, data: data() });
    const second = await createPayment(client, {
      ...base,
      data: data({ kind: "refund" }),
    });

    expect(errorCodeOf(second)).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("историю снимков повтор не переписывает: другое имя позиции — не конфликт", async () => {
    // Снимки берутся из позиции и на повторе могли бы отличаться (позицию
    // переименовали). Это не повод считать повтор другим намерением.
    const { client, tables } = fakeAdmin();

    await createPayment(client, { ...base, data: data() });
    tables.spec_item_payments[0].name_snapshot = "Другое название";

    const second = await createPayment(client, { ...base, data: data() });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.existing).toBe(true);
    expect(tables.spec_item_payments).toHaveLength(1);
  });

  it("гонка двух вставок с одним ключом читается как «запись уже есть»", async () => {
    // Победивший запрос уже записал строку, а наш проход по ключу её ещё не
    // увидел (иначе до вставки бы не дошло). Тогда БД отвечает 23505, и это
    // обязан быть ответ «та же запись», а не ошибка: пользователь нажал один раз.
    const racing = fakeAdmin({ payments: [paymentRow({ idempotency_key: KEY })] });
    racing.failNextInsert({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "spec_item_payments_idempotency_uidx"',
    });

    const result = await createPayment(racing.client, { ...base, data: data() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existing).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.payment.id).toBe(PAYMENT_A);
  });

  it("гонка с другим телом записи — конфликт ключа, а не «успех»", async () => {
    // Тот же разбор 23505, но победившая строка записана с другими данными:
    // ответить ею значило бы соврать о том, что записалось.
    const racing = fakeAdmin({
      payments: [paymentRow({ idempotency_key: KEY, amount: "999.00" })],
    });
    racing.failNextInsert({ code: "23505", message: "duplicate key" });

    const result = await createPayment(racing.client, { ...base, data: data() });

    expect(errorCodeOf(result)).toBe("IDEMPOTENCY_CONFLICT");
  });  it("событие пишется снимком записанной строки, а не введённых данных", async () => {
    const { client } = fakeAdmin();

    const result = await createPayment(client, {
      ...base,
      data: data({ amount: 2500, comment: "  Аванс по счёту  " }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = eventOf(result.events);
    expect(event.kind).toBe("payment_added");
    expect(event.specItemId).toBe(ITEM);
    expect(event.payload).toMatchObject({
      payment_id: result.payment.id,
      payment_kind: "payment",
      amount: 2500,
      paid_at: "2026-10-05",
      plan_id: PLAN_A,
    });
  });

  it("чужая позиция — NOT_FOUND и ничего не записано", async () => {
    const { client, tables } = fakeAdmin();

    const result = await createPayment(client, {
      ...base,
      specItemId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      data: data(),
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
    expect(tables.spec_item_payments).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  update                                                             */
/* ------------------------------------------------------------------ */

describe("updatePayment", () => {
  it("меняет сумму, дату, связь и комментарий, собирая таблицу изменений", async () => {
    const { client, tables } = fakeAdmin({
      payments: [paymentRow({ idempotency_key: null })],
    });

    const result = await updatePayment(client, {
      ...base,
      paymentId: PAYMENT_A,
      data: data({
        amount: 13000,
        paidAt: "2026-10-07",
        paymentPlanId: null,
        comment: "Оплачено по счёту",
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment).toMatchObject({ amount: 13000, paidAt: "2026-10-07" });

    const event = eventOf(result.events);
    expect(event.kind).toBe("payment_changed");
    // Таблица изменений — в устойчивом порядке полей формы, а не в порядке
    // перебора объекта: `jsonb` порядок ключей не сохраняет.
    const changes = (event.payload as { changes?: unknown }).changes;
    expect(changes).toEqual([
      { field: "amount", from: 12000, to: 13000 },
      { field: "paid_at", from: "2026-10-05", to: "2026-10-07" },
      { field: "payment_plan_id", from: PLAN_A, to: null },
      { field: "comment", from: null, to: "Оплачено по счёту" },
    ]);

    expect(tables.spec_item_payments[0].payment_plan_id).toBeNull();
  });

  it("сохранение без изменений события не даёт", async () => {
    const { client } = fakeAdmin({ payments: [paymentRow()] });

    const result = await updatePayment(client, {
      ...base,
      paymentId: PAYMENT_A,
      data: data(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([]);
  });

  it("вид записи изменить нельзя", async () => {
    const { client } = fakeAdmin({ payments: [paymentRow()] });

    const result = await updatePayment(client, {
      ...base,
      paymentId: PAYMENT_A,
      data: data({ kind: "refund" }),
    });

    expect(errorCodeOf(result)).toBe("INVALID_INPUT");
  });

  it("чужой платёж не правится: NOT_FOUND вместо «нельзя»", async () => {
    const { client } = fakeAdmin({ payments: [paymentRow()] });

    const result = await updatePayment(client, {
      ...base,
      specItemId: OTHER_ITEM,
      paymentId: PAYMENT_A,
      data: data(),
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });

  it("мягко удалённая запись не правится", async () => {
    const { client } = fakeAdmin({
      payments: [paymentRow({ deleted_at: "2026-10-06T10:00:00.000Z" })],
    });

    const result = await updatePayment(client, {
      ...base,
      paymentId: PAYMENT_A,
      data: data(),
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });

  it("привязка к строке графика чужой позиции отклоняется", async () => {
    const { client } = fakeAdmin({ payments: [paymentRow()] });

    const result = await updatePayment(client, {
      ...base,
      paymentId: PAYMENT_A,
      data: data({ paymentPlanId: PLAN_OTHER_ITEM }),
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  remove                                                             */
/* ------------------------------------------------------------------ */

describe("removePayment", () => {
  it("отменяет запись мягко и пишет событие со снимком до отмены", async () => {
    const { client, tables } = fakeAdmin({ payments: [paymentRow()] });

    const result = await removePayment(client, {
      ...base,
      paymentId: PAYMENT_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toBe(true);
    expect(tables.spec_item_payments[0].deleted_at).not.toBeNull();

    const event = eventOf(result.events);
    expect(event.kind).toBe("payment_removed");
    expect(event.payload).toMatchObject({
      payment_id: PAYMENT_A,
      amount: 12000,
      plan_id: PLAN_A,
    });
  });

  it("повторная отмена идемпотентна", async () => {
    const { client } = fakeAdmin({ payments: [paymentRow()] });

    const first = await removePayment(client, { ...base, paymentId: PAYMENT_A });
    const second = await removePayment(client, { ...base, paymentId: PAYMENT_A });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.deleted).toBe(true);
    expect(second.deleted).toBe(false);
    expect(second.events).toEqual([]);
  });

  it("чужой платёж не отменяется", async () => {
    const { client, tables } = fakeAdmin({ payments: [paymentRow()] });

    const result = await removePayment(client, {
      ...base,
      specItemId: OTHER_ITEM,
      paymentId: PAYMENT_A,
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
    expect(tables.spec_item_payments[0].deleted_at).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  проверки данных и вспомогательные читатели                         */
/* ------------------------------------------------------------------ */

describe("validatePaymentData", () => {
  it("отвергает нулевую и отрицательную сумму, незнакомый вид и пустой комментарий", () => {
    const cases: PaymentData[] = [
      data({ amount: 0 }),
      data({ amount: -1 }),
      data({ kind: "transfer" as PaymentData["kind"] }),
      data({ comment: "   " }),
    ];

    for (const invalid of cases) {
      const result = validatePaymentData(invalid, NOW);
      // Пустой комментарий — не ошибка: он нормализуется в `null`.
      if (invalid.comment === "   ") {
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        expect(result.values.comment).toBeNull();
        continue;
      }
      expect(result.ok, JSON.stringify(invalid)).toBe(false);
    }
  });
});

describe("todayIso", () => {
  it("отдаёт локальный день, а не UTC-сдвиг", () => {
    // 1 ноября 23:30 по местному времени: `toISOString()` вернул бы 31 октября
    // для любого часового пояса восточнее UTC — платёж уехал бы на день назад.
    const local = new Date(2026, 10, 1, 23, 30, 0);
    expect(todayIso(local)).toBe("2026-11-01");
  });
});

describe("hasActivePayments", () => {
  it("считает только неудалённые записи строки", async () => {
    const { client } = fakeAdmin({
      payments: [
        paymentRow({ id: PAYMENT_A }),
        paymentRow({ id: PAYMENT_DELETED, deleted_at: "2026-10-06T10:00:00.000Z" }),
      ],
    });

    const result = await hasActivePayments(client, {
      ...base,
      planId: PLAN_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(1);
  });
});
