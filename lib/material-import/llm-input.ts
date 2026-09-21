/**
 * Подготовка входных данных для LLM.
 *
 * Две задачи, обе вытекают из требований к стоимости и качеству:
 *
 *  1. **Сократить контекст.** Отправлять в модель весь HTML бессмысленно и
 *     дорого: скрипты, стили, разметочный мусор, меню, баннеры cookie и блоки
 *     подвала не несут данных о товаре, но занимают большую часть страницы.
 *  2. **Разметить источники.** Детерминированный слой уже дал структурированные
 *     данные (JSON-LD и meta) — это самый надёжный источник, и модель должна
 *     видеть его отдельно, а не растворённым в тексте. Текстовое представление
 *     страницы идёт следом как fallback.
 *
 * Модуль только формирует текст. Никаких запросов и никакого состояния.
 */

/** Сколько символов «читаемого» текста страницы отдаём модели. */
export const PAGE_TEXT_MAX_CHARS = 12_000;

/** Минимальная длина строки, чтобы считаться содержимым, а не разметкой. */
const MIN_LINE_LENGTH = 2;

/**
 * Блоки, содержимое которых никогда не описывает товар. Вырезаются целиком
 * вместе с содержимым.
 */
const DROPPED_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "canvas",
  "form",
  "nav",
  "footer",
  "header",
  "aside",
  "dialog",
];

/**
 * Признаки служебных блоков (cookie-баннеры, подписки, корзины, реклама).
 * Ищем по атрибутам `class`/`id`: это эвристика, но она убирает основной шум.
 */
const BOILERPLATE_MARKERS = [
  "cookie",
  "consent",
  "gdpr",
  "privacy-policy",
  "newsletter",
  "subscribe",
  "breadcrumb",
  "breadcrumbs",
  "pagination",
  "pager",
  "menu",
  "navbar",
  "topbar",
  "sidebar",
  "modal",
  "popup",
  "banner",
  "advert",
  "ads-",
  "-ads",
  "promo",
  "tracking",
  "analytics",
  "social",
  "share",
  "reviews",
  "testimonial",
  "recommend",
  "related",
  "upsell",
  "cross-sell",
  "recently-viewed",
  "search-form",
  "cart",
  "basket",
  "checkout",
];

/** Вырезает элементы вместе с содержимым по имени тега. */
function dropElements(html: string, tags: readonly string[]): string {
  let out = html;
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    out = out.replace(re, " ");
    // Самозакрывающиеся и незакрытые варианты.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), " ");
  }
  return out;
}

/**
 * Вырезает блоки, у которых `class`/`id` похожи на служебные.
 *
 * Ограничиваемся одним уровнем вложенности (`[^<]*` внутри): этого достаточно
 * для cookie-плашек и меню, а рекурсивный разбор без настоящего парсера дал бы
 * больше ошибок, чем пользы.
 */
function dropBoilerplateBlocks(html: string): string {
  const marker = BOILERPLATE_MARKERS.map((m) =>
    m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");

  const attrBlock = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*(?:class|id)\\s*=\\s*("[^"]*(?:${marker})[^"]*"|'[^']*(?:${marker})[^']*')[^>]*>[\\s\\S]*?<\\/\\1>`,
    "gi",
  );

  return html.replace(attrBlock, " ");
}

/**
 * Приводит HTML к «читаемому» тексту, пригодному для модели.
 *
 * Это не полноценный readability-алгоритм: для MVP достаточно убрать явный
 * мусор и оставить строки, похожие на описание и характеристики.
 */
export function reduceHtmlForLlm(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, " ");
  out = dropElements(out, DROPPED_ELEMENTS);
  out = dropBoilerplateBlocks(out);

  // Блочные границы — в переводы строк, чтобы характеристики не слипались.
  out = out.replace(
    /<\/?(?:div|p|li|tr|td|th|h[1-6]|section|article|br|dt|dd|ul|ol|table|tbody|thead|span|a|strong|b|em|label)\b[^>]*>/gi,
    "\n",
  );
  out = out.replace(/<[^>]*>/g, " ");

  // Сущности раскрываем минимально: модели достаточно, а библиотеку тянуть незачем.
  out = out
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : " ";
    });

  const lines = out
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line) => line.length >= MIN_LINE_LENGTH);

  return dedupeConsecutive(lines).join("\n");
}

/**
 * Убирает подряд идущие одинаковые строки: в карточках товара один и тот же
 * блок часто повторяется несколько раз (мобильная и десктопная вёрстка).
 */
function dedupeConsecutive(lines: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const key = line.toLowerCase();
    // Повторы в пределах небольшого окна считаем дублями вёрстки.
    if (seen.has(key) && out.length > 0) continue;
    seen.add(key);
    out.push(line);
    if (seen.size > 4000) seen.clear();
  }

  return out;
}

/**
 * Готовит текстовый блок страницы для промпта с жёстким лимитом.
 * Обрезаем по границе строки, чтобы не порвать характеристику пополам.
 */
export function buildPageTextBlock(html: string, maxChars = PAGE_TEXT_MAX_CHARS): string {
  const text = reduceHtmlForLlm(html);
  if (text.length <= maxChars) return text;

  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf("\n");
  return lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak) : cut;
}

/* ------------------------------------------------------------------ */
/*  Структурированные источники                                        */
/* ------------------------------------------------------------------ */

/**
 * Компактное представление уже извлечённых структурированных данных.
 *
 * JSON-LD и OpenGraph — самый надёжный источник: это машинная разметка,
 * которую владелец сайта заполнил специально для роботов. Отдаём модели
 * отдельным блоком, чтобы она опиралась на него в первую очередь, а текст
 * страницы использовала для дополнения.
 */
export type StructuredHints = {
  name?: string | null;
  brand?: string | null;
  article?: string | null;
  price?: number | null;
  currency?: string | null;
  unit?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  attributes?: Record<string, string>;
  variants?: Array<{
    sku: string | null;
    name: string | null;
    label?: string | null;
    attributes: Record<string, string>;
    price: number | null;
    currency: string | null;
  }>;
};

/**
 * Сериализует структурированные подсказки. Пустые поля не включаем: «null» в
 * подсказках модель склонна воспринимать как «значение искать не нужно».
 */
export function serializeStructuredHints(hints: StructuredHints): string {
  const compact: Record<string, unknown> = {};

  for (const key of [
    "name",
    "brand",
    "article",
    "price",
    "currency",
    "unit",
    "imageUrl",
    "description",
  ] as const) {
    const value = hints[key];
    if (value !== null && value !== undefined && value !== "") {
      compact[key] = value;
    }
  }

  if (hints.attributes && Object.keys(hints.attributes).length > 0) {
    compact.attributes = hints.attributes;
  }

  if (hints.variants && hints.variants.length > 0) {
    compact.variants = hints.variants.map((variant) => ({
      sku: variant.sku,
      name: variant.name,
      label: variant.label ?? null,
      attributes: variant.attributes,
      price: variant.price,
      currency: variant.currency,
    }));
  }

  return JSON.stringify(compact, null, 1);
}
