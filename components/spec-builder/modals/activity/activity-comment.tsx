"use client";

import { Button } from "@/components/ui/button";
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
import { isOptimisticCommentId } from "@/lib/spec/comment-write";
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
 *
 * Компонент ничего не знает о создании комментариев: он зовёт `onReply` и
 * забывает. Отправка, optimistic-запись и server action живут выше, в
 * `ActivityTab` и его хуке, поэтому renderer остаётся отображением.
 */
export default function ActivityComment({
  comment,
  replies,
  onReply,
  replyCountOverride,
}: {
  comment: HistoryCommentEntry;
  replies: readonly ActivityReplyItem[];
  /** Начать ответ на комментарий или на один из его ответов. */
  onReply?: (comment: HistoryCommentEntry) => void;
  /**
   * `replyCount` с учётом ещё не подтверждённых ответов. Приходит сверху и
   * только на время отправки: сам комментарий — снимок из read-layer'а, и
   * переписывать его здесь нельзя.
   */
  replyCountOverride?: number;
}) {
  const author = formatActivityActor(comment.actor);
  const replyCount = replyCountOverride ?? comment.replyCount;

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

          {replyCount > 0 && (
            <p className="text-[11.5px] text-fg-muted">
              {replyCount} {plural(replyCount, "ответ", "ответа", "ответов")}
            </p>
          )}

          {/*
            Действия — только у подтверждённых записей: у временной
            optimistic-записи своего `id` нет, отвечать на неё нечем.
          */}
          {onReply && !isOptimisticCommentId(comment.id) && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-fg-muted"
                onClick={() => onReply(comment)}
              >
                Ответить
              </Button>
            </div>
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
              onReply={onReply}
            />
          ))}
        </div>
      )}
    </div>
  );
}
