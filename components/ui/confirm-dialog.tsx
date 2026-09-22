"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  destructive = false,
  autoFocusCancel = false,
  confirmDisabled = false,
  pending = false,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Фокус при открытии на безопасной кнопке (Отмена), а не на подтверждающей. */
  autoFocusCancel?: boolean;
  /**
   * Блокирует подтверждение (например, пока не введено название организации).
   * Это UI-предохранитель: серверная проверка обязательна и делается отдельно.
   */
  confirmDisabled?: boolean;
  /** Операция выполняется: кнопки выключаются, показывается спиннер. */
  pending?: boolean;
  /** Дополнительные поля между текстом и кнопками. */
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-115 bg-bg-card">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-pretty text-[13px] //leading-relaxed text-fg-secondary whitespace-pre-line">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="lg"
            onClick={onCancel}
            disabled={pending}
            autoFocus={autoFocusCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            size="lg"
            disabled={confirmDisabled || pending}
            autoFocus={!autoFocusCancel}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
