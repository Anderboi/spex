import type { Tables, TablesUpdate } from "@/lib/supabase/database.types";
import type { SpecItemPatch } from "@/lib/validations";
import { one } from "../utils";
import { SpecItem } from "../types";
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
    imageUrl: material?.image_url ?? null,
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
    rooms: r.rooms ?? [],
    notes: r.notes ?? "",
    leadTime: r.lead_time ?? "",
    avail: r.avail ?? "",
    attrs: (r.attrs as Record<string, string> | null) ?? {},
    updatedAt: r.updated_at,
    stockPct: Number(r.stock_pct ?? 0),
    clientDiscountPct: Number(r.client_discount_pct ?? 0),
    supplierDiscountPct: Number(r.supplier_discount_pct ?? 0),
  };
}

/** camelCase-патч → колонки БД. Неизвестные ключи отбрасываются. */
// const FIELD_MAP: Record<keyof SpecItemPatch, string> = {
//   materialId: "material_id",
//   companyId: "company_id",
//   contactId: "contact_id",
//   code: "code",
//   type: "type",
//   name: "name",
//   brand: "brand",
//   spec: "spec",
//   article: "article",
//   qty: "qty",
//   unit: "unit",
//   price: "price",
//   status: "status",
//   isPlaceholder: "is_placeholder",
//   position: "position",
//   rooms: "rooms",
//   notes: "notes",
//   leadTime: "lead_time",
//   avail: "avail",
//   attrs: "attrs",
// };

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

  return r;
}
