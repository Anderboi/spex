import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/** Вызывает экшен, показывает ошибку тостом. Возвращает данные или null. */
export async function runAction<T>(
  fn: () => Promise<ActionResult<T>>,
  opts: { success?: string; undo?: () => void } = {},
): Promise<T | null> {
  const res = await fn();
  if (!res.success) {
    toast.error(res.error);
    return null;
  }
  if (opts.success) {
    toast.success(
      opts.success,
      opts.undo
        ? { action: { label: "Отменить", onClick: opts.undo } }
        : undefined,
    );
  }
  return res.data;
}
