/**
 * Детерминированный слой извлечения: JSON-LD, OpenGraph/meta, `<title>`.
 *
 * Это первый и самый дешёвый шаг конвейера — без сети (кроме самого документа),
 * без модели и без догадок. Если он дал достаточно данных, остальные слои
 * (внешний читатель, LLM) можно не звать.
 *
 * Приоритет внутри слоя: JSON-LD → OpenGraph → обычные meta → `<title>`.
 * JSON-LD структурирован по спецификации schema.org, поэтому ему верим больше,
 * чем `og:`-тегам, а `og:` — больше, чем «просто заголовку страницы».
 */

import {
  type DeterministicExtractedProduct,
  type FieldSource,
  type RawVariant,
} from "./draft";
import {
  attr,
  cleanValue,
  collectJsonLdScripts,
  collectMetaTags,
  extractHtmlTitle,
  metaContent,
  parseDecimal,
  stripHtmlToText,
} from "./text";

/* ------------------------------------------------------------------ */
/*  JSON-LD                                                            */
/* ------------------------------------------------------------------ */

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function typeListOf(node: JsonObject): string[] {
  return asArray(node["@type"])
    .map((t) => (typeof t === "string" ? t.toLowerCase() : ""))
    .filter(Boolean);
}

/**
 * Разворачивает JSON-LD в плоский список узлов: массив верхнего уровня,
 * `@graph`, вложенные `@graph`. Графы вложены неглубоко, поэтому обход
 * ограничен по глубине — защита от специально «глубокого» документа.
 */
function flattenJsonLd(value: unknown, depth = 0): JsonObject[] {
  if (depth > 6) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonLd(item, depth + 1));
  }
  if (!isObject(value)) return [];

  const out: JsonObject[] = [value];
  if ("@graph" in value) out.push(...flattenJsonLd(value["@graph"], depth + 1));
  return out;
}

/** Все разобранные JSON-LD-узлы документа. Битые скрипты молча пропускаем. */
export function parseJsonLdNodes(html: string): JsonObject[] {
  const nodes: JsonObject[] = [];

  for (const script of collectJsonLdScripts(html)) {
    const raw = script.raw.trim();
    if (!raw) continue;
    try {
      nodes.push(...flattenJsonLd(JSON.parse(raw)));
    } catch {
      // Невалидный JSON-LD — обычное дело на реальных сайтах (комментарии,
      // несколько объектов в одном теге). Это не ошибка импорта.
    }
  }

  return nodes;
}

/** Узел-товар: `Product` или его подтипы. */
function isProductNode(node: JsonObject): boolean {
  return typeListOf(node).some((t) => t === "product" || t.endsWith("/product"));
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return cleanValue(value, 500);
  if (typeof value === "number") return String(value);
  if (isObject(value)) return textOf(value["name"]);
  return null;
}

/** Значение `brand` бывает строкой, `Brand`, `Organization` или массивом. */
function brandOf(value: unknown): string | null {
  for (const item of asArray(value)) {
    const text = textOf(item);
    if (text) return text;
  }
  return null;
}

type OfferData = { price: number | null; currency: string | null };

/**
 * Цена из `offers`. Специально берём только первый `Offer`: если у товара
 * несколько предложений (разные продавцы), выбрать «правильное» нельзя, а
 * угадывать цену — хуже, чем не показать её вовсе.
 */
function offerOf(value: unknown): OfferData {
  const empty: OfferData = { price: null, currency: null };

  for (const item of asArray(value)) {
    if (!isObject(item)) continue;
    const types = typeListOf(item);
    if (types.length > 0 && !types.some((t) => t.includes("offer"))) continue;

    const price =
      parseDecimal(item["price"] as string | number | undefined) ??
      parseDecimal(item["lowPrice"] as string | number | undefined) ??
      null;
    const currency = typeof item["priceCurrency"] === "string" ? item["priceCurrency"].trim().toUpperCase() : null;

    if (price !== null || currency) {
      return { price, currency: currency || null };
    }
  }

  return empty;
}

/** Первая пригодная картинка: строка, `ImageObject` или массив таких. */
function imageOf(value: unknown): string | null {
  for (const item of asArray(value)) {
    if (typeof item === "string") {
      const url = cleanValue(item, 1_000);
      if (url) return url;
    } else if (isObject(item)) {
      const url = textOf(item["url"] ?? item["contentUrl"]);
      if (url) return url;
    }
  }
  return null;
}

/** Основной `Product`-узел: первый по документу. */
export function findProductNode(nodes: JsonObject[]): JsonObject | null {
  const withOffer = nodes.find((node) => isProductNode(node) && node["offers"] !== undefined);
  if (withOffer) return withOffer;
  return nodes.find(isProductNode) ?? null;
}

/* ------------------------------------------------------------------ */
/*  Варианты из JSON-LD                                                */
/* ------------------------------------------------------------------ */

/**
 * `hasVariant` / `isVariantOf` описывают варианты товара. Мы читаем только
 * `hasVariant`: это варианты «вниз» от родителя, и их характеристики не
 * смешиваются с характеристиками родителя.
 */
function variantsOf(node: JsonObject): RawVariant[] {
  const out: RawVariant[] = [];

  for (const item of asArray(node["hasVariant"])) {
    if (!isObject(item)) continue;
    const attributes = attributesOf(item);
    const offer = offerOf(item["offers"]);

    out.push({
      sku: textOf(item["sku"]) ?? textOf(item["mpn"]) ?? textOf(item["productID"]),
      name: textOf(item["name"]),
      attributes,
      price: offer.price,
      currency: offer.currency,
      imageUrl: imageOf(item["image"]),
      productUrl: typeof item["url"] === "string" ? cleanValue(item["url"], 2_048) : null,
      label: null,
    });
  }

  return out.filter(
    (variant) =>
      variant.sku !== null ||
      variant.name !== null ||
      Object.keys(variant.attributes).length > 0 ||
      variant.productUrl !== null,
  );
}

/**
 * Характеристики из дополнительных свойств schema.org. Ключи оставляем как есть
 * (обычно латиница: `material`, `color`) — нормализация приведёт их к
 * русскоязычным пресетам проекта.
 */
function attributesOf(node: JsonObject): Record<string, string> {
  const out: Record<string, string> = {};
  const skip = new Set([
    "@context",
    "@type",
    "@id",
    "name",
    "brand",
    "offers",
    "image",
    "url",
    "sku",
    "mpn",
    "description",
    "hasVariant",
    "isVariantOf",
    "aggregateRating",
    "review",
    "gtin",
    "gtin8",
    "gtin13",
    "gtin14",
  ]);

  for (const [key, value] of Object.entries(node)) {
    if (skip.has(key) || key.startsWith("@")) continue;
    const text = textOf(value);
    if (!text) continue;
    out[key] = text;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/*  HTML-слой                                                          */
/* ------------------------------------------------------------------ */

/** Абсолютизирует и проверяет картинку: только http(s), без мусора. */
function resolveImageUrl(raw: string | null, base: URL): string | null {
  const cleaned = cleanValue(raw, 1_000);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function firstString(tags: ReturnType<typeof collectMetaTags>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = metaContent(tags, key);
    if (value) return value;
  }
  return null;
}

/** `og:title` часто содержит «Название — Магазин»: отрезаем хвост бренда сайта. */
function stripSiteSuffix(name: string, siteName: string | null): string {
  if (!siteName) return name;
  const suffix = ` — ${siteName}`;
  const dashSuffix = ` - ${siteName}`;
  const pipeSuffix = ` | ${siteName}`;
  for (const candidate of [suffix, dashSuffix, pipeSuffix]) {
    if (name.toLowerCase().endsWith(candidate.toLowerCase())) {
      return name.slice(0, name.length - candidate.length).trim() || name;
    }
  }
  return name;
}

export type ExtractHtmlOptions = {
  /** Фактический URL страницы (после редиректов) — база для относительных ссылок. */
  pageUrl: string;
  /**
   * Страница — оболочка SPA без отрендеренного содержимого. В этом случае
   * `<title>` («Магазин», «Загрузка…») не считается названием товара: он
   * отравил бы поле и не дал бы читателю страницы его заполнить.
   */
  shell?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Определение «пустой оболочки»                                      */
/* ------------------------------------------------------------------ */

/** Признаки SPA-каркаса: контейнер приложения и бандл вместо разметки. */
const SHELL_MARKERS = [
  /<div[^>]+id=["'](?:app|root|__next|__nuxt)["'][^>]*>\s*<\/div>/i,
  /<script[^>]+type=["']module["']/i,
  /window\.__(?:NEXT_DATA|NUXT|INITIAL_STATE)__/i,
];

/**
 * Похожа ли страница на пустой каркас, которому нужен рендер.
 *
 * Нужна, чтобы отличить «сайт отдал нормальную карточку» от «сайт отдал
 * оболочку, а товар дорисовывает JavaScript». Во втором случае импорт обязан
 * идти дальше — во внешний читатель.
 */
export function looksLikeShell(html: string): boolean {
  if (visibleTextLength(html) >= 600) return false;

  const hasShellMarker = SHELL_MARKERS.some((re) => re.test(html));
  if (hasShellMarker) return true;

  // Совсем маленький документ без разметки товара — тоже каркас.
  return html.length < 512;
}

/**
 * Извлекает всё, что можно, без модели и без внешних сервисов.
 * Возвращает `null`, если страница не дала ни одного значимого поля.
 */
export function extractFromHtml(
  html: string,
  options: ExtractHtmlOptions,
): DeterministicExtractedProduct | null {
  let base: URL;
  try {
    base = new URL(options.pageUrl);
  } catch {
    return null;
  }

  const nodes = parseJsonLdNodes(html);
  const product = findProductNode(nodes);
  const tags = collectMetaTags(html);

  const from = (value: string | null, source: FieldSource) =>
    value ? { value, source } : null;

  /* ── JSON-LD ── */
  const ldName = product ? textOf(product["name"]) : null;
  const ldBrand = product ? brandOf(product["brand"]) : null;
  const ldArticle = product ? textOf(product["sku"] ?? product["mpn"] ?? product["productID"]) : null;
  const ldOffer = product ? offerOf(product["offers"]) : { price: null, currency: null };
  const ldImage = product ? imageOf(product["image"]) : null;
  const ldDescription = product ? textOf(product["description"]) : null;
  const ldAttrs = product ? attributesOf(product) : {};
  const ldVariants = product ? variantsOf(product) : [];

  /* ── HTML / OpenGraph ── */
  const ogSiteName = cleanValue(firstString(tags, ["og:site_name"]), 200);
  const ogTitle = cleanValue(firstString(tags, ["og:title"]), 400);
  const twitterTitle = cleanValue(firstString(tags, ["twitter:title"]), 400);
  // `<title>` у оболочки SPA — это название магазина, а не товара.
  const htmlTitle = options.shell ? null : extractHtmlTitle(html);

  const rawName = ldName ?? ogTitle ?? twitterTitle ?? htmlTitle;
  const name = rawName ? stripSiteSuffix(rawName, ogSiteName) : null;

  const ogImage = firstString(tags, [
    "og:image:secure_url",
    "og:image:url",
    "og:image",
    "twitter:image",
    "twitter:image:src",
  ]);
  const ogBrand = cleanValue(
    firstString(tags, ["product:brand", "og:brand", "brand"]),
    200,
  );
  const ogPrice =
    parseDecimal(firstString(tags, ["product:price:amount", "og:price:amount"])) ?? null;
  const ogCurrency = cleanValue(
    firstString(tags, ["product:price:currency", "og:price:currency"]),
    8,
  );
  const ogDescription = cleanValue(
    firstString(tags, ["og:description", "twitter:description", "description"]),
    2_000,
  );

  const attrs: Record<string, string> = { ...ldAttrs };
  // `product:category` из meta и `og:type` — свободный текст магазина. Своего
  // поля в `DeterministicExtractedProduct` у него нет, поэтому кладём в
  // характеристики: нормализация сама решит, куда отнести значение.
  const ogCategory = cleanValue(
    firstString(tags, ["product:category", "og:type"]),
    120,
  );
  if (ogCategory && !attrs["category"]) attrs["category"] = ogCategory;

  const attributeSource: FieldSource = Object.keys(ldAttrs).length > 0 ? "json-ld" : "html";

  // Описание — не характеристика материала, но полезный фрагмент evidence.
  const description = ldDescription ?? ogDescription;

  const imageUrl = resolveImageUrl(ldImage ?? ogImage, base);
  // Источник определяем по тому, откуда пришёл кандидат, а не по тому, удалось
  // ли его абсолютизировать.
  const imageSource: FieldSource = ldImage ? "json-ld" : "og";

  const result: DeterministicExtractedProduct = {
    name: from(name, ldName ? "json-ld" : ogTitle || twitterTitle ? "og" : "html"),
    brand: from(ldBrand ?? ogBrand, ldBrand ? "json-ld" : "og"),
    article: from(ldArticle, "json-ld"),
    price:
      ldOffer.price !== null
        ? { value: ldOffer.price, source: "json-ld" }
        : ogPrice !== null
          ? { value: ogPrice, source: "og" }
          : null,
    currency: from(ldOffer.currency ?? ogCurrency, ldOffer.currency ? "json-ld" : "og"),
    imageUrl: imageUrl ? { value: imageUrl, source: imageSource } : null,
    // Единицу измерения детерминированный слой не выдумывает: она либо есть в
    // JSON-LD как явное свойство, либо её определит нормализация/модель.
    unit: null,
    description: from(description, ldDescription ? "json-ld" : "og"),
    attributes: Object.keys(attrs).length > 0 ? { values: attrs, source: attributeSource } : null,
    variants: ldVariants,
  };

  const hasAnything =
    result.name !== null ||
    result.brand !== null ||
    result.article !== null ||
    result.price !== null ||
    result.imageUrl !== null ||
    result.attributes !== null ||
    result.variants.length > 0;

  if (!hasAnything) return null;

  return result;
}

/** Есть ли на странице хоть какой-то текст (для решения о fallback на читателя). */
export function visibleTextLength(html: string): number {
  return stripHtmlToText(html).length;
}

/** Ссылка на картинку товара в «ручном» HTML (`<link rel="image_src">`). */
export function imageLinkHref(html: string): string | null {
  const re = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const rel = attr(match[0], "rel")?.toLowerCase();
    if (rel === "image_src") return attr(match[0], "href");
  }
  return null;
}
