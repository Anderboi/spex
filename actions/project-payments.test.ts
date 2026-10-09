import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Тесты серверной читалки денег проекта для строки оплат в воронке закупки
 * (тикет 04).
 *
 * Проверяется слой НАД арифметикой: что в область воронки попадают ТЕ ЖЕ
 * позиции, что и в «Сумму в закупке», что деньги вне области не растворяются в
 * итоге и что чужая организация их не видит. Сама формула остатка живёт в
 * `lib/spec/payment-schedule` и покрыта там — здесь она не пересчитывается,
 * иначе тест подтверждал бы сам себя.
 *
 * ── Почему подставной клиент, а не живая БД ────────────────────────────────
 *
 * Действие читает таблицы service-role клиентом; живая БД в unit-прогоне
 * недоступна и не нужна. Подставной клиент отвечает на те цепочки
 * (`select/eq/is/in/order`), которые действие действительно вызывает: если
 * запрос изменится, тест это заметит по отсутствию данных, а не по молчаливому
 * совпадению.
 *
 * ── Сессия ─────────────────────────────────────────────────────────────────
 *
 * `requireOrgBySlug` подменяется модульным моком: реальная сессия требует
 * next-auth. Организация в моке — то, чем действие ограничивает КАЖДЫЙ запрос,
 * и это отдельно проверяется ниже.
 */

const sessionMock = vi.hoisted(() => ({
  current: {
    userId: "user-1",
    user: { name: "Анна", email: "anna@studio.ru" },
    orgId: "11111111-1111-4111-8111-111111111111",
    orgSlug: "org-1",
    // `viewer` намеренно: тикет требует, чтобы цифры были видны и наблюдателю.
    role: "viewer" as "owner" | "admin" | "member" | "viewer",
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireOrgBySlug: async () => ({ ...sessionMock.current }),
}));

const adminMock = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminMock.client,
}));

import { getProjectPaymentsSummary } from "./project-payments";

type Row = Record<string, unknown>;

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const APPROVED = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ORDERED = "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const DRAFT = "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const PLACEHOLDER = "aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const DELETED = "aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const FOREIGN = "aaaaaaa6-aaaa-4aaa-8aaa-aaaaaaaaaaa6";

/**
 * Подставной admin-клиент: цепочки PostgREST над таблицами в памяти.
 *
 * Поддерживаются только те методы, которые действие действительно зовёт.
 * Фильтры складываются и применяются при `await` — как в настоящем клиенте, где
 * результатом цепочки становится thenable.
 */
function fakeAdmin(tables: Record<string, Row[]>) {
  function from(table: string) {
    const eqs: [string, unknown][] = [];
    const isNull: string[] = [];

    const matches = (row: Row) =>
      eqs.every(([column, value]) => row[column] === value) &&
      isNull.every((column) => (row[column] ?? null) === null);

    const chain = {
      select() {
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
      then(
        resolve: (value: { data: Row[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        const data = (tables[table] ?? []).filter(matches);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };

    return chain;
  }

  return { from };
}

/** Позиция для подставного клиента. */
function itemRow(over: Row = {}): Row {
  return {
    id: APPROVED,
    org_id: ORG,
    project_id: PROJECT,
    status: "approved",
    is_placeholder: false,
    deleted_at: null,
    ...over,
  };
}

/**
 * Строка графика.
 *
 * `org_id` и `project_id` обязательны здесь не для полноты: действие
 * ограничивает КАЖДЫЙ запрос организацией сессии и проектом, и подставной
 * клиент применяет эти условия. Строка без них не проходит фильтр — ровно так,
 * как не прошла бы и в настоящей БД.
 */
function planRow(
  specItemId: string,
  amount: number | string,
  over: Row = {},
): Row {
  return {
    spec_item_id: specItemId,
    org_id: ORG,
    project_id: PROJECT,
    amount,
    deleted_at: null,
    ...over,
  };
}

/** Строка факта. Организация и проект — по той же причине, что у графика. */
function paymentRow(specItemId: string, over: Row = {}): Row {
  return {
    spec_item_id: specItemId,
    org_id: ORG,
    project_id: PROJECT,
    kind: "payment",
    amount: 1000,
    payment_plan_id: null,
    deleted_at: null,
    ...over,
  };
}

/** Набор таблиц по умолчанию: две позиции в воронке. */
function seed(over: {
  items?: Row[];
  plans?: Row[];
  payments?: Row[];
} = {}) {
  return {
    spec_items: over.items ?? [
      itemRow({ id: APPROVED, status: "approved" }),
      itemRow({ id: ORDERED, status: "ordered" }),
    ],
    spec_item_payment_plans: over.plans ?? [
      planRow(APPROVED, 10000),
      planRow(ORDERED, 5000),
    ],
    spec_item_payments: over.payments ?? [
      paymentRow(APPROVED, { amount: 4000, payment_plan_id: null }),
    ],
  };
}

function setup(over: Parameters<typeof seed>[0] = {}) {
  adminMock.client = fakeAdmin(seed(over));
}

beforeEach(() => {
  sessionMock.current.role = "viewer";
  setup();
});

describe("getProjectPaymentsSummary · область воронки", () => {
  it("считает план и факт по позициям воронки", async () => {
    const result = await getProjectPaymentsSummary("org-1", PROJECT);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.planned).toBe(15000);
    expect(result.data.scope.paid).toBe(4000);
    expect(result.data.scope.remaining).toBe(11000);
    expect(result.data.scope.overpaid).toBe(0);
  });

  it("позиция вне воронки в итог не входит, а отмечается отдельно", async () => {
    // «Подобрано» — вне воронки закупки: её деньги не часть «Суммы в закупке»,
    // но и молча исчезнуть не должны.
    setup({
      items: [
        itemRow({ id: APPROVED, status: "approved" }),
        itemRow({ id: DRAFT, status: "draft" }),
      ],
      plans: [planRow(APPROVED, 10000)],
      payments: [
        paymentRow(APPROVED, { amount: 4000 }),
        paymentRow(DRAFT, { amount: 2500 }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.paid).toBe(4000);
    expect(result.data.outOfScopeCount).toBe(1);
    expect(result.data.outOfScopeNet).toBe(2500);
  });

  it("заглушка вне воронки: у неё нет ни цены, ни обязательства", async () => {
    setup({
      items: [
        itemRow({ id: APPROVED, status: "approved" }),
        itemRow({ id: PLACEHOLDER, status: "approved", is_placeholder: true }),
      ],
      plans: [],
      payments: [
        paymentRow(APPROVED, { amount: 1000 }),
        paymentRow(PLACEHOLDER, { amount: 9999 }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.paid).toBe(1000);
    expect(result.data.outOfScopeCount).toBe(1);
    expect(result.data.outOfScopeNet).toBe(9999);
  });

  it("позиция вне воронки с одним графиком тоже попадает в счётчик", async () => {
    // Счётчик отвечает на вопрос «есть ли деньги мимо этой суммы», поэтому
    // считает позиции с графиком ИЛИ с оплатами: черновик с планом, но без
    // оплат — тоже повод сказать, что за пределами строки что-то есть. Сальдо
    // при этом нулевое, и именно поэтому признак несёт счётчик, а не сумма.
    setup({
      items: [
        itemRow({ id: APPROVED, status: "approved" }),
        itemRow({ id: DRAFT, status: "draft" }),
      ],
      plans: [planRow(APPROVED, 10000), planRow(DRAFT, 5000)],
      payments: [paymentRow(APPROVED, { amount: 4000 })],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.planned).toBe(10000);
    expect(result.data.outOfScopeCount).toBe(1);
    expect(result.data.outOfScopeNet).toBe(0);
  });

  it("сальдо мимо области бывает отрицательным: возвратов больше, чем оплат", async () => {
    // Отдельный кейс, потому что знак здесь несут данные, а не оформление:
    // вкладка показывает его как есть, и модалка обязана не потерять знак.
    setup({
      items: [
        itemRow({ id: APPROVED, status: "approved" }),
        itemRow({ id: DRAFT, status: "draft" }),
      ],
      plans: [],
      payments: [
        paymentRow(APPROVED, { amount: 1000 }),
        paymentRow(DRAFT, { amount: 500 }),
        paymentRow(DRAFT, { amount: 2000, kind: "refund" }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.outOfScopeCount).toBe(1);
    expect(result.data.outOfScopeNet).toBe(-1500);
  });

  it("мягко удалённая позиция не считается ни в итоге, ни в «мимо»", async () => {
    // Строку удалили — её деньги не показываются нигде: ни в сумме закупки, ни
    // как «оплаты мимо области». Отдельная пометка «мимо» означала бы, что
    // воронка предлагает разбираться с уже удалённой позицией.
    setup({
      items: [
        itemRow({ id: APPROVED, status: "approved" }),
        itemRow({ id: DELETED, status: "approved", deleted_at: "2026-10-01T00:00:00.000Z" }),
      ],
      plans: [],
      payments: [
        paymentRow(APPROVED, { amount: 1000 }),
        paymentRow(DELETED, { amount: 7777 }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.paid).toBe(1000);
    expect(result.data.outOfScopeCount).toBe(0);
    expect(result.data.outOfScopeNet).toBe(0);
  });

  it("возвраты уменьшают оплаченное и виден признак превышения", async () => {
    setup({
      items: [itemRow({ id: APPROVED, status: "approved" })],
      plans: [planRow(APPROVED, 10000)],
      payments: [
        paymentRow(APPROVED, { amount: 3000 }),
        paymentRow(APPROVED, { amount: 5000, kind: "refund" }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.paid).toBe(-2000);
    expect(result.data.scope.refunded).toBe(5000);
    expect(result.data.scope.refundsExceedPayments).toBe(true);
  });

  it("позиция без графика даёт «вне графика», а не переплату", async () => {
    setup({
      items: [itemRow({ id: APPROVED, status: "approved" })],
      plans: [],
      payments: [paymentRow(APPROVED, { amount: 3000 })],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.overpaid).toBe(0);
    expect(result.data.scope.remaining).toBe(0);
    expect(result.data.scope.unplanned).toBe(3000);
  });

  it("пустой проект — нули и ни одной позиции мимо", async () => {
    setup({ items: [], plans: [], payments: [] });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.planned).toBe(0);
    expect(result.data.scope.paid).toBe(0);
    expect(result.data.outOfScopeCount).toBe(0);
    expect(result.data.outOfScopeNet).toBe(0);
  });
});

describe("getProjectPaymentsSummary · формула совпадает с вкладкой", () => {
  it("итог по области равен сумме расчётов по её позициям", async () => {
    // Требование тикета: формула строки совпадает с расчётом вкладки карточки.
    //
    // Ожидания посчитаны РУКАМИ и записаны литералами. Прежняя версия этого
    // теста собирала ожидание вызовом `summarisePaymentSchedule` — той самой
    // функции, которую агрегат зовёт внутри, — и не могла упасть ни при какой
    // ошибке формулы: `f(x) === f(x)`. Такой тест подтверждает сам себя.
    //
    // По позициям:
    //   `approved`: план 0.34, оплата 0.10 → остаток 0.24, переплаты нет.
    //   `ordered`:  план 12.25, оплата 20.00 и возврат 1.05 → оплачено 18.95,
    //               переплата 6.70, остатка нет.
    //   итог:       план 12.59, оплачено 19.05, остаток 0.24, переплата 6.70.
    //
    // Главное здесь — последняя пара: 0.24 и 6.70, а не 12.59 − 19.05. Если
    // считать «одним котлом», переплата по `ordered` погасила бы остаток по
    // `approved` и получился бы остаток 0 при переплате 6.46. Ровно от этой
    // подмены агрегат и защищает: вкладка считает каждую позицию отдельно.
    setup({
      items: [
        itemRow({ id: APPROVED, status: "approved" }),
        itemRow({ id: ORDERED, status: "ordered" }),
      ],
      plans: [planRow(APPROVED, "0.34"), planRow(ORDERED, "12.25")],
      payments: [
        paymentRow(APPROVED, { amount: "0.10" }),
        paymentRow(ORDERED, { amount: "20.00" }),
        paymentRow(ORDERED, { amount: "1.05", kind: "refund" }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.planned).toBe(12.59);
    expect(result.data.scope.paid).toBe(19.05);
    expect(result.data.scope.remaining).toBe(0.24);
    expect(result.data.scope.overpaid).toBe(6.7);
    expect(result.data.scope.refunded).toBe(1.05);
  });
});

describe("getProjectPaymentsSummary · изоляция организации", () => {
  it("сессия viewer: цифры видны", async () => {
    // Решение Q3 и тикет: чтение доступно любому члену, включая наблюдателя.
    sessionMock.current.role = "viewer";

    const result = await getProjectPaymentsSummary("org-1", PROJECT);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.scope.planned).toBe(15000);
  });

  it("оплаты чужой организации не попадают в итог", async () => {
    // Ключевая защита: `orgSlug` приходит с клиента, поэтому область видимости
    // задаёт СЕССИЯ. Строки чужой организации лежат в тех же таблицах и с тем же
    // `project_id` — если фильтр по организации пропадёт, они сложатся в итог.
    setup({
      items: [
        itemRow({ id: APPROVED, status: "approved" }),
        itemRow({ id: FOREIGN, status: "approved", org_id: OTHER_ORG }),
      ],
      plans: [planRow(APPROVED, 10000), planRow(FOREIGN, 500000)],
      payments: [
        paymentRow(APPROVED, { amount: 4000 }),
        paymentRow(FOREIGN, { amount: 500000, org_id: OTHER_ORG }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.planned).toBe(10000);
    expect(result.data.scope.paid).toBe(4000);
    // Чужая позиция не попадает и в «мимо»: это не деньги проекта пользователя.
    expect(result.data.outOfScopeCount).toBe(0);
    expect(result.data.outOfScopeNet).toBe(0);
  });

  it("оплаты другого проекта той же организации не попадают в итог", async () => {
    setup({
      items: [itemRow({ id: APPROVED, status: "approved" })],
      plans: [planRow(APPROVED, 10000)],
      payments: [
        paymentRow(APPROVED, { amount: 4000 }),
        paymentRow(APPROVED, { amount: 9000, project_id: OTHER_PROJECT }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.paid).toBe(4000);
  });

  it("мягко удалённая оплата не считается", async () => {
    setup({
      items: [itemRow({ id: APPROVED, status: "approved" })],
      plans: [planRow(APPROVED, 10000)],
      payments: [
        paymentRow(APPROVED, { amount: 4000 }),
        paymentRow(APPROVED, {
          amount: 9999,
          deleted_at: "2026-10-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.paid).toBe(4000);
  });

  it("мягко удалённая строка графика не считается", async () => {
    setup({
      items: [itemRow({ id: APPROVED, status: "approved" })],
      plans: [
        planRow(APPROVED, 10000),
        planRow(APPROVED, 9999, { deleted_at: "2026-10-02T00:00:00.000Z" }),
      ],
      payments: [],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.planned).toBe(10000);
  });
});

describe("getProjectPaymentsSummary · отказ чтения", () => {
  it("ошибка БД превращается в понятный отказ, а не в нули", async () => {
    // Нули выглядели бы как «оплат нет» — то есть как ответ. Отказ обязан быть
    // отказом: модалка покажет это отдельно, а не пустую строку.
    adminMock.client = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: { message: "boom" },
            }).then(resolve),
        };
        return chain;
      },
    };

    const result = await getProjectPaymentsSummary("org-1", PROJECT);

    expect(result.success).toBe(false);
  });
});
