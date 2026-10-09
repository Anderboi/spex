/**
 * События журнала позиции для графика платежей: `payment_plan_added`,
 * `payment_plan_changed`, `payment_plan_removed`.
 *
 * Живёт отдельно от ядра мутаций (`./payment-plan-mutations`) по той же причине,
 * по которой `history-types` отделён от `history`: билдеры — чистые функции от
 * уже прочитанной строки и проверяются без подставного клиента БД.
 *
 * ── Почему снимки берутся из строки, а не из ввода ─────────────────────────
 *
 * Клиент присылает намерение, а журнал обязан описывать то, что записалось.
 * Поэтому `from` приходит из строки, прочитанной ДО записи, а `to` — из
 * применённой строки, которую вернула БД: нормализованные название и условие уже
 * внутри неё. Иначе в ленте оказалось бы то, что пользователь набрал, а не то,
 * что лежит в графике.
 *
 * ── Формат изменений ───────────────────────────────────────────────────────
 *
 * `changes` — массив `{ field, from, to }` в snake_case, то есть ровно тот
 * формат, который уже умеет читать лента (`formatActivityChanges` из
 * `./activity-format`). Второго формата «что изменилось» в проекте не
 * появляется, и новых текстов для таблицы изменений писать не нужно: подписи
 * полей добавляются туда же, где остальные.
 */

import type { SpecItemEventActor, SpecItemEventInput } from "./history";
import type {
  PaymentPlanEventSnapshot,
  PaymentPlanFieldChange,
} from "./payment-plan-types";

/**
 * Общая часть payload'а: по ней строка графика опознаётся без чтения БД.
 *
 * Пустые название и условие нормализуются в `null`: `""` и `null` — одно
 * состояние «не заполнено», и в payload оно должно лежать одним способом.
 */
function planPayload(
  snapshot: PaymentPlanEventSnapshot,
): Record<string, unknown> {
  return {
    plan_id: snapshot.planId,
    title: snapshot.title,
    amount: snapshot.amount,
    condition: snapshot.condition || null,
    due_date: snapshot.dueDate || null,
  };
}

/**
 * `payment_plan_added` — в график добавлена строка.
 *
 * Одно добавление — одно событие. `position` входит в payload: по нему лента
 * объясняет, куда строка встала, и это единственное место, где порядок имеет
 * смысл как факт (при перестановке он меняется и попадает в `changes`).
 */
export function buildPaymentPlanAddedEvents(args: {
  orgId: string;
  specItemId: string;
  actor: SpecItemEventActor;
  snapshot: PaymentPlanEventSnapshot;
}): SpecItemEventInput[] {
  return [
    {
      orgId: args.orgId,
      specItemId: args.specItemId,
      actor: args.actor,
      kind: "payment_plan_added",
      payload: {
        ...planPayload(args.snapshot),
        position: args.snapshot.position,
      },
    },
  ];
}

/**
 * `payment_plan_changed` — строка графика изменена или переставлена.
 *
 * Пустой список изменений события не даёт: «сохранил, ничего не поменяв» — не
 * изменение, и это главный инвариант события (тем же правилом живут
 * `price_changed` и `variant_updated`). Перестановка приходит сюда же одним
 * изменением поля `position`, поэтому у одного вида события один формат.
 */
export function buildPaymentPlanChangedEvents(args: {
  orgId: string;
  specItemId: string;
  actor: SpecItemEventActor;
  snapshot: PaymentPlanEventSnapshot;
  changes: readonly PaymentPlanFieldChange[];
}): SpecItemEventInput[] {
  if (args.changes.length === 0) return [];

  return [
    {
      orgId: args.orgId,
      specItemId: args.specItemId,
      actor: args.actor,
      kind: "payment_plan_changed",
      payload: {
        ...planPayload(args.snapshot),
        changes: args.changes.map((change) => ({
          field: change.field,
          from: change.from,
          to: change.to,
        })),
      },
    },
  ];
}

/**
 * `payment_plan_removed` — строка графика удалена мягко.
 *
 * Снимок снимается ДО записи `deleted_at`: после неё строка остаётся в БД, но её
 * уже не читает ни один список, и взять подпись для ленты будет неоткуда.
 * `position` не сохраняется: порядок удалённой строки никого не занимает, а
 * сообщение «строка удалена» от номера не зависит.
 */
export function buildPaymentPlanRemovedEvents(args: {
  orgId: string;
  specItemId: string;
  actor: SpecItemEventActor;
  snapshot: PaymentPlanEventSnapshot;
}): SpecItemEventInput[] {
  return [
    {
      orgId: args.orgId,
      specItemId: args.specItemId,
      actor: args.actor,
      kind: "payment_plan_removed",
      payload: planPayload(args.snapshot),
    },
  ];
}
