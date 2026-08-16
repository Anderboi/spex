import { TYPE_ORDER } from "./constants";
import { ProjectStatus } from './validations';

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

export interface SpecItem {
  id: string;
  type: string;
  code: string;
  name: string;
  brand: string;
  spec: string;
  qty: number;
  unit: string;
  price: number;
  status: string;
  article: string;
  format: string;
  surface: string;
  color: string;
  variants: Variant[];
  rooms?: string[];
  avail?: string;
  leadTime?: string;
  manager?: Manager;
  notes?: string;
  placeholder?: boolean;
  files?: Record<string, FileEntry[]>;
  cleared?: boolean;
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
