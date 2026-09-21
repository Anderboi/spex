/**
 * Контракт импортёра: `MaterialImportDraft` и схемы его валидации.
 *
 * Чем draft отличается от `MaterialInput`:
 *
 *  * `MaterialInput` (`lib/validations.ts`) — контракт СОХРАНЕНИЯ. Он строгий:
 *    `name` обязателен, `attrs` — плоский словарь строк, `category` уже выбрана.
 *  * `MaterialImportDraft` — результат ИЗВЛЕЧЕНИЯ. Значения могут отсутствовать,
 *    быть неточными или спорными, а рядом лежит техническое evidence: откуда
 *    взято поле и какой фрагмент страницы это подтверждает.
 *
 * Draft никогда не пишется в базу. Его единственная задача — стать initial
 * values существующей формы (`MaterialDialog`) и быть полезным для отладки.
 */

import { z } from "zod";
import { TYPE_ORDER } from "../constants";

/* ------------------------------------------------------------------ */
/*  Источник значения                                                  */
/* ------------------------------------------------------------------ */

export const FIELD_SOURCES = ["json-ld", "og", "html", "jina", "ai"] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

/**
 * Откуда взято конкретное значение. Это техническое evidence для отладки, а не
 * «уверенность модели»: мы не просим LLM самооцениваться, а фиксируем, какой
 * слой конвейера дал значение и чем оно подтверждено.
 */
export type FieldEvidence = {
  field: string;
  value: string;
  source: FieldSource;
  /** Фрагмент-подтверждение: строка страницы, JSON-LD-сниппет, ответ модели. */
  evidence?: string;
};

/* ------------------------------------------------------------------ */
/*  Draft                                                              */
/* ------------------------------------------------------------------ */

/** Причина, по которой набор характеристик варианта не был применён. */
export const VARIANT_AMBIGUITY_REASONS = [
  /** У страницы несколько вариантов, и указанный URL не выделяет один. */
  "url-matches-nothing",
  /** URL выделил больше одного варианта (например, совпал по общему атрибуту). */
  "multiple-url-matches",
  /** Вариантов несколько, но URL не несёт никаких признаков варианта. */
  "no-url-signal",
] as const;
export type VariantAmbiguityReason = (typeof VARIANT_AMBIGUITY_REASONS)[number];

export type AmbiguousField = {
  field: string;
  /** Значения, встреченные у разных вариантов: «есть 190 / 240». */
  values: string[];
  reason: string;
};

/**
 * Черновик материала после извлечения и нормализации.
 *
 * Все поля, кроме `sourceUrl`, необязательны: отсутствие значения — нормальный
 * результат, а не ошибка. `productUrl` всегда равен `sourceUrl`: исходная
 * ссылка попадает в материал автоматически и остаётся редактируемой в форме.
 */
export type MaterialImportDraft = {
  /** URL, с которого начался импорт (канонизированный). */
  sourceUrl: string;
  /** Фактический URL после редиректов — он же идёт в `product_url`. */
  productUrl: string;
  name: string | null;
  brand: string | null;
  article: string | null;
  /** Приведена к одному из `TYPE_ORDER` либо `null`. */
  category: string | null;
  /** Свободный тип внутри категории (может не совпадать с пресетами). */
  productType: string | null;
  /** Только RUB. `null` — цена неизвестна, «по запросу» или в другой валюте. */
  price: number | null;
  /** Валюта исходной страницы — для предпросмотра, в материал не попадает. */
  priceCurrency: string | null;
  /** Значение из `UNIT_OPTIONS` либо `null`; форма подставит своё по умолчанию. */
  unit: string | null;
  imageUrl: string | null;
  /** Категорийные характеристики — то, что уходит в `materials.attrs`. */
  attrs: Record<string, string>;
  /** Что пришлось решить неточно. */
  ambiguous: AmbiguousField[];
  /** Нужна проверка человеком (спорный вариант, отсутствие ключевых полей). */
  requiresReview: boolean;
  /** Техническое evidence по полям — для отладки и будущего UI. */
  evidence: FieldEvidence[];
  /** Слои конвейера, которые реально дали данные. */
  usedSources: FieldSource[];
};

/* ------------------------------------------------------------------ */
/*  Zod-схемы                                                          */
/* ------------------------------------------------------------------ */

/** Общие лимиты. Совпадают с ограничениями `materialSchema`, где это важно. */
export const ATTRS_MAX_KEYS = 40;
export const ATTR_VALUE_MAX = 500;

const nullishString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null));

/**
 * Схема ответа LLM-адаптера (`RawExtractedProduct`). Отдельная от `MaterialImportDraft`:
 * модель отдаёт сырые значения и свободные названия, а приведение к словарям
 * проекта (`TYPE_ORDER`, `UNIT_OPTIONS`, RUB) делает нормализация — так граница
 * с моделью остаётся простой и проверяемой.
 */
export const rawVariantSchema = z.object({
  sku: nullishString(120),
  name: nullishString(300),
  /** Значения характеристик именно этого варианта. */
  attributes: z
    .record(z.string().max(80), z.string().max(ATTR_VALUE_MAX))
    .default({}),
  price: z.number().min(0).max(1_000_000_000).nullish().transform((v) => v ?? null),
  currency: nullishString(8),
  imageUrl: nullishString(1_000),
  productUrl: nullishString(2_048),
  /**
   * Подпись варианта так, как её видит человек в выпадающем списке
   * («Дуб · 13 мм · 140 мм»). Нужна как дополнительный сигнал сопоставления:
   * в URL такие подписи часто попадают целиком или по частям.
   */
  label: nullishString(300),
});

/**
 * Список «уже выбранных» категорий из ответа модели приводим к закрытому
 * словарю проекта.
 *
 * `catch` вместо отказа: значение, которого нет в `TYPE_ORDER`, не должно
 * ронять всё извлечение — остальные поля ответа полезны. Непонятная категория
 * превращается в `null`, и нормализация подберёт её эвристикой по названию и
 * заголовку. Так инвариант «в базу попадает только `TYPE_ORDER`» сохраняется,
 * а один плохой ответ модели не обнуляет черновик.
 */
const categorySchema = z
  .enum(TYPE_ORDER as unknown as [string, ...string[]])
  .nullish()
  .catch(null)
  .transform((value) => (value && value.length > 0 ? value : null));

export const rawExtractedProductSchema = z.object({
  name: nullishString(300),
  brand: nullishString(200),
  article: nullishString(120),
  /** Одно из `TYPE_ORDER` либо `null`. Свободный текст сюда не проходит. */
  category: categorySchema,
  /** Свободный текст: «Смеситель для раковины», «Инженерная доска». */
  productType: nullishString(120),
  price: z.number().min(0).max(1_000_000_000).nullish().transform((v) => v ?? null),
  currency: nullishString(8),
  unit: nullishString(20),
  imageUrl: nullishString(1_000),
  description: nullishString(2_000),
  /** Характеристики, общие для всех вариантов товара. */
  attributes: z
    .record(z.string().max(80), z.string().max(ATTR_VALUE_MAX))
    .default({}),
  variants: z.array(rawVariantSchema).max(60).default([]),
  /**
   * Торговый идентификатор площадки (артикул магазина), если он есть на
   * странице. Нужен ровно для одной проверки: не подменил ли им модель
   * артикул производителя (см. `rejectRetailerArticle`).
   */
  retailerId: nullishString(120),
  /**
   * Подпись варианта, который, по мнению модели, открыт на странице.
   * Не является истиной в последней инстанции: сопоставление с конкретным
   * вариантом делает детерминированный `resolveVariant`.
   */
  variantLabel: nullishString(300),
  /**
   * Характеристики, которые модель считает зависящими от варианта и не смогла
   * однозначно отнести к открытому варианту. Они НЕ попадают в `attrs`:
   * смешивать значения разных SKU запрещено.
   */
  ambiguousAttributes: z
    .record(z.string().max(80), z.string().max(ATTR_VALUE_MAX))
    .default({}),
});

export type RawVariant = z.infer<typeof rawVariantSchema>;
export type RawExtractedProduct = z.infer<typeof rawExtractedProductSchema>;

/**
 * Результат «детерминированного» слоя: JSON-LD + OpenGraph/meta + `<title>`.
 * Хранит provenance по каждому полю, чтобы слой слияния знал, чьё значение
 * приоритетнее, и чтобы evidence собирался без догадок.
 */
export type DeterministicExtractedProduct = {
  name: { value: string; source: FieldSource } | null;
  brand: { value: string; source: FieldSource } | null;
  article: { value: string; source: FieldSource } | null;
  price: { value: number; source: FieldSource } | null;
  currency: { value: string; source: FieldSource } | null;
  imageUrl: { value: string; source: FieldSource } | null;
  unit: { value: string; source: FieldSource } | null;
  description: { value: string; source: FieldSource } | null;
  attributes: { values: Record<string, string>; source: FieldSource } | null;
  variants: RawVariant[];
};

/**
 * Слитый результат всех слоёв извлечения: детерминированный слой плюс
 * (опционально) текст Jina и ответ LLM. Ключи, которых нет у LLM, остаются от
 * детерминированного слоя, поэтому «дополняем», а не «заменяем».
 */
export type ExtractedProduct = DeterministicExtractedProduct & {
  /** Ключ характеристики → источник, откуда пришло её значение. */
  attributeSources: Record<string, FieldSource>;
  /** Слои, которые реально отработали. */
  usedLayers: FieldSource[];
  /** Текст страницы для LLM: либо исходный HTML, либо очищенный Jina Reader. */
  textForModel: string | null;
  /**
   * Торговый идентификатор площадки. Хранится, чтобы отличить его от артикула
   * производителя и не пустить в `article`. Заполняет только слой LLM.
   */
  retailerId?: string | null;
  /** Подпись варианта, предложенная моделью (дополнительный сигнал). */
  variantLabel?: string | null;
  /**
   * Характеристики, которые модель отнесла к конкретному варианту, но не
   * смогла связать с открытым на странице. Используются двояко: как «не
   * добавлять в attrs» и как отчёт о неоднозначности.
   */
  ambiguousAttributes?: Record<string, string>;
  /**
   * Артикул, который модель предложила и который был отклонён как торговый
   * идентификатор площадки. Нужен, чтобы черновик мог сообщить о причине
   * пустого артикула, даже если JSON-LD потом дал настоящее значение.
   */
  rejectedArticleClaim?: string | null;
};
