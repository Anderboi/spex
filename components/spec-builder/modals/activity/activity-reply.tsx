"use client";

import { Button } from "@/components/ui/button";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import ActivityMeta from "./activity-meta";
import CommentActions from "./comment-actions";
import CommentEditForm from "./comment-edit-form";
import { activityQuoteText } from "@/lib/spec/activity-view";
import { formatActivityActor } from "@/lib/spec/activity-format";
import type { CommentMutationSlots } from "./comment-actions";
import { isEditingComment } from "@/lib/spec/comment-mutation-model";
import { isOptimisticCommentId } from "@/lib/spec/comment-write";
import type { HistoryCommentEntry } from "@/lib/spec/history-types";

/**
 * Ответ в ветке.
 *
 * Вложенность ограничена одним уровнем: ответ всегда рисуется одинаково и не
 * порождает третьего уровня. Цитата родителя берётся из снимка, который уже
 * прочитан страницей (`activityQuoteText`): отдельного запроса за удалённым или
 * не попавшим на страницу родителем нет — если снимка нет, показывается `—`.
 *
 * Правила действий те же, что у корневого комментария: ответить можно на любой
 * подтверждённый ответ, изменить и удалить — только свой. Правка меняет текст
 * на месте и не трогает ветку: `parentId`/`rootId` в предпросмотре не меняются.
 */
export default function ActivityReply({
  reply,
  parent,
  onReply,
  mutation,
}: {
  reply: HistoryCommentEntry;
  /** Снимок родителя для цитаты; `null` — родителя нет в прочитанном. */
  parent: HistoryCommentEntry | null;
  /** Начать ответ внутри той же ветки; сервер сам приведёт его к корню. */
  onReply?: (comment: HistoryCommentEntry) => void;
  /** Действия и режим правки; `undefined` — лента их не предоставляет. */
  mutation?: CommentMutationSlots;
}) {
  const quote = activityQuoteText(parent);
  const author = formatActivityActor(reply.actor);
  // Правка — только у подтверждённой записи: у временной optimistic-записи
  // своего `id` на сервере ещё нет.
  const confirmed = !isOptimisticCommentId(reply.id);
  const editing =
    confirmed &&
    mutation !== undefined &&
    isEditingComment({ commentId: reply.id, editingId: mutation.editingId });

  return (
    <Message className="gap-2">
      <MessageAvatar className="size-6 self-start text-[10px] font-semibold text-fg-secondary">
        <span aria-hidden="true">{author.initials ?? "—"}</span>
      </MessageAvatar>

      <MessageContent className="gap-1.5">
        <MessageHeader className="px-0">
          <ActivityMeta
            actor={reply.actor}
            createdAt={reply.createdAt}
            editedAt={reply.editedAt}
          />
        </MessageHeader>

        {/*
          Цитата — одна строка с обрезкой: ответ не должен занимать больше
          места, чем сам комментарий. Текст в `span` держит цитату строчной,
          а `line-clamp` обрезает её по ширине ветки. Во время правки цитата
          скрывается: место занимает поле ввода, а сама цитата про родителя.
        */}
        {!editing && (
          <span
            className="line-clamp-2 border-l-2 border-border-muted pl-2.5 text-[12px] text-fg-muted"
            title={quote}
          >
            {quote}
          </span>
        )}

        {editing && mutation ? (
          <CommentEditForm
            value={mutation.editBody}
            error={mutation.editError}
            pending={mutation.isPending(reply.id)}
            onChange={mutation.changeEditBody}
            onSubmit={() => void mutation.submitEdit(reply.id)}
            onCancel={mutation.cancelEdit}
            ariaLabel="Текст ответа"
          />
        ) : reply.deleted ? (
          <p className="text-[13px] text-fg-muted italic">Комментарий удалён</p>
        ) : (
          <p className="text-[13px] text-fg wrap-break-word">{reply.body}</p>
        )}

        {/* Ответ на ответ разрешён: ветка остаётся плоской, третий уровень не
            появляется ни здесь, ни на сервере. */}
        {confirmed && !editing && (onReply || mutation?.canMutate(reply)) && (
          <div className="flex items-center gap-1">
            {onReply && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-fg-muted"
                onClick={() => onReply(reply)}
              >
                Ответить
              </Button>
            )}
            {mutation?.canMutate(reply) && (
              <CommentActions
                comment={reply}
                disabled={mutation.isPending(reply.id)}
                onEdit={mutation.startEdit}
                onDelete={mutation.requestDelete}
              />
            )}
          </div>
        )}
      </MessageContent>
    </Message>
  );
}
