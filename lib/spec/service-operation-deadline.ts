import type { ServiceOperationType } from "@/lib/constants";

/**
 * Срок операции (service_operations.deadline) как состояние UI: «сегодня»,
 * «просрочено N дн.», «через N дн.» — или отсутствие состояния.
 *
 * Модуль существует ради одного правила: завершённая доставка не имеет
 * активного дедлайна. Раньше расчёт жил прямо в строке услуг и сравнивал
 * плановую дату с текущей всегда, поэтому исполненная доставка с прошедшей
 * датой показывала «просрочено 11 дн.». Здесь сравнение с текущей датой
 * выполняется только после проверки терминального состояния, а сама плановая
 * дата не удаляется и не меняется — она остаётся историческими данными
 * (видна в модалке операции, в расходах проекта и в сводке).
 *
 * ── Почему терминальным считается completed, а не status ───────────────────
 *
 * В модели service_operations отдельной колонки status нет. Терминальное
 * состояние доставки — отметка `completed` («Исполнено»): при её сохранении
 * связанные материалы получают статус «Доставлено» (`delivered`), см.
 * createServiceOperation/updateServiceOperation в actions/service-operations.
 * Другие типы операций этой отметкой не завершаются: чекбокс «Исполнено» есть
 * только у доставки, а «Монтаж» и своя услуга завершающего статуса не имеют.
 */

/**
 * Поля операции, от которых зависит срок. Структурный минимум: модуль не
 * зависит от server action и принимает и полный ServiceOperation, и урезанный
 * объект в тестах.
 */
export type DeadlineOperation = {
  type: ServiceOperationType;
  /** Отметка «Исполнено» — терминальное состояние доставки. */
  completed: boolean;
  /** Плановая дата, 'YYYY-MM-DD'. null — срока нет. */
  deadline: string | null;
};

/** Состояние срока: текст для строки услуги и признак «просрочено». */
export type DeadlineNote = {
  text: string;
  overdue: boolean;
};

/**
 * Доставка завершена («Доставлено»). Только доставка: у остальных типов
 * операций отметка completed семантики не несёт и терминальной не считается.
 */
export function isCompletedDelivery(op: {
  type: ServiceOperationType;
  completed: boolean;
}): boolean {
  return op.type === "delivery" && op.completed;
}

/**
 * Срок операции или null, если показывать его как активный дедлайн нельзя:
 * дата не задана либо доставка уже завершена.
 *
 * `now` — только для тестов; без него берётся текущая дата.
 */
export function serviceOperationDeadline(
  op: DeadlineOperation,
  now: Date = new Date(),
): DeadlineNote | null {
  if (!op.deadline) return null;
  // Завершённая доставка: дата — история, а не дедлайн, поэтому ни «через»,
  // ни «просрочено» не считаются и текущая дата на результат не влияет.
  if (isCompletedDelivery(op)) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${op.deadline}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days === 0) return { text: "сегодня", overdue: false };
  if (days < 0) return { text: `просрочено ${-days} дн.`, overdue: true };
  return { text: `через ${days} дн.`, overdue: false };
}
