"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_LIMITS } from "@/lib/spec/comment-write";

/**
 * Правка текста комментария на месте: тело записи заменяется полем ввода.
 *
 * Отдельного диалога нет намеренно — правка происходит там же, где текст был,
 * поэтому не нужно сопоставлять окно с записью в ленте. Поле — та же `Textarea`
 * и те же границы (`COMMENT_LIMITS`), что у composer'а создания: вторая копия
 * правил появилась бы здесь же.
 *
 * `Enter` сохраняет, `Shift+Enter` переносит строку. Форма — своя, поэтому
 * `Enter` в поле правки не может «дойти» до формы создания комментария внизу.
 */
export default function CommentEditForm({
  value,
  error,
  pending,
  onChange,
  onSubmit,
  onCancel,
  /** Подпись поля: у ответа она другая, чем у корневого комментария. */
  ariaLabel = "Текст комментария",
}: {
  value: string;
  /** Ошибка ввода: показывается рядом с полем, текст не теряется. */
  error: string | null;
  pending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  ariaLabel?: string;
}) {
  const hasText = value.trim().length > 0;
  const canSubmit = hasText && !pending;

  const requestSubmit = () => {
    if (!canSubmit) return;
    onSubmit();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // `isComposing` отсекает подтверждение ввода в IME: там Enter завершает
    // набор, а не сохраняет.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    requestSubmit();
  };

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        requestSubmit();
      }}
    >
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={pending}
        rows={2}
        maxLength={COMMENT_LIMITS.bodyMax}
        aria-label={ariaLabel}
        aria-invalid={error !== null}
        autoFocus
        className="min-h-16 resize-none"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[11px] text-fg-muted">
          {error !== null ? (
            <span role="alert" className="text-fg-red">
              {error}
            </span>
          ) : (
            "Enter — сохранить, Shift+Enter — новая строка"
          )}
        </span>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={pending}
            onClick={onCancel}
          >
            Отмена
          </Button>
          <Button type="submit" size="xs" disabled={!canSubmit}>
            {pending ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </form>
  );
}
