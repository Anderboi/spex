/**
 * График платежей позиции: ядро операций без сессии и без Next.
 *
 * ── Почему отдельный модуль ────────────────────────────────────────────────
 *
 * Ровно по той же причине, по которой существуют `./comment-write`,
 * `./spec-item-files` и `./history-read`: сессия, `orgSlug` → `orgId`, проверка
 * прав организации и форма ответа для клиента живут в server action
 * (`actions/spec-item-payment-plans.ts`), а проверки принадлежности, чтение и
 * запись строк — здесь, куда клиент БД приходит аргументом (DI, как в
 * `recordSpecItemEvent`). Так контракт проверяется unit-тестами на подставном
 * клиенте, без Next и без живой БД.
 *
 * ── Границы доверия ───────────────────────────────────────────────────────
 *
 * От клиента приходят четыре значения: название, сумма, условие оплаты и
 * необязательный срок. Всё остальное определяет сервер: `orgId` (из сессии),
 * `specItemId` (из аргумента, проверенного по организации), `projectId` (из
 * строки позиции, а на запись — из триггера), `position` (конец графика),
 * `created_by` (из сессии). Ни `position`, ни `org_id`, ни `project_id` не
 * входят ни в один входной тип — подсунуть их нечем.
 *
 * ── Событие журнала возвращается, а не пишется здесь ───────────────────────
 *
 * Запись события — отдельный шаг того же действия (`recordSpecItemEvents`), и
 * делать его здесь значило бы смешать две ответственности в одной функции.
 * Поэтому каждая операция возвращает готовые события, а action пишет их одним
 * INSERT. Побочный эффект приятный: «что попало в журнал» проверяется
 * unit-тестом без подставного журнала.
 *
 * ── Почему перестановка — два UPDATE ───────────────────────────────────────
 *
 * Частичный уникальный индекс `(spec_item_id, position) where deleted_at is null`
 * не даёт двум строкам делить номер. Обмен местами (1, 2) → (2, 1) одним
 * statement'ом невозможен и в SQL: промежуточное состояние нарушило бы индекс.
 * Поэтому строки сначала уводятся в диапазон, которого не может достичь ни одна
 * живая строка (отрицательные номера), и только потом получают финальные
 * значения. Второй UPDATE заодно нормирует порядок: он записывает
 * `0..n-1` каждому, кто реально участвует в перестановке, поэтому «дублей
 * порядка не остаётся» — это свойство запроса, а не надежда на аккуратность
 * вызывающего.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import type { SpecItemEventActor, SpecItemEventInput } from "./history";
import { callRpc } from "../supabase/rpc";
import {
  buildPaymentPlanAddedEvents,
  buildPaymentPlanChangedEvents,
  buildPaymentPlanRemovedEvents,
} from "./payment-plan-events";
import { toAmount } from "./payment-schedule";
import type {
  PaymentPlanData,
  PaymentPlanEntry,
  PaymentPlanError,
  PaymentPlanFieldChange,
  PaymentPlanValues,
} from "./payment-plan-types";

/**
 * Причина отказа графика — тот же тип, которым отвечают действия вкладки.
 * Реэкспортируется для ядра оплат: проверка «есть ли оплаты по строке» живёт
 * там, а отказ принадлежит словарю плана.
 */
export type { PaymentPlanError };

/** Клиент БД: как у остальных слоёв, приходит аргументом. */
export type PaymentPlansDb = SupabaseClient<Database>;

/**
 * Колонки, нужные домену. Литерал обязателен: по нему supabase-js выводит тип
 * строки, и `select("*")` здесь был бы догадкой о схеме.
 */
const PLAN_COLUMNS =
  "id, org_id, project_id, spec_item_id, title, amount, condition, due_date, position, created_by, created_at, updated_at, deleted_at";

type PlanRow = {
  id: string;
  org_id: string;
  project_id: string;
  spec_item_id: string;
  title: string;
  amount: number | string;
  condition: string | null;
  due_date: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/* ------------------------------------------------------------------ */
/*  Результаты операций                                                */
/* ------------------------------------------------------------------ */

export type ListPaymentPlansResult =
  | { ok: true; plans: PaymentPlanEntry[] }
  | { ok: false; error: PaymentPlanError };

type MutationSuccess = {
  ok: true;
  plan: PaymentPlanEntry;
  /** Готовые события журнала: пишет их action, одним INSERT. */
  events: SpecItemEventInput[];
};

export type AddPaymentPlanResult = MutationSuccess | { ok: false; error: PaymentPlanError };
export type UpdatePaymentPlanResult = MutationSuccess | { ok: false; error: PaymentPlanError };

export type RemovePaymentPlanResult =
  | { ok: true; plan: PaymentPlanEntry; deleted: boolean; events: SpecItemEventInput[] }
  | { ok: false; error: PaymentPlanError };

/**
 * Текст отказа «по строке графика есть неудалённые оплаты» (решение Q9).
 *
 * Чистая функция: текст не зависит ни от клиента БД, ни от того, кто его
 * вызвал, — а вызвать его обязаны ДВА места. Ядро (`removePaymentPlan`) —
 * чтобы правило нельзя было обойти, вызвав ядро напрямую, и action — чтобы
 * проверить оплаты ДО удаления и не оставить в журнале событие об удалении,
 * которого не было. Два текста вместо одного разошлись бы на первой правке.
 */
export function planHasPaymentsMessage(count: number): string {
  if (count === 1) {
    return "По строке графика есть оплата: сначала отвяжите или отмените её";
  }
  return `По строке графика есть оплаты (${count}): сначала отвяжите или отмените их`;
}

/*
 * Результат перестановки объявлен ниже, рядом с самой операцией: её исход —
 * описание изменения порядка, а не готовое событие (актора знает только action).
 */

/* ------------------------------------------------------------------ */
/*  Преобразования                                                     */
/* ------------------------------------------------------------------ */

function toEntry(row: PlanRow): PaymentPlanEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    specItemId: row.spec_item_id,
    title: row.title,
    amount: toAmount(row.amount),
    condition: row.condition,
    dueDate: row.due_date,
    position: row.position,
    authorId: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Снимок строки для события журнала — из строки БД, не из клиентских данных. */
function toSnapshot(row: PlanRow) {
  return {
    planId: row.id,
    title: row.title,
    amount: toAmount(row.amount),
    condition: row.condition,
    dueDate: row.due_date,
    position: row.position,
  };
}

function notFound(message = "Строка графика не найдена"): {
  ok: false;
  error: PaymentPlanError;
} {
  return { ok: false, error: { code: "NOT_FOUND", message } };
}

function invalidInput(message: string): {
  ok: false;
  error: PaymentPlanError;
} {
  return { ok: false, error: { code: "INVALID_INPUT", message } };
}

function failed(message: string): { ok: false; error: PaymentPlanError } {
  return { ok: false, error: { code: "FAILED", message } };
}

/* ------------------------------------------------------------------ */
/*  Проверка позиции                                                   */
/* ------------------------------------------------------------------ */

type SpecItemRow = {
  id: string;
  org_id: string;
  project_id: string;
  deleted_at: string | null;
};

/**
 * Позиция в этой организации и не удалённая.
 *
 * Проверка идёт по `org_id` из сессии, а не по аргументу: чужой id не даёт ни
 * графика, ни сведения о том, существует ли он. Тот же паттерн, что в
 * `resolveItem` у файлов и комментариев.
 *
 * Экспортируется: фактические оплаты (`./payment-mutations`) проверяют позицию
 * РОВНО тем же запросом, и вторая его копия означала бы второе правило
 * «позиция в организации».
 */
export async function resolveSpecItem(
  db: PaymentPlansDb,
  args: { orgId: string; specItemId: string },
): Promise<
  { ok: true; item: SpecItemRow } | { ok: false; error: PaymentPlanError }
> {
  const { data, error } = await db
    .from("spec_items")
    .select("id, org_id, project_id, deleted_at")
    .eq("id", args.specItemId)
    .eq("org_id", args.orgId)
    .maybeSingle<SpecItemRow>();

  if (error) {
    // Текст ошибки БД — внутренняя деталь, а не сообщение для пользователя.
    console.error("[payment-plans] item", error.message);
    return failed("Не удалось получить график платежей");
  }

  if (!data || data.deleted_at !== null) return notFound("Позиция не найдена");

  return { ok: true, item: data };
}

/* ------------------------------------------------------------------ */
/*  Проверка пользовательских данных                                   */
/* ------------------------------------------------------------------ */

/**
 * Правила строки графика: непустое название, положительная конечная сумма,
 * пустое условие — это «не задано».
 *
 * Те же границы продублированы CHECK-ограничениями таблицы. Дубль намеренный:
 * здесь отказ приходит понятным текстом и до запроса, а ограничение БД остаётся
 * последней линией для строки, попавшей в базу в обход кода.
 */
export function validatePaymentPlanData(
  data: PaymentPlanData,
): { ok: true; values: PaymentPlanValues } | { ok: false; error: PaymentPlanError } {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (title.length === 0) return invalidInput("Укажите название платежа");

  const amount = typeof data.amount === "number" ? data.amount : Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return invalidInput("Сумма платежа должна быть больше нуля");
  }

  const condition =
    typeof data.condition === "string" && data.condition.trim().length > 0
      ? data.condition.trim()
      : null;

  const dueDate =
    typeof data.dueDate === "string" && data.dueDate.trim().length > 0
      ? data.dueDate.trim()
      : null;

  return { ok: true, values: { title, amount, condition, dueDate } };
}

/* ------------------------------------------------------------------ */
/*  list                                                               */
/* ------------------------------------------------------------------ */

/**
 * Активные строки графика позиции по порядку отображения.
 *
 * Сортировка в запросе повторяет `orderPaymentPlans`: клиент список не
 * пересортировывает, иначе порядок в интерфейсе и порядок в БД разошлись бы.
 */
export async function listPaymentPlans(
  db: PaymentPlansDb,
  args: { orgId: string; specItemId: string },
): Promise<ListPaymentPlansResult> {
  const item = await resolveSpecItem(db, args);
  if (!item.ok) return { ok: false, error: item.error };

  const { data, error } = await db
    .from("spec_item_payment_plans")
    .select(PLAN_COLUMNS)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .is("deleted_at", null)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("[listPaymentPlans]", error.message);
    return failed("Не удалось получить график платежей");
  }

  return { ok: true, plans: (data ?? []).map((row) => toEntry(row as PlanRow)) };
}

/* ------------------------------------------------------------------ */
/*  add                                                                */
/* ------------------------------------------------------------------ */

/** Номер порядка для новой строки: конец графика среди активных строк. */
async function nextPosition(
  db: PaymentPlansDb,
  args: { orgId: string; specItemId: string },
): Promise<{ ok: true; position: number } | { ok: false; error: PaymentPlanError }> {
  // Строка с самым большим номером порядка: `limit(1)` вместо чтения всего
  // графика — новой строке нужен только максимум.
  const { data, error } = await db
    .from("spec_item_payment_plans")
    .select("position")
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[payment-plans] nextPosition", error.message);
    return failed("Не удалось добавить платёж");
  }

  const top = (data ?? [])[0] as { position: number } | undefined;

  return { ok: true, position: (top?.position ?? -1) + 1 };
}

/**
 * Добавить строку графика.
 *
 * Строка встаёт в конец графика: `position` считает сервер, и вставить платёж
 * «между» существующими одним запросом нельзя — это была бы перестановка,
 * отдельное действие со своим событием.
 *
 * ── Гонка двух добавлений ─────────────────────────────────────────────────
 *
 * Два одновременных добавления могут прочитать один и тот же максимум порядка и
 * оба попытаться занять следующий номер. Проигравшего останавливает частичный
 * уникальный индекс (`23505`), и это правильное поведение БД: дублей номера не
 * появляется. Но пользователю отказ ни о чём не говорит — он не сделал ничего
 * неверного, — поэтому номер пересчитывается и попытка повторяется РОВНО один
 * раз. Второй конфликт означает не гонку, а что-то другое, и честно уходит
 * ошибкой.
 */
export async function addPaymentPlan(
  db: PaymentPlansDb,
  input: {
    orgId: string;
    specItemId: string;
    actor: SpecItemEventActor;
    data: PaymentPlanData;
  },
): Promise<AddPaymentPlanResult> {
  const item = await resolveSpecItem(db, input);
  if (!item.ok) return { ok: false, error: item.error };

  const validated = validatePaymentPlanData(input.data);
  if (!validated.ok) return { ok: false, error: validated.error };

  /** Вставка в конец графика: `position` пересчитывается перед каждой попыткой. */
  const insertAtTail = async () => {
    const position = await nextPosition(db, input);
    if (!position.ok) return { ok: false as const, error: position.error };

    const { data, error } = await db
      .from("spec_item_payment_plans")
      .insert({
        org_id: input.orgId,
        // Проект берётся из проверенной строки позиции, а не из аргумента:
        // второй источник истины здесь не нужен (на записи его всё равно
        // перезапишет триггер `payment_plan_sync_scope`).
        project_id: item.item.project_id,
        spec_item_id: item.item.id,
        title: validated.values.title,
        amount: validated.values.amount,
        condition: validated.values.condition,
        due_date: validated.values.dueDate,
        position: position.position,
        // Автор — из сессии.
        created_by: input.actor.id,
      })
      .select(PLAN_COLUMNS)
      .single();

    if (error || !data) {
      return {
        ok: false as const,
        error,
        message: error?.message ?? "нет строки",
      };
    }

    return { ok: true as const, row: data as PlanRow };
  };

  let attempt = await insertAtTail();

  // `23505` на этом индексе означает ровно одно: номер порядка занят параллельным
  // добавлением. Пересчитываем и пробуем ещё раз.
  if (!attempt.ok && attempt.error?.code === "23505") {
    attempt = await insertAtTail();
  }

  if (!attempt.ok) {
    console.error("[addPaymentPlan]", attempt.message);
    return failed("Не удалось добавить платёж");
  }

  const row = attempt.row;

  return {
    ok: true,
    plan: toEntry(row),
    events: buildPaymentPlanAddedEvents({
      orgId: input.orgId,
      specItemId: item.item.id,
      actor: input.actor,
      snapshot: toSnapshot(row),
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  update                                                             */
/* ------------------------------------------------------------------ */

/**
 * Сравнение значений поля для таблицы изменений.
 *
 * Пустая строка и `null` — одно и то же «не заполнено»: иначе снятие условия
 * оплаты давало бы ложное изменение `"" → null`. Числа сравниваются как числа
 * (`12000` и `"12000.00"` — одно значение).
 *
 * Экспортируется: тем же сравнением пользуется ядро фактических оплат
 * (`./payment-mutations`) — правило «пустое и `null` — одно состояние» должно
 * быть одно на весь этап.
 */
export function sameValue(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number") return value;
    return String(value);
  };

  const a = normalize(left);
  const b = normalize(right);

  if (a === null || b === null) return a === b;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  return a === b;
}

/** Изменения полей строки графика в устойчивом порядке. */
function diffPlan(
  row: PlanRow,
  values: PaymentPlanValues,
): PaymentPlanFieldChange[] {
  const changes: PaymentPlanFieldChange[] = [];

  if (!sameValue(row.title, values.title)) {
    changes.push({ field: "title", from: row.title, to: values.title });
  }
  if (!sameValue(toAmount(row.amount), values.amount)) {
    changes.push({
      field: "amount",
      from: toAmount(row.amount),
      to: values.amount,
    });
  }
  if (!sameValue(row.condition, values.condition)) {
    changes.push({
      field: "condition",
      from: row.condition || null,
      to: values.condition,
    });
  }
  if (!sameValue(row.due_date, values.dueDate)) {
    changes.push({
      field: "due_date",
      from: row.due_date,
      to: values.dueDate,
    });
  }

  return changes;
}

/**
 * Изменить строку графика.
 *
 * Строка ищется по `id + org_id + spec_item_id`: чужой идентификатор не даёт ни
 * правки, ни сведения о том, существует ли он. `from` для журнала берётся из
 * прочитанной строки, `to` — из применённой, поэтому событие описывает
 * записанное, а не присланное.
 */
export async function updatePaymentPlan(
  db: PaymentPlansDb,
  input: {
    orgId: string;
    specItemId: string;
    actor: SpecItemEventActor;
    planId: string;
    data: PaymentPlanData;
  },
): Promise<UpdatePaymentPlanResult> {
  const item = await resolveSpecItem(db, input);
  if (!item.ok) return { ok: false, error: item.error };

  const validated = validatePaymentPlanData(input.data);
  if (!validated.ok) return { ok: false, error: validated.error };

  const { data: current, error: readError } = await db
    .from("spec_item_payment_plans")
    .select(PLAN_COLUMNS)
    .eq("id", input.planId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .is("deleted_at", null)
    .maybeSingle<PlanRow>();

  if (readError) {
    console.error("[updatePaymentPlan] read", readError.message);
    return failed("Не удалось изменить платёж");
  }

  if (!current) return notFound();

  const { data, error } = await db
    .from("spec_item_payment_plans")
    .update({
      title: validated.values.title,
      amount: validated.values.amount,
      condition: validated.values.condition,
      due_date: validated.values.dueDate,
    })
    .eq("id", input.planId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .is("deleted_at", null)
    .select(PLAN_COLUMNS)
    .maybeSingle<PlanRow>();

  if (error) {
    console.error("[updatePaymentPlan]", error.message);
    return failed("Не удалось изменить платёж");
  }

  // Гонка: строку удалили параллельно. Для пользователя результат тот же —
  // плана нет, — но выдавать за успех запись, которой мы не видели, нельзя.
  if (!data) return notFound();

  const row = data as PlanRow;

  return {
    ok: true,
    plan: toEntry(row),
    events: buildPaymentPlanChangedEvents({
      orgId: input.orgId,
      specItemId: item.item.id,
      actor: input.actor,
      snapshot: toSnapshot(row),
      changes: diffPlan(current, validated.values),
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  remove                                                             */
/* ------------------------------------------------------------------ */

/**
 * Мягко удалить строку графика.
 *
 * Повторный вызов идемпотентен: строка уже удалена → `deleted: false` и никакого
 * события. Второе `payment_plan_removed` за то же действие было бы записью о
 * том, чего не происходило.
 *
 * ── Почему план с неудалёнными оплатами удалить нельзя (решение Q9) ────────
 *
 * Мягкое удаление не нарушает внешний ключ: строка остаётся в БД, а оплата
 * продолжает на неё ссылаться. Поэтому запрет — проверка, и живёт она ЗДЕСЬ, а
 * не только в action: обойти её вызовом ядра напрямую нельзя. Иначе строка
 * исчезла бы из графика и из суммы плана, а её оплаты остались бы в покрытии
 * несуществующей строки — то есть «оплачено по строке, которой нет».
 *
 * Отменённые (мягко удалённые) оплаты строку не держат: иначе после ошибки
 * график нельзя было бы почистить, не удалив сначала историю фактов.
 */
export async function removePaymentPlan(
  db: PaymentPlansDb,
  input: {
    orgId: string;
    specItemId: string;
    actor: SpecItemEventActor;
    planId: string;
  },
): Promise<RemovePaymentPlanResult> {
  const item = await resolveSpecItem(db, input);
  if (!item.ok) return { ok: false, error: item.error };

  // Читаются в том числе удалённые строки: по ним повторный вызов отличается от
  // «строки нет вовсе».
  const { data: current, error: readError } = await db
    .from("spec_item_payment_plans")
    .select(PLAN_COLUMNS)
    .eq("id", input.planId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .maybeSingle<PlanRow>();

  if (readError) {
    console.error("[removePaymentPlan] read", readError.message);
    return failed("Не удалось удалить платёж");
  }

  if (!current) return notFound();

  if (current.deleted_at !== null) {
    return { ok: true, plan: toEntry(current), deleted: false, events: [] };
  }

  // Строка с оплатами не удаляется: мягкое удаление FK не нарушает, поэтому
  // единственная защита от «оплаты по строке, которой нет» — эта проверка.
  const { count, error: countError } = await db
    .from("spec_item_payments")
    .select("id", { count: "exact", head: true })
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .eq("payment_plan_id", input.planId)
    .is("deleted_at", null);

  if (countError) {
    console.error("[removePaymentPlan] payments", countError.message);
    return failed("Не удалось удалить платёж");
  }

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: { code: "FAILED", message: planHasPaymentsMessage(count ?? 0) },
    };
  }

  const deletedAt = new Date().toISOString();

  const { data, error } = await db
    .from("spec_item_payment_plans")
    .update({ deleted_at: deletedAt })
    .eq("id", input.planId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .is("deleted_at", null)
    .select(PLAN_COLUMNS)
    .maybeSingle<PlanRow>();

  if (error) {
    console.error("[removePaymentPlan]", error.message);
    return failed("Не удалось удалить платёж");
  }

  // Гонка: строку удалил параллельный запрос. Результат для пользователя тот
  // же, но событие уже записано той операцией — второй раз его не пишем.
  if (!data) {
    return {
      ok: true,
      plan: toEntry({ ...current, deleted_at: deletedAt }),
      deleted: false,
      events: [],
    };
  }

  const row = data as PlanRow;

  return {
    ok: true,
    plan: toEntry(row),
    deleted: true,
    events: buildPaymentPlanRemovedEvents({
      orgId: input.orgId,
      specItemId: item.item.id,
      actor: input.actor,
      // Снимок снят ДО удаления: после мягкого удаления строка в списках уже не
      // читается, и брать подпись для ленты будет неоткуда.
      snapshot: toSnapshot(current),
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  move                                                               */
/* ------------------------------------------------------------------ */

/**
 * Разбор ответа функции БД: что изменилось в порядке строки.
 *
 * Возвращается описанием, а не готовым событием: актора знает только server
 * action (`ctx.user`), а ядро его не получает — иначе пришлось бы тащить сессию
 * в слой, который её намеренно не знает.
 */
export type PaymentPlanMoveOutcome = {
  plan: PaymentPlanEntry;
  /** `true` — порядок изменён; `false` — переставлять было некуда. */
  moved: boolean;
  /** Номера для таблицы изменений; `null` — перестановки не было. */
  position: { from: number | null; to: number | null } | null;
};

export type MovePaymentPlanPositionResult =
  | { ok: true; outcome: PaymentPlanMoveOutcome }
  | { ok: false; error: PaymentPlanError };

/**
 * Переставить строку графика на одну позицию вверх или вниз.
 *
 * ── Почему перестановка — RPC, а не серия UPDATE из приложения ─────────────
 *
 * Частичный уникальный индекс `(spec_item_id, position) where deleted_at is null`
 * проверяется ПОСТРОЧНО, а не в конце statement'а. Это выяснилось на живой БД
 * (интеграционный тест): обмен `(0, 1) → (1, 0)` не проходит ни одним UPDATE —
 * строка, которой первым назначают занятый номер, упирается в индекс, — ни
 * серией из двух-трёх: любой промежуточный шаг «увести обе строки в −1» падает
 * на второй строке по той же причине.
 *
 * Поэтому единственная транзакционная точка обмена живёт в БД:
 * `move_spec_item_payment_plan` (миграция 20261009_001, прецедент —
 * `set_spec_item_code`). Функция блокирует строки позиции, уводит две
 * участвующие строки в отрицательные номера поочерёдно и записывает обмен — всё
 * в одной транзакции, поэтому промежуточное состояние наружу не видно, а
 * неудачная перестановка не оставляет график в испорченном виде.
 *
 * Здесь остаётся только вызов и чтение применённой строки: снимок для журнала из
 * ответа функции не собрать — она возвращает номера, но не саму строку.
 */
export async function movePaymentPlanPosition(
  db: PaymentPlansDb,
  input: {
    orgId: string;
    specItemId: string;
    planId: string;
    direction: "up" | "down";
  },
): Promise<MovePaymentPlanPositionResult> {
  const item = await resolveSpecItem(db, input);
  if (!item.ok) return { ok: false, error: item.error };

  const { data, error } = await callRpc(db, "move_spec_item_payment_plan", {
    p_org: input.orgId,
    p_item: input.specItemId,
    p_plan: input.planId,
    p_dir: input.direction,
  });

  if (error) {
    console.error("[movePaymentPlanPosition]", error.message);
    return failed("Не удалось переставить платёж");
  }

  const outcome = data?.[0];
  if (!outcome || outcome.result === "not_found") return notFound();

  // Строку читаем и при «переставлять некуда»: ответ нужен в обоих случаях —
  // вкладка показывает строку как есть, а не как отказ.
  const { data: row, error: readError } = await db
    .from("spec_item_payment_plans")
    .select(PLAN_COLUMNS)
    .eq("id", input.planId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .maybeSingle<PlanRow>();

  if (readError) {
    console.error("[movePaymentPlanPosition] read", readError.message);
    return failed("Не удалось переставить платёж");
  }

  if (!row) return notFound();

  // Переставлять некуда — не ошибка, а отсутствие действия: UI на это не
  // показывает отказ, и события в журнале тоже нет.
  if (outcome.result === "unchanged") {
    return {
      ok: true,
      outcome: { plan: toEntry(row), moved: false, position: null },
    };
  }

  return {
    ok: true,
    outcome: {
      plan: toEntry(row),
      moved: true,
      position: {
        from: outcome.neighbour_position,
        to: outcome.target_position,
      },
    },
  };
}
