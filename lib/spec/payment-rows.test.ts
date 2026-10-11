import { describe, expect, it } from "vitest";

import { buildPaymentRows } from "./payment-rows";
import type { PaymentPlanEntry } from "./payment-plan-types";
import type { PaymentEntry } from "./payment-types";

/**
 * Строки вкладки «Платежи»: план и факт — ОДНА строка на экране.
 *
 * ── Почему это проверяется чистой функцией ─────────────────────────────────
 *
 * Правило соединения — то единственное, что решает ADR 0006: в хранилище план и
 * факт остаются двумя строками, а на экран попадают одной. Правило проверяется
 * без React, потому что ломается оно незаметно: лишняя строка не роняет
 * вкладку, а показывает один и тот же платёж дважды — и остаток в шапке
 * перестаёт сходиться с тем, что видно в списке.
 *
 * ── Что здесь НЕ проверяется ───────────────────────────────────────────────
 *
 * Суммы. Их считает `./payment-schedule` и только он: тест, повторяющий
 * формулу, подтверждал бы сам себя.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const PLAN_A = "55555555-5555-4555-8555-555555555555";
const PLAN_B = "55555555-5555-4555-8555-666666666666";
const PAYMENT_A = "66666666-6666-4666-8666-666666666666";
const PAYMENT_B = "66666666-6666-4666-8666-777777777777";

/** Строка графика. */
function plan(over: Partial<PaymentPlanEntry> = {}): PaymentPlanEntry {
  return {
    id: PLAN_A,
    orgId: ORG,
    projectId: PROJECT,
    specItemId: ITEM,
    title: "Аванс 50 %",
    amount: 10000,
    condition: null,
    dueDate: null,
    position: 0,
    authorId: "user-1",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

/** Фактическая оплата или возврат. */
function payment(over: Partial<PaymentEntry> = {}): PaymentEntry {
  return {
    id: PAYMENT_A,
    orgId: ORG,
    projectId: PROJECT,
    specItemId: ITEM,
    kind: "payment",
    amount: 10000,
    paidAt: "2026-10-05",
    paymentPlanId: PLAN_A,
    comment: null,
    authorId: "user-1",
    authorName: "Анна",
    codeSnapshot: null,
    nameSnapshot: null,
    projectTitleSnapshot: null,
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    ...over,
  };
}

describe("buildPaymentRows · план и факт — одна строка", () => {
  it("неоплаченный плановый платёж даёт одну строку «Запланирован»", () => {
    const rows = buildPaymentRows({
      plans: [plan({ dueDate: "2026-11-01" })],
      payments: [],
    });

    expect(rows).toEqual([
      { key: `${PLAN_A}:plan`, plan: plan({ dueDate: "2026-11-01" }), payment: null },
    ]);
  });

  it("отметка «Оплачено» не добавляет вторую строку: факт встаёт в строку плана", () => {
    // Главное требование ADR 0006: две записи в хранилище — одна строка на
    // экране. Вторая строка означала бы, что один и тот же платёж виден дважды.
    const paid = plan();
    const fact = payment({ paymentPlanId: PLAN_A });

    const rows = buildPaymentRows({ plans: [paid], payments: [fact] });

    expect(rows).toHaveLength(1);
    expect(rows[0].plan).toEqual(paid);
    expect(rows[0].payment).toEqual(fact);
  });

  it("оплата без плана — своя строка", () => {
    const fact = payment({ id: PAYMENT_B, paymentPlanId: null });

    const rows = buildPaymentRows({ plans: [], payments: [fact] });

    expect(rows).toEqual([
      { key: `${PAYMENT_B}:payment`, plan: null, payment: fact },
    ]);
  });

  it("возврат — своя строка: плановая таблица видов не знает", () => {
    // Решение Q33: запланировать возврат нельзя, поэтому у возврата строки плана
    // нет и быть не может — он вносится отдельным входом и показывается сам.
    const refund = payment({ id: PAYMENT_B, kind: "refund", paymentPlanId: null });

    const rows = buildPaymentRows({ plans: [plan()], payments: [refund] });

    expect(rows).toHaveLength(2);
    expect(rows[1].plan).toBeNull();
    expect(rows[1].payment).toEqual(refund);
  });

  it("оплата по УДАЛЁННОЙ строке графика не пропадает из списка", () => {
    // Строку графика удалили (мягко), а оплата по ней осталась. Спрятать её
    // значило бы потерять деньги из списка: остаток в шапке посчитал бы её, а
    // показать её было бы негде.
    const fact = payment({ paymentPlanId: PLAN_A });

    const rows = buildPaymentRows({ plans: [], payments: [fact] });

    expect(rows).toHaveLength(1);
    expect(rows[0].plan).toBeNull();
    expect(rows[0].payment).toEqual(fact);
  });
});

describe("buildPaymentRows · порядок", () => {
  it("строки графика идут по своему порядку, факты вне графика — после них", () => {
    const rows = buildPaymentRows({
      plans: [
        plan({ id: PLAN_B, position: 1, title: "Второй" }),
        plan({ id: PLAN_A, position: 0, title: "Первый" }),
      ],
      payments: [
        payment({ id: PAYMENT_B, paymentPlanId: null, paidAt: "2026-10-09" }),
        payment({ id: PAYMENT_A, paymentPlanId: null, paidAt: "2026-10-01" }),
      ],
    });

    expect(rows.map((row) => row.key)).toEqual([
      `${PLAN_A}:plan`,
      `${PLAN_B}:plan`,
      `${PAYMENT_B}:payment`,
      `${PAYMENT_A}:payment`,
    ]);
  });

  it("факты вне графика сохраняют серверный порядок, а не сортируются заново", () => {
    // Порядок задаёт сервер (`paid_at desc, created_at desc`); клиентская
    // сортировка была бы вторым, расходящимся правилом того же порядка.
    const rows = buildPaymentRows({
      plans: [],
      payments: [
        payment({ id: PAYMENT_B, paymentPlanId: null, paidAt: "2026-10-09" }),
        payment({ id: PAYMENT_A, paymentPlanId: null, paidAt: "2026-10-01" }),
      ],
    });

    expect(rows.map((row) => row.payment?.id)).toEqual([PAYMENT_B, PAYMENT_A]);
  });
});

describe("buildPaymentRows · пометка отмены", () => {
  it("отменённая оплата возвращает строку в неоплаченное и несёт пометку", () => {
    // Решение Q29: обязательство снова открыто, но отмена не исчезает молча —
    // иначе строка выглядела бы так, будто оплаты и не было.
    const planA = plan();
    const cancelled = payment({
      paymentPlanId: PLAN_A,
      paidAt: "2026-10-05",
      amount: 10000,
    });

    const rows = buildPaymentRows({
      plans: [planA],
      payments: [],
      cancelledPayments: [cancelled],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].payment).toBeNull();
    expect(rows[0].cancelledPayment).toEqual(cancelled);
  });

  it("отменённая оплата БЕЗ плана строки не создаёт", () => {
    // Показывать нечего: строку бы составила одна пометка об отмене, а
    // обязательства, к которому она относится, в списке нет.
    const rows = buildPaymentRows({
      plans: [plan()],
      payments: [],
      cancelledPayments: [payment({ id: PAYMENT_B, paymentPlanId: null })],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].cancelledPayment).toBeUndefined();
  });

  it("новая оплата по строке снимает пометку об отмене", () => {
    const planA = plan();
    const rows = buildPaymentRows({
      plans: [planA],
      payments: [payment({ paymentPlanId: PLAN_A, paidAt: "2026-10-10" })],
      cancelledPayments: [payment({ paidAt: "2026-10-05" })],
    });

    expect(rows[0].payment).not.toBeNull();
    expect(rows[0].cancelledPayment).toBeUndefined();
  });

  it("из нескольких отменённых оплат пометка называет первую по серверному порядку", () => {
    // Порядок отменённых даёт сервер (`paid_at desc`), и первая из них —
    // поздняя по дате. Сортировать их здесь заново значило бы завести второе
    // правило того же порядка рядом с серверным.
    const rows = buildPaymentRows({
      plans: [plan()],
      payments: [],
      cancelledPayments: [
        payment({ id: PAYMENT_B, paidAt: "2026-10-08" }),
        payment({ id: PAYMENT_A, paidAt: "2026-10-01" }),
      ],
    });

    expect(rows[0].cancelledPayment?.id).toBe(PAYMENT_B);
  });
});
