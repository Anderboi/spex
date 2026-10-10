"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSpecItemFileUrls } from "@/actions/spec-item-files";
import { fileKindOf } from "@/lib/spec/file-view";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Подписанные ссылки на миниатюры изображений списка.
 *
 * ── Почему отдельный модуль, а не эффект внутри списка ─────────────────────
 *
 * Во-первых, это ЧТЕНИЕ данных, а список рисует уже полученное: его докблок
 * говорит «компонент НЕ читает данные сам». Во-вторых, подписывать надо не
 * список, а ЭКРАН: во вкладке «Платежи» список монтируется по одному на каждую
 * карточку, и подпись внутри списка означала бы по вызову на карточку — тогда
 * как вкладка читает файлы один раз на все карточки сразу.
 *
 * ── Почему пачка ───────────────────────────────────────────────────────────
 *
 * Next.js отправляет server actions по одному на клиента
 * (`docs/01-app/02-guides/server-actions.md`), поэтому «по запросу на картинку» —
 * это не параллельные запросы, а последовательные: превью проступали бы
 * секундами, а очередь действий была бы занята подписями. Здесь на весь список
 * — один вызов (`getSpecItemFileUrls`).
 *
 * ── Кэш и TTL ──────────────────────────────────────────────────────────────
 *
 * Ссылка короткоживущая (5 минут) и намеренно не переживает размонтирование:
 * повторное открытие подписывает заново. Состояние не сбрасывается при смене
 * позиции, и это безопасно: идентификаторы файлов уникальны, чужая позиция по
 * ним ничего не найдёт, а протухшая за время открытой модалки ссылка лечится
 * повтором (ниже).
 *
 * ── Повтор ровно один ──────────────────────────────────────────────────────
 *
 * Подпись может не сработать по двум разным причинам, и различить их на клиенте
 * нечем: `<img>` сообщает об ошибке одинаково и когда ссылка протухла, и когда
 * объект не декодируется. Поэтому на каждый файл даётся РОВНО ОДИН повтор:
 * протухшую ссылку он чинит, а битый объект не превращает в бесконечный цикл
 * подписей — строка остаётся с иконкой вида.
 */
export type SignedThumbnails = {
  /** Подписанные ссылки: идентификатор файла → URL. */
  urls: Record<string, string>;
  /** Миниатюра не отрисовалась: одна повторная подпись, дальше — иконка. */
  onFailed: (fileId: string) => void;
};

export function useSignedThumbnails(
  orgSlug: string,
  specItemId: string,
  files: SpecItemFileEntry[],
  /** Список уже прочитан: пока идёт загрузка, подписывать нечего. */
  enabled: boolean,
): SignedThumbnails {
  const [urls, setUrls] = useState<Record<string, string>>({});
  /** Растёт, когда разрешён повтор: перезапускает эффект без смены входных данных. */
  const [attempt, setAttempt] = useState(0);

  /** Уже запрошенные файлы: повторный запрос по той же строке не нужен. */
  const requested = useRef(new Set<string>());
  /** Файлы, которым повтор уже выдан: второй раз он не даётся. */
  const retried = useRef(new Set<string>());
  /** Актуальная позиция: ответы прошлой позиции в список не попадают. */
  const specItemIdRef = useRef(specItemId);
  useEffect(() => {
    specItemIdRef.current = specItemId;
  }, [specItemId]);

  /**
   * Разрешить повтор — по одному на файл, и только если он ещё не выдан.
   *
   * Возврат файла в `requested` и есть весь механизм: следующий прогон эффекта
   * снова возьмёт его в пачку. Когда повторять больше нечего, состояние не
   * меняется, и эффект не перезапускается — цикл обрывается сам.
   */
  const retryOnce = useCallback((fileIds: string[]) => {
    const retryable = fileIds.filter((fileId) => !retried.current.has(fileId));
    if (retryable.length === 0) return;

    for (const fileId of retryable) {
      retried.current.add(fileId);
      requested.current.delete(fileId);
    }
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Только изображения: остальным превью не нужно, и ссылка на них — лишняя
    // живая ссылка, а не удобство.
    const pending = files.filter(
      (file) => fileKindOf(file) === "image" && !requested.current.has(file.id),
    );
    if (pending.length === 0) return;

    for (const file of pending) requested.current.add(file.id);

    const forItem = specItemId;
    const asked = pending.map((file) => file.id);
    let cancelled = false;

    void (async () => {
      try {
        const res = await getSpecItemFileUrls(orgSlug, forItem, asked);
        if (cancelled || specItemIdRef.current !== forItem) return;

        if (!res.success) {
          console.error("[useSignedThumbnails]", res.error);
          retryOnce(asked);
          return;
        }

        setUrls((current) => {
          const next = { ...current };
          for (const signed of res.data) next[signed.fileId] = signed.url;
          return next;
        });
      } catch (cause) {
        if (cancelled || specItemIdRef.current !== forItem) return;
        console.error("[useSignedThumbnails]", cause);
        retryOnce(asked);
      }
    })();

    // Ответ отменённого прогона не должен попасть в состояние: позиция могла
    // смениться, и подписанное — уже про другой список.
    return () => {
      cancelled = true;
    };
  }, [files, enabled, orgSlug, specItemId, attempt, retryOnce]);

  const onFailed = useCallback(
    (fileId: string) => {
      setUrls((current) => {
        if (!(fileId in current)) return current;
        const next = { ...current };
        delete next[fileId];
        return next;
      });
      retryOnce([fileId]);
    },
    [retryOnce],
  );

  return { urls, onFailed };
}
