"use server";

import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { isInProcurementScope } from "@/lib/constants";
import { priceOf } from "@/lib/spec/pricing";
import {
  summarisePaymentProgressByItem,
  type PaidAmountLike,
  type PaymentProgressItemInput,
  type PaymentProgressSummary,
} from "@/lib/spec/payment-schedule";
import { isPaymentKind } from "@/lib/spec/payment-types";
import { getProjectSpecItems } from "@/lib/queries";

/**
 * Деньги проекта по области воронки закупки: строка «оплачено · процент ·
 * остаток или переплата» в модалке «Закупка и поставка».
 *
 * ── База — стоимость позиции, а не сумма графика ───────────────────────────
 *
 * Здесь считается `оплачено` против СТОИМОСТИ позиций, ровно как во вкладке
 * «Платежи» (`paymentProgress`, ADR docs/adr/0003-ostatok-ot-stoimosti.md).
 * Прежняя редакция этой читалки складывала график (`Σ план` против `Σ факт`,
 * тикет 04) и показывала «план · остаток · переплата» по счетам. После ADR 0006
 * строка графика — это счёт с отметкой «Оплачено», а не обязательство, поэтому
 * «план 195 281 ₽» рядом с «Суммой в закупке 1 661 775 ₽» читался как «мы должны
 * в семь раз меньше, чем стоит закупка». Проектного агрегата по плану больше нет
 * вовсе (тикет 09) — и в модуле арифметики тоже.
 *
 * ── Почему позиции читаются тем же читателем, что страница проекта ─────────
 *
 * Стоимость позиции знает `priceOf` (`lib/spec/pricing.ts`) — с количеством,
 * запасом, скидками И активным вариантом: `spec_items.price` — зеркало, которое
 * `applyActiveVariant` перекрывает. Поэтому позиции берутся `getProjectSpecItems`,
 * а не собственным `select`: своя выборка на `spec_items` дала бы цену БЕЗ
 * варианта и разошлась бы с «Суммой в закупке» на экране — молча и в деньгах.
 * По той же причине здесь нет своей формулы стоимости: `priceOf(item)` — та же
 * функция, которой конструктор считает `scopeSum`.
 *
 * ── Что именно суммируется: область воронки, а не проект ───────────────────
 *
 * Требование тикета «по тем же позициям, что и „Сумма в закупке“» выполняется
 * буквально: `isInProcurementScope` — то же правило, из которого конструктор
 * строит `scopeSum`. Позиции ВНЕ области не выкидываются молча: их количество и
 * сальдо возвращаются отдельно (`outOfScopeCount`, `outOfScopeNet`), чтобы
 * модалка могла сказать «часть денег мимо этой суммы» вместо того, чтобы сложить
 * их в итог или сделать вид, что их нет. Считаются позиции С ОПЛАТАМИ, а не «с
 * графиком или оплатами»: график в этой строке больше не участвует, и позиция со
 * счётом, но без денег — не «деньги мимо».
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
 * ── Права ──────────────────────────────────────────────────────────────────
 *
 * Чтение — любому члену организации, включая `viewer` (решение Q3): суммы денег
 * видны всем, кто видит проект. Вызов без членства не доходит до запросов —
 * `requireOrgBySlug` бросает. Организация берётся из СЕССИИ и подставляется в
 * запрос денег: `orgSlug` приходит с клиента, и доверять ему как области
 * видимости нельзя.
 *
 * Записи здесь нет и быть не может: ведение платежей — во вкладке карточки.
 */

/** Что показывает строка оплат воронки. */
export type ProjectPaymentsSummary = {
  /** Стоимость, оплачено, остаток, переплата и процент по области воронки. */
  scope: PaymentProgressSummary;
  /**
   * Сколько позиций ВНЕ области воронки имеют оплаты.
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

/** Строка факта, как её отдаёт PostgREST. */
type PaymentRow = {
  spec_item_id: string;
  kind: string | null;
  amount: number | string;
  payment_plan_id: string | null;
  deleted_at: string | null;
};

export async function getProjectPaymentsSummary(
  orgSlug: string,
  projectId: string,
): Promise<ActionResult<ProjectPaymentsSummary>> {
  const ctx = await requireOrgBySlug(orgSlug);

  const db = createAdminClient();

  /**
   * Два независимых чтения параллельно, а не цепочкой: деньги проекта и его
   * позиции не зависят друг от друга.
   *
   * Отказ `getProjectSpecItems` переводится в общий отказ здесь: читатель
   * бросает (`«Не удалось загрузить спецификацию»`), а модалка различает только
   * «цифры» и «отказ» — показывать вместо второго текст чужого слоя значило бы
   * обещать объяснение, которого она не понимает.
   */
  const [paymentsResult, itemsResult] = await Promise.all([
    db
      .from("spec_item_payments")
      .select("spec_item_id, kind, amount, payment_plan_id, deleted_at")
      .eq("org_id", ctx.orgId)
      .eq("project_id", projectId)
      .is("deleted_at", null),
    getProjectSpecItems(orgSlug, projectId).then(
      (items) => ({ ok: true as const, items }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);

  if (paymentsResult.error) {
    console.error("[getProjectPaymentsSummary]", paymentsResult.error.message);
    return fail("Не удалось получить оплаты проекта");
  }

  if (!itemsResult.ok) {
    console.error("[getProjectPaymentsSummary]", itemsResult.error);
    return fail("Не удалось получить оплаты проекта");
  }

  const payments = (paymentsResult.data ?? []) as PaymentRow[];

  /**
   * Факты по позиции.
   *
   * `id` строки графика здесь не нужен: арифметике важно только то, к какой
   * СТРОКЕ привязан факт (для покрытия строки во вкладке), а сводке по стоимости
   * — какого он вида и сколько. Поэтому в `paymentPlanId` кладётся
   * `payment_plan_id` как есть, а не выдумывается отсутствующее значение.
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

  const inScope: PaymentProgressItemInput[] = [];
  const outOfScope: PaymentProgressItemInput[] = [];

  for (const item of itemsResult.items) {
    const input: PaymentProgressItemInput = {
      // Стоимость — та же, что у «Суммы в закупке»: одна функция `priceOf` на
      // обоих читателей, включая активный вариант позиции.
      total: priceOf(item).total,
      paidRows: paymentsByItem.get(item.id) ?? [],
    };

    (isInProcurementScope(item) ? inScope : outOfScope).push(input);
  }

  // Позиции, по которым есть деньги, но чьей строки нет в `spec_items` (строка
  // пришла из другого запроса или позиция исчезла), сюда не попадают вовсе:
  // приписать их к области воронки или к «мимо» значило бы выдумать ответ.
  // Запросы ограничены одним проектом и одной организацией, поэтому это
  // состояние — следствие удаления позиции, а не чужие данные.

  const scope = summarisePaymentProgressByItem(inScope);
  const outside = summarisePaymentProgressByItem(outOfScope);

  return ok({
    scope,
    outOfScopeCount: outOfScope.filter((item) => item.paidRows.length > 0).length,
    outOfScopeNet: outside.paid,
  });
}
