import { describe, expect, it } from "vitest";
import {
  findPaymentPlanPosition,
  movePaymentPlan,
  orderPaymentPlans,
  paymentPlanCoverage,
  paymentPlanRows,
  paymentProgress,
  roundMoney,
  summarisePaymentSchedule,
  summarisePaymentScheduleByItem,
  type PaidAmountLike,
  type PaymentPlanLike,
  type PaymentPlanOrderRow,
} from "./payment-schedule";

/**
 * График платежей как арифметика и порядок: чистые функции без React и без БД.
 *
 * Проверяется ровно то, что в этой задаче является правилом, а не реализацией:
 *
 *   * сумма графика — самостоятельная величина из сумм строк (цена, количество
 *     и скидки позиции в расчёт не входят вовсе — их нет среди входных данных);
 *   * мягко удалённые строки не считаются ни в сумме, ни в порядке;
 *   * остаток = план − факт; переплата показывается только при непустом графике,
 *     поэтому оплата вне графика не превращается в «переплату на 100 %»;
 *   * перестановка строки меняет порядок двух строк и не оставляет дублей
 *     номера порядка.
 *
 * Значения сумм заданы литералами (а не пересчитаны тем же способом, что в
 * коде), иначе тест подтверждал бы сам себя.
 */

/** Строка графика: значения как их отдаёт Postgres (`numeric` приходит строкой). */
function plan(over: Partial<PaymentPlanLike> = {}): PaymentPlanLike {
  return {
    id: "p1",
    amount: 1000,
    position: 0,
    deletedAt: null,
    ...over,
  };
}

/**
 * Факт оплаты. `kind` и `deletedAt` по умолчанию не заданы намеренно: так
 * вызывающий, у которого этих полей ещё нет, получает «оплата, активна» —
 * ровно то поведение, которое было у функции до этой задачи.
 */
function paid(over: Partial<PaidAmountLike> = {}): PaidAmountLike {
  return { paymentPlanId: null, amount: 100, ...over };
}

describe("paymentPlanRows", () => {
  it("оставляет только неудалённые строки", () => {
    const rows = paymentPlanRows([
      plan({ id: "a" }),
      plan({ id: "b", deletedAt: "2026-10-01T00:00:00.000Z" }),
      plan({ id: "c" }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("не мутирует исходный список", () => {
    const source = [plan({ id: "b" }), plan({ id: "a" })];

    orderPaymentPlans(source);

    expect(source.map((row) => row.id)).toEqual(["b", "a"]);
  });
});

describe("orderPaymentPlans", () => {
  it("сортирует по порядку, затем по id", () => {
    const ordered = orderPaymentPlans([
      plan({ id: "c", position: 2 }),
      plan({ id: "b", position: 0 }),
      plan({ id: "a", position: 0 }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("удалённая строка порядок не занимает", () => {
    const ordered = orderPaymentPlans([
      plan({ id: "a", position: 0 }),
      plan({ id: "z", position: 1, deletedAt: "2026-10-01T00:00:00.000Z" }),
      plan({ id: "b", position: 2 }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("summarisePaymentSchedule", () => {
  it("сумма графика — сумма строк плана", () => {
    const summary = summarisePaymentSchedule([
      plan({ id: "a", amount: 12000 }),
      plan({ id: "b", amount: 3500.5 }),
    ]);

    expect(summary.planned).toBe(15500.5);
    expect(summary.paid).toBe(0);
    expect(summary.remaining).toBe(15500.5);
    expect(summary.overpaid).toBe(0);
  });

  it("суммы `numeric` из БД приходят строками и складываются как числа", () => {
    // PostgREST отдаёт `numeric` строкой, чтобы не терять точность. Сложение
    // строк дало бы «01000.5012.25», а не число.
    const summary = summarisePaymentSchedule([
      plan({ id: "a", amount: "1000.50" }),
      plan({ id: "b", amount: "12.25" }),
    ]);

    expect(summary.planned).toBe(1012.75);
  });

  it("мягко удалённая строка в сумму не входит", () => {
    const summary = summarisePaymentSchedule([
      plan({ id: "a", amount: 5000 }),
      plan({ id: "b", amount: 9999, deletedAt: "2026-10-01T00:00:00.000Z" }),
    ]);

    expect(summary.planned).toBe(5000);
  });

  it("пустой график — нули, а не отсутствие значений", () => {
    expect(summarisePaymentSchedule([])).toEqual({
      planned: 0,
      paid: 0,
      paidGross: 0,
      refunded: 0,
      remaining: 0,
      overpaid: 0,
      unplanned: 0,
      refundsExceedPayments: false,
      hasPlan: false,
    });
  });

  it("оплаты при пустом графике — оплата вне графика, а не переплата", () => {
    // Правило границы из отчёта (§5.1): при `planned = 0` переплата не
    // показывается вовсе — иначе внеплановая оплата выглядела бы как
    // стопроцентная переплата. Остаток в этом случае тоже ноль, а не «−700 ₽»:
    // отрицательная величина рядом с нулевой переплатой читалась бы как
    // переплата, то есть ровно как то, чего правило не допускает.
    const summary = summarisePaymentSchedule([], [
      { paymentPlanId: null, amount: 700 },
    ]);

    expect(summary.planned).toBe(0);
    expect(summary.paid).toBe(700);
    expect(summary.remaining).toBe(0);
    expect(summary.overpaid).toBe(0);
    expect(summary.unplanned).toBe(700);
    expect(summary.hasPlan).toBe(false);
  });

  it("частичная оплата даёт остаток, полная — нулевой остаток", () => {
    const partially = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [{ paymentPlanId: "a", amount: 4000 }],
    );
    const fully = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [{ paymentPlanId: "a", amount: 10000 }],
    );

    expect(partially.remaining).toBe(6000);
    expect(partially.overpaid).toBe(0);
    expect(fully.remaining).toBe(0);
    expect(fully.overpaid).toBe(0);
  });

  it("переплата показывается явно при непустом графике", () => {
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [{ paymentPlanId: "a", amount: 12000 }],
    );

    // Переплата — своя величина, а «остаток» в минус не уходит: две строки
    // одного места не должны противоречить друг другу.
    expect(summary.remaining).toBe(0);
    expect(summary.overpaid).toBe(2000);
    expect(summary.hasPlan).toBe(true);
  });

  it("удалённая строка графика не считается, а её оплата — уже вне графика", () => {
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000, deletedAt: "2026-10-01T00:00:00.000Z" })],
      [{ paymentPlanId: "a", amount: 10000 }],
    );

    expect(summary.planned).toBe(0);
    expect(summary.paid).toBe(10000);
    expect(summary.overpaid).toBe(0);
  });

  it("сумма графика не выводится из стоимости позиции", () => {
    // Главное правило этапа (REPORT §8.4): сумма плана — самостоятельная
    // величина. Цена и количество позиции не входят ни во вход графика, ни в
    // формулу: ряды графика те же, а стоимость позиции вокруг них любая —
    // обещанные строки не меняются.
    const rows = [plan({ id: "a", amount: 10000 }), plan({ id: "b", amount: 5500.5 })];
    const paid = [{ paymentPlanId: "a", amount: 4000 }];

    const summary = summarisePaymentSchedule(rows, paid);

    expect(summary.planned).toBe(15500.5);
    expect(summary.remaining).toBe(11500.5);
    expect(summary.overpaid).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Факты: частичные оплаты, возвраты, удаление, округление            */
/* ------------------------------------------------------------------ */

describe("summarisePaymentSchedule: факты", () => {
  it("частичные оплаты складываются в «оплачено» и уменьшают остаток", () => {
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 2500 }),
        paid({ paymentPlanId: "a", amount: 1500.5 }),
      ],
    );

    expect(summary.paid).toBe(4000.5);
    expect(summary.remaining).toBe(5999.5);
    expect(summary.overpaid).toBe(0);
    expect(summary.unplanned).toBe(0);
  });

  it("оплата без плана попадает в «оплачено» и в «вне графика», но не в переплату", () => {
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 4000 }),
        paid({ paymentPlanId: null, amount: 1500 }),
      ],
    );

    expect(summary.paid).toBe(5500);
    expect(summary.unplanned).toBe(1500);
    expect(summary.planned).toBe(10000);
    expect(summary.remaining).toBe(4500);
    expect(summary.overpaid).toBe(0);
  });

  it("оплата без плана при пустом графике — не переплата, а «вне графика»", () => {
    const summary = summarisePaymentSchedule(
      [],
      [paid({ paymentPlanId: null, amount: 700 })],
    );

    expect(summary.paid).toBe(700);
    expect(summary.unplanned).toBe(700);
    expect(summary.overpaid).toBe(0);
    expect(summary.remaining).toBe(0);
    expect(summary.hasPlan).toBe(false);
  });

  it("возврат уменьшает оплаченное и виден отдельной величиной", () => {
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 6000 }),
        paid({ paymentPlanId: "a", amount: 2000, kind: "refund" }),
      ],
    );

    expect(summary.paid).toBe(4000);
    expect(summary.refunded).toBe(2000);
    expect(summary.remaining).toBe(6000);
    expect(summary.unplanned).toBe(0);
  });

  it("возвратов больше, чем оплат: отрицательное оплаченное показывается как есть", () => {
    // Решение Q13: БД такого не запрещает, и интерфейс показывает это явной
    // пометкой, а не прячет. Считать «оплачено = 0» значило бы потерять факт
    // переплаты клиенту.
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 3000 }),
        paid({ paymentPlanId: "a", amount: 5000, kind: "refund" }),
      ],
    );

    expect(summary.paid).toBe(-2000);
    expect(summary.refunded).toBe(5000);
    // По строке вернули больше, чем заплатили: обязательство выросло до полной
    // суммы строки плюс переплата клиенту — 10 000 − (−2 000) = 12 000. Это
    // честное «сколько ещё должно быть закрыто», а не ошибка знака.
    expect(summary.remaining).toBe(12000);
    expect(summary.overpaid).toBe(0);
  });

  it("пометка «возвратов больше, чем оплат» появляется только когда возвратов действительно больше", () => {
    // Решение Q13: БД такого не запрещает, и причина возврата не требуется, но
    // пользователь обязан увидеть, что вернули больше, чем заплатили, — иначе
    // отрицательное «Оплачено» читалось бы как ошибка расчёта.
    const more = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 3000 }),
        paid({ paymentPlanId: "a", amount: 5000, kind: "refund" }),
      ],
    );

    expect(more.paid).toBe(-2000);
    expect(more.refundsExceedPayments).toBe(true);
  });

  it("равные возвраты и оплаты — не «больше»: пометки нет", () => {
    const equal = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 5000 }),
        paid({ paymentPlanId: "a", amount: 5000, kind: "refund" }),
      ],
    );

    expect(equal.paid).toBe(0);
    expect(equal.refunded).toBe(5000);
    expect(equal.refundsExceedPayments).toBe(false);
  });

  it("пустой список фактов не даёт пометки: ноль возвратов — не «больше нуля оплат»", () => {
    // Граница, на которой сравнение «возвраты > оплаты» врёт: без записанных
    // фактов обе суммы нулевые, и 0 > 0 обязано остаться ложью, иначе пустая
    // вкладка показывала бы предупреждение о возвратах, которых нет.
    expect(summarisePaymentSchedule([]).refundsExceedPayments).toBe(false);
    expect(
      summarisePaymentSchedule(
        [plan({ id: "a", amount: 10000 })],
        [paid({ paymentPlanId: "a", amount: 3000 })],
      ).refundsExceedPayments,
    ).toBe(false);
  });

  it("возврат без оплат и без графика — НЕ «возвратов больше, чем оплат»", () => {
    // Граница, на которой сравнение «возвраты > оплаты» врёт: оплат не было
    // вовсе, поэтому «вернули больше, чем заплатили» — не наблюдение, а
    // отсутствие данных. Деньги в этом случае показывает «вне графика»
    // (REPORT §5.1(5)), а не пометка об аномалии.
    const onlyRefund = summarisePaymentSchedule(
      [],
      [paid({ paymentPlanId: null, amount: 500, kind: "refund" })],
    );

    expect(onlyRefund.paid).toBe(-500);
    expect(onlyRefund.unplanned).toBe(-500);
    expect(onlyRefund.refundsExceedPayments).toBe(false);
  });

  it("возврат без плана уменьшает «вне графика»", () => {
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: null, amount: 4000 }),
        paid({ paymentPlanId: null, amount: 1000, kind: "refund" }),
      ],
    );

    expect(summary.unplanned).toBe(3000);
    expect(summary.paid).toBe(3000);
  });

  it("мягко удалённый факт не считается ни в одной сумме", () => {
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 4000 }),
        paid({
          paymentPlanId: "a",
          amount: 9999,
          deletedAt: "2026-10-05T10:00:00.000Z",
        }),
        paid({
          paymentPlanId: null,
          amount: 9999,
          kind: "refund",
          deletedAt: "2026-10-05T10:00:00.000Z",
        }),
      ],
    );

    expect(summary.paid).toBe(4000);
    expect(summary.refunded).toBe(0);
    expect(summary.unplanned).toBe(0);
  });

  it("оплата по удалённой строке графика остаётся оплатой, но вне графика", () => {
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: 10000, deletedAt: "2026-10-05T10:00:00.000Z" })],
      [paid({ paymentPlanId: "a", amount: 4000 })],
    );

    expect(summary.planned).toBe(0);
    expect(summary.paid).toBe(4000);
    expect(summary.overpaid).toBe(0);
    expect(summary.hasPlan).toBe(false);
    // Строка графика удалена — оплата по ней в покрытие не попадает, значит для
    // интерфейса это деньги «мимо графика», а не покрытие живой строки.
    expect(summary.unplanned).toBe(0);
  });

  it("округление: копейки не превращаются в хвост двоичной дроби", () => {
    // 0.1 + 0.2 в двоичной плавающей точке даёт 0.30000000000000004. В БД сумма
    // считается над numeric, поэтому расхождение могло появиться только здесь.
    const summary = summarisePaymentSchedule(
      [plan({ id: "a", amount: "0.10" }), plan({ id: "b", amount: "0.20" })],
      [paid({ paymentPlanId: "a", amount: "0.10" })],
    );

    expect(summary.planned).toBe(0.3);
    expect(summary.paid).toBe(0.1);
    expect(summary.remaining).toBe(0.2);
  });

  it("округление на многих строках: итог — до копейки и не зависит от порядка", () => {
    // Семь строк по 0.34 — тот самый случай, на котором расходятся `sumItems`
    // и публичная страница (риск R5 отчёта): накопитель с округлением каждого
    // шага дал бы 2.38, сырая сумма — 2.3799999999999994.
    const rows = Array.from({ length: 7 }, (_, index) =>
      plan({ id: `p${index}`, amount: 0.34 }),
    );
    const facts = [
      paid({ paymentPlanId: "p0", amount: "0.34" }),
      paid({ paymentPlanId: "p1", amount: 0.34 }),
      paid({ paymentPlanId: "p2", amount: "0.34" }),
    ];

    const summary = summarisePaymentSchedule(rows, facts);

    expect(summary.planned).toBe(2.38);
    expect(summary.paid).toBe(1.02);
    expect(summary.remaining).toBe(1.36);
    // Тот же итог при обратном порядке — округление применяется к сумме, а не к
    // накопителю, поэтому порядок слагаемых на результат не влияет.
    expect(summarisePaymentSchedule([...rows].reverse(), facts).planned).toBe(2.38);
  });

  it("roundMoney округляет до копейки и переживает отрицательные значения", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(-0.1 - 0.2)).toBe(-0.3);
    expect(roundMoney(1234.565)).toBe(1234.57);
  });
});

/**
 * Агрегат по НЕСКОЛЬКИМ позициям — база строки оплат в воронке закупки
 * (тикет 04).
 *
 * ── Почему правило считает каждая позиция, а не одна большая сумма ─────────
 *
 * Так же считает вкладка «Платежи»: она складывает `summarisePaymentSchedule`
 * по одной позиции. Проектный уровень обязан повторить это, иначе цифра в
 * воронке разойдётся с цифрой в карточке — а пользователь видит обе и решит,
 * что одна из них врёт. На этом расходятся по-настоящему: «остаток» не уходит в
 * минус, а «переплата» показывается только при непустом графике, поэтому
 * `Σ max(план − оплачено, 0)` и `max(Σплан − Σоплачено, 0)` — РАЗНЫЕ величины
 * (см. кейс с переплатой по одной позиции ниже).
 *
 * ── Пустой список ──────────────────────────────────────────────────────────
 *
 * Ноль позиций — нули, а не отсутствие значений: строка воронки показывает «0 ₽»
 * и при пустом проекте, и этот ноль обязан быть числом.
 */
describe("summarisePaymentScheduleByItem", () => {
  it("складывает позиции и повторяет формулу вкладки по каждой из них", () => {
    const summary = summarisePaymentScheduleByItem([
      {
        plans: [plan({ id: "p1", amount: 10000 })],
        paidRows: [paid({ paymentPlanId: "p1", amount: 4000 })],
      },
      {
        plans: [plan({ id: "p2", amount: 5000 })],
        paidRows: [],
      },
    ]);

    expect(summary.planned).toBe(15000);
    expect(summary.paid).toBe(4000);
    expect(summary.remaining).toBe(11000);
    expect(summary.overpaid).toBe(0);
  });

  it("пустой список позиций — нули, а не отсутствие значений", () => {
    expect(summarisePaymentScheduleByItem([])).toEqual({
      planned: 0,
      paid: 0,
      paidGross: 0,
      refunded: 0,
      remaining: 0,
      overpaid: 0,
      unplanned: 0,
      refundsExceedPayments: false,
      hasPlan: false,
    });
  });

  it("переплата по одной позиции не гасит остаток по другой", () => {
    // Первая позиция: план 10 000, оплачено 12 000 — переплата 2 000, остатка нет.
    // Вторая: план 10 000, оплачено 3 000 — остаток 7 000.
    // «Одним котлом» получилось бы planned − paid = 20 000 − 15 000 = 5 000, то
    // есть остаток, уменьшённый чужой переплатой. Вкладка так не считает.
    const summary = summarisePaymentScheduleByItem([
      {
        plans: [plan({ id: "a", amount: 10000 })],
        paidRows: [paid({ paymentPlanId: "a", amount: 12000 })],
      },
      {
        plans: [plan({ id: "b", amount: 10000 })],
        paidRows: [paid({ paymentPlanId: "b", amount: 3000 })],
      },
    ]);

    expect(summary.remaining).toBe(7000);
    expect(summary.overpaid).toBe(2000);
  });

  it("позиция без графика не даёт переплаты: её факт — «вне графика»", () => {
    // Правило границы (REPORT §5.1(5)): при пустом графике факт — оплата вне
    // графика, а не переплата на 100 %. Проектный агрегат обязан его сохранить.
    const summary = summarisePaymentScheduleByItem([
      { plans: [], paidRows: [paid({ paymentPlanId: null, amount: 3000 })] },
    ]);

    expect(summary.planned).toBe(0);
    expect(summary.overpaid).toBe(0);
    expect(summary.remaining).toBe(0);
    expect(summary.unplanned).toBe(3000);
    expect(summary.paid).toBe(3000);
  });

  it("возвраты уменьшают оплаченное и виден признак превышения", () => {
    const summary = summarisePaymentScheduleByItem([
      {
        plans: [plan({ id: "a", amount: 10000 })],
        paidRows: [
          paid({ paymentPlanId: "a", amount: 3000 }),
          paid({ paymentPlanId: "a", amount: 5000, kind: "refund" }),
        ],
      },
    ]);

    expect(summary.paid).toBe(-2000);
    expect(summary.paidGross).toBe(3000);
    expect(summary.refunded).toBe(5000);
    expect(summary.remaining).toBe(12000);
    expect(summary.refundsExceedPayments).toBe(true);
  });

  it("признак превышения складывается по «или»: он есть, если есть хоть где-то", () => {
    // Признак — не сумма, а состояние: одна позиция с перебором возвратов
    // означает, что показывать его надо, даже если по остальным всё в порядке.
    const summary = summarisePaymentScheduleByItem([
      {
        plans: [plan({ id: "a", amount: 10000 })],
        paidRows: [
          paid({ paymentPlanId: "a", amount: 1000 }),
          paid({ paymentPlanId: "a", amount: 9000, kind: "refund" }),
        ],
      },
      {
        plans: [plan({ id: "b", amount: 10000 })],
        paidRows: [paid({ paymentPlanId: "b", amount: 10000 })],
      },
    ]);

    expect(summary.refundsExceedPayments).toBe(true);
  });

  it("признак превышения не появляется, когда его нет ни у одной позиции", () => {
    const summary = summarisePaymentScheduleByItem([
      {
        plans: [plan({ id: "a", amount: 10000 })],
        paidRows: [paid({ paymentPlanId: "a", amount: 1000 })],
      },
      {
        plans: [plan({ id: "b", amount: 10000 })],
        paidRows: [
          paid({ paymentPlanId: "b", amount: 5000 }),
          paid({ paymentPlanId: "b", amount: 5000, kind: "refund" }),
        ],
      },
    ]);

    expect(summary.refunded).toBe(5000);
    expect(summary.refundsExceedPayments).toBe(false);
  });

  it("план считается по позициям: у одной строки графика, у другой пусто", () => {
    const summary = summarisePaymentScheduleByItem([
      {
        plans: [
          plan({ id: "a1", amount: 1000 }),
          plan({ id: "a2", amount: 2000 }),
        ],
        paidRows: [],
      },
      { plans: [], paidRows: [] },
    ]);

    expect(summary.planned).toBe(3000);
    expect(summary.hasPlan).toBe(true);
  });

  it("hasPlan — «есть хоть где-то»: пустой график всего проекта даёт false", () => {
    const withPlan = summarisePaymentScheduleByItem([
      { plans: [], paidRows: [] },
      { plans: [plan({ id: "a", amount: 100 })], paidRows: [] },
    ]);
    const withoutPlan = summarisePaymentScheduleByItem([
      { plans: [], paidRows: [paid({ amount: 500 })] },
    ]);

    expect(withPlan.hasPlan).toBe(true);
    expect(withoutPlan.hasPlan).toBe(false);
  });

  it("итог равен сумме итогов по позициям — третий рецепт формулы не заводится", () => {
    // Тождество, которое обязано держаться: воронка складывает РОВНО то, что
    // показывает карточка. Проверяется на неудобных числах (возврат, пустой
    // график, внеплановый факт), где «одним котлом» уже разошлось бы.
    const items = [
      {
        plans: [plan({ id: "a", amount: "0.34" })],
        paidRows: [paid({ paymentPlanId: "a", amount: "0.10" })],
      },
      {
        plans: [plan({ id: "b", amount: "12.25" })],
        paidRows: [
          paid({ paymentPlanId: "b", amount: "20.00" }),
          paid({ paymentPlanId: "b", amount: "1.05", kind: "refund" }),
        ],
      },
      { plans: [], paidRows: [paid({ paymentPlanId: null, amount: "7.77" })] },
    ];

    const total = summarisePaymentScheduleByItem(items);
    const each = items.map((item) =>
      summarisePaymentSchedule(item.plans, item.paidRows),
    );
    const sumOf = (pick: (summary: (typeof each)[number]) => number) =>
      roundMoney(each.reduce((sum, summary) => sum + pick(summary), 0));

    expect(total.planned).toBe(sumOf((s) => s.planned));
    expect(total.paid).toBe(sumOf((s) => s.paid));
    expect(total.remaining).toBe(sumOf((s) => s.remaining));
    expect(total.overpaid).toBe(sumOf((s) => s.overpaid));
    expect(total.unplanned).toBe(sumOf((s) => s.unplanned));
    expect(total.refunded).toBe(sumOf((s) => s.refunded));
  });
});

describe("paymentPlanCoverage", () => {
  it("покрытие строки: оплата своей строки и остаток по ней", () => {
    const coverage = paymentPlanCoverage(
      [plan({ id: "a", amount: 10000 }), plan({ id: "b", amount: 5000 })],
      [
        { paymentPlanId: "a", amount: 2500 },
        { paymentPlanId: "a", amount: 1500 },
      ],
    );

    expect(coverage.get("a")).toEqual({ paid: 4000, remaining: 6000, overpaid: 0 });
    expect(coverage.get("b")).toEqual({ paid: 0, remaining: 5000, overpaid: 0 });
  });

  it("оплата вне графика ни одной строке не достаётся", () => {
    const coverage = paymentPlanCoverage(
      [plan({ id: "a", amount: 10000 })],
      [{ paymentPlanId: null, amount: 9000 }],
    );

    expect(coverage.get("a")).toEqual({ paid: 0, remaining: 10000, overpaid: 0 });
  });

  it("оплата по удалённой строке в покрытии не участвует", () => {
    const coverage = paymentPlanCoverage(
      [plan({ id: "a", amount: 10000, deletedAt: "2026-10-01T00:00:00.000Z" })],
      [{ paymentPlanId: "a", amount: 10000 }],
    );

    expect(coverage.size).toBe(0);
  });

  it("переплата по строке считается, а остаток не уходит в минус", () => {
    const coverage = paymentPlanCoverage(
      [plan({ id: "a", amount: 10000 })],
      [{ paymentPlanId: "a", amount: 14000 }],
    );

    expect(coverage.get("a")).toEqual({
      paid: 14000,
      remaining: 0,
      overpaid: 4000,
    });
  });

  it("возврат по строке уменьшает её покрытие", () => {
    const coverage = paymentPlanCoverage(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 6000 }),
        paid({ paymentPlanId: "a", amount: 2000, kind: "refund" }),
      ],
    );

    expect(coverage.get("a")).toEqual({
      paid: 4000,
      remaining: 6000,
      overpaid: 0,
    });
  });

  it("возврат больше оплат по строке не уводит остаток в минус", () => {
    const coverage = paymentPlanCoverage(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 1000 }),
        paid({ paymentPlanId: "a", amount: 3000, kind: "refund" }),
      ],
    );

    // Покрытие стало отрицательным (вернули больше, чем заплатили), поэтому
    // остаток по строке БОЛЬШЕ её суммы: 10 000 − (−2 000) = 12 000. Это честная
    // величина «сколько ещё должно быть закрыто», а не ошибка знака.
    expect(coverage.get("a")).toEqual({
      paid: -2000,
      remaining: 12000,
      overpaid: 0,
    });
  });

  it("мягко удалённый факт в покрытии не участвует", () => {
    const coverage = paymentPlanCoverage(
      [plan({ id: "a", amount: 10000 })],
      [
        paid({ paymentPlanId: "a", amount: 4000 }),
        paid({
          paymentPlanId: "a",
          amount: 6000,
          deletedAt: "2026-10-05T10:00:00.000Z",
        }),
      ],
    );

    expect(coverage.get("a")).toEqual({
      paid: 4000,
      remaining: 6000,
      overpaid: 0,
    });
  });
});

describe("movePaymentPlan", () => {
  const rows: PaymentPlanOrderRow[] = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ];

  it("вверх меняет порядок соседей местами", () => {
    expect(movePaymentPlan(rows, "b", "up")).toEqual(["b", "a", "c"]);
  });

  it("вниз меняет порядок соседей местами", () => {
    expect(movePaymentPlan(rows, "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("первую строку выше поднять нечем", () => {
    expect(movePaymentPlan(rows, "a", "up")).toBeNull();
  });

  it("последнюю строку ниже опустить нечем", () => {
    expect(movePaymentPlan(rows, "c", "down")).toBeNull();
  });

  it("порядок входного списка не важен: он сортируется перед перестановкой", () => {
    const shuffled: PaymentPlanOrderRow[] = [
      { id: "c", position: 2 },
      { id: "a", position: 0 },
      { id: "b", position: 1 },
    ];

    expect(movePaymentPlan(shuffled, "c", "up")).toEqual(["a", "c", "b"]);
  });

  it("незнакомый идентификатор ничего не переставляет", () => {
    expect(movePaymentPlan(rows, "zzz", "up")).toBeNull();
  });

  it("одна строка переставляться не может", () => {
    expect(movePaymentPlan([{ id: "a", position: 0 }], "a", "up")).toBeNull();
    expect(movePaymentPlan([{ id: "a", position: 0 }], "a", "down")).toBeNull();
  });

  it("результат — перестановка: каждый id ровно один раз", () => {
    const moved = movePaymentPlan(rows, "a", "down")!;

    expect([...moved].sort()).toEqual(["a", "b", "c"]);
    expect(new Set(moved).size).toBe(moved.length);
  });
});

describe("findPaymentPlanPosition", () => {
  it("находит индекс строки в упорядоченном списке", () => {
    const ordered = orderPaymentPlans([
      plan({ id: "a", position: 0 }),
      plan({ id: "b", position: 1 }),
    ]);

    expect(findPaymentPlanPosition(ordered, "b")).toBe(1);
  });

  it("незнакомая строка даёт -1", () => {
    expect(findPaymentPlanPosition([plan({ id: "a" })], "zzz")).toBe(-1);
  });
});

/**
 * Прогресс оплаты позиции: сколько стоит, сколько оплачено, сколько осталось и
 * какой это процент.
 *
 * ── Откуда берётся база ────────────────────────────────────────────────────
 *
 * База — стоимость позиции (`priceOf().total`), поэтому `total` приходит сюда
 * готовым числом. Это осознанный откат решения ADR 0003: сумма обязательства
 * больше не хранится, и остаток меняется вместе со стоимостью. Здесь это
 * свойство закреплено явно, чтобы откат не выглядел случайностью.
 *
 * ── Почему процент считается здесь, а не в разметке ───────────────────────
 *
 * Процент — единственное место, где возможно деление на ноль: у позиции без
 * цены стоимость равна нулю. В разметке это дало бы `Infinity` или `NaN` прямо
 * в подписи, поэтому правило живёт в чистой функции: нет базы — нет процента.
 */
describe("paymentProgress", () => {
  it("считает оплачено, остаток и процент от стоимости", () => {
    const progress = paymentProgress(100000, [
      { paymentPlanId: null, amount: 50000 },
    ]);

    expect(progress.total).toBe(100000);
    expect(progress.paid).toBe(50000);
    expect(progress.remaining).toBe(50000);
    expect(progress.overpaid).toBe(0);
    expect(progress.percent).toBe(50);
  });

  it("полностью оплаченная позиция — 100 % и нулевой остаток", () => {
    const progress = paymentProgress(100000, [
      { paymentPlanId: null, amount: 100000 },
    ]);

    expect(progress.percent).toBe(100);
    expect(progress.remaining).toBe(0);
    expect(progress.overpaid).toBe(0);
  });

  it("переплата показывается отдельно, а процент не уходит выше 100", () => {
    // Полоса — не график переплаты: 120 % ширины ничего не сообщают, а
    // превышение показывает `overpaid` отдельной подписью.
    const progress = paymentProgress(100000, [
      { paymentPlanId: null, amount: 120000 },
    ]);

    expect(progress.paid).toBe(120000);
    expect(progress.remaining).toBe(0);
    expect(progress.overpaid).toBe(20000);
    expect(progress.percent).toBe(100);
  });

  it("возвраты уменьшают оплаченное", () => {
    const progress = paymentProgress(100000, [
      { paymentPlanId: null, amount: 60000 },
      { paymentPlanId: null, amount: 10000, kind: "refund" },
    ]);

    expect(progress.paid).toBe(50000);
    expect(progress.remaining).toBe(50000);
    expect(progress.percent).toBe(50);
  });

  it("возвратов больше, чем оплат: оплаченное отрицательно", () => {
    // Случай не запрещён (решение Q13). Отрицательное «оплачено» — честная
    // величина, поэтому:
    //   * процент — ровно 0, а не отрицательный: полосы «−20 %» не бывает;
    //   * остаток равен `стоимость − paid` = 100 000 − (−20 000) = 120 000, то
    //     есть БОЛЬШЕ стоимости. Это следствие уже принятого правила: `overpaid`
    //     считается только как `paid − стоимость`, поэтому превышение возвратов
    //     над оплатами переплатой не объявляется и не «съедает» остаток. Здесь
    //     оно закреплено явно, чтобы выглядело решением, а не арифметической
    //     случайностью.
    const progress = paymentProgress(100000, [
      { paymentPlanId: null, amount: 30000 },
      { paymentPlanId: null, amount: 50000, kind: "refund" },
    ]);

    expect(progress.paid).toBe(-20000);
    expect(progress.percent).toBe(0);
    expect(progress.remaining).toBe(120000);
    expect(progress.overpaid).toBe(0);
  });

  it("мягко удалённые факты не считаются", () => {
    const progress = paymentProgress(100000, [
      { paymentPlanId: null, amount: 40000 },
      {
        paymentPlanId: null,
        amount: 99999,
        deletedAt: "2026-10-01T00:00:00.000Z",
      },
    ]);

    expect(progress.paid).toBe(40000);
    expect(progress.percent).toBe(40);
  });

  it("нулевая стоимость: процента нет, остаток нулевой, а не долг в ноль", () => {
    // Позиция без цены: делить не на что. `percent: null` — «процента нет», а не
    // «0 %», потому что 0 % утверждал бы, что база есть и она не оплачена.
    const progress = paymentProgress(0, [
      { paymentPlanId: null, amount: 5000 },
    ]);

    expect(progress.percent).toBeNull();
    expect(progress.paid).toBe(5000);
    expect(progress.remaining).toBe(0);
    expect(progress.overpaid).toBe(5000);
  });

  it("нет фактов — нули и ноль процентов при непустой стоимости", () => {
    const progress = paymentProgress(100000, []);

    expect(progress.paid).toBe(0);
    expect(progress.remaining).toBe(100000);
    expect(progress.percent).toBe(0);
    expect(progress.overpaid).toBe(0);
  });

  it("округляет процент до целого", () => {
    // 1/3 от 100 000 — 33.33…%: в подписи нужна одна цифра, а не хвост.
    const progress = paymentProgress(100000, [
      { paymentPlanId: null, amount: 33333 },
    ]);

    expect(progress.percent).toBe(33);
  });

  it("стоимость и оплата приходят строками из `numeric`", () => {
    const progress = paymentProgress("100000.00", [
      { paymentPlanId: null, amount: "25000.50" },
    ]);

    expect(progress.paid).toBe(25000.5);
    expect(progress.remaining).toBe(74999.5);
    expect(progress.percent).toBe(25);
  });
});
