/**
 * Решение о том, какими значениями инициализируется форма материала.
 *
 * Диалог (`components/materials/material-dialog.tsx`) держит это решение в
 * `useEffect`, а сам эффект проверить unit-тестом нельзя: он требует React,
 * DOM и загрузки всего UI-кита. Поэтому «что подставить» и «когда сбрасывать»
 * вынесены сюда чистыми функциями, а эффект только выполняет результат.
 *
 * Историческая причина такой строгости: форма сбрасывалась на «как в БД» при
 * каждом обновлении родителя, потому что эффект зависел от объекта
 * `materialToEdit`, который родитель пересоздаёт на каждом рендере. Для
 * импортированного черновика та же ошибка означала бы потерю уже начатых
 * пользователем правок.
 *
 * Модуль чистый: без React, без Supabase, без обращений к модели.
 */

import {
  MATERIAL_FORM_DEFAULTS,
  materialImportDraftToFormValues,
} from "./mapper";
import type { MaterialImportDraft } from "./draft";
import type { MaterialSupplierDraft } from "@/lib/materials/suppliers";

/**
 * Значения, которыми диалог инициализирует форму. Все поля заполнены: форма
 * создания никогда не получает `undefined` там, где ждёт значение.
 */
export type MaterialDialogInitialValues = {
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

/**
 * Минимум, который нужен для предзаполнения. Принимаем и `MaterialInput`
 * (значения из формы редактирования), и `MaterialFormValues`: у первого
 * `product_type` может быть `undefined`, у второго — `null`.
 */
export type MaterialPrefillSource = {
  id?: string;
  name?: string | null;
  brand?: string | null;
  article?: string | null;
  category?: string | null;
  product_type?: string | null;
  price?: number | null;
  unit?: string | null;
  image_url?: string | null;
  product_url?: string | null;
  attrs?: Record<string, string> | null;
  company_id?: string | null;
  contact_id?: string | null;
  suppliers?: readonly MaterialSupplierDraft[] | null;
};

export type MaterialDialogPrefill = {
  values: MaterialDialogInitialValues;
  /**
   * Поставщики материала — отдельное состояние диалога, а не только поля формы:
   * строк может быть несколько, и порядок в них задаёт пользователь (первая —
   * основной поставщик).
   */
  suppliers: MaterialSupplierDraft[];
};

/** Пустая форма создания — те же дефолты, что в `useForm({ defaultValues })`. */
export const EMPTY_DIALOG_VALUES: MaterialDialogInitialValues = {
  name: "",
  brand: "",
  article: "",
  category: MATERIAL_FORM_DEFAULTS.category,
  product_type: null,
  price: 0,
  unit: MATERIAL_FORM_DEFAULTS.unit,
  image_url: null,
  product_url: null,
  attrs: {},
};

/**
 * Ключ переинициализации формы.
 *
 * Приоритет у редактирования: `id` существующего материала однозначно
 * определяет содержимое формы. Для создания ключом служит `draftKey` —
 * устойчивый идентификатор импорта (например, канонический URL страницы), а НЕ
 * ссылка на объект черновика. Именно поэтому смена ключа означает «пришёл
 * новый импорт», а повторный рендер родителя с тем же ключом — ничего.
 */
export function resolveResetKey(input: {
  materialToEdit?: { id?: string } | null;
  draftKey?: string | null;
}): string | null {
  if (input.materialToEdit?.id) return input.materialToEdit.id;
  return input.draftKey ?? null;
}

/**
 * Поставщики, которые диалог показывает при открытии материала.
 *
 * Список строк — источник правды. Собственные колонки материала
 * (`company_id`/`contact_id`/`price`/`product_url`) — их зеркало, и читаются они
 * только как запасной вариант: материал, у которого строк ещё нет (или они не
 * доехали до клиента), но поставщик указан, не должен открываться с пустым
 * блоком.
 *
 * Импортёр контрагента не определяет вовсе, поэтому у черновика список пуст.
 */
export function resolveMaterialSuppliers(
  material: MaterialPrefillSource,
): MaterialSupplierDraft[] {
  const rows = material.suppliers ?? [];
  if (rows.length > 0) {
    return rows.map((row) => ({
      id: row.id,
      company_id: row.company_id ?? null,
      contact_id: row.contact_id ?? null,
      price: row.price ?? 0,
      product_url: row.product_url ?? null,
    }));
  }

  if (!material.company_id) return [];

  return [
    {
      company_id: material.company_id,
      contact_id: material.contact_id ?? null,
      price: material.price ?? 0,
      product_url: material.product_url ?? null,
    },
  ];
}

/**
 * Что подставить в форму при сбросе.
 *
 * Три случая, в порядке приоритета:
 *  1. редактирование — значения материала и его поставщики;
 *  2. создание из импорта — значения из черновика, поставщиков нет
 *     (импортёр его не определяет: контрагента выбирает пользователь);
 *  3. обычное создание — пустая форма.
 *
 * `suppliers` вынесены отдельно, потому что в диалоге это состояние, а не поля
 * формы: оно не должно теряться при сбросе.
 */
export function resolveDialogPrefill(input: {
  materialToEdit?: MaterialPrefillSource | null;
  draft?: MaterialImportDraft | null;
}): MaterialDialogPrefill {
  if (input.materialToEdit) {
    const material = input.materialToEdit;
    return {
      values: {
        name: material.name ?? "",
        brand: material.brand ?? "",
        article: material.article ?? "",
        category: material.category || MATERIAL_FORM_DEFAULTS.category,
        product_type: material.product_type ?? null,
        price: material.price ?? 0,
        unit: material.unit || MATERIAL_FORM_DEFAULTS.unit,
        image_url: material.image_url ?? null,
        product_url: material.product_url ?? null,
        attrs: material.attrs ?? {},
      },
      suppliers: resolveMaterialSuppliers(material),
    };
  }

  if (input.draft) {
    const mapped = materialImportDraftToFormValues(input.draft);
    return {
      values: {
        name: mapped.name,
        brand: mapped.brand,
        article: mapped.article,
        category: mapped.category,
        product_type: mapped.product_type,
        price: mapped.price,
        unit: mapped.unit,
        image_url: mapped.image_url,
        product_url: mapped.product_url,
        attrs: mapped.attrs,
      },
      // Импортёр не создаёт и не выбирает контрагента.
      suppliers: [],
    };
  }

  return {
    // Свежая копия `attrs`: общий объект на уровне модуля мог бы быть изменён
    // формой (и уж точно не должен разделяться между вызовами).
    values: { ...EMPTY_DIALOG_VALUES, attrs: {} },
    suppliers: [],
  };
}
