import { z } from "zod";
import {
  CODE_PATTERN,
  SERVICE_OPERATION_TYPES,
  SPEC_STATUSES,
  SPEC_TYPES,
  TYPE_ORDER,
  UNIT_OPTIONS,
} from "./constants";

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
  logo_url: z.string().trim().max(2048).optional().nullable(),
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
  avatar_url: z.string().trim().max(2048).optional().nullable(),
  // created_by: z.string().optional().nullable(),
});

export type ContactInput = z.infer<typeof contactSchema>;

export type CompanyRow = CompanyInput & { id: string };
export type ContactRow = ContactInput & { id: string };

// --- MATERIALS ---
/**
 * Материал библиотеки — шаблон для позиций спецификации: категория (раздел),
 * тип внутри категории (керамогранит, ламинат…) и характеристики, которые
 * переносятся в позицию при добавлении материала в проект.
 */
export const materialSchema = z.object({
  id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1, "Укажите наименование материала"),
  brand: z.string().optional().nullable(),
  /** Категория — раздел спецификации (Отделка, Мебель, …). */
  category: z.string().min(1, "Выберите категорию"),
  article: z.string().optional().nullable(),
  unit: z.string().default("шт"),
  product_url: z.string().optional().nullable(),
  /** Тип материала внутри категории: керамогранит, ламинат, обои, … */
  product_type: z.string().optional().nullable(),
  price: z
    .number()
    .min(0, "Цена не может быть отрицательной")
    .optional()
    .default(0),
  image_url: z.string().optional().nullable(),
  /** Характеристики материала: ключ → значение. */
  attrs: z.record(z.string(), z.string().max(500)).default({}),
  // tags: z.array(z.string()).optional().default([]),
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
  rooms: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
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
    /**
     * Имя поставщика на момент правки. Пишется в company_name_snapshot, чтобы
     * список и карточка показывали нового поставщика сразу; при наличии
     * companyId сервер всё равно перечитывает имя из справочника.
     * Лимит 200 — как у companySchema.name и снапшота в spec_variants.
     */
    companyName: z.string().trim().max(200),
    parentId: z.string().uuid().nullable().optional(),
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
    product_url: z.string().trim().max(500),
    product_type: z.string().trim().max(120),
    imageUrl: z.string().trim().max(500).nullable(),
    rooms: z.array(z.string().trim().min(1).max(120)).max(100),
    notes: z.string().trim().max(4000),
    leadTime: z.string().trim().max(120),
    avail: z.string().trim().max(120),
    attrs: z.record(z.string(), z.string().max(500)),
    stockPct: z.coerce.number().min(0).max(100).optional(),
    clientDiscountPct: z.coerce.number().min(0).max(100).optional(),
    supplierDiscountPct: z.coerce.number().min(0).max(100).optional(),
  })
  .partial()
  .strip();

// export type SpecItemPatch = z.infer<typeof specItemPatchSchema>;

/** Патч варианта спецификации: редактируемые поля, служебные ключи отбрасываются. */
export const specVariantPatchSchema = z
  .object({
    name: z.string().trim().max(300),
    brand: z.string().trim().max(200),
    article: z.string().trim().max(120),
    spec: z.string().trim().max(2000),
    price: z.number().min(0).max(1_000_000_000),
    product_url: z.string().trim().max(500),
    image_url: z.string().trim().max(500).nullable(),
    lead_time: z.string().trim().max(120),
    company_id: z.string().uuid().nullable(),
    contact_id: z.string().uuid().nullable(),
    company_name_snapshot: z.string().trim().max(200),
    label: z.string().trim().max(120),
  })
  .partial()
  .strip();

export type SpecVariantPatch = z.infer<typeof specVariantPatchSchema>;

/** Новая позиция: id генерирует клиент, name обязателен. */
export const specItemCreateSchema = specItemPatchSchema.extend({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Укажите название").max(300),
  type: z.enum(TYPE_ORDER),
});
export type SpecItemCreate = z.infer<typeof specItemCreateSchema>;

export const manualSpecItemSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите наименование").max(300),
    brand: z.string().trim().max(200).default(""),
    /** Категория — раздел спецификации (Отделка, Мебель, …). */
    type: z.enum(SPEC_TYPES),
    /** Тип материала внутри категории: керамогранит, ламинат, обои, … */
    productType: z.string().trim().max(120).default(""),
    spec: z.string().trim().max(2000).default(""),
    article: z.string().trim().max(120).default(""),

    qty: z.coerce
      .number({ error: "Укажите количество" })
      .positive("Количество больше нуля")
      .min(0.01, "Количество больше нуля")
      .max(1_000_000, "Слишком большое количество"),

    unit: z.enum(UNIT_OPTIONS).default("шт"),

    price: z.coerce
      .number({ error: "Укажите цену" })
      .min(0, "Цена не может быть отрицательной")
      .max(1_000_000_000),

    stockPct: z.coerce
      .number({ error: "Укажите процент" })
      .min(0)
      .max(100, "Запас не больше 100 %")
      .default(0),

    clientDiscountPct: z.coerce
      .number({ error: "Укажите процент" })
      .min(0)
      .max(100, "Скидка не больше 100 %")
      .default(0),

    supplierDiscountPct: z.coerce
      .number({ error: "Укажите процент" })
      .min(0)
      .max(100, "Скидка не больше 100 %")
      .default(0),

    companyId: z.string().uuid().nullable().default(null),
    /**
     * Имя выбранной компании на момент заполнения формы. Нужно для
     * оптимистичной вставки позиции: UI показывает снапшот имени, а крипт id
     * ему ничего не говорит. Авторитетным остаётся сервер (см.
     * createManualSpecItem: имя перечитывается из справочника).
     */
    companyName: z.string().trim().max(200).default(""),
    imageUrl: z.string().trim().max(500).nullable().default(null),
    productUrl: z.string().trim().max(500).default(""),
    /** Характеристики позиции: ключ → значение. */
    attrs: z.record(z.string(), z.string().max(500)).default({}),
    saveToLibrary: z.boolean().default(true),
    leadTime: z.string().trim().max(120).default(""),
  })
  .refine(
    (d) =>
      d.supplierDiscountPct === 0 ||
      d.clientDiscountPct <= d.supplierDiscountPct,
    {
      path: ["clientDiscountPct"],
      message: "Скидка заказчику больше вашей — позиция уйдёт в минус",
    },
  );


/* ------------------------------------------------------------------ */
/*  Дополнительные расходы проекта: операции «Монтаж» и «Доставка»     */
/* ------------------------------------------------------------------ */

/**
 * Дата в формате «ГГГГ-ММ-ДД» (колонка date). Пустая строка и null
 * означают «срок не задан»; пустая строка приходит из input[type=date],
 * когда пользователь ничего не выбрал.
 */
const serviceOperationDate = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Некорректная дата"),
  z.literal(""),
  z.null(),
]);

/**
 * Поля операции. Стоимость неотрицательна и считается ОДИН раз на операцию
 * (агрегат), а не на каждую связанную позицию.
 */
export const serviceOperationFieldsSchema = z
  .object({
    type: z.enum(SERVICE_OPERATION_TYPES, {
      error: "Неверный тип операции",
    }),
    /** Связанные позиции спецификации. Непустой список без повторов. */
    specItemIds: z
      .array(z.string().uuid("Некорректный идентификатор позиции"))
      .min(1, "Выберите хотя бы одну позицию")
      .max(500, "Слишком много позиций"),
    amount: z.coerce
      .number({ error: "Укажите стоимость" })
      .min(0, "Стоимость не может быть отрицательной")
      .max(1_000_000_000, "Стоимость слишком велика"),
    /** Отметка «исполнено». Для доставки переводит материалы в «Доставлено». */
    completed: z.boolean().default(false),
    deadline: serviceOperationDate.default(null),
    contractorCompanyId: z.string().uuid().nullable().default(null),
    notes: z.string().trim().max(4000, "Комментарий слишком длинный").default(""),
  })
  .refine(
    (d) => new Set(d.specItemIds).size === d.specItemIds.length,
    { message: "Позиции не должны повторяться", path: ["specItemIds"] },
  );

export type ServiceOperationFields = z.infer<
  typeof serviceOperationFieldsSchema
>;

/** Создание операции из выделенных позиций. */
export const serviceOperationCreateSchema = serviceOperationFieldsSchema;
export type ServiceOperationCreateInput = ServiceOperationFields;

/**
 * Обновление операции: полная замена значимых полей. Список позиций
 * обязателен — операция не может остаться без связанных позиций.
 */
export const serviceOperationUpdateSchema = serviceOperationFieldsSchema;
export type ServiceOperationUpdateInput = ServiceOperationFields;

/** Удаление операции. */
export const serviceOperationDeleteSchema = z.object({
  operationId: z.string().uuid(),
});
export type ServiceOperationDeleteInput = z.infer<
  typeof serviceOperationDeleteSchema
>;

export type ManualSpecItemInput = z.infer<typeof manualSpecItemSchema>;

// --- СОСТАВ (spec_item_components) ---
/** Создание компонента состава: только минимальный набор полей. */
export const specItemComponentCreateSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(300),
  cost: z
    .number()
    .min(0, "Стоимость не может быть отрицательной")
    .max(1_000_000_000)
    .nullable()
    .default(null),
  companyId: z.string().uuid().nullable().default(null),
  contactId: z.string().uuid().nullable().default(null),
  notes: z.string().trim().max(4000).default(""),
});

export type SpecItemComponentCreateInput = z.infer<
  typeof specItemComponentCreateSchema
>;


/** Создание группы состава: только название (остальные поля группы всегда пустые). */
export const specItemGroupSchema = z.object({
  name: z.string().trim().min(1, "Укажите название группы").max(300),
});

export type SpecItemGroupInput = z.infer<typeof specItemGroupSchema>;

/** Ссылка на существующий SpecItem состава (kind = 'spec_ref'). */
export const specItemComponentRefSchema = z.object({
  /** Целевая позиция спецификации проекта. */
  refSpecItemId: z.string().uuid("Укажите позицию спецификации"),
  /** Ручная дополнительная сумма ссылки; может быть пустой. */
  additionalCost: z
    .number()
    .min(0, "Дополнительная стоимость не может быть отрицательной")
    .max(1_000_000_000, "Слишком большая дополнительная стоимость")
    .nullable()
    .default(null),
});

export type SpecItemComponentRefInput = z.infer<
  typeof specItemComponentRefSchema
>;
