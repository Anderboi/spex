"use client";

import { Button } from "@/components/ui/button";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import ActivityMeta from "./activity-meta";
import { activityQuoteText } from "@/lib/spec/activity-view";
import { formatActivityActor } from "@/lib/spec/activity-format";
import { isOptimisticCommentId } from "@/lib/spec/comment-write";
import type { HistoryCommentEntry } from "@/lib/spec/history-types";

/**
 * Ответ в ветке.
 *
 * Вложенность ограничена одним уровнем: ответ всегда рисуется одинаково и не
 * порождает третьего уровня. Цитата родителя берётся из снимка, который уже
 * прочитан страницей (`activityQuoteText`): отдельного запроса за удалённым или
 * не попавшим на страницу родителем нет — если снимка нет, показывается `—`.
 */
export default function ActivityReply({
  reply,
  parent,
  onReply,
}: {
  reply: HistoryCommentEntry;
  /** Снимок родителя для цитаты; `null` — родителя нет в прочитанном. */
  parent: HistoryCommentEntry | null;
  /** Начать ответ внутри той же ветки; сервер сам приведёт его к корню. */
  onReply?: (comment: HistoryCommentEntry) => void;
}) {
  const quote = activityQuoteText(parent);
  const author = formatActivityActor(reply.actor);

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
          а `line-clamp` обрезает её по ширине ветки.
        */}
        <span
          className="line-clamp-2 border-l-2 border-border-muted pl-2.5 text-[12px] text-fg-muted"
          title={quote}
        >
          {quote}
        </span>

        {reply.deleted ? (
          <p className="text-[13px] text-fg-muted italic">Комментарий удалён</p>
        ) : (
          <p className="text-[13px] text-fg wrap-break-word">{reply.body}</p>
        )}

        {/* Ответ на ответ разрешён: ветка остаётся плоской, третий уровень не
            появляется ни здесь, ни на сервере. */}
        {onReply && !isOptimisticCommentId(reply.id) && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="self-start text-fg-muted"
            onClick={() => onReply(reply)}
          >
            Ответить
          </Button>
        )}
      </MessageContent>
    </Message>
  );
}
