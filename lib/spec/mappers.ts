import type { Tables, TablesUpdate } from "@/lib/supabase/database.types";
import { one } from "../utils";
import { SpecItem, SpecItemPatch } from "../types";
import { SpecStatus, SpecType } from "../constants";

type ContactRel = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};
type MaterialRel = { id: string; name: string; image_url: string | null };
export type SpecItemRowPatch = TablesUpdate<"spec_items">;

/** Строка spec_items вместе со связями из select(). */
export type SpecItemRowWithRelations = Tables<"spec_items"> & {
  contact?: ContactRel | ContactRel[] | null;
  material?: MaterialRel | MaterialRel[] | null;
};

export function rowToItem(r: SpecItemRowWithRelations): SpecItem {
  const contact = one(r.contact);
  const material = one(r.material);

  return {
    id: r.id,
    projectId: r.project_id,
    materialId: r.material_id,
    companyId: r.company_id,
    contactId: r.contact_id,
    companyName: r.company_name_snapshot ?? "",
    contactName: contact?.name ?? "",
    contactPhone: contact?.phone ?? "",
    contactEmail: contact?.email ?? "",
    imageUrl: r.image_url ?? material?.image_url ?? null,
    code: r.code ?? "",
    type: r.type as SpecType,
    name: r.name,
    brand: r.brand ?? "",
    spec: r.spec ?? "",
    article: r.article ?? "",
    qty: Number(r.qty),
    unit: r.unit,
    price: Number(r.price),
    status: r.status as SpecStatus,
    isPlaceholder: r.is_placeholder,
    position: r.position,
    product_url: r.product_url ?? "",
    product_type: r.product_type ?? "",
    rooms: r.rooms ?? [],
    notes: r.notes ?? "",
    leadTime: r.lead_time ?? "",
    avail: r.avail ?? "",
    attrs: (r.attrs as Record<string, string> | null) ?? {},
    updatedAt: r.updated_at,
    stockPct: Number(r.stock_pct ?? 0),
    clientDiscountPct: Number(r.client_discount_pct ?? 0),
    supplierDiscountPct: Number(r.supplier_discount_pct ?? 0),
    parentId: r.parent_id,
  };
}

export function patchToRow(p: SpecItemPatch): SpecItemRowPatch {
  const r: SpecItemRowPatch = {};

  if (p.materialId !== undefined) r.material_id = p.materialId;
  if (p.companyId !== undefined) r.company_id = p.companyId;
  if (p.contactId !== undefined) r.contact_id = p.contactId;
  if (p.code !== undefined) r.code = p.code;
  if (p.type !== undefined) r.type = p.type;
  if (p.name !== undefined) r.name = p.name;
  if (p.brand !== undefined) r.brand = p.brand;
  if (p.spec !== undefined) r.spec = p.spec;
  if (p.article !== undefined) r.article = p.article;
  if (p.qty !== undefined) r.qty = p.qty;
  if (p.unit !== undefined) r.unit = p.unit;
  if (p.price !== undefined) r.price = p.price;
  if (p.status !== undefined) r.status = p.status;
  if (p.isPlaceholder !== undefined) r.is_placeholder = p.isPlaceholder;
  if (p.position !== undefined) r.position = p.position;
  if (p.rooms !== undefined) r.rooms = p.rooms;
  if (p.notes !== undefined) r.notes = p.notes;
  if (p.leadTime !== undefined) r.lead_time = p.leadTime;
  if (p.avail !== undefined) r.avail = p.avail;
  if (p.attrs !== undefined) r.attrs = p.attrs;
  if (p.stockPct !== undefined) r.stock_pct = p.stockPct;
  if (p.clientDiscountPct !== undefined)
    r.client_discount_pct = p.clientDiscountPct;
  if (p.supplierDiscountPct !== undefined)
    r.supplier_discount_pct = p.supplierDiscountPct;
  if (p.product_url !== undefined) r.product_url = p.product_url;
  if (p.product_type !== undefined) r.product_type = p.product_type;
  if (p.imageUrl !== undefined) r.image_url = p.imageUrl;
  if (p.parentId !== undefined) {
    r.parent_id = p.parentId;
  }

  return r;
}
