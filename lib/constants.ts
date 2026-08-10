import { ProjectStatus, ProjectType } from "./types";

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
  { dot: string; label: string }
> = {
  "В работе": { dot: "bg-bg-green", label: "В работе" },
  Завершен: { dot: "bg-bg-accent", label: "Завершен" },
  Черновик: { dot: "bg-fg-muted", label: "Черновик" },
  "На паузе": { dot: "bg-bg-amber", label: "На паузе" },
};

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
