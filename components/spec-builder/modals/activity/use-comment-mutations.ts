"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
  deleteSpecItemComment,
  updateSpecItemComment,
} from "@/actions/spec-comments";
import {
  createDeleteMutation,
  createEditMutation,
  markMutationPending,
  type PendingCommentMutation,
  type PendingCommentMutations,
} from "@/lib/spec/comment-mutation-model";
import {
  beginCommentRequest,
  isCommentRequestCurrent,
  type CommentRequestToken,
  type CommentRequestTokens,
} from "@/lib/spec/comment-request-tokens";
import { checkComposerBody } from "@/lib/spec/comment-write";
import type { HistoryCommentEntry } from "@/lib/spec/history-types";

/**
 * Правка и удаление комментариев: состояние операций и вызовы server action.
 *
 * ── Где живёт состояние ───────────────────────────────────────────────────
 *
 * Подтверждённые записи остаются в `ActivityTab` (`records`), а незавершённые
 * операции — здесь, в `Map<commentId, PendingCommentMutation>`. Никакой второй
 * копии ленты нет: отображение собирает `applyCommentMutations`, а откат — это
 * просто удаление записи из Map, после чего лента снова берётся из `records`.
 *
 * ── Почему по одной операции на комментарий ───────────────────────────────
 *
 * Ключ Map — `commentId`, поэтому у одного комментария физически не может быть
 * двух операций: начатая правка вытесняет попытку удаления и наоборот, а
 * `pending` запрещает повторный запуск той же операции. Остальные комментарии
 * при этом не блокируются — у каждого своя запись в Map.
 *
 * ── Тексты ошибок ─────────────────────────────────────────────────────────
 *
 * `INVALID_INPUT` остаётся в режиме правки: это про введённый текст, и
 * пользователь должен его увидеть рядом с полем, не потеряв набранное.
 * Остальное (`FORBIDDEN`, `NOT_FOUND`, `FAILED`, исключение) — уведомление:
 * исправлять в поле нечего. Внутренние тексты БД сервер не отдаёт.
 */
export function useCommentMutations(args: {
  orgSlug: string;
  specItemId: string;
  /** Серверная запись заменяет подтверждённую в ленте. */
  onUpdated: (comment: HistoryCommentEntry) => void;
}) {
  const { orgSlug, specItemId, onUpdated } = args;

  const [mutations, setMutations] = useState<PendingCommentMutations>(
    () => new Map(),
  );
  /** Комментарий, у которого открыт режим правки. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Текст в поле правки. Живёт отдельно от операции: при отказе не теряется. */
  const [editBody, setEditBody] = useState("");
  /** Ошибка ввода в режиме правки — показывается рядом с полем. */
  const [editError, setEditError] = useState<string | null>(null);
  /** Комментарий, для которого открыт диалог подтверждения удаления. */
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  /**
   * Токены запросов — ПО КАЖДОМУ комментарию.
   *
   * Общий счётчик на все комментарии делал операции независимых записей взаимно
   * устаревающими: правка A и удаление B получали номера 1 и 2, и ответ A
   * сравнивался с номером B. Ответ признавался устаревшим и выходил, не сняв
   * `pending`, — операция A оставалась «в полёте» навсегда.
   *
   * Здесь номер свой у каждого `commentId`, поэтому инвалидирует операцию
   * только новая операция ТОГО ЖЕ комментария (правило «одна активная операция
   * на комментарий»). См. `@/lib/spec/comment-request-tokens`.
   */
  const requestTokensRef = useRef<CommentRequestTokens>(new Map());

  /** Начать запрос по комментарию: вернуть его токен. */
  const beginRequest = useCallback((commentId: string) => {
    const { token, tokens } = beginCommentRequest(
      requestTokensRef.current,
      commentId,
    );
    requestTokensRef.current = tokens;
    return token;
  }, []);

  /** Актуален ли ответ: устаревший не трогает ничего. */
  const isCurrent = useCallback((token: CommentRequestToken) => {
    return isCommentRequestCurrent(requestTokensRef.current, token);
  }, []);

  const setMutation = useCallback(
    (mutation: PendingCommentMutation | null, commentId: string) => {
      setMutations((current) => {
        const next = new Map(current);
        if (mutation) next.set(commentId, mutation);
        else next.delete(commentId);
        return next;
      });
    },
    [],
  );

  /** Открыть режим правки с текущим текстом комментария. */
  const startEdit = useCallback((comment: HistoryCommentEntry) => {
    setEditingId(comment.id);
    setEditBody(comment.body);
    setEditError(null);
    setConfirmingDeleteId(null);
  }, []);

  const changeEditBody = useCallback((value: string) => {
    setEditBody(value);
    // Ошибку ввода снимаем, как только пользователь начал исправлять текст.
    setEditError(null);
  }, []);

  /** Закрыть режим правки, ничего не сохраняя. */
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditBody("");
    setEditError(null);
  }, []);

  /**
   * Сохранить правку.
   *
   * Порядок: optimistic-состояние → запрос → серверная запись либо откат.
   * Возвращается `true` при успехе — вызывающему это нужно, чтобы закрыть
   * режим правки только после подтверждения сервера.
   */
  const submitEdit = useCallback(
    async (commentId: string): Promise<boolean> => {
      const existing = mutations.get(commentId);
      if (existing?.pending) return false;

      const check = checkComposerBody(editBody);
      if (!check.ok) {
        setEditError(check.message);
        return false;
      }

      const mutation = markMutationPending(createEditMutation(commentId, check.body));
      const token = beginRequest(commentId);
      setMutation(mutation, commentId);
      setEditError(null);

      try {
        const res = await updateSpecItemComment(
          orgSlug,
          specItemId,
          commentId,
          { body: check.body },
        );
        // Проверка ДО первого изменения состояния: устаревший ответ не снимает
        // `pending` новой операции, не применяет свой результат и не показывает
        // свою ошибку.
        if (!isCurrent(token)) return false;

        setMutation(null, commentId);

        if (!res.success) {
          // Текст остаётся в поле: пользователь не должен набирать его заново.
          if (res.code === "INVALID_INPUT") {
            setEditError(res.error);
          } else {
            toast.error(res.error);
          }
          return false;
        }

        // В ленту идёт серверная запись целиком: серверные `editedAt` и всё
        // остальное, чего клиент не знает.
        onUpdated(res.data);
        setEditingId(null);
        setEditBody("");
        return true;
      } catch (cause) {
        if (!isCurrent(token)) return false;
        console.error("[useCommentMutations] edit", cause);
        setMutation(null, commentId);
        toast.error("Не удалось сохранить комментарий");
        return false;
      }
    },
    [mutations, editBody, orgSlug, specItemId, onUpdated, setMutation, beginRequest, isCurrent],
  );

  /** Открыть подтверждение удаления (без него комментарий не удаляется). */
  const requestDelete = useCallback((comment: HistoryCommentEntry) => {
    setConfirmingDeleteId(comment.id);
    // Удаление и правка одного комментария несовместимы: режим правки
    // закрывается, чтобы у `commentId` осталась одна активная операция.
    setEditingId(null);
    setEditError(null);
  }, []);

  const cancelDelete = useCallback(() => {
    setConfirmingDeleteId(null);
  }, []);

  /** Подтверждённое удаление: optimistic `deleted` → запрос → серверная запись. */
  const confirmDelete = useCallback(
    async (commentId: string): Promise<boolean> => {
      const existing = mutations.get(commentId);
      if (existing?.pending) return false;

      const mutation = markMutationPending(createDeleteMutation(commentId));
      const token = beginRequest(commentId);
      setMutation(mutation, commentId);

      try {
        const res = await deleteSpecItemComment(orgSlug, specItemId, commentId);
        if (!isCurrent(token)) return false;

        setMutation(null, commentId);

        if (!res.success) {
          toast.error(res.error);
          return false;
        }

        onUpdated(res.data);
        setConfirmingDeleteId(null);
        return true;
      } catch (cause) {
        if (!isCurrent(token)) return false;
        console.error("[useCommentMutations] delete", cause);
        setMutation(null, commentId);
        toast.error("Не удалось удалить комментарий");
        return false;
      }
    },
    [mutations, orgSlug, specItemId, onUpdated, setMutation, beginRequest, isCurrent],
  );

  return {
    mutations,
    editingId,
    editBody,
    editError,
    confirmingDeleteId,
    /** Идёт ли запрос удаления: диалог подтверждения блокирует кнопки. */
    isDeletePending:
      confirmingDeleteId !== null &&
      mutations.get(confirmingDeleteId)?.pending === true,
    startEdit,
    changeEditBody,
    cancelEdit,
    submitEdit,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}
