/**
 * Разрешение вариантов товара.
 *
 * Проблема, которую решает модуль: одна страница часто описывает НЕСКОЛЬКО SKU
 * одного дизайна (разные породы, толщины, ширины, селекции). Характеристики
 * этих SKU нельзя смешивать в один материал — иначе в библиотеку уедет
 * «инженерная доска» с толщиной от одного артикула, а шириной от другого.
 *
 * Правило: характеристики варианта применяются только тогда, когда вариант
 * определён ОДНОЗНАЧНО. Если однозначности нет, берём лишь общие
 * характеристики товара, а спорные значения не подставляем вовсе и помечаем
 * draft как требующий проверки. Отсутствие значения человек исправит за пару
 * секунд; перепутанные характеристики он не заметит никогда.
 *
 * Сигналы однозначности (по убыванию надёжности):
 *   1. SKU варианта встречается в URL (путь или query);
 *   2. артикул страницы из JSON-LD совпадает со SKU варианта;
 *   3. в URL присутствуют значения вариант-специфичных характеристик.
 */

import type { RawVariant } from "./draft";
import { collapseWhitespace, cleanValue } from "./text";

export type VariantSource =
  | "url-sku"
  | "page-article"
  | "url-attributes"
  | "variant-label";

export type AmbiguousVariantField = {
  field: string;
  /** Различные значения, встреченные у вариантов. */
  values: string[];
};

export type VariantResolution =
  | {
      ok: true;
      /** Индекс выбранного варианта в исходном массиве; `null` — вариант не нужен. */
      variantIndex: number | null;
      source: VariantSource | null;
      attributes: Record<string, string>;
      /** Артикул выбранного варианта (для вариантов — его SKU). */
      article: string | null;
      price: number | null;
      currency: string | null;
      imageUrl: string | null;
      unit: string | null;
    }
  | {
      ok: false;
      attributes: Record<string, string>;
      article: string | null;
      price: number | null;
      currency: string | null;
      imageUrl: string | null;
      unit: string | null;
      /** Поля, значения которых различаются между вариантами. */
      ambiguous: AmbiguousVariantField[];
      reason: string[];
    };

export type ProductLevelFields = {
  article: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  unit?: string | null;
};

export type ResolveVariantInput = {
  /** Фактический URL страницы (после редиректов). */
  pageUrl: string;
  variants: readonly RawVariant[];
  /** Характеристики товара в целом — они общие для всех вариантов. */
  productAttributes: Record<string, string>;
  product: ProductLevelFields;
  /**
   * Подпись открытого варианта, предложенная моделью. Учитывается как
   * дополнительный сигнал, но только когда сама модель пометила его как
   * уверенный: иначе это была бы та же догадка, от которой мы уходим.
   */
  variantLabel?: string | null;
  /** Характеристики, которые модель отнесла к варианту, но не связала с открытым. */
  ambiguousAttributes?: Record<string, string>;
};

/** Сравнение подписи варианта: без регистра, пробелов и разделителей. */
function comparableLabel(value: string): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[\s_\-–—|·,/]+/g, "");
}

/**
 * Сопоставляет подпись от модели с вариантами.
 *
 * Требуем точного совпадения с подписью, именем или SKU варианта (после
 * нормализации): частичное совпадение здесь опаснее пропуска — именно так
 * «Дуб 13 мм» могло бы склеиться с «Дуб 13.5 мм».
 */
function variantsByLabel(
  variants: readonly RawVariant[],
  label: string | null | undefined,
): number[] {
  const needle = label ? comparableLabel(label) : "";
  if (needle.length < 2) return [];

  const matches: number[] = [];
  variants.forEach((variant, index) => {
    const candidates = [variant.label, variant.name, variant.sku]
      .filter((value): value is string => Boolean(value))
      .map(comparableLabel);
    if (candidates.some((candidate) => candidate.length > 0 && candidate === needle)) {
      matches.push(index);
    }
  });
  return matches;
}

/** Приводит артикул к сравнимому виду: без пробелов, дефисов и регистра. */
export function normalizeSku(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\s_\-.]+/g, "").toUpperCase();
  return cleaned.length >= 2 ? cleaned : null;
}

/** Текст URL для поиска сигналов: путь + query, в нижнем регистре. */
function searchableUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    return decodeURIComponent(`${url.pathname}?${url.search}`).toLowerCase();
  } catch {
    return pageUrl.toLowerCase();
  }
}

/**
 * Отдельные значения query-параметров, декодированные по правилам форм.
 *
 * Зачем в дополнение к `searchableUrl`: `URL` кодирует пробел как `+`, и
 * `?thickness=20+мм` в склеенной строке не содержит подстроки «20 мм».
 * `URLSearchParams` раскрывает `+` обратно в пробел, поэтому значения
 * параметров сравниваются корректно. Саму строку при этом тоже проверяем —
 * значение может быть зашито в путь (`/product/дуб-натуральный`).
 */
function queryValues(pageUrl: string): string[] {
  try {
    const url = new URL(pageUrl);
    const values: string[] = [];
    for (const [, value] of url.searchParams) {
      const clean = collapseWhitespace(value).toLowerCase();
      if (clean) values.push(clean);
    }
    return values;
  } catch {
    return [];
  }
}

/** Значение нормализовано для сравнения с URL: нижний регистр, без разделителей. */
function comparableValue(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

/**
 * Ищет значение варианта в URL.
 *
 * Токен ограничиваем не-алфанумерикой, чтобы «240» не совпало с «2400», а
 * «дуб» — с «дубрава». В класс границ добавлены `+` и `%`: нелатинские значения
 * приходят процентными последовательностями, поэтому без этого `?color=Дуб`
 * не находился бы.
 *
 * Минимальная длина — один символ: значения вариантов часто короткие
 * (`S`/`M`/`L`, `2`/`3`), и отбрасывать их значило бы терять однозначность.
 * От ложных срабатываний защищает правило «должны совпасть отличительные
 * значения варианта», а не длина отдельного значения.
 */
function valuePresentInUrl(
  value: string,
  haystack: string,
  urlValues: readonly string[],
): boolean {
  const needle = comparableValue(value);
  if (!needle) return false;

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = "[^\\p{L}\\p{N}+%]";
  const re = new RegExp(`(^|${boundary})${escaped}(${boundary}|$)`, "u");

  if (re.test(haystack)) return true;

  // Значения query-параметров сравниваем отдельно: там пробелы уже раскрыты
  // из `+`, поэтому «20 мм» совпадает с `?thickness=20+мм`.
  return urlValues.some((candidate) => {
    if (candidate === needle) return true;
    const candidateRe = new RegExp(`(^|${boundary})${escaped}(${boundary}|$)`, "u");
    return candidateRe.test(candidate);
  });
}

/**
 * Характеристики, значения которых РАЗЛИЧАЮТСЯ между вариантами.
 * Общие свойства (например, «материал: керамогранит») сюда не попадают и
 * поэтому никогда не помечаются спорными.
 */
export function variantSpecificFields(
  variants: readonly RawVariant[],
): Map<string, string[]> {
  const valuesByField = new Map<string, Set<string>>();

  for (const variant of variants) {
    for (const [field, value] of Object.entries(variant.attributes ?? {})) {
      const clean = cleanValue(value, 200);
      if (!clean) continue;
      const bucket = valuesByField.get(field) ?? new Set<string>();
      bucket.add(comparableValue(clean));
      valuesByField.set(field, bucket);
    }
  }

  const specific = new Map<string, string[]>();
  for (const [field, values] of valuesByField) {
    if (values.size > 1) {
      specific.set(field, [...values].sort((a, b) => a.localeCompare(b, "ru")));
    }
  }
  return specific;
}

/**
 * Характеристики, по которым ИМЕННО этот вариант сопоставляется с URL.
 *
 * Если `specific` пуст (у вариантов нет различающихся общих полей — например,
 * каждый вариант описывает свой уникальный набор свойств), берём все
 * характеристики варианта: иначе сопоставлять было бы не с чем и мы бы
 * отказались от данных, которые на самом деле различимы. Требование «все
 * значения должны найтись в URL» защищает от ложных совпадений и в этом случае.
 */
function distinguishingFields(
  variant: RawVariant,
  specific: Map<string, string[]>,
): string[] {
  const keys = Object.keys(variant.attributes ?? {});
  if (specific.size > 0) return keys.filter((field) => specific.has(field));
  return keys;
}

/** Значения поля у конкретного варианта, приведённые к исходному написанию. */
function fieldsToDrop(
  variants: readonly RawVariant[],
  specific: Map<string, string[]>,
): Map<number, string[]> {
  const drop = new Map<number, string[]>();
  variants.forEach((variant, index) => {
    const fields = distinguishingFields(variant, specific);
    if (fields.length > 0) drop.set(index, fields);
  });
  return drop;
}

/**
 * Разрешает вариант товара по URL и артикулу страницы.
 */
export function resolveVariant(input: ResolveVariantInput): VariantResolution {
  const { variants, productAttributes, product, pageUrl } = input;
  const productLevel = {
    article: product.article,
    price: product.price,
    currency: product.currency,
    imageUrl: product.imageUrl,
    unit: product.unit ?? null,
  };

  // Вариантов нет — страница описывает один товар, спорить не о чем.
  if (variants.length === 0) {
    return {
      ok: true,
      variantIndex: null,
      source: null,
      attributes: { ...productAttributes },
      ...productLevel,
    };
  }

  const haystack = searchableUrl(pageUrl);
  const urlValues = queryValues(pageUrl);
  const specific = variantSpecificFields(variants);

  /* ── Сигнал 1: SKU варианта в URL ── */
  const skuMatches: number[] = [];
  variants.forEach((variant, index) => {
    const sku = normalizeSku(variant.sku);
    if (sku && valuePresentInUrl(sku, haystack, urlValues)) skuMatches.push(index);
  });

  /* ── Сигнал 2: артикул страницы совпал со SKU ── */
  if (skuMatches.length === 0) {
    const pageArticle = normalizeSku(product.article);
    if (pageArticle) {
      variants.forEach((variant, index) => {
        if (normalizeSku(variant.sku) === pageArticle) skuMatches.push(index);
      });
      if (skuMatches.length > 0) {
        return applyVariant(skuMatches[0], "page-article", variants, productAttributes, productLevel);
      }
    }
  } else if (skuMatches.length === 1) {
    return applyVariant(skuMatches[0], "url-sku", variants, productAttributes, productLevel);
  }

  /* ── Сигнал 3: подпись варианта от модели ── */
  if (skuMatches.length === 0) {
    const labelMatches = variantsByLabel(variants, input.variantLabel);
    if (labelMatches.length === 1) {
      return applyVariant(
        labelMatches[0],
        "variant-label",
        variants,
        productAttributes,
        productLevel,
      );
    }
    if (labelMatches.length > 1) {
      return ambiguousResult(variants, productAttributes, productLevel, specific, [
        "multiple-url-matches",
      ]);
    }
  }

  /* ── Сигнал 4: значения вариант-специфичных характеристик в URL ── */
  if (skuMatches.length === 0) {
    const drop = fieldsToDrop(variants, specific);
    const attributeMatches: number[] = [];

    // Все встречающиеся у вариантов значения по каждому отличительному полю:
    // нужны, чтобы понять, «занято» ли это измерение в URL ДРУГИМ вариантом.
    const valuesOfField = new Map<string, Set<string>>();
    for (const variant of variants) {
      for (const [field, value] of Object.entries(variant.attributes ?? {})) {
        const set = valuesOfField.get(field) ?? new Set<string>();
        set.add(comparableValue(value));
        valuesOfField.set(field, set);
      }
    }

    variants.forEach((variant, index) => {
      const distinguishing = drop.get(index) ?? [];
      if (distinguishing.length === 0) return;

      let matched = 0;
      for (const field of distinguishing) {
        const own = comparableValue(variant.attributes[field] ?? "");
        if (!own) continue;

        // Измерение «занято» в URL, если там встречается значение ЛЮБОГО из
        // вариантов по этому полю.
        const isSpecifiedInUrl = [...(valuesOfField.get(field) ?? [])].some((candidate) =>
          valuePresentInUrl(candidate, haystack, urlValues),
        );
        if (!isSpecifiedInUrl) continue;

        // URL задаёт это измерение, но не нашим значением — вариант не подходит.
        // Именно эта проверка не даёт склеить толщину одного SKU с шириной другого.
        if (!valuePresentInUrl(own, haystack, urlValues)) return;

        matched += 1;
      }

      // Хотя бы одно отличительное значение должно подтвердиться: иначе вариант
      // «подошёл» бы по полному отсутствию сигналов, и все варианты совпали бы.
      if (matched > 0) attributeMatches.push(index);
    });

    if (attributeMatches.length === 1) {
      return applyVariant(
        attributeMatches[0],
        "url-attributes",
        variants,
        productAttributes,
        productLevel,
      );
    }

    if (attributeMatches.length > 1) {
      return ambiguousResult(
        variants,
        productAttributes,
        productLevel,
        specific,
        ["multiple-url-matches"],
      );
    }

    return ambiguousResult(variants, productAttributes, productLevel, specific, [
      "no-url-signal",
    ]);
  }

  return ambiguousResult(variants, productAttributes, productLevel, specific, [
    "multiple-url-matches",
  ]);
}

/** Вариант определён однозначно: его характеристики перекрывают товарные. */
function applyVariant(
  index: number,
  source: VariantSource,
  variants: readonly RawVariant[],
  productAttributes: Record<string, string>,
  productLevel: {
    article: string | null;
    price: number | null;
    currency: string | null;
    imageUrl: string | null;
    unit: string | null;
  },
): VariantResolution {
  const variant = variants[index];

  return {
    ok: true,
    variantIndex: index,
    source,
    // Товарные характеристики первыми, вариантными перекрываем: у варианта
    // значение точнее.
    attributes: { ...productAttributes, ...(variant.attributes ?? {}) },
    article: variant.sku ?? productLevel.article,
    price: variant.price ?? productLevel.price,
    currency: variant.currency ?? productLevel.currency,
    imageUrl: variant.imageUrl ?? productLevel.imageUrl,
    unit: productLevel.unit,
  };
}

/** Вариант не определён: отдаём только общее, спорное — в отчёт. */
function ambiguousResult(
  variants: readonly RawVariant[],
  productAttributes: Record<string, string>,
  productLevel: {
    article: string | null;
    price: number | null;
    currency: string | null;
    imageUrl: string | null;
    unit: string | null;
  },
  specific: Map<string, string[]>,
  reason: string[],
): VariantResolution {
  // Артикул и цену вариантов не подставляем: они почти наверняка относятся к
  // конкретному варианту. Артикул страницы в JSON-LD в такой ситуации тоже
  // ненадёжен — он принадлежит одному из вариантов, и мы не знаем какому.
  const ambiguous: AmbiguousVariantField[] = [...specific.entries()].map(
    ([field, values]) => ({ field, values: values.sort() }),
  );

  return {
    ok: false,
    attributes: { ...productAttributes },
    article: null,
    price: null,
    currency: null,
    imageUrl: productLevel.imageUrl,
    unit: productLevel.unit,
    ambiguous,
    reason,
  };
}
