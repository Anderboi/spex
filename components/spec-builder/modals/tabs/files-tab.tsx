"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { listSpecItemFiles } from "@/actions/spec-item-files";
import { can } from "@/lib/permissions";
import type { OrgRole } from "@/lib/permissions";
import {
  applyChangedFile,
  applyDeletedFile,
  applyUploadedFile,
} from "@/lib/spec/file-view";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";
import DocumentList from "./document-list";

/**
 * Вкладка «Файлы» карточки позиции: все документы позиции.
 *
 * ── Что здесь, а что в списке ──────────────────────────────────────────────
 *
 * Здесь ТОЛЬКО чтение данных: запрос, обработка отказа, повтор и защита от
 * гонки при смене позиции. Всё остальное — группы, фильтры, строки, загрузка,
 * правка и удаление — живёт в `DocumentList`, потому что тот же список
 * показывается ещё и в карточке оплаты (там он отфильтрован по проводке).
 * Вторая копия разметки разошлась бы с первой в первой же правке.
 *
 * ── Состояния ──────────────────────────────────────────────────────────────
 *
 * `loadedKey` — это позиция, для которой пришли данные; пока он не совпадает с
 * текущей, список показывает строки-заготовки. Так при смене позиции не бывает
 * ни «мигания» прошлого списка, ни лишнего сброса состояния эффектом — приём
 * тот же, что в `ActivityTab`.
 *
 * `inFlight` нужен именно для «Повторить»: там ошибка снимается ДО запроса, и
 * без этого флага на время повторной попытки не выполнялось бы ни одно из
 * условий (`loading` требует отсутствия ошибки, `failed` — её наличия) — панель
 * осталась бы пустой вместо заготовок.
 *
 * ── Защита от гонки ────────────────────────────────────────────────────────
 *
 * `requestIdRef`: ответ устаревшего запроса (быстрая смена позиции, повторный
 * клик «Повторить») не попадает в состояние. `specItemIdRef` — актуальная
 * позиция для асинхронных ответов: колбэк, созданный в прошлой отрисовке,
 * держит в замыкании прежний `specItemId`.
 *
 * ── Права ──────────────────────────────────────────────────────────────────
 *
 * Чтение правами не описывается: файлы позиции видит любой член организации.
 * Запись — `record:create`, та же граница, что у действий вкладки; проверку
 * повторяет сервер.
 */
export default function FilesTab({
  orgSlug,
  specItemId,
  role,
}: {
  /** Слаг организации: организация берётся на сервере из сессии, не с клиента. */
  orgSlug: string;
  /** Позиция, чьи файлы читаем. */
  specItemId: string;
  /** Роль в организации: гейт для кнопок записи. Проверку повторяет сервер. */
  role?: OrgRole | null;
}) {
  const [files, setFiles] = useState<SpecItemFileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Для какой позиции пришли `files`. Не совпало с текущей — идёт загрузка. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);

  /** Номер попытки загрузки: гасит устаревшие ответы. */
  const requestIdRef = useRef(0);
  /** Актуальная позиция для асинхронных ответов. */
  const specItemIdRef = useRef(specItemId);
  useEffect(() => {
    specItemIdRef.current = specItemId;
  }, [specItemId]);

  const canWrite = can(role, "record:create");

  /**
   * Загрузка списка.
   *
   * Ничего не пишет в состояние: возвращает результат или причину отказа, а
   * применяет вызывающий. Поэтому одну и ту же загрузку можно запустить и из
   * эффекта, и из «Повторить», не дублируя защиту от гонки.
   */
  const requestList = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const forItem = specItemId;

    try {
      const res = await listSpecItemFiles(orgSlug, forItem);
      if (requestId !== requestIdRef.current) return null;
      if (res.success) return { ok: true as const, files: res.data };
      return { ok: false as const, message: res.error };
    } catch (cause) {
      // Server action может отклониться, не дойдя до `ActionResult` (сеть):
      // для UI это то же самое «не удалось».
      if (requestId !== requestIdRef.current) return null;
      console.error("[FilesTab] список файлов", cause);
      return { ok: false as const, message: "Не удалось загрузить файлы" };
    }
  }, [orgSlug, specItemId]);

  const applyList = useCallback(
    (result: Awaited<ReturnType<typeof requestList>>) => {
      // `null` — устаревший ответ: он не должен ни перезаписать список, ни
      // снять ошибку актуальной попытки.
      if (result === null) return;

      if (result.ok) {
        setFiles(result.files);
        setLoadedKey(specItemId);
        setError(null);
      } else {
        setError(result.message);
      }
    },
    [specItemId],
  );

  const retry = useCallback(() => {
    setError(null);
    setInFlight(true);
    void requestList()
      .then(applyList)
      .finally(() => setInFlight(false));
  }, [requestList, applyList]);

  useEffect(() => {
    void requestList().then(applyList);
    // Смена позиции и размонтирование отменяют ответы прошлых запросов: номер
    // попытки растёт, и поздний ответ уже не актуален.
    return () => {
      requestIdRef.current += 1;
    };
  }, [requestList, applyList]);

  /**
   * Ответы операций над строкой.
   *
   * Само правило — в `lib/spec/file-view` (`applyUploadedFile` и соседние):
   * те же три ответа применяет карточка оплаты, и копия здесь разошлась бы с
   * ней молча. Сверка позиции — в `DocumentList`: он не отдаёт ответ чужой
   * позиции наружу.
   */
  const onUploaded = useCallback((entry: SpecItemFileEntry) => {
    setFiles((current) => applyUploadedFile(current, entry));
  }, []);

  const onChanged = useCallback((entry: SpecItemFileEntry) => {
    setFiles((current) => applyChangedFile(current, entry));
  }, []);

  const onDeleted = useCallback((fileId: string) => {
    setFiles((current) => applyDeletedFile(current, fileId));
  }, []);

  const isCurrent = loadedKey === specItemId;
  const loading = !isCurrent && (error === null || inFlight);
  const failed = !isCurrent && error !== null && !inFlight;

  return (
    <div className="flex flex-col gap-2 py-4">
      {failed && (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-muted px-4 py-8 text-center"
        >
          <p className="text-[13px] text-fg-muted">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            Повторить
          </Button>
        </div>
      )}

      {!failed && (
        <DocumentList
          orgSlug={orgSlug}
          specItemId={specItemId}
          files={files}
          loading={loading}
          canWrite={canWrite}
          onUploaded={onUploaded}
          onChanged={onChanged}
          onDeleted={onDeleted}
          /*
            Заголовок — только при непустом списке: в пустом состоянии число
            «Документов: 0» дублировало бы приглашение, которое и так говорит,
            что файлов нет.
          */
          title={files.length > 0 ? `Документов: ${files.length}` : null}
        />
      )}
    </div>
  );
}
