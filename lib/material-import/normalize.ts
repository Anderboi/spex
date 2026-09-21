/**
 * Нормализация: сырое извлечение → `MaterialImportDraft`.
 *
 * Здесь заканчивается «что написано на странице» и начинается «что из этого
 * допустимо в нашей модели». Три правила, определяющие весь модуль:
 *
 *  1. **Словари проекта — закрытые.** `category` обязана стать одним из
 *     `TYPE_ORDER`; если сопоставить не удалось, категорию лучше не указывать
 *     вовсе — форму откроет значение по умолчанию, и человек его поправит.
 *  2. **Ничего не выдумываем.** `unit` — только из `UNIT_OPTIONS`; цена — только
 *     в рублях, иначе `null`; отсутствующее значение остаётся отсутствующим.
 *  3. **Варианты не смешиваются.** Характеристики разных SKU одной страницы
 *     нельзя склеивать в один материал (см. variants.ts).
 */

import { TYPE_PRESETS, UNIT_OPTIONS, type SpecType } from "../constants";
import {
  ATTRS_MAX_KEYS,
  ATTR_VALUE_MAX,
  type AmbiguousField,
  type FieldEvidence,
  type FieldSource,
  type MaterialImportDraft,
  type ExtractedProduct,
} from "./draft";
import { cleanValue } from "./text";
import { resolveVariant, type VariantResolution } from "./variants";

/* ------------------------------------------------------------------ */
/*  Категория и тип                                                    */
/* ------------------------------------------------------------------ */

/**
 * Ключевые слова для сопоставления свободного текста с категорией
 * спецификации. Порядок важен: специфичные категории идут раньше общих,
 * иначе «инженерная доска» попадёт в «Отделка» по слову «доска».
 *
 * Это эвристика для МVP, а не таксономия. Если LLM вернула категорию, её текст
 * проходит через те же правила, поэтому результат всегда предсказуем.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<{ category: SpecType; keywords: readonly string[] }> = [
  {
    category: "Освещение",
    keywords: ["люстр", "светильник", "бра", "торшер", " lamp", "light", "led", "подсветк", "трек", "спот"],
  },
  {
    category: "Сантехника",
    keywords: [
      // Ярлык самой категории: модель может вернуть «Сантехника» как есть.
      "сантехник",
      "смесител",
      "ванн",
      "душ",
      "унитаз",
      "биде",
      "раковин",
      "инсталляц",
      "полотенцесушител",
      "гигиеническ",
      "faucet",
      "tap",
      "shower",
      "basin",
      "toilet",
      "sink",
    ],
  },
  {
    category: "Электрика",
    keywords: [
      "розетк",
      "выключател",
      "автоматическ",
      "электрощит",
      "кабел",
      "провод",
      "socket",
      "outlet",
      "switch",
      "breaker",
    ],
  },
  {
    category: "Двери",
    keywords: ["двер", "портал", "door", "раздвижн"],
  },
  {
    category: "Инженерное оборудование",
    keywords: [
      "кондиционер",
      "вентиляц",
      "радиатор",
      "тёплый пол",
      "теплый пол",
      "водоподготовк",
      "котёл",
      "котел",
      "air condition",
      "ventilation",
      "boiler",
    ],
  },
  {
    category: "Оборудование",
    // Только точные слова: «техник» ловил «Сантехника» и уводил раздел
    // в «Оборудование». Сантехника уже отсечена правилом выше, но узкие
    // ключевые слова здесь надёжнее широких.
    keywords: [
      "бытов",
      "техника для",
      "appliance",
      "oven",
      "fridge",
      "hood",
      "dishwasher",
      "microwave",
    ],
  },
  {
    category: "Текстиль",
    keywords: ["штор", "тюль", "ковёр", "ковер", "обивк", "покрывал", "постельн", "curtain", "carpet", "fabric", "textile"],
  },
  {
    category: "Мебель",
    keywords: ["мебел", "диван", "стол", "стул", "кроват", "шкаф", "стеллаж", "кресл", "furniture", "sofa", "chair", "table", "wardrobe"],
  },
  {
    category: "Декор",
    keywords: ["декор", "картин", "постер", "ваза", "скульптур", "свеч", "растени", "зеркал", "decor", "vase", "painting", "mirror"],
  },
  {
    category: "Отделка",
    keywords: [
      "керамогранит",
      "плитк",
      "ламинат",
      "паркет",
      "доск",
      "обои",
      "краск",
      "штукатурк",
      "панел",
      "камен",
      "стекл",
      "мозаик",
      "tile",
      "flooring",
      "laminate",
      "parquet",
      "wallpaper",
      "paint",
      "plaster",
      "stone",
    ],
  },
];

export type CategoryMatch = { category: SpecType; keyword: string } | null;

/**
 * Сопоставляет свободный текст (категория от LLM, `<title>`, `og:type`,
 * URL-путь) с закрытым словарём `TYPE_ORDER`.
 *
 * Кандидаты проверяются ПО ОЧЕРЕДИ, и первый же давший совпадение побеждает.
 * Это принципиально: категория от модели считается авторитетнее заголовка
 * страницы, поэтому «Сантехника» из ответа LLM не должна проигрывать
 * «Керамогранит» из `<title>`, если склеить кандидатов в одну строку.
 *
 * Возвращает `null`, когда уверенного совпадения нет: неверная категория хуже
 * отсутствующей, потому что задаёт марку, группу спецификации и префикс кода.
 */
export function matchCategory(...candidates: Array<string | null | undefined>): CategoryMatch {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const haystack = candidate.toLowerCase();
    if (!haystack.trim()) continue;

    for (const entry of CATEGORY_KEYWORDS) {
      for (const keyword of entry.keywords) {
        if (haystack.includes(keyword)) {
          return { category: entry.category, keyword };
        }
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Единицы измерения                                                  */
/* ------------------------------------------------------------------ */

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  шт: "шт",
  штук: "шт",
  штука: "шт",
  pcs: "шт",
  pc: "шт",
  piece: "шт",
  unit: "шт",
  компл: "компл.",
  комплект: "компл.",
  set: "компл.",
  kit: "компл.",
  пара: "пара",
  pair: "пара",
  м2: "м²",
  "м²": "м²",
  "м.кв": "м²",
  "м. кв.": "м²",
  m2: "м²",
  sqm: "м²",
  "sq m": "м²",
  м: "м",
  "м.п": "м.п.",
  "м.п.": "м.п.",
  погонный: "м.п.",
  "погонный метр": "м.п.",
  "погонных метров": "м.п.",
  lm: "м.п.",
  "linear m": "м.п.",
  м3: "м³",
  "м³": "м³",
  m3: "м³",
  кг: "кг",
  kg: "кг",
  л: "л",
  l: "л",
  litre: "л",
  liter: "л",
  рулон: "рулон",
  roll: "рулон",
  лист: "лист",
  sheet: "лист",
  короб: "короб",
  box: "короб",
  carton: "короб",
};

/**
 * Сводит типографские варианты записи к простым символам: `м²` → `м2`, `м³` → `м3`.
 * Без этого «m²» (латинская m со степенью) не совпадал с ключом «m2», хотя
 * обозначает то же самое.
 */
function foldUnitKey(value: string): string {
  return value.replace(/²/g, "2").replace(/³/g, "3").replace(/\.$/, "").trim();
}

/**
 * Приводит единицу измерения к `UNIT_OPTIONS`.
 *
 * `null` означает «единица неизвестна» — и это нормальный результат. Форма
 * подставит своё значение по умолчанию (`шт`), но само извлечение единицу не
 * выдумывает: «1 200 ₽ / м²» и «1 200 ₽ / шт» — разные товары.
 */
export function normalizeUnit(raw: string | null | undefined): string | null {
  const cleaned = cleanValue(raw, 20);
  if (!cleaned) return null;

  const key = cleaned.toLowerCase().replace(/\s+/g, " ").trim();

  // Сначала точное совпадение (в том числе «м²» и «м.п.» как есть), затем —
  // свёрнутая запись, затем — без завершающей точки.
  const direct = UNIT_ALIASES[key];
  if (direct) return direct;

  const folded = UNIT_ALIASES[foldUnitKey(key)];
  if (folded) return folded;

  const withoutDot = UNIT_ALIASES[key.replace(/\.$/, "")];
  if (withoutDot) return withoutDot;

  // Точное совпадение с допустимым значением — тоже валидный исход.
  const candidates = [key, foldUnitKey(key)];
  const exact = (UNIT_OPTIONS as readonly string[]).find((option) =>
    candidates.includes(option.toLowerCase()) ||
    candidates.includes(foldUnitKey(option.toLowerCase())),
  );
  return exact ?? null;
}

/* ------------------------------------------------------------------ */
/*  Цена                                                               */
/* ------------------------------------------------------------------ */

/** Валюты, которые можно считать рублями без конвертации. */
const RUB_CURRENCIES = new Set(["RUB", "RUR", "₽", "РУБ"]);

export type NormalizedPrice =
  | { price: number; currency: string }
  | { price: null; currency: string | null; reason: "missing" | "foreign-currency" };

/**
 * Определяет цену для материала.
 *
 * Конвертации валют в MVP нет, поэтому цена в чужой валюте сознательно
 * превращается в «неизвестно»: подставить число как рубли значило бы соврать в
 * спецификации. Валюта при этом сохраняется в draft — она нужна предпросмотру.
 */
export function normalizePrice(
  rawPrice: number | null,
  rawCurrency: string | null,
): NormalizedPrice {
  if (rawPrice === null || !Number.isFinite(rawPrice) || rawPrice < 0) {
    return { price: null, currency: rawCurrency, reason: "missing" };
  }

  const currency = rawCurrency ? rawCurrency.trim().toUpperCase() : null;
  if (currency === null) {
    // Валюта не указана. Считаем рубли только если страница явно рубли не
    // объявила — иначе мы бы выдали иностранную цену за рублёвую.
    return { price: round2(rawPrice), currency: "RUB" };
  }
  if (RUB_CURRENCIES.has(currency)) {
    return { price: round2(rawPrice), currency: "RUB" };
  }
  return { price: null, currency, reason: "foreign-currency" };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ------------------------------------------------------------------ */
/*  Артикул производителя против идентификатора площадки               */
/* ------------------------------------------------------------------ */

/**
 * Приводит артикул к сравнимому виду: без разделителей и регистра.
 * Локальная копия правила из `variants.ts` — там оно нужно для сопоставления
 * с URL, здесь для сравнения двух значений между собой.
 */
function comparableArticle(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\s_\-.]+/g, "").toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

export type ArticleCheck = {
  /** Артикул, который можно записывать в материал. */
  article: string | null;
  /** Артикул отклонён как идентификатор площадки. */
  rejectedAsRetailerId: boolean;
};

/**
 * Не даёт торговому идентификатору площадки стать артикулом производителя.
 *
 * Требование этапа: retailer product ID сам по себе не должен попадать в
 * `article`. Проверка нужна потому, что модель может вернуть одно и то же
 * значение в обоих полях — тогда это наверняка код магазина, и в спецификацию
 * он попасть не должен: по нему нельзя заказать у производителя.
 *
 * Сравнение устойчиво к разделителям и регистру («686224» / «686-224»).
 */
export function rejectRetailerArticle(
  article: string | null | undefined,
  retailerId: string | null | undefined,
): ArticleCheck {
  const cleanArticle = cleanValue(article, 120);
  if (!cleanArticle) return { article: null, rejectedAsRetailerId: false };

  const a = comparableArticle(cleanArticle);
  const r = comparableArticle(retailerId);
  if (a && r && a === r) {
    return { article: null, rejectedAsRetailerId: true };
  }

  return { article: cleanArticle, rejectedAsRetailerId: false };
}

/* ------------------------------------------------------------------ */
/*  Тип товара                                                         */
/* ------------------------------------------------------------------ */

/**
 * Приводит тип товара к пресетам категории, когда это возможно.
 *
 * `TYPE_PRESETS` — справочник рекомендательный, поэтому свободное значение
 * допустимо и сохраняется как есть. Подменять его категорией магазина нельзя:
 * «Ванная комната» — не тип товара.
 */
export function normalizeProductType(
  raw: string | null | undefined,
  category: string | null,
): string | null {
  const cleaned = cleanValue(raw, 120);
  if (!cleaned) return null;

  const presets = category ? TYPE_PRESETS[category as SpecType] : undefined;
  if (!presets || presets.length === 0) return cleaned;

  const key = cleaned.toLowerCase();
  const exact = presets.find((preset) => preset.toLowerCase() === key);
  if (exact) return exact;

  // Пресет может быть частью значения («Смеситель для раковины» → «Смеситель»)
  // или наоборот. Совпадение по вхождению считаем достаточным, но требуем,
  // чтобы пресет НАЧИНАЛ слово в значении: иначе «Ванная комната» подходила бы
  // под пресет «Ванна», а «Рамка» — под «Рам».
  const contained = presets.find((preset) => {
    const p = preset.toLowerCase();
    if (p.length < 4) return false;

    if (key.includes(p)) {
      const at = key.indexOf(p);
      const after = key[at + p.length];
      // Пресет стоит в начале значения и не обрывается на середине слова.
      return at === 0 && (after === undefined || after === " " || after === ",");
    }

    // Обратный случай: значение короче пресета.
    return p.startsWith(key) && key.length >= 4;
  });

  return contained ?? cleaned;
}

/* ------------------------------------------------------------------ */
/*  Характеристики                                                     */
/* ------------------------------------------------------------------ */

/** Служебные ключи, которые не являются характеристиками товара. */
const NON_ATTRIBUTE_KEYS = new Set([
  "name",
  "description",
  "brand",
  "price",
  "currency",
  "sku",
  "mpn",
  "gtin",
  "url",
  "image",
  "category",
  "producttype",
  "unit",
  "availability",
  "rating",
  // Торговые/служебные узлы schema.org: в характеристики материала не годятся.
  "offers",
  "aggregaterating",
  "review",
  "potentialaction",
  "isvariantof",
  "hasvariant",
  "mainentityofpage",
  "additionalproperty",
]);

/**
 * Убирает служебные ключи, обрезает значения по лимиту `attrs` в `materialSchema`
 * и ограничивает количество характеристик. Плоский словарь и лимит 500 на
 * значение — это ограничение БД-контракта, а не вкусовщина: слишком длинное
 * значение не пройдёт сохранение.
 */
export function normalizeAttributes(
  raw: Record<string, string> | null | undefined,
): { attrs: Record<string, string>; truncated: string[] } {
  const attrs: Record<string, string> = {};
  const truncated: string[] = [];
  if (!raw) return { attrs, truncated };

  for (const [key, value] of Object.entries(raw)) {
    const cleanKey = cleanValue(key, 80);
    if (!cleanKey) continue;
    if (NON_ATTRIBUTE_KEYS.has(cleanKey.toLowerCase().replace(/[\s_-]/g, ""))) continue;

    const cleanValueText = cleanValue(value, ATTR_VALUE_MAX);
    if (!cleanValueText) continue;

    if (Object.keys(attrs).length >= ATTRS_MAX_KEYS) {
      truncated.push(cleanKey);
      continue;
    }

    if (value.length > ATTR_VALUE_MAX) truncated.push(cleanKey);
    attrs[cleanKey] = cleanValueText;
  }

  return { attrs, truncated };
}

/* ------------------------------------------------------------------ */
/*  Draft                                                              */
/* ------------------------------------------------------------------ */

export type NormalizeResult = {
  draft: MaterialImportDraft;
  /** Итог разрешения вариантов — нужен тестам и вызывающему коду. */
  variantResolution: VariantResolution;
  /** Замечания об усечении/отбрасывании данных. */
  warnings: string[];
};

export type NormalizeInput = {
  /** Канонизированный URL, который ввёл пользователь. */
  sourceUrl: string;
  /** Фактический URL после редиректов. */
  finalUrl: string;
  extracted: ExtractedProduct;
  /** Название страницы — участвует в определении категории. */
  pageTitle?: string | null;
};

/**
 * Собирает `MaterialImportDraft` из результата извлечения.
 *
 * Порядок важен: сначала разрешаются варианты (какие характеристики вообще
 * относятся к делу), и только потом формируются поля. Так характеристики
 * разных SKU не могут попасть в один материал.
 */
export function buildImportDraft(input: NormalizeInput): NormalizeResult {
  const { extracted } = input;
  const evidence: FieldEvidence[] = [];
  const warnings: string[] = [];

  const pushEvidence = (
    field: string,
    value: string | null | undefined,
    source: FieldSource,
    detail?: string,
  ) => {
    const clean = cleanValue(value, ATTR_VALUE_MAX);
    if (!clean) return;
    evidence.push({
      field,
      value: clean,
      source,
      evidence: cleanValue(detail ?? clean, ATTR_VALUE_MAX) ?? undefined,
    });
  };

  /* ── 1. Варианты ── */
  const productAttributes = extracted.attributes?.values ?? {};

  // Артикул площадки не должен становиться артикулом производителя. Заявку
  // модели уже отфильтровал `applyAiResult`; здесь проверяем итоговое значение
  // (оно могло прийти из JSON-LD) и фиксируем сам факт отклонения в отчёте.
  const articleCheck = rejectRetailerArticle(
    extracted.article?.value ?? null,
    extracted.retailerId,
  );
  const rejectedArticleClaim = extracted.rejectedArticleClaim ?? null;

  const resolution = resolveVariant({
    pageUrl: input.finalUrl,
    variants: extracted.variants,
    productAttributes,
    product: {
      article: articleCheck.article,
      price: extracted.price?.value ?? null,
      currency: extracted.currency?.value ?? null,
      imageUrl: extracted.imageUrl?.value ?? null,
    },
    variantLabel: extracted.variantLabel ?? null,
    ambiguousAttributes: extracted.ambiguousAttributes ?? {},
  });

  const ambiguous: AmbiguousField[] = resolution.ok
    ? []
    : resolution.ambiguous.map((item) => ({
        field: item.field,
        values: item.values,
        reason: resolution.reason[0] ?? "variant",
      }));

  if (articleCheck.rejectedAsRetailerId || rejectedArticleClaim) {
    // Фиксируем отказ в отчёте: пользователь должен понимать, почему артикул
    // пустой, хотя на странице число было.
    ambiguous.push({
      field: "article",
      values: rejectedArticleClaim ? [rejectedArticleClaim] : [],
      reason: "retailer-id",
    });
  }

  /* ── 2. Основные поля ── */
  const source = (value: { source: FieldSource } | null): FieldSource => value?.source ?? "html";

  const name = cleanValue(extracted.name?.value, 300);
  const brand = cleanValue(extracted.brand?.value, 200);
  const article = cleanValue(resolution.article, 120);

  pushEvidence("name", name, source(extracted.name));
  pushEvidence("brand", brand, source(extracted.brand), extracted.brand?.value ?? undefined);
  pushEvidence("article", article, extracted.article?.source ?? "html");

  /* ── 3. Категория ── */
  const categoryCandidates = [
    extracted.attributes?.values?.["category"],
    input.pageTitle,
    name,
    input.finalUrl,
  ];
  const categoryMatch = matchCategory(...categoryCandidates);
  if (categoryMatch) {
    pushEvidence(
      "category",
      categoryMatch.category,
      source(extracted.name),
      `совпадение по «${categoryMatch.keyword}»`,
    );
  } else {
    warnings.push(
      "Категорию спецификации определить не удалось — выберите её вручную.",
    );
  }

  // Тип товара: сначала нормализуем к пресетам выбранной категории, но
  // свободное значение сохраняем — справочник типов открытый.
  const productTypeRaw = extracted.attributes?.values?.["productType"] ?? null;
  const productType = normalizeProductType(
    productTypeRaw,
    categoryMatch?.category ?? null,
  );
  if (productType) pushEvidence("productType", productType, "ai");

  /* ── 4. Цена и единица ── */
  const normalizedPrice = normalizePrice(
    resolution.price,
    resolution.currency ?? extracted.currency?.value ?? null,
  );
  if (normalizedPrice.price !== null) {
    pushEvidence(
      "price",
      String(normalizedPrice.price),
      source(extracted.price),
      extracted.price ? String(extracted.price.value) : undefined,
    );
  } else if (normalizedPrice.reason === "foreign-currency") {
    warnings.push(
      `Цена указана в ${normalizedPrice.currency} — конвертации нет, цена не заполнена.`,
    );
  }

  const unit = normalizeUnit(extracted.unit?.value ?? resolution.unit);
  if (unit) pushEvidence("unit", unit, source(extracted.unit));

  /* ── 5. Характеристики ── */
  // Характеристики, которые модель отнесла к варианту, но не связала с открытым:
  // они не должны попасть в материал, иначе смешаются значения разных SKU.
  const variantSpecificKeys = new Set(
    Object.keys(extracted.ambiguousAttributes ?? {}).map((key) =>
      key.toLowerCase().replace(/[\s_-]/g, ""),
    ),
  );

  const attributesForMaterial: Record<string, string> = {};
  const withheldAttributes: string[] = [];
  for (const [key, value] of Object.entries(resolution.attributes)) {
    const normalisedKey = key.toLowerCase().replace(/[\s_-]/g, "");
    if (!resolution.ok && variantSpecificKeys.has(normalisedKey)) {
      withheldAttributes.push(key);
      continue;
    }
    attributesForMaterial[key] = value;
  }

  const { attrs, truncated } = normalizeAttributes(attributesForMaterial);
  for (const key of Object.keys(attrs)) {
    const attrSource = extracted.attributeSources?.[key] ?? extracted.attributes?.source ?? "html";
    pushEvidence(`attrs.${key}`, attrs[key], attrSource);
  }

  // Отчёт о спорных характеристиках: значения тоже показываем, чтобы человек
  // видел, из чего выбирать, но в материал они не идут.
  if (!resolution.ok) {
    for (const [key, value] of Object.entries(extracted.ambiguousAttributes ?? {})) {
      const clean = cleanValue(value, 200);
      if (!clean) continue;
      ambiguous.push({
        field: key,
        values: [clean],
        reason: "variant-specific-ai",
      });
    }
  }

  if (withheldAttributes.length > 0) {
    warnings.push(
      `Характеристики варианта не заполнены (${withheldAttributes.slice(0, 5).join(", ")}): ` +
        "на странице несколько вариантов, нужный определить не удалось.",
    );
  }
  if (truncated.length > 0) {
    warnings.push(
      `Не поместились характеристики (${truncated.length}): ${truncated.slice(0, 5).join(", ")}.`,
    );
  }

  /* ── 6. Изображение ── */
  const imageUrl = cleanValue(resolution.imageUrl, 1_000);
  if (imageUrl) pushEvidence("imageUrl", imageUrl, source(extracted.imageUrl));

  /* ── 7. Служебные признаки ── */
  const missingKeyFields: string[] = [];
  if (!name) missingKeyFields.push("наименование");
  if (!article) missingKeyFields.push("артикул");

  const requiresReview = !resolution.ok || !name;

  const draft: MaterialImportDraft = {
    sourceUrl: input.sourceUrl,
    productUrl: input.finalUrl,
    name,
    brand,
    article,
    category: categoryMatch?.category ?? null,
    productType,
    price: normalizedPrice.price,
    priceCurrency: normalizedPrice.currency,
    unit,
    imageUrl,
    attrs,
    ambiguous,
    requiresReview,
    evidence,
    usedSources: [...new Set(evidence.map((item) => item.source))],
  };

  if (!resolution.ok) {
    warnings.push(
      "У товара несколько вариантов, и определить нужный по ссылке не удалось: " +
        "характеристики варианта не заполнены, чтобы не смешать разные SKU.",
    );
  }
  if (missingKeyFields.length > 0) {
    warnings.push(`Проверьте вручную: ${missingKeyFields.join(", ")}.`);
  }

  return { draft, variantResolution: resolution, warnings };
}
