"use client";

/**
 * Диалог ввода ссылки на товар.
 *
 * Это НЕ форма материала: он только собирает URL и запускает серверный импорт.
 * Полученный черновик открывается в существующем `MaterialDialog` — второй
 * формы материала в проекте быть не должно.
 *
 * Открытие и закрытие управляются URL (`?action=import`) через `useDialogUrl`,
 * как и у остальных диалогов библиотеки: состояние берётся из search params, а
 * не из локального `useState`, поэтому окно переживает перезагрузку, закрывается
 * кнопкой «Назад» и не требует серверного рендера страницы.
 */

import { useState, useTransition } from "react";
import { Loader2, Link2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { importMaterialFromUrl } from "@/actions/material-import";
import type { MaterialImportResult } from "@/actions/material-import";

interface MaterialImportDialogProps {
  open: boolean;
  orgSlug: string;
  onOpenChange: (open: boolean) => void;
  /** Успешный импорт: черновик и ключ передаются родителю для показа формы. */
  onImported: (result: MaterialImportResult) => void;
}

/**
 * Базовая клиентская проверка ссылки.
 *
 * Она нужна только чтобы не отправлять заведомо пустой ввод и дать быструю
 * подсказку. Настоящая проверка адреса (схема, порт, приватные диапазоны, DNS,
 * каждый редирект) выполняется на сервере в `guards.ts`/`safeFetch` — здесь её
 * повторять нельзя, иначе появится вторая, расходящаяся реализация.
 */
function isProbablyUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function MaterialImportDialog({
  open,
  orgSlug,
  onOpenChange,
  onImported,
}: MaterialImportDialogProps) {
  const [url, setUrl] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canSubmit = isProbablyUrl(url) && !isPending;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    startTransition(async () => {
      const result = await importMaterialFromUrl(orgSlug, { url: url.trim() });

      if (!result.success) {
        // Текст ошибки уже человеческий (см. `describeImportFailure`):
        // ни кодов, ни HTTP-деталей, ни внутренних адресов.
        setError(result.error);
        toast.error("Не удалось импортировать материал", {
          description: result.error,
        });
        return;
      }

      // Поле очистит обработчик закрытия окна: следующий импорт должен
      // начинаться с пустой строки, а не с прошлой ссылки.
      onImported(result.data);
    });
  };

  /**
   * Очистка поля после закрытия окна.
   *
   * Компонент остаётся смонтированным, пока в URL стоит `?action=import`,
   * поэтому `useState("")` инициализирует поле только один раз: без очистки
   * ссылка от предыдущего импорта оставалась в поле и при следующем открытии
   * выглядела как уже введённая.
   *
   * `onOpenChangeComplete` вызывается и при закрытии вручную, и когда окно
   * скрывает родитель после успешного импорта, поэтому одной точки достаточно.
   * Сбрасываем здесь, а не эффектом: эффект со `setState` дал бы лишний рендер
   * и запрещён правилом `react-hooks/set-state-in-effect`.
   *
   * При НЕУДАЧНОМ импорте окно не закрывается, поэтому адрес сохраняется —
   * пользователь может исправить его или повторить попытку.
   */
  const handleOpenChangeComplete = (next: boolean) => {
    if (next) return;
    setUrl("");
    setError(null);
  };

  /** Закрытие во время импорта запрещено: запрос уже ушёл. */
  const handleOpenChange = (next: boolean) => {
    if (!next && isPending) return;
    if (!next) setError(null);
    onOpenChange(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
    >
      <DialogContent className="sm:max-w-130 bg-bg px-0">
        <DialogHeader className="px-4">
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-5" />
            Импорт материала по ссылке
          </DialogTitle>
          <DialogDescription>
            Вставьте ссылку на страницу товара — мы разберём её и заполним форму
            материала. Проверить и сохранить данные нужно будет вручную.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-2 px-4">
            <label
              htmlFor="material-import-url"
              className="font-mono text-[10px] uppercase tracking-[.08em] text-fg-muted"
            >
              Ссылка на страницу товара
            </label>
            <Input
              id="material-import-url"
              name="url"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://example.com/product/..."
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                // Правка адреса = новая попытка: старое сообщение об ошибке
                // больше не относится к тому, что в поле.
                if (error !== null) setError(null);
              }}
              // Во время импорта поле заблокировано: менять адрес уже поздно.
              disabled={isPending}
              aria-invalid={error !== null}
              className="h-10 bg-bg-card"
            />
          </div>

          {isPending && (
            <div
              className="flex items-start gap-2 rounded-lg border border-border-muted bg-bg-card2 p-3"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-fg-muted" />
              <div className="text-[13px]">
                <p className="font-medium">Анализируем страницу товара…</p>
                <p className="text-fg-muted">
                  Это может занять некоторое время — страница загружается
                  целиком.
                </p>
              </div>
            </div>
          )}

          {error && !isPending && (
            <div
              className="rounded-lg border border-border-red-light bg-bg-red-light p-3 text-[13px] text-fg-red"
              role="alert"
            >
              <p>{error}</p>
              <p className="mt-1 text-fg-muted">
                Проверьте ссылку и попробуйте снова — введённый адрес сохранён.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 pt-4">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Отмена
            </Button>
            <Button type="submit" size="lg" disabled={!canSubmit}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Импорт…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" />
                  Импортировать
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
