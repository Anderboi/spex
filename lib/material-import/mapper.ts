/**
 * `MaterialImportDraft` → начальные значения существующего `MaterialDialog`.
 *
 * Зачем отдельный mapper, а не прямое приведение к `MaterialInput`:
 *
 *  * `MaterialImportDraft` — результат ИЗВЛЕЧЕНИЯ. Значения могут отсутствовать,
 *    быть спорными, а рядом лежит evidence.
 *  * `MaterialInput` — контракт СОХРАНЕНИЯ. Он строгий: `name` обязателен,
 *    `category` выбрана, `price`/`unit`/`attrs` заполнены.
 *
 * Превращать draft в `MaterialInput` до того, как пользователь проверил и
 * поправил данные, значило бы выдать неуверенное извлечение за готовую запись.
 * Поэтому mapper отдаёт именно значения ФОРМЫ: те же поля с теми же дефолтами,
 * что и при обычном создании материала.
 *
 * Функция чистая: не ходит в Supabase, не зовёт server actions и модель, не
 * меняет draft и ничего не сохраняет.
 */

import { TYPE_ORDER, UNIT_OPTIONS, type SpecType } from "../constants";
import type { materialSchema } from "../validations";
import type { MaterialImportDraft } from "./draft";
import type { z } from "zod";

/**
 * Значения формы `MaterialDialog`.
 *
 * Совпадает с `z.input<typeof materialSchema>`, то есть с тем, что реально
 * принимает `useForm`: `price`, `unit` и `attrs` в форме всегда заполнены,
 * а `brand`/`article` — строки, а не `null`. Тип связан со схемой проверкой
 * совместимости ниже, поэтому расхождение с формой не останется незамеченным.
 */
export type MaterialFormValues = {
  id?: string;
  company_id: string | null;
  contact_id: string | null;
  name: string;
  brand: string;
  article: string;
  category: string;
  product_type: string | null;
  price: number;
  unit: string;
  image_url: string | null;
  product_url: string | null;
  attrs: Record<string, string>;
};

// Проверка на этапе компиляции: значения формы обязаны быть совместимы с тем,
// что принимает `MaterialDialog` (`z.input<typeof materialSchema>`). Если схема
// изменится, ошибка появится здесь, а не в рантайме у пользователя.
const _valuesMatchSchema = (
  values: MaterialFormValues,
): z.input<typeof materialSchema> => values;
void _valuesMatchSchema;

/** Дефолты формы — те же, что в `useForm({ defaultValues })` у `MaterialDialog`. */
export const MATERIAL_FORM_DEFAULTS = {
  category: TYPE_ORDER[0] || "Отделка",
  unit: "шт",
} as const;

/** Пустая строка вместо `null`: поля имени/бренда/артикула в форме текстовые. */
function text(value: string | null | undefined): string {
  return value ?? "";
}

/**
 * Собирает начальные значения формы из черновика импорта.
 *
 * Правила:
 *  * `category` — только из `TYPE_ORDER`; иначе дефолт формы (в базе не может
 *    оказаться категории, которой нет в словаре);
 *  * `product_type` — как есть, включая свободный текст: справочник типов в UI
 *    открытый;
 *  * `price` — `null` превращается в `0` («цена не указана»), как в форме.
 *    Валюта не конвертируется: если черновик не в рублях, цена уже пришла
 *    `null`, и мы не подставляем выдуманное число;
 *  * `unit` — только из черновика, иначе дефолт формы;
 *  * `image_url` — только Supabase URL после перехостинга; внешних ссылок здесь
 *    быть не может (см. `pickPrimaryImage` и шаг перехостинга в конвейере);
 *  * `company_id`/`contact_id` — не приходят из импортёра: поставщика
 *    пользователь выбирает в форме, поэтому здесь всегда `null`.
 */
export function materialImportDraftToFormValues(
  draft: MaterialImportDraft,
): MaterialFormValues {
  const category =
    draft.category && (TYPE_ORDER as readonly string[]).includes(draft.category)
      ? draft.category
      : MATERIAL_FORM_DEFAULTS.category;

  return {
    id: undefined,
    company_id: null,
    contact_id: null,
    name: text(draft.name),
    brand: text(draft.brand),
    article: text(draft.article),
    category,
    product_type: draft.productType,
    price: draft.price ?? 0,
    unit: draft.unit ?? MATERIAL_FORM_DEFAULTS.unit,
    image_url: draft.imageUrl,
    product_url: draft.productUrl,
    attrs: { ...draft.attrs },
  };
}

/* ------------------------------------------------------------------ */
/*  Начальные значения формы позиции спецификации (`ManualItemForm`)   */
/* ------------------------------------------------------------------ */

/**
 * Поля `ManualItemForm`, которые может дать импорт.
 *
 * Это ПОДМНОЖЕСТВО полей формы: количество, скидки, срок поставки, поставщика и
 * `saveToLibrary` импортёр не определяет — их задаёт пользователь, а форма
 * подставляет свои дефолты. Описания (`spec`) в черновике тоже нет: конвейер
 * его не сохраняет, поле останется пустым.
 *
 * Имена — как в форме (`type`/`productType`/`productUrl`), а не как в БД: тип
 * описывает ровно то, что принимает `ManualItemForm`, и конвертация живёт здесь,
 * а не в компоненте.
 */
export type ManualItemFormValues = {
  name: string;
  brand: string;
  article: string;
  /** Категория спецификации — уже приведена к `TYPE_ORDER`. */
  type: SpecType;
  /** Тип внутри категории: пресет или свободный текст. */
  productType: string;
  /** Единица из `UNIT_OPTIONS`; иначе дефолт формы. */
  unit: (typeof UNIT_OPTIONS)[number];
  price: number;
  /** Только URL из Storage после перехостинга — внешних ссылок здесь нет. */
  imageUrl: string | null;
  productUrl: string;
  attrs: Record<string, string>;
};

/**
 * Собирает начальные значения `ManualItemForm` из черновика импорта.
 *
 * Отличие от `materialImportDraftToFormValues` только в именах полей: правила
 * (категория — строго из `TYPE_ORDER`, `null`-цена — в `0`, отсутствующее
 * значение — дефолт формы) уже применены маппером библиотеки, и повторять их
 * здесь нельзя. Поэтому функция вызывает его, а не разбирает черновик заново.
 *
 * Неполный черновик — норма: чего импорт не нашёл, то форма покажет пустым и
 * пользователь заполнит сам.
 */
export function materialImportDraftToManualItemValues(
  draft: MaterialImportDraft,
): ManualItemFormValues {
  const mapped = materialImportDraftToFormValues(draft);

  // Единица измерения обязана быть из `UNIT_OPTIONS`: в форме это закрытый
  // `<select>`. Значение вне словаря — не повод падать, но и не повод показать
  // пустое поле: подставляем дефолт формы (как для категории).
  const unit = (UNIT_OPTIONS as readonly string[]).includes(mapped.unit)
    ? (mapped.unit as (typeof UNIT_OPTIONS)[number])
    : MATERIAL_FORM_DEFAULTS.unit;

  return {
    name: mapped.name,
    brand: mapped.brand,
    article: mapped.article,
    type: mapped.category as SpecType,
    productType: mapped.product_type ?? "",
    unit,
    price: mapped.price,
    imageUrl: mapped.image_url,
    productUrl: mapped.product_url ?? "",
    attrs: mapped.attrs,
  };
}
