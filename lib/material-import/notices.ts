/**
 * Человекочитаемые замечания к импортированному черновику.
 *
 * Между конвейером и UI есть слой перевода: конвейер говорит техническим языком
 * (`warnings`, `ambiguous`, `requiresReview`, коды отказа), пользователю нужны
 * короткие понятные фразы без внутренних кодов.
 *
 * Функция чистая, поэтому проверяется unit-тестами, а компонент только рисует
 * готовый список.
 *
 * Важное правило: значения берём ТОЛЬКО из черновика. Если в `ambiguous` нет
 * значений, показываем одно имя поля, но ничего не додумываем.
 */

import type { MaterialImportDraft } from "./draft";
import type { MaterialImportResult } from "../../actions/material-import";

/** Степень важности: влияет на цвет блока, но НЕ блокирует сохранение. */
export type NoticeTone = "warning" | "info";

export type ImportNotice = {
  /** Короткая понятная фраза. */
  message: string;
  /** Что сделать — необязательное уточнение. */
  hint?: string;
  tone: NoticeTone;
};

/** Понятные подписи для полей, о которых сообщает черновик. */
const FIELD_LABELS: Record<string, string> = {
  name: "наименование",
  brand: "бренд",
  article: "артикул",
  category: "категория",
  productType: "тип товара",
  product_type: "тип товара",
  price: "цена",
  unit: "единица измерения",
  imageUrl: "изображение",
};

/**
 * Заголовок замечания по спорному полю.
 *
 * Отдельные формулировки, потому что подставить имя поля в один шаблон
 * грамматически не выходит: «определить характеристика «Толщина»» — не по-русски.
 */
function ambiguityHeadline(field: string): string {
  if (field.startsWith("attrs.")) {
    // Имя характеристики приводим к нижнему регистру: в предложении оно
    // цитируется, а не стоит в начале.
    const name = field.slice("attrs.".length);
    return `Проверьте характеристику «${name.toLowerCase()}».`;
  }

  const label = FIELD_LABELS[field] ?? field;
  return `Не удалось однозначно определить ${label}.`;
}

/**
 * Человекочитаемая причина неоднозначности.
 *
 * Коды причин приходят из нормализации (`retailer-id`, `variant-specific-ai`,
 * `no-url-signal`, `multiple-url-matches`) и наружу в таком виде не идут.
 */
function ambiguityReason(reason: string): string {
  switch (reason) {
    case "retailer-id":
      return "на странице есть только код магазина, а не артикул производителя";
    case "variant-specific-ai":
      return "характеристика относится к конкретному варианту товара";
    case "no-url-signal":
      return "на странице несколько вариантов, и ссылка не указывает нужный";
    case "multiple-url-matches":
      return "ссылка подходит сразу к нескольким вариантам";
    default:
      return "значение определилось неоднозначно";
  }
}

/**
 * Собирает список замечаний для показа над формой.
 *
 * Порядок: сначала то, что требует решения (спорные значения), затем общие
 * предупреждения конвейера, затем мягкая подсказка о проверке.
 */
export function buildImportNotices(
  draft: MaterialImportDraft,
  options: { imageRehosted?: boolean } = {},
): ImportNotice[] {
  const notices: ImportNotice[] = [];
  const seen = new Set<string>();

  const push = (notice: ImportNotice) => {
    const key = `${notice.tone}|${notice.message}|${notice.hint ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    notices.push(notice);
  };

  /* ── Спорные поля: самое важное для пользователя ── */
  for (const item of draft.ambiguous) {
    // Значения показываем, только если они реально есть в черновике.
    const values = item.values.filter((value) => value.trim().length > 0);
    const examples = values.slice(0, 3).join(", ");
    const more = values.length > 3 ? ` и ещё ${values.length - 3}` : "";

    push({
      tone: "warning",
      message: ambiguityHeadline(item.field),
      hint:
        values.length > 0
          ? `Варианты на странице: ${examples}${more}. ${ambiguityReason(item.reason)}.`
          : `${ambiguityReason(item.reason)}. Проверьте значение вручную.`,
    });
  }

  /* ── Изображение ── */
  if (draft.imageUrl === null && options.imageRehosted === false) {
    push({
      tone: "info",
      message: "Изображение не удалось импортировать.",
      hint: "Материал можно сохранить без изображения и добавить его позже.",
    });
  }

  /* ── Мягкая подсказка ── */
  if (draft.requiresReview && notices.length === 0) {
    push({
      tone: "info",
      message: "Проверьте данные перед сохранением.",
      hint: "Импорт заполнил форму автоматически — часть полей могла остаться пустой.",
    });
  }

  return notices;
}

/**
 * Замечания из результата экшена: предупреждения конвейера плюс разбор
 * неоднозначностей. Отдельная функция, потому что `warnings` живут в результате,
 * а не в черновике.
 */
export function buildImportNoticesFromResult(
  result: MaterialImportResult,
): ImportNotice[] {
  const notices = buildImportNotices(result.draft, {
    imageRehosted: result.imageRehosted,
  });
  const seen = new Set(notices.map((notice) => notice.message));

  for (const warning of result.warnings) {
    const message = warning.trim();
    if (!message || seen.has(message)) continue;
    seen.add(message);
    notices.push({ tone: "warning", message });
  }

  return notices;
}

/* ------------------------------------------------------------------ */
/*  Состояние окна проверки                                            */
/* ------------------------------------------------------------------ */

/**
 * Что нужно существующему `MaterialDialog`, чтобы показать импорт.
 *
 * `draftKey` берётся из результата, а не из URL: повторный импорт той же ссылки
 * после правок обязан сбросить форму заново, поэтому ключ не может быть
 * адресом страницы.
 */
export type ImportReviewState = {
  draft: MaterialImportDraft;
  draftKey: string;
  notices: ImportNotice[];
  imageRehosted: boolean;
};

/**
 * Превращает успешный результат импорта в состояние окна проверки.
 *
 * Чистая функция: UI-компонент только кладёт результат в состояние, а всё
 * содержимое окна (черновик, ключ сброса, замечания) собирается здесь и
 * проверяется тестами.
 */
export function createImportReviewState(result: MaterialImportResult): ImportReviewState {
  return {
    draft: result.draft,
    draftKey: result.draftKey,
    notices: buildImportNoticesFromResult(result),
    imageRehosted: result.imageRehosted,
  };
}
