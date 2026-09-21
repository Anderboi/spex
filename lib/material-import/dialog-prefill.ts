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
};

/** Поставщик — отдельное состояние диалога, а не только поле формы. */
export type MaterialDialogSupplier = {
  companyId: string | null;
  contactId: string | null;
};

export type MaterialDialogPrefill = {
  values: MaterialDialogInitialValues;
  supplier: MaterialDialogSupplier;
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
 * Что подставить в форму при сбросе.
 *
 * Три случая, в порядке приоритета:
 *  1. редактирование — значения материала и его поставщик;
 *  2. создание из импорта — значения из черновика, поставщик пуст
 *     (импортёр его не определяет: контрагента выбирает пользователь);
 *  3. обычное создание — пустая форма.
 *
 * `supplierFromMaterial` — потому что `supplier` в диалоге живёт отдельным
 * состоянием и не должен теряться при сбросе. Тип принимает `MaterialInput`
 * (у него есть `company_id`/`contact_id`) и `MaterialFormValues`.
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
      supplier: {
        companyId: material.company_id ?? null,
        contactId: material.contact_id ?? null,
      },
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
      supplier: { companyId: null, contactId: null },
    };
  }

  return {
    // Свежая копия `attrs`: общий объект на уровне модуля мог бы быть изменён
    // формой (и уж точно не должен разделяться между вызовами).
    values: { ...EMPTY_DIALOG_VALUES, attrs: {} },
    supplier: { companyId: null, contactId: null },
  };
}
