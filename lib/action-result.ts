/**
 * Машиночитаемая причина отказа. Клиенту иногда мало текста: одно и то же
 * «не получилось» требует разного поведения в UI (например, «материал уже
 * в проекте» — это не ошибка ввода, а состояние, которое надо показать в
 * списке, а не только тостом). Текст остаётся для человека, код — для логики.
 */
export type ActionErrorCode =
  | "ALREADY_IN_PROJECT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT";

export type ActionResult<T = null> =
  | { success: true; data: T }
  | { success: false; error: string; code?: ActionErrorCode };

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}
export function fail<T = never>(
  error: string,
  code?: ActionErrorCode,
): ActionResult<T> {
  return code ? { success: false, error, code } : { success: false, error };
}
