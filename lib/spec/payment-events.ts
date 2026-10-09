/**
 * События журнала позиции для фактических оплат: `payment_added`,
 * `payment_changed`, `payment_removed`.
 *
 * Живёт отдельно от ядра мутаций (`./payment-mutations`) по той же причине, по
 * которой `payment-plan-events` отделён от `payment-plan-mutations`: билдеры —
 * чистые функции от уже прочитанной строки и проверяются без подставного клиента
 * БД.
 *
 * ── Почему снимки берутся из строки, а не из ввода ─────────────────────────
 *
 * Клиент присылает намерение, а журнал обязан описывать то, что записалось.
 * Поэтому `from` приходит из строки, прочитанной ДО записи, а `to` — из
 * применённой строки, которую вернула БД. Иначе в ленте оказалось бы то, что
 * пользователь набрал, а не то, что лежит в платежах.
 *
 * ── Формат payload'а ───────────────────────────────────────────────────────
 *
 * Ключи — ровно те, которые читает `./history-mappers` (`payment_id`,
 * `payment_kind`, `amount`, `paid_at`, `plan_id`), а `changes` — массив
 * `{ field, from, to }` в snake_case, то есть тот же формат «что изменилось»,
 * что у остальных событий (`formatActivityChanges` из `./activity-format`).
 * Второго формата в проекте не появляется.
 *
 * `plan_id` в payload'е и `payment_plan_id` в поле изменения — одно и то же
 * значение под двумя именами, и это не небрежность: payload читает маппер, у
 * которого `plan_id` уже объявлен и покрыт тестами, а поле изменения называет
 * КОЛОНКУ таблицы (`payment_plan_id`) — так подписи полей берутся из словаря
 * `PAYMENT_FIELD_LABEL`, а не выдумываются.
 */

import type { SpecItemEventActor, SpecItemEventInput } from "./history";
import type {
  PaymentEventSnapshot,
  PaymentFieldChange,
} from "./payment-types";

/**
 * Общая часть payload'а: по ней запись опознаётся без чтения БД.
 *
 * `plan_id: null` означает «оплата вне графика» — это величина, а не отсутствие
 * сведений, поэтому поле пишется всегда.
 */
function paymentPayload(
  snapshot: PaymentEventSnapshot,
): Record<string, unknown> {
  return {
    payment_id: snapshot.paymentId,
    payment_kind: snapshot.kind,
    amount: snapshot.amount,
    paid_at: snapshot.paidAt,
    plan_id: snapshot.paymentPlanId,
  };
}

/** `payment_added` — внесена оплата или возврат. */
export function buildPaymentAddedEvents(args: {
  orgId: string;
  specItemId: string;
  actor: SpecItemEventActor;
  snapshot: PaymentEventSnapshot;
}): SpecItemEventInput[] {
  return [
    {
      orgId: args.orgId,
      specItemId: args.specItemId,
      actor: args.actor,
      kind: "payment_added",
      payload: paymentPayload(args.snapshot),
    },
  ];
}

/**
 * `payment_changed` — запись изменена.
 *
 * Пустой список изменений события не даёт: «сохранил, ничего не поменяв» — не
 * изменение, и это главный инвариант события (тем же правилом живут
 * `payment_plan_changed` и `price_changed`).
 */
export function buildPaymentChangedEvents(args: {
  orgId: string;
  specItemId: string;
  actor: SpecItemEventActor;
  snapshot: PaymentEventSnapshot;
  changes: readonly PaymentFieldChange[];
}): SpecItemEventInput[] {
  if (args.changes.length === 0) return [];

  return [
    {
      orgId: args.orgId,
      specItemId: args.specItemId,
      actor: args.actor,
      kind: "payment_changed",
      payload: {
        ...paymentPayload(args.snapshot),
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
 * `payment_removed` — запись отменена (мягко удалена).
 *
 * Снимок снимается ДО записи `deleted_at`: после неё строка остаётся в БД, но её
 * уже не читает ни один список, и взять подпись для ленты будет неоткуда.
 */
export function buildPaymentRemovedEvents(args: {
  orgId: string;
  specItemId: string;
  actor: SpecItemEventActor;
  snapshot: PaymentEventSnapshot;
}): SpecItemEventInput[] {
  return [
    {
      orgId: args.orgId,
      specItemId: args.specItemId,
      actor: args.actor,
      kind: "payment_removed",
      payload: paymentPayload(args.snapshot),
    },
  ];
}
