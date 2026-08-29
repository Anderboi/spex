import { SpecItem, SpecVariant } from '../types';

export function rowToVariant(r: any): SpecVariant {
  return {
    id: r.id,
    specItemId: r.spec_item_id,
    name: r.name ?? "",
    brand: r.brand ?? "",
    article: r.article ?? "",
    spec: r.spec ?? "",
    price: r.price === null ? 0 : Number(r.price),
    productUrl: r.product_url ?? "",
    imageUrl: r.image_url ?? null,
    leadTime: r.lead_time ?? "",
    companyId: r.company_id ?? null,
    contactId: r.contact_id ?? null,
    companyName: r.company_name_snapshot ?? "",
    label: r.label ?? "",
    isActive: r.is_active === true,
    position: r.position ?? 0,
  };
}
/** Накладывает активный вариант на плоские поля позиции. */
export function applyActiveVariant(item: SpecItem): SpecItem {
  const variants = item.variants ?? [];
  const active = variants.find((v) => v.isActive) ?? variants[0] ?? null;
  if (!active) return item; // нет вариантов — позиция как есть (старое поведение)

  return {
    ...item,
    name: active.name,
    brand: active.brand,
    article: active.article,
    spec: active.spec,
    price: active.price,
    product_url: active.productUrl,
    imageUrl: active.imageUrl,
    leadTime: active.leadTime,
    companyId: active.companyId,
    contactId: active.contactId,
    companyName: active.companyName,
    activeVariantId: active.id,
  };
}
