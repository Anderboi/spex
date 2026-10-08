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
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  deleteSpecItemFile,
  getSpecItemFileUrl,
  listSpecItemFiles,
} from "@/actions/spec-item-files";
import { MAX_SPEC_ITEM_FILE_BYTES, MAX_SPEC_ITEM_FILE_LABEL } from "@/lib/spec/file-content";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";
import {
  fileAuthorLabel,
  fileCategoryLabel,
  fileKindOf,
  fileMetaLine,
  isLeavingDropZone,
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
  "flex flex-col pt-2 gap-1.5 rounded-xl py-1 transition-colors data-[drag-active=true]:bg-bg-card data-[drag-active=true]:outline-2 data-[drag-active=true]:outline-dashed data-[drag-active=true]:outline-offset-4 data-[drag-active=true]:outline-fg-brand [--card:#fcf9f3] [--card-foreground:#221d18] [--muted:#f5f2eb] [--muted-foreground:#a8a296] [--border:#e2ddd1]";

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
  /**
   * Курсор с файлами над вкладкой (drag & drop).
   *
   * Объявлено среди прочего состояния, потому что подсветку гасит в том числе
   * cleanup загрузки списка (смена позиции) — ссылаться на сеттер раньше его
   * объявления нельзя.
   */
  const [dragHover, setDragHover] = useState(false);

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

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** Удаление идёт: одна попытка на файл, повторный клик заблокирован. */
  const [deleting, setDeleting] = useState<{
    itemKey: string;
    fileId: string;
  } | null>(null);
  /**
   * Ошибка удаления: файл ОСТАЁТСЯ в списке. Оптимистичного удаления здесь нет
   * намеренно — иначе при отказе сервера пришлось бы восстанавливать строку, а
   * это ровно та потеря состояния, которой просили избежать.
   */
  const [deleteError, setDeleteError] = useState<{
    itemKey: string;
    fileId: string;
    message: string;
  } | null>(null);

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
     *
     * Здесь же гасится подсветка drag & drop: дроп мог закончиться сменой
     * позиции, и `dragleave` тогда не придёт вовсе. Сброс в cleanup, а не в
     * отдельном эффекте: подсветка — состояние ЭТОЙ операции загрузки списка.
     */
    return () => {
      requestIdRef.current += 1;
      urlRequestRef.current += 1;
      setDragHover(false);
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
   * Пока диалог открыт, повторный выбор файла запрещён.
   *
   * Загрузки идут строго по одной: второй параллельный upload не поддерживается
   * ни этим этапом, ни UI (в списке не было бы понятно, какая строка чья).
   */
  const dialogOpen = picked !== null;

  /**
   * Разбор выбранного файла — ОДНА точка входа для всех способов выбора.
   *
   * И picker (`change` у скрытого input), и drag & drop приходят сюда: дальше
   * путь общий — `FileUploadDialog`, выбор категории, `uploadSpecItemFile`.
   * Второго upload pipeline нет, отличается только способ получить `File`.
   *
   * Здесь только UX-проверки: файл есть и не больше лимита сервера. MIME и
   * сигнатуру содержимого проверяет сервер — второй такой проверки на клиенте
   * нет намеренно, иначе они разойдутся.
   */
  const acceptFile = useCallback((file: File | null) => {
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
   * `change` у скрытого input.
   *
   * `input.value` сбрасывается сразу после обработки: без этого повторный выбор
   * ТОГО ЖЕ файла не вызовет `change` (браузер считает значение неизменным), и
   * после ошибки пользователь не смог бы выбрать файл заново.
   */
  const handlePick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      event.target.value = "";
      acceptFile(file);
    },
    [acceptFile],
  );

  /* ------------------------------------------------------------------ */
  /*  Drag & drop                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Курсор с файлами над вкладкой.
   *
   * Состояние держится на `dragover`, а не на счётчике enter/leave. Счётчик
   * кажется очевидным решением, но он хрупкий: браузеры по-разному шлют пары
   * `dragenter`/`dragleave` для вложенных элементов, и счётчик легко
   * «застревает» (подсветка не снимается) или обнуляется раньше времени.
   *
   * `dragover` приходит многократно, пока курсор внутри зоны, и это делает
   * состояние самовосстанавливающимся: одно потерянное событие ничего не
   * ломает. А `dragleave` снимает подсветку только тогда, когда курсор ушёл
   * ИЗ зоны, а не на её дочерний элемент (`relatedTarget` внутри зоны).
   *
   * Само состояние (`dragHover`) объявлено выше, вместе с остальным.
   */
  /**
   * Приём файлов включён, как только список загружен, — НЕЗАВИСИМО от того,
   * пуст он или нет.
   *
   * Так drop работает и в пустом состоянии (`Empty` — цель перетаскивания), и
   * над непустым списком. Пока идёт загрузка списка или его не удалось прочитать,
   * приём выключен: неизвестно, что в позиции уже есть.
   */
  const isCurrent = loadedKey === specItemId;
  const dropEnabled = isCurrent && !dialogOpen && pendingDeleteId === null;

  /**
   * Итоговая подсветка — производная, а не отдельное состояние.
   *
   * Так не нужен эффект, снимающий подсветку при выходе из режима приёма:
   * когда список пропал (сменилась позиция, началась перезагрузка), выражение
   * само даёт `false`. Своё «сырое» состояние сбрасывают события (`drop`,
   * `dragleave`) и cleanup загрузки списка.
   */
  const dragActive = dragHover && dropEnabled;

  /**
   * Текст подсказки о перетаскивании: во время переноса он меняется на
   * приглашение отпустить — действие становится понятным без эксперимента.
   */
  const dropHint = dragActive
    ? "Отпустите файл для загрузки"
    : "Перетащите файл сюда";

  /**
   * Файл, для которого открыт диалог подтверждения.
   *
   * Ищем в текущем списке, а не храним объект целиком: если строку успели
   * удалить (например, с другой вкладки), в подтверждении не будет устаревшего
   * имени.
   */
  const pendingDeleteFile =
    files.find((file) => file.id === pendingDeleteId) ?? null;

  /** В `dataTransfer` действительно есть файлы (а не текст или ссылка). */
  const hasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const handleDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!dropEnabled || !hasFiles(event)) return;
      // Обязательно: без `preventDefault` браузер не считает элемент целью
      // drop и не пришлёт ни `dragover`, ни `drop`.
      event.preventDefault();
      setDragHover(true);
    },
    [dropEnabled],
  );

 const handleDragOver = (e: React.DragEvent) => {
   if (!hasFiles(e)) return;
   e.preventDefault(); // всегда, иначе браузер откроет файл сам
   e.dataTransfer.dropEffect = dropEnabled ? "copy" : "none";
   if (dropEnabled) setDragHover(true);
 };

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    // Уход на дочерний элемент (например, на строку списка) — это не выход из
    // зоны: подсветку снимать нельзя. Правило живёт в `isLeavingDropZone`,
    // потому что через синтетические события оно непроверяемо.
    if (!isLeavingDropZone(event.currentTarget, event.relatedTarget)) return;
    setDragHover(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      // Подсветка снимается всегда — сразу после drop, в том числе если файлов
      // в переносе не оказалось.
      setDragHover(false);
      if (!dropEnabled) return;

      event.preventDefault();

      // Один файл за раз: берём первый и не запускаем массовую загрузку.
      // Отдельного сообщения о «лишних» файлах нет — это самый предсказуемый
      // вариант: пользователь получает ровно то, что видит в диалоге.
      acceptFile(event.dataTransfer?.files?.[0] ?? null);
    },
    [dropEnabled, acceptFile],
  );

  /**
   * Удаление файла после подтверждения.
   *
   * Единственная операция удаления на вкладку: запрос уходит, только если для
   * этого файла он ещё не идёт, поэтому повторные клики (и Enter в диалоге) не
   * плодят запросы. Список НЕ меняется оптимистично: строка исчезает только
   * после успешного ответа, а при отказе остаётся на месте с текстом ошибки —
   * восстанавливать состояние не приходится.
   */
  const handleDelete = useCallback(async () => {
    const fileId = pendingDeleteId;
    if (!fileId) return;
    if (deleting?.fileId === fileId) return;

    const forItem = specItemId;
    setDeleting({ itemKey: forItem, fileId });
    setDeleteError(null);

    try {
      const res = await deleteSpecItemFile(orgSlug, forItem, fileId);
      if (specItemIdRef.current !== forItem) return;

      if (!res.success) {
        // Попытка завершилась — диалог закрываем: иначе он остался бы висеть
        // поверх списка, а сообщение об ошибке и сама строка были бы под ним.
        // Файл при этом остаётся в списке, ошибка видна у его строки, и
        // удаление можно повторить тем же способом.
        setPendingDeleteId(null);
        setDeleteError({ itemKey: forItem, fileId, message: res.error });
        return;
      }

      setFiles((current) => current.filter((file) => file.id !== fileId));
      setPendingDeleteId(null);
    } catch (cause) {
      if (specItemIdRef.current !== forItem) return;
      console.error("[FilesTab] удаление файла", cause);
      setPendingDeleteId(null);
      setDeleteError({
        itemKey: forItem,
        fileId,
        message: "Не удалось удалить файл",
      });
    } finally {
      if (specItemIdRef.current === forItem) setDeleting(null);
    }
  }, [pendingDeleteId, deleting, orgSlug, specItemId]);

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

  const loading = !isCurrent && (error === null || inFlight);
  const failed = !isCurrent && error !== null && !inFlight;
  /** Состояния открытия не «протекают» на другую позицию. */
  const openingHere = opening?.itemKey === specItemId ? opening : null;
  const openErrorHere = openError?.itemKey === specItemId ? openError : null;
  /** Строка удаляется прямо сейчас: кнопка удаления выключена и показывает спиннер. */
  const deletingHere = deleting?.itemKey === specItemId ? deleting : null;
  /** Ошибка удаления — под строкой своего файла, пока пользователь её не повторит. */
  const deleteErrorHere =
    deleteError?.itemKey === specItemId ? deleteError : null;

  return (
    <div
      className={LIST_CLASS}
      /*
        Подсветка drop-зоны — атрибутом, а не классом из состояния: классы
        Tailwind одной группы не переопределяют друг друга по порядку в строке
        (см. AGENTS.md), поэтому условный `border-*` мог бы молча проиграть
        базовому. Селектор `data-[drag-active=true]:…` не зависит от порядка.
      */
      data-drag-active={dragActive ? "true" : "false"}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            Повторить
          </Button>
        </div>
      )}

      {dragActive && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-fg-brand bg-bg-card/90 backdrop-blur-sm *:pointer-events-none"
          onDragLeave={() => setDragHover(false)}
        >
          <Upload className="size-6 text-fg-brand motion-safe:animate-bounce" />
          <p className="text-[13px] font-medium text-fg">
            Отпустите, чтобы добавить файл
          </p>
          <p className="text-[12px] text-fg-muted">
            до {MAX_SPEC_ITEM_FILE_LABEL}
          </p>
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
        <Empty className="gap-3 border-2 border-border-muted px-4 py-8">
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
              Перетащите файл сюда или добавьте его кнопкой — счета,
              спецификации поставщика и другие вложения к этому материалу.
            </EmptyDescription>
          </EmptyHeader>

          <EmptyContent className="gap-2">
            <Button
              type="button"
              variant="outline"
              // size="sm"
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
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            {/*
              Подсказка о перетаскивании: делает drop обнаружимым, не занимая
              места. Во время переноса текст меняется на приглашение отпустить —
              это часть состояния зоны, layout при этом не двигается.
            */}
            <span
              className={
                dragActive
                  ? "min-w-0 truncate text-[11.5px] font-medium text-fg-brand"
                  : "min-w-0 truncate text-[11.5px] text-fg-muted"
              }
            >
              {dropHint}
            </span>

            <Button
              type="button"
              variant="outline"
              // size="sm"
              className="shrink-0 gap-1.5"
              disabled={dialogOpen}
              onClick={() => pickerRef.current?.click()}
            >
              <Plus className="size-3.5" />
              Добавить файл
            </Button>
          </div>

          {/*
            Ошибка выбора показывается и при непустом списке: сюда попадает в
            том числе слишком большой файл, перетащенный в зону, — сообщение не
            должно теряться только потому, что строки уже есть. В пустом
            состоянии эта же ошибка выводится внутри `Empty`, поэтому условия
            взаимоисключающие и дубля не возникает.
          */}
          {pickError && (
            <p role="alert" className="text-right text-[12px] text-fg-red">
              {pickError}
            </p>
          )}
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
              // size="sm"
              // orientation="vertical"
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
                  {deleteErrorHere?.fileId === file.id && (
                    // Ошибка удаления — тоже подпись своей строки: файл остался
                    // в списке, и рядом видно, почему.
                    <span role="alert" className="text-fg-red">
                      {" · "}
                      {deleteErrorHere.message}
                    </span>
                  )}
                </AttachmentDescription>
              </AttachmentContent>

              {/*
                Слот действий. `aria-hidden` здесь нет: в нём теперь настоящая
                кнопка удаления со своим `aria-label`, и прятать её от
                скринридера нельзя. Иконка-подсказка открытия, наоборот, из
                дерева доступности убрана — отдельной цели для таба у неё нет,
                единственная кнопка строки для таба — триггер выше.
              */}
              <AttachmentActions>
                {isOpening ? (
                  <Loader2 className="size-4 animate-spin text-fg-muted" />
                ) : (
                  <AttachmentAction
                    tabIndex={-1}
                    aria-hidden="true"
                    className="text-fg-muted"
                    disabled={isOpening}
                  >
                    <ExternalLink />
                  </AttachmentAction>
                )}

                {/*
                  Кнопка удаления живёт в слоте действий (`z-20`), поэтому её
                  клик не доходит до триггера строки (`z-10`) и файл не
                  открывается. Вложенных `button` в `button` не возникает:
                  триггер — отдельный абсолютный элемент, а не родитель.
                */}
                <AttachmentAction
                  aria-label={`Удалить «${file.fileName}»`}
                  title="Удалить"
                  className="text-fg-muted hover:bg-bg-red-light hover:text-fg-red"
                  disabled={deletingHere?.fileId === file.id}
                  onClick={() => setPendingDeleteId(file.id)}
                >
                  {deletingHere?.fileId === file.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          );
        })}

      {/*
        Подтверждение удаления — один диалог на вкладку, а не свой у каждой
        строки: иначе в списке одновременно жило бы столько невидимых диалогов,
        сколько файлов. Тот же `AlertDialog`, что и у удаления материалов и
        контактов.
      */}
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(next) => !next && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить файл?</AlertDialogTitle>
            <AlertDialogDescription>
              {/* Имя файла — из списка: строку могли уже удалить с другой
                  вкладки, тогда текст остаётся общим, без пустых кавычек. */}
              {pendingDeleteFile
                ? `Файл «${pendingDeleteFile.fileName}» будет удалён.`
                : "Файл будет удалён."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleting !== null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
