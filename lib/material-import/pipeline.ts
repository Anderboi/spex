/**
 * Конвейер импорта: URL → `MaterialImportDraft`.
 *
 * Порядок слоёв (каждый следующий вызывается только если предыдущий дал мало):
 *
 *   1. загрузка страницы с защитой от SSRF (`fetch.ts`);
 *   2. детерминированное извлечение: JSON-LD → OpenGraph/meta → `<title>`;
 *   3. внешний читатель страницы (`PageReader`) — Firecrawl — если
 *      детерминированный слой пуст или страница оказалась SPA-оболочкой;
 *   4. LLM (DeepSeek) для структурирования и классификации;
 *   5. Zod-валидация ответа модели;
 *   6. нормализация: словари проекта, единицы, цена, варианты;
 *   7. `MaterialImportDraft`;
 *   8. перехостинг изображения.
 *
 * Слои 1 и 6 обязательны. Слои 3, 4 и 8 — необязательные усилители: их отказ
 * никогда не отменяет импорт, а лишь попадает в `warnings`. Так импорт остаётся
 * работоспособным без ключа провайдера чтения и без ключа LLM.
 *
 * Конвейер не знает, какой именно провайдер читает страницу: он работает с
 * интерфейсом `PageReader`, а реализацию подставляет server action.
 *
 * Модуль НИЧЕГО не пишет в базу. Сохранение делает `upsertMaterial` после
 * подтверждения пользователя.
 */

import type { ExtractedProduct, FieldSource, MaterialImportDraft, RawExtractedProduct } from "./draft";
import { createDefaultExtractor, type AiExtractInput, type ProductDataExtractor } from "./ai";
import { extractFromHtml, looksLikeShell, type ExtractHtmlOptions } from "./extract-html";
import { fetchImportPage, type FetchFailureCode, type HostResolver } from "./fetch";
import { pickPrimaryImage, type ImageRehoster } from "./image";
import { buildPageTextBlock } from "./llm-input";
import { buildImportDraft, rejectRetailerArticle, type NormalizeResult } from "./normalize";
import { needsPageReaderFallback, type PageReader } from "./page-reader";
import { extractHtmlTitle } from "./text";
import type { DeterministicExtractedProduct } from "./draft";

/* ------------------------------------------------------------------ */
/*  Слияние слоёв                                                      */
/* ------------------------------------------------------------------ */

type Field<T> = { value: T; source: FieldSource } | null;

/** Первое непустое значение по приоритету слоёв. */
function pick<T>(...candidates: Array<Field<T> | undefined>): Field<T> {
  for (const candidate of candidates) {
    if (candidate && candidate.value !== null && candidate.value !== undefined) {
      return candidate;
    }
  }
  return null;
}

/**
 * Дополняет детерминированный результат данными внешнего читателя: у него
 * заполняются только те поля, которых не было. Значения первого слоя не
 * перетираются — JSON-LD точнее любого пересказа текста.
 */
export function mergeExtracted(
  base: DeterministicExtractedProduct | null,
  extra: DeterministicExtractedProduct | null,
): DeterministicExtractedProduct | null {
  if (!base) return extra;
  if (!extra) return base;

  const attributes = { ...(extra.attributes?.values ?? {}), ...(base.attributes?.values ?? {}) };
  const attributeSource: FieldSource =
    base.attributes?.source ?? extra.attributes?.source ?? "html";

  return {
    name: pick(base.name, extra.name),
    brand: pick(base.brand, extra.brand),
    article: pick(base.article, extra.article),
    price: pick(base.price, extra.price),
    currency: pick(base.currency, extra.currency),
    imageUrl: pick(base.imageUrl, extra.imageUrl),
    unit: pick(base.unit, extra.unit),
    description: pick(base.description, extra.description),
    attributes:
      Object.keys(attributes).length > 0
        ? { values: attributes, source: attributeSource }
        : null,
    variants: base.variants.length > 0 ? base.variants : extra.variants,
  };
}

/**
 * Приводит детерминированный результат к `ExtractedProduct`, добавляя
 * источники характеристик и решение о тексте для модели.
 */
export function toExtractedProduct(
  deterministic: DeterministicExtractedProduct | null,
  options: { modelText: string | null; usedLayers: FieldSource[]; attributeSources?: Record<string, FieldSource> },
): ExtractedProduct {
  const attributeSource = deterministic?.attributes?.source ?? "html";
  const attributeSources: Record<string, FieldSource> = { ...(options.attributeSources ?? {}) };
  for (const key of Object.keys(deterministic?.attributes?.values ?? {})) {
    attributeSources[key] ??= attributeSource;
  }

  return {
    name: deterministic?.name ?? null,
    brand: deterministic?.brand ?? null,
    article: deterministic?.article ?? null,
    price: deterministic?.price ?? null,
    currency: deterministic?.currency ?? null,
    imageUrl: deterministic?.imageUrl ?? null,
    unit: deterministic?.unit ?? null,
    description: deterministic?.description ?? null,
    attributes: deterministic?.attributes ?? null,
    variants: deterministic?.variants ?? [],
    attributeSources,
    usedLayers: options.usedLayers,
    textForModel: options.modelText,
    // Заполняются только слоем LLM: детерминированный слой про торговые
    // идентификаторы и варианты ничего не знает.
    retailerId: null,
    variantLabel: null,
    ambiguousAttributes: {},
    rejectedArticleClaim: null,
  };
}

/**
 * Накладывает ответ модели на извлечённое: модель уточняет и добавляет, но не
 * затирает уже найденное детерминированно.
 *
 * Принимаем `Partial<RawExtractedProduct>`: ключи схемы с `.default()` обязательны
 * в типе результата, но модель вправе их не прислать, и вызывающий код не
 * должен собирать полный объект ради вызова.
 *
 * Значения характеристик от модели приводятся к строкам: `attrs` в проекте —
 * плоский `Record<string, string>`, и числа/булевы значения туда попадать не
 * должны.
 */
export function applyAiResult(
  base: ExtractedProduct,
  ai: Partial<RawExtractedProduct>,
  source: FieldSource = "ai",
): { product: ExtractedProduct; rejectedAttributes: string[]; rejectedArticleClaim: string | null } {
  const aiAttributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(ai.attributes ?? {})) {
    const text = typeof value === "string" ? value : String(value ?? "");
    if (text.trim()) aiAttributes[key] = text.trim();
  }

  // Свободные категории и тип от модели кладём в те же слоты, что и meta-слой:
  // нормализация ожидает их именно там.
  if (ai.category) aiAttributes["category"] = ai.category;
  if (ai.productType) aiAttributes["productType"] = ai.productType;

  const mergedAttributes = { ...aiAttributes, ...(base.attributes?.values ?? {}) };
  const attributeSources: Record<string, FieldSource> = { ...base.attributeSources };
  for (const key of Object.keys(aiAttributes)) {
    // Детерминированный источник приоритетнее: если ключ уже пришёл из JSON-LD,
    // источник не переписываем.
    attributeSources[key] ??= source;
  }

  // Модель вернула артикул, совпадающий с торговым кодом площадки, — это не
  // артикул производителя. Отклоняем ЗАЯВКУ МОДЕЛИ, но не трогаем значение из
  // машинной разметки: JSON-LD надёжнее, и в нём может лежать настоящий артикул.
  const modelArticleVerdict = rejectRetailerArticle(ai.article ?? null, ai.retailerId ?? null);
  const modelArticle = modelArticleVerdict.rejectedAsRetailerId
    ? null
    : (ai.article ?? null);

  return {
    product: {
      ...base,
      name: base.name ?? (ai.name ? { value: ai.name, source } : null),
      brand: base.brand ?? (ai.brand ? { value: ai.brand, source } : null),
      article: base.article ?? (modelArticle ? { value: modelArticle, source } : null),
      price: base.price ?? (ai.price !== null && ai.price !== undefined ? { value: ai.price, source } : null),
      currency: base.currency ?? (ai.currency ? { value: ai.currency, source } : null),
      imageUrl: base.imageUrl ?? (ai.imageUrl ? { value: ai.imageUrl, source } : null),
      unit: base.unit ?? (ai.unit ? { value: ai.unit, source } : null),
      description: base.description ?? (ai.description ? { value: ai.description, source } : null),
      attributes:
        Object.keys(mergedAttributes).length > 0
          ? { values: mergedAttributes, source: base.attributes?.source ?? source }
          : null,
      // Варианты модели используем только если детерминированный слой их не нашёл.
      variants: base.variants.length > 0 ? base.variants : (ai.variants ?? []),
      attributeSources,
      usedLayers: [...new Set([...base.usedLayers, source])],
      // Торговый идентификатор площадки: нужен, чтобы не пустить его в article.
      retailerId: ai.retailerId ?? base.retailerId ?? null,
      variantLabel: ai.variantLabel ?? base.variantLabel ?? null,
      // Спорные характеристики от модели не добавляем к общим: они попадут в
      // отчёт о неоднозначности и будут исключены из attrs.
      ambiguousAttributes: {
        ...base.ambiguousAttributes,
        ...(ai.ambiguousAttributes ?? {}),
      },
      // Запоминаем сам факт отклонения, чтобы он попал в отчёт о черновике.
      rejectedArticleClaim: modelArticleVerdict.rejectedAsRetailerId
        ? (ai.article ?? null)
        : base.rejectedArticleClaim ?? null,
    },
    rejectedAttributes: [],
    rejectedArticleClaim: modelArticleVerdict.rejectedAsRetailerId ? (ai.article ?? null) : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Конвейер                                                           */
/* ------------------------------------------------------------------ */

export type ImportFailure = { code: FetchFailureCode; detail?: string; status?: number };

/** Итоговый результат конвейера. */
export type ImportPipelineResult =
  | {
      ok: true;
      draft: MaterialImportDraft;
      warnings: string[];
      /** Диагностика для логов: какие слои отработали. */
      layers: { deterministic: boolean; reader: boolean; ai: boolean };
      /** Изображение перенесено в Storage: `false` — картинки не будет. */
      imageRehosted: boolean;
    }
  | { ok: false; failure: ImportFailure };

export type ImportPipelineDeps = {
  /** Адаптер LLM. По умолчанию — DeepSeek, если задан `DEEPSEEK_API_KEY`. */
  extractor?: ProductDataExtractor;
  /**
   * Внешний читатель страницы (fallback). Провайдер выбирает вызывающий:
   * конвейер лишь пользуется интерфейсом. Без него шаг пропускается.
   */
  reader?: PageReader;
  /** Переопределить проверку хоста при загрузке страницы (тесты). */
  resolveHost?: HostResolver;
  /**
   * Перехостинг изображения. Подставляет server action (`rehostImage`):
   * конвейер сам не импортирует Supabase, чтобы оставаться проверяемым.
   * Без него изображение остаётся внешней ссылкой и в черновик не попадает.
   */
  rehostImage?: ImageRehoster;
  /** Организация-владелец: определяет папку в bucket'е. */
  orgId?: string;
  /** Принудительно выключить необязательные слои (тесты, отладка). */
  disableReader?: boolean;
  disableAi?: boolean;
};

/**
 * Полный проход конвейера. Единственная точка, которую вызывает server action.
 */
export async function runImportPipeline(
  rawUrl: string,
  deps: ImportPipelineDeps = {},
): Promise<ImportPipelineResult> {
  const warnings: string[] = [];

  /* ── 1. Загрузка ── */
  const fetched = await fetchImportPage(rawUrl, { resolveHost: deps.resolveHost });
  if (!fetched.ok) {
    return { ok: false, failure: { code: fetched.code, detail: fetched.detail, status: fetched.status } };
  }
  const { page } = fetched;

  /* ── 2. Детерминированный слой ── */
  // Если страница была обрезана по лимиту, работаем с первыми MAX_RESPONSE_BYTES
  // байтами: `<head>` с JSON-LD и OpenGraph почти всегда умещается в них.
  // Признак усечения нужен ниже, чтобы не считать «данных нет» окончательным.
  const isShell = looksLikeShell(page.html);
  const htmlOptions: ExtractHtmlOptions = { pageUrl: page.finalUrl, shell: isShell };
  let deterministic = extractFromHtml(page.html, htmlOptions);
  const pageTitle = isShell ? null : extractHtmlTitle(page.html);
  const layers = { deterministic: deterministic !== null, reader: false, ai: false };

  if (page.truncated) {
    // Пользователю — понятная фраза без внутренних кодов и размеров.
    warnings.push(
      "Страница оказалась очень большой — разобрана только её начальная часть. Проверьте заполненные поля.",
    );
  }

  /* ── 3. Внешний читатель страницы (fallback) ── */
  let modelText: string | null = null;
  const attributeSources: Record<string, FieldSource> = {};

  if (!deps.disableReader && deps.reader) {
    const wantsReader =
      isShell ||
      needsPageReaderFallback({
        name: deterministic?.name?.value ?? null,
        price: deterministic?.price?.value ?? null,
        article: deterministic?.article?.value ?? null,
        attributesCount: Object.keys(deterministic?.attributes?.values ?? {}).length,
        variantsCount: deterministic?.variants.length ?? 0,
        htmlBytes: page.bytes,
      });

    if (wantsReader) {
      // Читателю всегда уходит ИСХОДНЫЙ URL: он получает страницу целиком со
      // своей стороны, поэтому усечение нашего ответа ему не мешает.
      const read = await deps.reader.read(page.finalUrl);
      if (read.ok) {
        layers.reader = true;
        // Читатель отдаёт markdown: разбираем его тем же извлекателем, а если
        // он ничего не нашёл — оставляем текст для модели.
        const fromReader = extractFromHtml(read.content, htmlOptions);
        if (fromReader) {
          deterministic = mergeExtracted(deterministic, retagAsReader(fromReader));
        }
        modelText = read.content;
      } else {
        // Техническую причину — в серверный лог, пользователю общую фразу.
        console.error("[material-import] внешний читатель не отработал:", read.reason);
        warnings.push(
          "Не удалось получить очищенный текст страницы — часть полей могла остаться незаполненной.",
        );
      }
    }
  }

  if (modelText === null) {
    // Модели отдаём очищенный текст, а не разметку: скрипты, стили, меню и
    // cookie-плашки вырезаны, поэтому контекст дешевле и точнее.
    modelText = buildPageTextBlock(page.html);
  }

  let extracted = toExtractedProduct(deterministic, {
    modelText,
    usedLayers: [
      ...(layers.deterministic ? (["json-ld", "og", "html"] as FieldSource[]) : []),
      ...(layers.reader ? (["reader"] as FieldSource[]) : []),
    ],
    attributeSources,
  });

  /* ── 4-5. LLM + валидация ── */
  if (!deps.disableAi) {
    const extractor = deps.extractor ?? createDefaultExtractor();
    if (extractor.name !== "none") {
      const aiInput: AiExtractInput = {
        pageUrl: page.finalUrl,
        content: modelText,
        // Структурированные данные идут отдельным блоком: машинная разметка
        // надёжнее текста страницы, и модель должна видеть её отдельно.
        structured: {
          name: extracted.name?.value ?? null,
          brand: extracted.brand?.value ?? null,
          article: extracted.article?.value ?? null,
          price: extracted.price?.value ?? null,
          currency: extracted.currency?.value ?? null,
          unit: extracted.unit?.value ?? null,
          imageUrl: extracted.imageUrl?.value ?? null,
          description: extracted.description?.value ?? null,
          attributes: extracted.attributes?.values,
          variants: extracted.variants.map((variant) => ({
            sku: variant.sku,
            name: variant.name,
            label: variant.label ?? null,
            attributes: variant.attributes ?? {},
            price: variant.price,
            currency: variant.currency,
          })),
        },
        hints: {
          name: extracted.name?.value ?? null,
          brand: extracted.brand?.value ?? null,
          article: extracted.article?.value ?? null,
          price: extracted.price?.value ?? null,
          currency: extracted.currency?.value ?? null,
        },
      };

      try {
        const aiProduct = await extractor.extractProductData(aiInput);
        const applied = applyAiResult(extracted, aiProduct);
        extracted = applied.product;
        layers.ai = true;
      } catch (error) {
        // Техническую причину пишем в серверный лог: без неё отладку вести
        // нечем. Пользователю уходит только общая формулировка — ни ключей,
        // ни тел ответов, ни внутренних адресов.
        console.error(
          "[material-import] слой LLM не отработал:",
          error instanceof Error ? error.message : String(error),
        );
        warnings.push(
          "Не удалось уточнить данные через модель — заполнены только автоматически найденные поля.",
        );
      }
    } else if (!deps.disableAi) {
      warnings.push(
        "Модель не настроена (DEEPSEEK_API_KEY) — данные заполнены только автоматическим разбором страницы.",
      );
    }
  }

  /* ── 6-7. Нормализация ── */
  const normalized: NormalizeResult = buildImportDraft({
    sourceUrl: page.requestedUrl,
    finalUrl: page.finalUrl,
    extracted,
    pageTitle,
  });

  /* ── 8. Перехостинг изображения ── */
  // Делается последним и может отказать: импорт материала от этого не страдает.
  const imageUrlBeforeRehost = normalized.draft.imageUrl;
  const imageDraft = await maybeRehostImage({
    draft: normalized.draft,
    deps,
    warnings,
    deterministicImageUrl: extracted.imageUrl?.value ?? null,
    aiImageUrl: normalized.draft.imageUrl,
  });

  return {
    ok: true,
    draft: imageDraft,
    warnings: [...warnings, ...normalized.warnings],
    layers,
    // Отличаем «картинки не было» от «картинку не удалось перенести»:
    // в первом случае предупреждение не нужно.
    imageRehosted:
      imageDraft.imageUrl !== null &&
      (imageUrlBeforeRehost === null || imageDraft.imageUrl !== imageUrlBeforeRehost),
  };
}

/**
 * Переносит основное изображение в Supabase Storage.
 *
 * Тонкость: детерминированный `imageUrl` (JSON-LD/OG) идёт в черновик только
 * если у него разрешённая схема, поэтому в качестве кандидата «от модели»
 * используем то, что уже попало в draft. Приоритет: JSON-LD/OG → модель.
 *
 * Любой отказ приводит к `image_url = null` и предупреждению: внешнюю ссылку в
 * форму отдавать нельзя, текущий `next/image` её не отрисует.
 */
async function maybeRehostImage(input: {
  draft: MaterialImportDraft;
  deps: ImportPipelineDeps;
  warnings: string[];
  deterministicImageUrl: string | null;
  aiImageUrl: string | null;
}): Promise<MaterialImportDraft> {
  const { draft, deps, warnings } = input;

  const candidate = pickPrimaryImage({
    deterministicImageUrl: input.deterministicImageUrl,
    aiImageUrl: input.aiImageUrl,
  });

  if (candidate === null) {
    // Нечего переносить: либо картинки нет, либо она не http(s).
    return draft.imageUrl === null ? draft : { ...draft, imageUrl: null };
  }

  if (!deps.rehostImage || !deps.orgId) {
    // Перехостинг не подключён — внешнюю ссылку в черновик не кладём.
    return { ...draft, imageUrl: null };
  }

  const rehosted = await deps.rehostImage(candidate, {
    orgId: deps.orgId,
    resolveHost: deps.resolveHost,
  });

  if (!rehosted.ok) {
    console.error("[material-import] изображение не перенесено:", rehosted.code);
    warnings.push(
      "Не удалось сохранить изображение товара — добавьте его вручную при необходимости.",
    );
    return { ...draft, imageUrl: null };
  }

  return {
    ...draft,
    imageUrl: rehosted.url,
    evidence: [
      ...draft.evidence,
      {
        field: "imageUrl",
        value: rehosted.url,
        source: "html",
        evidence: `перенесено из ${candidate}`,
      },
    ],
  };
}

/**
 * Помечает источники полей как `reader`: значения пришли от внешнего читателя
 * страницы (а не из разметки исходного HTML), и в evidence это должно быть видно.
 */
function retagAsReader(extracted: DeterministicExtractedProduct): DeterministicExtractedProduct {
  const retag = <T,>(field: Field<T>): Field<T> =>
    field ? { value: field.value, source: "reader" } : null;

  return {
    name: retag(extracted.name),
    brand: retag(extracted.brand),
    article: retag(extracted.article),
    price: retag(extracted.price),
    currency: retag(extracted.currency),
    imageUrl: retag(extracted.imageUrl),
    unit: retag(extracted.unit),
    description: retag(extracted.description),
    attributes: extracted.attributes
      ? { values: extracted.attributes.values, source: "reader" }
      : null,
    variants: extracted.variants,
  };
}
