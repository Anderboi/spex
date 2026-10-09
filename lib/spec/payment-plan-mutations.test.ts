import { describe, expect, it } from "vitest";
import {
  addPaymentPlan,
  listPaymentPlans,
  movePaymentPlanPosition,
  removePaymentPlan,
  updatePaymentPlan,
  type PaymentPlansDb,
} from "./payment-plan-mutations";
import type { PaymentPlanError } from "./payment-plan-types";
import type { SpecItemEventInput } from "./history";

/**
 * Ядро графика платежей: запросы, проверки принадлежности, запись строки и
 * снимок события — на подставном клиенте, без Next и без живой БД.
 *
 * Проверяется ровно то, что нельзя проверить в арифметике (`./payment-schedule`):
 *
 *   * строка ищется по `id + org_id + spec_item_id`, а чужая позиция даёт
 *     `NOT_FOUND` — по коду отказа нельзя узнать о чужой строке ничего лишнего;
 *   * новая строка встаёт в КОНЕЦ графика, а удалённые строки порядок не
 *     занимают;
 *   * событие журнала получает снимок из СТРОКИ БД, а не из клиентского патча;
 *   * удаление мягкое и повторяемо;
 *   * перестановка меняет порядок соседей и не оставляет дублей номера.
 *
 * Идентификаторы — настоящие UUID: Postgres сравнивает `uuid`-колонки как uuid,
 * и строки вида `item-1` проверяли бы форму, а не правило.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const OTHER_ITEM = "44444444-4444-4444-8444-444444444444";
/** Позиция, которой в БД нет вовсе: чужой id не должен ничего находить. */
const MISSING_ITEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLAN_A = "55555555-5555-4555-8555-555555555555";
const PLAN_B = "66666666-6666-4666-8666-666666666666";
const PLAN_C = "77777777-7777-4777-8777-777777777777";
const PLAN_DELETED = "88888888-8888-4888-8888-888888888888";
const PLAN_OTHER_ITEM = "99999999-9999-4999-8999-999999999999";
const PLAN_OTHER_ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ACTOR = { id: "user-1", name: "Анна", email: "anna@studio.ru" };

/* ------------------------------------------------------------------ */
/*  Подставной клиент                                                  */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Повторяет приведение к uuid в Postgres: не-uuid значение не совпадёт ни с чем. */
function asUuid(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

/** Строка графика, как её отдаёт PostgREST. */
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
      { id: OTHER_ITEM, org_id: ORG, project_id: PROJECT, deleted_at: null },
    ],
    spec_item_payment_plans: seed,
  };

  /** Строки, изменённые UPDATE'ом: по ним видно, сколько строк тронула операция. */
  const updated: { id: string; patch: Row }[] = [];

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
      if (orderBy.length === 0) return rows;
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
      return limitCount === null ? ordered : ordered.slice(0, limitCount);
    };

    const finish = () => {
      if (operation === "insert") {
        const stored = { id: "generated", ...insertRow };
        tables[table] = [...(tables[table] ?? []), stored];
        return { data: stored, error: null };
      }
      if (operation === "update") {
        const rows = matched();
        // Строка заменяется КОПИЕЙ, а не меняется на месте: иначе строка,
        // прочитанная до записи (`current`), оказалась бы тем же объектом, что
        // и записанная, и сравнение «было → стало» в тесте исчезло бы вместе с
        // самим правилом.
        const patched = rows.map((row) => {
          const next = { ...row, ...(patch ?? {}) };
          const at = tables[table].indexOf(row);
          tables[table][at] = next;
          updated.push({ id: String(next.id), patch: patch ?? {} });
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
      maybeSingle: () =>
        Promise.resolve({ data: first(finish()), error: null }),
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

  return {
    client: { from } as unknown as PaymentPlansDb,
    tables,
    updated,
  };
}

/** Событие, если оно есть: большинство проверок — про его payload. */
function eventOf(events: readonly SpecItemEventInput[]): SpecItemEventInput {
  expect(events).toHaveLength(1);
  return events[0];
}

function errorCodeOf(
  result: { ok: boolean; error?: PaymentPlanError },
): PaymentPlanError["code"] | undefined {
  return result.ok ? undefined : result.error?.code;
}

const base = { orgId: ORG, specItemId: ITEM };

/* ------------------------------------------------------------------ */
/*  list                                                               */
/* ------------------------------------------------------------------ */

describe("listPaymentPlans", () => {
  it("отдаёт активные строки графика по порядку", async () => {
    const { client } = fakeAdmin([
      planRow({ id: PLAN_B, position: 1 }),
      planRow({ id: PLAN_A, position: 0 }),
    ]);

    const result = await listPaymentPlans(client, base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plans.map((plan) => plan.id)).toEqual([PLAN_A, PLAN_B]);
    expect(result.plans[0]).toMatchObject({
      title: "Аванс",
      amount: 12000,
      condition: "После подписания договора",
      dueDate: "2026-11-01",
      position: 0,
      createdAt: "2026-10-01T10:00:00.000Z",
    });
  });

  it("мягко удалённые строки в список не попадают", async () => {
    const { client } = fakeAdmin([
      planRow({ id: PLAN_A, position: 0 }),
      planRow({
        id: PLAN_DELETED,
        position: 1,
        deleted_at: "2026-10-05T10:00:00.000Z",
      }),
    ]);

    const result = await listPaymentPlans(client, base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plans.map((plan) => plan.id)).toEqual([PLAN_A]);
  });

  it("чужая организация — NOT_FOUND", async () => {
    const { client } = fakeAdmin();

    const result = await listPaymentPlans(client, {
      orgId: OTHER_ORG,
      specItemId: ITEM,
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });

  it("удалённая позиция графика не отдаёт", async () => {
    const admin = fakeAdmin();
    admin.tables.spec_items[0] = {
      ...admin.tables.spec_items[0],
      deleted_at: "2026-10-05T10:00:00.000Z",
    };

    const result = await listPaymentPlans(admin.client, base);

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  add                                                                */
/* ------------------------------------------------------------------ */

describe("addPaymentPlan", () => {
  it("ставит новую строку в конец графика", async () => {
    const { client, tables } = fakeAdmin([
      planRow({ id: PLAN_A, position: 0 }),
      planRow({ id: PLAN_B, position: 1 }),
    ]);

    const result = await addPaymentPlan(client, {
      ...base,
      actor: ACTOR,
      data: { title: "Второй платёж", amount: 3500, condition: "", dueDate: null },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      title: "Второй платёж",
      amount: 3500,
      condition: null,
      dueDate: null,
      position: 2,
    });

    const stored = tables.spec_item_payment_plans.at(-1)!;
    expect(stored.org_id).toBe(ORG);
    expect(stored.project_id).toBe(PROJECT);
    expect(stored.created_by).toBe("user-1");
  });

  it("удалённые строки номер порядка не занимают", async () => {
    const { client } = fakeAdmin([
      planRow({ id: PLAN_A, position: 0 }),
      planRow({
        id: PLAN_DELETED,
        position: 1,
        deleted_at: "2026-10-05T10:00:00.000Z",
      }),
    ]);

    const result = await addPaymentPlan(client, {
      ...base,
      actor: ACTOR,
      data: { title: "Платёж", amount: 100, condition: null, dueDate: null },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Позиция 1 свободна: удалённая строка её не держит, иначе новая встала бы
    // после дыры, а порядок в интерфейсе выглядел бы произвольным.
    expect(result.plan.position).toBe(1);
  });

  it("событие пишется снимком записанной строки, а не введённых данных", async () => {
    const { client } = fakeAdmin([]);

    const result = await addPaymentPlan(client, {
      ...base,
      actor: ACTOR,
      data: {
        title: "  Аванс  ",
        amount: 12000,
        condition: "  После подписания  ",
        dueDate: "2026-11-01",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = eventOf(result.events);
    expect(event.kind).toBe("payment_plan_added");
    expect(event.specItemId).toBe(ITEM);
    // Снимок из строки БД: текст уже нормализован той же записью, что увидит
    // пользователь, а не тем, что прислал клиент.
    expect(event.payload).toMatchObject({
      plan_id: result.plan.id,
      title: "Аванс",
      amount: 12000,
      condition: "После подписания",
      due_date: "2026-11-01",
      position: 0,
    });
  });

  it("пустое условие записывается как null, а не пустой строкой", async () => {
    const { client, tables } = fakeAdmin([]);

    const result = await addPaymentPlan(client, {
      ...base,
      actor: ACTOR,
      data: { title: "Платёж", amount: 100, condition: "   ", dueDate: "  " },
    });

    expect(result.ok).toBe(true);
    expect(tables.spec_item_payment_plans.at(-1)).toMatchObject({
      condition: null,
      due_date: null,
    });
  });

  it("пустое название отклоняется", async () => {
    const { client, tables } = fakeAdmin([]);

    const result = await addPaymentPlan(client, {
      ...base,
      actor: ACTOR,
      data: { title: "   ", amount: 100, condition: null, dueDate: null },
    });

    expect(errorCodeOf(result)).toBe("INVALID_INPUT");
    expect(tables.spec_item_payment_plans).toHaveLength(0);
  });

  it("нечисловая и неположительная сумма отклоняются", async () => {
    const { client, tables } = fakeAdmin([]);

    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await addPaymentPlan(client, {
        ...base,
        actor: ACTOR,
        data: { title: "Платёж", amount, condition: null, dueDate: null },
      });

      expect(errorCodeOf(result), String(amount)).toBe("INVALID_INPUT");
    }

    expect(tables.spec_item_payment_plans).toHaveLength(0);
  });

  it("несуществующая позиция: строка не создаётся", async () => {
    const { client, tables } = fakeAdmin([]);

    const result = await addPaymentPlan(client, {
      orgId: ORG,
      specItemId: MISSING_ITEM,
      actor: ACTOR,
      data: { title: "Платёж", amount: 100, condition: null, dueDate: null },
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
    expect(tables.spec_item_payment_plans).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  update                                                             */
/* ------------------------------------------------------------------ */

describe("updatePaymentPlan", () => {
  it("меняет поля строки своей позиции", async () => {
    const { client } = fakeAdmin();

    const result = await updatePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
      data: {
        title: "Аванс 50 %",
        amount: 15000,
        condition: "До поставки",
        dueDate: "2026-12-01",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      title: "Аванс 50 %",
      amount: 15000,
      dueDate: "2026-12-01",
    });
  });

  it("событие содержит таблицу изменений по изменившимся полям", async () => {
    const { client } = fakeAdmin();

    const result = await updatePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
      data: {
        title: "Аванс",
        amount: 15000,
        condition: "После подписания договора",
        dueDate: "2026-11-01",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = eventOf(result.events);
    expect(event.kind).toBe("payment_plan_changed");
    // Изменилась только сумма — остальные поля патча совпали со строкой БД,
    // и в таблице изменений их быть не должно.
    expect(event.payload).toMatchObject({
      plan_id: PLAN_A,
      title: "Аванс",
      changes: [{ field: "amount", from: 12000, to: 15000 }],
    });
  });

  it("сохранение без изменений события не даёт", async () => {
    const { client } = fakeAdmin();

    const result = await updatePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
      data: {
        title: "Аванс",
        amount: 12000,
        condition: "После подписания договора",
        dueDate: "2026-11-01",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Событие на каждое сохранение формы засорило бы журнал одинаковыми
    // записями — тем же правилом живут `price_changed` и `variant_updated`.
    expect(result.events).toHaveLength(0);
  });

  it("снятие срока — это изменение, а не отсутствие правки", async () => {
    const { client } = fakeAdmin();

    const result = await updatePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
      data: {
        title: "Аванс",
        amount: 12000,
        condition: "После подписания договора",
        dueDate: null,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(eventOf(result.events).payload).toMatchObject({
      changes: [{ field: "due_date", from: "2026-11-01", to: null }],
    });
  });

  it("строка чужой позиции не находится", async () => {
    const { client } = fakeAdmin([
      planRow({ id: PLAN_OTHER_ITEM, spec_item_id: OTHER_ITEM }),
    ]);

    const result = await updatePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_OTHER_ITEM,
      data: { title: "Подмена", amount: 1, condition: null, dueDate: null },
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });

  it("мягко удалённая строка не правится повторно", async () => {
    const { client } = fakeAdmin([
      planRow({ id: PLAN_A, deleted_at: "2026-10-05T10:00:00.000Z" }),
    ]);

    const result = await updatePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
      data: { title: "Правка", amount: 1, condition: null, dueDate: null },
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });

  it("некорректные данные отклоняются до записи", async () => {
    const { client, updated } = fakeAdmin();

    const result = await updatePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
      data: { title: "", amount: 12000, condition: null, dueDate: null },
    });

    expect(errorCodeOf(result)).toBe("INVALID_INPUT");
    expect(updated).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  remove                                                             */
/* ------------------------------------------------------------------ */

describe("removePaymentPlan", () => {
  it("удаляет строку мягко и пишет событие снимком строки", async () => {
    const { client, tables } = fakeAdmin();

    const result = await removePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toBe(true);
    expect(tables.spec_item_payment_plans[0].deleted_at).not.toBeNull();

    const event = eventOf(result.events);
    expect(event.kind).toBe("payment_plan_removed");
    expect(event.payload).toMatchObject({
      plan_id: PLAN_A,
      title: "Аванс",
      amount: 12000,
    });
  });

  it("повторное удаление идемпотентно и события не повторяет", async () => {
    const { client } = fakeAdmin([
      planRow({ id: PLAN_A, deleted_at: "2026-10-05T10:00:00.000Z" }),
    ]);

    const result = await removePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toBe(false);
    expect(result.events).toHaveLength(0);
  });

  it("строка чужой организации не удаляется", async () => {
    const { client } = fakeAdmin([planRow({ id: PLAN_OTHER_ORG, org_id: OTHER_ORG })]);

    const result = await removePaymentPlan(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_OTHER_ORG,
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });
});

/* ------------------------------------------------------------------ */
/*  move                                                               */
/* ------------------------------------------------------------------ */

describe("movePaymentPlanPosition", () => {
  const seeded = () =>
    fakeAdmin([
      planRow({ id: PLAN_A, position: 0, title: "Аванс" }),
      planRow({ id: PLAN_B, position: 1, title: "Поставка" }),
      planRow({ id: PLAN_C, position: 2, title: "Остаток" }),
    ]);

  it("меняет порядок соседей местами", async () => {
    const { client, tables } = seeded();

    const result = await movePaymentPlanPosition(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_B,
      direction: "up",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(true);

    const positions = Object.fromEntries(
      tables.spec_item_payment_plans.map((row) => [row.id, row.position]),
    );
    expect(positions).toEqual({ [PLAN_B]: 0, [PLAN_A]: 1, [PLAN_C]: 2 });
  });

  it("порядок после перестановки — плотная нумерация без дублей", async () => {
    const { client, tables } = seeded();

    await movePaymentPlanPosition(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
      direction: "down",
    });

    const positions = tables.spec_item_payment_plans
      .map((row) => row.position as number)
      .sort((a, b) => a - b);
    // Частичный уникальный индекс не даёт двум строкам делить номер, поэтому
    // дубли здесь означали бы отказ БД, а не «странный порядок».
    expect(positions).toEqual([0, 1, 2]);
  });

  it("перестановка переписывает только участвующие строки", async () => {
    const { client, updated } = seeded();

    await movePaymentPlanPosition(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
      direction: "down",
    });

    // Шаг «увести в недостижимый диапазон» трогает РОВНО меняющиеся строки, а не
    // весь график: у каждой свой отрицательный номер, поэтому уникальный индекс
    // не нарушается, а третья строка не получает ни записи, ни нового
    // `updated_at` от триггера.
    const stashed = updated.filter((row) => row.patch.position === -1);
    expect(stashed.map((row) => row.id).sort()).toEqual([PLAN_A, PLAN_B]);

    // И только у них появился финальный номер.
    const finalWrites = updated.filter((row) => row.patch.position !== -1);
    expect(finalWrites.map((row) => row.id).sort()).toEqual([PLAN_A, PLAN_B]);
  });

  it("первую строку вверх не поднять: изменения не пишутся", async () => {
    const { client, updated } = seeded();

    const result = await movePaymentPlanPosition(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_A,
      direction: "up",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(false);
    expect(updated).toHaveLength(0);
  });

  it("последнюю строку вниз не опустить", async () => {
    const { client } = seeded();

    const result = await movePaymentPlanPosition(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_C,
      direction: "down",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(false);
  });

  it("незнакомая строка — NOT_FOUND, а не молчаливое «не двинулось»", async () => {
    const { client } = seeded();

    const result = await movePaymentPlanPosition(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_OTHER_ITEM,
      direction: "up",
    });

    expect(errorCodeOf(result)).toBe("NOT_FOUND");
  });

  it("перестановка пишет событие изменения порядка", async () => {
    const { client } = seeded();

    const result = await movePaymentPlanPosition(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_C,
      direction: "up",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = eventOf(result.events);
    expect(event.kind).toBe("payment_plan_changed");
    // В payload — та же таблица изменений, что у правки полей: второго формата
    // события у одного вида быть не должно.
    expect(event.payload).toMatchObject({
      plan_id: PLAN_C,
      changes: [{ field: "position", from: 2, to: 1 }],
    });
  });

  it("удалённые строки в перестановке не участвуют", async () => {
    const { client, tables } = fakeAdmin([
      planRow({ id: PLAN_A, position: 0 }),
      planRow({
        id: PLAN_DELETED,
        position: 1,
        deleted_at: "2026-10-05T10:00:00.000Z",
      }),
      planRow({ id: PLAN_B, position: 2 }),
    ]);

    const result = await movePaymentPlanPosition(client, {
      ...base,
      actor: ACTOR,
      planId: PLAN_B,
      direction: "up",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(true);

    const positions = Object.fromEntries(
      tables.spec_item_payment_plans.map((row) => [row.id, row.position]),
    );
    // Строка переставляется с ближайшим АКТИВНЫМ соседом: удалённая строка не
    // оставляет после себя дыру в порядке.
    expect(positions[PLAN_B]).toBe(0);
    expect(positions[PLAN_A]).toBe(1);
  });
});
