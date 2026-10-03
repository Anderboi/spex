"use client";

import { MoreVertical, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HistoryCommentEntry } from "@/lib/spec/history-types";
import type { PendingCommentMutations } from "@/lib/spec/comment-mutation-model";

/**
 * Что получает renderer, чтобы показать действия и режим правки.
 *
 * Один объект вместо десятка пропсов: `ActivityComment` прокидывает его в
 * `ActivityReply`, и плоский список пропсов пришлось бы дублировать на каждом
 * уровне. Здесь только вызовы и состояние — ни одного server action, поэтому
 * renderer остаётся отображением.
 */
export type CommentMutationSlots = {
  /** Незавершённые операции: нужны, чтобы блокировать повторный запуск. */
  mutations: PendingCommentMutations;
  /** Комментарий, у которого открыт режим правки. */
  editingId: string | null;
  /** Текст в поле правки. */
  editBody: string;
  /** Ошибка ввода в режиме правки. */
  editError: string | null;
  /** Доступны ли этому пользователю правка и удаление комментария. */
  canMutate: (comment: HistoryCommentEntry) => boolean;
  /** Идёт ли операция именно по этому комментарию. */
  isPending: (commentId: string) => boolean;
  startEdit: (comment: HistoryCommentEntry) => void;
  changeEditBody: (value: string) => void;
  cancelEdit: () => void;
  submitEdit: (commentId: string) => Promise<boolean>;
  requestDelete: (comment: HistoryCommentEntry) => void;
};

/**
 * Меню действий комментария: «Редактировать» и «Удалить».
 *
 * Показывается только там, где операция вообще возможна: у своего
 * (не удалённого) комментария. Это UX-условие, а не граница безопасности —
 * сервер проверяет авторство сам и повторит отказ, даже если меню показать.
 *
 * Компонент ничего не знает о server actions: он зовёт `onEdit` / `onDelete`.
 * Отправка, optimistic-состояние и вызовы живут выше, в `ActivityTab` и его
 * хуке, поэтому renderer остаётся отображением.
 */
export default function CommentActions({
  comment,
  disabled = false,
  onEdit,
  onDelete,
}: {
  comment: HistoryCommentEntry;
  /** Операция по этому комментарию уже идёт: повторный запуск запрещён. */
  disabled?: boolean;
  onEdit: (comment: HistoryCommentEntry) => void;
  onDelete: (comment: HistoryCommentEntry) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-fg-muted"
            aria-label="Действия с комментарием"
            disabled={disabled}
          />
        }
      >
        <MoreVertical />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-44 bg-bg-card">
        <DropdownMenuItem
          className="gap-2 text-[13px]"
          onClick={() => onEdit(comment)}
        >
          <Pencil className="size-4" />
          Редактировать
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2 text-[13px] text-fg-red"
          onClick={() => onDelete(comment)}
        >
          <Trash2 className="size-4" />
          Удалить
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
