import { describe, expect, it } from "vitest";
import {
  findPaymentPlanPosition,
  movePaymentPlan,
  orderPaymentPlans,
  paymentPlanCoverage,
  paymentPlanRows,
  summarisePaymentSchedule,
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
      remaining: 0,
      overpaid: 0,
      hasPlan: false,
    });
  });

  it("оплаты при пустом графике — оплата вне графика, а не переплата", () => {
    // Правило границы из отчёта (§5.1): при `planned = 0` переплата не
    // показывается вовсе — иначе внеплановая оплата выглядела бы как
    // стопроцентная переплата.
    const summary = summarisePaymentSchedule([], [
      { paymentPlanId: null, amount: 700 },
    ]);

    expect(summary.planned).toBe(0);
    expect(summary.paid).toBe(700);
    expect(summary.remaining).toBe(-700);
    expect(summary.overpaid).toBe(0);
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

    expect(summary.remaining).toBe(-2000);
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
