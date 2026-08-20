"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CodeConflict } from "@/hooks/use-spec-builder";

export function CodeConflictDialog({
  conflict,
  onConfirm,
  onCancel,
}: {
  conflict: CodeConflict | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={conflict !== null}
      title={`Марка ${conflict?.code} уже занята`}
      description={
        `Её использует позиция «${conflict?.occupantName}». ` +
        `Марки указаны в чертежах и ведомостях — после обмена обе позиции сменят обозначение. ` +
        `Проверьте, что документы будут обновлены.`
      }
      confirmLabel="Обменять марки"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
