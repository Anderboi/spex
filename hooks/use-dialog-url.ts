"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * URL-управляемый диалог (best practice Next.js App Router).
 *
 * Состояние «открыт/закрыт» хранится в query-строке, а не в useState:
 * диалог становится доступным по ссылке, переживает перезагрузку страницы
 * и закрывается браузерной кнопкой «Назад».
 *
 * - `open(value, extra?)` — `router.push('?param=value&...')` с сохранением
 *   остальных search params. push добавляет запись в историю, поэтому Back
 *   естественным образом закрывает диалог.
 * - `close()` — `router.replace(...)` без диалоговых параметров: закрытие
 *   не оставляет «пустых» записей в истории (безопасно для прямых ссылок).
 *   Помимо `param` всегда удаляется `id`, а также переданные `cleanupKeys`.
 * - `hrefFor(value, extra?)` — строка URL для открытия, удобно для `<Link>`.
 *
 * @param param       Имя search-параметра диалога (например "action" или "dialog").
 * @param cleanupKeys Дополнительные параметры, которые надо удалять при закрытии
 *                    (например доп. аргументы открытия вроде `company_id`).
 */
export function useDialogUrl(param = "action", cleanupKeys: string[] = []) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const value = searchParams.get(param);

  const hrefFor = useCallback(
    (value: string, extra?: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(param, value);
      for (const [key, val] of Object.entries(extra ?? {})) {
        params.set(key, val);
      }
      return `${pathname}?${params.toString()}`;
    },
    [pathname, searchParams, param],
  );

  const open = useCallback(
    (value: string, extra?: Record<string, string>) => {
      const url = hrefFor(value, extra);
      startTransition(() => {
        router.push(url, { scroll: false });
      });
    },
    [router, hrefFor],
  );

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(param);
    params.delete("id");
    for (const key of cleanupKeys) params.delete(key);
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  }, [router, pathname, searchParams, param, cleanupKeys]);

  return { value, hrefFor, open, close, isPending };
}
