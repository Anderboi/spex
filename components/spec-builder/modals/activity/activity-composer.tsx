"use client";

import { Reply, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_LIMITS } from "@/lib/spec/comment-write";
import { activityQuoteText } from "@/lib/spec/activity-view";
import { formatActivityActor } from "@/lib/spec/activity-format";
import type { HistoryCommentEntry } from "@/lib/spec/history-types";

/**
 * Composer комментария: создание корневого комментария и ответа.
 *
 * Компонент презентационный: он показывает текст, режим ответа и ошибку, а
 * вызывает `onSubmit` / `onChangeBody` / `onCancelReply`. Отправкой, optimistic
 * записью и server action занимается `useCommentComposer` в `ActivityTab` —
 * поэтому этот файл не импортирует ни одного action.
 *
 * ── Клавиатура ─────────────────────────────────────────────────────────────
 *
 * `Enter` отправляет, `Shift+Enter` переносит строку. То же поведение у формы
 * отправки сообщений в остальных интерфейсах, и оно ожидаемо в поле, которое
 * живёт под лентой. Во время отправки поле и кнопка выключены, поэтому второе
 * нажатие Enter не создаёт второй комментарий.
 */

/** Кнопка отправки активна, только если текст не пустой после trim. */
export default function ActivityComposer({
  value,
  onChange,
  onSubmit,
  onCancelReply,
  replyTo,
  pending,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Выход из режима ответа: composer возвращается к корневому комментарию. */
  onCancelReply: () => void;
  /** Комментарий, на который отвечают; `null` — обычный режим. */
  replyTo: HistoryCommentEntry | null;
  pending: boolean;
  /** Ошибка отправки, которую показываем рядом с полем. */
  error: string | null;
}) {
  const hasText = value.trim().length > 0;
  const canSubmit = hasText && !pending;

  /** Пустой и пробельный текст не отправляется — ни по кнопке, ни по Enter. */
  const requestSubmit = () => {
    if (!canSubmit) return;
    onSubmit();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // `Enter` — отправка, `Shift+Enter` — перенос строки. `isComposing`
    // отсекает подтверждение ввода в IME: там Enter завершает набор, а не
    // отправляет текст.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    requestSubmit();
  };

  const replyAuthor = replyTo ? formatActivityActor(replyTo.actor).name : null;
  const replyQuote = replyTo ? activityQuoteText(replyTo) : null;

  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t border-border-muted p-3"
      onSubmit={(event) => {
        event.preventDefault();
        requestSubmit();
      }}
    >
      {replyTo && (
        <div className="flex items-start gap-2 rounded-lg border border-border-muted bg-bg-card2 px-2.5 py-2">
          <Reply className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[11.5px] font-medium text-fg-secondary">
              Ответ на {replyAuthor}
            </span>
            {/* Цитата — из снимка записи, отдельного запроса за ней нет. */}
            <span className="line-clamp-2 text-[11.5px] text-fg-muted" title={replyQuote ?? ""}>
              {replyQuote}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-fg-muted"
            aria-label="Отменить ответ"
            disabled={pending}
            onClick={onCancelReply}
          >
            <X />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
          rows={2}
          maxLength={COMMENT_LIMITS.bodyMax}
          aria-label={replyTo ? "Текст ответа" : "Текст комментария"}
          aria-invalid={error !== null}
          placeholder={
            replyTo ? "Напишите ответ…" : "Написать комментарий…"
          }
          className="min-h-16 resize-none"
        />

        <Button type="submit" size="sm" disabled={!canSubmit}>
          {pending ? "Отправка…" : "Отправить"}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-muted">
          Enter — отправить, Shift+Enter — новая строка
        </span>
        {error !== null && (
          <span role="alert" className="text-[11.5px] text-fg-red">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
