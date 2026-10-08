import { describe, expect, it } from "vitest";

import {
  isCompletedDelivery,
  serviceOperationDeadline,
  type DeadlineOperation,
} from "./service-operation-deadline";

/**
 * Срок операции: завершённая доставка — не активный дедлайн.
 *
 * Правило: пока доставка не завершена, срок считается как раньше («через N дн.»
 * на будущую дату, «просрочено N дн.» на прошедшую). После завершения доставки
 * состояния срока нет ни на прошедшую, ни на будущую, ни на сегодняшнюю дату —
 * плановая дата остаётся историческими данными.
 *
 * Расчёт проверяется на фиксированном «сейчас» (`NOW`), а не на реальной дате:
 * иначе тест «delivered + прошедшая дата» со временем переставал бы проверять
 * то, что должен.
 */

/** «Сегодня» для проверок — 20 мая 2026. */
const NOW = new Date("2026-05-20T15:30:00");
const PAST = "2026-05-09"; // 11 дней назад
const FUTURE = "2026-05-31"; // 11 дней вперёд
const TODAY = "2026-05-20";

function op(overrides: Partial<DeadlineOperation> = {}): DeadlineOperation {
  return { type: "delivery", completed: false, deadline: FUTURE, ...overrides };
}

describe("serviceOperationDeadline", () => {
  it("delivered + дата в прошлом: просрочка не рассчитывается", () => {
    expect(
      serviceOperationDeadline(op({ completed: true, deadline: PAST }), NOW),
    ).toBeNull();
  });

  it("delivered + дата в будущем: «через N дн.» не рассчитывается", () => {
    expect(
      serviceOperationDeadline(op({ completed: true, deadline: FUTURE }), NOW),
    ).toBeNull();
  });

  it("delivered + сегодня: состояния срока нет", () => {
    expect(
      serviceOperationDeadline(op({ completed: true, deadline: TODAY }), NOW),
    ).toBeNull();
  });

  it("delivered: текущая дата не влияет на результат", () => {
    const delivered = op({ completed: true, deadline: PAST });
    for (const now of [
      new Date("2020-01-01T00:00:00"),
      NOW,
      new Date("2030-12-31T23:59:59"),
    ]) {
      expect(serviceOperationDeadline(delivered, now)).toBeNull();
    }
  });

  it("delivered: плановая дата и отметка не подменяются", () => {
    const delivered = op({ completed: true, deadline: PAST });
    serviceOperationDeadline(delivered, NOW);
    expect(delivered.deadline).toBe(PAST);
    expect(delivered.completed).toBe(true);
  });

  it("ожидается + будущая дата: «через N дн.» как раньше", () => {
    expect(serviceOperationDeadline(op({ deadline: FUTURE }), NOW)).toEqual({
      text: "через 11 дн.",
      overdue: false,
    });
  });

  it("ожидается + прошедшая дата: «просрочено N дн.» как раньше", () => {
    expect(serviceOperationDeadline(op({ deadline: PAST }), NOW)).toEqual({
      text: "просрочено 11 дн.",
      overdue: true,
    });
  });

  it("ожидается + сегодня: «сегодня», без просрочки", () => {
    expect(serviceOperationDeadline(op({ deadline: TODAY }), NOW)).toEqual({
      text: "сегодня",
      overdue: false,
    });
  });

  it("без даты срока нет независимо от отметки", () => {
    expect(serviceOperationDeadline(op({ deadline: null }), NOW)).toBeNull();
    expect(
      serviceOperationDeadline(op({ completed: true, deadline: null }), NOW),
    ).toBeNull();
  });

  it("монтаж и своя услуга считаются как раньше", () => {
    expect(
      serviceOperationDeadline(op({ type: "installation", deadline: PAST }), NOW),
    ).toEqual({ text: "просрочено 11 дн.", overdue: true });
    expect(
      serviceOperationDeadline(op({ type: "service", deadline: FUTURE }), NOW),
    ).toEqual({ text: "через 11 дн.", overdue: false });
  });

  it("терминальной считается только доставка", () => {
    // Отметка completed семантики у монтажа и своей услуги не несёт: срок
    // у них продолжает считаться (модель статусов не расширяется).
    expect(
      serviceOperationDeadline(
        op({ type: "installation", completed: true, deadline: PAST }),
        NOW,
      ),
    ).toEqual({ text: "просрочено 11 дн.", overdue: true });
    expect(
      serviceOperationDeadline(
        op({ type: "service", completed: true, deadline: PAST }),
        NOW,
      ),
    ).toEqual({ text: "просрочено 11 дн.", overdue: true });
  });
});

describe("isCompletedDelivery", () => {
  it("доставка с отметкой — завершена", () => {
    expect(isCompletedDelivery({ type: "delivery", completed: true })).toBe(true);
  });

  it("доставка без отметки, монтаж и своя услуга — не завершены", () => {
    expect(isCompletedDelivery({ type: "delivery", completed: false })).toBe(false);
    expect(isCompletedDelivery({ type: "installation", completed: true })).toBe(
      false,
    );
    expect(isCompletedDelivery({ type: "service", completed: true })).toBe(false);
  });
});
