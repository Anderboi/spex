"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  destructive = false,
  autoFocusCancel = false,
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
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-115 bg-bg-card">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-pretty text-[13px] //leading-relaxed text-fg-secondary">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="lg"
            onClick={onCancel}
            autoFocus={autoFocusCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            size="lg"
            autoFocus={!autoFocusCancel}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
