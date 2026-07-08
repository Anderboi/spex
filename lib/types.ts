export type ProjectStatus = "В работе" | "Завершен" | "Черновик" | "На паузе";
export type ProjectType = "Интерьер" | "Экстерьер" | "Коммерческий";

export interface Project {
  id: string;
  name: string;
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

export const TYPE_ORDER = [
  "Отделка",
  "Мебель",
  "Оборудование",
  "Сантехника",
  "Освещение",
  "Текстиль",
  "Инженерное оборудование",
  "Декор",
  "Двери",
  "Электрика",
];

export const STATUS_FLOW = [
  "Не выбрано",
  "Подобрано",
  "Согласовано",
  "Приобретено",
  "Доставлено",
  "Заменить",
];

export const UNIT_OPTIONS = [
  "шт",
  "м²",
  "м³",
  "м.п.",
  "компл.",
  "пара",
  "л",
  "кг",
  "рул.",
  "уп.",
];

export const PREFIX_MAP: Record<string, string> = {
  Отделка: "От",
  Мебель: "М",
  Оборудование: "Об",
  Сантехника: "С",
  Освещение: "О",
  Текстиль: "Т",
  "Инженерное оборудование": "ИО",
  Декор: "Д",
  Двери: "Дв",
  Электрика: "Э",
};
