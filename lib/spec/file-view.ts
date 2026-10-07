/**
 * Отображение файла позиции: формат размера, вид файла и подпись автора.
 *
 * Чистые функции без React, БД и Next — ровно то, что можно проверить
 * unit-тестами. Компонент (`FilesTab`) их только вызывает, поэтому правило
 * существует в одном месте: «какая иконка у PDF» и «как показать 1.2 МБ»
 * не размазаны по разметке.
 *
 * Серверная модель здесь НЕ дублируется: тип входа (`SpecItemFileEntry`)
 * импортируется из ядра файлов, второго описания тех же полей нет.
 */

import { fmtDate, humanSize } from "@/lib/utils";
import type { SpecItemFileCategory } from "@/lib/spec/file-content";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/* ------------------------------------------------------------------ */
/*  Размер                                                             */
/* ------------------------------------------------------------------ */

/**
 * Человекочитаемый размер файла.
 *
 * Тонкая обёртка над общим `humanSize` (`lib/utils.ts`), а не второй
 * форматтер: разделение B / KB / MB и округление живут там, здесь — только
 * имя для домена файлов. Так у проекта остаётся ОДНО правило форматирования
 * размера.
 */
export function formatFileSize(bytes: number): string {
  return humanSize(bytes);
}

/* ------------------------------------------------------------------ */
/*  Вид файла                                                          */
/* ------------------------------------------------------------------ */

/** Вид файла: определяет иконку в списке. */
export type SpecItemFileKind = "pdf" | "image" | "archive" | "cad" | "file";

/** MIME вида «картинка». */
const IMAGE_MIME_PATTERN = /^image\//;

/** Архивы и контейнеры: показываются одной иконкой «архив». */
const ARCHIVE_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/gzip",
  "application/x-tar",
]);

/**
 * CAD и 3D. Проверяются ДО картинок: `image/vnd.dwg` формально `image/*`,
 * но по смыслу это чертёж, и иконка картинки для него неверна.
 */
const CAD_MIME_TYPES = new Set([
  "image/vnd.dwg",
  "image/vnd.dxf",
  "model/gltf+json",
  "model/gltf-binary",
  "model/obj",
  "application/acad",
  "application/dxf",
  "application/sla",
]);

/** То же по расширению: MIME приходит от клиента и может быть обобщённым. */
const KIND_BY_EXTENSION: Readonly<Record<string, SpecItemFileKind>> = {
  pdf: "pdf",
  // изображения
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
  avif: "image",
  tif: "image",
  tiff: "image",
  bmp: "image",
  heic: "image",
  // архивы
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  gz: "archive",
  tar: "archive",
  // CAD и 3D
  dwg: "cad",
  dxf: "cad",
  skp: "cad",
  rfa: "cad",
  max: "cad",
  "3ds": "cad",
  obj: "cad",
  fbx: "cad",
  gltf: "cad",
  glb: "cad",
  stl: "cad",
  step: "cad",
  stp: "cad",
  iges: "cad",
  igs: "cad",
};

/** Расширение из имени файла: только буквы и цифры, не длиннее 5. */
export function fileExtension(fileName: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec((fileName ?? "").trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Вид файла по MIME, с запасным определением по расширению.
 *
 * MIME может быть `application/octet-stream` (браузеры часто отдают его для
 * CAD-файлов) или пустым, поэтому расширение — второй источник, а не первый:
 * тип содержимого точнее имени, которое пользователь может переименовать.
 */
export function fileKindOf(file: {
  mimeType: string;
  fileName: string;
}): SpecItemFileKind {
  const mime = (file.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (mime === "application/pdf") return "pdf";
  if (CAD_MIME_TYPES.has(mime)) return "cad";
  if (ARCHIVE_MIME_TYPES.has(mime)) return "archive";
  if (IMAGE_MIME_PATTERN.test(mime)) return "image";

  const extension = fileExtension(file.fileName);
  return KIND_BY_EXTENSION[extension] ?? "file";
}

/* ------------------------------------------------------------------ */
/*  Автор                                                              */
/* ------------------------------------------------------------------ */

/**
 * Подпись автора файла.
 *
 * ── Почему сейчас `null` ──────────────────────────────────────────────────
 *
 * Серверная модель отдаёт только `uploadedBy` — uuid пользователя. Показывать
 * uuid нельзя (это внутренний идентификатор), а имени в ответе нет: в БД у
 * файла хранится только ссылка на `users`, без снимка имени — в отличие от
 * `spec_item_events.actor_name_snapshot` и
 * `spec_item_comments.author_name_snapshot`, где снимок есть.
 *
 * Поэтому функция честно возвращает `null`, и строка просто не показывает
 * автора. Когда в модель добавится снимок имени, менять придётся ровно это
 * место и `fileMetaLine` — они уже готовы принять автора.
 */
export function fileAuthorLabel(_file: SpecItemFileEntry): string | null {
  void _file;
  return null;
}

/* ------------------------------------------------------------------ */
/*  Категория                                                          */
/* ------------------------------------------------------------------ */

/**
 * Подписи категорий — единственный источник и для показа в списке, и для
 * выбора в диалоге загрузки.
 *
 * Порядок массива — порядок вариантов в диалоге: сначала документ (значение по
 * умолчанию), затем текстура, затем «другое».
 */
export const FILE_CATEGORY_OPTIONS: readonly {
  value: SpecItemFileCategory;
  label: string;
}[] = [
  { value: "document", label: "Документ" },
  { value: "texture", label: "Текстура" },
  { value: "other", label: "Другое" },
];

/**
 * Подпись категории файла.
 *
 * Берётся именно сохранённое `category`, а не выводится заново из MIME: тип
 * содержимого и то, чем файл считает пользователь, — разные вещи, и повторное
 * определение переписало бы его выбор.
 *
 * Запасное «Другое» — от значения, которого нет в списке (так выглядела бы
 * строка, записанная в БД в обход кода). Категорию это не подменяет — просто не
 * даёт показать пустой бейдж.
 */
export function fileCategoryLabel(category: SpecItemFileCategory): string {
  return (
    FILE_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ??
    "Другое"
  );
}

/* ------------------------------------------------------------------ */
/*  Строка списка                                                      */
/* ------------------------------------------------------------------ */

/**
 * Дата загрузки тем же форматтером, что и остальные даты проекта
 * (`fmtDate` → «6 октября 2026»). Своего форматтера не заводим: мусорная дата
 * из API даёт пустую строку, а не «Invalid Date».
 */
export function formatFileDate(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return fmtDate(createdAt);
}

/** Подпись строки: «1.2 MB · Андрей · 6 октября 2026» (автор — если известен). */
export function fileMetaLine(args: {
  sizeBytes: number;
  createdAt: string;
  author?: string | null;
}): string {
  const parts = [formatFileSize(args.sizeBytes)];
  if (args.author) parts.push(args.author);
  const date = formatFileDate(args.createdAt);
  if (date) parts.push(date);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/*  Порядок и вставка записи                                           */
/* ------------------------------------------------------------------ */

/**
 * Сравнение по серверному порядку: `created_at DESC, id DESC`.
 *
 * Порядок задаёт сервер (и индекс `spec_item_files_spec_item_id_active_idx`),
 * поэтому правила сортировки в одном месте: и список после загрузки, и вставка
 * новой записи пользуются этой функцией, а не «сортируют как получится».
 * `id` — вторичный ключ, он делает порядок детерминированным при одинаковом
 * времени создания (например, при пакетной записи).
 */
export function compareFileEntries(
  a: Pick<SpecItemFileEntry, "createdAt" | "id">,
  b: Pick<SpecItemFileEntry, "createdAt" | "id">,
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * Вставить запись в список так, чтобы порядок остался серверным.
 *
 * Новая запись идёт на СВОЁ место по `created_at`, а не в конец и не в начало:
 * иначе список после загрузки расходился бы с тем, что вернёт следующий
 * `listSpecItemFiles`. Полная пересортировка выполняется по той же причине —
 * список остаётся ровно тем, что предписывает серверный порядок.
 *
 * Дубликат по `id` заменяется: повторная вставка той же записи не должна
 * создавать вторую строку.
 */
export function placeFileEntry(
  entries: readonly SpecItemFileEntry[],
  entry: SpecItemFileEntry,
): SpecItemFileEntry[] {
  const withoutDuplicate = entries.filter((existing) => existing.id !== entry.id);
  return [...withoutDuplicate, entry].sort(compareFileEntries);
}
