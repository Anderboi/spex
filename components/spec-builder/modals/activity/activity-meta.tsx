"use client";

import {
  formatActivityActor,
  formatActivityDateTime,
} from "@/lib/spec/activity-format";
import { cn } from "@/lib/utils";

/**
 * Строка «автор + время», общая для событий и комментариев.
 *
 * Автор берётся ТОЛЬКО из снимка записи (`actor_name_snapshot`): пользователя
 * могли переименовать или удалить, а история обязана остаться прежней. Поэтому
 * здесь нет ни запросов, ни обращений к текущему профилю.
 *
 * `avatar` выключается у системных событий: там роль «кто» несёт иконка
 * `Marker`, и второй аватар только шумит.
 */
export default function ActivityMeta({
  actor,
  createdAt,
  editedAt,
  avatar = false,
  className,
}: {
  actor: { id: string | null; name: string | null };
  createdAt: string;
  /** Время правки комментария: рядом со временем появляется «изменён». */
  editedAt?: string | null;
  /** Показывать ли инициалы автора. */
  avatar?: boolean;
  className?: string;
}) {
  const author = formatActivityActor(actor);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted",
        className,
      )}
    >
      {avatar && (
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-bg-muted text-[10px] font-semibold text-fg-secondary"
        >
          {author.initials ?? "—"}
        </span>
      )}

      <span className="min-w-0 truncate font-medium text-fg-secondary">
        {author.name}
      </span>

      <time dateTime={createdAt} className="shrink-0 tabular-nums">
        {formatActivityDateTime(createdAt)}
      </time>

      {editedAt ? <span className="shrink-0">· изменён</span> : null}
    </div>
  );
}
