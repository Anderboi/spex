"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition, type MouseEvent } from "react";

/**
 * Обычный клик левой кнопкой без модификаторов — только его перехватываем.
 * Ctrl/Cmd/Shift/средняя кнопка означают «новая вкладка/окно»: там должен
 * работать настоящий `href`.
 */
function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

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
 * `shallow` переключает открытие и закрытие на History API браузера
 * (`pushState`/`replaceState`) вместо `router.push`. Next подхватывает такие
 * вызовы в свой роутер (см. Native History API в документации Next), поэтому
 * `useSearchParams` обновляется сразу, но **без запроса RSC-пейлоада**: страница
 * не перерисовывается на сервере. Это то, что нужно диалогам, чьи данные уже
 * лежат на клиенте: иначе каждый клик по «Редактировать» заново тянул бы с
 * сервера всю страницу (материалы, справочники) и только потом показывал окно.
 *
 * @param param       Имя search-параметра диалога (например "action" или "dialog").
 * @param cleanupKeys Дополнительные параметры, которые надо удалять при закрытии
 *                    (например доп. аргументы открытия вроде `company_id`).
 * @param options.shallow См. выше: открывать/закрывать без серверного рендера.
 */
export function useDialogUrl(
  param = "action",
  cleanupKeys: string[] = [],
  options: { shallow?: boolean } = {},
) {
  const { shallow = false } = options;
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
      // Shallow: браузер меняет URL, Next сам обновляет `useSearchParams`
      // (ACTION_RESTORE по скопированному состоянию истории) — без похода на
      // сервер. Оборачивать в `startTransition` нечего: ждать нечего.
      if (shallow) {
        window.history.pushState(null, "", url);
        return;
      }
      startTransition(() => {
        router.push(url, { scroll: false });
      });
    },
    [router, hrefFor, shallow],
  );

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(param);
    params.delete("id");
    for (const key of cleanupKeys) params.delete(key);
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (shallow) {
      window.history.replaceState(null, "", url);
      return;
    }
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  }, [router, pathname, searchParams, param, cleanupKeys, shallow]);

  /**
   * Готовые пропсы для ссылки, открывающей диалог: `href` даёт нормальный URL
   * (новая вкладка, «скопировать ссылку», работа без JavaScript), а обычный клик
   * перехватывается и открывает диалог тем же путём, что `open()`.
   */
  const linkProps = useCallback(
    (value: string, extra?: Record<string, string>) => ({
      href: hrefFor(value, extra),
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        open(value, extra);
      },
    }),
    [hrefFor, open],
  );

  return { value, hrefFor, open, close, linkProps, isPending };
}
