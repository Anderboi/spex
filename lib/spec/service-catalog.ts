import {
  SERVICE_OPERATION_CONFIG,
  operationLabel,
  type ServiceOperationType,
  type SpecStatus,
} from "@/lib/constants";
import type { ServiceOperation } from "@/actions/service-operations";
import type { ServiceOperationFields } from "@/lib/validations";

/**
 * Справочник услуг проекта для Createable Combobox в карточке материала.
 *
 * Отдельной таблицы-справочника услуг в проекте нет: услуги живут как
 * `service_operations` проекта («Доставка»/«Монтаж» с фиксированной подписью и
 * свои услуги с названием в `name`). Поэтому КАТАЛОГ — это те же операции:
 * второй модели не заводится, и всё, что попадает в список, можно выбрать без
 * создания дубликата.
 *
 * ── Порядок ──────────────────────────────────────────────────────────────
 *
 * Внутри группы — порядок, в котором операции пришли из
 * `listProjectServiceOperations` (свежие первыми). Клиент его не сортирует:
 * единственный источник порядка — данные сервера.
 */

/** Порядок групп в списке: фиксированные услуги, затем свои. */
const CREATE_ORDER: readonly ServiceOperationType[] = [
  "delivery",
  "installation",
  "service",
];

/** Услуга из списка: операция проекта + её подпись. */
export type ServiceCatalogEntry = {
  operation: ServiceOperation;
  type: ServiceOperationType;
  /** Подпись: «Доставка»/«Монтаж» из конфига или название своей услуги. */
  label: string;
  /** Позиции материала, уже связанные с этой операцией. */
  linkedItemIds: readonly string[];
  /** Ключ строки списка: id операции — строки не склеиваются. */
  key: string;
};

/**
 * Позиция, к которой привязывают услугу: минимум, нужный списку и кнопкам.
 *
 * Статус и признак заглушки здесь потому, что правила «в доставку только со
 * статусом…» и «заглушку нельзя» должны срабатывать в интерфейсе, а не падением
 * сохранения на сервере.
 */
export type ServiceTargetItem = {
  id: string;
  code: string;
  name: string;
  status: SpecStatus;
  isPlaceholder: boolean;
};

/** Позиция спецификации в объёме, нужном для подписи связи. */
export type LinkedItemRef = { id: string; code: string; name: string };

/** Индекс позиций по id: строится один раз на рендер, а не на каждую строку. */
export function linkedItemIndex(
  items: readonly LinkedItemRef[],
): Map<string, LinkedItemRef> {
  return new Map(items.map((i) => [i.id, i]));
}

/** Как назвать позиции, уже привязанные к операции. */
export type LinkedItemsLabel = {
  /** Короткий список для строки: «КР-01, МД-02, ПЛ-07». */
  short: string;
  /** Сколько позиций не поместилось в короткий список. */
  rest: number;
  /** Полный список для подсказки: «КР-01 · Керамогранит» построчно. */
  full: string;
  /** Всего связей, включая те, чьих позиций уже нет в списке. */
  total: number;
};

/**
 * Подпись связей операции.
 *
 * Сумма операции общая на все её позиции, поэтому в списке видно, К КОМУ услуга
 * уже относится: без этого «в проекте · 20 материалов» — число без адресата.
 * Связи с исчезнувшими позициями из подписи выпадают, но в `total` остаются:
 * число связей не должно врать из-за того, что позицию удалили.
 */
export function describeLinkedItems(
  ids: readonly string[],
  index: Map<string, LinkedItemRef>,
  max = 3,
): LinkedItemsLabel {
  const found = ids
    .map((id) => index.get(id))
    .filter((i): i is LinkedItemRef => i !== undefined);
  const shown = found.slice(0, max);
  return {
    short: shown.map((i) => i.code.trim() || i.name).join(", "),
    rest: ids.length - shown.length,
    full: found
      .map((i) => [i.code.trim(), i.name].filter(Boolean).join(" · "))
      .join("\n"),
    total: ids.length,
  };
}

/** Каталожная строка для операции проекта. */
export function toCatalogEntry(op: ServiceOperation): ServiceCatalogEntry {
  return {
    operation: op,
    type: op.type,
    label: operationLabel(op),
    linkedItemIds: op.spec_item_ids,
    key: op.id,
  };
}

/**
 * Услуги проекта в порядке отображения: сначала «Доставка» и «Монтаж», затем
 * свои услуги. Внутри группы сохраняется серверный порядок.
 */
export function serviceCatalog(
  ops: readonly ServiceOperation[],
): ServiceCatalogEntry[] {
  const entries = ops.map(toCatalogEntry);
  return CREATE_ORDER.flatMap((type) => entries.filter((e) => e.type === type));
}

/** Материал уже связан с этой услугой. */
export function isServiceLinkedToItem(
  entry: ServiceCatalogEntry,
  itemId: string,
): boolean {
  return entry.linkedItemIds.includes(itemId);
}

/**
 * Нормализация названия для сравнения. Правило то же, что у остальных пикеров
 * проекта (`MaterialTypePicker`): регистр не важен, лишние пробелы по краям
 * отбрасываются. Своей нормализации «на всякий случай» здесь не появляется.
 */
export function normalizeServiceName(value: string): string {
  return value.trim().toLowerCase();
}

/** Строка поиска: пустая строка означает «без фильтра». */
export function matchesServiceLabel(label: string, query: string): boolean {
  const needle = normalizeServiceName(query);
  if (!needle) return true;
  return normalizeServiceName(label).includes(needle);
}

/** Строка услуги проходит поиск по своей подписи. */
export function matchesServiceQuery(
  entry: ServiceCatalogEntry,
  query: string,
): boolean {
  return matchesServiceLabel(entry.label, query);
}

/**
 * Услуга с таким названием уже есть в каталоге. Пока true — предлагать
 * «+ Создать «…»» нельзя: это был бы дубликат.
 *
 * У «Доставки» и «Монтажа» подпись фиксирована, поэтому совпадение по ней
 * означает, что услуга уже существует, и создавать её заново незачем.
 */
export function hasServiceNamed(
  catalog: readonly ServiceCatalogEntry[],
  typed: string,
): boolean {
  const needle = normalizeServiceName(typed);
  if (!needle) return false;
  return catalog.some((e) => normalizeServiceName(e.label) === needle);
}

/**
 * Название зарезервировано за фиксированным типом: «Доставка» и «Монтаж».
 *
 * Проверка отдельная от `hasServiceNamed`: зарезервированное имя нельзя
 * занять своей услугой даже тогда, когда доставки или монтажа в проекте ещё
 * нет, — иначе в одной спецификации окажутся «Доставка» (тип: одна на позицию,
 * меняет статусы материалов) и «Доставка» (своя услуга: сколько угодно), и
 * различить их будет нечем. Для этих имён есть команды «Создать доставку» и
 * «Создать монтаж».
 */
export function isReservedServiceName(typed: string): boolean {
  const needle = normalizeServiceName(typed);
  if (!needle) return false;
  return Object.values(SERVICE_OPERATION_CONFIG).some(
    (config) => normalizeServiceName(config.label) === needle,
  );
}

/**
 * Поля обновления операции: существующая услуга получает материал, а всё
 * остальное (стоимость, срок, подрядчик, комментарий) остаётся как было.
 *
 * Повторная привязка идемпотентна: уже связанный материал не дублируется —
 * `specItemIds` без повторов, чего требует схема действия.
 */
export function serviceUpdateFields(
  op: ServiceOperation,
  itemId: string,
): ServiceOperationFields {
  const specItemIds = [...new Set([...op.spec_item_ids, itemId])];
  const shared = {
    specItemIds,
    amount: op.amount,
    completed: op.completed,
    deadline: op.deadline,
    contractorCompanyId: op.contractor_company_id,
    notes: op.notes ?? "",
  };
  return op.type === "service"
    ? { ...shared, type: "service", name: op.name ?? "" }
    : { ...shared, type: op.type, name: null };
}
