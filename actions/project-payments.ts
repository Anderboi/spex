"use server";

import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import {
  SPEC_STATUSES,
  isInProcurementScope,
  type SpecStatus,
} from "@/lib/constants";
import {
  summarisePaymentScheduleByItem,
  type PaidAmountLike,
  type PaymentPlanAmountLike,
  type PaymentScheduleItemInput,
  type PaymentScheduleSummary,
} from "@/lib/spec/payment-schedule";
import { isPaymentKind } from "@/lib/spec/payment-types";

/**
 * Деньги проекта по области воронки закупки: строка «план · оплачено · остаток ·
 * переплата» в модалке «Закупка и поставка» (тикет 04).
 *
 * ── Почему действие, а не проп из страницы ─────────────────────────────────
 *
 * Так решено в `research/06-procure-data-path.md` (вариант «б»): тот же приём,
 * которым уже живёт `SpecSummary` → `listProjectSpecCompositions`. Модалка
 * монтируется на каждое открытие (`dynamic(..., { ssr: false })`), поэтому
 * цифры всегда читаются заново и синхронизировать их после записи платежа не
 * нужно вовсе. Проп из страницы дал бы свежесть только при открытии по URL и
 * постоянный запрос на каждый заход в проект.
 *
 * ── Откуда берётся формула ─────────────────────────────────────────────────
 *
 * Никакой арифметики здесь нет: строки группируются по позициям, и каждая
 * считается `summarisePaymentSchedule` — тем же модулем, что и вкладка
 * «Платежи» карточки. Складывает позиции `summarisePaymentScheduleByItem`.
 * Требование тикета «формула совпадает с расчётом вкладки» выполняется по
 * построению, а не дисциплиной: второго рецепта остатка в проекте не появляется.
 *
 * ── Что именно суммируется: область воронки, а не проект ───────────────────
 *
 * Тикет: «по тем же позициям, что и „Сумма в закупке“». Это ровно
 * `isInProcurementScope` — то же правило, из которого конструктор строит
 * `scopeSum`. Позиции ВНЕ области не выкидываются молча: их количество и
 * сальдо возвращаются отдельно (`outOfScopeCount`, `outOfScopeNet`), чтобы
 * модалка могла сказать «часть оплат мимо этой суммы» вместо того, чтобы
 * сложить их в итог или сделать вид, что их нет.
 *
 * ── Почему позиции читаются третьим запросом ───────────────────────────────
 *
 * `spec_item_payments` и `spec_item_payment_plans` знают `project_id`, поэтому
 * их можно прочитать прямо по проекту. А `status` и `is_placeholder` — в
 * `spec_items`, и без них область воронки не определить. Читаются трое
 * параллельно (`Promise.all`): это три независимых условия, а не цепочка.
 *
 * ── Права ──────────────────────────────────────────────────────────────────
 *
 * Чтение — любому члену организации, включая `viewer` (решение Q3): суммы денег
 * видны всем, кто видит проект. Вызов без членства не доходит до запросов —
 * `requireOrgBySlug` бросает. Организация берётся из СЕССИИ и подставляется в
 * каждый запрос: `orgSlug` приходит с клиента, и доверять ему как области
 * видимости нельзя.
 *
 * Записи здесь нет и быть не может: ведение платежей — во вкладке карточки.
 */

/** Что показывает строка воронки. */
export type ProjectPaymentsSummary = {
  /** План, оплачено, возвраты, остаток, переплата, вне графика по области воронки. */
  scope: PaymentScheduleSummary;
  /**
   * Сколько позиций ВНЕ области воронки имеют оплаты или график.
   *
   * Считаются позиции, а не записи: пользователю важно «эти деньги не в сумме»,
   * а не сколько строк их составило.
   */
  outOfScopeCount: number;
  /**
   * Сальдо по позициям вне области: оплаты минус возвраты.
   *
   * Может быть отрицательным (возвратов больше, чем оплат) и нулевым при
   * ненулевом счёте — поэтому признак «мимо» несёт счётчик, а не эта величина.
   */
  outOfScopeNet: number;
};

/** Строка позиции, как её отдаёт PostgREST. */
type ItemRow = {
  id: string;
  status: string | null;
  is_placeholder: boolean | null;
  deleted_at: string | null;
};

/** Строка графика, как её отдаёт PostgREST. */
type PlanRow = {
  spec_item_id: string;
  amount: number | string;
  deleted_at: string | null;
};

/** Строка факта, как её отдаёт PostgREST. */
type PaymentRow = {
  spec_item_id: string;
  kind: string | null;
  amount: number | string;
  payment_plan_id: string | null;
  deleted_at: string | null;
};

/**
 * Проверка статуса из БД.
 *
 * `status` приходит строкой: значение из CHECK-ограничения, но тип его не знает.
 * Словарь берётся из `SPEC_STATUSES` — того же списка, которым живёт
 * `z.enum(SPEC_STATUSES)` в валидации и `SPEC_STATUS_CONFIG` в интерфейсе.
 * Свой список здесь разошёлся бы с ним молча, и новый статус читался бы как
 * «вне воронки»: сумма закупки тихо уменьшилась бы, а причина была бы не видна.
 *
 * Незнакомый статус — «вне воронки»: та же граница, что у `isPaymentKind` для
 * вида записи. Испорченное значение не должно втянуть позицию в сумму закупки.
 */
function isSpecStatus(value: unknown): value is SpecStatus {
  return SPEC_STATUSES.includes(value as SpecStatus);
}

export async function getProjectPaymentsSummary(
  orgSlug: string,
  projectId: string,
): Promise<ActionResult<ProjectPaymentsSummary>> {
  const ctx = await requireOrgBySlug(orgSlug);

  const db = createAdminClient();

  const [plansResult, paymentsResult, itemsResult] = await Promise.all([
    db
      .from("spec_item_payment_plans")
      .select("spec_item_id, amount, deleted_at")
      .eq("org_id", ctx.orgId)
      .eq("project_id", projectId)
      .is("deleted_at", null),
    db
      .from("spec_item_payments")
      .select("spec_item_id, kind, amount, payment_plan_id, deleted_at")
      .eq("org_id", ctx.orgId)
      .eq("project_id", projectId)
      .is("deleted_at", null),
    db
      .from("spec_items")
      .select("id, status, is_placeholder, deleted_at")
      .eq("org_id", ctx.orgId)
      .eq("project_id", projectId)
      .is("deleted_at", null),
  ]);

  if (plansResult.error || paymentsResult.error || itemsResult.error) {
    console.error(
      "[getProjectPaymentsSummary]",
      plansResult.error?.message ??
        paymentsResult.error?.message ??
        itemsResult.error?.message,
    );
    return fail("Не удалось получить оплаты проекта");
  }

  const plans = (plansResult.data ?? []) as PlanRow[];
  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const items = (itemsResult.data ?? []) as ItemRow[];

  /** График по позиции: одному запросу принадлежит один график. */
  const plansByItem = new Map<string, PaymentPlanAmountLike[]>();
  for (const plan of plans) {
    const bucket = plansByItem.get(plan.spec_item_id) ?? [];
    // Сумма и признак удаления — ровно то, чем живёт сводка. Запрос уже отсекает
    // удалённые строки, и то же правило применяется в `summarisePaymentSchedule`
    // повторно: проектный агрегат обязан получить правило вкладки, а не своё.
    bucket.push({ amount: plan.amount, deletedAt: plan.deleted_at });
    plansByItem.set(plan.spec_item_id, bucket);
  }

  /**
   * Факты по позиции.
   *
   * `id` строки графика здесь не нужен: арифметике важно только то, к какой
   * СТРОКЕ привязан факт (для покрытия) и какого он вида. Поэтому в
   * `paymentPlanId` кладётся `payment_plan_id` как есть.
   */
  const paymentsByItem = new Map<string, PaidAmountLike[]>();
  for (const payment of payments) {
    const bucket = paymentsByItem.get(payment.spec_item_id) ?? [];
    bucket.push({
      paymentPlanId: payment.payment_plan_id,
      amount: payment.amount,
      kind: isPaymentKind(payment.kind) ? payment.kind : "payment",
      deletedAt: payment.deleted_at,
    });
    paymentsByItem.set(payment.spec_item_id, bucket);
  }

  const inScope: PaymentScheduleItemInput[] = [];
  const outOfScope: PaymentScheduleItemInput[] = [];

  for (const item of items) {
    const input: PaymentScheduleItemInput = {
      plans: plansByItem.get(item.id) ?? [],
      paidRows: paymentsByItem.get(item.id) ?? [],
    };

    const isInScope =
      isSpecStatus(item.status) &&
      isInProcurementScope({
        isPlaceholder: item.is_placeholder === true,
        status: item.status,
      });

    (isInScope ? inScope : outOfScope).push(input);
  }

  // Позиции, по которым есть деньги, но чьей строки нет в `spec_items` (строка
  // пришла из другого запроса или позиция исчезла), сюда не попадают вовсе:
  // приписать их к области воронки или к «мимо» значило бы выдумать ответ.
  // Запросы ограничены одним проектом и одной организацией, поэтому это
  // состояние — следствие удаления позиции, а не чужие данные.

  const scope = summarisePaymentScheduleByItem(inScope);
  const outside = summarisePaymentScheduleByItem(outOfScope);

  return ok({
    scope,
    outOfScopeCount: outOfScope.filter(
      (item) => item.plans.length > 0 || item.paidRows.length > 0,
    ).length,
    outOfScopeNet: outside.paid,
  });
}
