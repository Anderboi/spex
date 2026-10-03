/**
 * Модель правки и мягкого удаления комментария в ленте: чистые переходы.
 *
 * ── Зачем отдельный модуль ────────────────────────────────────────────────
 *
 * React-тестов в проекте нет, поэтому переходы «что показываем, пока запрос в
 * полёте» и «как откатываемся» вынесены сюда чистыми функциями и покрыты
 * обычным Vitest. Хук (`use-comment-mutations`) остаётся тонкой обвязкой:
 * вызвать server action и разложить результат по состоянию.
 *
 * ── Как устроен optimistic ────────────────────────────────────────────────
 *
 * Никакой второй копии ленты нет. Подтверждённые записи остаются в `records`
 * как есть, а незавершённые операции лежат ОТДЕЛЬНО — по одной на `commentId`
 * (`PendingCommentMutation`). Отображение собирается применением этих операций
 * к записям (`applyCommentMutations`), поэтому:
 *
 *   * источник подтверждённых данных один — сервер;
 *   * откат не требует ничего «возвращать»: достаточно убрать операцию, и
 *     отображение само снова берётся из `records`;
 *   * один комментарий не может иметь двух активных операций (ключ — `id`);
 *   * остальные записи ленты не блокируются и не меняются.
 *
 * Правка меняет только `body`. `createdAt`, автор, `parentId`/`rootId` и
 * `replyCount` не трогаются даже в предпросмотре — именно поэтому структура
 * ветки и счётчик ответов не могут разъехаться. `editedAt` в предпросмотре НЕ
 * подставляется: серверная метка приходит ответом, и выдумывать её на клиенте
 * значило бы показывать время, которого нет.
 *
 * Удаление меняет только признак `deleted`: ветка, автор и время остаются, а
 * текст скрывает рендерер (как и для удалённого комментария, пришедшего с
 * сервера).
 *
 * Возвращается НОВЫЙ объект: исходная запись (снимок из read-layer'а) не
 * мутируется.
 */

import type { ActivityRecord } from "./activity-format";
import type { HistoryCommentEntry } from "./history-types";

export type PendingCommentMutation = {
  commentId: string;
  /**
   * `edit` — сохраняется новый текст; `delete` — мягкое удаление.
   * Обе операции взаимоисключающие для одного `commentId`.
   */
  type: "edit" | "delete";
  /** Текст правки. У `delete` не используется. */
  body: string;
  /** Запрос в полёте: UI блокирует повторное действие. */
  pending: boolean;
};

/** Операции по `commentId`: одна на комментарий. */
export type PendingCommentMutations = ReadonlyMap<
  string,
  PendingCommentMutation
>;

/** Операция правки для `commentId` (ещё не в полёте). */
export function createEditMutation(
  commentId: string,
  body: string,
): PendingCommentMutation {
  return { commentId, type: "edit", body, pending: false };
}

/** Операция удаления для `commentId`. */
export function createDeleteMutation(commentId: string): PendingCommentMutation {
  return { commentId, type: "delete", body: "", pending: false };
}

/**
 * Применить незавершённую операцию к подтверждённой записи.
 *
 * Без операции запись возвращается как есть (та же ссылка — React не увидит
 * лишнего изменения). С операцией собирается НОВЫЙ объект.
 */
export function applyCommentMutation(
  comment: HistoryCommentEntry,
  mutation: PendingCommentMutation | undefined,
): HistoryCommentEntry {
  if (!mutation) return comment;
  if (mutation.type === "edit") {
    // Предпросмотр показывает ровно то, что пользователь набрал: `body`.
    // `editedAt` появится только из серверного ответа.
    return { ...comment, body: mutation.body };
  }
  return { ...comment, deleted: true };
}

/**
 * Записи ленты с применёнными незавершёнными операциями.
 *
 * Работает со всей лентой, а не только с комментариями: события операций не
 * имеют, и запись без операции возвращается как есть — той же ссылкой, поэтому
 * React не увидит лишних изменений. Порядок и состав сохраняются, поэтому
 * `buildActivityFeed` раскладывает всё по тем же местам, а ветка и `replyCount`
 * не пересчитываются — эти операции их не касаются.
 */
export function applyCommentMutations(
  records: readonly ActivityRecord[],
  mutations: PendingCommentMutations,
): ActivityRecord[] {
  if (mutations.size === 0) return records.slice();
  return records.map((record): ActivityRecord => {
    const mutation = mutations.get(record.id);
    if (!mutation) return record;
    // Операции бывают только у комментариев: `commentId` приходит из записи
    // `source: "comment"`. Проверка нужна для типовой полноты — иначе запись
    // события прошла бы через преобразование комментария.
    if (record.source !== "comment") return record;
    return applyCommentMutation(record, mutation);
  });
}

/** Отметить операцию как выполняющуюся (после этого повторный запуск запрещён). */
export function markMutationPending(
  mutation: PendingCommentMutation,
): PendingCommentMutation {
  return { ...mutation, pending: true };
}

/**
 * Доступна ли правка/удаление.
 *
 * Это UX-условие, а не граница безопасности: сервер проверяет авторство сам и
 * повторит отказ, даже если кнопку показать. Правило то же, что у
 * `canEditComment` в mutation-layer'е: только автор и только живая запись.
 */
export function canMutateComment(args: {
  comment: HistoryCommentEntry;
  currentUserId: string | null;
}): boolean {
  const { comment, currentUserId } = args;
  if (comment.deleted) return false;
  if (comment.actor.id === null) return false;
  return comment.actor.id === currentUserId;
}

/**
 * Открыт ли режим правки этого комментария.
 *
 * Правка остаётся открытой и во время запроса, и после отказа — введённый
 * пользователем текст не должен пропадать. Закрывается она только по «Отмена».
 */
export function isEditingComment(args: {
  commentId: string;
  editingId: string | null;
}): boolean {
  return args.editingId === args.commentId;
}
