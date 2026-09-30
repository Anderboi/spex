"use client";

import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import ActivityMeta from "./activity-meta";
import ActivityReply from "./activity-reply";
import {
  formatActivityActor,
  plural,
} from "@/lib/spec/activity-format";
import type { ActivityReplyItem } from "@/lib/spec/activity-view";
import type { HistoryCommentEntry } from "@/lib/spec/history-types";

/**
 * Корневой комментарий вместе со своей веткой.
 *
 * Комментарий — самое «тяжёлое» в ленте: аватар с инициалами, автор, текст.
 * Системное событие рядом с ним специально компактнее (`ActivityEvent`), поэтому
 * их структура разная: `Message` — про содержание, `Marker` — про факт.
 *
 * Удалённый комментарий остаётся в ленте: он часть хронологии, а его ответы
 * никуда не деваются. Текст удалённого не показывается — только пометка.
 *
 * `replyCount` приходит из read-layer'а (`0` при ошибке подсчёта) и включает
 * удалённые ответы. Отдельного запроса на комментарий нет, поэтому счётчик
 * показывается всегда, а не только когда ветка видна на этой странице.
 */
export default function ActivityComment({
  comment,
  replies,
}: {
  comment: HistoryCommentEntry;
  replies: readonly ActivityReplyItem[];
}) {
  const author = formatActivityActor(comment.actor);

  return (
    <div className="flex flex-col gap-3">
      <Message className="gap-2">
        <MessageAvatar className="size-7 self-start text-[10px] font-semibold text-fg-secondary">
          <span aria-hidden="true">{author.initials ?? "—"}</span>
        </MessageAvatar>

        <MessageContent className="gap-1.5">
          <MessageHeader className="px-0">
            <ActivityMeta
              actor={comment.actor}
              createdAt={comment.createdAt}
              editedAt={comment.editedAt}
              className="w-full"
            />
          </MessageHeader>

          {comment.deleted ? (
            <p className="text-[13.5px] text-fg-muted italic">
              Комментарий удалён
            </p>
          ) : (
            <p className="text-[13.5px] text-fg wrap-break-word">
              {comment.body}
            </p>
          )}

          {comment.replyCount > 0 && (
            <p className="text-[11.5px] text-fg-muted">
              {comment.replyCount}{" "}
              {plural(comment.replyCount, "ответ", "ответа", "ответов")}
            </p>
          )}
        </MessageContent>
      </Message>

      {replies.length > 0 && (
        <div className="flex flex-col gap-3 border-l border-border-muted pl-3">
          {replies.map((item) => (
            <ActivityReply
              key={item.id}
              reply={item.reply}
              parent={item.parent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
