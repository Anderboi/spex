import type { ServiceOperationType } from "@/lib/constants";
import { round2 } from "./pricing";

/**
 * Бюджет дополнительных расходов проекта (операции «Монтаж» и «Доставка»).
 *
 * Операция имеет ОДНУ стоимость (amount) на уровне проекта, хотя может быть
 * связана сразу с несколькими материалами. Поэтому все агрегаты считаются по
 * списку операций, а не по связям service_operation_items: каждая операция
 * учитывается ровно один раз, независимо от числа связанных позиций и от
 * отметки «исполнено»/статуса связанных материалов.
 *
 * Стоимость услуг никогда не добавляется в spec_items.cost / priceOf() /
 * sumItems(): эти функции остаются «стоимостью материалов».
 */

/** Минимальный набор полей операции, достаточный для расчёта бюджета. */
export type ServiceOperationBudgetRow = {
  type: ServiceOperationType;
  amount: number;
};

export type ServiceBudgetTotals = {
  /** Сумма по доставкам. */
  delivery: number;
  /** Сумма по монтажам. */
  installation: number;
  /** Все дополнительные расходы проекта = delivery + installation. */
  servicesTotal: number;
};

/** Пустой итог (операций нет — servicesTotal = 0). */
export const EMPTY_SERVICE_BUDGET: ServiceBudgetTotals = {
  delivery: 0,
  installation: 0,
  servicesTotal: 0,
};

/**
 * Единственная точка расчёта дополнительных расходов проекта.
 * Операция учитывается один раз по своей сумме: суммируем сам список операций,
 * поэтому несколько связанных с операцией материалов не задваивают стоимость.
 */
export function sumServiceOperationAmounts(
  ops: readonly ServiceOperationBudgetRow[],
): ServiceBudgetTotals {
  if (ops.length === 0) return EMPTY_SERVICE_BUDGET;

  let delivery = 0;
  let installation = 0;
  for (const op of ops) {
    const amount = Number(op.amount) || 0;
    if (op.type === "delivery") delivery += amount;
    else installation += amount;
  }

  const servicesTotal = delivery + installation;
  return {
    delivery: round2(delivery),
    installation: round2(installation),
    servicesTotal: round2(servicesTotal),
  };
}

/**
 * Общий бюджет проекта: стоимость материалов + стоимость всех услуг.
 * Материальная часть остаётся отдельной (ctx.stats.totalSum) — здесь только
 * итоговая сумма бюджета проекта.
 */
export function calcProjectTotal(
  materialsTotal: number,
  servicesTotal: number,
): number {
  return round2(materialsTotal + servicesTotal);
}
