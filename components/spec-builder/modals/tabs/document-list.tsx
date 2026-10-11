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
  fileCategoryLabel,
  fileGroupDotClass,
  fileGroupOf,
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
 * ── Два варианта одного списка ─────────────────────────────────────────────
 *
 * `variant="list"` — вкладка «Файлы»: группы, фильтры, строки с действиями.
 * `variant="chips"` — документы ОДНОЙ оплаты: компактные чипсы видов.
 *
 * Второй компонент для чипсов не заводится намеренно: у оплаты и у вкладки
 * «Файлы» один список документов, одна выборка и одна отправка на сервер, поэтому
 * копия разошлась бы с оригиналом в первой же правке — у одной появился бы
 * фильтр, у другой нет. Вариант меняет ПОКАЗ и один шаг загрузки, а не правила
 * работы с документом: что считается файлом, какие у него права и как он
 * записывается, решается здесь одинаково.
 *
 * ── Почему чипс инертен ────────────────────────────────────────────────────
 *
 * Чипс показывает вид документа и ничего не делает: ни открытия, ни скачивания,
 * ни переименования, ни смены вида, ни удаления. Управление документом живёт в
 * одном месте — во вкладке «Файлы», соседней вкладке той же модалки. Это
 * осознанная отмена меню `⋯` у чипса: hover не существует на тач-устройствах, а
 * ряд кнопок в строке нажимается случайно.
 *
 * Имя файла в чипсе не показано — у двух чеков на разные суммы виды совпадают, и
 * чипсы иначе неразличимы. Имя уходит в `title` и в доступное имя, как у
 * обрезанных имён в списке; что для этого понадобилось и почему — в `FileChip`.
 *
 * ── Почему строка всё равно принимает файлы ────────────────────────────────
 *
 * Перетаскивание на строку и плейсхолдер-чипс сохранены: иначе документ оплаты
 * нельзя было бы создать перетаскиванием ниоткуда — вкладка «Файлы» пишет
 * `payment_id = ""`. Приглашение стоит и когда документов нет, и когда они есть:
 * у того, кто вправе прикреплять, пустой строки не бывает — там всегда видно, что
 * сюда можно что-то приложить.
 *
 * ── Почему вид спрашивают после приёма файла ───────────────────────────────
 *
 * Роль документа к оплате несёт вид (`invoice` — основание, `receipt` —
 * подтверждение, ADR 0005), а формат роль не различает: PDF счёта и PDF чека
 * для догадки одинаковы. Поэтому у оплаты вид называет человек. Спросить заранее
 * нельзя — перетаскивание не даёт такого шага, — поэтому шаг «Счёт / Чек»
 * открывается сразу после приёма файла, ДО отправки: выбранный вид уходит на
 * сервер явным `category` и серверную догадку перебивает.
 *
 * ── Группы, фильтры и сворачивание (вариант `list`) ────────────────────────
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
 * На общем пути вид документа спрашивать не нужно: он угадывается сервером по
 * формату файла (`guessSpecItemFileCategory`), а потом правится прямо в строке.
 * Поэтому drop-зона и кнопка принимают файлы СРАЗУ, несколькими, и каждый встаёт
 * строкой со статусом «Загружается». Исключение — документ к оплате: там вид
 * спрашивает шаг выбора (см. выше). Прогресса в процентах нет намеренно: server
 * action его не отдаёт, а рисовать выдуманные проценты — обман.
 *
 * ── Просмотр, скачивание и правка ──────────────────────────────────────────
 *
 * Ссылка запрашивается ТОЛЬКО по клику и только на один файл: заранее
 * подписывать список нельзя. Исключение — миниатюры изображений: без ссылки
 * превью не нарисовать, поэтому картинки списка подписывает ВКЛАДКА — одним
 * вызовом на весь экран (`use-signed-thumbnails`), — а сюда ссылки приходят
 * пропом; ошибка подписи или декодирования не мешает строке — остаётся иконка.
 * В компактном варианте миниатюр нет вовсе: чипс рисуется одним текстом.
 *
 * Правка (вид документа, имя) уходит отдельным действием и в ответе приносит
 * запись сервера: строка обновляется ею, а не локальной догадкой.
 */

/** Сколько строк-заготовок показывать при загрузке. */
const SKELETON_ROWS = 4;

/** С какого числа файлов группы показываются свёрнутыми. */
const COLLAPSE_FROM = 8;

/**
 * Сколько чипсов помещается в строку оплаты до переполнения.
 *
 * Три — предел, за которым чипсы начинают переноситься второй строкой и строка
 * оплаты перестаёт читаться. Остальное прячется за счётчиком «+N»: потери нет,
 * потому что всё, что за счётчиком, всё равно смотрят во вкладке «Файлы».
 */
const MAX_CHIPS = 3;

/**
 * Виды, из которых состоит РОЛЬ документа к оплате (ADR 0005).
 *
 * `invoice` — основание (почему платим столько), `receipt` — подтверждение (что
 * деньги ушли). Остальные виды роль не несут, поэтому шаг выбора их не
 * предлагает: «Документ» в контексте оплаты означает «роль не названа», а не
 * третью роль.
 *
 * Здесь только ЗНАЧЕНИЯ: подписи берутся из `FILE_CATEGORY_OPTIONS`
 * (`fileCategoryLabel`) — второго списка названий видов в проекте быть не должно,
 * иначе «Чек» на шаге и «Чек» в строке списка разошлись бы при первой же правке.
 */
const PAYMENT_ROLE_CATEGORIES: readonly SpecItemFileCategory[] = [
  "invoice",
  "receipt",
];

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
  /** Сам файл: нужен, чтобы отправить его после выбора вида. */
  file: File;
  name: string;
  sizeBytes: number;
};

/**
 * Вариант показа списка.
 *
 * `list` — вкладка «Файлы»: группы, фильтры и строки документа. `chips` —
 * документы одной оплаты: компактные чипсы видов, приглашение и шаг выбора вида.
 */
export type DocumentListVariant = "list" | "chips";

export type DocumentListProps = {
  orgSlug: string;
  specItemId: string;
  files: SpecItemFileEntry[];
  loading: boolean;
  thumbs: Record<string, string>;
  onThumbFailed: (fileId: string) => void;
  /**
   * Строка графика, документы которой показываем И к которой прикрепляем.
   *
   * Именно она, а не документы со ссылкой на неё, приходит списку: `paymentId`
   * или `paymentPlanId` — смотря какую точку входа открыли. Файлы отбираются по
   * этой ссылке, а загрузка уходит на сервер тем же полем.
   */
  paymentId?: string | null;
  /** Строка графика, к которой прикрепляется документ (счёт — основание). */
  paymentPlanId?: string | null;
  /** Какую ссылку файла считать «своей» в этом списке. */
  link?: "payment" | "plan";
  canWrite: boolean;
  onUploaded: (entry: SpecItemFileEntry) => void;
  onChanged: (entry: SpecItemFileEntry) => void;
  onDeleted: (fileId: string) => void;
  mutate: FileList["mutate"];
  /**
   * Вариант показа. По умолчанию `list` — вкладка «Файлы», где список и
   * появился первым; компактный вариант запрашивается явно.
   */
  variant?: DocumentListVariant;
  title?: string | null;
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

/**
 * Чипс документа к оплате: вид документа, и только он.
 *
 * Не кнопка и не ссылка: у чипса нет ни действия, ни меню, поэтому это `span` без
 * действия — так его нельзя ни нажать, ни сфокусировать «на удачу». Имя файла
 * видно в подсказке и в доступном имени: два чека на разные суммы различаются
 * именно именем, а не видом.
 *
 * `role="img"` здесь — условие того, что имя вообще доедет до диктора, а не
 * украшение. Элемент без роли имеет роль `generic`, а на ней `aria-label`
 * запрещён: ярлык на таком элементе противоречит ARIA, и `span` с одним лишь
 * «Чек» внутри читался бы как «Чек» — без файла, ради которого имя и уходит из
 * подписи. `img` — роль из перечня, где `aria-label` разрешён, и означает она
 * «один объект, имя которого задано снаружи»: чипс и есть один объект (файл), а
 * его содержимое — точка группы и подпись — оформление этого имени, поэтому
 * `img` описывает чипс точнее, чем `generic`. Роль не выдумана ради подсказки:
 * это `img` из ARIA, и по имени этой роли чипс ищут тесты
 * (`document-chips-test-helper.ts`).
 */
function FileChip({ file }: { file: SpecItemFileEntry }) {
  const label = fileCategoryLabel(file.category);
  const title = `${label}: ${file.fileName}`;

  return (
    <span
      role="img"
      title={title}
      aria-label={title}
      className="inline-flex max-w-40 items-center gap-1.5 rounded-full border border-border-muted bg-bg-card2 px-2 py-0.5 text-[11.5px] text-fg-secondary"
    >
      <GroupDot group={fileGroupOf(file.category)} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * Счётчик переполнения: «+N» вместо остальных чипсов.
 *
 * Инертный, как и чипс: попап требовал бы клика, которого у чипсов больше нет.
 * Потери нет — всё, что за счётчиком, смотрят во вкладке «Файлы», где документ
 * виден целиком. Подсказка называет число и первый скрытый файл: «+2» само по
 * себе не говорит, что именно спрятано.
 */
function OverflowChip({ count, firstHidden }: { count: number; firstHidden: string }) {
  const title = `Ещё документов: ${count}. Первый — «${firstHidden}». Все документы — во вкладке «Файлы»`;

  return (
    <span
      role="img"
      title={title}
      aria-label={title}
      className="inline-flex items-center rounded-full border border-dashed border-border-muted px-2 py-0.5 text-[11.5px] text-fg-muted"
    >
      +{count}
    </span>
  );
}

/**
 * Шаг «Счёт / Чек» после приёма файла.
 *
 * Появляется сразу после перетаскивания или выбора файла и НЕ отправляет его на
 * сервер, пока вид не назван: роль документа к оплате несёт вид (ADR 0005), а
 * формат роль не различает — PDF счёта и PDF чека для догадки одинаковы.
 *
 * `fieldset` с `legend`: шаг — это вопрос, а его варианты — ответ на него. Так
 * диктор читает не «Счёт, кнопка, Чек, кнопка», а «Какой это документ? Счёт…».
 *
 * Спиннера и выключенных кнопок здесь нет намеренно: пока идёт отправка, шаг с
 * экрана снят (см. `chooseCategory`), поэтому «выключенное» состояние было бы
 * состоянием, которого никто не увидит.
 */
function CategoryStep({
  name,
  position,
  total,
  onChoose,
  onSkip,
}: {
  name: string;
  /** Номер файла в пачке — с единицы: «Файл 2 из 3». */
  position: number;
  total: number;
  onChoose: (category: SpecItemFileCategory) => void;
  onSkip: () => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-dashed border-border-muted px-2.5 py-1.5">
      <legend className="px-1 text-[11px] text-fg-dim">
        Какой это документ?
      </legend>

      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg">
        <Paperclip className="size-3.5 shrink-0 text-fg-dim" aria-hidden="true" />
        <span className="max-w-52 truncate" title={name}>
          {name}
        </span>
      </span>

      {total > 1 && (
        <span className="text-[11.5px] text-fg-dim tabular-nums">
          Файл {position} из {total}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        {PAYMENT_ROLE_CATEGORIES.map((category) => (
          <Button
            key={category}
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11.5px]"
            onClick={() => onChoose(category)}
          >
            {fileCategoryLabel(category)}
          </Button>
        ))}
        {/*
          Выход рядом с шагом: файл, перетащенный по ошибке, иначе некуда деть —
          строки «Загружается» у него ещё нет, а очередь держит его до ответа.
        */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11.5px] text-fg-muted"
          onClick={onSkip}
        >
          Не прикреплять
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * Приглашение прикрепить документ.
 *
 * Стоит в строке оплаты всегда, когда список читается и человек вправе
 * прикреплять: и когда документов нет, и когда они есть. Пустого места в строке
 * не бывает — иначе в строке без документов не было бы видно, что к оплате вообще
 * можно что-то приложить.
 *
 * Пока идёт отправка, кнопка показывает спиннер и число ожидающих файлов: шаг
 * выбора вида в этот момент снят, и без этого на экране не осталось бы ни одного
 * признака, что работа идёт.
 */
function AttachPlaceholder({
  waiting,
  busy,
  disabled,
  onPick,
}: {
  /** Сколько файлов ещё ждут своего вида — без того, что уже отправляется. */
  waiting: number;
  busy: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const title =
    waiting > 0
      ? `Принять документы — осталось: ${waiting}`
      : "Прикрепить счёт или чек — файл можно и перетащить";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title={title}
      aria-label={title}
      className="h-6 gap-1 rounded-full border-dashed px-2 text-[11.5px] text-fg-secondary"
      disabled={disabled}
      onClick={onPick}
    >
      {busy ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <Plus className="size-3" />
      )}
      {waiting > 0 ? `Принять документы · ${waiting}` : "Добавить документ"}
    </Button>
  );
}

export default function DocumentList({
  orgSlug,
  specItemId,
  files,
  loading,
  thumbs,
  onThumbFailed,
  paymentId = null,
  paymentPlanId = null,
  link = "payment",
  canWrite,
  onUploaded,
  onChanged,
  onDeleted,
  mutate,
  variant = "list",
  title = null,
  emptyHint = "Перетащите файл сюда или добавьте его кнопкой — счета, спецификации поставщика и другие вложения к этому материалу.",
}: DocumentListProps) {
  const isChips = variant === "chips";

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
  /**
   * Очередь выбора вида (вариант `chips`): файлы уже приняты, но ещё НЕ
   * отправлены — вид называется до отправки, чтобы на сервер не попала догадка.
   */
  const [categoryQueue, setCategoryQueue] = useState<PendingUpload[]>([]);
  /**
   * Ход пачки в очереди выбора вида (вариант `chips`).
   *
   * `batch` — сколько файлов пришло последней пачкой, `answered` — сколько из них
   * уже отправлено или пропущено. Отсюда берётся «Файл N из M» на шаге.
   *
   * Это состояние, а не счётчик по длине очереди, по одной причине: неудачная
   * попытка возвращает файл в очередь, и нумерация по её длине назвала бы
   * следующий вопрос «Файлом 1 из 2», хотя это тот же второй файл из трёх.
   */
  const [categoryProgress, setCategoryProgress] = useState({
    batch: 1,
    answered: 0,
  });

  /** Идёт отправка файла из очереди выбора вида. */
  const [assigning, setAssigning] = useState(false);
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
  /*  Загрузка                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Отправка одного файла на сервер — ОДНА точка для обоих вариантов.
   *
   * Отличается только `category`: на общем пути он не отправляется вовсе и вид
   * угадывает сервер по подтверждённому формату, а у документа к оплате его
   * называет человек, и он уходит этим полем (ADR 0005). Всё остальное — оплата,
   * организация, позиция, разбор ответа и отказ — одинаково, поэтому второй копии
   * здесь нет.
   *
   * Отказ возвращается значением, а не исключением: вызывающему нужно решить, что
   * показать и куда вернуть файл, — на общем пути строка очереди просто исчезает,
   * а в очереди выбора вида файл обязан вернуться, иначе пропал бы из интерфейса
   * навсегда.
   */
  const uploadItem = useCallback(
    async (
      item: PendingUpload,
      category?: SpecItemFileCategory,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const forItem = specItemId;

      const formData = new FormData();
      formData.set("file", item.file);
      /*
        Ссылка уходит ТОЙ ЖЕ, какой список показывает: у строки оплаты это
        `payment_id`, у строки графика — `payment_plan_id`. Оба поля формы
        необязательны и означают независимые связи: счёт, приложенный до оплаты,
        после неё остаётся привязан к плану (ADR 0006).

        У общего пути загрузки (вкладка «Файлы») ссылки нет ни одной, и оба поля
        уходят пустыми — файл остаётся обычным документом позиции.
      */
      formData.set("payment_id", link === "payment" ? (paymentId ?? "") : "");
      formData.set(
        "payment_plan_id",
        link === "plan" ? (paymentPlanId ?? "") : "",
      );
      if (category) formData.set("category", category);

      try {
        const res = await uploadSpecItemFile(orgSlug, forItem, formData);

        // Позиция сменилась — ответ относится к прошлой: в текущий список он не
        // попадает, а файл уже загружен, поэтому и «ошибкой» это не является.
        if (specItemIdRef.current !== forItem) return { ok: true };

        if (!res.success) return { ok: false, error: res.error };

        // Успех снимает прошлый отказ: иначе красный текст висел бы над списком
        // после того, как следующий файл загрузился.
        setUploadError(null);
        onUploaded(res.data);
        return { ok: true };
      } catch (cause) {
        console.error("[DocumentList] загрузка", cause);
        if (specItemIdRef.current !== forItem) return { ok: true };
        return { ok: false, error: "Не удалось загрузить файл" };
      }
    },
    [link, onUploaded, orgSlug, paymentId, paymentPlanId, specItemId],
  );

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

      /**
       * Пока шаг выбора вида не отвечен, новые файлы не принимаются.
       *
       * Очередь вопросов одна: второй файл встал бы за первым, а вопрос шага
       * относится к одному — и человек гадал бы, к какому из двух. Точки входа
       * поэтому выключены (`dropEnabled`, `AttachPlaceholder`), а это — защита от
       * того же через picker.
       */
      if (isChips && categoryQueue.length > 0) return;

      setPickError(null);
      setUploadError(null);

      const queue: PendingUpload[] = picked.map((file, index) => ({
        key: `${Date.now()}-${index}-${file.name}`,
        file,
        name: file.name,
        sizeBytes: file.size,
      }));

      /**
       * Компактный вариант: сперва вид, потом отправка.
       *
       * Файл остаётся в очереди выбора и на сервер не уходит, пока человек не
       * назвал роль. Отправить его сразу с догадкой значило бы записать
       * «Документ» вместо основания, а потом переписать — то есть на секунду
       * потерять роль, которую вид и несёт (ADR 0005).
       */
      if (isChips) {
        // Нумерация внутри шага — по ЭТОЙ пачке: предыдущая закончилась, и её
        // счётчик не должен попадать в «Файл N из M» новой.
        setCategoryProgress({ batch: queue.length, answered: 0 });
        setCategoryQueue((current) => [...current, ...queue]);
        return;
      }
      setPending((current) => [...current, ...queue]);

      void (async () => {
        for (const item of queue) {
          // Вид не отправляется: на общем пути его угадывает сервер по
          // подтверждённому формату, а названный человеком вид правится в строке
          // списка.
          const result = await uploadItem(item);
          if (!result.ok) setUploadError(result.error);
          if (specItemIdRef.current !== specItemId) return;
          setPending((current) => current.filter((row) => row.key !== item.key));
        }
      })();
    },
    [canWrite, categoryQueue.length, isChips, specItemId, uploadItem],
  );

  /**
   * Ответ на шаг выбора вида: файл уходит на сервер, очередь идёт дальше.
   *
   * Пока идёт отправка, шаг снят с экрана, а кнопка приглашения заменена
   * спиннером: два быстрых нажатия не отправят один файл дважды, а на месте шага
   * видно, что работа идёт. Файл при этом вынимается из очереди ДО `await`, иначе
   * шаг успел бы спросить о нём второй раз.
   */
  const chooseCategory = useCallback(
    (category: SpecItemFileCategory) => {
      const item = categoryQueue[0];
      if (!item || assigning) return;

      setCategoryQueue((current) => current.filter((row) => row.key !== item.key));
      // Файл отправлен — он больше не считается при нумерации, даже если сейчас
      // вернётся в очередь после отказа.
      setCategoryProgress((current) => ({
        ...current,
        answered: current.answered + 1,
      }));
      setPickError(null);
      setAssigning(true);
      void uploadItem(item, category)
        .then((result) => {
          if (specItemIdRef.current !== specItemId) return;
          if (result.ok) return;

          // Неудачная попытка возвращает файл в очередь: иначе он исчез бы из
          // интерфейса навсегда — ни чипса, ни шага, ни следа в списке.
          setUploadError(result.error);
          setCategoryQueue((current) => [...current, item]);
        })
        .finally(() => setAssigning(false));
    },
    [assigning, categoryQueue, specItemId, uploadItem],
  );

  /** Отказ от прикрепления: файл не уходит на сервер и очередь идёт дальше. */
  const skipCategory = useCallback(() => {
    setCategoryQueue((current) => current.slice(1));
    // Пропущенный файл тоже посчитан: он больше не вернётся, а следующий вопрос
    // обязан сохранить свой номер в пачке.
    setCategoryProgress((current) => ({
      ...current,
      answered: current.answered + 1,
    }));
    setPickError(null);
  }, []);

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
   *
   * Пока идёт отправка файла из очереди выбора вида, приём закрыт: новый файл
   * встал бы в очередь за текущим, и человек спрашивал бы себя, к какому из двух
   * относится вопрос шага.
   */
  const dropEnabled =
    isCurrent && canWrite && renaming === null && !deleting && !assigning;

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

  const dragOverlay = (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-fg-brand bg-bg-card/90 backdrop-blur-sm *:pointer-events-none">
      <Upload className="size-6 text-fg-brand motion-safe:animate-bounce" />
      <p className="text-[13px] font-medium text-fg">
        Отпустите, чтобы добавить файлы
      </p>
      <p className="text-[12px] text-fg-muted">
        {isChips
          ? `документ прикрепится к этой оплате · до ${MAX_SPEC_ITEM_FILE_LABEL}`
          : `вид документа определится по типу файла · до ${MAX_SPEC_ITEM_FILE_LABEL}`}
      </p>
    </div>
  );

  /**
   * Компактный вариант: чипсы видов вместо строк документа.
   *
   * Здесь нет ни групп, ни фильтров, ни свёртывания: у одной оплаты документов
   * единицы, а не десятки, и весь список виден целиком. Скрытый input, drop-зона
   * и обработчики — те же, что у полного варианта: способ прикрепления один.
   */
  if (isChips) {
    const visible = files.slice(0, MAX_CHIPS);
    const hidden = files.slice(MAX_CHIPS);
    /** Файл, про вид которого спрашивает шаг. Он же — голова очереди. */
    const asked = categoryQueue[0] ?? null;

    return (
      <div
        className="relative flex flex-wrap items-center gap-1.5 rounded-xl transition-colors"
        data-drag-active={dragActive ? "true" : "false"}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={pickerRef}
          type="file"
          multiple
          className="hidden"
          onChange={handlePick}
          aria-label="Выбрать файлы для загрузки"
        />

        {loading &&
          Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} className="h-6 w-20 rounded-full" />
          ))}

        {visible.map((file) => (
          <FileChip key={file.id} file={file} />
        ))}

        {/*
          Счётчик считается по ПРИКРЕПЛЁННЫМ документам: файлы, которых ещё нет в
          списке, ничего не прячут, и «+N» про них ничего не говорит.
        */}
        {hidden.length > 0 && (
          <OverflowChip
            count={hidden.length}
            firstHidden={hidden[0].fileName}
          />
        )}

        {/*
          Вид спрашивается у ПЕРВОГО файла пачки; остальные ждут своей очереди.
          Пока идёт отправка, шаг снят: его место занимает спиннер приглашения —
          иначе шаг спрашивал бы про файл, который уже уходит.
        */}
        {isCurrent && asked && !assigning && (
          <CategoryStep
            /*
              Номер и всего считаются по пачке, а не по остатку очереди: шаг
              обещает, сколько раз ещё спросят, и это число не должно меняться от
              того, что предыдущий файл уже отправлен.
            */
            name={asked.name}
            position={categoryProgress.answered + 1}
            total={categoryProgress.batch}
            onChoose={chooseCategory}
            onSkip={skipCategory}
          />
        )}

        {/*
          Приглашение — всегда, пока список читается и человек вправе прикреплять.
          Пустого места в строке не бывает: строка без документов без него не
          сообщала бы, что сюда можно что-то приложить, а строка с документами —
          что можно приложить второй. Наблюдателю его нет: прикреплять он не
          вправе.
        */}
        {isCurrent && canWrite && (
          <AttachPlaceholder
            waiting={categoryQueue.length}
            busy={assigning}
            /*
              Пока шаг не отвечен, приглашение выключено: очередь вопросов одна, и
              второй файл ждал бы за первым, не давая понять, к какому из двух
              относится вопрос.
            */
            disabled={assigning || asked !== null || dragActive}
            onPick={() => pickerRef.current?.click()}
          />
        )}

        {dragActive && dragOverlay}

        {pickError && (
          <p role="alert" className="basis-full px-1 text-[12px] text-fg-red">
            {pickError}
          </p>
        )}
        {uploadError && !assigning && (
          <p role="alert" className="basis-full px-1 text-[12px] text-fg-red">
            {uploadError}
          </p>
        )}
      </div>
    );
  }

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
      {dragActive && dragOverlay}

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
                    onThumbFailed={onThumbFailed}
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
