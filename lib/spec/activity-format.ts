/**
 * Форматирование записей ленты активности: `HistoryEntry` → тексты, подписи и
 * значения для отображения.
 *
 * Отдельный модуль без React и без клиента БД, потому что здесь живёт вся
 * "смысловая" часть рендерера: 21 вид системного события, словарь полей, даты,
 * склонения и форматирование значений. UI-компоненты (`activity-*.tsx`) только
 * раскладывают результат по примитивам `Marker` / `Message`, поэтому больших
 * `switch` по `kind` в разметке нет.
 *
 * ── Главное правило ────────────────────────────────────────────────────────
 *
 * Лента — это immutable snapshot: всё, что показывается, берётся из payload'а
 * записи. Текущий `SpecItem` для восстановления исторических значений не
 * читается — иначе «было: 100 ₽» со временем превращалось бы в сегодняшнюю
 * цену. Отсутствующее значение показывается как «—», а не подставляется из
 * чего-то другого.
 *
 * Единственные словари, которые здесь используются, — это словари
 * КЛАССИФИКАТОРОВ (`SPEC_STATUS_LABEL`, подписи полей, `UNIT_OPTIONS`): они
 * переводят код в текст и от позиции не зависят. Снимок остаётся приоритетным
 * источником: если в payload'е есть готовая подпись (`from_label`), берётся она.
 *
 * ── Почему switch, а не карта форматтеров ──────────────────────────────────
 *
 * Событие — размеченное объединение по `kind`, и только `switch` сужает
 * `entry.payload` до конкретного типа. Карта функций потребовала бы утверждений
 * типов (`as`), то есть ослабила бы типы ради удобства — чего делать нельзя.
 * Вместо этого `switch` возвращает результат, а хвост функции возвращает `null`:
 * компилятор проверяет, что все 21 ветка обработаны, а неизвестный `kind`
 * (появившийся в БД из более новой версии) не ломает ленту.
 */

import {
  SERVICE_OPERATION_CONFIG,
  SPEC_STATUS_LABEL,
  type SpecStatus,
} from "../constants";
import {
  SPEC_ITEM_DETAIL_FIELDS,
  SPEC_VARIANT_PATCH_FIELDS,
  type SpecItemCreateOrigin,
  type SpecItemFillOrigin,
} from "./history";
import type {
  HistoryCommentEntry,
  HistoryEventEntry,
  HistoryFieldChange,
  HistoryServicePayload,
} from "./history-types";

/** Запись ленты: то же объединение, что приходит с сервера. */
export type ActivityRecord = HistoryEventEntry | HistoryCommentEntry;

/** Имя иконки системного события. Разметку выбирает UI, здесь — только смысл. */
export type ActivityIcon =
  | "created"
  | "wand"
  | "eraser"
  | "trash"
  | "restore"
  | "hash"
  | "status"
  | "price"
  | "quantity"
  | "supplier"
  | "details"
  | "parent"
  | "variantAdd"
  | "variantSwitch"
  | "variantEdit"
  | "variantRemove"
  | "componentAdd"
  | "componentRemove"
  | "serviceAdd"
  | "serviceDone"
  | "serviceRemove";

/** Строка таблицы изменений: подпись поля уже переведена. */
export type ActivityChange = {
  field: string;
  label: string;
  from: string;
  to: string;
};

/** Результат форматирования системного события. */
export type ActivityPresentation = {
  icon: ActivityIcon;
  /** Основной текст: «Создано · из библиотеки». */
  title: string;
  /** Значение события (марка и название, ссылка, вариант) — необязательное. */
  detail?: { code?: string | null; name: string };
  /** Таблица изменений: только у `details_changed` и `variant_updated`. */
  changes?: ActivityChange[];
  /** Размер групповой операции: показывается только при `> 1`. */
  batchSize?: number;
};

/** Тексты для отсутствующих значений. */
const EMPTY_VALUE = "—";
/** В таблице изменений «пусто» называется явно — это состояние поля. */
const EMPTY_CHANGE_VALUE = "не заполнено";
/** Длина длинного значения в таблице изменений: лента не должна тянуться. */
const MAX_VALUE_LENGTH = 80;

/* ------------------------------------------------------------------ */
/*  Словарь полей                                                      */
/* ------------------------------------------------------------------ */

/**
 * Подписи полей позиции. Ключи — колонки БД (`snake_case`): именно их кладёт в
 * `changes` билдер истории, и в payload'е исторической строки может оказаться
 * поле, которого больше нет в `SPEC_ITEM_DETAIL_FIELDS` — оно не потеряется, а
 * покажется как есть (см. `activityFieldLabel`).
 */
const DETAIL_FIELD_LABEL: Record<string, string> = {
  name: "Название",
  brand: "Бренд",
  article: "Артикул",
  spec: "Спецификация",
  product_type: "Тип",
  product_url: "Ссылка",
  image_url: "Изображение",
  lead_time: "Срок поставки",
  unit: "Ед. изм.",
  notes: "Заметки",
  rooms: "Помещения",
  attrs: "Характеристики",
  stock_pct: "Запас",
  client_discount_pct: "Скидка клиента",
};

/** Подписи полей варианта: часть пересекается с полями позиции. */
const VARIANT_FIELD_LABEL: Record<string, string> = {
  name: "Название",
  brand: "Бренд",
  article: "Артикул",
  spec: "Спецификация",
  price: "Цена",
  product_url: "Ссылка",
  image_url: "Изображение",
  lead_time: "Срок поставки",
  company_id: "Компания",
  company_name_snapshot: "Поставщик",
  contact_id: "Менеджер",
  label: "Подпись",
};

/**
 * Канонический порядок полей для `details_changed`.
 *
 * Брать порядок ключей из payload'а нельзя: `jsonb` его не сохраняет, и одна и
 * та же запись рендерилась бы по-разному. Порядок задают существующие списки
 * проекта; незнакомые поля уходят в конец.
 */
const DETAIL_FIELD_ORDER: readonly string[] = SPEC_ITEM_DETAIL_FIELDS;
const VARIANT_FIELD_ORDER: readonly string[] = SPEC_VARIANT_PATCH_FIELDS;

/**
 * Подпись поля: из словаря, иначе само имя — но не пустая строка.
 *
 * `field` приходит из `jsonb`, поэтому проверяется на строку: исторический
 * payload мог быть записан с мусором, и падать из-за подписи лента не должна.
 */
export function activityFieldLabel(field: unknown): string {
  if (typeof field !== "string" || field.length === 0) return EMPTY_VALUE;
  return (
    DETAIL_FIELD_LABEL[field] ??
    VARIANT_FIELD_LABEL[field] ??
    field.replaceAll("_", " ")
  );
}

/* ------------------------------------------------------------------ */
/*  Origin и служебные подписи                                         */
/* ------------------------------------------------------------------ */

/**
 * Источник создания позиции. Словарь существующий (`SpecItemCreateOrigin`),
 * новых значений не придумываем; незнакомое — `null`, текст остаётся без
 * уточнения.
 */
const CREATE_ORIGIN_LABEL: Record<SpecItemCreateOrigin, string> = {
  placeholder: "пустая позиция",
  library: "из библиотеки",
  manual: "вручную",
  duplicate: "копия",
  library_page: "из библиотеки",
};

/** Источник заполнения заглушки (`SpecItemFillOrigin`). */
const FILL_ORIGIN_LABEL: Record<SpecItemFillOrigin, string> = {
  placeholder: "вручную",
  manual: "из библиотеки",
  undo: "отмена очистки",
};

function createOriginLabel(origin: string | null): string | null {
  if (!origin) return null;
  return CREATE_ORIGIN_LABEL[origin as SpecItemCreateOrigin] ?? null;
}

function fillOriginLabel(origin: string | null): string | null {
  if (!origin) return null;
  return FILL_ORIGIN_LABEL[origin as SpecItemFillOrigin] ?? null;
}

/** Текст статуса: подпись из снимка, иначе из словаря статусов, иначе `—`. */
function statusLabel(
  status: SpecStatus | null,
  snapshotLabel: string | null,
): string {
  if (snapshotLabel) return snapshotLabel;
  if (!status) return EMPTY_VALUE;
  return SPEC_STATUS_LABEL[status] ?? EMPTY_VALUE;
}

/** Подпись сервисной операции: у своей услуги — название, у типа — конфиг. */
function serviceLabel(payload: HistoryServicePayload): string | null {
  const name = payload.name?.trim();
  if (name) return name;
  if (!payload.type) return null;
  if (payload.type === "service") return "Услуга";
  return SERVICE_OPERATION_CONFIG[payload.type].label;
}

/* ------------------------------------------------------------------ */
/*  Форматирование значений                                            */
/* ------------------------------------------------------------------ */

/** Число в компактном виде: 15 500, 1 200 000 → 1,2 млн. */
function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("ru-RU", {
      maximumFractionDigits: 1,
    })} млн`;
  }
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

/** Компактное представление длины: «2,4 м» вместо «2400 мм». */
function formatMillimetres(mm: number): string {
  if (mm >= 1000) {
    return `${(mm / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} м`;
  }
  return `${mm.toLocaleString("ru-RU")} мм`;
}

/** Проценты: `0.15` → «15 %». */
function formatPercent(ratio: number): string {
  return `${(ratio * 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} %`;
}

/** Поле-процент: значения приходят долей единицы, но могут быть и числом. */
function isPercentField(field: string): boolean {
  return field.endsWith("_pct");
}

/** Поле-картинка: показывать путь целиком бессмысленно. */
function isImageField(field: string): boolean {
  return field === "image_url";
}

/** Ссылка: имя файла/хоста читается лучше, чем весь URL. */
function shortenLink(value: string): string {
  try {
    const url = new URL(value);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? `${url.hostname}/…/${last}` : url.hostname;
  } catch {
    return value;
  }
}

function truncate(value: string): string {
  return value.length > MAX_VALUE_LENGTH
    ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…`
    : value;
}

/**
 * Значение строки таблицы изменений.
 *
 * `emptyLabel` различает два контекста: в таблице отсутствующее значение — это
 * «не заполнено» (состояние поля), в остальных местах — «—».
 */
export function formatActivityValue(
  field: string,
  value: unknown,
  emptyLabel: string = EMPTY_CHANGE_VALUE,
): string {
  if (value === null || value === undefined) return emptyLabel;
  if (typeof value === "string") {
    if (value.length === 0) return emptyLabel;
    if (field === "product_url") return truncate(shortenLink(value));
    if (isImageField(field)) return truncate(value.split("/").pop() ?? value);
    return truncate(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return emptyLabel;
    if (isPercentField(field)) return formatPercent(value);
    if (field === "price") return `${formatNumber(value)} ₽`;
    if (field === "lead_time") return formatMillimetres(value);
    return formatNumber(value);
  }
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (Array.isArray(value)) {
    // Массив — значения через запятую: помещения, теги, вложенные значения.
    const items = value
      .map((item) => formatActivityValue(field, item, emptyLabel))
      .filter((item) => item !== emptyLabel);
    return items.length > 0 ? truncate(items.join(", ")) : emptyLabel;
  }
  if (typeof value === "object") {
    // `attrs` и подобные словари — «ключ: значение» в порядке ключей.
    const entries = Object.entries(value as Record<string, unknown>)
      .map(
        ([key, item]) =>
          `${key}: ${formatActivityValue(field, item, emptyLabel)}`,
      )
      .filter(Boolean);
    return entries.length > 0 ? truncate(entries.join(", ")) : emptyLabel;
  }
  return emptyLabel;
}

/** Ссылка на сущность в тексте события: «М-01 Название» без пустых частей. */
function refText(ref: { code: string | null; name: string | null }): string | null {
  const code = ref.code?.trim();
  const name = ref.name?.trim();
  if (code && name) return `${code} · ${name}`;
  return code ?? name ?? null;
}

/** Значение, которого нет в payload'е, показывается как `—`. */
function orEmpty(value: string | null): string {
  return value ?? EMPTY_VALUE;
}

/* ------------------------------------------------------------------ */
/*  Таблица изменений                                                  */
/* ------------------------------------------------------------------ */

/**
 * `changes` → строки таблицы.
 *
 * Порядок — фиксированный словарь полей (`order`), затем незнакомые поля по
 * алфавиту: так одна и та же запись всегда выглядит одинаково, чего `jsonb` сам
 * не гарантирует.
 */
export function formatActivityChanges(
  changes: readonly HistoryFieldChange[],
  order?: readonly string[],
): ActivityChange[] {
  // `changes` — `jsonb`: перед итерацией проверяем форму. Поле, которого нет
  // или которое записано не массивом, означает пустую таблицу, а не падение
  // всей ленты.
  if (!Array.isArray(changes)) return [];

  const rankOf = (field: string) => {
    const at = order?.indexOf(field) ?? -1;
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };

  return [...changes]
    // Строка без имени поля бессмысленна: показывать «— : было → стало» хуже,
    // чем не показывать строку вовсе. Проверка на объект — вторая линия после
    // проверки массива: элемент `jsonb`-массива тоже может быть чем угодно.
    .filter(
      (change): change is HistoryFieldChange =>
        typeof change === "object" &&
        change !== null &&
        typeof (change as HistoryFieldChange).field === "string",
    )
    .sort((a, b) => {
      const byOrder = rankOf(a.field) - rankOf(b.field);
      if (byOrder !== 0) return byOrder;
      return a.field < b.field ? -1 : a.field > b.field ? 1 : 0;
    })
    .map((change) => ({
      field: change.field,
      label: activityFieldLabel(change.field),
      from: formatActivityValue(change.field, change.from),
      to: formatActivityValue(change.field, change.to),
    }));
}

/* ------------------------------------------------------------------ */
/*  События: 21 вид                                                    */
/* ------------------------------------------------------------------ */

/**
 * Размер групповой операции из payload'а события.
 *
 * Поля `batch` / `batch_size` есть только у части видов событий (те, что
 * пишутся групповой операцией), поэтому проверка идёт оператором `in`: он
 * сужает объединение до payload'ов с этими полями, и приведений типов не
 * требуется. `batch_size > 1` — единственный случай, когда подпись нужна:
 * групповая операция из одной позиции неотличима от одиночного действия.
 */
function batchSizeOf(payload: object): number | undefined {
  if (!("batch_size" in payload)) return undefined;
  const { batch_size: size } = payload;
  return typeof size === "number" && size > 1 ? size : undefined;
}

function formatEvent(record: HistoryEventEntry): ActivityPresentation {
  const batchSize = batchSizeOf(record.payload);

  switch (record.kind) {
    case "created": {
      const origin = createOriginLabel(record.payload.origin);
      return {
        batchSize,
        icon: "created",
        title: origin ? `Создано · ${origin}` : "Создано",
        detail: { code: record.payload.code, name: orEmpty(record.payload.name) },
      };
    }

    case "filled": {
      const origin = fillOriginLabel(record.payload.origin);
      return {
        batchSize,
        icon: "wand",
        title: origin ? `Заполнено · ${origin}` : "Заполнено",
        detail: { code: record.payload.code, name: orEmpty(record.payload.name) },
      };
    }

    case "cleared":
      return {
        batchSize,
        icon: "eraser",
        title: "Очищено",
        detail: { code: record.payload.code, name: orEmpty(record.payload.name) },
      };

    case "removed":
      return {
        batchSize,
        icon: "trash",
        title: "Удалено",
        detail: { code: record.payload.code, name: orEmpty(record.payload.name) },
      };

    case "restored":
      return {
        batchSize,
        icon: "restore",
        title: "Восстановлено",
        detail: { code: record.payload.code, name: orEmpty(record.payload.name) },
      };

    case "code_changed":
      return {
        batchSize,
        icon: "hash",
        title: `Марка: ${orEmpty(record.payload.from)} → ${orEmpty(record.payload.to)}`,
      };

    case "status_changed":
      return {
        batchSize,
        icon: "status",
        title: `Статус: ${statusLabel(record.payload.from, record.payload.fromLabel)} → ${statusLabel(
          record.payload.to,
          record.payload.toLabel,
        )}`,
      };

    case "price_changed":
      return {
        batchSize,
        icon: "price",
        title: `Цена: ${formatActivityValue("price", record.payload.from, EMPTY_VALUE)} → ${formatActivityValue(
          "price",
          record.payload.to,
          EMPTY_VALUE,
        )}`,
      };

    case "quantity_changed": {
      const unit = record.payload.unit ? ` ${record.payload.unit}` : "";
      const from = formatActivityValue("qty", record.payload.from, EMPTY_VALUE);
      const to = formatActivityValue("qty", record.payload.to, EMPTY_VALUE);
      return {
        batchSize,
        icon: "quantity",
        title: `Количество: ${from}${unit} → ${to}${unit}`,
      };
    }

    case "supplier_changed":
      return {
        batchSize,
        icon: "supplier",
        title: `Поставщик: ${supplierText(record.payload.from)} → ${supplierText(record.payload.to)}`,
      };

    case "details_changed":
      return {
        batchSize,
        icon: "details",
        title: "Изменены параметры",
        changes: formatActivityChanges(
          record.payload.changes,
          DETAIL_FIELD_ORDER,
        ),
      };

    case "parent_changed":
      return {
        batchSize,
        icon: "parent",
        title: `Расположение: ${parentText(record.payload.from)} → ${parentText(record.payload.to)}`,
      };

    case "variant_added":
      return {
        batchSize,
        icon: "variantAdd",
        title: "Добавлен вариант",
        detail: { name: orEmpty(record.payload.label) },
      };

    case "variant_switched":
      return {
        batchSize,
        icon: "variantSwitch",
        title: `Активный вариант: ${variantText(record.payload.from)} → ${variantText(record.payload.to)}`,
      };

    case "variant_updated":
      return {
        batchSize,
        icon: "variantEdit",
        title: "Изменён вариант",
        changes: formatActivityChanges(
          record.payload.changes,
          VARIANT_FIELD_ORDER,
        ),
      };

    case "variant_removed": {
      const next = record.payload.nextActive;
      return {
        batchSize,
        icon: "variantRemove",
        title: next
          ? `Удалён вариант · активным стал ${orEmpty(next.name)}`
          : "Удалён вариант",
        detail: { name: orEmpty(record.payload.name ?? record.payload.label) },
      };
    }

    case "component_added":
      return {
        batchSize,
        icon: "componentAdd",
        title: "Добавлено в состав",
        ...compositionDetail(record.payload),
      };

    case "component_removed":
      return {
        batchSize,
        icon: "componentRemove",
        title: "Удалено из состава",
        ...compositionDetail(record.payload),
      };

    case "service_added":
      return {
        batchSize,
        icon: "serviceAdd",
        title: "Добавлена услуга",
        detail: serviceDetail(record.payload),
      };

    case "service_completed":
      return {
        batchSize,
        icon: "serviceDone",
        title: "Выполнена услуга",
        detail: serviceDetail(record.payload),
      };

    case "service_removed":
      return {
        batchSize,
        icon: "serviceRemove",
        title: "Удалена услуга",
        detail: serviceDetail(record.payload),
      };
  }

  // Недостижимо для известных `kind`: сюда попадает только событие, которого
  // нет в доменном объединении (например, из более новой версии приложения).
  return null as never;
}

/** Поставщик: компания и менеджер; пустой снимок — `—`. */
function supplierText(snapshot: {
  company_name: string | null;
  contact_name: string | null;
} | null): string {
  if (!snapshot) return EMPTY_VALUE;
  const parts = [snapshot.company_name, snapshot.contact_name].filter(
    (part): part is string => Boolean(part && part.length > 0),
  );
  return parts.length > 0 ? parts.join(" · ") : EMPTY_VALUE;
}

/** Родитель: «М-01 · Кухня» или `—`. */
function parentText(
  ref: { code: string | null; name: string | null } | null,
): string {
  if (!ref) return EMPTY_VALUE;
  return refText(ref) ?? EMPTY_VALUE;
}

/** Снимок варианта: название, иначе `—`. */
function variantText(ref: { name: string | null } | null): string {
  if (!ref) return EMPTY_VALUE;
  return ref.name?.trim() || EMPTY_VALUE;
}

/** Строка состава: у ссылки подпись в `ref`, у компонента — в `name`. */
function compositionDetail(payload: {
  name: string | null;
  ref: { code: string | null; name: string | null } | null;
}): Pick<ActivityPresentation, "detail"> {
  if (payload.ref) {
    const ref = refText(payload.ref);
    return { detail: { name: ref ?? EMPTY_VALUE } };
  }
  return { detail: { name: payload.name?.trim() || EMPTY_VALUE } };
}

/** Сервисная операция: подпись и сумма, если она есть в payload'е. */
function serviceDetail(payload: HistoryServicePayload): {
  name: string;
} {
  const label = serviceLabel(payload) ?? EMPTY_VALUE;
  return {
    name:
      typeof payload.amount === "number" && Number.isFinite(payload.amount)
        ? `${label} · ${formatActivityValue("amount", payload.amount, EMPTY_VALUE)} ₽`
        : label,
  };
}

/**
 * Событие → то, что показывает UI. `null` — запись неизвестного вида: она
 * пропускается, а не отображается догадкой.
 */
export function formatActivityEvent(
  record: ActivityRecord,
): ActivityPresentation | null {
  if (record.source !== "event") return null;
  return formatEvent(record) ?? null;
}

/* ------------------------------------------------------------------ */
/*  Автор                                                              */
/* ------------------------------------------------------------------ */

/**
 * Подпись автора из снимка записи.
 *
 * Имя берётся только из `actor_name_snapshot`: пользователя могли переименовать
 * или удалить (`actor_id` тогда `null`, но имя в снимке остаётся). Текущий
 * профиль для восстановления исторического имени не читается.
 */
export function formatActivityActor(actor: {
  id: string | null;
  name: string | null;
}): { name: string; initials: string | null } {
  const name = actor.name?.trim();
  if (!name) return { name: EMPTY_VALUE, initials: null };
  return { name, initials: activityInitials(name) };
}

/**
 * Инициалы из имени: первая буква первого и последнего слова.
 *
 * Отдельная чистая функция, а не поле контракта: `HistoryActor` инициалов не
 * несёт, и добавлять их в доменный тип ради отображения нельзя.
 */
export function activityInitials(name: string): string | null {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return null;

  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toLocaleUpperCase("ru-RU");
}

/* ------------------------------------------------------------------ */
/*  Дата и время                                                       */
/* ------------------------------------------------------------------ */

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});
const DATE_FORMAT_WITH_YEAR = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
/** `hourCycle: "h23"` — «14:03», без AM/PM. */
const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Календарный день локального времени: по нему группируется лента. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Подпись дня: «Сегодня», «Вчера», «25 сентября».
 *
 * `now` — параметр, а не `new Date()` внутри: иначе функция была бы нечистой и
 * её нельзя было бы проверить тестом.
 */
export function formatActivityDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;

  if (dayKey(date) === dayKey(now)) return "Сегодня";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return "Вчера";

  return date.getFullYear() === now.getFullYear()
    ? DATE_FORMAT.format(date)
    : DATE_FORMAT_WITH_YEAR.format(date);
}

/** Время записи: «14:03». */
export function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return TIME_FORMAT.format(date);
}

/** Дата и время вместе: «25 сентября, 14:03» — для строки автора. */
export function formatActivityDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return `${formatActivityDate(iso, now)}, ${formatActivityTime(iso)}`;
}

/* ------------------------------------------------------------------ */
/*  Batch                                                              */
/* ------------------------------------------------------------------ */

/**
 * Размер групповой операции из payload'а записи.
 *
 * `null` — подпись не нужна: одиночное действие (`batch` не выставлен) или
 * операция из одной позиции (`batchSize <= 1`).
 */
export function activityBatchSize(record: ActivityRecord): number | null {
  if (record.source === "event") {
    return formatActivityEvent(record)?.batchSize ?? null;
  }
  // У комментариев групповых операций не бывает.
  return null;
}

/** Подпись chip'а групповой операции: «групповая операция · 12 позиций». */
export function formatActivityBatch(size: number): string {
  return `групповая операция · ${size} ${plural(size, "позиция", "позиции", "позиций")}`;
}

/** Склонение по числу. Локальная копия `plural` из `lib/utils.ts`: тот модуль
 * тянет за собой `SpecItem` и константы UI, а форматтеру нужна одна строка —
 * и он обязан оставаться пригодным для unit-тестов без окружения Next.
 */
export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && !(b >= 12 && b <= 14)) return few;
  return many;
}
