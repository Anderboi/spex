/**
 * Фактические оплаты позиции: ядро операций без сессии и без Next.
 *
 * ── Почему отдельный модуль ────────────────────────────────────────────────
 *
 * Ровно по той же причине, по которой существуют `./payment-plan-mutations`,
 * `./comment-write` и `./history-read`: сессия, `orgSlug` → `orgId`, проверка
 * прав организации и форма ответа для клиента живут в server action
 * (`actions/spec-item-payments.ts`), а проверки принадлежности, идемпотентность
 * и запись строк — здесь, куда клиент БД приходит аргументом (DI, как в
 * `recordSpecItemEvent`). Так контракт проверяется unit-тестами на подставном
 * клиенте, без Next и без живой БД.
 *
 * ── Границы доверия ───────────────────────────────────────────────────────
 *
 * От клиента приходят ровно пять значений: вид записи, сумма, дата, ссылка на
 * строку графика (необязательная) и комментарий — и ключ идемпотентности, который
 * не является данными платежа. Всё остальное определяет сервер: `orgId` (из
 * сессии), `specItemId` (из аргумента, проверенного по организации), `projectId`
 * (из строки позиции, а на записи — из триггера `payment_sync_scope`),
 * `created_by` (из сессии) и снимки кода, названия и автора (из БД, на записи —
 * триггером). Ни организация, ни проект, ни снимки не входят ни в один входной
 * тип — подсунуть их нечем.
 *
 * ── Идемпотентность ───────────────────────────────────────────────────────
 *
 * Ключ приходит от формы и генерируется на её открытие, поэтому двойное нажатие
 * и ретрай приходят с ТЕМ ЖЕ ключом:
 *
 *   * запись с таким ключом уже есть и её данные совпадают → возвращается
 *     найденная строка (`existing: true`), второго платежа не появляется и
 *     второго события в журнале тоже — писать его не о чем;
 *   * запись есть, но данные ДРУГИЕ → `IDEMPOTENCY_CONFLICT`: ответить найденной
 *     строкой значило бы соврать о том, что записалось, а создать вторую оплату
 *     с тем же ключом не даст частичный уникальный индекс;
 *   * записи нет → обычная вставка. Гонку двух одновременных вставок ловит
 *     уникальный индекс (`spec_item_payments_idempotency_uidx`), и после отказа
 *     строка перечитывается: победивший запрос уже записал её, и правильный ответ
 *     для проигравшего — та же самая запись, а не ошибка на ровном месте.
 *
 * ── Событие журнала возвращается, а не пишется здесь ───────────────────────
 *
 * Запись события — отдельный шаг того же действия (`recordSpecItemEvents`), и
 * делать его здесь значило бы смешать две ответственности в одной функции.
 * Поэтому каждая операция возвращает готовые события, а action пишет их одним
 * INSERT. Побочный эффект приятный: «что попало в журнал» проверяется
 * unit-тестом без подставного журнала.
 */

import type { SpecItemEventActor, SpecItemEventInput } from "./history";
import { isInProcurementScope, type SpecStatus } from "../constants";
import { SPEC_STATUS_CONFIG, statusAfterPayment } from "./status";
import {
  buildPaymentAddedEvents,
  buildPaymentChangedEvents,
  buildPaymentRemovedEvents,
} from "./payment-events";
import {
  resolveSpecItem,
  sameValue,
  type PaymentPlanError,
  type PaymentPlansDb,
} from "./payment-plan-mutations";
import { toAmount, type PaymentRecordKind } from "./payment-schedule";
import {
  isPaymentKind,
  PAYMENT_AMOUNT_MAX,
  type PaymentData,
  type PaymentEntry,
  type PaymentError,
  type PaymentEventSnapshot,
  type PaymentFieldChange,
  type PaymentValues,
} from "./payment-types";
import { todayIso } from "./payment-date";

/** Клиент БД: как у остальных слоёв, приходит аргументом. */
export type PaymentsDb = PaymentPlansDb;

/**
 * Колонки, нужные домену. Литерал обязателен: по нему supabase-js выводит тип
 * строки, и `select("*")` здесь был бы догадкой о схеме.
 *
 * Экспортируется: этим же списком читаются ОТМЕНЁННЫЕ записи
 * (`listCancelledPayments`). Своего списка колонок у них быть не должно — это
 * та же строка таблицы, и второе перечисление разошлось бы с первым молча:
 * клиент получил бы под тем же `PaymentEntry` другую запись.
 */
export const PAYMENT_ENTRY_COLUMNS =
  "id, org_id, project_id, spec_item_id, kind, amount, paid_at, payment_plan_id, comment, created_by, author_name_snapshot, code_snapshot, name_snapshot, project_title_snapshot, created_at, updated_at, deleted_at";

const PAYMENT_COLUMNS = PAYMENT_ENTRY_COLUMNS;

type PaymentRow = {
  id: string;
  org_id: string;
  project_id: string;
  spec_item_id: string;
  kind: string;
  amount: number | string;
  paid_at: string;
  payment_plan_id: string | null;
  comment: string | null;
  created_by: string | null;
  author_name_snapshot: string | null;
  code_snapshot: string | null;
  name_snapshot: string | null;
  project_title_snapshot: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/* ------------------------------------------------------------------ */
/*  Результаты операций                                                */
/* ------------------------------------------------------------------ */

export type ListPaymentsResult =
  | { ok: true; payments: PaymentEntry[] }
  | { ok: false; error: PaymentError };

type MutationSuccess = {
  ok: true;
  payment: PaymentEntry;
  /** Готовые события журнала: пишет их action, одним INSERT. */
  events: SpecItemEventInput[];
};

export type CreatePaymentResult =
  | (MutationSuccess & {
      /**
       * `true` — запись уже существовала с этим ключом идемпотентности, то есть
       * новое действие не совершалось. Событий в этом случае нет: писать в
       * журнал нечего.
       */
      existing: boolean;
    })
  | { ok: false; error: PaymentError };

export type UpdatePaymentResult =
  | MutationSuccess
  | { ok: false; error: PaymentError };

export type RemovePaymentResult =
  | { ok: true; payment: PaymentEntry; deleted: boolean; events: SpecItemEventInput[] }
  | { ok: false; error: PaymentError };

/* ------------------------------------------------------------------ */
/*  Преобразования                                                     */
/* ------------------------------------------------------------------ */

/** Вид записи из строки: незнакомое значение читается как оплата. */
function toKind(value: unknown) {
  return isPaymentKind(value) ? value : ("payment" as const);
}

function toEntry(row: PaymentRow): PaymentEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    specItemId: row.spec_item_id,
    kind: toKind(row.kind),
    amount: toAmount(row.amount),
    paidAt: row.paid_at,
    paymentPlanId: row.payment_plan_id,
    comment: row.comment,
    authorId: row.created_by,
    authorName: row.author_name_snapshot,
    codeSnapshot: row.code_snapshot,
    nameSnapshot: row.name_snapshot,
    projectTitleSnapshot: row.project_title_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Снимок записи для события журнала — из строки БД, не из клиентских данных. */
function toSnapshot(row: PaymentRow): PaymentEventSnapshot {
  return {
    paymentId: row.id,
    kind: toKind(row.kind),
    amount: toAmount(row.amount),
    paidAt: row.paid_at,
    paymentPlanId: row.payment_plan_id,
  };
}

function notFound(message = "Оплата не найдена"): {
  ok: false;
  error: PaymentError;
} {
  return { ok: false, error: { code: "NOT_FOUND", message } };
}

function invalidInput(message: string): { ok: false; error: PaymentError } {
  return { ok: false, error: { code: "INVALID_INPUT", message } };
}

function failed(message: string): { ok: false; error: PaymentError } {
  return { ok: false, error: { code: "FAILED", message } };
}

/**
 * Значение из строки — или `null`.
 *
 * Так приводятся оба необязательных строковых поля записи: дата (`""` из
 * `<input type="date">`) и ссылка на строку графика (пустой `<option>`).
 * `id` в имени нет намеренно: функция не проверяет, идентификатор ли это, — она
 * только превращает «не заполнено» в `null`, а форму значения проверяет схема
 * (`lib/validations.ts`) и БД.
 */
function emptyToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/* ------------------------------------------------------------------ */
/*  Проверка пользовательских данных                                   */
/* ------------------------------------------------------------------ */

/**
 * Правила записи о деньгах: вид из словаря, положительная сумма, непустой
 * комментарий, если он задан, и дата — «сегодня», если не задана.
 *
 * Те же границы продублированы CHECK-ограничениями таблицы. Дубль намеренный:
 * здесь отказ приходит понятным текстом и до запроса, а ограничение БД остаётся
 * последней линией для строки, попавшей в базу в обход кода.
 */
export function validatePaymentData(
  data: PaymentData,
  now: Date = new Date(),
): { ok: true; values: PaymentValues } | { ok: false; error: PaymentError } {
  if (!isPaymentKind(data.kind)) {
    return invalidInput("Выберите вид записи: оплата или возврат");
  }

  const amount =
    typeof data.amount === "number" ? data.amount : Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return invalidInput("Сумма должна быть больше нуля");
  }
  // Верхняя граница — вместимость `numeric(12,2)` (10^10 ₽, решение O7).
  // Без неё сумма «на границе» доходила бы до БД и падала ошибкой 22003 с общим
  // «не удалось записать»: пользователю нужен внятный отказ и до запроса.
  if (amount >= PAYMENT_AMOUNT_MAX) {
    return invalidInput("Слишком большая сумма");
  }

  const comment =
    typeof data.comment === "string" && data.comment.trim().length > 0
      ? data.comment.trim()
      : null;

  const paidAt = emptyToNull(data.paidAt) ?? todayIso(now);

  return {
    ok: true,
    values: {
      kind: data.kind,
      amount,
      paidAt,
      paymentPlanId: emptyToNull(data.paymentPlanId),
      comment,
    },
  };
}

/**
 * Строка графика, к которой разрешено привязать запись: она в ЭТОЙ позиции и не
 * удалена.
 *
 * Проверка нужна и потому, что составной внешний ключ закрывает только связь
 * «план другой позиции», но не «мягко удалённый план своей»: по схеме привязать
 * оплату к удалённой строке можно, а в интерфейсе такой строки нет — в покрытии
 * она не участвует. Ссылка на неё была бы оплатой в никуда.
 */
async function resolvePlan(
  db: PaymentsDb,
  args: { orgId: string; specItemId: string; planId: string },
): Promise<{ ok: true } | { ok: false; error: PaymentError }> {
  const { data, error } = await db
    .from("spec_item_payment_plans")
    .select("id")
    .eq("id", args.planId)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[payments] plan", error.message);
    return failed("Не удалось сохранить оплату");
  }

  if (!data) return notFound("Строка графика не найдена");

  return { ok: true };
}

/**
 * Совпадает ли уже записанная строка с тем, что пришло сейчас.
 *
 * Сравниваются ТОЛЬКО данные, входящие в запрос, и не сравниваются снимки: код,
 * название позиции и имя автора могли измениться между повтором и первым
 * запросом, и это не повод считать повтор другим намерением. Вид записи
 * сравнивается наравне с суммой: `kind` входит в тело запроса, поэтому «повтор с
 * другим видом» — именно конфликт ключа, а не та же оплата.
 */
function samePayment(row: PaymentRow, values: PaymentValues): boolean {
  return (
    toKind(row.kind) === values.kind &&
    toAmount(row.amount) === values.amount &&
    row.paid_at === values.paidAt &&
    (row.payment_plan_id ?? null) === values.paymentPlanId &&
    sameValue(row.comment, values.comment)
  );
}

/** Разбор конкурентной вставки: строка с тем же ключом уже записана. */
async function resolveIdempotentRace(
  db: PaymentsDb,
  args: { orgId: string; idempotencyKey: string; values: PaymentValues },
): Promise<CreatePaymentResult> {
  const { data, error } = await db
    .from("spec_item_payments")
    .select(PAYMENT_COLUMNS)
    .eq("org_id", args.orgId)
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle<PaymentRow>();

  if (error || !data) {
    // Строку не видно — значит гонка не на этом ключе (или чтение запрещено).
    // Догадку о причине не выдаём: пользователю честнее «не удалось».
    console.error("[createPayment] race", error?.message ?? "нет строки");
    return failed("Не удалось записать оплату");
  }

  if (!samePayment(data, args.values)) {
    return {
      ok: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message:
          "Оплата с этим ключом уже записана с другими данными: обновите форму",
      },
    };
  }

  return { ok: true, payment: toEntry(data), events: [], existing: true };
}

/* ------------------------------------------------------------------ */
/*  list                                                               */
/* ------------------------------------------------------------------ */

/**
 * Активные записи позиции: сначала поздние по дате оплаты, затем по времени
 * записи.
 *
 * Порядок задаёт сервер, и клиент его не пересортировывает — иначе в интерфейсе и
 * в ответе было бы два разных порядка одной выборки. Дата первична: список фактов
 * читают сверху вниз как хронологию денег, а не как журнал ввода.
 */
export async function listPayments(
  db: PaymentsDb,
  args: { orgId: string; specItemId: string },
): Promise<ListPaymentsResult> {
  const item = await resolveSpecItem(db, args);
  if (!item.ok) return { ok: false, error: item.error };

  const { data, error } = await db
    .from("spec_item_payments")
    .select(PAYMENT_COLUMNS)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .is("deleted_at", null)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listPayments]", error.message);
    return failed("Не удалось получить список оплат");
  }

  return { ok: true, payments: (data ?? []).map((row) => toEntry(row as PaymentRow)) };
}

/* ------------------------------------------------------------------ */
/*  listCancelled                                                      */
/* ------------------------------------------------------------------ */

/**
 * Отменённые (мягко удалённые) оплаты, привязанные к строкам графика.
 *
 * ── Зачем это читается ─────────────────────────────────────────────────────
 *
 * Отмена оплаты возвращает её строку графика в «Не оплачено» (решение Q29:
 * обязательство снова открыто), но правило «связь с отменённой оплатой
 * показывается пометкой, а не исчезает молча» продолжает действовать. Живой
 * список отменённых не показывает, поэтому пометку взять неоткуда — её даёт это
 * чтение.
 *
 * ── Почему только записи с планом ──────────────────────────────────────────
 *
 * Строку в списке составляет строка графика, а пометка стоит У строки.
 * Отменённая оплата без плана не прикреплена ни к чему: показать её значило бы
 * показать пометку без обязательства, к которому она относится. Список фактов
 * её тоже не показывает — она отменена.
 *
 * ── Почему отдельная функция, а не флаг у `listPayments` ───────────────────
 *
 * Флаг превратил бы основной список в «список плюс, может быть, удалённые», и
 * каждый вызывающий обязан был бы помнить, что удалённые строки нужно
 * отфильтровать самому. Здесь два разных чтения с разными ответами на разные
 * вопросы: «что заплачено» и «что отменено».
 *
 * Порядок тот же, что у живых записей (`paid_at desc`, затем `created_at desc`):
 * пометка называет ПОЗДНЮЮ отмену, а порядок задаёт сервер — клиент список не
 * пересортировывает.
 */
export async function listCancelledPayments(
  db: PaymentsDb,
  args: { orgId: string; specItemId: string },
): Promise<ListPaymentsResult> {
  const item = await resolveSpecItem(db, args);
  if (!item.ok) return { ok: false, error: item.error };

  const { data, error } = await db
    .from("spec_item_payments")
    .select(PAYMENT_COLUMNS)
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .not("deleted_at", "is", null)
    .not("payment_plan_id", "is", null)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listCancelledPayments]", error.message);
    return failed("Не удалось получить отменённые оплаты");
  }

  return { ok: true, payments: (data ?? []).map((row) => toEntry(row as PaymentRow)) };
}

/* ------------------------------------------------------------------ */
/*  create                                                             */
/* ------------------------------------------------------------------ */

/** Подпись статуса для текста отказа: словарь статусов один на весь интерфейс. */
function statusLabel(status: SpecStatus): string {
  return SPEC_STATUS_CONFIG[status]?.label ?? "неизвестный статус";
}

/**
 * Оплата заказывает позицию: согласованная после денег становится заказанной
 * (правило `statusAfterPayment`, ADR 0007).
 *
 * ── Почему ошибка НЕ отменяет оплату ───────────────────────────────────────
 *
 * Деньги уже записаны. Ответить на сбой этого шага отказом значило бы подтолкнуть
 * пользователя внести оплату заново — то есть вторым платежом. Статус здесь
 * следствие, а не сама операция: его отсутствие видно в списке и поправимо
 * переводом позиции вручную, а каждый следующий платёж по этой же позиции
 * (включая повтор запроса с тем же ключом) пробует записать статус снова.
 *
 * ── Почему обновление условное ─────────────────────────────────────────────
 *
 * `.eq("status", from)` — не перепроверка ради красоты: между чтением позиции и
 * этой записью статус мог уйти дальше («Доставлено»), и вслепую возвращать его в
 * «Заказано» нельзя. Условие стоит в том же UPDATE, поэтому окна между проверкой
 * и записью нет.
 */
async function orderItemAfterPayment(
  db: PaymentsDb,
  args: {
    orgId: string;
    specItemId: string;
    kind: PaymentRecordKind;
    status: SpecStatus;
  },
): Promise<void> {
  // Возврат позицию не заказывает: он исправляет деньги, а не обязательство.
  if (args.kind !== "payment") return;

  const next = statusAfterPayment(args.status);
  // Обычный случай повтора: статус уже приведён первым запросом — ни UPDATE, ни
  // второго «изменения» не появляется.
  if (next === args.status) return;

  const { error } = await db
    .from("spec_items")
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq("id", args.specItemId)
    .eq("org_id", args.orgId)
    .eq("status", args.status)
    .is("deleted_at", null);

  if (error) console.error("[createPayment] order", error.message);
}

/**
 * Успешный исход записи: перед ответом статус позиции приводится в порядок.
 *
 * Отдельная функция, а не вызов `orderItemAfterPayment` в каждой ветви: успешных
 * путей у `createPayment` три (запись, повтор с тем же ключом, гонка вставок), и
 * «привести статус» обязано быть ровно одно место. Забытая ветвь здесь не видна
 * глазом: оплата записана, ответ успешен, а позиция осталась согласованной.
 */
async function settle(
  db: PaymentsDb,
  args: {
    orgId: string;
    specItemId: string;
    /** Статус позиции из прочитанной строки — до записи денег. */
    status: SpecStatus;
    kind: PaymentRecordKind;
    payment: PaymentEntry;
    existing: boolean;
    events: SpecItemEventInput[];
  },
): Promise<CreatePaymentResult> {
  await orderItemAfterPayment(db, {
    orgId: args.orgId,
    specItemId: args.specItemId,
    kind: args.kind,
    // Статус — из того же чтения позиции, что прошли ворота: второй запрос «а
    // какой сейчас статус» не нужен, а окно между чтениями уже закрыто условием
    // в самом UPDATE.
    status: args.status,
  });

  return {
    ok: true,
    payment: args.payment,
    existing: args.existing,
    events: args.events,
  };
}

/**
 * Внести оплату или возврат.
 *
 * Порядок проверок: позиция → данные → строка графика → ключ идемпотентности →
 * запись. Ключ проверяется ПОСЛЕ данных, но ДО вставки: при повторе запроса
 * нового платежа не появляется, а при другом теле запроса приходит явный отказ,
 * о котором пользователь должен узнать.
 */
export async function createPayment(
  db: PaymentsDb,
  input: {
    orgId: string;
    specItemId: string;
    actor: SpecItemEventActor;
    /** Ключ идемпотентности: генерируется формой на открытие. */
    idempotencyKey: string;
    data: PaymentData;
    now?: Date;
  },
): Promise<CreatePaymentResult> {
  const item = await resolveSpecItem(db, input);
  if (!item.ok) return { ok: false, error: item.error };

  const validated = validatePaymentData(input.data, input.now);
  if (!validated.ok) return { ok: false, error: validated.error };

  /*
    ── Ворота оплаты ─────────────────────────────────────────────────────────
    Платить можно по позиции, которая уже в закупке, то есть не раньше
    «Согласовано» (ADR 0007). Правило — то же `isInProcurementScope`, из которого
    конструктор считает «Сумму в закупке»: иначе «оплачено по закупке» оказалось
    бы деньгами по позиции, которой в закупке нет.

    Возврат ворота не знает. Он исправляет УЖЕ записанные деньги, в том числе по
    позиции, которую в закупку не переводили (такие есть — строка «мимо области
    воронки» в модалке закупки). Запретить возврат значило бы запереть ошибочную
    оплату навсегда, а «отменить и внести верную» здесь и есть штатный путь
    исправления.

    Правка и отмена записи тоже не гейтятся: это не новые деньги.
  */
  if (
    validated.values.kind === "payment" &&
    !isInProcurementScope({
      isPlaceholder: item.item.is_placeholder === true,
      status: item.item.status,
    })
  ) {
    return {
      ok: false,
      error: {
        code: "NOT_ALLOWED",
        message: `Оплата доступна по согласованным позициям: сначала переведите позицию в «Согласовано» (сейчас «${statusLabel(item.item.status)}»)`,
      },
    };
  }

  if (validated.values.paymentPlanId) {
    const plan = await resolvePlan(db, {
      orgId: input.orgId,
      specItemId: item.item.id,
      planId: validated.values.paymentPlanId,
    });
    if (!plan.ok) return { ok: false, error: plan.error };
  }

  // Повтор запроса с тем же ключом: ищем ДО вставки, чтобы не полагаться на
  // текст ошибки БД в обычном случае (двойное нажатие — не гонка).
  const { data: existing, error: readError } = await db
    .from("spec_item_payments")
    .select(PAYMENT_COLUMNS)
    .eq("org_id", input.orgId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle<PaymentRow>();

  if (readError) {
    console.error("[createPayment] idempotency", readError.message);
    return failed("Не удалось записать оплату");
  }

  if (existing) {
    if (!samePayment(existing, validated.values)) {
      return {
        ok: false,
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message:
            "Оплата с этим ключом уже записана с другими данными: обновите форму",
        },
      };
    }

    return settle(db, {
      orgId: input.orgId,
      specItemId: item.item.id,
      status: item.item.status,
      kind: validated.values.kind,
      payment: toEntry(existing),
      existing: true,
      events: [],
    });
  }

  const { data, error } = await db
    .from("spec_item_payments")
    .insert({
      org_id: input.orgId,
      // Проект берётся из проверенной строки позиции, а не из аргумента:
      // второй источник истины здесь не нужен (на записи его всё равно
      // перезапишет триггер `payment_sync_scope`).
      project_id: item.item.project_id,
      spec_item_id: item.item.id,
      payment_plan_id: validated.values.paymentPlanId,
      kind: validated.values.kind,
      amount: validated.values.amount,
      paid_at: validated.values.paidAt,
      comment: validated.values.comment,
      // Автор — из сессии. Снимок имени и кода подставит триггер.
      created_by: input.actor.id,
      idempotency_key: input.idempotencyKey,
    })
    .select(PAYMENT_COLUMNS)
    .single<PaymentRow>();

  if (error || !data) {
    // `23505` на индексе идемпотентности означает ровно одно: параллельный
    // запрос с тем же ключом успел первым. Ответ на это — не «ошибка», а та же
    // самая запись: пользователь нажал один раз.
    if (error?.code === "23505") {
      const raced = await resolveIdempotentRace(db, {
        orgId: input.orgId,
        idempotencyKey: input.idempotencyKey,
        values: validated.values,
      });
      if (!raced.ok) return raced;

      return settle(db, {
        orgId: input.orgId,
        specItemId: item.item.id,
        status: item.item.status,
        kind: validated.values.kind,
        payment: raced.payment,
        existing: true,
        events: [],
      });
    }

    console.error("[createPayment]", error?.message ?? "нет строки");
    return failed("Не удалось записать оплату");
  }

  const row = data as PaymentRow;

  return settle(db, {
    orgId: input.orgId,
    specItemId: item.item.id,
    status: item.item.status,
    kind: validated.values.kind,
    payment: toEntry(row),
    existing: false,
    events: buildPaymentAddedEvents({
      orgId: input.orgId,
      specItemId: item.item.id,
      actor: input.actor,
      snapshot: toSnapshot(row),
    }),
  });
}

/* ------------------------------------------------------------------ */
/*  update                                                             */
/* ------------------------------------------------------------------ */

/**
 * Изменения полей записи в устойчивом порядке.
 *
 * Вид записи здесь не сравнивается: его смена — другая проводка, и до этого
 * места она не доходит (`updatePayment` отказывает раньше).
 */
function diffPayment(
  row: PaymentRow,
  values: PaymentValues,
): PaymentFieldChange[] {
  const changes: PaymentFieldChange[] = [];

  if (!sameValue(toAmount(row.amount), values.amount)) {
    changes.push({
      field: "amount",
      from: toAmount(row.amount),
      to: values.amount,
    });
  }
  if (!sameValue(row.paid_at, values.paidAt)) {
    changes.push({ field: "paid_at", from: row.paid_at, to: values.paidAt });
  }
  if (!sameValue(row.payment_plan_id ?? null, values.paymentPlanId)) {
    changes.push({
      field: "payment_plan_id",
      from: row.payment_plan_id ?? null,
      to: values.paymentPlanId,
    });
  }
  if (!sameValue(row.comment, values.comment)) {
    changes.push({
      field: "comment",
      from: row.comment || null,
      to: values.comment,
    });
  }

  return changes;
}

/**
 * Изменить запись.
 *
 * Запись ищется по `id + org_id + spec_item_id`: чужой идентификатор не даёт ни
 * правки, ни сведения о том, существует ли он. `from` для журнала берётся из
 * прочитанной строки, `to` — из применённой, поэтому событие описывает
 * записанное, а не присланное.
 *
 * Смена вида записи запрещена: «оплата» и «возврат» — разные документы, и
 * правка одного в другой оставила бы в журнале «изменена оплата», под которой
 * лежит возврат. Правильное действие — отменить ошибочную запись и внести верную.
 */
export async function updatePayment(
  db: PaymentsDb,
  input: {
    orgId: string;
    specItemId: string;
    actor: SpecItemEventActor;
    paymentId: string;
    data: PaymentData;
    now?: Date;
  },
): Promise<UpdatePaymentResult> {
  const item = await resolveSpecItem(db, input);
  if (!item.ok) return { ok: false, error: item.error };

  const { data: current, error: readError } = await db
    .from("spec_item_payments")
    .select(PAYMENT_COLUMNS)
    .eq("id", input.paymentId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .is("deleted_at", null)
    .maybeSingle<PaymentRow>();

  if (readError) {
    console.error("[updatePayment] read", readError.message);
    return failed("Не удалось изменить оплату");
  }

  if (!current) return notFound();

  if (isPaymentKind(input.data.kind) && input.data.kind !== toKind(current.kind)) {
    return invalidInput(
      "Вид записи изменить нельзя: отмените её и внесите верную",
    );
  }

  const validated = validatePaymentData(input.data, input.now);
  if (!validated.ok) return { ok: false, error: validated.error };

  if (validated.values.paymentPlanId) {
    const plan = await resolvePlan(db, {
      orgId: input.orgId,
      specItemId: item.item.id,
      planId: validated.values.paymentPlanId,
    });
    if (!plan.ok) return { ok: false, error: plan.error };
  }

  const { data, error } = await db
    .from("spec_item_payments")
    .update({
      amount: validated.values.amount,
      paid_at: validated.values.paidAt,
      payment_plan_id: validated.values.paymentPlanId,
      comment: validated.values.comment,
    })
    .eq("id", input.paymentId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .is("deleted_at", null)
    .select(PAYMENT_COLUMNS)
    .maybeSingle<PaymentRow>();

  if (error) {
    console.error("[updatePayment]", error.message);
    return failed("Не удалось изменить оплату");
  }

  // Гонка: запись отменили параллельно. Для пользователя результат тот же —
  // записи нет, — но выдавать за успех строку, которой мы не видели, нельзя.
  if (!data) return notFound();

  const row = data as PaymentRow;

  return {
    ok: true,
    payment: toEntry(row),
    events: buildPaymentChangedEvents({
      orgId: input.orgId,
      specItemId: item.item.id,
      actor: input.actor,
      snapshot: toSnapshot(row),
      changes: diffPayment(current, validated.values),
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  remove                                                             */
/* ------------------------------------------------------------------ */

/**
 * Отменить запись (мягко удалить).
 *
 * Повторный вызов идемпотентен: запись уже отменена → `deleted: false` и никакого
 * события. Второе `payment_removed` за то же действие было бы записью о том,
 * чего не происходило.
 *
 * Физического удаления здесь нет намеренно: финансовая история не удаляется
 * (ADR 0004). `deleted_at` исключает запись из сумм, покрытия и списка, но
 * оставляет её в журнале и в БД — ошибочная проводка обязана быть видна.
 */
export async function removePayment(
  db: PaymentsDb,
  input: {
    orgId: string;
    specItemId: string;
    actor: SpecItemEventActor;
    paymentId: string;
  },
): Promise<RemovePaymentResult> {
  const item = await resolveSpecItem(db, input);
  if (!item.ok) return { ok: false, error: item.error };

  // Читаются в том числе отменённые строки: по ним повторный вызов отличается от
  // «записи нет вовсе».
  const { data: current, error: readError } = await db
    .from("spec_item_payments")
    .select(PAYMENT_COLUMNS)
    .eq("id", input.paymentId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .maybeSingle<PaymentRow>();

  if (readError) {
    console.error("[removePayment] read", readError.message);
    return failed("Не удалось отменить оплату");
  }

  if (!current) return notFound();

  if (current.deleted_at !== null) {
    return { ok: true, payment: toEntry(current), deleted: false, events: [] };
  }

  const deletedAt = new Date().toISOString();

  const { data, error } = await db
    .from("spec_item_payments")
    .update({ deleted_at: deletedAt })
    .eq("id", input.paymentId)
    .eq("org_id", input.orgId)
    .eq("spec_item_id", input.specItemId)
    .is("deleted_at", null)
    .select(PAYMENT_COLUMNS)
    .maybeSingle<PaymentRow>();

  if (error) {
    console.error("[removePayment]", error.message);
    return failed("Не удалось отменить оплату");
  }

  // Гонка: запись отменил параллельный запрос. Результат для пользователя тот
  // же, но событие уже записано той операцией — второй раз его не пишем.
  if (!data) {
    return {
      ok: true,
      payment: toEntry({ ...current, deleted_at: deletedAt }),
      deleted: false,
      events: [],
    };
  }

  const row = data as PaymentRow;

  return {
    ok: true,
    payment: toEntry(row),
    deleted: true,
    events: buildPaymentRemovedEvents({
      orgId: input.orgId,
      specItemId: item.item.id,
      actor: input.actor,
      // Снимок снят ДО отмены: после мягкого удаления строка в списках уже не
      // читается, и брать подпись для ленты будет неоткуда.
      snapshot: toSnapshot(current),
    }),
  };
}

/**
 * Есть ли по строке графика неудалённые записи — для действия, которое её
 * удаляет.
 *
 * Экспортируется, чтобы `deletePaymentPlan` мог отказать ДО записи события: ядро
 * графика проверяет то же самое, но его отказ пришёл бы уже после того, как
 * action собрал событие об удалении.
 *
 * Отказ здесь возвращается в словаре ПЛАНА (`PaymentPlanError`), а не оплат: этот
 * запрос существует только ради удаления строки графика, и второй словарь кодов
 * у одного вызова порождал бы перевод кода в код на ровном месте.
 */
export async function hasActivePayments(
  db: PaymentsDb,
  args: { orgId: string; specItemId: string; planId: string },
): Promise<
  { ok: true; count: number } | { ok: false; error: PaymentPlanError }
> {
  const { count, error } = await db
    .from("spec_item_payments")
    .select("id", { count: "exact", head: true })
    .eq("org_id", args.orgId)
    .eq("spec_item_id", args.specItemId)
    .eq("payment_plan_id", args.planId)
    .is("deleted_at", null);

  if (error) {
    console.error("[hasActivePayments]", error.message);
    return {
      ok: false,
      error: {
        code: "FAILED",
        message: "Не удалось проверить оплаты по строке графика",
      },
    };
  }

  return { ok: true, count: count ?? 0 };
}
