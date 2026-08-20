import { z } from "zod";
import { CODE_PATTERN, SPEC_STATUSES, TYPE_ORDER } from "./constants";

// --- AUTH ---
export const loginSchema = z.object({
  email: z.string().email("Введите корректный email"),
  password: z.string().min(6, "Пароль должен быть минимум 6 символов"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    name: z.string().min(2, "Имя должно содержать минимум 2 символа"),
    email: z.string().email("Введите корректный email"),
    password: z.string().min(6, "Пароль должен быть не менее 6 символов"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Пароли не совпадают",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const resetPasswordRequestSchema = z.object({
  email: z.string().email("Введите корректный email"),
});

export const newPasswordSchema = z
  .object({
    password: z.string().min(6, "Пароль должен быть не менее 6 символов"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Пароли не совпадают",
    path: ["confirmPassword"],
  });

export type ResetPasswordRequestInput = z.infer<
  typeof resetPasswordRequestSchema
>;
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;

const categoriesSchema = z.array(z.string()).default([]);

// --- SUPPLIERS / CONTACTS ---
export const companySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Укажите название компании").max(200),
  // created_by: z.string().optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z
    .union([z.string().email("Некорректный E-mail"), z.literal("")])
    .optional()
    .nullable(),
  website: z.string().trim().max(300).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  category: categoriesSchema,
  note: z.string().max(2000).optional().nullable(),
});

export type CompanyInput = z.infer<typeof companySchema>;

export const contactSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Укажите имя контакта").max(200),
  phone: z.string().trim().max(50).optional().nullable(),
  title: z.string().trim().max(200).optional().nullable(),
  email: z
    .union([z.string().email("Некорректный E-mail"), z.literal("")])
    .optional()
    .nullable(),
  category: categoriesSchema,
  note: z.string().max(2000).optional().nullable(),
  company_id: z.string().uuid().optional().nullable(),
  // created_by: z.string().optional().nullable(),
});

export type ContactInput = z.infer<typeof contactSchema>;

export type CompanyRow = CompanyInput & { id: string };
export type ContactRow = ContactInput & { id: string };

// --- MATERIALS ---
export const materialSchema = z.object({
  id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1, "Укажите наименование материала"),
  brand: z.string().optional().nullable(),
  category: z.string().min(1, "Выберите категорию"),
  article: z.string().optional().nullable(),
  unit: z.string().default("шт"),
  price: z
    .number()
    .min(0, "Цена не может быть отрицательной")
    .optional()
    .default(0),
  image_url: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
});

export type MaterialInput = z.infer<typeof materialSchema>;

// --- PROJECTS ---
export const PROJECT_STATUSES = [
  "draft",
  "active",
  "on_hold",
  "completed",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projectSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Укажите название проекта").max(200),
  client_name: z.string().trim().max(200).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  budget: z.number().min(0, "Бюджет не может быть отрицательным").default(0),
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Некорректный цвет")
    .default("#000000"),
  status: z.enum(PROJECT_STATUSES).default("draft"),
  type: z.enum(["Интерьер", "Экстерьер", "Коммерческий"]).default("Интерьер"),
  cover_url: z.string().trim().max(500).optional().nullable(),
  // org_id: z.string().uuid().optional().nullable(),
  // created_at: z.string().optional().nullable(),
  // updated_at: z.string().optional().nullable(),
});

export type ProjectInput = z.infer<typeof projectSchema>;

// --- SPEC ITEMS ---
export const specItemSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid("Укажите ID проекта"),
  material_id: z.string().uuid().optional().nullable(),
  code: z.string().optional().nullable(), // например, "M-01", "PL-02"
  name: z.string().min(1, "Укажите наименование позиции"),
  brand: z.string().optional().nullable(),
  spec: z.string().optional().nullable(), // дополнительные параметры/примечания
  qty: z.number().min(0, "Количество не может быть отрицательным").default(1),
  unit: z.string().default("шт"),
  price: z.number().min(0, "Цена не может быть отрицательной").default(0),
  status: z
    .enum(["draft", "approved", "ordered", "delivered", "archived"])
    .default("draft"),
  is_placeholder: z.boolean().default(false),
  position: z.number().int().default(0),
  created_at: z.string().optional().nullable(),
  updated_at: z.string().optional().nullable(),
  company_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  orgId: z.string().uuid().optional().nullable(),
  company_name_snapshot: z.string().optional().nullable(),
  contact_name_snapshot: z.string().optional().nullable(),
});

export type SpecItemInput = z.infer<typeof specItemSchema>;

export const reorderSpecItemsSchema = z.object({
  projectId: z.string().uuid(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      position: z.number().int(),
    }),
  ),
});

export type ReorderSpecItemsInput = z.infer<typeof reorderSpecItemsSchema>;

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Минимум 2 символа")
    .max(80, "Слишком длинное название"),
});

const money = z
  .number()
  .min(0)
  .max(1_000_000_000)
  .transform((n) => Math.round(n * 100) / 100);

/** Патч позиции: все поля необязательны, лишние ключи отбрасываются. */
export const specItemPatchSchema = z
  .object({
    materialId: z.string().uuid().nullable(),
    companyId: z.string().uuid().nullable(),
    contactId: z.string().uuid().nullable(),
    code: z.string().regex(CODE_PATTERN, "Формат марки: «О-03»"),
    type: z.enum(TYPE_ORDER),
    name: z.string().trim().max(300),
    brand: z.string().trim().max(200),
    spec: z.string().trim().max(2000),
    article: z.string().trim().max(120),
    qty: z.number().min(0.01).max(1_000_000),
    unit: z.string().trim().min(1).max(20),
    price: money,
    status: z.enum(SPEC_STATUSES),
    isPlaceholder: z.boolean(),
    position: z.number().int().min(0),
    rooms: z.array(z.string().trim().min(1).max(120)).max(100),
    notes: z.string().trim().max(4000),
    leadTime: z.string().trim().max(120),
    avail: z.string().trim().max(120),
    attrs: z.record(z.string(), z.string().max(500)),
  })
  .partial()
  .strip();

export type SpecItemPatch = z.infer<typeof specItemPatchSchema>;

/** Новая позиция: id генерирует клиент, name обязателен. */
export const specItemCreateSchema = specItemPatchSchema.extend({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Укажите название").max(300),
  type: z.enum(TYPE_ORDER),
});
export type SpecItemCreate = z.infer<typeof specItemCreateSchema>;
