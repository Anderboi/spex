import { SPEC_ITEM_STATUSES, SpecStatus, SpecType, TYPE_ORDER } from "./constants";
import { Database } from './supabase/database.types';
import { ProjectStatus } from "./validations";

export type ProjectType = "Интерьер" | "Экстерьер" | "Коммерческий";

export interface Project {
  id: string;
  title: string;
  type: ProjectType;
  status: ProjectStatus;
  rooms: number;
  items: number;
  budget: number;
  updatedAt: string;
}

export interface Variant {
  name: string;
  lead: string;
  price: number;
  selected: boolean;
}

export interface Manager {
  name?: string;
  phone?: string;
  email?: string;
}

export interface FileEntry {
  id: string;
  name: string;
  size: number;
  ext: string;
  at: number;
  map?: string;
  url?: string;
}

export interface CatalogItem {
  type: string;
  name: string;
  brand: string;
  spec: string;
  unit: string;
  price: number;
  article: string;
  format: string;
  surface: string;
  color: string;
}

export interface DraftItem {
  name: string;
  brand: string;
  type: string;
  spec: string;
  qty: string;
  unit: string;
  price: string;
}

export interface FileCategory {
  key: string;
  label: string;
  accept: string;
  kind: "doc" | "tex";
  upTitle: string;
  upHint: string;
  empty: string;
}

export type MaterialsSort =
  | "created_desc"
  | "created_asc"
  | "name_asc"
  | "name_desc";

export type MaterialsFilters = {
  query: string;
  category: string | null;
  manufacturer: string | null;
  status: string | null;
  sort: MaterialsSort;
  page: number;
};

export interface SupplierOption {
  id: string; // ID записи (компании или контакта)
  name: string; // Имя контакта или Название компании
  type: "company" | "contact";
  company_id?: string | null; // ID компании (если выбран контакт)
  company_name?: string | null; // Название компании (для подписи контактов)
}

export type CompanyCategory = (typeof TYPE_ORDER)[number];

export interface SupplierContact {
  id: string;
  name: string; // Название компании / Салон (например, "Kerama Marazzi", "Krassky")
  contactPerson?: string; // Имя менеджера ("Алексей")
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  category?: string; // "Плитка", "Свет", "Сантехника"
  note?: string; // Доп. заметки (например, "Скидка студии 15%")
}

export type MessageResult = { success?: string; error?: string };

export type SpecItemStatus = (typeof SPEC_ITEM_STATUSES)[number];

// export type SpecItemRow = {
//   id: string;
//   project_id: string;
//   org_id: string;
//   material_id: string | null;
//   company_id: string | null;
//   contact_id: string | null;
//   company_name_snapshot: string | null;
//   code: string | null;
//   name: string;
//   brand: string | null;
//   spec: string | null;
//   article: string | null;
//   type: string;
//   qty: number;
//   unit: string;
//   price: number;
//   status: SpecStatus;
//   is_placeholder: boolean;
//   position: number;
//   rooms: string[] | null;
//   notes: string | null;
//   lead_time: string | null;
//   avail: string | null;
//   attrs: Record<string, string> | null;
//   updated_at: string;
// };

/** Модель в UI (camelCase, без null там, где UI ждёт строку) */
export type SpecItem = {
  id: string;
  projectId: string;
  materialId: string | null;
  companyId: string | null;
  contactId: string | null;
  companyName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  imageUrl: string | null;
  code: string;
  type: SpecType;
  name: string;
  brand: string;
  spec: string;
  article: string;
  qty: number;
  unit: string;
  price: number;
  stockPct: number;
  clientDiscountPct: number;
  supplierDiscountPct: number;
  status: SpecStatus;
  isPlaceholder: boolean;
  position: number;
  rooms: string[];
  notes: string;
  leadTime: string;
  avail: string;
  attrs: Record<string, string>;
  updatedAt: string;
  product_url: string;
  product_type: string;
};

export type SpecItemPatch = Partial<Omit<SpecItem, "id" | "projectId">>;

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export type Fn<T extends keyof Database["public"]["Functions"]> =
  Database["public"]["Functions"][T];

export type FnArgs<T extends keyof Database["public"]["Functions"]> =
  Fn<T>["Args"];
export type FnReturns<T extends keyof Database["public"]["Functions"]> =
  Fn<T>["Returns"];

export type { Database };
