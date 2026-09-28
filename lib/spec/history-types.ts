/**
 * Доменный контракт истории позиции: системные события и комментарии в одном
 * читаемом виде.
 *
 * Это слой ЧТЕНИЯ. Запись живёт в `./history`: там строго типизированный домен
 * превращается в payload и уходит в БД. Здесь наоборот — payload из БД
 * (`jsonb`, в том числе исторические строки) превращается в домен. Поэтому
 * контракт терпим к неполным данным и НИГДЕ не выдумывает значения: всё, что
 * может отсутствовать в строке, объявлено как `| null`, а не подменяется
 * текстом-заглушкой.
 *
 * Состав payload'ов не дублируется: типы полей берутся из `./history`
 * (`SpecItemSupplierSnapshot`, `SpecItemVariantRef`, `SpecItemParentRef`,
 * `SpecItemComponentRefSnapshot`), чтобы у записи и чтения была одна правда.
 *
 * Контракт заменяет объявленные в `./history` `SpecItemEvent` и
 * `SpecItemComment`: те описывали строку-черновик с `payload:
 * Record<string, unknown>` и нигде не использовались.
 */

import type { ServiceOperationType, SpecStatus } from "../constants";
import type {
  SpecItemComponentRefSnapshot,
  SpecItemEventKind,
  SpecItemParentRef,
  SpecItemSupplierSnapshot,
  SpecItemVariantRef,
} from "./history";

/**
 * Общая часть событий, которые могут быть записаны групповой операцией.
 *
 * `batchSize` — число ЗАПИСАННЫХ событий операции (не число выбранных позиций
 * и не число операций). `null` означает, что поля нет в payload'е: так
 * выглядит одиночное действие, у которого размер не пишется.
 */
export type HistoryBatchFields = {
  batch: boolean;
  batchSize: number | null;
};

/**
 * Автор события или комментария.
 *
 * Оба поля nullable по схеме БД: `actor_id`/`author_id` обнуляются при
 * удалении пользователя (FK ON DELETE SET NULL), а снимок имени может
 * отсутствовать в исторической строке. Подставлять сюда текст («Пользователь»)
 * контракт не имеет права — это решение отображения, а не данных.
 */
export type HistoryActor = {
  id: string | null;
  name: string | null;
};

export type HistoryEntryBase = {
  id: string;
  orgId: string;
  specItemId: string;
  createdAt: string;
  actor: HistoryActor;
};

/**
 * Одно изменение поля в `details_changed` / `variant_updated`.
 *
 * `field` — имя колонки БД (`snake_case`), как оно лежит в payload'е. Тип
 * намеренно `string`, а не объединение известных полей: строка историческая, и
 * поле, которого больше нет в текущем наборе, не должно теряться при чтении.
 * Канонический порядок известных полей задают `SPEC_ITEM_DETAIL_FIELDS` и
 * `SPEC_VARIANT_PATCH_FIELDS`.
 */
export type HistoryFieldChange = {
  field: string;
  from: unknown;
  to: unknown;
};

/* ------------------------------------------------------------------ */
/*  Payload'ы событий                                                  */
/* ------------------------------------------------------------------ */

/** `created`: пустые марка/название/раздел и отсутствие происхождения — `null`. */
export type HistoryCreatedPayload = {
  code: string | null;
  name: string | null;
  type: string | null;
  /** Известные значения — `SpecItemCreateOrigin` из `./history`. */
  origin: string | null;
} & HistoryBatchFields;

/** `filled`: `origin` — известные значения `SpecItemFillOrigin`. */
export type HistoryFilledPayload = {
  code: string | null;
  name: string | null;
  origin: string | null;
} & HistoryBatchFields;

/** `cleared`, `removed`, `restored`: марка и название на момент события. */
export type HistoryLifecyclePayload = {
  code: string | null;
  name: string | null;
} & HistoryBatchFields;

export type HistoryCodeChangedPayload = {
  from: string | null;
  to: string | null;
};

/**
 * `status_changed`: значения статусов и их подписи — снимок на момент события.
 * Незнакомый код статуса даёт `null` в `from`/`to`, но подписи при этом
 * сохраняются: историю всё равно можно показать.
 */
export type HistoryStatusChangedPayload = {
  from: SpecStatus | null;
  to: SpecStatus | null;
  fromLabel: string | null;
  toLabel: string | null;
} & HistoryBatchFields;

export type HistoryPriceChangedPayload = {
  from: number | null;
  to: number | null;
  currency: string | null;
};

export type HistoryQuantityChangedPayload = {
  from: number | null;
  to: number | null;
  unit: string | null;
};

export type HistorySupplierChangedPayload = {
  from: SpecItemSupplierSnapshot | null;
  to: SpecItemSupplierSnapshot | null;
};

/** `details_changed`: изменения обычных полей позиции в стабильном порядке. */
export type HistoryDetailsChangedPayload = {
  changes: HistoryFieldChange[];
};

export type HistoryParentChangedPayload = {
  from: SpecItemParentRef | null;
  to: SpecItemParentRef | null;
};

export type HistoryVariantAddedPayload = {
  variantId: string | null;
  label: string | null;
  baseSnapshotCreated: boolean;
};

export type HistoryVariantSwitchedPayload = {
  from: SpecItemVariantRef | null;
  to: SpecItemVariantRef | null;
};

/** `variant_updated`: изменения полей варианта в стабильном порядке. */
export type HistoryVariantUpdatedPayload = {
  variantId: string | null;
  changes: HistoryFieldChange[];
};

export type HistoryVariantRemovedPayload = {
  variantId: string | null;
  name: string | null;
  label: string | null;
  wasActive: boolean;
  nextActive: SpecItemVariantRef | null;
};

/**
 * Строка состава — общий payload `component_added` и `component_removed`.
 *
 * `compositionKind` — вид строки (`SpecItemCompositionKind` из `./history`:
 * `component` / `group` / `spec_ref`). Тип `string`, а не объединение: у
 * состава нет экспортируемого рантайм-списка значений, а выдумывать его ради
 * сужения контракт не должен. `name` у ссылки пустой: её подпись едет в `ref`.
 */
export type HistoryCompositionPayload = {
  componentId: string | null;
  compositionKind: string | null;
  name: string | null;
  ref: SpecItemComponentRefSnapshot | null;
};

/** Сервисная операция — общий payload `service_added` / `completed` / `removed`. */
export type HistoryServicePayload = {
  serviceId: string | null;
  /** Незнакомый тип операции даёт `null`; подпись считает `operationLabel()`. */
  type: ServiceOperationType | null;
  name: string | null;
  amount: number | null;
} & HistoryBatchFields;

/* ------------------------------------------------------------------ */
/*  Дискриминированный union по kind                                   */
/* ------------------------------------------------------------------ */

/**
 * Payload каждого типа события. Ключи обязаны совпадать с
 * `SPEC_ITEM_EVENT_KINDS`: если тип появится в списке и не будет описан здесь,
 * `HistoryEventPayload` ниже перестанет собираться.
 */
export type HistoryEventPayloadMap = {
  created: HistoryCreatedPayload;
  filled: HistoryFilledPayload;
  cleared: HistoryLifecyclePayload;
  removed: HistoryLifecyclePayload;
  restored: HistoryLifecyclePayload;
  code_changed: HistoryCodeChangedPayload;
  status_changed: HistoryStatusChangedPayload;
  price_changed: HistoryPriceChangedPayload;
  quantity_changed: HistoryQuantityChangedPayload;
  supplier_changed: HistorySupplierChangedPayload;
  details_changed: HistoryDetailsChangedPayload;
  parent_changed: HistoryParentChangedPayload;
  variant_added: HistoryVariantAddedPayload;
  variant_switched: HistoryVariantSwitchedPayload;
  variant_updated: HistoryVariantUpdatedPayload;
  variant_removed: HistoryVariantRemovedPayload;
  component_added: HistoryCompositionPayload;
  component_removed: HistoryCompositionPayload;
  service_added: HistoryServicePayload;
  service_completed: HistoryServicePayload;
  service_removed: HistoryServicePayload;
};

/**
 * Payload вместе с его `kind` — по паре видно, какому событию он принадлежит.
 * Полезно там, где payload обрабатывают без самой записи ленты.
 */
export type HistoryEventPayload = {
  [K in SpecItemEventKind]: { kind: K; payload: HistoryEventPayloadMap[K] };
}[SpecItemEventKind];

/**
 * Событие в ленте. Объединение распределено по `kind`, поэтому `entry.kind`
 * однозначно определяет тип `entry.payload`:
 *
 * ```ts
 * if (entry.kind === "created") entry.payload.origin; // есть
 * entry.payload.amount;                               // ошибка компиляции
 * ```
 */
export type HistoryEventEntry = HistoryEntryBase & {
  source: "event";
} & HistoryEventPayload;

/**
 * Комментарий в ленте. Удалённые мягко не исчезают: `deleted` отмечает факт,
 * `body` остаётся тем, что пришло из БД (нужен для плейсхолдера ветки).
 */
export type HistoryCommentEntry = HistoryEntryBase & {
  source: "comment";
  parentId: string | null;
  rootId: string | null;
  body: string;
  editedAt: string | null;
  deleted: boolean;
  /** Число ответов: считает читающий слой, mapper запросов не делает. */
  replyCount: number;
};

/** Элемент единой ленты: системное событие или комментарий. */
export type HistoryEntry = HistoryEventEntry | HistoryCommentEntry;
