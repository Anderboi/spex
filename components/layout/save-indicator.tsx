import { AlertCircle, Check, Loader2 } from "lucide-react";

function SaveIndicator({
  status,
  error,
}: {
  status: string;
  error: string | null;
}) {
  if (status === "error") {
    return (
      <span
        role="alert"
        className="flex items-center gap-1.5 text-[12.5px] text-fg-red"
        title={error ?? ""}
      >
        <AlertCircle className="size-3.5" /> Не сохранено
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" /> Сохранение
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        <Check className="size-3.5" /> Сохранено
      </span>
    );
  }
  return null;
}

export default SaveIndicator;
