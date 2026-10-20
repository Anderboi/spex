// lib/materials/adapters.ts
import type { MaterialListItem, MaterialSupplierItem } from "@/lib/queries";
import type { MaterialInput } from "@/lib/validations";

/** Строка поставщика: значения формы → строка списка. */
function supplierToListItem(
  supplier: MaterialInput["suppliers"][number],
  index: number,
): MaterialSupplierItem {
  return {
    id: supplier.id ?? `temp-supplier-${index}`,
    companyId: supplier.company_id,
    // Имя компании форма не знает: его подставляет `withSupplierNames` в
    // `materials-client`, у которого под рукой справочник.
    companyName: "",
    contactId: supplier.contact_id ?? null,
    contactName: "",
    price: supplier.price ?? 0,
    productUrl: supplier.product_url ?? null,
    position: supplier.position ?? index,
  };
}

/** Строка списка → значения формы. */
export function toFormValues(
  m: MaterialListItem,
): MaterialInput & { id: string } {
  return {
    id: m.id,
    name: m.name,
    category: m.category ?? "Прочее",
    brand: m.brand ?? "",
    article: m.article ?? "",
    unit: m.unit ?? "шт",
    price: m.price ?? 0,
    image_url: m.imageUrl,
    company_id: m.companyId,
    contact_id: m.contactId,
    product_url: m.product_url ?? null,
    product_type: m.product_type ?? null,
    attrs: m.attrs ?? {},
    suppliers: m.suppliers.map((s, index) => ({
      id: s.id,
      company_id: s.companyId,
      contact_id: s.contactId,
      price: s.price,
      product_url: s.productUrl,
      position: s.position ?? index,
    })),
  };
}

/** Значения формы → строка списка. Для оптимистичного отображения до ответа сервера. */
export function toListItem(
  input: MaterialInput,
  prev?: MaterialListItem,
): MaterialListItem {
  // Поставщики до сохранения живут без id (новые строки) и без имён компаний:
  // id нужен только как ключ React, имя дорисует справочник.
  const suppliers = (input.suppliers ?? []).map(supplierToListItem);

  return {
    id: input.id ?? prev?.id ?? `temp-${crypto.randomUUID()}`,
    name: input.name,
    category: input.category ?? null,
    brand: input.brand ?? null,
    article: input.article ?? null,
    price: input.price ?? null,
    unit: input.unit ?? null,
    imageUrl: input.image_url ?? null,
    companyId: input.company_id ?? null,
    companyName: prev?.companyName ?? "", // имя компании форма не знает — переживёт до revalidate
    contactId: input.contact_id ?? null,
    contactName: prev?.contactName ?? "",
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    product_url: input.product_url ?? prev?.product_url ?? null,
    product_type: input.product_type ?? prev?.product_type ?? null,
    attrs: input.attrs ?? prev?.attrs ?? {},
    suppliers,
    // Архивность формой не управляется: правка материала его не восстанавливает.
    deletedAt: prev?.deletedAt ?? null,
    // Отметка «избранное» — не поле формы: правка материала её не меняет.
    isFavorite: prev?.isFavorite ?? false,
  };
}
