"use client";

import {
  Archive,
  ChevronDown,
  Download,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Loader2,
  MoreVertical,
  Pencil,
  Ruler,
  Tag,
  Trash2,
} from "lucide-react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  FILE_CATEGORY_OPTIONS,
  FILE_GROUP_OPTIONS,
  fileAuthorLabel,
  fileCategoryLabel,
  fileGroupDotClass,
  fileGroupOf,
  fileKindOf,
  fileMetaParts,
  filePaymentLinkLabel,
} from "@/lib/spec/file-view";
import type { SpecItemFileCategory, SpecItemFileKind } from "@/lib/spec/file-content";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Строка документа: превью, имя, вид, метаданные и действия.
 *
 * ── Почему отдельный компонент ─────────────────────────────────────────────
 *
 * Строка — самая крупная часть списка документов и единственная, которая знает
 * о конкретном файле. Контейнер (`DocumentList`) отвечает за группы, фильтры,
 * загрузку и диалоги, а строка — за показ одного документа и за три действия
 * над ним. Разделение нужно не «для красоты»: правка вида или метаданных
 * касается только строки, и искать её в файле на полторы тысячи строк — это
 * ошибка, которую делают один раз и потом боятся трогать список.
 *
 * ── Что строка НЕ делает ───────────────────────────────────────────────────
 *
 * Она не ходит на сервер и ничего не решает о правах: все действия приходят
 * пропсами и уже проверены контейнером (`canWrite`), а запросы делает он же.
 * Строка только показывает состояние («открывается», «скачивается»,
 * «сохраняется») и текст отказа — то, что относится именно к ней.
 */

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

/** Точка цвета группы: тем же цветом помечен чип вида документа. */
function GroupDot({ group }: { group: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        fileGroupDotClass(group),
      )}
    />
  );
}

export type DocumentRowProps = {
  file: SpecItemFileEntry;
  /** Право на правку: наблюдателю действия не показываются. */
  canWrite: boolean;
  /** Подписанная ссылка на превью; `null` — показывается иконка вида. */
  thumb: string | null;
  /** Ссылка на превью не декодировалась: контейнер убирает её из кэша. */
  onThumbFailed: (fileId: string) => void;
  /** Строка открывает файл в новой вкладке. */
  onOpen: (file: SpecItemFileEntry) => void;
  /** Строка скачивает файл вложением. */
  onDownload: (file: SpecItemFileEntry) => void;
  /** Пользователь просит переименовать файл. */
  onRename: (file: SpecItemFileEntry) => void;
  /** Пользователь просит удалить файл (откроется подтверждение). */
  onDelete: (file: SpecItemFileEntry) => void;
  /** Пользователь меняет вид документа на выбранный. */
  onCategory: (file: SpecItemFileEntry, category: SpecItemFileCategory) => void;
  /** Сейчас получаем ссылку для просмотра. */
  opening: boolean;
  /** Сейчас получаем ссылку для скачивания. */
  downloading: boolean;
  /** Сейчас сохраняется вид документа. */
  savingCategory: boolean;
  /** Открыт ли селект вида именно у этой строки. */
  categoryOpen: boolean;
  onCategoryOpenChange: (open: boolean) => void;
  /** Текст отказа по этой строке; `null` — отказа нет. */
  error: string | null;
};

export default function DocumentRow({
  file,
  canWrite,
  thumb,
  onThumbFailed,
  onOpen,
  onDownload,
  onRename,
  onDelete,
  onCategory,
  opening,
  downloading,
  savingCategory,
  categoryOpen,
  onCategoryOpenChange,
  error,
}: DocumentRowProps) {
  const Icon = KIND_ICON[fileKindOf(file)];
  const paymentLabel = filePaymentLinkLabel(file);
  const meta = fileMetaParts({
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    author: fileAuthorLabel(file),
  });

  return (
    <Attachment
      state={error ? "error" : "done"}
      size="sm"
      className="w-full min-w-0"
    >
      {/*
        Вся строка — одна цель клика. `AttachmentTrigger` — это абсолютный
        `button` под контентом (`z-10`), поэтому клик работает по всей строке, а
        вложенных интерактивных элементов внутри `Attachment` не появляется:
        `button` в `button` недопустим. Открытие остаётся JS-обработчиком —
        ссылка получается только в момент клика.
      */}
      <AttachmentTrigger
        aria-label={`Открыть «${file.fileName}» в новой вкладке`}
        onClick={() => onOpen(file)}
        disabled={opening || downloading}
      />

      <AttachmentMedia
        variant={thumb ? "image" : "icon"}
        className="border border-border-muted bg-bg-card2"
      >
        {thumb ? (
          // `alt` пустой: имя файла стоит рядом текстом, и повторять его диктору
          // незачем. `onError` обязателен: `image/tiff` разрешён к загрузке и
          // опознаётся как картинка, но браузеры его не рисуют. Без обработчика
          // строка показала бы битую картинку вместо обещанной иконки вида.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            onError={() => onThumbFailed(file.id)}
          />
        ) : (
          <Icon aria-hidden="true" />
        )}
      </AttachmentMedia>

      <AttachmentContent>
        {/*
          Имя — вложенным `span`, а не классом на `AttachmentTitle`: у базового
          заголовка стоит `truncate` (`nowrap` + многоточие), и `line-clamp-2` из
          класса вызова проиграл бы ему по порядку в собранном CSS (см.
          AGENTS.md). Вложенный элемент несёт своё правило целиком, не споря с
          базовым.
        */}
        <AttachmentTitle className="text-fg">
          {/*
            `title` — не украшение: имя обрезано двумя строками, и без подсказки
            длинное название («Техническое задание — Развитие территории
            Угличского района.pdf») прочитать полностью нечем.
          */}
          <span className="line-clamp-2 break-words" title={file.fileName}>
            {file.fileName}
          </span>
        </AttachmentTitle>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-fg-dim">
          {/*
            Чип вида документа: показывает СОХРАНЁННОЕ значение (`file.category`),
            а не выводит его заново из MIME — выбор пользователя это данные, а не
            догадка. Клик открывает селект: правка живёт в строке, а не в
            отдельном экране.
          */}
          {canWrite ? (
            <Popover open={categoryOpen} onOpenChange={onCategoryOpenChange}>
              <PopoverTrigger
                aria-label={`Вид документа «${file.fileName}»`}
                className="inline-flex h-5 items-center gap-1 rounded-full border border-border-muted bg-bg-card2 px-1.5 text-[10.5px] font-medium text-fg-secondary hover:bg-bg-card"
                disabled={savingCategory}
              >
                <GroupDot group={fileGroupOf(file.category)} />
                {fileCategoryLabel(file.category)}
                <ChevronDown aria-hidden="true" className="size-3" />
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-56 gap-1 border border-border-muted bg-bg-card p-1.5"
              >
                {FILE_GROUP_OPTIONS.map((group) => (
                  <div key={group.value} className="flex flex-col">
                    <span className="flex items-center gap-1.5 px-1.5 py-1 text-[10.5px] tracking-wide text-fg-dim uppercase">
                      <GroupDot group={group.value} />
                      {group.label}
                    </span>
                    {FILE_CATEGORY_OPTIONS.filter(
                      (option) => fileGroupOf(option.value) === group.value,
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={file.category === option.value}
                        onClick={() => onCategory(file, option.value)}
                        className={cn(
                          "flex h-7 items-center rounded-md px-1.5 text-left text-[12.5px] hover:bg-bg-card2",
                          file.category === option.value
                            ? "text-fg font-medium"
                            : "text-fg-secondary",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          ) : (
            <span className="inline-flex h-5 items-center gap-1 rounded-full border border-border-muted bg-bg-card2 px-1.5 text-[10.5px] font-medium text-fg-secondary">
              <GroupDot group={fileGroupOf(file.category)} />
              {fileCategoryLabel(file.category)}
            </span>
          )}

          {savingCategory && (
            <Loader2
              className="size-3 animate-spin text-fg-muted"
              aria-label="Сохранение"
            />
          )}

          {meta.map((part) => (
            <span key={part} className="font-mono">
              {part}
            </span>
          ))}

          {/*
            Связь с оплатой — подписью рядом с метаданными, а не отдельным
            бейджем: бейдж занят видом документа. Для документа к ОТМЕНЁННОЙ
            оплате подпись красная: это не справка, а состояние, которое важно
            заметить — такой файл виден только здесь.
          */}
          {paymentLabel && (
            <span
              className={file.payment?.cancelled ? "text-fg-red" : "text-fg-muted"}
            >
              {paymentLabel}
            </span>
          )}
        </div>

        {error && (
          // Текст ошибки остаётся подписью ЭТОЙ строки: `role="alert"` на нём,
          // чтобы скринридер объявил отказ, а список продолжал работать.
          <span role="alert" className="mt-0.5 block text-[11.5px] text-fg-red">
            {error}
          </span>
        )}
      </AttachmentContent>

      <AttachmentActions>
        {/*
          Прямых кнопок в строке две: скачать и меню. Скачивание — частое
          действие и стоит отдельно; всё остальное («Переименовать», «Сменить
          вид», «Удалить») живёт в меню, потому что удаление рядом с открытием
          нажимается случайно, а окно подтверждения — не замена аккуратности.
        */}
        <AttachmentAction
          aria-label={`Скачать «${file.fileName}»`}
          title="Скачать"
          className="text-fg-muted"
          disabled={opening || downloading}
          onClick={() => onDownload(file)}
        >
          {downloading ? <Loader2 className="animate-spin" /> : <Download />}
        </AttachmentAction>

        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <AttachmentAction
                  aria-label={`Действия с «${file.fileName}»`}
                  title="Действия"
                  className="text-fg-muted"
                  disabled={savingCategory}
                />
              }
            >
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-52 border border-border-muted bg-bg-card"
            >
              <DropdownMenuItem
                aria-label={`Переименовать «${file.fileName}»`}
                className="gap-2 text-[12.5px]"
                disabled={savingCategory}
                onClick={() => onRename(file)}
              >
                <Pencil aria-hidden="true" className="size-3.5 text-fg-muted" />
                Переименовать
              </DropdownMenuItem>

              <DropdownMenuItem
                aria-label={`Сменить вид «${file.fileName}»`}
                className="gap-2 text-[12.5px]"
                disabled={savingCategory}
                onClick={() => onCategoryOpenChange(true)}
              >
                <Tag aria-hidden="true" className="size-3.5 text-fg-muted" />
                Сменить вид
              </DropdownMenuItem>

              <DropdownMenuItem
                aria-label={`Удалить «${file.fileName}»`}
                variant="destructive"
                className="gap-2 text-[12.5px]"
                disabled={savingCategory}
                onClick={() => onDelete(file)}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </AttachmentActions>
    </Attachment>
  );
}
