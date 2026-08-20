import { Enums } from "./supabase/database.types";
import { ProjectType, SpecItemStatus } from "./types";
import { ProjectStatus } from "./validations";

export const COVER_PALETTE: string[] = [
  "bg-bg-gold",
  "bg-bg-green-light",
  "bg-bg-red-light",
  "bg-bg-select",
  "bg-bg-clear",
];

export const TYPE_COLORS: Record<ProjectType, string> = {
  Интерьер: "bg-bg-accent text-bg",
  Экстерьер: "bg-bg-green text-bg",
  Коммерческий: "bg-bg-amber text-bg",
};

export const STATUS_CONFIG: Record<
  ProjectStatus,
  { label: string; dot: string }
> = {
  draft: { label: "Черновик", dot: "bg-fg-muted" },
  active: { label: "В работе", dot: "bg-bg-green" },
  on_hold: { label: "На паузе", dot: "bg-amber-500" },
  completed: { label: "Завершён", dot: "bg-blue-500" },
  archived: { label: "В архиве", dot: "bg-neutral-400" },
};

// const st = STATUS_CONFIG[currentStatus] ?? STATUS_CONFIG.active;

export const STORAGE_KEY = "spec_items_v1";

export const BRAND_SITES: Record<string, string> = {
  ABK: "https://www.abk.it",
  "Ideal Work": "https://www.idealwork.com",
  GESSI: "https://www.gessi.com",
  Cassina: "https://www.cassina.com",
  Astep: "https://asteplight.com",
};

export const FILE_CATS = [
  {
    key: "schemas",
    label: "Схемы",
    accept: ".pdf,.dwg,.dxf,.png,.jpg,.jpeg",
    kind: "doc" as const,
    upTitle: "Загрузить схему производителя",
    upHint: "PDF, DWG, DXF · спецлисты, узлы, чертежи",
    empty: "Чертежи, технические листы и узлы от производителя",
  },
  {
    key: "textures",
    label: "Текстуры",
    accept: "image/*,.exr,.tif,.tiff",
    kind: "tex" as const,
    upTitle: "Загрузить текстуру",
    upHint: "JPG, PNG, TIFF, EXR · карты для визуализации",
    empty: "PBR-карты для 3ds Max, Corona, V-Ray, Blender",
  },
  {
    key: "care",
    label: "Инструкции",
    accept: ".pdf,.doc,.docx,.jpg,.jpeg,.png",
    kind: "doc" as const,
    upTitle: "Загрузить инструкцию",
    upHint: "PDF, DOC · монтаж, укладка, уход",
    empty: "Инструкции по монтажу, укладке и уходу",
  },
  {
    key: "cad",
    label: "3D / CAD",
    accept: ".skp,.rfa,.3ds,.max,.obj,.fbx,.dwg",
    kind: "doc" as const,
    upTitle: "Загрузить 3D / CAD-блок",
    upHint: "SKP, RFA, MAX, 3DS, OBJ, FBX",
    empty: "Готовые блоки и модели для дизайнера",
  },
];

export const MAP_OPTIONS = [
  "Diffuse / Albedo",
  "Normal",
  "Roughness",
  "Bump",
  "Displacement",
  "Metallic",
  "AO",
  "Opacity",
  "Gloss",
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

export const TYPE_ORDER: SpecType[] = [
  "Отделка",
  "Двери",
  "Сантехника",
  "Освещение",
  "Электрика",
  "Инженерное оборудование",
  "Оборудование",
  "Мебель",
  "Текстиль",
  "Декор",
  "Прочее",
];

export const SPEC_ITEM_STATUSES = [
  "draft",
  "picked",
  "replace",
  "approved",
  "ordered",
  "delivered",
] as const;

export const SPEC_STATUS_CONFIG: Record<
  SpecItemStatus,
  { label: string; dot: string }
> = {
  draft: { label: "Не выбрано", dot: "bg-fg-muted" },
  picked: { label: "Подобрано", dot: "bg-blue-500" },
  replace: { label: "Заменить", dot: "bg-bg-red" },
  approved: { label: "Согласовано", dot: "bg-bg-green" },
  ordered: { label: "Заказано", dot: "bg-amber-500" },
  delivered: { label: "Доставлено", dot: "bg-emerald-600" },
};

export const SPEC_STATUSES = [
  "draft",
  "picked",
  "approved",
  "ordered",
  "delivered",
  "replace",
] as const;
export type SpecStatus = Enums<"spec_status">;

export const SPEC_STATUS_LABEL: Record<SpecStatus, string> = {
  draft: "Не выбрано",
  picked: "Подобрано",
  approved: "Согласовано",
  ordered: "Приобретено",
  delivered: "Доставлено",
  replace: "Заменить",
};

/** Стадии закупки — порядок важен для прогресс-бара */
export const PROCUREMENT_FLOW: SpecStatus[] = [
  "approved",
  "ordered",
  "delivered",
];
export const PICKING_FLOW: SpecStatus[] = ["draft", "picked"];

export type SpecType = Enums<"spec_types">;

const TYPE_PREFIX: Record<SpecType, string> = {
  Отделка: "О",
  Мебель: "М",
  Оборудование: "ОБ",
  Сантехника: "С",
  Освещение: "СВ",
  Текстиль: "Т",
  "Инженерное оборудование": "ИО",
  Декор: "ДК",
  Двери: "Д",
  Электрика: "Э",
  Прочее: "П",
};
export const prefixFor = (type: SpecType) => TYPE_PREFIX[type];

export const UNITS = ["шт", "м²", "м.п.", "компл.", "уп.", "л", "кг"] as const;
export const CODE_PATTERN = /^[A-ZА-Я]{1,3}-\d{1,3}$/;

export const ATTR_PRESETS: Record<string, string[]> = {
  Отделка: ["Формат", "Поверхность", "Цвет", "Коллекция", "Затирка"],
  Сантехника: ["Размеры", "Цвет", "Подводка", "Комплектация"],
  Свет: ["Мощность", "Цветовая температура", "Цоколь", "Диммирование", "IP"],
  Мебель: ["Габариты", "Материал корпуса", "Фасад", "Фурнитура"],
  Двери: ["Размер полотна", "Открывание", "Покрытие", "Фурнитура"],
  Декор: ["Размеры", "Материал", "Цвет"],
  Оборудование: ["Модель", "Габариты", "Мощность", "Подключение"],
  Освещение: [
    "Мощность",
    "Цветовая температура",
    "Цоколь",
    "Диммирование",
    "IP",
  ],
  Текстиль: [
    "Состав",
    "Ширина рулона",
    "Раппорт",
    "Плотность",
    "Огнестойкость",
  ],
  "Инженерное оборудование": [
    "Модель",
    "Производительность",
    "Габариты",
    "Подключение",
  ],
  Электрика: ["Номинал", "Количество модулей", "Цвет", "Серия"],
  Прочее: ["Размеры", "Материал", "Цвет"],
};
