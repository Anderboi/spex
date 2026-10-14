/**
 * Поставщики материала библиотеки: правила без React, Supabase и запросов.
 *
 * Материал продаётся в нескольких компаниях, у каждой своя цена и ссылка на
 * страницу товара. Позиция спецификации по-прежнему берёт **одного** поставщика,
 * поэтому у списка есть «основной» — первая строка. Его значения зеркалятся в
 * колонки `materials` (`company_id`, `contact_id`, `price`, `product_url`,
 * `supplier_company_ids`): по этому зеркалу живут список библиотеки, добавление
 * материала в проект и карточка компании, и оно же — единственное место, где
 * денормализация собирается.
 *
 * Всё, что здесь есть, — чистые функции: и выбор основного, и «дешевле всех», и
 * сборка зеркала проверяются тестами без базы и без рендера (см.
 * `suppliers.test.ts`).
 */

/** Строка «материал есть у этой компании» в том виде, в каком её правит форма. */
export type MaterialSupplierDraft = {
  /** id строки в БД; у новой строки его нет. */
  id?: string;
  company_id: string | null;
  contact_id: string | null;
  price: number;
  /** Страница товара у этой компании — источник цены, когда её обновят руками. */
  product_url: string | null;
};

/** Строка, готовая к записи: с порядком отображения. */
export type MaterialSupplierRow = MaterialSupplierDraft & { position: number };

/**
 * Привести список к тому виду, в каком он ложится в БД.
 *
 * Два правила, и оба про мусор, который иначе дошёл бы до базы:
 *  - строка без компании — не поставщик: её выбрасываем (в форме так выглядит
 *    только что добавленная и ещё не заполненная строка);
 *  - одна компания — одна строка на материал: это же обещает частичный
 *    уникальный индекс `material_suppliers_material_id_company_id_key`.
 *    Дубликат молча схлопывается в первое вхождение, а не роняет сохранение
 *    ошибкой констрейнта.
 *
 * Порядок отображения пересобирается по индексу: после удаления средней строки
 * в нём не должно остаться дыр.
 */
export function normalizeMaterialSuppliers(
  rows: readonly MaterialSupplierDraft[],
): MaterialSupplierRow[] {
  const seen = new Set<string>();
  const normalized: MaterialSupplierRow[] = [];

  for (const row of rows) {
    const companyId = row.company_id;
    if (!companyId || seen.has(companyId)) continue;
    seen.add(companyId);
    normalized.push({
      ...row,
      company_id: companyId,
      contact_id: row.contact_id ?? null,
      price: Number.isFinite(row.price) ? row.price : 0,
      product_url: row.product_url?.trim() ? row.product_url.trim() : null,
      position: normalized.length,
    });
  }

  return normalized;
}

/** Основной поставщик — первый после нормализации; `null`, если поставщиков нет. */
export function primaryMaterialSupplier(
  rows: readonly MaterialSupplierRow[],
): MaterialSupplierRow | null {
  return rows[0] ?? null;
}

/**
 * Самое дешёвое предложение среди строк с ценой.
 *
 * Ничьи не разыгрываются: при равных минимальных ценах «дешевле всех» не
 * достаётся никому (`unique: false`) — то же правило, что у вариантов замены
 * (`components/spec-builder/variant-card.tsx`). Нулевая цена предложением не
 * считается: ноль в библиотеке значит «цена не указана», а не «бесплатно».
 */
export function cheapestMaterialSupplier(
  rows: readonly MaterialSupplierRow[],
): { row: MaterialSupplierRow; unique: boolean } | null {
  const priced = rows.filter((row) => row.price > 0);
  if (priced.length === 0) return null;

  const min = Math.min(...priced.map((row) => row.price));
  const cheapest = priced.filter((row) => row.price === min);
  // «Дешевле всех» — это сравнение, а не факт: при равных минимальных ценах
  // бейдж не достаётся никому, и при единственной цене его тоже нет — дешевле
  // чего она, если сравнивать не с чем.
  const unique = cheapest.length === 1 && priced.length > 1;
  return { row: cheapest[0], unique };
}

/**
 * Зеркало списка в колонки материала.
 *
 * `price` и `product_url` возвращаются только тогда, когда поставщики есть:
 * пустой список не должен затирать собственную цену материала — у материала без
 * поставщика она своя (и её же подхватывает первая добавленная строка).
 */
export type MaterialSupplierMirror = {
  company_id: string | null;
  contact_id: string | null;
  supplier_company_ids: string[];
  price?: number;
  product_url?: string | null;
};

export function materialSupplierMirror(
  rows: readonly MaterialSupplierRow[],
): MaterialSupplierMirror {
  const primary = primaryMaterialSupplier(rows);

  return {
    company_id: primary?.company_id ?? null,
    contact_id: primary?.contact_id ?? null,
    // Порядок как у строк: первый элемент массива — компания основного
    // поставщика. Дубликатов здесь быть не может (см. нормализацию).
    supplier_company_ids: rows.map((row) => row.company_id as string),
    ...(primary
      ? { price: primary.price, product_url: primary.product_url }
      : {}),
  };
}

/**
 * Подпись числа поставщиков: «1 поставщик», «2 поставщика», «5 поставщиков».
 *
 * Русская форма выбирается по последним двум цифрам: 11–14 — всегда «ов»
 * (иначе «11 поставщик»), иначе по последней (1 — «», 2–4 — «а», 0, 5–9 — «ов»).
 */
export function materialSupplierCountLabel(count: number): string {
  const forms = ["поставщик", "поставщика", "поставщиков"];
  const abs = Math.abs(count);
  const lastTwo = abs % 100;
  const last = abs % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return `${count} ${forms[2]}`;
  if (last === 1) return `${count} ${forms[0]}`;
  if (last >= 2 && last <= 4) return `${count} ${forms[1]}`;
  return `${count} ${forms[2]}`;
}
