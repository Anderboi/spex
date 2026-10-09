import { describe, expect, it } from "vitest";

import {
  paymentPlanDeadline,
  serviceOperationDeadline,
  type DeadlineOperation,
} from "./service-operation-deadline";

/**
 * Срок операции: исполненная операция — не активный дедлайн.
 *
 * Правило: пока отметка «Исполнено» не стоит, срок считается как раньше («через
 * N дн.» на будущую дату, «просрочено N дн.» на прошедшую). После отметки
 * состояния срока нет ни на прошедшую, ни на будущую, ни на сегодняшнюю дату —
 * плановая дата остаётся историческими данными.
 *
 * Отметка терминальна для ЛЮБОГО типа операции: закрыть работу можно и у
 * монтажа, и у своей услуги, и просрочка у них снимается так же. Раньше
 * терминальной считалась только доставка.
 *
 * Расчёт проверяется на фиксированном «сейчас» (`NOW`), а не на реальной дате:
 * иначе тест «исполнено + прошедшая дата» со временем переставал бы проверять
 * то, что должен.
 */

/** «Сегодня» для проверок — 20 мая 2026. */
const NOW = new Date("2026-05-20T15:30:00");
const PAST = "2026-05-09"; // 11 дней назад
const FUTURE = "2026-05-31"; // 11 дней вперёд
const TODAY = "2026-05-20";

function op(overrides: Partial<DeadlineOperation> = {}): DeadlineOperation {
  return { completed: false, deadline: FUTURE, ...overrides };
}

describe("serviceOperationDeadline", () => {
  it("исполнено + дата в прошлом: просрочка не рассчитывается", () => {
    expect(
      serviceOperationDeadline(op({ completed: true, deadline: PAST }), NOW),
    ).toBeNull();
  });

  it("исполнено + дата в будущем: «через N дн.» не рассчитывается", () => {
    expect(
      serviceOperationDeadline(op({ completed: true, deadline: FUTURE }), NOW),
    ).toBeNull();
  });

  it("исполнено + сегодня: состояния срока нет", () => {
    expect(
      serviceOperationDeadline(op({ completed: true, deadline: TODAY }), NOW),
    ).toBeNull();
  });

  it("исполнено: текущая дата не влияет на результат", () => {
    const completed = op({ completed: true, deadline: PAST });
    for (const now of [
      new Date("2020-01-01T00:00:00"),
      NOW,
      new Date("2030-12-31T23:59:59"),
    ]) {
      expect(serviceOperationDeadline(completed, now)).toBeNull();
    }
  });

  it("исполнено: плановая дата и отметка не подменяются", () => {
    const completed = op({ completed: true, deadline: PAST });
    serviceOperationDeadline(completed, NOW);
    expect(completed.deadline).toBe(PAST);
    expect(completed.completed).toBe(true);
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

  it("тип операции на срок не влияет: отметка терминальна для всех", () => {
    // Модуль знает только про отметку и дату — ни доставка, ни монтаж, ни своя
    // услуга его не различают. Это и есть новое правило: раньше снять просрочку
    // могла только доставка.
    const installation = { type: "installation", completed: true, deadline: PAST };
    const service = { type: "service", completed: true, deadline: PAST };

    expect(serviceOperationDeadline(installation, NOW)).toBeNull();
    expect(serviceOperationDeadline(service, NOW)).toBeNull();
    expect(
      serviceOperationDeadline({ ...installation, completed: false }, NOW),
    ).toEqual({ text: "просрочено 11 дн.", overdue: true });
  });
});

/**
 * Срок планового платежа — тем же правилом, что у операции (решение O6).
 *
 * Проверяется главное: формулировки и признак просрочки совпадают с услугой
 * символ в символ, а терминального состояния у платежа нет.
 */
describe("paymentPlanDeadline", () => {
  it("прошедшая дата — «просрочено N дн.» с тем же признаком", () => {
    expect(paymentPlanDeadline({ dueDate: PAST }, NOW)).toEqual(
      serviceOperationDeadline(op({ deadline: PAST }), NOW),
    );
  });

  it("будущая и сегодняшняя даты подписаны так же, как у операции", () => {
    expect(paymentPlanDeadline({ dueDate: FUTURE }, NOW)).toEqual(
      serviceOperationDeadline(op({ deadline: FUTURE }), NOW),
    );
    expect(paymentPlanDeadline({ dueDate: TODAY }, NOW)).toEqual(
      serviceOperationDeadline(op({ deadline: TODAY }), NOW),
    );
  });

  it("без срока состояния нет", () => {
    expect(paymentPlanDeadline({ dueDate: null }, NOW)).toBeNull();
  });

  it("срок не переписывается: дата остаётся историческими данными", () => {
    const row = { dueDate: PAST };
    paymentPlanDeadline(row, NOW);
    expect(row.dueDate).toBe(PAST);
  });
});
