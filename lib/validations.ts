import { z } from "zod";
import { TYPE_ORDER } from "./types";

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

// --- SUPPLIERS / CONTACTS ---
export const companySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Укажите название компании"),
  user_id: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z
    .string()
    .email("Некорректный E-mail")
    .optional()
    .or(z.literal(""))
    .nullable(),
  website: z.string().optional().nullable(),
  address: z.string().optional().or(z.literal("")).nullable(),
  city: z.string().optional().or(z.literal("")).nullable(),
  category: z.enum(TYPE_ORDER).optional(),
  note: z.string().optional().nullable(),
});

export type CompanyInput = z.infer<typeof companySchema>;

export const contactSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Укажите имя контакта"),
  phone: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  email: z
    .string()
    .email("Некорректный E-mail")
    .optional()
    .or(z.literal(""))
    .nullable(),
  category: z.enum(TYPE_ORDER).optional(),
  note: z.string().optional().nullable(),
  company_id: z.string().uuid().optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
});

export type ContactInput = z.infer<typeof contactSchema>;

// --- MATERIALS ---
export const materialSchema = z.object({
  id: z.string().uuid().optional(),
  supplier_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1, "Укажите наименование материала"),
  brand: z.string().optional().nullable(),
  category: z.string().min(1, "Выберите категорию"),
  article: z.string().optional().nullable(),
  unit: z.string().default("шт"),
  price: z.number().min(0, "Цена не может быть отрицательной").default(0),
  image_url: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  specifications: z.record(z.string(), z.any()).default({}),
});

export type MaterialInput = z.infer<typeof materialSchema>;

// --- PROJECTS ---
export const projectSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1, "Укажите название проекта"),
  client_name: z.string().optional().nullable(),
  accent_color: z.string().default("#000000"),
  status: z.enum(["active", "archived", "completed"]).default("active"),
});

export type ProjectInput = z.infer<typeof projectSchema>;

// --- SPEC ITEMS ---
export const specItemSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid("Укажите ID проекта"),
  material_id: z.string().uuid().optional().nullable(),
  supplier_id: z.string().uuid().optional().nullable(),
  code: z.string().optional().nullable(), // например, "M-01", "PL-02"
  name: z.string().min(1, "Укажите наименование позиции"),
  brand: z.string().optional().nullable(),
  spec: z.string().optional().nullable(), // дополнительные параметры/примечания
  qty: z.number().min(0, "Количество не может быть отрицательным").default(1),
  unit: z.string().default("шт"),
  price: z.number().min(0, "Цена не может быть отрицательной").default(0),
  status: z
    .enum(["draft", "approved", "ordered", "delivered"])
    .default("draft"),
  is_placeholder: z.boolean().default(false),
  position: z.number().int().default(0),
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

