"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { createSpecItemComment } from "@/actions/spec-comments";
import {
  buildOptimisticComment,
  checkComposerBody,
  type CommentAuthor,
} from "@/lib/spec/comment-write";
import type { HistoryCommentEntry } from "@/lib/spec/history-types";

/**
 * Состояние composer'а комментариев и отправка.
 *
 * ── Что здесь есть ─────────────────────────────────────────────────────────
 *
 * Текст, режим ответа, ошибка и ОДНА незавершённая отправка. Хук ничего не
 * рендерит и не знает о `MessageScroller`: это слой между UI и server action —
 * тот самый `UI → submit handler → createSpecItemComment → HistoryCommentEntry
 * → feed state` из архитектуры. Рендерер события/комментария про server action
 * не знает вовсе.
 *
 * ── Optimistic ─────────────────────────────────────────────────────────────
 *
 * Временная запись показывается сразу и живёт в `optimistic` — ОТДЕЛЬНО от
 * подтверждённых `records` в `ActivityTab`. Это важнее, чем кажется:
 *
 *   * серверный `HistoryCommentEntry` приходит целиком, и он не
 *     реконструируется из ввода — ввод нужен только для предпросмотра;
 *   * `nextCursor` и вся остальная пагинация не трогаются, потому что
 *     подтверждённый список меняется ровно одной операцией (добавление
 *     серверной записи) и никогда не сбрасывается;
 *   * при ошибке временная запись просто исчезает из `optimistic`, и
 *     подтверждённое состояние остаётся ровно таким, каким было.
 *
 * После успеха серверная запись дописывается в `records` через `onCreated`, а
 * временная убирается: `buildActivityFeed` раскладывает её по ветке сам — для
 * нового корня это верх ленты, для ответа — конец своей ветки.
 */
export type ReplyTarget = {
  /** Комментарий, на который отвечают: он же уходит на сервер как `parentId`. */
  comment: HistoryCommentEntry;
};

export function useCommentComposer(args: {
  orgSlug: string;
  orgId: string;
  specItemId: string;
  /** Автор для предпросмотра; окончательный actor приходит с сервера. */
  author: CommentAuthor;
  /** Подтверждённая запись от сервера: попадает в ленту как есть. */
  onCreated: (comment: HistoryCommentEntry) => void;
}) {
  const { orgSlug, orgId, specItemId, author, onCreated } = args;

  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  /** Незавершённая отправка: ровно одна, её и показываем в ленте. */
  const [optimistic, setOptimistic] = useState<HistoryCommentEntry | null>(null);

  /**
   * Защита от гонки: ответ устаревшей отправки не должен трогать состояние
   * новой. Отправка блокируется на время запроса, но смена позиции или
   * размонтирование вкладки происходят независимо.
   */
  const attemptRef = useRef(0);

  const cancelReply = useCallback(() => {
    setReplyTarget(null);
    setError(null);
  }, []);

  const startReply = useCallback((comment: HistoryCommentEntry) => {
    setReplyTarget({ comment });
    setError(null);
  }, []);

  const changeBody = useCallback((value: string) => {
    setBody(value);
    // Ошибку ввода снимаем, как только пользователь начал исправлять текст:
    // держать её до следующей отправки значит спорить с человеком.
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (pending) return;

    const check = checkComposerBody(body);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    const attempt = ++attemptRef.current;
    const parent = replyTarget?.comment ?? null;
    const createdAt = new Date().toISOString();

    // Предпросмотр появляется до ответа сервера; ветка выводится из родителя
    // той же формулой, что и на сервере.
    const preview = buildOptimisticComment({
      orgId,
      specItemId,
      author: { id: author.id, name: author.name },
      body: check.body,
      parent: parent
        ? { id: parent.id, parentId: parent.parentId, rootId: parent.rootId }
        : null,
      createdAt,
    });

    setPending(true);
    setError(null);
    setOptimistic(preview);

    try {
      const res = await createSpecItemComment(orgSlug, specItemId, {
        body: check.body,
        // Серверу уходит только `parentId`: `rootId` он выводит сам.
        parentId: parent?.id ?? null,
      });

      if (attempt !== attemptRef.current) return;

      if (!res.success) {
        setOptimistic(null);
        // `FAILED` — не ошибка ввода: подсвечивать поле нечем, поэтому это
        // уведомление. Внутренние детали БД до пользователя не доходят —
        // сервер уже отдал безопасный текст.
        if (res.code === "FAILED" || res.code === undefined) {
          toast.error(res.error);
        } else {
          setError(res.error);
        }
        return;
      }

      // Успех: в ленту идёт серверная запись (с серверными `id`, `createdAt` и
      // снимком автора), а не предпросмотр.
      onCreated(res.data);
      setOptimistic(null);
      setBody("");
      setReplyTarget(null);
    } catch (cause) {
      if (attempt !== attemptRef.current) return;
      console.error("[useCommentComposer]", cause);
      setOptimistic(null);
      toast.error("Не удалось отправить комментарий");
    } finally {
      if (attempt === attemptRef.current) setPending(false);
    }
  }, [
    pending,
    body,
    replyTarget,
    orgId,
    specItemId,
    author.id,
    author.name,
    orgSlug,
    onCreated,
  ]);

  return {
    body,
    error,
    pending,
    replyTarget,
    optimistic,
    /** Способен ли composer отправить текущий текст. */
    canSubmit: checkComposerBody(body).ok,
    changeBody,
    startReply,
    cancelReply,
    submit,
  };
}
