"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ExternalLink,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Ruler,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { getSpecItemFileUrl, listSpecItemFiles } from "@/actions/spec-item-files";
import { MAX_SPEC_ITEM_FILE_BYTES, MAX_SPEC_ITEM_FILE_LABEL } from "@/lib/spec/file-content";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";
import {
  fileAuthorLabel,
  fileCategoryLabel,
  fileKindOf,
  fileMetaLine,
  placeFileEntry,
  type SpecItemFileKind,
} from "@/lib/spec/file-view";
import FileUploadDialog from "./file-upload-dialog";

/**
 * Вкладка «Файлы» карточки позиции: список файлов, их открытие и добавление.
 *
 * ── Разметка ───────────────────────────────────────────────────────────────
 *
 * Строка собрана из shadcn Base `Attachment` (`AttachmentMedia` — иконка вида,
 * `AttachmentContent` с бейджем категории, `AttachmentTitle`/`AttachmentDescription`
 * — имя и подпись, `AttachmentActions` — индикатор и подсказка действия). Раньше
 * это была ручная разметка; поведение при этом не изменилось.
 *
 * ── Что здесь есть ─────────────────────────────────────────────────────────
 *
 * Список и открытие файла (`getSpecItemFileUrl` + новая вкладка) — только
 * чтение. Загрузка идёт через `FileUploadDialog`, а точка входа у неё ОДНА —
 * скрытый `<input type="file">` в этой разметке; кнопок, которые её открывают,
 * две: в пустом состоянии (`Empty`) и над непустым списком. Удаления,
 * drag&drop и превью на этом этапе нет — и API под них не заводится.
 *
 * ── Порядок ────────────────────────────────────────────────────────────────
 *
 * Список НЕ сортируется на клиенте: сервер отдаёт `created_at DESC, id DESC`
 * (покрыто индексом `spec_item_files_spec_item_id_active_idx`), и клиентская
 * сортировка была бы вторым, расходящимся правилом порядка.
 *
 * ── Состояния ──────────────────────────────────────────────────────────────
 *
 * `loadedKey` — это позиция, для которой пришли данные; пока он не совпадает с
 * текущей, рендерится skeleton (столько же строк, сколько помещается в первый
 * экран). Так при смене позиции не бывает ни «мигания» прошлого списка, ни
 * лишнего сброса состояния в эффекте — приём тот же, что в `ActivityTab`.
 *
 * ── Защита от гонки ────────────────────────────────────────────────────────
 *
 * * Загрузка списка: `requestIdRef`. Ответ устаревшего запроса (быстрая смена
 *   позиции, повторный клик «Повторить») не попадает в состояние.
 * * Открытие файла: `urlRequestRef` плюс сверка позиции и файла перед
 *   `window.open`. Поздний ответ не откроет неправильный файл.
 */

/** Сколько строк-заготовок показывать при загрузке. */
const SKELETON_ROWS = 4;

/**
 * Контейнер списка.
 *
 * Переменные темы переопределяются на уровне списка, а не классами на каждой
 * строке: `Attachment` построен на семантических токенах (`bg-card`, `bg-muted`,
 * `text-card-foreground`, `text-muted-foreground`, `border`), а они в проекте
 * стоковые — белые и серые. Приложение же живёт на тёплой палитре (`--color-bg-card`,
 * `--color-bg-card2`, `--color-border-muted`, `--color-fg-dim`). Перенаправление
 * токенов сохраняет визуальный язык модалки, НЕ трогая сам компонент и не
 * переопределяя его классы по одному.
 */
const LIST_CLASS =
  "flex flex-col gap-1.5 py-1 [--card:#fcf9f3] [--card-foreground:#221d18] [--muted:#f5f2eb] [--muted-foreground:#a8a296] [--border:#e2ddd1]";

/** Иконка вида файла. Отдельной «системы иконок» нет — только этот маппинг. */
const KIND_ICON: Record<
  SpecItemFileKind,
  React.ComponentType<{ className?: string }>
> = {
  pdf: FileText,
  image: ImageIcon,
  archive: Archive,
  cad: Ruler,
  file: FileIcon,
};

/**
 * Строка-заготовка: та же геометрия, что у настоящей строки `Attachment`
 * (`size="sm"`: медиа 32px, отступы `py-1.5`, действия справа).
 */
function FileRowSkeleton() {
  return (
    <div className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5">
      <Skeleton className="size-8 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="size-6 shrink-0 rounded-md" />
    </div>
  );
}

export default function FilesTab({
  orgSlug,
  specItemId,
}: {
  /** Слаг организации: организация берётся на сервере из сессии, не с клиента. */
  orgSlug: string;
  /** Позиция, чьи файлы читаем. */
  specItemId: string;
}) {
  const [files, setFiles] = useState<SpecItemFileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Для какой позиции пришли `files`. Не совпало с текущей — идёт загрузка. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  /**
   * Идёт ли запрос прямо сейчас.
   *
   * Нужен именно для «Повторить»: там ошибка снимается ДО запроса, и без этого
   * флага на время повторной попытки не выполнялось бы ни одно из условий
   * (`loading` требует отсутствия ошибки, `failed` — её наличия) — панель
   * осталась бы пустой вместо skeleton.
   */
  const [inFlight, setInFlight] = useState(false);

  /** Номер попытки загрузки списка: гасит устаревшие ответы. */
  const requestIdRef = useRef(0);
  /** Номер попытки получения ссылки. Одно значение на вкладку, а не на строку:
   * клик по другому файлу отменяет предыдущий запрос — открыть должен только
   * последний.
   */
  const urlRequestRef = useRef(0);
  /**
   * Актуальная позиция для асинхронных ответов.
   *
   * Обновляется эффектом, а не при отрисовке: запись в ref во время рендера
   * React запрещает (и это ловит линтер). К моменту, когда ответ загрузки
   * доедет, эффект уже отработал, поэтому здесь лежит текущее значение — в
   * отличие от `specItemId` из замыкания, которое «замораживается» на момент
   * создания колбэка.
   */
  const specItemIdRef = useRef(specItemId);
  useEffect(() => {
    specItemIdRef.current = specItemId;
  }, [specItemId]);

  /** Файл, для которого сейчас получаем ссылку (локальный loading строки). */
  const [opening, setOpening] = useState<{
    itemKey: string;
    fileId: string;
  } | null>(null);
  /** Ошибка открытия конкретного файла: список при этом остаётся рабочим. */
  const [openError, setOpenError] = useState<{
    itemKey: string;
    fileId: string;
    message: string;
  } | null>(null);

  /** Выбранный в picker'е файл: пока не `null`, открыт диалог загрузки. */
  const [picked, setPicked] = useState<File | null>(null);
  /** UX-ошибка picker'а (слишком большой файл): до сервера дело не доходит. */
  const [pickError, setPickError] = useState<string | null>(null);

  /** Скрытый `<input type="file">`: открывается кнопкой «Добавить файл». */
  const pickerRef = useRef<HTMLInputElement>(null);

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

  /**
   * Повторная попытка по кнопке.
   *
   * Отдельная обёртка, а не прямая цепочка в разметке: у повтора есть
   * собственное состояние («запрос идёт»), и оно должно устанавливаться ровно
   * один раз — до запроса.
   */
  const retry = useCallback(() => {
    setError(null);
    setInFlight(true);
    void requestList()
      .then(applyList)
      .finally(() => setInFlight(false));
  }, [requestList, applyList]);

  useEffect(() => {
    void requestList().then(applyList);
    /**
     * Смена позиции и размонтирование отменяют ответы прошлых запросов: номер
     * попытки растёт, и поздний ответ обеих операций (список и ссылка) уже не
     * актуален. Сверять «текущий» `specItemId` через ref здесь не нужно —
     * ровно эту работу делает счётчик.
     */
    return () => {
      requestIdRef.current += 1;
      urlRequestRef.current += 1;
    };
  }, [requestList, applyList]);

  /**
   * Открыть файл: получить signed URL и открыть его в новой вкладке.
   *
   * Ссылка запрашивается ТОЛЬКО по клику и только для одного файла: заранее
   * подписывать весь список нельзя — это лишние запросы и лишние живые ссылки.
   */
  const openFile = useCallback(
    async (file: SpecItemFileEntry) => {
      const requestId = ++urlRequestRef.current;
      const forItem = specItemId;
      const forFile = file.id;

      setOpening({ itemKey: forItem, fileId: forFile });
      setOpenError(null);

      try {
        const res = await getSpecItemFileUrl(orgSlug, forItem, forFile);

        // Две проверки: номер попытки (кликнули другой файл или позиция
        // сменилась — тогда счётчик уже вырос в cleanup эффекта) и совпадение
        // показанного списка с текущей позицией. Любая из них означает, что
        // открывать эту ссылку нельзя.
        const stale =
          requestId !== urlRequestRef.current || loadedKey !== forItem;
        if (stale) return;

        if (!res.success) {
          setOpenError({ itemKey: forItem, fileId: forFile, message: res.error });
          return;
        }

        // `noopener` обязателен: без него открытая страница получает
        // `window.opener` и может управлять вкладкой приложения.
        window.open(res.data.url, "_blank", "noopener,noreferrer");
      } catch (cause) {
        if (requestId !== urlRequestRef.current) return;
        console.error("[FilesTab] ссылка на файл", cause);
        setOpenError({
          itemKey: forItem,
          fileId: forFile,
          message: "Не удалось открыть файл",
        });
      } finally {
        // Снимаем индикатор только у своей попытки: сброс чужого оставил бы
        // новую строку без обратной связи.
        if (requestId === urlRequestRef.current) setOpening(null);
      }
    },
    [orgSlug, specItemId, loadedKey],
  );

  /**
   * Пока открыт диалог загрузки, повторный выбор файла запрещён.
   *
   * Загрузки идут строго по одной: второй параллельный upload не поддерживается
   * ни этим этапом, ни UI (в списке не было бы понятно, какая строка чья).
   */
  const dialogOpen = picked !== null;

  /**
   * Разбор выбора файла из picker'а.
   *
   * Здесь только UX-проверки: файл есть и не больше лимита сервера. MIME и
   * сигнатуру содержимого проверяет сервер — второй такой проверки на клиенте
   * нет намеренно, иначе они разойдутся.
   *
   * `input.value` сбрасывается сразу после обработки: без этого повторный выбор
   * ТОГО ЖЕ файла не вызовет `change` (браузер считает значение неизменным), и
   * после ошибки пользователь не смог бы выбрать файл заново.
   */
  const handlePick = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_SPEC_ITEM_FILE_BYTES) {
      setPickError(
        `Файл слишком большой. Максимальный размер — ${MAX_SPEC_ITEM_FILE_LABEL}.`,
      );
      return;
    }

    setPickError(null);
    setPicked(file);
  }, []);

  /**
   * Успешная загрузка: в список встаёт ЗАПИСЬ СЕРВЕРА, а не локальная догадка.
   *
   * Повторный `listSpecItemFiles` не нужен: action вернул созданную запись
   * целиком, а её место в порядке определяет `placeFileEntry` — та же функция,
   * что задаёт порядок списка, поэтому клиент и сервер не разойдутся.
   *
   * Запись принимается только для ТЕКУЩЕЙ позиции, и сверяется она с
   * `specItemIdRef`, а не с `specItemId` из замыкания: колбэк создан в прошлой
   * отрисовке, и его `specItemId` остался прежним. Без живой сверки ответ
   * загрузки, начатой до смены позиции, попал бы в список новой позиции —
   * ровно это и ловит тест на гонку.
   */
  const handleUploaded = useCallback(
    (entry: SpecItemFileEntry, forSpecItemId: string) => {
      if (forSpecItemId !== specItemIdRef.current) return;
      setFiles((current) => placeFileEntry(current, entry));
      setPicked(null);
    },
    [],
  );

  const isCurrent = loadedKey === specItemId;
  const loading = !isCurrent && (error === null || inFlight);
  const failed = !isCurrent && error !== null && !inFlight;
  /** Состояния открытия не «протекают» на другую позицию. */
  const openingHere = opening?.itemKey === specItemId ? opening : null;
  const openErrorHere = openError?.itemKey === specItemId ? openError : null;

  return (
    <div className={LIST_CLASS}>
      {/*
        Скрытый native input живёт вне веток состояния: и empty state, и (в
        будущем) любое другое место открывают ОДИН и тот же picker — второго
        `<input type="file">` в разметке нет. `multiple` не ставим: файл
        выбирается по одному.
      */}
      <input
        ref={pickerRef}
        type="file"
        className="hidden"
        onChange={handlePick}
        aria-label="Выбрать файл для загрузки"
      />

      {loading &&
        Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} aria-hidden="true">
            <FileRowSkeleton />
          </div>
        ))}

      {failed && (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-muted px-4 py-8 text-center"
        >
          <p className="text-[13px] text-fg-muted">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retry}
          >
            Повторить
          </Button>
        </div>
      )}

      {/*
        Пустое состояние — единственное место, где предлагается добавить файл:
        отдельной кнопки над списком больше нет. Размеры и палитра подогнаны под
        вкладку: `Empty` из реестра рассчитан на отдельную страницу (`p-6`,
        `gap-4`, `bg-muted`), поэтому отступы уменьшены, а токены наследуются от
        контейнера списка (`LIST_CLASS`) — так тёплая палитра модалки сохраняется.
      */}
      {isCurrent && files.length === 0 && (
        <Empty className="gap-3 border border-border-muted px-4 py-8">
          <EmptyHeader className="gap-1.5">
            <EmptyMedia
              variant="icon"
              className="mb-1 size-9 rounded-lg border border-border-muted bg-bg-card2 text-fg-muted"
              aria-hidden="true"
            >
              <Paperclip className="size-4" />
            </EmptyMedia>
            <EmptyTitle className="text-[14px] font-medium text-fg">
              Файлов пока нет
            </EmptyTitle>
            <EmptyDescription className="max-w-xs text-[12.5px] text-fg-muted">
              Добавьте документы или другие файлы, связанные с этим материалом.
            </EmptyDescription>
          </EmptyHeader>

          <EmptyContent className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={dialogOpen}
              onClick={() => pickerRef.current?.click()}
            >
              <Plus className="size-3.5" />
              Добавить файл
            </Button>

            {pickError && (
              <p role="alert" className="text-[12px] text-fg-red">
                {pickError}
              </p>
            )}
          </EmptyContent>
        </Empty>
      )}

      {/*
        Кнопка добавления над непустым списком. Это та же самая кнопка и тот же
        picker, что и в empty state: второго пути загрузки нет, отличается только
        место. Справа — по условию задачи.
      */}
      {isCurrent && files.length > 0 && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={dialogOpen}
            onClick={() => pickerRef.current?.click()}
          >
            <Plus className="size-3.5" />
            Добавить файл
          </Button>
        </div>
      )}

      {isCurrent &&
        files.map((file) => {
          const Icon = KIND_ICON[fileKindOf(file)];
          const isOpening = openingHere?.fileId === file.id;
          const rowError =
            openErrorHere?.fileId === file.id ? openErrorHere.message : null;

          return (
            <Attachment
              key={file.id}
              size="sm"
              // Ошибка открытия — это состояние строки, поэтому оно уходит в
              // `state`: компонент сам подсвечивает и рамку, и иконку.
              state={rowError ? "error" : "done"}
              className="w-full min-w-0"
            >
              {/*
                Вся строка — одна цель клика. `AttachmentTrigger` — это
                абсолютный `button` под контентом (`z-10`), поэтому клик
                работает по всей строке, а вложенных интерактивных элементов
                внутри `Attachment` не появляется: `button` в `button`
                недопустим. Открытие остаётся JS-обработчиком — ссылка
                получается только в момент клика, `<a href>` не используется.
              */}
              <AttachmentTrigger
                aria-label={`Открыть «${file.fileName}» в новой вкладке`}
                onClick={() => void openFile(file)}
                disabled={isOpening}
              />

              <AttachmentMedia
                className="border border-border-muted bg-bg-card2"
                aria-hidden="true"
              >
                <Icon />
              </AttachmentMedia>

              <AttachmentContent>
                <div className="flex min-w-0 items-center gap-2">
                  {/*
                    Категория показывается ИМЕННО сохранённым значением
                    `file.category`, а не выводится заново из MIME: выбор
                    пользователя — это данные, а не догадка. Бейдж стоит перед
                    именем и усекается вместе с ним (`max-w-full` + `truncate`
                    у заголовка).
                  */}
                  <Badge
                    variant="outline"
                    className="h-5 shrink-0 border-border-muted bg-bg-card2 px-1.5 text-[10.5px] font-medium text-fg-secondary"
                  >
                    {fileCategoryLabel(file.category)}
                  </Badge>
                  <AttachmentTitle className="text-fg">
                    {file.fileName}
                  </AttachmentTitle>
                </div>
                <AttachmentDescription className="font-mono text-fg-dim">
                  {fileMetaLine({
                    sizeBytes: file.sizeBytes,
                    createdAt: file.createdAt,
                    author: fileAuthorLabel(file),
                  })}
                  {rowError && (
                    // Текст ошибки остаётся подписью ЭТОЙ строки: `role="alert"`
                    // на нём, чтобы скринридер объявил отказ, а список
                    // продолжал работать.
                    <span role="alert"> · {rowError}</span>
                  )}
                </AttachmentDescription>
              </AttachmentContent>

              {/*
                Слот действий. `aria-hidden` на нём — потому что отдельной
                цели для таба здесь нет: единственная доступная кнопка строки —
                триггер выше, а иконка лишь подсказывает действие.
              */}
              <AttachmentActions aria-hidden="true">
                {isOpening ? (
                  <Loader2 className="size-4 animate-spin text-fg-muted" />
                ) : (
                  <AttachmentAction
                    tabIndex={-1}
                    className="text-fg-muted"
                    disabled={isOpening}
                  >
                    <ExternalLink />
                  </AttachmentAction>
                )}
              </AttachmentActions>
            </Attachment>
          );
        })}

      {/*
        Диалог загрузки. Монтируется всегда, но открыт только при выбранном
        файле: так выбор категории, состояние загрузки и ошибка живут внутри
        него, а список не знает ни о `FormData`, ни о статусах отправки.
      */}
      <FileUploadDialog
        key={`${specItemId}:${picked?.name ?? ""}:${picked?.size ?? 0}:${picked?.lastModified ?? 0}`}
        open={picked !== null}
        file={picked}
        orgSlug={orgSlug}
        specItemId={specItemId}
        onClose={() => setPicked(null)}
        onUploaded={handleUploaded}
      />
    </div>
  );
}
