import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Тесты серверной читалки денег проекта для строки оплат в воронке закупки
 * (тикет 09; прежде — тикет 04).
 *
 * Проверяется слой НАД арифметикой: что в область воронки попадают ТЕ ЖЕ
 * позиции, что и в «Сумму в закупке», что стоимость считается тем же `priceOf`,
 * что и у конструктора, что деньги вне области не растворяются в итоге и что
 * чужая организация их не видит. Сама формула остатка живёт в
 * `lib/spec/payment-schedule` и покрыта там — здесь она не пересчитывается,
 * иначе тест подтверждал бы сам себя.
 *
 * ── Почему подставной клиент и подменённый читатель позиций ────────────────
 *
 * Действие читает оплаты service-role клиентом, а позиции — `getProjectSpecItems`
 * (`lib/queries`): только он применяет активный вариант позиции, без которого
 * стоимость разошлась бы с «Суммой в закупке» на экране. Живая БД в unit-прогоне
 * недоступна и не нужна, поэтому клиент подставной, а читатель позиций —
 * модульный мок: подменить его честнее, чем подсовывать строки `spec_items`,
 * которых действие больше не читает.
 *
 * Подставной клиент отвечает на те цепочки (`select/eq/is`), которые действие
 * действительно вызывает, и записывает имена таблиц: тест «график не читается»
 * держится на этом списке, а не на догадке.
 *
 * ── Сессия ─────────────────────────────────────────────────────────────────
 *
 * `requireOrgBySlug` подменяется модульным моком: реальная сессия требует
 * next-auth. Организация в моке — то, чем действие ограничивает запрос оплат, и
 * это отдельно проверяется ниже.
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

const adminMock = vi.hoisted(() => ({
  client: null as unknown,
  /** Таблицы, которые действие действительно читало. */
  tables: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminMock.client,
}));

const itemsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/queries", () => ({
  getProjectSpecItems: itemsMock,
}));

import { getProjectPaymentsSummary } from "./project-payments";
import type { SpecItem } from "@/lib/types";

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
    adminMock.tables.push(table);

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

/**
 * Позиция так, как её отдаёт `getProjectSpecItems`.
 *
 * Заполнены ВСЕ поля модели, а не только читаемые действием: приведение типа
 * (`as SpecItem`) скрыло бы, что читатель позиций перестал их отдавать, — а
 * стоимость зависит от `qty`, `price`, `stockPct` и `clientDiscountPct`.
 */
function specItem(over: Partial<SpecItem> = {}): SpecItem {
  return {
    id: APPROVED,
    projectId: PROJECT,
    materialId: null,
    companyId: null,
    contactId: null,
    companyName: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    imageUrl: null,
    code: "С-01",
    type: "Отделка",
    name: "Позиция",
    brand: "",
    spec: "",
    article: "",
    qty: 1,
    unit: "шт",
    price: 10000,
    stockPct: 0,
    clientDiscountPct: 0,
    supplierDiscountPct: 0,
    status: "approved",
    isPlaceholder: false,
    position: 0,
    rooms: [],
    notes: "",
    leadTime: "",
    avail: "",
    attrs: {},
    updatedAt: "2026-10-01T00:00:00.000Z",
    product_url: "",
    product_type: "",
    variants: [],
    activeVariantId: null,
    parentId: null,
    ...over,
  };
}

/** Строка факта. Организация и проект — то, чем действие ограничивает запрос. */
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

/**
 * Набор по умолчанию: две позиции воронки стоимостью 10 000 и 5 000, оплачено
 * 4 000.
 */
function setup(
  over: { items?: SpecItem[]; payments?: Row[] } = {},
) {
  adminMock.tables = [];
  adminMock.client = fakeAdmin({
    spec_item_payments: over.payments ?? [
      paymentRow(APPROVED, { amount: 4000 }),
    ],
  });
  itemsMock.mockResolvedValue(
    over.items ?? [
      specItem({ id: APPROVED, price: 10000 }),
      specItem({ id: ORDERED, status: "ordered", price: 5000 }),
    ],
  );
}

beforeEach(() => {
  sessionMock.current.role = "viewer";
  itemsMock.mockReset();
  setup();
});

describe("getProjectPaymentsSummary · область воронки", () => {
  it("считает оплачено, остаток и процент от стоимости позиций", async () => {
    const result = await getProjectPaymentsSummary("org-1", PROJECT);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.total).toBe(15000);
    expect(result.data.scope.paid).toBe(4000);
    expect(result.data.scope.remaining).toBe(11000);
    expect(result.data.scope.overpaid).toBe(0);
    // Покрыто 15 000 − 11 000 = 4 000 из 15 000 — 26.67 %, в подписи 27.
    expect(result.data.scope.percent).toBe(27);
  });

  it("график не читается вовсе: обязательство берётся из стоимости", async () => {
    // Ключевая проверка тикета: прежняя редакция складывала ПЛАН и показывала
    // «план 195 281 ₽» рядом с «Суммой в закупке 1 661 775 ₽». Теперь плановая
    // сумма не участвует ни в арифметике, ни в чтении — таблица графика не
    // запрашивается, и «план» не может вернуться случайно.
    setup({
      items: [specItem({ id: APPROVED, price: 10000 })],
      payments: [paymentRow(APPROVED, { amount: 12000 })],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // 12 000 при стоимости 10 000 — переплата 2 000, а не «план исчерпан».
    expect(result.data.scope.overpaid).toBe(2000);
    expect(result.data.scope.remaining).toBe(0);
    expect(result.data.scope.percent).toBe(100);
    expect(adminMock.tables).toEqual(["spec_item_payments"]);
  });

  it("стоимость считается тем же `priceOf`, что и у конструктора", async () => {
    // Запас, скидка заказчику и единица измерения: 2 шт + 50 % запаса = 3 шт,
    // 1 000 ₽ − 10 % = 900 ₽, итого 2 700 ₽. Литералы посчитаны руками.
    setup({
      items: [
        specItem({
          id: APPROVED,
          qty: 2,
          unit: "шт",
          price: 1000,
          stockPct: 50,
          clientDiscountPct: 10,
        }),
      ],
      payments: [paymentRow(APPROVED, { amount: 700 })],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.total).toBe(2700);
    expect(result.data.scope.remaining).toBe(2000);
    expect(result.data.scope.percent).toBe(26);
  });

  it("позиция вне воронки в итог не входит, а отмечается отдельно", async () => {
    // «Подобрано» — вне воронки закупки: её деньги не часть «Суммы в закупке»,
    // но и молча исчезнуть не должны.
    setup({
      items: [
        specItem({ id: APPROVED, price: 10000 }),
        specItem({ id: DRAFT, status: "draft", price: 5000 }),
      ],
      payments: [
        paymentRow(APPROVED, { amount: 4000 }),
        paymentRow(DRAFT, { amount: 2500 }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.total).toBe(10000);
    expect(result.data.scope.paid).toBe(4000);
    expect(result.data.outOfScopeCount).toBe(1);
    expect(result.data.outOfScopeNet).toBe(2500);
  });

  it("заглушка вне воронки: у неё нет ни цены, ни обязательства", async () => {
    setup({
      items: [
        specItem({ id: APPROVED, price: 10000 }),
        specItem({
          id: PLACEHOLDER,
          status: "approved",
          isPlaceholder: true,
          price: 9999,
        }),
      ],
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

  it("позиция вне воронки без оплат в счётчик не попадает", async () => {
    // Счётчик отвечает на вопрос «есть ли ДЕНЬГИ мимо этой суммы». Прежде он
    // считал и позиции с одним графиком — теперь графика в строке нет, и счёт по
    // нему обещал бы пометку там, где сравнивать нечего.
    setup({
      items: [
        specItem({ id: APPROVED, price: 10000 }),
        specItem({ id: DRAFT, status: "draft", price: 5000 }),
      ],
      payments: [paymentRow(APPROVED, { amount: 4000 })],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.outOfScopeCount).toBe(0);
    expect(result.data.outOfScopeNet).toBe(0);
  });

  it("сальдо мимо области бывает отрицательным: возвратов больше, чем оплат", async () => {
    // Отдельный кейс, потому что знак здесь несут данные, а не оформление:
    // вкладка показывает его как есть, и модалка обязана не потерять знак.
    setup({
      items: [
        specItem({ id: APPROVED, price: 10000 }),
        specItem({ id: DRAFT, status: "draft", price: 5000 }),
      ],
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

  it("оплаты позиции, которой нет в списке, не считаются", async () => {
    // Удалённую позицию читатель позиций не отдаёт вовсе — её деньги не
    // показываются нигде: ни в сумме закупки, ни как «оплаты мимо области».
    // Отдельная пометка «мимо» означала бы, что воронка предлагает разбираться
    // с уже удалённой позицией.
    setup({
      items: [specItem({ id: APPROVED, price: 10000 })],
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

  it("возвраты уменьшают оплаченное, а остаток может превысить стоимость", async () => {
    // Следствие ADR 0003, принятое осознанно: возвратов больше, чем оплат,
    // переплатой не объявляется, поэтому остаток = 10 000 − (−2 000) = 12 000.
    setup({
      items: [specItem({ id: APPROVED, price: 10000 })],
      payments: [
        paymentRow(APPROVED, { amount: 3000 }),
        paymentRow(APPROVED, { amount: 5000, kind: "refund" }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.paid).toBe(-2000);
    expect(result.data.scope.remaining).toBe(12000);
    expect(result.data.scope.overpaid).toBe(0);
    expect(result.data.scope.percent).toBe(0);
  });

  it("позиция без цены: процента нет, а оплата — переплата", async () => {
    // Нулевая стоимость — это не «0 %»: базы нет, и подпись процента обязана
    // исчезнуть, а не утверждать, что позиция не оплачена.
    setup({
      items: [specItem({ id: APPROVED, price: 0 })],
      payments: [paymentRow(APPROVED, { amount: 5000 })],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.total).toBe(0);
    expect(result.data.scope.percent).toBeNull();
    expect(result.data.scope.overpaid).toBe(5000);
  });

  it("пустой проект — нули и ни одной позиции мимо", async () => {
    setup({ items: [], payments: [] });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.paid).toBe(0);
    expect(result.data.scope.total).toBe(0);
    expect(result.data.scope.percent).toBeNull();
    expect(result.data.outOfScopeCount).toBe(0);
    expect(result.data.outOfScopeNet).toBe(0);
  });
});

describe("getProjectPaymentsSummary · изоляция организации", () => {
  it("сессия viewer: цифры видны", async () => {
    // Решение Q3 и тикет: чтение доступно любому члену, включая наблюдателя.
    sessionMock.current.role = "viewer";

    const result = await getProjectPaymentsSummary("org-1", PROJECT);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.scope.total).toBe(15000);
  });

  it("оплаты чужой организации не попадают в итог", async () => {
    // Ключевая защита: `orgSlug` приходит с клиента, поэтому область видимости
    // задаёт СЕССИЯ. Строки чужой организации лежат в той же таблице и с тем же
    // `project_id` — если фильтр по организации пропадёт, они сложатся в итог.
    setup({
      items: [specItem({ id: APPROVED, price: 10000 })],
      payments: [
        paymentRow(APPROVED, { amount: 4000 }),
        paymentRow(FOREIGN, { amount: 500000, org_id: OTHER_ORG }),
      ],
    });

    const result = await getProjectPaymentsSummary("org-1", PROJECT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.scope.paid).toBe(4000);
    // Чужая позиция не попадает и в «мимо»: это не деньги проекта пользователя.
    expect(result.data.outOfScopeCount).toBe(0);
    expect(result.data.outOfScopeNet).toBe(0);
  });

  it("оплаты другого проекта той же организации не попадают в итог", async () => {
    setup({
      items: [specItem({ id: APPROVED, price: 10000 })],
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
      items: [specItem({ id: APPROVED, price: 10000 })],
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
});

describe("getProjectPaymentsSummary · отказ чтения", () => {
  it("ошибка чтения оплат превращается в понятный отказ, а не в нули", async () => {
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

  it("отказ читателя позиций — тоже отказ, а не «нулевая закупка»", async () => {
    // `getProjectSpecItems` бросает, а не возвращает отказ. Проглотить это и
    // вернуть нули значило бы показать «в закупке ничего нет»: цифра стоимости
    // пришла бы не из данных, а из отсутствия ответа.
    itemsMock.mockRejectedValue(new Error("Не удалось загрузить спецификацию"));

    const result = await getProjectPaymentsSummary("org-1", PROJECT);

    expect(result.success).toBe(false);
  });
});
