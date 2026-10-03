/**
 * Mapper'ы истории: строка БД → доменный `HistoryEntry`.
 *
 * Чистые функции: ни клиента БД, ни запросов, ни React — только преобразование
 * данных. Это важно и для тестов (строку можно собрать литералом), и для
 * будущего чтения ленты: запросы и сортировка живут отдельно.
 *
 * Главное правило чтения — терпимость без выдумывания. Payload в БД это
 * `jsonb` со свободной формой, а строки исторические: поле могли переименовать,
 * тип события добавить позже, а значение оказаться не тем, что ждёт контракт.
 * Поэтому mapper:
 *
 *   * не бросает исключений — ни на неизвестном `kind`, ни на мусорном payload;
 *   * игнорирует незнакомые дополнительные поля;
 *   * отсутствующее или несоответствующее типу значение отдаёт как `null`;
 *   * не подставляет текстовых заглушек вместо данных.
 */

import {
  SERVICE_OPERATION_TYPES,
  SPEC_ITEM_STATUSES,
  type ServiceOperationType,
  type SpecStatus,
} from "../constants";
import type { Tables } from "../types";
import {
  SPEC_ITEM_DETAIL_FIELDS,
  SPEC_ITEM_EVENT_KINDS,
  SPEC_VARIANT_PATCH_FIELDS,
  type SpecItemEventKind,
} from "./history";
import type {
  HistoryActor,
  HistoryBatchFields,
  HistoryCommentEntry,
  HistoryCompositionPayload,
  HistoryEntryBase,
  HistoryEventEntry,
  HistoryFieldChange,
  HistoryServicePayload,
} from "./history-types";
import type {
  SpecItemComponentRefSnapshot,
  SpecItemParentRef,
  SpecItemSupplierSnapshot,
  SpecItemVariantRef,
} from "./history";

/** Строка журнала событий и строка комментариев — как их отдаёт PostgREST. */
export type SpecItemEventRow = Tables<"spec_item_events">;
export type SpecItemCommentRow = Tables<"spec_item_comments">;

/**
 * Колонки, из которых собирается доменная запись.
 *
 * Экспортируются как документация контракта и для тестов: запросы обязаны
 * оставаться литералами (`select("id, …")`), иначе supabase-js теряет вывод
 * типов и отдаёт `GenericStringError` вместо строки.
 */
export const HISTORY_EVENT_COLUMNS =
  "id, org_id, spec_item_id, kind, actor_id, actor_name_snapshot, payload, created_at" as const;

export const HISTORY_COMMENT_COLUMNS =
  "id, org_id, spec_item_id, parent_id, root_id, author_id, author_name_snapshot, body, created_at, edited_at, deleted_at" as const;

/* ------------------------------------------------------------------ */
/*  Чтение значений из payload                                         */
/* ------------------------------------------------------------------ */

type RawPayload = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * payload → плоский объект. Всё, что не объект (в том числе `null`, массив или
 * строка), считается пустым payload'ом: контракт обещает не падать.
 */
function asRawPayload(value: unknown): RawPayload {
  const out: RawPayload = {};
  if (!isRecord(value)) return out;
  for (const [key, item] of Object.entries(value)) out[key] = item;
  return out;
}

/**
 * Непустая строка или `null`.
 *
 * Пустая строка — то же самое «не заполнено», что и `null`: у части событий
 * (`removed` / `restored`) исторические строки писали `""`, и читающий код не
 * должен знать про два представления одного состояния.
 */
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Конечное число или `null`. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Флаги групповой операции: отсутствие полей — это «одиночное действие». */
function batchOf(raw: RawPayload): HistoryBatchFields {
  return { batch: raw.batch === true, batchSize: num(raw.batch_size) };
}

/** Код статуса из закрытого списка; незнакомый — `null` (подписи остаются). */
function statusOf(value: unknown): SpecStatus | null {
  const raw = text(value);
  return raw && (SPEC_ITEM_STATUSES as readonly string[]).includes(raw)
    ? (raw as SpecStatus)
    : null;
}

/** Тип операции из закрытого списка; незнакомый — `null`. */
function serviceTypeOf(value: unknown): ServiceOperationType | null {
  const raw = text(value);
  return raw && (SERVICE_OPERATION_TYPES as readonly string[]).includes(raw)
    ? (raw as ServiceOperationType)
    : null;
}

/** Ссылка на вариант без идентификатора бессмысленна — `null`. */
function variantRefOf(value: unknown): SpecItemVariantRef | null {
  if (!isRecord(value)) return null;
  const raw = asRawPayload(value);
  const variantId = text(raw.variant_id);
  return variantId ? { variantId, name: text(raw.name) } : null;
}

/** Родитель позиции: в payload ключ колонки, в домене — camelCase. */
function parentRefOf(value: unknown): SpecItemParentRef | null {
  if (!isRecord(value)) return null;
  const raw = asRawPayload(value);
  const specItemId = text(raw.spec_item_id);
  return specItemId ? { specItemId, code: text(raw.code), name: text(raw.name) } : null;
}

/** Поставщик позиции: четыре значения, отсутствующие — `null`. */
function supplierOf(value: unknown): SpecItemSupplierSnapshot | null {
  if (!isRecord(value)) return null;
  const raw = asRawPayload(value);
  return {
    company_id: text(raw.company_id),
    company_name: text(raw.company_name),
    contact_id: text(raw.contact_id),
    contact_name: text(raw.contact_name),
  };
}

/** Подпись связанной позиции состава. */
function componentRefOf(value: unknown): SpecItemComponentRefSnapshot | null {
  if (!isRecord(value)) return null;
  const raw = asRawPayload(value);
  const specItemId = text(raw.spec_item_id);
  return specItemId ? { specItemId, code: text(raw.code), name: text(raw.name) } : null;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `changes` из payload'а → массив в детерминированном порядке.
 *
 * `jsonb` не сохраняет порядок ключей, поэтому порядок задаём сами: сначала
 * известные поля в каноническом порядке (`order`), затем незнакомые — по
 * алфавиту. Так одна и та же запись всегда рендерится одинаково.
 */
function fieldChangesOf(
  value: unknown,
  order: readonly string[],
): HistoryFieldChange[] {
  const raw = asRawPayload(value);
  const rank = (field: string) => {
    const at = order.indexOf(field);
    return at === -1 ? order.length : at;
  };

  return Object.entries(raw)
    .map(([field, change]) => {
      const pair = asRawPayload(change);
      return { field, from: pair.from ?? null, to: pair.to ?? null };
    })
    .sort((a, b) => rank(a.field) - rank(b.field) || compareText(a.field, b.field));
}

/** Общий payload строки состава (`component_added` / `component_removed`). */
function compositionOf(raw: RawPayload): HistoryCompositionPayload {
  return {
    componentId: text(raw.component_id),
    compositionKind: text(raw.kind),
    name: text(raw.name),
    ref: componentRefOf(raw.ref),
  };
}

/** Общий payload сервисной операции (добавление / завершение / удаление). */
function serviceOf(raw: RawPayload): HistoryServicePayload {
  return {
    serviceId: text(raw.service_id),
    type: serviceTypeOf(raw.type),
    name: text(raw.name),
    amount: num(raw.amount),
    ...batchOf(raw),
  };
}

/* ------------------------------------------------------------------ */
/*  Mapper'ы                                                           */
/* ------------------------------------------------------------------ */

const EVENT_KINDS: ReadonlySet<string> = new Set(SPEC_ITEM_EVENT_KINDS);

/** Проверка `kind` из БД на рантайме: тип события мог появиться позже кода. */
function isEventKind(value: string): value is SpecItemEventKind {
  return EVENT_KINDS.has(value);
}

/** Общие для обеих таблиц колонки: связь с позицией и время записи. */
type EntryRowCore = {
  id: string;
  org_id: string;
  spec_item_id: string;
  created_at: string;
};

function entryBaseOf(row: EntryRowCore, actor: HistoryActor): HistoryEntryBase {
  return {
    id: row.id,
    orgId: row.org_id,
    specItemId: row.spec_item_id,
    createdAt: row.created_at,
    actor,
  };
}

/**
 * Снимок автора. Пустое имя — `null`: подставлять текст вместо отсутствующих
 * данных контракт не должен.
 */
function actorOf(id: string | null, name: string | null): HistoryActor {
  return { id, name: text(name) };
}

/**
 * Строка события → доменное событие. Чистая функция.
 *
 * Неизвестный `kind` (например, событие, добавленное более новой версией
 * приложения) даёт `null`: такую запись читающий слой пропускает, а не ломает
 * всю ленту. Мусорный или неполный payload исключением не считается — все
 * отсутствующие значения становятся `null`.
 */
export function mapSpecItemEvent(row: SpecItemEventRow): HistoryEventEntry | null {
  const kind = row.kind;
  if (!isEventKind(kind)) return null;

  const raw = asRawPayload(row.payload);
  const base = entryBaseOf(row, actorOf(row.actor_id, row.actor_name_snapshot));

  switch (kind) {
    case "created":
      return {
        ...base,
        source: "event",
        kind,
        payload: {
          code: text(raw.code),
          name: text(raw.name),
          type: text(raw.type),
          origin: text(raw.origin),
          ...batchOf(raw),
        },
      };
    case "filled":
      return {
        ...base,
        source: "event",
        kind,
        payload: {
          code: text(raw.code),
          name: text(raw.name),
          origin: text(raw.origin),
          ...batchOf(raw),
        },
      };
    case "cleared":
      return {
        ...base,
        source: "event",
        kind,
        payload: { code: text(raw.code), name: text(raw.name), ...batchOf(raw) },
      };
    case "removed":
      return {
        ...base,
        source: "event",
        kind,
        payload: { code: text(raw.code), name: text(raw.name), ...batchOf(raw) },
      };
    case "restored":
      return {
        ...base,
        source: "event",
        kind,
        payload: { code: text(raw.code), name: text(raw.name), ...batchOf(raw) },
      };
    case "code_changed":
      return {
        ...base,
        source: "event",
        kind,
        payload: { from: text(raw.from), to: text(raw.to) },
      };
    case "status_changed":
      return {
        ...base,
        source: "event",
        kind,
        payload: {
          from: statusOf(raw.from),
          to: statusOf(raw.to),
          fromLabel: text(raw.from_label),
          toLabel: text(raw.to_label),
          ...batchOf(raw),
        },
      };
    case "price_changed":
      return {
        ...base,
        source: "event",
        kind,
        payload: {
          from: num(raw.from),
          to: num(raw.to),
          currency: text(raw.currency),
        },
      };
    case "quantity_changed":
      return {
        ...base,
        source: "event",
        kind,
        payload: { from: num(raw.from), to: num(raw.to), unit: text(raw.unit) },
      };
    case "supplier_changed":
      return {
        ...base,
        source: "event",
        kind,
        payload: { from: supplierOf(raw.from), to: supplierOf(raw.to) },
      };
    case "details_changed":
      return {
        ...base,
        source: "event",
        kind,
        payload: { changes: fieldChangesOf(raw.changes, SPEC_ITEM_DETAIL_FIELDS) },
      };
    case "parent_changed":
      return {
        ...base,
        source: "event",
        kind,
        payload: { from: parentRefOf(raw.from), to: parentRefOf(raw.to) },
      };
    case "variant_added":
      return {
        ...base,
        source: "event",
        kind,
        payload: {
          variantId: text(raw.variant_id),
          label: text(raw.label),
          baseSnapshotCreated: raw.base_snapshot_created === true,
        },
      };
    case "variant_switched":
      return {
        ...base,
        source: "event",
        kind,
        payload: { from: variantRefOf(raw.from), to: variantRefOf(raw.to) },
      };
    case "variant_updated":
      return {
        ...base,
        source: "event",
        kind,
        payload: {
          variantId: text(raw.variant_id),
          changes: fieldChangesOf(raw.changes, SPEC_VARIANT_PATCH_FIELDS),
        },
      };
    case "variant_removed":
      return {
        ...base,
        source: "event",
        kind,
        payload: {
          variantId: text(raw.variant_id),
          name: text(raw.name),
          label: text(raw.label),
          wasActive: raw.was_active === true,
          nextActive: variantRefOf(raw.next_active),
        },
      };
    case "component_added":
      return { ...base, source: "event", kind, payload: compositionOf(raw) };
    case "component_removed":
      return { ...base, source: "event", kind, payload: compositionOf(raw) };
    case "service_added":
      return { ...base, source: "event", kind, payload: serviceOf(raw) };
    case "service_completed":
      return { ...base, source: "event", kind, payload: serviceOf(raw) };
    case "service_removed":
      return { ...base, source: "event", kind, payload: serviceOf(raw) };
  }
}

/**
 * Строка комментария, какой её достаточно для домена.
 *
 * Шире, чем `SpecItemCommentRow`: подходит и полная строка таблицы, и выборка
 * только нужных колонок (её делает и чтение ленты, и запись комментария).
 * `edited_at`/`deleted_at` необязательны наравне с `null`: отсутствие метки —
 * это «не изменялся / не удалён», и трактовать `undefined` наоборот нельзя.
 */
export type SpecItemCommentRowLike = Omit<
  SpecItemCommentRow,
  "edited_at" | "deleted_at"
> & {
  edited_at?: string | null;
  deleted_at?: string | null;
};

/**
 * Строка комментария → доменный комментарий. Чистая функция: `replyCount`
 * приходит аргументом, потому что считать ответы — задача читающего слоя.
 *
 * Мягко удалённый комментарий остаётся в ленте: `deleted` отмечает факт,
 * `body` не подменяется и не вычищается — иначе удалённый корень ветки оставил
 * бы ответы без плейсхолдера, а цитата в ответе — без своего текста. Скрывает
 * тело отображение (`activityQuoteText`, рендерер комментария), а не данные.
 *
 * Эту же функцию использует запись комментария (`./comment-mutate`), поэтому
 * результат мутации и результат чтения ленты — один и тот же домен по
 * построению, а не по совпадению.
 */
export function mapSpecItemComment(
  row: SpecItemCommentRowLike,
  replyCount: number,
): HistoryCommentEntry {
  return {
    ...entryBaseOf(row, actorOf(row.author_id, row.author_name_snapshot)),
    source: "comment",
    parentId: row.parent_id,
    rootId: row.root_id,
    body: row.body,
    editedAt: row.edited_at ?? null,
    deleted: (row.deleted_at ?? null) !== null,
    replyCount,
  };
}
