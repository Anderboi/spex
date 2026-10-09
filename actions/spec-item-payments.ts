"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, canMutateRecord } from "@/lib/permissions";
import { fail, ok, type ActionErrorCode, type ActionResult } from "@/lib/action-result";
import { eventActorOf, recordSpecItemEvents } from "@/lib/spec/history";
import {
  createPayment as createPaymentCore,
  listPayments as listPaymentsCore,
  removePayment as removePaymentCore,
  updatePayment as updatePaymentCore,
  type PaymentsDb,
} from "@/lib/spec/payment-mutations";
import {
  createPaymentSchema,
  updatePaymentSchema,
} from "@/lib/validations";
import type {
  PaymentEntry,
  PaymentError,
} from "@/lib/spec/payment-types";

/**
 * Фактические оплаты позиции: действия вкладки «Платежи» карточки материала.
 *
 * ── Граница слоя ───────────────────────────────────────────────────────────
 *
 * Здесь только то, чего не может ядро (`lib/spec/payment-mutations.ts`): сессия,
 * `orgSlug` → `orgId`, проверка прав организации, валидация формы и запись
 * событий журнала. Проверки принадлежности, идемпотентность и запись строк — в
 * ядре, и именно поэтому они покрыты unit-тестами без Next и без живой БД.
 *
 * ── Кто что может (решения Q3, O9, RLS-политики миграции) ──────────────────
 *
 * * чтение — любому члену организации, включая `viewer`: суммы видны всем;
 * * внести — любой член, кроме `viewer` (`can(role, "record:create")`), и только
 *   от своего имени: `created_by` берётся из сессии, а не из формы;
 * * изменить и отменить СВОЮ запись может автор, ЧУЖУЮ — только `owner`/`admin`
 *   (`canMutateRecord`). Порядок тот же, что у остальных записей организации, и
 *   тот же, что в RLS-политиках
 *   `spec_item_payments_update_author_or_manager` / `_delete_author_or_manager`.
 *
 * ── Почему права проверяются в TS, а не в БД ───────────────────────────────
 *
 * Приложение ходит service-role клиентом (`lib/supabase/admin.ts`), поэтому
 * `auth.uid()` в проде NULL и RLS-политики инертны (риск R3 отчёта). Политики
 * описывают границу для прямого доступа к Data API, а рабочая защита — здесь.
 *
 * ── Про `assertCanMutate` ──────────────────────────────────────────────────
 *
 * Он не используется намеренно: его `OwnedTable` (`lib/db/guard.ts`) знает
 * только «projects | materials | companies | contacts», а не таблицы позиции.
 * Поэтому проверка собрана из тех же двух функций, что у остальных записей:
 * `can` (роль) и `canMutateRecord` (автор или администратор).
 *
 * ── Почему события пишутся здесь ───────────────────────────────────────────
 *
 * Ядро возвращает ГОТОВЫЕ события операции, а не пишет их: запись журнала —
 * отдельный шаг того же действия, и он должен быть виден в одном месте для всех
 * операций. Событие пишется ПОСЛЕ успешной записи строки: если бы журнал падал
 * раньше, в ленте осталось бы действие, которого не было. Если запись события
 * падает, ошибка уходит наверх — молча потерянное событие это дыра в истории,
 * которую потом не восстановить (`recordSpecItemEvents`).
 *
 * Повтор запроса с тем же ключом идемпотентности (`existing: true`) событий не
 * даёт вовсе: действия не было, и запись о нём была бы ложью.
 */

/** Код отказа ядра → код `ActionResult`. */
const ERROR_CODES: Record<PaymentError["code"], ActionErrorCode> = {
  NOT_FOUND: "NOT_FOUND",
  INVALID_INPUT: "INVALID_INPUT",
  FORBIDDEN: "FORBIDDEN",
  // Конфликт ключа идемпотентности — не ошибка формата: текст корректен, но
  // запрос отличается от уже записанного. `FAILED` честнее `INVALID_INPUT`:
  // подсвечивать поле ввода нечего.
  IDEMPOTENCY_CONFLICT: "FAILED",
  // Строку графика нельзя удалить, пока по ней есть оплаты. Для UI это тоже не
  // ошибка формата: показываем текст и оставляем список как есть.
  PLAN_HAS_PAYMENTS: "FAILED",
  FAILED: "FAILED",
};

function toFailure(error: PaymentError) {
  return fail(error.message, ERROR_CODES[error.code]);
}

/**
 * Позиция обязана быть в организации из сессии.
 *
 * `projectId` возвращается вместе с позицией: он нужен для `revalidatePath`.
 * Из формы он не читается — как и `org_id`, — поэтому подсунуть чужой проект
 * нечем.
 */
async function resolveItem(orgSlug: string, specItemId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data: item, error } = await supabase
    .from("spec_items")
    .select("id, project_id, org_id")
    .eq("id", specItemId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    // Текст ошибки БД — внутренняя деталь, а не сообщение для пользователя.
    console.error("[payments] item", error.message);
    return { ctx, supabase, item: null, failed: true as const };
  }

  return { ctx, supabase, item, failed: false as const };
}

/** Первое сообщение схемы: у формы одно поле с ошибкой за раз. */
function firstIssue(error: { issues: { message: string }[] }, fallback: string) {
  return error.issues[0]?.message ?? fallback;
}

/**
 * Записать события операции; ошибка журнала уходит наверх, а не глотается.
 *
 * Пустой список — нормальный случай (сохранение без изменений, повторный
 * запрос с тем же ключом, повторная отмена): в журнал тогда не идёт ничего.
 */
async function writeEvents(
  db: PaymentsDb,
  events: Parameters<typeof recordSpecItemEvents>[1],
): Promise<void> {
  await recordSpecItemEvents(db, events);
}

/* ------------------------------------------------------------------ */
/*  list                                                               */
/* ------------------------------------------------------------------ */

/** Фактические оплаты позиции. Порядок задаёт сервер: поздние по дате — первыми. */
export async function listPayments(
  orgSlug: string,
  specItemId: string,
): Promise<ActionResult<PaymentEntry[]>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);
  if (failed) return fail("Не удалось получить список оплат");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const result = await listPaymentsCore(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
  });

  return result.ok ? ok(result.payments) : toFailure(result.error);
}

/* ------------------------------------------------------------------ */
/*  create                                                             */
/* ------------------------------------------------------------------ */

/**
 * Внести оплату или возврат.
 *
 * Права проверяются ДО валидации и записи: незачем разбирать данные тому, кому
 * операция всё равно запрещена.
 */
export async function createPayment(
  orgSlug: string,
  specItemId: string,
  input: unknown,
): Promise<ActionResult<PaymentEntry>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для внесения оплат", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось записать оплату");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const parsed = createPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error, "Проверьте данные оплаты"), "INVALID_INPUT");
  }

  const { idempotencyKey, ...data } = parsed.data;

  const result = await createPaymentCore(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    // Актор собирается только на успешную запись: отказ не должен требовать
    // профиля пользователя вовсе.
    actor: eventActorOf(ctx),
    idempotencyKey,
    data,
  });

  if (!result.ok) return toFailure(result.error);

  await writeEvents(supabase, result.events);
  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok(result.payment);
}

/* ------------------------------------------------------------------ */
/*  update                                                             */
/* ------------------------------------------------------------------ */

/**
 * Изменить запись.
 *
 * Автора записи знает только БД, поэтому сперва читается строка: она нужна и для
 * проверки прав (`created_by`), и для того, чтобы ответить `NOT_FOUND` вместо
 * `FORBIDDEN` на чужой идентификатор. Порядок «чужая запись → отказ по правам»
 * намеренный: по коду отказа нельзя узнать о существовании чужой строки больше,
 * чем о несуществующей, но и молчать о запрете нельзя — пользователь должен
 * понимать, что дело в правах, а не в сети.
 */
export async function updatePayment(
  orgSlug: string,
  specItemId: string,
  paymentId: string,
  input: unknown,
): Promise<ActionResult<PaymentEntry>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для правки оплат", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось изменить оплату");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const parsed = updatePaymentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error, "Проверьте данные оплаты"), "INVALID_INPUT");
  }

  const { data: current, error: readError } = await supabase
    .from("spec_item_payments")
    .select("id, created_by")
    .eq("id", paymentId)
    .eq("org_id", ctx.orgId)
    .eq("spec_item_id", item.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (readError) {
    console.error("[updatePayment] read", readError.message);
    return fail("Не удалось изменить оплату");
  }

  if (!current) return fail("Оплата не найдена", "NOT_FOUND");

  if (
    !canMutateRecord({
      role: ctx.role,
      userId: ctx.userId,
      createdBy: current.created_by,
    })
  ) {
    return fail("Изменить чужую оплату может только владелец или администратор", "FORBIDDEN");
  }

  const result = await updatePaymentCore(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    actor: eventActorOf(ctx),
    paymentId,
    data: parsed.data,
  });

  if (!result.ok) return toFailure(result.error);

  // Событие может быть пустым: сохранение без изменений — не изменение.
  await writeEvents(supabase, result.events);
  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok(result.payment);
}

/* ------------------------------------------------------------------ */
/*  delete                                                             */
/* ------------------------------------------------------------------ */

/**
 * Отменить запись (мягко удалить).
 *
 * Повторный вызов идемпотентен: запись уже отменена → `deleted: false` и никакого
 * события. Физического удаления нет намеренно: финансовая история не удаляется
 * (ADR 0004) — ошибочная проводка остаётся видимой в журнале.
 */
export async function deletePayment(
  orgSlug: string,
  specItemId: string,
  paymentId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для отмены оплат", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось отменить оплату");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const { data: current, error: readError } = await supabase
    .from("spec_item_payments")
    .select("id, created_by")
    .eq("id", paymentId)
    .eq("org_id", ctx.orgId)
    .eq("spec_item_id", item.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (readError) {
    console.error("[deletePayment] read", readError.message);
    return fail("Не удалось отменить оплату");
  }

  if (!current) return fail("Оплата не найдена", "NOT_FOUND");

  if (
    !canMutateRecord({
      role: ctx.role,
      userId: ctx.userId,
      createdBy: current.created_by,
    })
  ) {
    return fail("Отменить чужую оплату может только владелец или администратор", "FORBIDDEN");
  }

  const result = await removePaymentCore(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    actor: eventActorOf(ctx),
    paymentId,
  });

  if (!result.ok) return toFailure(result.error);

  await writeEvents(supabase, result.events);
  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok({ deleted: result.deleted });
}
