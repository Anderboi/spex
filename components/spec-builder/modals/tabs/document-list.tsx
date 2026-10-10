"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Paperclip, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  deleteSpecItemFile,
  getSpecItemFileUrl,
  updateSpecItemFile,
  uploadSpecItemFile,
} from "@/actions/spec-item-files";
import {
  MAX_SPEC_ITEM_FILE_BYTES,
  MAX_SPEC_ITEM_FILE_LABEL,
} from "@/lib/spec/file-content";
import {
  FILE_GROUP_OPTIONS,
  fileGroupDotClass,
  fileGroupOf,
  fileKindOf,
  isLeavingDropZone,
  type SpecItemFileGroup,
} from "@/lib/spec/file-view";
import type { SpecItemFileCategory } from "@/lib/spec/file-content";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";
import DocumentRow from "./document-row";
import type { FileList } from "./use-file-list";

/**
 * Список документов позиции: группы, фильтры, загрузка и действия со строкой.
 *
 * ── Почему отдельный компонент, а не разметка внутри вкладки ────────────────
 *
 * Документ позиции виден в ДВУХ местах: во вкладке «Файлы» (все документы) и в
 * карточке оплаты (документы одной проводки). Список у них один и тот же —
 * отличается только выборка, — поэтому и разметка должна быть одна. Вторая
 * копия разошлась бы с первой в первой же правке: у одной появился бы фильтр,
 * у другой нет.
 *
 * Компонент НЕ читает данные сам: загрузка списка, отказ и повтор — дело
 * вкладки, которая знает про смену позиции и гонки ответов. Здесь только то,
 * что относится к показу и правке уже полученного списка: `loading` рисует
 * строки-заготовки, а панель отказа живёт во вкладке — она одна на экран, и
 * вторая такая же внутри списка была бы недостижима.
 *
 * ── Группы, фильтры и сворачивание ─────────────────────────────────────────
 *
 * Вид документа — это «что за файл» (девять значений), группа — «зачем он
 * нужен» (четыре). Плоский список из девяти бейджей читается как шум, поэтому
 * документы разложены по группам, а сверху стоят фильтр-чипы со счётчиками.
 *
 * Свёрнутыми группы показываются только при БОЛЬШОМ списке (`COLLAPSE_FROM`):
 * на трёх файлах сворачивание прячет содержимое, которое и так видно целиком.
 * При выбранном фильтре группы раскрываются принудительно — иначе клик по чипу
 * «Закупка» приводил бы к свёрнутой группе и пустому экрану.
 *
 * ── Загрузка без диалога ───────────────────────────────────────────────────
 *
 * Вид документа спрашивать не нужно: он угадывается сервером по формату файла
 * (`guessSpecItemFileCategory`), а потом правится прямо в строке. Поэтому
 * drop-зона и кнопка принимают файлы СРАЗУ, несколькими, и каждый встаёт строкой
 * со статусом «Загружается». Прогресса в процентах нет намеренно: server action
 * его не отдаёт, а рисовать выдуманные проценты — обман.
 *
 * ── Просмотр, скачивание и правка ──────────────────────────────────────────
 *
 * Ссылка запрашивается ТОЛЬКО по клику и только на один файл: заранее
 * подписывать список нельзя. Исключение — миниатюры изображений: без ссылки
 * превью не нарисовать, поэтому для картинок ссылка запрашивается один раз и
 * кладётся в кэш этого списка; ошибка подписи или декодирования не мешает
 * строке — остаётся иконка.
 *
 * Правка (вид документа, имя) уходит отдельным действием и в ответе приносит
 * запись сервера: строка обновляется ею, а не локальной догадкой.
 */

/** Сколько строк-заготовок показывать при загрузке. */
const SKELETON_ROWS = 4;

/** С какого числа файлов группы показываются свёрнутыми. */
const COLLAPSE_FROM = 8;

/**
 * Контейнер списка.
 *
 * Переменные темы переопределяются на уровне списка, а не классами на каждой
 * строке: `Attachment` построен на семантических токенах (`bg-card`, `bg-muted`,
 * `text-card-foreground`), а они в проекте стоковые — белые и серые. Приложение
 * живёт на тёплой палитре, и перенаправление токенов сохраняет визуальный язык
 * модалки, не трогая сам компонент.
 */
const LIST_CLASS =
  "relative flex flex-col gap-1.5 rounded-xl pb-1 pt-2 transition-colors data-[drag-active=true]:bg-bg-card data-[drag-active=true]:outline-2 data-[drag-active=true]:outline-dashed data-[drag-active=true]:outline-offset-4 data-[drag-active=true]:outline-fg-brand [--card:#fcf9f3] [--card-foreground:#221d18] [--muted:#f5f2eb] [--muted-foreground:#a8a296] [--border:#e2ddd1]";

/** Файл, который прямо сейчас отправляется на сервер. */
type PendingUpload = {
  /** Ключ строки: у файла ещё нет id, а `key` нужен сразу. */
  key: string;
  name: string;
  sizeBytes: number;
};

export type DocumentListProps = {
  orgSlug: string;
  specItemId: string;
  files: SpecItemFileEntry[];
  /** Идёт загрузка списка: показываются строки-заготовки. */
  loading: boolean;
  /** Оплата, к которой прикрепляется загруженный документ; `null` — ни к чему. */
  paymentId?: string | null;
  /** Право на загрузку, правку и удаление (`record:create`); иначе только чтение. */
  canWrite: boolean;
  onUploaded: (entry: SpecItemFileEntry) => void;
  onChanged: (entry: SpecItemFileEntry) => void;
  onDeleted: (fileId: string) => void;
  /**
   * Выполнить правку с оптимистичным показом результата.
   *
   * Приходит из `use-file-list`: оптимистичное состояние живёт рядом со списком
   * (у вкладки), а не внутри показа, поэтому список только сообщает, ЧТО
   * показать сразу. Отказ сервера откатывает показ сам React, а список
   * показывает текст отказа у строки.
   */
  mutate: FileList["mutate"];
  /**
   * Заголовок над списком; `null` — без заголовка (в карточке оплаты он лишний:
   * строка оплаты уже подписана).
   */
  title?: string | null;
  /** Подпись пустого состояния. */
  emptyHint?: string;
};

/** Строка-заготовка: та же геометрия, что у настоящей строки `Attachment`. */
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

/** Точка цвета группы: тем же цветом помечены чип фильтра и заголовок секции. */
function GroupDot({ group }: { group: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2 shrink-0 rounded-full", fileGroupDotClass(group))}
    />
  );
}

export default function DocumentList({
  orgSlug,
  specItemId,
  files,
  loading,
  paymentId = null,
  canWrite,
  onUploaded,
  onChanged,
  onDeleted,
  mutate,
  title = null,
  emptyHint = "Перетащите файл сюда или добавьте его кнопкой — счета, спецификации поставщика и другие вложения к этому материалу.",
}: DocumentListProps) {
  /** Выбранный фильтр: `null` — «Все». */
  const [filter, setFilter] = useState<SpecItemFileGroup | null>(null);
  /** Свёрнутые группы: только явно свёрнутые пользователем. */
  const [collapsed, setCollapsed] = useState<Partial<Record<SpecItemFileGroup, boolean>>>(
    {},
  );

  /** Курсор с файлами над списком (drag & drop). */
  const [dragHover, setDragHover] = useState(false);
  /** Файлы в очереди на отправку: строки «Загружается». */
  const [pending, setPending] = useState<PendingUpload[]>([]);
  /** UX-ошибка выбора (размер, права): до сервера дело не доходит. */
  const [pickError, setPickError] = useState<string | null>(null);
  /** Ошибка загрузки — на весь список, а не на строку: строки уже нет. */
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Ошибка открытия/скачивания: у своей строки, список продолжает работать. */
  const [rowError, setRowError] = useState<{ fileId: string; message: string } | null>(
    null,
  );
  /** Файл, для которого сейчас получаем ссылку. */
  const [busyFile, setBusyFile] = useState<{
    fileId: string;
    kind: "open" | "download";
  } | null>(null);
  /** Вид документа, который сейчас меняется (строка показывает спиннер). */
  const [savingCategory, setSavingCategory] = useState<string | null>(null);
  /** Файл, для которого открыт диалог переименования. */
  const [renaming, setRenaming] = useState<SpecItemFileEntry | null>(null);
  /** Файл, для которого открыто подтверждение удаления. */
  const [pendingDelete, setPendingDelete] = useState<SpecItemFileEntry | null>(null);
  /** Идёт удаление: кнопка подтверждения выключена. */
  const [deleting, setDeleting] = useState(false);
  /** Подписанные ссылки на миниатюры изображений: путь → URL. */
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  /**
   * Файл, у которого открыт селект вида документа.
   *
   * Состояние живёт здесь, а не внутри `Popover`, по одной причине: открыть
   * селект можно из ДВУХ мест — чипа вида в строке и пункта «Сменить вид» в
   * действиях. Управляемый поповер делает это одним присваиванием, а не поиском
   * триггера по разметке (`document.querySelector`), который ломается от любой
   * правки текста подписи.
   */
  const [categoryOpenFor, setCategoryOpenFor] = useState<string | null>(null);

  /** Скрытый `<input type="file">`: открывается кнопкой «Добавить файл». */
  const pickerRef = useRef<HTMLInputElement>(null);
  /** Уже запрошенные миниатюры: повторный запрос по той же строке не нужен. */
  const thumbsRequestedRef = useRef(new Set<string>());
  /** Актуальная позиция: ответы прошлых позиций не должны попадать в список. */
  const specItemIdRef = useRef(specItemId);
  useEffect(() => {
    specItemIdRef.current = specItemId;
  }, [specItemId]);

  /* ------------------------------------------------------------------ */
  /*  Группы, фильтры и счётчики                                         */
  /* ------------------------------------------------------------------ */

  /** Файлы по группам: порядок внутри группы — серверный, клиент не сортирует. */
  const grouped = useMemo(() => {
    const map = new Map<SpecItemFileGroup, SpecItemFileEntry[]>();
    for (const option of FILE_GROUP_OPTIONS) map.set(option.value, []);
    for (const file of files) map.get(fileGroupOf(file.category))!.push(file);
    return map;
  }, [files]);

  /** Счётчики для чипов: только непустые группы. */
  const counters = useMemo(
    () =>
      FILE_GROUP_OPTIONS.map((option) => ({
        ...option,
        count: grouped.get(option.value)?.length ?? 0,
      })).filter((option) => option.count > 0),
    [grouped],
  );

  const shownGroups = useMemo(
    () =>
      FILE_GROUP_OPTIONS.filter(
        (option) => filter === null || option.value === filter,
      ).filter((option) => (grouped.get(option.value)?.length ?? 0) > 0),
    [filter, grouped],
  );

  /**
   * Свёрнута ли группа.
   *
   * При выбранном фильтре группа раскрыта ВСЕГДА: иначе клик по чипу «Закупка»
   * показывал бы свёрнутый заголовок и пустоту под ним.
   *
   * Состояние хранит НЕ «свёрнута ли», а явное решение пользователя, потому что
   * у списка есть второе состояние по умолчанию (`groupsStartCollapsed`):
   * храни мы «свёрнута», первый клик по большой группе не отличался бы от
   * состояния «пользователь её ещё не трогал».
   */
  const isGroupOpen = (group: SpecItemFileGroup) =>
    filter !== null ||
    collapsed[group] === false ||
    (collapsed[group] === undefined && !groupsStartCollapsed);

  const toggleGroup = (group: SpecItemFileGroup) =>
    setCollapsed((current) => ({
      ...current,
      [group]: isGroupOpen(group),
    }));

  /**
   * Список уже прочитан. Отказ чтения сюда не доходит: панель отказа рисует
   * вкладка, и пока она это делает, списка здесь просто нет.
   */
  const isCurrent = !loading;
  const isAnyFile = files.length > 0;
  /** Большой список — группы свёрнуты по умолчанию (кроме выбранного фильтра). */
  const groupsStartCollapsed = files.length > COLLAPSE_FROM;

  /* ------------------------------------------------------------------ */
  /*  Миниатюры изображений                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Подписать изображения списка — по одной ссылке на файл, один раз.
   *
   * Исключение из правила «ссылка только по клику»: без ссылки превью не
   * нарисовать, а превью и есть смысл картинки в списке. Ошибка подписи ничего
   * не ломает — строка остаётся с иконкой вида.
   *
   * Кэш живёт в состоянии списка и намеренно НЕ переживает размонтирование:
   * ссылка короткоживущая (5 минут), и хранить её дольше — держать протухший
   * URL. Повторное открытие подпишет заново.
   *
   * Эффект перезапускается на каждое изменение `files`, но повторных запросов не
   * делает: уже запрошенные строки отсекает `thumbsRequestedRef`.
   */
  useEffect(() => {
    if (!isCurrent) return;

    for (const file of files) {
      if (thumbsRequestedRef.current.has(file.id)) continue;
      if (fileKindOf(file) !== "image") continue;

      thumbsRequestedRef.current.add(file.id);
      const forItem = specItemId;

      void (async () => {
        try {
          const res = await getSpecItemFileUrl(orgSlug, forItem, file.id);
          if (specItemIdRef.current !== forItem) return;
          if (!res.success) return;
          setThumbs((current) => ({ ...current, [file.id]: res.data.url }));
        } catch (cause) {
          console.error("[DocumentList] миниатюра", cause);
        }
      })();
    }
  }, [files, isCurrent, orgSlug, specItemId]);

  /* ------------------------------------------------------------------ */
  /*  Загрузка                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Приём файлов — ОДНА точка входа для всех способов выбора.
   *
   * И picker, и drag & drop приходят сюда: дальше путь общий. Проверки только
   * UX-величин: файл есть, размер в пределах лимита сервера, право на запись.
   * MIME, сигнатуру содержимого и вид документа определяет сервер — второй
   * такой проверки на клиенте нет намеренно, иначе они разойдутся.
   *
   * Файлы отправляются ПО ОДНОМУ, последовательно: параллельная отправка
   * десятка файлов конкурировала бы за полосу и грузила бы их все в память
   * сразу. Очередь видна строками «Загружается».
   */
  const acceptFiles = useCallback(
    (picked: File[]) => {
      if (picked.length === 0) return;

      if (!canWrite) {
        setPickError("Недостаточно прав для загрузки файлов");
        return;
      }

      const tooBig = picked.find((file) => file.size > MAX_SPEC_ITEM_FILE_BYTES);
      if (tooBig) {
        setPickError(
          `Файл «${tooBig.name}» больше ${MAX_SPEC_ITEM_FILE_LABEL} и не был загружен.`,
        );
        return;
      }

      setPickError(null);
      setUploadError(null);

      const queue: PendingUpload[] = picked.map((file, index) => ({
        key: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        sizeBytes: file.size,
      }));
      setPending((current) => [...current, ...queue]);

      void (async () => {
        for (const [index, file] of picked.entries()) {
          const row = queue[index];
          const forItem = specItemId;

          const formData = new FormData();
          formData.set("file", file);
          // Вид документа НЕ отправляется: его угадывает сервер, а человек
          // поправит в строке. Явное значение здесь означало бы, что клиент
          // решает за сервер то, что сервер знает точнее.
          formData.set("payment_id", paymentId ?? "");

          try {
            const res = await uploadSpecItemFile(orgSlug, forItem, formData);

            // Позиция сменилась — ответ относится к прошлой: в текущий список
            // он не попадает. Свою строку «Загружается» снимет `finally`:
            // чужая позиция свой список уже перезагружает.
            if (specItemIdRef.current !== forItem) continue;

            if (!res.success) {
              setUploadError(res.error);
              continue;
            }

            // Успех снимает прошлый отказ: иначе красный текст висел бы над
            // списком после того, как следующий файл загрузился.
            setUploadError(null);
            onUploaded(res.data);
          } catch (cause) {
            if (specItemIdRef.current !== forItem) continue;
            console.error("[DocumentList] загрузка", cause);
            setUploadError("Не удалось загрузить файл");
          } finally {
            setPending((current) => current.filter((item) => item.key !== row.key));
          }
        }
      })();
    },
    [canWrite, onUploaded, orgSlug, paymentId, specItemId],
  );

  /**
   * `change` у скрытого input.
   *
   * `input.value` сбрасывается сразу: без этого повторный выбор ТОГО ЖЕ файла
   * не вызовет `change` (браузер считает значение неизменным), и после ошибки
   * пользователь не смог бы выбрать файл заново.
   */
  const handlePick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(event.target.files ?? []);
      event.target.value = "";
      acceptFiles(picked);
    },
    [acceptFiles],
  );

  /* ------------------------------------------------------------------ */
  /*  Drag & drop                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Подсветка всей области вкладки, а не подписи — см. `dragActive`.
   *
   * Состояние держится на `dragover`, а не на счётчике enter/leave: счётчик
   * хрупкий (браузеры по-разному шлют пары для вложенных элементов) и легко
   * «застревает». `dragover` приходит многократно, пока курсор внутри зоны, и
   * состояние самовосстанавливается.
   */
  const dropEnabled = isCurrent && canWrite && renaming === null && !deleting;

  const dragActive = dragHover && dropEnabled;

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

  const handleDragOver = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dropEnabled ? "copy" : "none";
    if (dropEnabled) setDragHover(true);
  };

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    // Уход на дочерний элемент — это не выход из зоны: правило живёт в
    // `isLeavingDropZone`, потому что через синтетические события оно
    // непроверяемо.
    if (!isLeavingDropZone(event.currentTarget, event.relatedTarget)) return;
    setDragHover(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      // Подсветка снимается всегда — в том числе если файлов в переносе не было.
      setDragHover(false);
      if (!dropEnabled) return;

      event.preventDefault();
      acceptFiles(Array.from(event.dataTransfer?.files ?? []));
    },
    [dropEnabled, acceptFiles],
  );

  /* ------------------------------------------------------------------ */
  /*  Открытие, скачивание, правка, удаление                              */
  /* ------------------------------------------------------------------ */

  /**
   * Ссылка на файл: `download` отличает скачивание от просмотра.
   *
   * Ссылка запрашивается ТОЛЬКО по клику и только для одного файла: заранее
   * подписывать весь список нельзя — это лишние запросы и лишние живые ссылки.
   */
  const openFile = useCallback(
    async (file: SpecItemFileEntry, forDownload: boolean) => {
      const forItem = specItemId;
      setBusyFile({ fileId: file.id, kind: forDownload ? "download" : "open" });
      setRowError(null);

      try {
        const res = await getSpecItemFileUrl(orgSlug, forItem, file.id, forDownload);
        if (specItemIdRef.current !== forItem) return;

        if (!res.success) {
          setRowError({ fileId: file.id, message: res.error });
          return;
        }

        if (forDownload) {
          // Скачивание — переход по подписанной ссылке с `attachment`: браузер
          // сохраняет файл под исходным именем, а вкладка не открывается.
          const link = document.createElement("a");
          link.href = res.data.url;
          link.rel = "noopener";
          document.body.append(link);
          link.click();
          link.remove();
          return;
        }

        // `noopener` обязателен: без него открытая страница получает
        // `window.opener` и может управлять вкладкой приложения.
        window.open(res.data.url, "_blank", "noopener,noreferrer");
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return;
        console.error("[DocumentList] ссылка на файл", cause);
        setRowError({ fileId: file.id, message: "Не удалось открыть файл" });
      } finally {
        if (specItemIdRef.current === forItem) setBusyFile(null);
      }
    },
    [orgSlug, specItemId],
  );

  /**
   * Правка вида документа.
   *
   * Вид показывается СРАЗУ (пользователь его уже выбрал), а запись сервера затем
   * заменяет догадку: только сервер знает, что записалось (`category` проходит
   * через CHECK-список), и только он отдаёт подпись связанной оплаты. Отказ
   * сервера откатывает показ и оставляет текст отказа у строки.
   */
  const changeCategory = useCallback(
    async (file: SpecItemFileEntry, category: SpecItemFileCategory) => {
      const forItem = specItemId;
      setSavingCategory(file.id);
      setRowError(null);

      const formData = new FormData();
      formData.set("category", category);

      try {
        const res = await mutate(
          { type: "category", fileId: file.id, category },
          () => updateSpecItemFile(orgSlug, forItem, file.id, formData),
        );
        if (specItemIdRef.current !== forItem) return;

        if (!res.success) {
          setRowError({ fileId: file.id, message: res.error });
          return;
        }

        onChanged(res.data.file);
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return;
        console.error("[DocumentList] смена вида документа", cause);
        setRowError({ fileId: file.id, message: "Не удалось изменить вид документа" });
      } finally {
        if (specItemIdRef.current === forItem) setSavingCategory(null);
      }
    },
    [mutate, onChanged, orgSlug, specItemId],
  );

  /** Открыть диалог переименования с текущим именем файла. */
  const startRename = useCallback((file: SpecItemFileEntry) => {
    setRowError(null);
    setRenaming(file);
  }, []);

  /** Сохранить новое имя; возвращает текст ошибки или `null`. */
  const submitRename = useCallback(
    async (name: string): Promise<string | null> => {
      const file = renaming;
      if (!file) return null;

      const forItem = specItemId;
      const formData = new FormData();
      formData.set("file_name", name);

      try {
        const res = await mutate(
          { type: "name", fileId: file.id, fileName: name },
          () => updateSpecItemFile(orgSlug, forItem, file.id, formData),
        );
        if (specItemIdRef.current !== forItem) return null;
        if (!res.success) return res.error;

        onChanged(res.data.file);
        setRenaming(null);
        return null;
      } catch (cause) {
        if (specItemIdRef.current !== forItem) return null;
        console.error("[DocumentList] переименование", cause);
        return "Не удалось переименовать файл";
      }
    },
    [mutate, onChanged, orgSlug, renaming, specItemId],
  );

  /**
   * Удаление после подтверждения.
   *
   * Строка исчезает СРАЗУ — пользователь уже подтвердил удаление в диалоге, и
   * ждать ответа, глядя на строку, которую он только что удалил, незачем. Отказ
   * сервера возвращает строку на место и показывает текст отказа у неё.
   *
   * Подтверждение — диалог, а не toast с «Отменить»: удаление мягкое, но объект
   * в Storage сносится best-effort и вернуть его мы не можем, поэтому «Отменить»
   * было бы обещанием, которого приложение не выполнит.
   */
  const removeFile = useCallback(async () => {
    const file = pendingDelete;
    if (!file || deleting) return;

    const forItem = specItemId;
    setDeleting(true);
    setRowError(null);

    try {
      const res = await mutate(
        { type: "deleted", fileId: file.id },
        () => deleteSpecItemFile(orgSlug, forItem, file.id),
      );
      if (specItemIdRef.current !== forItem) return;

      if (!res.success) {
        // Диалог закрывается: строка возвращается на место (оптимистичное
        // состояние откатывает React), и текст отказа виден у неё самой.
        setPendingDelete(null);
        setRowError({ fileId: file.id, message: res.error });
        return;
      }

      onDeleted(file.id);
      setPendingDelete(null);
    } catch (cause) {
      if (specItemIdRef.current !== forItem) return;
      console.error("[DocumentList] удаление файла", cause);
      setPendingDelete(null);
      setRowError({ fileId: file.id, message: "Не удалось удалить файл" });
    } finally {
      if (specItemIdRef.current === forItem) setDeleting(false);
    }
  }, [deleting, mutate, onDeleted, orgSlug, pendingDelete, specItemId]);

  /* ------------------------------------------------------------------ */
  /*  Разметка                                                           */
  /* ------------------------------------------------------------------ */

  const addButton = (variant: "empty" | "inline") => (
    <Button
      type="button"
      variant="outline"
      className={cn("gap-1.5", variant === "inline" && "shrink-0")}
      disabled={!canWrite || dragActive}
      onClick={() => pickerRef.current?.click()}
    >
      <Plus className="size-3.5" />
      Добавить файл
    </Button>
  );

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
        Скрытый native input живёт вне веток состояния: и empty state, и кнопка
        над списком открывают ОДИН и тот же picker. `multiple` включён: файлы
        выбираются пачкой — это и есть смысл загрузки без диалога.
      */}
      <input
        ref={pickerRef}
        type="file"
        multiple
        className="hidden"
        onChange={handlePick}
        aria-label="Выбрать файлы для загрузки"
      />

      {/* ── Шапка: заголовок, «Добавить файл», фильтры и drop-зона ────── */}
      {((title !== null && title !== undefined) ||
        isAnyFile ||
        pending.length > 0) && (
        <div className="flex flex-col gap-2">
          {/*
            Строка заголовка показывается, только если её есть чем занять
            (заголовком или кнопкой): в карточке оплаты заголовок не нужен, но
            кнопка «Добавить файл» нужна — иначе прикрепить чек было бы нечем.
          */}
          {((title !== null && title !== undefined) ||
            (canWrite && isAnyFile)) && (
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-[11.5px] text-fg-muted">
                {title}
              </span>
              {canWrite && isAnyFile && addButton("inline")}
            </div>
          )}

          {counters.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {/*
                Чип «Все» показывается всегда, даже когда непустая группа одна:
                это и счётчик файлов, и способ снять фильтр — без него, выбрав
                группу, вернуться ко всему списку было бы нечем. Значение фильтра
                у него `null` — отдельной группы «Все» в данных нет.
              */}
              <button
                type="button"
                aria-pressed={filter === null}
                onClick={() => setFilter(null)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
                  filter === null
                    ? "border-fg bg-fg text-bg-card"
                    : "border-border-muted text-fg-secondary hover:bg-bg-card2",
                )}
              >
                Все
                <span className="opacity-70">{files.length}</span>
              </button>

              {counters.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() =>
                    setFilter((current) =>
                      current === option.value ? null : option.value,
                    )
                  }
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
                    filter === option.value
                      ? "border-fg bg-fg text-bg-card"
                      : "border-border-muted text-fg-secondary hover:bg-bg-card2",
                  )}
                >
                  <GroupDot group={option.value} />
                  {option.label}
                  <span className="opacity-70">{option.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading &&
        Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} aria-hidden="true">
            <FileRowSkeleton />
          </div>
        ))}

      {/*
        Подсветка перетаскивания — накладкой на всю область списка: подпись
        «перетащите сюда» слишком мелкая цель, чтобы её заметить, а подсветка
        целой зоны отвечает на вопрос «куда отпускать» без чтения текста.
      */}
      {dragActive && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-fg-brand bg-bg-card/90 backdrop-blur-sm *:pointer-events-none">
          <Upload className="size-6 text-fg-brand motion-safe:animate-bounce" />
          <p className="text-[13px] font-medium text-fg">
            Отпустите, чтобы добавить файлы
          </p>
          <p className="text-[12px] text-fg-muted">
            вид документа определится по типу файла · до{" "}
            {MAX_SPEC_ITEM_FILE_LABEL}
          </p>
        </div>
      )}

      {/* ── Строки «Загружается» ─────────────────────────────────────── */}
      {pending.map((item) => (
        <div
          key={item.key}
          className="flex w-full items-center gap-2.5 rounded-xl border border-border-muted bg-bg-card px-2 py-1.5"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bg-card2">
            <Loader2 className="size-4 animate-spin text-fg-muted" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="line-clamp-2 wrap-break-word text-[13px] font-medium text-fg">
              {item.name}
            </span>
            <span className="text-[11.5px] text-fg-dim">
              Загружается · вид документа определится по типу файла
            </span>
          </div>
        </div>
      ))}

      {/*
        Пустое состояние — приглашение, а не тупик: здесь же drop-зона и кнопка,
        потому что до первого файла списка ещё нет.
      */}
      {isCurrent && !isAnyFile && pending.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border-muted px-4 py-8 text-center">
          <span
            className="flex size-9 items-center justify-center rounded-lg border border-border-muted bg-bg-card2 text-fg-muted"
            aria-hidden="true"
          >
            <Paperclip className="size-4" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-[14px] font-medium text-fg">Файлов пока нет</p>
            <p className="max-w-xs text-[12.5px] text-fg-muted">{emptyHint}</p>
          </div>
          {canWrite && addButton("empty")}
        </div>
      )}

      {/* Ошибка выбора и ошибка загрузки — над списком, а не в строке. */}
      {pickError && (
        <p role="alert" className="px-1 text-[12px] text-fg-red">
          {pickError}
        </p>
      )}
      {uploadError && (
        <p role="alert" className="px-1 text-[12px] text-fg-red">
          {uploadError}
        </p>
      )}

      {/* ── Группы со строками ───────────────────────────────────────── */}
      {isCurrent &&
        isAnyFile &&
        shownGroups.map((option) => {
          const groupFiles = grouped.get(option.value) ?? [];
          const open = isGroupOpen(option.value);

          return (
            <div key={option.value} className="flex flex-col">
              {/*
                Заголовок группы — кнопка: сворачивание это действие, и оно
                должно быть доступно с клавиатуры. Доступное имя называет
                ДЕЙСТВИЕ, а не только группу («Свернуть группу „Закупка“»):
                «Закупка 3» диктор прочитал бы как подпись, и что нажатие
                сворачивает список, осталось бы загадкой. `aria-expanded`
                сообщает состояние.
              */}
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Свернуть" : "Развернуть"} группу «${option.label}»`}
                onClick={() => toggleGroup(option.value)}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left hover:bg-bg-card2"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0 text-fg-dim transition-transform",
                    !open && "-rotate-90",
                  )}
                />
                <GroupDot group={option.value} />
                <span className="text-[12.5px] font-medium text-fg">
                  {option.label}
                </span>
                <span className="rounded-full border border-border-muted px-1.5 text-[11px] text-fg-muted">
                  {groupFiles.length}
                </span>
              </button>

              {open &&
                groupFiles.map((file) => (
                  <DocumentRow
                    key={file.id}
                    file={file}
                    canWrite={canWrite}
                    thumb={thumbs[file.id] ?? null}
                    onThumbFailed={(fileId) =>
                      setThumbs((current) => {
                        const next = { ...current };
                        delete next[fileId];
                        return next;
                      })
                    }
                    onOpen={(target) => void openFile(target, false)}
                    onDownload={(target) => void openFile(target, true)}
                    onRename={startRename}
                    onDelete={setPendingDelete}
                    onCategory={(target, category) => {
                      void changeCategory(target, category);
                      setCategoryOpenFor(null);
                    }}
                    opening={
                      busyFile?.fileId === file.id && busyFile.kind === "open"
                    }
                    downloading={
                      busyFile?.fileId === file.id &&
                      busyFile.kind === "download"
                    }
                    savingCategory={savingCategory === file.id}
                    categoryOpen={categoryOpenFor === file.id}
                    onCategoryOpenChange={(next) =>
                      setCategoryOpenFor(next ? file.id : null)
                    }
                    error={
                      rowError?.fileId === file.id ? rowError.message : null
                    }
                  />
                ))}
            </div>
          );
        })}

      {/* Ничего не найдено при выбранном фильтре. */}
      {isCurrent && isAnyFile && shownGroups.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-muted px-4 py-8 text-center">
          <p className="text-[13px] text-fg-muted">
            В этой группе документов нет.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFilter(null)}
          >
            Показать все
          </Button>
        </div>
      )}

      {/* ── Подтверждение удаления ───────────────────────────────────── */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить файл?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `«${pendingDelete.fileName}» исчезнет из позиции и из оплаты, если он к ней прикреплён.`
                : "Файл исчезнет из позиции."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void removeFile()}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Переименование ───────────────────────────────────────────── */}
      <RenameDialog
        key={renaming?.id ?? "none"}
        file={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={submitRename}
      />

      {/*
        Подсказка о перетаскивании: делает drop обнаружимым, не занимая места.
        Показывается только когда список уже есть — в пустом состоянии ту же
        роль играет сама зона.
      */}
      {isCurrent && isAnyFile && canWrite && (
        <p className="px-1 pt-1 text-[11.5px] text-fg-dim">
          Перетащите файлы сюда — вид документа определится по типу файла.
        </p>
      )}
    </div>
  );
}

/**
 * Диалог переименования.
 *
 * Отдельный компонент, а не состояние в списке: у диалога своё поле, своя
 * ошибка и своя отправка, и живут они ровно столько, сколько он открыт.
 * `key` по идентификатору файла даёт чистый старт каждому открытию — приём тот
 * же, что у формы оплаты.
 */
function RenameDialog({
  file,
  onClose,
  onSubmit,
}: {
  file: SpecItemFileEntry | null;
  onClose: () => void;
  /** Возвращает текст ошибки или `null` при успехе. */
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(file?.fileName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Укажите имя файла");
      return;
    }
    if (trimmed === file?.fileName) {
      // Имя не изменилось — не отправляем запрос и закрываем: сервер ответил бы
      // `changed: false`, и пользователь ждал бы ответа зря.
      onClose();
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const message = await onSubmit(trimmed);
      if (message) setError(message);
    } finally {
      setSaving(false);
    }
  }, [file?.fileName, name, onClose, onSubmit]);

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-115">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Переименовать файл
          </DialogTitle>
          <DialogDescription className="text-[13px] text-fg-secondary">
            Имя видно в списке и подставляется при скачивании. Сам файл в
            хранилище не перезаписывается.
          </DialogDescription>
        </DialogHeader>

        <Input
          aria-label="Имя файла"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
          autoFocus
        />

        {error && (
          <p role="alert" className="text-[12.5px] text-fg-red">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onClose}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
