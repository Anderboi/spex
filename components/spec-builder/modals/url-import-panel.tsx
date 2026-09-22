"use client";

/**
 * Шаг «По ссылке» в диалоге добавления материала в спецификацию.
 *
 * Это НЕ форма материала и не второй импортёр: панель только собирает URL и
 * запускает существующий серверный экшен `importMaterialFromUrl` (тот же, что
 * работает в библиотеке материалов). Полученный черновик открывается в
 * существующей `ManualItemForm` — второй формы материала в проекте быть не
 * должно.
 *
 * Панель ничего не сохраняет: импорт — источник первоначальных данных, а не
 * способ записи. Запись выполняет обычный `onSubmit` формы позиции.
 */

import { useEffect, useState, useTransition } from "react";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importMaterialFromUrl } from "@/actions/material-import";
import type { MaterialImportResult } from "@/actions/material-import";
import { isProbablyImportUrl } from "@/lib/material-import/url-input";

export function UrlImportPanel({
  orgSlug,
  onImported,
  onManual,
  onDirtyChange,
}: {
  orgSlug: string;
  /** Успешный импорт: родитель показывает предзаполненную форму позиции. */
  onImported: (result: MaterialImportResult) => void;
  /** Переход к пустой форме: пользователь заполняет материал сам. */
  onManual: () => void;
  /** Есть ли что терять при закрытии окна (для guard диалога). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canSubmit = isProbablyImportUrl(url) && !isPending;

  useEffect(() => {
    onDirtyChange?.(url.trim().length > 0);
  }, [url, onDirtyChange]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    startTransition(async () => {
      const result = await importMaterialFromUrl(orgSlug, { url: url.trim() });

      if (!result.success) {
        // Текст уже человеческий (см. `describeImportFailure`): ни кодов, ни
        // HTTP-деталей, ни HTML страницы. Техническая причина остаётся в
        // серверном логе.
        setError(result.error);
        toast.error("Не удалось получить данные с этой страницы", {
          description: result.error,
        });
        return;
      }

      // Успех: родитель переключает шаг на предзаполненную форму позиции, и
      // панель размонтируется. Сохранять здесь нечего — запись делает форма.
      onImported(result.data);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold">
            <Link2 className="size-4" />
            Добавить материал по ссылке
          </h3>
          <p className="mt-1 text-[13px] text-fg-muted">
            Вставьте ссылку на страницу товара — мы получим данные и заполним ими
            форму материала. Проверить и изменить всё можно будет перед
            сохранением.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[.08em] text-fg-muted">
            Ссылка на страницу товара
          </span>
          <Input
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoFocus
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
        </label>

        {isPending && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2 rounded-lg border border-border-muted bg-bg-card2 p-3"
          >
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-fg-muted" />
            <div className="text-[13px]">
              <p className="font-medium">Получаем данные со страницы…</p>
              <p className="text-fg-muted">
                Это может занять несколько секунд — страница загружается целиком.
              </p>
            </div>
          </div>
        )}

        {error && !isPending && (
          <div
            role="alert"
            className="rounded-lg border border-border-red-light bg-bg-red-light p-3 text-[13px] text-fg-red"
          >
            <p className="font-medium">
              Не удалось получить данные с этой страницы.
            </p>
            <p className="mt-1">{error}</p>
            <p className="mt-1 text-fg-muted">
              Попробуйте другую ссылку или заполните материал вручную.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-none justify-end gap-3 border-t border-border-subtle p-4">
        {error && !isPending && (
          <Button type="button" size="lg" variant="ghost" onClick={onManual}>
            Заполнить вручную
          </Button>
        )}
        <Button type="submit" size="lg" disabled={!canSubmit}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Получаем…
            </>
          ) : (
            "Получить данные"
          )}
        </Button>
      </div>
    </form>
  );
}
