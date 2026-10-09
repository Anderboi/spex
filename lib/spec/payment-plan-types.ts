/**
 * Контракт графика платежей позиции: доменные типы, вход и результат операций.
 *
 * Отдельный модуль без зависимостей — по той же причине, по которой существуют
 * `./history-types` и `./file-content`: и ядро мутаций (`./payment-plan-mutations`),
 * и арифметику (`./payment-schedule`), и вкладку «Платежи», и server action
 * связывает один и тот же словарь. Если бы типы жили в модуле с клиентом БД,
 * клиентский компонент тянул бы его в бандл.
 *
 * Значения полей здесь — ровно те, которыми пользуется пользователь:
 * «плановый платёж», «название», «сумма», «условие оплаты», «срок» (см.
 * GLOSSARY.md, раздел «Платежи»).
 */

/** Строка графика в том виде, в каком её видит клиент. */
export type PaymentPlanEntry = {
  id: string;
  orgId: string;
  projectId: string;
  specItemId: string;
  title: string;
  /** Сумма плана числом: `numeric` БД приводится к `number` один раз, в ядре. */
  amount: number;
  /** Условие оплаты свободным текстом. `null` — условие не задано. */
  condition: string | null;
  /** Срок платежа 'YYYY-MM-DD'. `null` — срока нет. */
  dueDate: string | null;
  /** Порядок отображения. Уникален среди неудалённых строк позиции. */
  position: number;
  authorId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Данные строки, которые приходят от пользователя.
 *
 * `position`, организация, проект, автор и время сюда не входят: их определяет
 * сервер (позиция — конец графика, остальное — из сессии и из строки позиции).
 * Клиент не может прислать их даже случайно.
 */
export type PaymentPlanData = {
  title: string;
  amount: number;
  condition: string | null;
  dueDate: string | null;
};

/**
 * Нормализованные данные строки: то, что реально уходит в БД.
 *
 * Отличается от `PaymentPlanData` тем, что пустые строки уже стали `null`, а
 * название обрезано по краям: `""` и `null` — одно состояние «не заполнено», и
 * в БД оно должно лежать одним способом.
 */
export type PaymentPlanValues = {
  title: string;
  amount: number;
  condition: string | null;
  dueDate: string | null;
};

/** Причина отказа, которую action превращает в `ActionResult`. */
export type PaymentPlanError = {
  code: "NOT_FOUND" | "INVALID_INPUT" | "FAILED";
  message: string;
};

/** Арифметика и порядок графика живут в `./payment-schedule` — здесь только данные. */
export type { PaymentPlanLike } from "./payment-schedule";

/**
 * Поля строки графика, изменение которых видит пользователь.
 *
 * `position` здесь наравне с полями формы: перестановка строки — такое же
 * видимое изменение, и в ленте она описывается тем же событием со своей строкой
 * таблицы изменений. Служебные колонки (`updated_at`, `deleted_at`, `org_id`,
 * `project_id`, `created_by`) сюда не входят: их пишет сама операция, а не
 * пользователь.
 */
export const PAYMENT_PLAN_PATCH_FIELDS = [
  "title",
  "amount",
  "condition",
  "due_date",
  "position",
] as const;

export type PaymentPlanPatchField =
  (typeof PAYMENT_PLAN_PATCH_FIELDS)[number];

/** Изменение одного поля строки графика — в том же виде, что у остальных событий. */
export type PaymentPlanFieldChange = {
  field: PaymentPlanPatchField;
  from: unknown;
  to: unknown;
};

/** Снимок строки графика для события журнала. */
export type PaymentPlanEventSnapshot = {
  planId: string;
  title: string;
  amount: number;
  condition: string | null;
  dueDate: string | null;
  position: number;
};
