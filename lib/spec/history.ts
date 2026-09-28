/**
 * История и обсуждение позиции спецификации (`spec_items`).
 *
 * Здесь живёт единственный в приложении источник правды о типах событий:
 * `SPEC_ITEM_EVENT_KINDS` повторяет CHECK-ограничение
 * `spec_item_events_kind_check` из миграции
 * `supabase/migrations/20260918_001_add_spec_item_events_and_comments.sql`
 * (позже его расширяли `20260919_001_add_parent_changed_event_kind.sql`,
 * `20260920_001_add_variant_updated_event_kind.sql` и
 * `20260921_001_add_variant_removed_event_kind.sql`).
 * Список обязан совпадать с БД, поэтому рассинхрон ловит тест
 * `lib/spec/history.test.ts`, а не пользователь.
 *
 * Типы — доменные (camelCase), как `SpecItem` и `SpecVariant` в `lib/types.ts`.
 * Преобразование строк БД в них — задача мапперов следующего этапа.
 *
 * `payload` намеренно не размечен по вариантам: состав данных у каждого
 * события свой, а типизация «по одному типу на kind» усложнила бы добавление
 * новых событий — ровно то, что должно оставаться дешёвым.
 *
 * ── Запись событий ─────────────────────────────────────────────────────────
 *
 * `recordSpecItemEvent` / `recordSpecItemEvents` пишут УЖЕ СФОРМИРОВАННОЕ
 * событие. Они не читают прежнее состояние, не считают `from → to` и не
 * ходят за профилем пользователя — это ответственность вызывающего action.
 *
 * Клиент БД передаётся аргументом, как в `callRpc(supabase, …)`
 * (`lib/supabase/rpc.ts`): у server action он уже есть (`c.supabase`), а
 * модуль остаётся свободным от runtime-зависимостей — `@supabase/supabase-js`
 * и `lib/supabase/admin.ts` здесь только типы. Это важно, потому что отсюда же
 * берут `SPEC_ITEM_EVENT_KINDS` для подписей в интерфейсе.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceOperationType, SpecStatus } from "../constants";
import { SPEC_STATUS_CONFIG } from "./status";
import type { Database, TablesInsert } from "../types";

/** Типы системных событий первой версии. Порядок совпадает с CHECK в миграции. */
export const SPEC_ITEM_EVENT_KINDS = [
  "created",
  "filled",
  "cleared",
  "removed",
  "restored",
  "code_changed",
  "status_changed",
  "price_changed",
  "quantity_changed",
  "supplier_changed",
  "details_changed",
  "parent_changed",
  "variant_added",
  "variant_switched",
  "variant_updated",
  "variant_removed",
  "component_added",
  "component_removed",
  "service_added",
  "service_completed",
  "service_removed",
] as const;

export type SpecItemEventKind = (typeof SPEC_ITEM_EVENT_KINDS)[number];

/** Системное событие позиции. Append-only: не редактируется и не удаляется. */
export type SpecItemEvent = {
  id: string;
  orgId: string;
  specItemId: string;
  kind: SpecItemEventKind;
  /** Автор действия. null — автор неизвестен (например, системная операция). */
  actorId: string | null;
  /**
   * Имя автора на момент события. Хранится снимком: пользователя могут
   * переименовать, а членство — удалить.
   */
  actorNameSnapshot: string | null;
  /** Данные события («что изменилось»). Состав зависит от `kind`. */
  payload: Record<string, unknown>;
  createdAt: string;
};

/** Комментарий к позиции. Ответы — через `parentId`, ветка — через `rootId`. */
export type SpecItemComment = {
  id: string;
  orgId: string;
  specItemId: string;
  /** Комментарий, на который отвечают. null — корень ветки. */
  parentId: string | null;
  /** Корень ветки: нужен, чтобы собрать обсуждение одним запросом. */
  rootId: string | null;
  /** Автор. null — пользователь удалён (FK ON DELETE SET NULL). */
  authorId: string | null;
  authorNameSnapshot: string | null;
  body: string;
  createdAt: string;
  /** Момент последней правки. null — не редактировался. */
  editedAt: string | null;
  /** Мягкое удаление: строка остаётся, чтобы не рвать ветку ответов. */
  deletedAt: string | null;
};

/* ------------------------------------------------------------------ */
/*  Запись событий                                                     */
/* ------------------------------------------------------------------ */

/** Клиент БД, которым пишутся события: серверный (service role). */
type SpecItemEventsDb = SupabaseClient<Database>;

/**
 * Автор события. Приходит из сессии (`requireOrgBySlug` → `ctx.userId`,
 * `ctx.user`), поэтому helper не ходит за профилем в БД.
 *
 * `email` необязателен, но нужен для того же fallback, что в списке команды:
 * у пользователя без имени подписью становится почта, а не безымянный
 * «Пользователь».
 */
export type SpecItemEventActor = {
  id: string;
  name: string | null;
  email?: string | null;
};

/** Уже сформированное событие. Helper ничего в нём не досчитывает. */
export type SpecItemEventInput = {
  orgId: string;
  specItemId: string;
  actor: SpecItemEventActor;
  kind: SpecItemEventKind;
  /** Данные события. Пустой payload — норма: запишется `{}`. */
  payload?: Record<string, unknown>;
};

/**
 * Подпись автора на момент события. Порядок взят у списка команды
 * (`components/team/member-row.tsx`): имя → почта → «Пользователь».
 */
function actorNameSnapshot(actor: SpecItemEventActor): string {
  return actor.name || actor.email || "Пользователь";
}

/**
 * Проверка типа события на рантайме. TypeScript не пропустит чужой `kind`, но
 * helper — единственная воронка записи, и падать она должна понятным текстом,
 * а не ошибкой CHECK-ограничения из Postgres.
 */
function assertKind(kind: SpecItemEventKind): void {
  if (!(SPEC_ITEM_EVENT_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Неизвестный тип события истории: ${String(kind)}`);
  }
}

function toEventRow(
  event: SpecItemEventInput,
): TablesInsert<"spec_item_events"> {
  return {
    org_id: event.orgId,
    spec_item_id: event.specItemId,
    kind: event.kind,
    actor_id: event.actor.id,
    actor_name_snapshot: actorNameSnapshot(event.actor),
    // Доменный payload шире колонки jsonb: `Record<string, unknown>` не
    // сужается до `Json` (по `Json` не собрать Object.entries). Это
    // единственное место, где доменный тип встречается с колонкой.
    payload: (event.payload ?? {}) as TablesInsert<"spec_item_events">["payload"],
  };
}

/**
 * Ошибку записи события не проглатываем: молча потерянное событие — дыра в
 * истории, которую потом не восстановить. Решение «валить ли операцию целиком»
 * принимает вызывающий action, поэтому здесь исключение, а не `console.error`.
 */
function writeError(error: { message: string }): Error {
  return new Error(`Не удалось записать событие истории: ${error.message}`, {
    cause: error,
  });
}

/** Записать одно событие. Бросает, если INSERT не удался. */
export async function recordSpecItemEvent(
  db: SpecItemEventsDb,
  event: SpecItemEventInput,
): Promise<void> {
  assertKind(event.kind);

  const { error } = await db
    .from("spec_item_events")
    .insert(toEventRow(event));

  if (error) throw writeError(error);
}

/**
 * Записать несколько событий ОДНИМ INSERT (не N запросов): типичный случай —
 * действие, затронувшее несколько позиций сразу.
 *
 * Пустой список — не «вставка нуля строк»: PostgREST отвечает на `insert([])`
 * ошибкой, а не пустым результатом, поэтому выходим заранее.
 */
export async function recordSpecItemEvents(
  db: SpecItemEventsDb,
  events: readonly SpecItemEventInput[],
): Promise<void> {
  if (events.length === 0) return;

  for (const event of events) assertKind(event.kind);

  const { error } = await db
    .from("spec_item_events")
    .insert(events.map(toEventRow));

  if (error) throw writeError(error);
}

/* ------------------------------------------------------------------ */
/*  Payload'ы жизненного цикла                                         */
/* ------------------------------------------------------------------ */

/** Откуда взялась позиция — значение `payload.origin` события `created`. */
export type SpecItemCreateOrigin =
  | "placeholder"
  | "library"
  | "manual"
  | "duplicate"
  | "library_page";

/** Минимум полей позиции, нужный событиям жизненного цикла. */
export type SpecItemLifecycleRow = {
  id: string;
  code: string | null;
  name: string;
  /** Раздел спецификации. Нужен только `created`. */
  type?: string | null;
};

/**
 * Автор события из контекста сессии (`requireOrgBySlug` → `ctx`). Отдельная
 * функция, чтобы пять действий не собирали один и тот же объект по-своему и
 * не забыли почту для снимка имени.
 */
export function eventActorOf(ctx: {
  userId: string;
  user: { name?: string | null; email?: string | null };
}): SpecItemEventActor {
  return {
    id: ctx.userId,
    name: ctx.user.name ?? null,
    email: ctx.user.email ?? null,
  };
}

/**
 * Флаги групповой операции. Одиночное действие их не получает: иначе UI
 * пришлось бы отличать «групповую операцию из одной позиции» от обычной.
 */
function batchFields(size: number): { batch?: true; batch_size?: number } {
  return size > 1 ? { batch: true, batch_size: size } : {};
}

/**
 * Пустая строка — это «не заполнено», и в payload она уходит как `null`.
 *
 * Иначе у одного и того же состояния в ленте оказывается два представления
 * (`""` и `null`), и читающему коду приходится знать про оба. Правило общее для
 * событий, которые показывают название и марку позиции: `created`, `filled`,
 * `cleared`.
 */
function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

/**
 * Событие на каждую позицию операции — по одному, без общего события на весь
 * batch: лента персональная, и в истории каждой позиции должно быть ровно её
 * собственное «создана» / «удалена» / «восстановлена».
 *
 * Идентификаторы дедуплицируются: повторный id в списке — это ошибка
 * вызывающего кода, но дубликат события в ленте хуже, чем потеря одной
 * записи, поэтому защищаемся здесь, а не надеемся на вызывающего.
 */
function lifecycleEvents(
  kind: SpecItemEventKind,
  args: {
    orgId: string;
    actor: SpecItemEventActor;
    items: readonly SpecItemLifecycleRow[];
  },
  build: (row: SpecItemLifecycleRow, size: number) => Record<string, unknown>,
): SpecItemEventInput[] {
  const unique = new Map(args.items.map((item) => [item.id, item]));
  const size = unique.size;

  return [...unique.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.id,
    actor: args.actor,
    kind,
    payload: build(item, size),
  }));
}

/**
 * `created` для партии только что вставленных позиций. Пустые марка, название
 * и раздел записываются как `null` (см. `emptyToNull`).
 */
export function buildCreatedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  origin: SpecItemCreateOrigin;
  items: readonly SpecItemLifecycleRow[];
}): SpecItemEventInput[] {
  return lifecycleEvents("created", args, (row, size) => ({
    code: emptyToNull(row.code),
    name: emptyToNull(row.name),
    type: emptyToNull(row.type),
    origin: args.origin,
    ...batchFields(size),
  }));
}

/** `removed` для партии мягко удаляемых позиций. */
export function buildRemovedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly SpecItemLifecycleRow[];
}): SpecItemEventInput[] {
  return lifecycleEvents("removed", args, (row, size) => ({
    code: row.code ?? "",
    name: row.name,
    ...batchFields(size),
  }));
}

/** `restored` для партии восстанавливаемых позиций. */
export function buildRestoredEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly SpecItemLifecycleRow[];
}): SpecItemEventInput[] {
  return lifecycleEvents("restored", args, (row, size) => ({
    code: row.code ?? "",
    name: row.name,
    ...batchFields(size),
  }));
}

/**
 * Откуда пришло заполнение — значение `payload.origin` события `filled`.
 *
 * `undo` — содержимое вернулось отменой очистки: жест действительно заполняет
 * опустевшую позицию, но пришло это не из библиотеки и не из формы.
 */
export type SpecItemFillOrigin = "placeholder" | "manual" | "undo";

/**
 * `filled` — заглушка заполнена одним составным действием.
 *
 * Payload намеренно короткий: `origin` (из библиотеки или вручную — от него
 * зависит формулировка), `code` и `name` результата, чтобы назвать позицию без
 * повторного чтения. Прежнее состояние не нужно: заглушка по определению пуста,
 * а всё, что заполнение поменяло помимо этого, — один жест, а не набор полевых
 * событий. `type` заполнение не меняет, `material_id` есть только у одного из
 * двух путей, поэтому в payload их нет.
 */
export function buildFilledEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  origin: SpecItemFillOrigin;
  items: readonly SpecItemLifecycleRow[];
}): SpecItemEventInput[] {
  return lifecycleEvents("filled", args, (row, size) => ({
    code: emptyToNull(row.code),
    name: emptyToNull(row.name),
    origin: args.origin,
    ...batchFields(size),
  }));
}

/**
 * `cleared` — содержимое позиции убрано одним составным действием; марка,
 * количество, единица измерения и поставщик остаются.
 *
 * Payload — зеркало `filled`: там имя результата, здесь имя того, что было
 * очищено (`name` из снимка ДО записи), плюс неизменившаяся марка. Этого
 * хватает, чтобы прочитать событие без обращения к прежнему состоянию, и
 * больше ничего не сохраняем: остальные поля очистка не трогает, а полный
 * `spec_items` в payload не нужен.
 */
export function buildClearedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly SpecItemLifecycleRow[];
}): SpecItemEventInput[] {
  return lifecycleEvents("cleared", args, (row, size) => ({
    code: emptyToNull(row.code),
    name: emptyToNull(row.name),
    ...batchFields(size),
  }));
}

/* ------------------------------------------------------------------ */
/*  status_changed                                                     */
/* ------------------------------------------------------------------ */

/**
 * `status_changed` для позиций, у которых статус действительно изменился.
 *
 * Подписи берутся из `SPEC_STATUS_CONFIG` — того же словаря, которым
 * пользуется интерфейс (`lib/spec/status.ts`): дублировать словарь статусов
 * нельзя, иначе в ленте появится подпись, которой пользователь нигде не видит.
 *
 * Пары `from === to` отбрасываются здесь, а не только у вызывающего: это
 * главный инвариант события, и он должен держаться в одном месте, которое
 * покрыто тестом. Поэтому `batch_size` равен числу событий, а не числу
 * выбранных позиций: «изменилось 3 из 5» читается честнее, чем «5», если
 * у двух статус уже был таким.
 */
export function buildStatusChangedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  to: SpecStatus;
  items: readonly { id: string; from: SpecStatus }[];
}): SpecItemEventInput[] {
  const changed = new Map(
    args.items
      .filter((item) => item.from !== args.to)
      .map((item) => [item.id, item]),
  );
  const size = changed.size;

  return [...changed.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.id,
    actor: args.actor,
    kind: "status_changed" as const,
    payload: {
      from: item.from,
      to: args.to,
      from_label: SPEC_STATUS_CONFIG[item.from].label,
      to_label: SPEC_STATUS_CONFIG[args.to].label,
      ...batchFields(size),
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  price_changed                                                      */
/* ------------------------------------------------------------------ */

/**
 * `price_changed` для позиций, у которых цена действительно изменилась.
 *
 * Домен значений — `number | null`, как требует контракт события. Оговорка:
 * колонка `spec_items.price` объявлена `numeric not null`, поэтому `null` в
 * базе сегодня не встречается и на практике `from`/`to` — всегда числа. Тип
 * оставлен шире намеренно: переходы `null → 100` и `100 → null` описаны как
 * допустимые и покрыты тестом.
 *
 * Пары с одинаковыми значениями отбрасываются здесь, а не только у
 * вызывающего: «повторное сохранение той же цены» — не изменение, и это
 * главный инвариант события.
 *
 * `batch`/`batch_size` не добавляются: массовой правки цены в приложении нет,
 * а поля «на будущее» только запутают рендер.
 */
export function buildPriceChangedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly { id: string; from: number | null; to: number | null }[];
}): SpecItemEventInput[] {
  const changed = new Map(
    args.items
      .filter((item) => item.from !== item.to)
      .map((item) => [item.id, item]),
  );

  return [...changed.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.id,
    actor: args.actor,
    kind: "price_changed" as const,
    payload: {
      from: item.from,
      to: item.to,
      currency: "RUB" as const,
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  details_changed                                                    */
/* ------------------------------------------------------------------ */

/**
 * Обычные поля позиции, которые меняются штатным редактированием и не имеют
 * собственного события.
 *
 * Не входят сюда:
 *   * домены с отдельными событиями — `status`, `price`, `qty`, поставщик
 *     (`company_id`, `company_name_snapshot`, `contact_id`,
 *     `contact_name_snapshot`);
 *   * `code` — у марки зарезервирован свой `code_changed` (меняется отдельным
 *     RPC, а не патчем);
 *   * `parent_id` — иерархия, а не значение: в `changes` попал бы uuid, который
 *     интерфейс не может показать;
 *   * `material_id`, `is_placeholder` — состояние, которое ставят составные
 *     жесты (`filled` / `cleared`), а не пользователь;
 *   * `type`, `supplier_discount_pct`, `avail` — задаются только при создании
 *     и заполнении;
 *   * служебные `id`, `org_id`, `project_id`, `position`, `created_at`,
 *     `updated_at`, `deleted_at`, `attachments`, `base_price`,
 *     `cutting_stock`, `client_discount`, `supplier_discount`.
 *
 * Имена — колонки `spec_items`: payload уходит в БД, и остальные события
 * (`supplier_changed`) используют тот же snake_case.
 */
export const SPEC_ITEM_DETAIL_FIELDS = [
  "name",
  "brand",
  "article",
  "spec",
  "product_type",
  "product_url",
  "image_url",
  "lead_time",
  "unit",
  "notes",
  "rooms",
  "attrs",
  "stock_pct",
  "client_discount_pct",
] as const;

export type SpecItemDetailField = (typeof SPEC_ITEM_DETAIL_FIELDS)[number];

/** Значения полей деталей: ключи — только те, что нёс патч. */
export type SpecItemDetailValues = Partial<
  Record<SpecItemDetailField, unknown>
>;

/**
 * Приводит значение к сравнимому виду.
 *
 * Пустая строка — это «не заполнено», то есть то же самое, что `null`: переход
 * между ними изменением не считается. Порядок помещений и ключей
 * характеристик значением тоже не является — `rooms` и `attrs` сравниваются
 * как множества, иначе перестановка давала бы ложное событие.
 */
function canonicalDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    return value.length > 0 ? JSON.stringify(value) : "null";
  }
  if (Array.isArray(value)) {
    return JSON.stringify(
      value.map((item) => canonicalDetailValue(item)).sort(),
    );
  }
  if (typeof value === "object") {
    return JSON.stringify(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, canonicalDetailValue(item)] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  return JSON.stringify(value);
}

/** Значение для payload: пустая строка показывается как «не заполнено». */
function payloadDetailValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  return value;
}

/**
 * `details_changed` для позиций, у которых изменилось хотя бы одно обычное
 * поле.
 *
 * Один жест — одно событие: несколько полей в патче дают несколько entries в
 * `changes`, а не несколько событий. Поля с одинаковым значением отбрасываются
 * — сравниваются фактические значения, а не факт присутствия ключа в патче.
 */
export function buildDetailsChangedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    id: string;
    from: SpecItemDetailValues;
    to: SpecItemDetailValues;
  }[];
}): SpecItemEventInput[] {
  const unique = new Map(args.items.map((item) => [item.id, item]));
  const events: SpecItemEventInput[] = [];

  for (const item of unique.values()) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const field of SPEC_ITEM_DETAIL_FIELDS) {
      const before = item.from[field];
      const after = item.to[field];

      // Поле не участвовало в патче — сравнивать нечего.
      if (before === undefined && after === undefined) continue;
      if (canonicalDetailValue(before) === canonicalDetailValue(after)) continue;

      changes[field] = {
        from: payloadDetailValue(before),
        to: payloadDetailValue(after),
      };
    }

    if (Object.keys(changes).length === 0) continue;

    events.push({
      orgId: args.orgId,
      specItemId: item.id,
      actor: args.actor,
      kind: "details_changed",
      payload: { changes },
    });
  }

  return events;
}

/* ------------------------------------------------------------------ */
/*  variant_switched                                                   */
/* ------------------------------------------------------------------ */

/**
 * Ссылка на вариант для истории: идентификатор и название на момент события.
 *
 * Название хранится снимком — последующее переименование варианта не должно
 * менять смысл уже записанного события.
 */
export type SpecItemVariantRef = {
  variantId: string;
  name: string | null;
};

/**
 * `variant_switched` для позиций, у которых активный вариант действительно
 * сменился.
 *
 * В payload идёт `name`, а не `label`: в меню вариантов строка подписана именно
 * названием (`variant-switcher.tsx`), а `label` там вторичная мета и у
 * служебного снимка равна «Основной». Идентификатор — ключ сравнения: `null` в
 * `from` значит, что активного варианта не было вовсе, `null` в `to` — что его
 * не стало.
 */
export function buildVariantSwitchedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    specItemId: string;
    from: SpecItemVariantRef | null;
    to: SpecItemVariantRef | null;
  }[];
}): SpecItemEventInput[] {
  const unique = new Map(args.items.map((item) => [item.specItemId, item]));
  const events: SpecItemEventInput[] = [];

  for (const item of unique.values()) {
    if ((item.from?.variantId ?? null) === (item.to?.variantId ?? null)) continue;

    events.push({
      orgId: args.orgId,
      specItemId: item.specItemId,
      actor: args.actor,
      kind: "variant_switched",
      payload: {
        from: item.from
          ? { variant_id: item.from.variantId, name: item.from.name || null }
          : null,
        to: item.to
          ? { variant_id: item.to.variantId, name: item.to.name || null }
          : null,
      },
    });
  }

  return events;
}

/* ------------------------------------------------------------------ */
/*  variant_added                                                      */
/* ------------------------------------------------------------------ */

/**
 * `variant_added` — к позиции добавлен вариант замены.
 *
 * Событие лежит в ленте родительской позиции, но описывает запись
 * `spec_item_variants`, поэтому в payload стоит `variant_id`.
 *
 * `name`, `price`, `article` и поставщик в payload НЕ входят, хотя это поля
 * варианта. На момент создания они ещё не принадлежат новому варианту: сервер
 * копирует их у активного, а фактическими их делает второй вызов того же жеста
 * (`updateVariant` с `origin: "create"` — заполнение выбранным материалом).
 * Снимок этих полей зафиксировал бы состояние, которого пользователь никогда
 * не видел, а отдельного `variant_updated` у этой второй половины жеста нет
 * ровно по той же причине.
 * `label` стабилен: клиент передаёт его при создании и повторяет при
 * заполнении, и им же подписан вариант в интерфейсе. `code` у варианта нет
 * вовсе — марка принадлежит позиции.
 *
 * `base_snapshot_created` отмечает побочный эффект того же жеста: если у
 * позиции ещё не было вариантов, сервер сначала фиксирует текущий материал
 * снимком «Основной», чтобы переключение было обратимым. Это не отдельное
 * пользовательское действие, поэтому своего события у снимка нет.
 */
export function buildVariantAddedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    specItemId: string;
    variantId: string;
    label: string | null;
    baseSnapshotCreated: boolean;
  }[];
}): SpecItemEventInput[] {
  const unique = new Map(args.items.map((item) => [item.variantId, item]));

  return [...unique.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.specItemId,
    actor: args.actor,
    kind: "variant_added" as const,
    payload: {
      variant_id: item.variantId,
      label: item.label || null,
      base_snapshot_created: item.baseSnapshotCreated,
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  variant_updated                                                    */
/* ------------------------------------------------------------------ */

/**
 * Поля варианта, изменение которых видит пользователь, — ровно те колонки
 * `spec_item_variants`, которые принимает патч варианта
 * (`specVariantPatchSchema` в lib/validations.ts).
 *
 * Служебные колонки (`id`, `org_id`, `spec_item_id`, `position`, `is_active`,
 * `created_at`, `updated_at`) сюда не входят: их пишет сама mutation, и
 * пользовательским изменением они не являются. Whitelist отсекает их
 * структурно — даже если сравнивать строку «до» и «после» целиком, `updated_at`
 * в `changes` не попадёт.
 *
 * Имена — колонки БД: payload уходит в БД, и остальные события
 * (`details_changed`) используют тот же snake_case.
 */
export const SPEC_VARIANT_PATCH_FIELDS = [
  "name",
  "brand",
  "article",
  "spec",
  "price",
  "product_url",
  "image_url",
  "lead_time",
  "company_id",
  "company_name_snapshot",
  "contact_id",
  "label",
] as const;

export type SpecVariantPatchField = (typeof SPEC_VARIANT_PATCH_FIELDS)[number];

/**
 * Строка варианта — целиком или только отслеживаемые поля: билдер сам
 * выбирает из неё `SPEC_VARIANT_PATCH_FIELDS`, поэтому ему можно отдать
 * вернувшуюся из БД строку как есть.
 */
export type SpecVariantPatchValues = Partial<
  Record<SpecVariantPatchField, unknown>
>;

/**
 * Кто инициировал запись варианта. `variant_updated` пишет только явное
 * редактирование пользователем (`edit`), у остальных значений события нет:
 *
 *   * `create` — заполнение варианта данными выбранного материала сразу после
 *     `addVariant`: это вторая половина одного жеста «добавить вариант», за
 *     который уже отвечает `variant_added`;
 *   * `mirror` — зеркалирование полей материала позиции в её активный вариант
 *     (`updateItem` → `updateVariantLocal`): те же поля уже описаны событиями
 *     самой позиции (`details_changed`, `price_changed`, `supplier_changed`).
 *
 * Определить это на сервере нечем: `updateVariant` — единственная mutation
 * варианта, и патч правки из формы неотличим от патча зеркалирования. Поэтому
 * происхождение называет клиент — ровно как `SpecItemFillOrigin` и
 * `SpecItemCreateOrigin`.
 */
export type SpecVariantUpdateOrigin = "edit" | "create" | "mirror";

/**
 * `variant_updated` — изменение данных конкретного варианта (запись
 * `spec_item_variants`), а не полей самой позиции.
 *
 * Один жест — одно событие: несколько полей в патче дают несколько entries в
 * `changes`, а не несколько событий. Обе стороны сравнения — строки варианта:
 * `from` читается из БД до mutation, `to` берётся из применённой строки, а не
 * из клиентского патча (патч не доказывает, что записалось именно это).
 *
 * Поля с одинаковым значением отбрасываются, поэтому повторное сохранение тех
 * же данных события не даёт. `""` и `null` — одно и то же «не заполнено»:
 * нормализация и сравнение те же, что у `details_changed`
 * (`canonicalDetailValue` / `payloadDetailValue`), иначе снятие поставщика
 * (`company_id: null` вместе с пустым снимком имени) давало бы ложное событие.
 *
 * Имя варианта отдельным полем payload не дублируется: оно попадает в
 * `changes.name`, когда меняется, а постоянного «заголовка» у события нет —
 * как и у `variant_added`, где в payload стоит `variant_id`.
 */
export function buildVariantUpdatedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    specItemId: string;
    variantId: string;
    from: SpecVariantPatchValues;
    to: SpecVariantPatchValues;
  }[];
}): SpecItemEventInput[] {
  const unique = new Map(args.items.map((item) => [item.variantId, item]));
  const events: SpecItemEventInput[] = [];

  for (const item of unique.values()) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const field of SPEC_VARIANT_PATCH_FIELDS) {
      const before = item.from[field];
      const after = item.to[field];

      if (canonicalDetailValue(before) === canonicalDetailValue(after)) continue;

      changes[field] = {
        from: payloadDetailValue(before),
        to: payloadDetailValue(after),
      };
    }

    if (Object.keys(changes).length === 0) continue;

    events.push({
      orgId: args.orgId,
      specItemId: item.specItemId,
      actor: args.actor,
      kind: "variant_updated",
      payload: { variant_id: item.variantId, changes },
    });
  }

  return events;
}

/* ------------------------------------------------------------------ */
/*  variant_removed                                                    */
/* ------------------------------------------------------------------ */

/**
 * `variant_removed` — вариант удалён из позиции.
 *
 * Удаление физическое: у `spec_item_variants` нет `deleted_at`, строка исчезает.
 * Поэтому всё, что событие должно показать, обязано быть снято ДО mutation —
 * после DELETE читать уже нечего. Отсюда состав payload: `variant_id` как ключ
 * и `name` + `label` как читаемая подпись (название — основная строка и в
 * переключателе, и в списке вариантов, `label` — вторичная мета и признак
 * служебного снимка «Основной»). Цена, бренд и артикул намеренно не сохранены:
 * для «вариант X удалён» они не нужны, а снимок должен оставаться минимальным.
 *
 * `was_active` и `next_active` описывают последствие жеста. Позиция не может
 * остаться без активного варианта, поэтому при удалении активного mutation тут
 * же назначает первый оставшийся (по `position`). Это НЕ переключение
 * пользователем: он выбрал удаление, а не замену, и выбор делает сервер
 * технически — поэтому отдельного `variant_switched` здесь нет, а факт
 * зафиксирован в этом же событии. `next_active` — снимок преемника: без него
 * история умалчивала бы, каким стал материал позиции, и восстановить это потом
 * нечем (преемника могут удалить или переключить). `null` в `next_active` при
 * `was_active: true` значит, что назначить никого не удалось.
 */
export function buildVariantRemovedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    specItemId: string;
    variantId: string;
    name: string | null;
    label: string | null;
    /** Состояние ДО удаления: строка читается у удаляемой записи. */
    wasActive: boolean;
    /** Кто стал активным вместо удалённого. null — удаляли неактивный вариант. */
    nextActive: SpecItemVariantRef | null;
  }[];
}): SpecItemEventInput[] {
  const unique = new Map(args.items.map((item) => [item.variantId, item]));

  return [...unique.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.specItemId,
    actor: args.actor,
    kind: "variant_removed" as const,
    payload: {
      variant_id: item.variantId,
      // Пустая подпись — это «не заполнено»: показывать её как значение нельзя.
      name: item.name || null,
      label: item.label || null,
      was_active: item.wasActive,
      next_active: item.nextActive
        ? {
            variant_id: item.nextActive.variantId,
            name: item.nextActive.name || null,
          }
        : null,
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  component_added                                                    */
/* ------------------------------------------------------------------ */

/**
 * Вид добавленной строки состава — те же значения, что в CHECK
 * `spec_item_components_kind_check`: `component` (собственный компонент),
 * `group` (группа состава), `spec_ref` (ссылка на другую позицию).
 *
 * Тип объявлен здесь, а не импортирован из actions/spec-components.ts: этот
 * модуль обязан оставаться свободным от рантайм-зависимостей (из него берут
 * подписи для интерфейса), а `import type` из «use server»-файла потянул бы в
 * граф тестов серверные модули.
 */
export type SpecItemCompositionKind = "component" | "group" | "spec_ref";

/**
 * Читаемая подпись связанной позиции состава — ровно то, чем строка ссылки
 * подписана в интерфейсе: марка и название (`[code, name].join(" · ")`).
 *
 * Хранится снимком: `hydrateRefItems` показывает связанную позицию «свежими»
 * данными, а если её мягко удалят или перенесут в другой проект, интерфейс
 * покажет «исходная позиция недоступна». В истории же должно остаться то, что
 * пользователь видел в момент добавления.
 */
export type SpecItemComponentRefSnapshot = {
  specItemId: string;
  code: string | null;
  name: string | null;
};

/**
 * Общая часть payload'а событий состава: строка описывается одинаково и при
 * добавлении, и при удалении, чтобы лента читалась парно («добавлен …» /
 * «удалён …»). `component_id` каждый билдер добавляет сам — он и есть ключ.
 *
 * У ссылки (`kind = 'spec_ref'`) собственного названия нет: в БД лежит
 * технический маркер (`name = 'spec_ref'`), а показывает её подпись связанной
 * позиции (`ref`). Поэтому у ссылки `name` нормализуется в `null`.
 */
function compositionPayload(
  kind: SpecItemCompositionKind,
  name: string | null,
  ref: SpecItemComponentRefSnapshot | null,
): Record<string, unknown> {
  return {
    kind,
    name: kind === "spec_ref" ? null : name || null,
    ref:
      kind === "spec_ref"
        ? {
            spec_item_id: ref?.specItemId ?? null,
            code: ref?.code || null,
            name: ref?.name || null,
          }
        : null,
  };
}

/**
 * `component_added` — в состав позиции добавлена строка: компонент, группа или
 * ссылка на другую позицию.
 *
 * Одно пользовательское добавление — одно событие; каждое из трёх действий
 * (`createSpecItemComponent`, `createSpecItemComponentGroup`,
 * `createSpecItemComponentRef`) добавляет ровно одну строку, поэтому batch-полей
 * (в отличие от `created` / `removed`) здесь нет.
 *
 * Состав — отдельная таблица `spec_item_components`, её строки не являются
 * строками `spec_items` и в основную таблицу, закупку, сводки и экспорт не
 * попадают. Событие поэтому привязано к позиции-владельцу (`spec_item_id`), а
 * сама добавленная строка названа `component_id`: без него в ленте нечего
 * показать, а после удаления строки искать её будет негде.
 *
 * `kind` различает три вида строк: у компонента и группы в `name` лежит
 * название, у ссылки собственного названия нет — в БД у неё технический маркер
 * (`name = 'spec_ref'`), поэтому её подпись едет в `ref`, а `name` для ссылки
 * нормализуется в `null`.
 */
export function buildComponentAddedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    specItemId: string;
    componentId: string;
    kind: SpecItemCompositionKind;
    /** Название строки состава; для ссылки не используется (см. `ref`). */
    name: string | null;
    /** Подпись связанной позиции; только для kind = 'spec_ref'. */
    ref: SpecItemComponentRefSnapshot | null;
  }[];
}): SpecItemEventInput[] {
  const unique = new Map(args.items.map((item) => [item.componentId, item]));

  return [...unique.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.specItemId,
    actor: args.actor,
    kind: "component_added" as const,
    payload: {
      component_id: item.componentId,
      ...compositionPayload(item.kind, item.name, item.ref),
    },
  }));
}

/**
 * `component_removed` — строка состава удалена.
 *
 * Удаление физическое: у `spec_item_components` нет `deleted_at`, строка
 * исчезает. Поэтому снимок берётся из самой удаляемой строки (`.select()` на
 * DELETE отдаёт её целиком), а не из входных данных клиента и не отдельным
 * чтением: после удаления искать строку будет негде.
 *
 * Одно пользовательское действие удаляет ровно одну строку состава — включая
 * удаление группы: непустую группу mutation удалять отказывается, поэтому
 * дочерние строки каскадом не уезжают и терять нечего. Отсюда, как и у
 * `component_added`, никаких batch-полей.
 */
export function buildComponentRemovedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    specItemId: string;
    componentId: string;
    kind: SpecItemCompositionKind;
    /** Название удалённой строки; для ссылки не используется (см. `ref`). */
    name: string | null;
    /** Подпись связанной позиции; только для kind = 'spec_ref'. */
    ref: SpecItemComponentRefSnapshot | null;
  }[];
}): SpecItemEventInput[] {
  const unique = new Map(args.items.map((item) => [item.componentId, item]));

  return [...unique.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.specItemId,
    actor: args.actor,
    kind: "component_removed" as const,
    payload: {
      component_id: item.componentId,
      ...compositionPayload(item.kind, item.name, item.ref),
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  service_added / service_completed / service_removed                */
/* ------------------------------------------------------------------ */

/**
 * Снимок сервисной операции для истории: минимум, по которому лента опознаёт
 * операцию и показывает её без обращения к текущей строке.
 *
 * `type` — по нему `operationLabel()` даёт подпись («Доставка», «Монтаж», а у
 * своей услуги — её название). Подпись отдельным полем не дублируется:
 * `lib/constants` держит единственную точку, где тип превращается в текст.
 * `name` есть только у своих услуг (у доставки и монтажа в БД null), `amount` —
 * сумма на момент события. Подрядчик, срок, заметки и отметка «исполнено» не
 * сохранены: это редактируемые атрибуты существующей строки, а не то, чем
 * операция опознаётся.
 */
type SpecItemServiceSnapshot = {
  serviceId: string;
  type: ServiceOperationType;
  name: string | null;
  amount: number;
};

/** Данные события операции: операция одна, связанных позиций — сколько угодно. */
type SpecItemServiceEventArgs = {
  orgId: string;
  actor: SpecItemEventActor;
  /** Значения из строки БД: результат INSERT или UPDATE, а не ввод клиента. */
  service: SpecItemServiceSnapshot;
  /** Связанные позиции — из `service_operation_items`. */
  specItemIds: readonly string[];
};

/**
 * Событие сервисной операции в ленту КАЖДОЙ связанной позиции.
 *
 * Операция живёт в `service_operations` и принадлежит ПРОЕКТУ, а не позиции:
 * связь с позициями — многие ко многим через `service_operation_items`. Лента
 * же персональная (`spec_item_events.spec_item_id` обязателен), поэтому одно
 * действие с операцией даёт N событий — по одному в ленту каждой затронутой
 * позиции, ровно как у групповых операций (`created`, `removed`,
 * `status_changed`). По той же причине флаги групповой операции берутся из
 * общего `batchFields`: `batch_size` — число событий, а не число операций
 * (операция всегда одна — и создания, и завершения).
 *
 * Своя услуга может быть расходом проекта целиком, без связанных позиций: тогда
 * событий не будет вовсе — в персональной ленте ему негде лежать.
 *
 * Payload у добавления, завершения и удаления одинаков: все три — про одну и ту
 * же операцию, а что именно произошло, сказано типом события, поэтому
 * `completed` и признаки удаления в данных не дублируются.
 */
function serviceItemEvents(
  kind: "service_added" | "service_completed" | "service_removed",
  args: SpecItemServiceEventArgs,
): SpecItemEventInput[] {
  // Повтор id в списке дал бы две строки в ленте одной позиции и завышенный
  // batch_size; связка «операция ⇄ позиция» и так уникальна (PK в БД).
  const unique = [...new Set(args.specItemIds)];
  const size = unique.length;

  return unique.map((specItemId) => ({
    orgId: args.orgId,
    specItemId,
    actor: args.actor,
    kind,
    payload: {
      service_id: args.service.serviceId,
      type: args.service.type,
      // Пустое название — это «не заполнено»; у доставки и монтажа его нет.
      name: args.service.name || null,
      amount: args.service.amount,
      ...batchFields(size),
    },
  }));
}

/**
 * `service_added` — к позиции добавлена сервисная операция: «Доставка»,
 * «Монтаж» или своя услуга.
 */
export function buildServiceAddedEvents(
  args: SpecItemServiceEventArgs,
): SpecItemEventInput[] {
  return serviceItemEvents("service_added", args);
}

/**
 * `service_completed` — сервисная операция завершена (отметка «Исполнено»).
 *
 * Событие одно на всю операцию и описывает единый жест: отметка завершения и
 * её следствия (исполненная доставка переводит связанные материалы в
 * «Доставлено») не логируются отдельными событиями — `status_changed` из этого
 * не пишется.
 */
export function buildServiceCompletedEvents(
  args: SpecItemServiceEventArgs,
): SpecItemEventInput[] {
  return serviceItemEvents("service_completed", args);
}

/**
 * `service_removed` — сервисная операция удалена из проекта.
 *
 * Удаление физическое: строки `service_operations` и её связок исчезают
 * (`service_operation_items.operation_id` объявлен `on delete cascade`).
 * Поэтому и снимок операции, и список связанных позиций обязаны быть сняты ДО
 * удаления: после него читать уже нечего, а в ленте каждой позиции должно
 * остаться то, что пользователь видел до удаления.
 */
export function buildServiceRemovedEvents(
  args: SpecItemServiceEventArgs,
): SpecItemEventInput[] {
  return serviceItemEvents("service_removed", args);
}

/* ------------------------------------------------------------------ */
/*  parent_changed                                                     */
/* ------------------------------------------------------------------ */

/**
 * Родитель позиции в читаемом виде — то же, что показывает меню «В состав…»:
 * марка и название. Голый uuid в истории бесполезен, поэтому id идёт лишь
 * ключом сравнения, а в payload — под именем колонки `spec_item_id`: так же
 * названы ссылки на позиции и в остальных событиях (`variant_id`,
 * `component_id`, вложенный `ref.spec_item_id`).
 */
export type SpecItemParentRef = {
  specItemId: string;
  code: string | null;
  name: string | null;
};

/** Родитель для payload: доменное имя поля → ключ колонки. */
function parentRefPayload(
  ref: SpecItemParentRef | null,
): Record<string, unknown> | null {
  if (!ref) return null;
  return {
    spec_item_id: ref.specItemId,
    code: ref.code || null,
    name: ref.name,
  };
}

/**
 * `parent_changed` для позиций, у которых родитель действительно сменился.
 *
 * Сравниваются идентификаторы: `null` — позиция стала корневой, а смена
 * родителя на другого даёт новую пару `from → to`. Если id совпал, события
 * нет — повторная установка того же родителя ничего не меняет.
 */
export function buildParentChangedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    id: string;
    from: SpecItemParentRef | null;
    to: SpecItemParentRef | null;
  }[];
}): SpecItemEventInput[] {
  const unique = new Map(args.items.map((item) => [item.id, item]));
  const events: SpecItemEventInput[] = [];

  for (const item of unique.values()) {
    if (
      (item.from?.specItemId ?? null) === (item.to?.specItemId ?? null)
    )
      continue;

    events.push({
      orgId: args.orgId,
      specItemId: item.id,
      actor: args.actor,
      kind: "parent_changed",
      payload: {
        from: parentRefPayload(item.from),
        to: parentRefPayload(item.to),
      },
    });
  }

  return events;
}

/* ------------------------------------------------------------------ */
/*  code_changed                                                       */
/* ------------------------------------------------------------------ */

/**
 * `code_changed` для позиций, у которых марка действительно изменилась.
 *
 * Марка меняется своим путём — RPC `set_spec_item_code`: уникальность и обмен
 * проверяются в БД, и переводить её в общий патч нельзя. Отсюда особенность:
 * обмен марками меняет код сразу у ДВУХ позиций, и каждой принадлежит своё
 * событие — иначе в истории второй позиции смена марки не отразилась бы вовсе.
 *
 * Пустая строка нормализуется в `null` до сравнения: колонка `code` nullable,
 * и «марки нет» и «марка пустая» — одно и то же. `batch` не добавляется:
 * групповой смены марок в приложении нет, а обмен — одно действие, записанное
 * в историю каждой из двух позиций.
 */
export function buildCodeChangedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly { id: string; from: string | null; to: string | null }[];
}): SpecItemEventInput[] {
  const normalize = (value: string | null | undefined): string | null =>
    value ? value : null;

  const changed = new Map(
    args.items
      .map((item) => ({
        id: item.id,
        from: normalize(item.from),
        to: normalize(item.to),
      }))
      .filter((item) => item.from !== item.to)
      .map((item) => [item.id, item]),
  );

  return [...changed.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.id,
    actor: args.actor,
    kind: "code_changed" as const,
    payload: { from: item.from, to: item.to },
  }));
}

/* ------------------------------------------------------------------ */
/*  supplier_changed                                                   */
/* ------------------------------------------------------------------ */

/**
 * Поставщик позиции — компания и менеджер. Значения те же, что в колонках
 * `spec_items`: `company_name` — это `company_name_snapshot`, `contact_name` —
 * `contact_name_snapshot`.
 */
export type SpecItemSupplierSnapshot = {
  company_id: string | null;
  company_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
};

/**
 * Отсутствующее значение — `null`, а не пустая строка: так требует контракт
 * события, и так же сравниваются снимки (иначе `""` и `null` считались бы
 * изменением, хотя значат одно и то же).
 */
function supplierName(value: string | null | undefined): string | null {
  return value ? value : null;
}

function normalizeSupplier(
  supplier: SpecItemSupplierSnapshot,
): SpecItemSupplierSnapshot {
  return {
    company_id: supplier.company_id ?? null,
    company_name: supplierName(supplier.company_name),
    contact_id: supplier.contact_id ?? null,
    contact_name: supplierName(supplier.contact_name),
  };
}

/** Поставщик не изменился, если совпали все четыре значения. */
function sameSupplier(
  a: SpecItemSupplierSnapshot,
  b: SpecItemSupplierSnapshot,
): boolean {
  return (
    a.company_id === b.company_id &&
    a.company_name === b.company_name &&
    a.contact_id === b.contact_id &&
    a.contact_name === b.contact_name
  );
}

/**
 * `supplier_changed` для позиций, у которых поставщик действительно изменился.
 *
 * Поставщик — один домен, поэтому и событие одно: смена компании и менеджера
 * одним жестом даёт одну запись с полными `from`/`to`, а не `company_changed`
 * плюс `contact_changed`. Сравниваются фактические значения всех четырёх
 * полей, а не только наличие `company_id`.
 *
 * Нормализация идёт ДО сравнения: пустая строка и `null` значат одно и то же
 * («значение не указано»), и переход между ними изменением не считается.
 */
export function buildSupplierChangedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    id: string;
    from: SpecItemSupplierSnapshot;
    to: SpecItemSupplierSnapshot;
  }[];
}): SpecItemEventInput[] {
  const changed = new Map(
    args.items
      .map((item) => ({
        id: item.id,
        from: normalizeSupplier(item.from),
        to: normalizeSupplier(item.to),
      }))
      .filter((item) => !sameSupplier(item.from, item.to))
      .map((item) => [item.id, item]),
  );

  return [...changed.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.id,
    actor: args.actor,
    kind: "supplier_changed" as const,
    payload: { from: item.from, to: item.to },
  }));
}

/* ------------------------------------------------------------------ */
/*  quantity_changed                                                   */
/* ------------------------------------------------------------------ */

/**
 * `quantity_changed` для позиций, у которых количество действительно
 * изменилось.
 *
 * Домен значений — `number`: колонка `spec_items.qty` объявлена `numeric not
 * null` со значением по умолчанию, поэтому переходов `null ↔ number` у неё не
 * бывает, и тип не расширяется «на всякий случай».
 *
 * `unit` приходит снимком из той же строки БД, что и `from`: единицу измерения
 * пользователь может поменять тем же патчем, и брать её из неподтверждённого
 * состояния клиента нельзя.
 *
 * `batch`/`batch_size` не добавляются: массовой правки количества в приложении
 * нет.
 */
export function buildQuantityChangedEvents(args: {
  orgId: string;
  actor: SpecItemEventActor;
  items: readonly {
    id: string;
    from: number;
    to: number;
    unit: string;
  }[];
}): SpecItemEventInput[] {
  const changed = new Map(
    args.items
      .filter((item) => item.from !== item.to)
      .map((item) => [item.id, item]),
  );

  return [...changed.values()].map((item) => ({
    orgId: args.orgId,
    specItemId: item.id,
    actor: args.actor,
    kind: "quantity_changed" as const,
    payload: {
      from: item.from,
      to: item.to,
      unit: item.unit,
    },
  }));
}
