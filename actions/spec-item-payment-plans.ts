"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { fail, ok, type ActionErrorCode, type ActionResult } from "@/lib/action-result";
import { eventActorOf, recordSpecItemEvents } from "@/lib/spec/history";
import {
  addPaymentPlan as addPaymentPlanCore,
  listPaymentPlans as listPaymentPlansCore,
  movePaymentPlanPosition as movePaymentPlanPositionCore,
  removePaymentPlan as removePaymentPlanCore,
  updatePaymentPlan as updatePaymentPlanCore,
  type PaymentPlansDb,
} from "@/lib/spec/payment-plan-mutations";
import {
  paymentPlanSchema,
  type PaymentPlanInput,
} from "@/lib/validations";
import type {
  PaymentPlanEntry,
  PaymentPlanError,
} from "@/lib/spec/payment-plan-types";

/**
 * График платежей позиции: действия вкладки «Платежи» карточки материала.
 *
 * ── Граница слоя ───────────────────────────────────────────────────────────
 *
 * Здесь только то, чего не может ядро (`lib/spec/payment-plan-mutations.ts`):
 * сессия, `orgSlug` → `orgId`, проверка прав организации, валидация формы и
 * запись событий журнала. Проверки принадлежности, чтение и запись строк — в
 * ядре, и именно поэтому они покрыты unit-тестами без Next и без живой БД.
 *
 * ── Кто что может ──────────────────────────────────────────────────────────
 *
 * * чтение — любому члену организации, включая `viewer` (решение O9: суммы
 *   видны всем, включая наблюдателей);
 * * запись — `can(role, "record:create")`: `viewer` отсекается той же границей,
 *   что у загрузки файлов, комментариев и RLS-политики
 *   `spec_item_payment_plans_insert_member`.
 *
 * ── Про `assertCanMutate` ──────────────────────────────────────────────────
 *
 * Он не используется намеренно: его `OwnedTable` (`lib/db/guard.ts`) знает
 * только «projects | materials | companies | contacts», а не таблицы позиции.
 * Авторство строки графика прав не даёт вовсе: платёж — это запись организации о
 * её деньгах, а не личная заметка (в отличие от комментария), и решение Q3
 * говорит «писать может любой член, кроме viewer». Поэтому проверка состоит из
 * членства (его даёт `requireOrgBySlug`) и роли.
 *
 * ── Почему события пишутся здесь ───────────────────────────────────────────
 *
 * Ядро возвращает ГОТОВЫЕ события операции, а не пишет их: запись журнала —
 * отдельный шаг того же действия, и он должен быть виден в одном месте для всех
 * пяти операций. Событие пишется ПОСЛЕ успешной записи строки: если бы журнал
 * падал раньше, в ленте осталось бы действие, которого не было. Если запись
 * события падает, ошибка уходит наверх — молча потерянное событие это дыра в
 * истории, которую потом не восстановить (`recordSpecItemEvent`).
 */

/** Код отказа ядра → код `ActionResult`. */
const ERROR_CODES: Record<PaymentPlanError["code"], ActionErrorCode> = {
  NOT_FOUND: "NOT_FOUND",
  INVALID_INPUT: "INVALID_INPUT",
  FAILED: "FAILED",
};

function toFailure(error: PaymentPlanError) {
  return fail(error.message, ERROR_CODES[error.code]);
}

/**
 * Позиция обязана быть в организации из сессии, а запись — разрешена ролью.
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
    console.error("[payment-plans] item", error.message);
    return { ctx, supabase, item: null, failed: true as const };
  }

  return { ctx, supabase, item, failed: false as const };
}

/** Разбор входных данных вкладки: единственные значения, которые шлёт клиент. */
function parseInput(
  input: unknown,
): { ok: true; data: PaymentPlanInput } | { ok: false; error: string } {
  const parsed = paymentPlanSchema.safeParse(input);
  if (!parsed.success) {
    // Первое сообщение схемы: у формы одно поле с ошибкой за раз, и
    // перечислять их списком пользователю незачем.
    const first = parsed.error.issues[0]?.message;
    return { ok: false, error: first ?? "Проверьте данные платежа" };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Записать события операции; ошибка журнала уходит наверх, а не глотается.
 *
 * Пустой список — нормальный случай (сохранение без изменений, повторное
 * удаление): в журнал тогда не идёт ничего.
 */
async function writeEvents(
  db: PaymentPlansDb,
  events: Parameters<typeof recordSpecItemEvents>[1],
): Promise<void> {
  await recordSpecItemEvents(db, events);
}

/* ------------------------------------------------------------------ */
/*  list                                                               */
/* ------------------------------------------------------------------ */

/** Строки графика позиции и сумма плана. Порядок задаёт сервер. */
export async function listPaymentPlans(
  orgSlug: string,
  specItemId: string,
): Promise<ActionResult<PaymentPlanEntry[]>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);
  if (failed) return fail("Не удалось получить график платежей");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const result = await listPaymentPlansCore(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
  });

  return result.ok ? ok(result.plans) : toFailure(result.error);
}

/* ------------------------------------------------------------------ */
/*  create                                                             */
/* ------------------------------------------------------------------ */

/**
 * Добавить строку графика.
 *
 * Права проверяются ДО валидации и записи: незачем разбирать данные тому, кому
 * операция всё равно запрещена.
 */
export async function createPaymentPlan(
  orgSlug: string,
  specItemId: string,
  input: unknown,
): Promise<ActionResult<PaymentPlanEntry>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для ведения графика платежей", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось добавить платёж");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const parsed = parseInput(input);
  if (!parsed.ok) return fail(parsed.error, "INVALID_INPUT");

  const result = await addPaymentPlanCore(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    // Актор собирается только на успешную запись: отказ не должен требовать
    // профиля пользователя вовсе.
    actor: eventActorOf(ctx),
    data: parsed.data,
  });

  if (!result.ok) return toFailure(result.error);

  await writeEvents(supabase, result.events);
  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok(result.plan);
}

/* ------------------------------------------------------------------ */
/*  update                                                             */
/* ------------------------------------------------------------------ */

/** Изменить строку графика (название, сумма, условие, срок). */
export async function updatePaymentPlan(
  orgSlug: string,
  specItemId: string,
  planId: string,
  input: unknown,
): Promise<ActionResult<PaymentPlanEntry>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для ведения графика платежей", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось изменить платёж");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const parsed = parseInput(input);
  if (!parsed.ok) return fail(parsed.error, "INVALID_INPUT");

  const result = await updatePaymentPlanCore(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    actor: eventActorOf(ctx),
    planId,
    data: parsed.data,
  });

  if (!result.ok) return toFailure(result.error);

  // Событие может быть пустым: сохранение без изменений — не изменение.
  await writeEvents(supabase, result.events);
  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok(result.plan);
}

/* ------------------------------------------------------------------ */
/*  delete                                                             */
/* ------------------------------------------------------------------ */

/** Мягко удалить строку графика. Повторный вызов идемпотентен. */
export async function deletePaymentPlan(
  orgSlug: string,
  specItemId: string,
  planId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для ведения графика платежей", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось удалить платёж");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const result = await removePaymentPlanCore(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    actor: eventActorOf(ctx),
    planId,
  });

  if (!result.ok) return toFailure(result.error);

  await writeEvents(supabase, result.events);
  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok({ deleted: result.deleted });
}

/* ------------------------------------------------------------------ */
/*  move                                                               */
/* ------------------------------------------------------------------ */

/**
 * Переставить строку графика на одну позицию.
 *
 * «Переставлять некуда» (первая строка вверх, последняя вниз) — не отказ, а
 * отсутствие действия: ответ успешный с `moved: false`, и UI ничего не
 * показывает. Ошибкой это было бы только для несуществующей строки.
 */
export async function movePaymentPlan(
  orgSlug: string,
  specItemId: string,
  planId: string,
  direction: "up" | "down",
): Promise<ActionResult<{ moved: boolean }>> {
  const { ctx, supabase, item, failed } = await resolveItem(orgSlug, specItemId);

  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для ведения графика платежей", "FORBIDDEN");
  }

  if (failed) return fail("Не удалось переставить платёж");
  if (!item) return fail("Позиция не найдена", "NOT_FOUND");

  const result = await movePaymentPlanPositionCore(supabase, {
    orgId: ctx.orgId,
    specItemId: item.id,
    actor: eventActorOf(ctx),
    planId,
    direction,
  });

  if (!result.ok) return toFailure(result.error);

  await writeEvents(supabase, result.events);
  revalidatePath(`/${orgSlug}/projects/${item.project_id}`);
  return ok({ moved: result.moved });
}
