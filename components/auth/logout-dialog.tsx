"use client";

interface LogoutDialogProps {
  isOpen: boolean;
  isPending?: boolean;
  hasUnsavedChanges: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function LogoutDialog({
  isOpen,
  isPending = false,
  hasUnsavedChanges,
  onClose,
  onConfirm,
}: LogoutDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-sm bg-bg-card border border-border-muted rounded-[16px] p-5 shadow-[0_16px_48px_rgba(0,0,0,.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[17px] font-bold text-fg leading-tight">
          Выйти из аккаунта?
        </h3>

        <p className="text-[13.5px] text-fg-secondary mt-2 leading-relaxed">
          {hasUnsavedChanges
            ? "У вас есть несохраненные черновики в спецификации. Они автоматически сохранены на этом устройстве, но рекомендуем синхронизировать их перед выходом."
            : "Вы уверены, что хотите завершить сессию?"}
        </p>

        <div className="flex items-center gap-2.5 mt-6">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-[10px] bg-bg-toggle border-none text-fg font-sans text-[13px] font-semibold hover:bg-bg-select transition-colors cursor-pointer disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className="flex-1 py-2.5 px-4 rounded-[10px] bg-bg-red-light border-none text-fg-red font-sans text-[13px] font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isPending ? "Выходим..." : "Выйти"}
          </button>
        </div>
      </div>
    </div>
  );
}
