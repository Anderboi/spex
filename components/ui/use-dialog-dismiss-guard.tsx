"use client";

import { useState, useCallback } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { REASONS } from "@base-ui/react/internals/reasons";

export type DialogDismissReason =
  | typeof REASONS.outsidePress
  | typeof REASONS.escapeKey
  | typeof REASONS.closePress
  | typeof REASONS.focusOut
  | typeof REASONS.triggerPress;

export interface UseDialogDismissGuardOptions {
  /** Функция закрытия основного модального окна. */
  onClose: () => void;
  /** Есть ли несохранённые изменения / заполнена ли форма. */
  hasChanges: boolean | (() => boolean);
  /** Причины закрытия, которые необходимо перехватывать. */
  reasons?: readonly DialogDismissReason[];
}

export function useDialogDismissGuard({
  onClose,
  hasChanges,
  reasons = [REASONS.outsidePress, REASONS.escapeKey],
}: UseDialogDismissGuardOptions) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleOpenChange = useCallback(
    (next: boolean, eventDetails?: DialogPrimitive.Root.ChangeEventDetails) => {
      if (next) return;

      const reason = eventDetails?.reason;
      if (reason && (reasons as readonly string[]).includes(reason)) {
        const dirty =
          typeof hasChanges === "function" ? hasChanges() : hasChanges;

        if (dirty) {
          eventDetails?.cancel();
          setShowConfirm(true);
          return;
        }
      }

      onClose();
    },
    [onClose, hasChanges, reasons],
  );

  const confirmDiscard = useCallback(() => {
    setShowConfirm(false);
    onClose();
  }, [onClose]);

  const cancelDiscard = useCallback(() => {
    setShowConfirm(false);
  }, []);

  return {
    handleOpenChange,
    showConfirm,
    confirmDiscard,
    cancelDiscard,
  };
}
