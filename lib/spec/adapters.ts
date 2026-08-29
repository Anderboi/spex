// lib/materials/adapters.ts
import type { MaterialListItem } from "@/lib/queries";
import type { MaterialInput } from "@/lib/validations";

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
  };
}

/** Значения формы → строка списка. Для оптимистичного отображения до ответа сервера. */
export function toListItem(
  input: MaterialInput,
  prev?: MaterialListItem,
): MaterialListItem {
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
  };
}
