/**
 * Файл позиции спецификации: категории, лимиты, проверка содержимого и путь.
 *
 * ── Зачем отдельный модуль ────────────────────────────────────────────────
 *
 * Здесь лежит всё, что можно проверить БЕЗ базы и без Storage: закрытый список
 * категорий, allow-list MIME, лимит размера, определение формата по сигнатуре,
 * нормализация оригинального имени и построение пути объекта. Ядро
 * (`./spec-item-files`) и server action (`actions/spec-item-files.ts`) — только
 * потребители этих правил, поэтому правило существует ровно в одном месте, а
 * список MIME в миграции bucket'а дублирует его осознанно (второй контур).
 *
 * ── Почему не переиспользован код MaterialImageField ──────────────────────
 *
 * `MaterialImageField` — форма для ОДНОЙ картинки материала: она обрезает
 * изображение и умеет только `image/*`. Файл позиции спецификации — это прежде
 * всего документ (PDF, счёт, КП, спецификация поставщика) и CAD-файл, поэтому
 * контракт другой. Переиспользовано то, что действительно общее и не завязано
 * на картинки: детектор формата по сигнатуре `sniffImageMime`
 * (`lib/material-import/image.ts`) — он уже отклоняет SVG, а SVG это XML со
 * скриптами.
 *
 * ── Главный принцип ───────────────────────────────────────────────────────
 *
 * Не доверяем ни расширению, ни `file.type`, ни имени файла. Расширение берётся
 * из подтверждённого типа, а не из имени; имя целиком уходит только в
 * `file_name` (для показа) и никогда — в путь объекта.
 */

import { sniffImageMime } from "../material-import/image";

/* ------------------------------------------------------------------ */
/*  Категории                                                          */
/* ------------------------------------------------------------------ */

/**
 * Виды документа: закрытый список значений, которые лежат в
 * `spec_item_files.category`.
 *
 * Первая версия знала три значения (`document | texture | other`) — одна
 * категория на все документы. В позиции же накапливаются разные бумаги: счёт,
 * чек, договор, ТЗ, чертёж. Пока вид не различался, найти нужное можно было
 * только по имени файла, а «прикрепить чек к оплате» и «приложить чертёж к
 * позиции» выглядели одинаково. Поэтому список расширен видами (миграция
 * `20261011_001`), а не заведён второй сущностью: вид документа — свойство
 * файла, а не отдельная таблица.
 *
 * `document` остаётся значением (и значением по умолчанию), хотя подписи у него
 * в интерфейсе нет: это уже записанное в схему значение и запасной вариант для
 * файла, вид которого не назван.
 *
 * Вид — это ДАННЫЕ, а не производная формата: он хранится в строке и правится
 * человеком. Формат даёт лишь догадку при загрузке (`guessSpecItemFileCategory`
 * ниже), и догадка эта грубая — счёт, договор и ТЗ одинаково выглядят как PDF.
 *
 * Legacy `FILE_CATS` (`lib/constants.ts`) сюда по-прежнему НЕ перенесён: это
 * четыре продуктовые категории старой архитектуры («Схемы», «Текстуры»,
 * «Инструкции», «3D / CAD») с accept-масками и текстами подсказок для формы,
 * которой больше нет.
 *
 * Список продублирован CHECK-констрейнтом `spec_item_files_category_check`
 * (миграции `20260927_001` и `20261011_001`); расхождение ловит тест.
 */
export const SPEC_ITEM_FILE_CATEGORIES = [
  "document",
  "invoice",
  "receipt",
  "contract",
  "specification",
  "drawing",
  "texture",
  "other",
] as const;

export type SpecItemFileCategory = (typeof SPEC_ITEM_FILE_CATEGORIES)[number];

export function isSpecItemFileCategory(
  value: unknown,
): value is SpecItemFileCategory {
  return (
    typeof value === "string" &&
    (SPEC_ITEM_FILE_CATEGORIES as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------------ */
/*  Лимиты                                                             */
/* ------------------------------------------------------------------ */

/**
 * Максимальный размер файла позиции.
 *
 * 25 МиБ — потолок и для bucket'а (`file_size_limit` в миграции), и для
 * серверной проверки. Существующие лимиты проекта (5 МиБ) относятся к
 * картинкам материалов и обложек; PDF-каталог производителя в них не
 * помещается, поэтому здесь лимит свой — но ровно один на весь домен файлов.
 */
export const MAX_SPEC_ITEM_FILE_BYTES = 25 * 1024 * 1024;

/** Строка лимита для сообщений об ошибке. */
export const MAX_SPEC_ITEM_FILE_LABEL = "25 МБ";

/**
 * Максимальная длина оригинального имени.
 *
 * Ограничение не косметическое: `file_name` показывается в списке и уходит в
 * `Content-Disposition` при скачивании. 255 — предел большинства файловых
 * систем, а хранить больше незачем.
 */
export const MAX_SPEC_ITEM_FILE_NAME_LENGTH = 255;

/* ------------------------------------------------------------------ */
/*  MIME                                                               */
/* ------------------------------------------------------------------ */

/**
 * Разрешённые типы. Ключ — нормализованный MIME (нижний регистр, без
 * параметров), значение — расширение для пути объекта.
 *
 * Список намеренно закрытый и продублирован в `allowed_mime_types` bucket'а.
 * `image/svg+xml` отсутствует сознательно: SVG это XML, который может
 * содержать скрипт, а объект отдаётся браузеру.
 */
export const SPEC_ITEM_FILE_MIME_TYPES: Readonly<Record<string, string>> = {
  // ── документы ───────────────────────────────────────────────────────────
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "text/plain": "txt",
  "text/csv": "csv",
  // ── изображения и текстуры ──────────────────────────────────────────────
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/tiff": "tiff",
  // ── CAD / 3D ────────────────────────────────────────────────────────────
  "image/vnd.dwg": "dwg",
  "image/vnd.dxf": "dxf",
  "model/gltf+json": "gltf",
  "model/gltf-binary": "glb",
  "model/obj": "obj",
  /**
   * Обобщённый бинарный тип: браузеры отдают его для DWG, OBJ, MAX, SKP и
   * прочих CAD-форматов, у которых нет однозначного MIME. Пропускать его
   * необходимо — иначе половина рабочего набора просто не загрузится, — но
   * именно поэтому для него работает дополнительная проверка «расширение
   * согласовано с объявленным типом» (см. `KNOWN_EXTENSION_MIME`).
   */
  "application/octet-stream": "bin",
  "application/zip": "zip",
};

/** Разрешён ли MIME (по нормализованному значению). */
export function isAllowedSpecItemFileMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(SPEC_ITEM_FILE_MIME_TYPES, mime);
}

/**
 * Нормализация объявленного MIME.
 *
 * `file.type` приходит из браузера и может быть пустым, содержать параметры
 * (`text/plain; charset=utf-8`) или регистр. Приводим к каноническому виду,
 * но НЕ считаем доказательством: доказательство — сигнатура содержимого.
 */
export function normalizeMimeType(
  contentType: string | null | undefined,
): string {
  const normalized = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  return normalized && normalized.length > 0
    ? normalized
    : "application/octet-stream";
}

/* ------------------------------------------------------------------ */
/*  Определение формата по содержимому                                 */
/* ------------------------------------------------------------------ */

/**
 * Форматы, которые опознаются по сигнатуре.
 *
 * `pdf` и `zip` — не изображения, поэтому их нет в `sniffImageMime`; они
 * добавлены в `sniffSignature`. ZIP-контейнер — это ещё и OOXML/ODF (docx,
 * xlsx, pptx, odt), поэтому совпадение по zip проверяется на «семейство», а не
 * на точный MIME.
 */
type SignatureMime = string;

function sniffSignature(bytes: Uint8Array): SignatureMime | null {
  const image = sniffImageMime(bytes);
  if (image) return image.mime;

  if (bytes.length < 5) return null;

  // PDF: "%PDF-"
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }

  // ZIP: "PK" + вариант заголовка. OOXML (docx/xlsx/pptx) и ODF (odt/ods) — это
  // zip-архивы, поэтому конкретный подтип здесь принципиально не определить.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const third = bytes[2];
    const fourth = bytes[3];
    if (
      (third === 0x03 && fourth === 0x04) ||
      (third === 0x05 && fourth === 0x06) ||
      (third === 0x07 && fourth === 0x08)
    ) {
      return "application/zip";
    }
  }

  return null;
}

/** MIME, совместимые с zip-сигнатурой. */
const ZIP_FAMILY = new Set([
  "application/zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

/**
 * Исполняемый файл по сигнатуре.
 *
 * Проверка нужна именно потому, что `application/octet-stream` разрешён: без
 * неё PE-файл (`MZ`), переименованный в `.pdf`, попадал бы в ветку «сигнатуры
 * нет, расширение не противоречит». Формат определяется по байтам, а не по
 * расширению, поэтому MZ-заголовок виден независимо от имени.
 *
 * Это защита от заведомо опасного содержимого, а не антивирус: экзотические
 * форматы, неизвестные здесь, остаются на усмотрение вызывающего. Дополнительно
 * их сдерживает сам Storage: bucket приватный, публичной раздачи нет, объекта
 * по прямой ссылке не получить, а `Content-Disposition` при скачивании задаёт
 * сервер.
 */
function sniffExecutable(bytes: Uint8Array): string | null {
  // PE / DOS: "MZ"
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    return "application/x-msdownload";
  }

  // ELF: 7F 45 4C 46
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46
  ) {
    return "application/x-elf";
  }

  // Mach-O (32/64, thin и fat):
  // FE ED FA CE / FE ED FA CF / CE FA ED FE / CF FA ED FE / CA FE BA BE
  const macho = [
    [0xfe, 0xed, 0xfa, 0xce],
    [0xfe, 0xed, 0xfa, 0xcf],
    [0xce, 0xfa, 0xed, 0xfe],
    [0xcf, 0xfa, 0xed, 0xfe],
    [0xca, 0xfe, 0xba, 0xbe],
  ];
  for (const signature of macho) {
    if (
      bytes.length >= 4 &&
      signature.every((byte, index) => bytes[index] === byte)
    ) {
      return "application/x-mach-binary";
    }
  }

  return null;
}

/**
 * Активное содержимое: то, что браузер может ИСПОЛНИТЬ или разобрать как
 * разметку. Такой файл не должен попадать в Storage под видом документа, даже
 * если он объявлен разрешённым MIME.
 *
 * Проверка идёт по началу файла и покрывает два реальных случая: переименованную
 * HTML-страницу (`text/html`, которая при `Content-Type: text/plain` всё равно
 * может быть разобрана браузером при sniffing) и SVG со скриптом.
 */
function sniffActiveContent(bytes: Uint8Array): string | null {
  // BOM отбрасываем: без этого UTF-8 SVG с BOM прошёл бы мимо проверки.
  let start = 0;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    start = 3;
  }

  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(start, start + 512))
    .trimStart()
    .toLowerCase();

  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    return "text/html";
  }
  if (head.startsWith("<?xml") || head.startsWith("<svg")) {
    return "image/svg+xml";
  }
  // Прочий XML (например, COLLADA) — тоже разметка, а не бинарный документ.
  if (head.startsWith("<")) return "application/xml";

  return null;
}

/**
 * Расширение → ожидаемый MIME. Нужна только для типов, которые НЕ определяются
 * по сигнатуре (CAD, TIFF): там объявленный тип остаётся единственным
 * свидетельством, и мы требуем, чтобы расширение ему не противоречило.
 *
 * Это не «доверие расширению»: расширение может только СУЗИТЬ набор, а не
 * расширить его. Для форматов с сигнатурой таблица не применяется вовсе.
 */
const KNOWN_EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  dwg: "image/vnd.dwg",
  dxf: "image/vnd.dxf",
  gltf: "model/gltf+json",
  glb: "model/gltf-binary",
  obj: "model/obj",
  zip: "application/zip",
};

/** Расширение из имени файла: только алфанумерика, не длиннее 5 символов. */
export function extensionOfFileName(
  fileName: string | null | undefined,
): string | null {
  if (!fileName) return null;
  const match = /\.([a-z0-9]{1,5})$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Проверка «объявленный MIME ↔ содержимое».
 *
 * Возвращает `null`, если всё согласовано, иначе — причину отказа для показа
 * пользователю. Само наличие файла в allow-list проверяется ДО вызова.
 */
export function checkDeclaredMimeMatchesContent(args: {
  declaredMime: string;
  fileName: string;
  bytes: Uint8Array;
}): string | null {
  // Активное содержимое отвергается ДО всего остального: разметку нельзя
  // принимать ни под каким объявленным типом. Без этой проверки SVG с
  // объявленным `image/png` прошёл бы как «неопознанная сигнатура + расширение
  // не противоречит».
  const active = sniffActiveContent(args.bytes);
  if (active) {
    return `Файл похож на разметку (${active}) и не может быть загружен`;
  }

  // Исполняемый файл отвергается независимо от объявленного типа: расширение и
  // `file.type` — заявка клиента, а `MZ`/ELF/Mach-O — факт содержимого.
  const executable = sniffExecutable(args.bytes);
  if (executable) {
    return "Исполняемые файлы загружать нельзя";
  }

  const contentMime = sniffSignature(args.bytes);

  if (contentMime) {
    // Сигнатура доказала «семейство». Для zip-контейнера точный подтип
    // (docx/xlsx/odt) по первым байтам не определяется, поэтому сверяем семейство.
    const matches =
      contentMime === args.declaredMime ||
      (contentMime === "application/zip" && ZIP_FAMILY.has(args.declaredMime));

    if (!matches) {
      return `Содержимое файла не соответствует объявленному типу «${args.declaredMime}»`;
    }
    return null;
  }

  // Сигнатуры нет: тип либо не имеет её (CAD, TIFF), либо файл подделан.
  // Требуем, чтобы расширение не противоречило объявленному типу.
  const extension = extensionOfFileName(args.fileName);
  const expected = extension ? KNOWN_EXTENSION_MIME[extension] : undefined;
  if (expected && expected !== args.declaredMime) {
    return `Расширение «.${extension}» не соответствует типу файла`;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Оригинальное имя                                                   */
/* ------------------------------------------------------------------ */

/**
 * Нормализация оригинального имени для показа.
 *
 * Что убираем и почему:
 *
 * * `C:\path\to\file.pdf` и `../../etc/passwd` — браузер отдаёт только имя, но
 *   клиент может прислать что угодно, а имя попадает в `Content-Disposition`;
 * * управляющие символы и NUL — ломают заголовки и отображение;
 * * переводы строк — заголовок `Content-Disposition` не должен содержать их
 *   вовсе (защита от header injection);
 * * точка в начале и пробелы по краям — имена вида `..` и `.hidden`.
 *
 * Что НЕ делаем: не транслитерируем и не вырезаем Unicode. Оригинальное имя —
 * то, что увидит пользователь, и «Счёт №1.pdf» должно остаться читаемым.
 */
export function normalizeFileName(raw: unknown): string {
  const source = typeof raw === "string" ? raw : "";

  const base = source.split(/[\\/]/).pop() ?? "";

  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .normalize("NFC");

  if (!cleaned) return "";

  if (cleaned.length <= MAX_SPEC_ITEM_FILE_NAME_LENGTH) return cleaned;

  // Обрезка сохраняет расширение: без него имя в списке теряет смысл.
  const extension = extensionOfFileName(cleaned);
  const suffix = extension ? `.${extension}` : "";
  const stem = suffix
    ? cleaned.slice(0, cleaned.length - suffix.length)
    : cleaned;
  const keep = Math.max(1, MAX_SPEC_ITEM_FILE_NAME_LENGTH - suffix.length);

  return `${stem.slice(0, keep)}${suffix}`;
}

/* ------------------------------------------------------------------ */
/*  Путь объекта                                                       */
/* ------------------------------------------------------------------ */

/** Bucket файлов позиции. Создаётся миграцией 20260927_001. */
export const SPEC_ITEM_FILES_BUCKET = "spec-item-files";

/** Второй сегмент пути: отделяет файлы позиций от прочих файлов организации. */
const SPEC_ITEMS_SEGMENT = "spec-items";

/**
 * Путь объекта: `<orgId>/spec-items/<specItemId>/<uuid>.<ext>`.
 *
 * Путь собирает ТОЛЬКО сервер. Клиент не может прислать `storage_path` — его
 * просто нет в контракте загрузки, — поэтому подсунуть чужой объект нечем.
 * Имя файла здесь не используется: вместо него UUID, а расширение берётся из
 * подтверждённого MIME.
 */
export function buildSpecItemFilePath(args: {
  orgId: string;
  specItemId: string;
  extension: string;
  fileId: string;
}): string {
  return [
    args.orgId,
    SPEC_ITEMS_SEGMENT,
    args.specItemId,
    `${args.fileId}.${args.extension}`,
  ].join("/");
}

/**
 * Ожидаемый префикс пути для позиции.
 *
 * Проверка `storagePath.startsWith(expected)` — единственная защита от того,
 * чтобы строка в БД (или клиентский id) не привела к объекту другой позиции или
 * другой организации. Вынесена сюда, чтобы и чтение, и удаление пользовались
 * одним правилом.
 */
export function specItemFilePathPrefix(
  orgId: string,
  specItemId: string,
): string {
  return `${orgId}/${SPEC_ITEMS_SEGMENT}/${specItemId}/`;
}

/**
 * Имя объекта в пути: `<uuid>.<ext>`.
 *
 * Разрешаются только буквы, цифры, дефис, подчёркивание и точка. Этого хватает
 * для UUID и расширения и не хватает для `/`, `\`, `..` и URL-кодированных
 * подстановок, поэтому вложенность и выход за папку отсекаются формой, а не
 * только сравнением строк.
 */
const OBJECT_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Путь объекта принадлежит ровно этой позиции этой организации.
 *
 * Сравнение не сводится к `startsWith`: одного префикса мало, потому что
 * `<prefix>nested/<uuid>.pdf` ему тоже удовлетворяет, а это уже другой объект,
 * вложенный в подпапку. Поэтому после префикса обязано остаться имя файла без
 * разделителей.
 */
export function isSpecItemFilePathExpected(args: {
  storagePath: string;
  orgId: string;
  specItemId: string;
}): boolean {
  const prefix = specItemFilePathPrefix(args.orgId, args.specItemId);
  if (!args.storagePath.startsWith(prefix)) return false;

  const name = args.storagePath.slice(prefix.length);
  if (name.length === 0) return false;
  if (!OBJECT_NAME_PATTERN.test(name)) return false;

  // `.` и `..` не проходят шаблон только частично: у них нет расширения, но
  // проверить это явно дешевле, чем объяснять, почему они не страшны.
  return name !== "." && name !== "..";
}

/** Расширение для пути из подтверждённого MIME; неизвестный — `bin`. */
export function extensionForMime(mime: string): string {
  return SPEC_ITEM_FILE_MIME_TYPES[mime] ?? "bin";
}

/* ------------------------------------------------------------------ */
/*  Вид файла: формат содержимого                                      */
/* ------------------------------------------------------------------ */

/**
 * Вид файла по формату: определяет иконку в списке и участвует в угадывании
 * вида документа при загрузке.
 *
 * Живёт в ядре, а не в модуле отображения (`./file-view`), потому что нужен
 * ДВУМ сторонам: сервер угадывает по нему вид документа (`guessSpecItemFileCategory`),
 * а список рисует по нему иконку. Две копии этого правила разошлись бы молча —
 * ровно на этом ломается «pdf угадали, а иконку нарисовали другую».
 */
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

/**
 * То же по расширению: MIME от клиента может быть обобщённым
 * (`application/octet-stream`) или пустым.
 */
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
  // Пустой MIME — это «неизвестно», а не `octet-stream`: нормализация здесь
  // только помешала бы, подставив значение, которого клиент не присылал.
  const mime = (file.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (mime === "application/pdf") return "pdf";
  if (CAD_MIME_TYPES.has(mime)) return "cad";
  if (ARCHIVE_MIME_TYPES.has(mime)) return "archive";
  if (IMAGE_MIME_PATTERN.test(mime)) return "image";

  const extension = extensionOfFileName(file.fileName) ?? "";
  return KIND_BY_EXTENSION[extension] ?? "file";
}

/* ------------------------------------------------------------------ */
/*  Вид документа: угадывание при загрузке                             */
/* ------------------------------------------------------------------ */

/**
 * Вид документа по формату файла: ДОГАДКА сервера, а не выбор пользователя.
 *
 * Зачем нужно. Подавляющее большинство загрузок не требует вопроса «что это»:
 * PDF — это документ, JPG — изображение, DWG — чертёж. Раньше вид спрашивался
 * диалогом всегда, и пользователь делал лишний шаг ради редкого случая. Теперь
 * вид угадывается, а исправляется в строке списка — «не спрашивай, а исправляй».
 *
 * Догадка — про ФОРМАТ, а не про назначение файла. Счёт, договор и ТЗ одинаково
 * выглядят как PDF, и различить их по байтам нельзя: все три получают
 * `document`. Назначение знает человек, поэтому точный вид ставится правкой
 * строки, а не выводится из содержимого.
 *
 * Почему угадывает СЕРВЕР, а не браузер. Вид документа — данные строки в БД, и
 * он же лежит в CHECK-констрейнте. Браузерное `file.type` — заявка клиента,
 * которую мы нигде больше не считаем доказательством (см. заголовок модуля);
 * сервер к этому моменту уже подтвердил MIME сигнатурой содержимого
 * (`checkDeclaredMimeMatchesContent`). Так догадка опирается на проверенный
 * факт, а не на расширение из имени.
 *
 * Незнакомый формат даёт `document`, а не `other`: `other` означает «я не знаю,
 * что это», а «файл, вид которого не назван» — это `document`, значение по
 * умолчанию всего домена. Архив (zip, rar, 7z) — тоже `document`: это контейнер,
 * содержимое которого неизвестно, и назвать его чем-то точнее нельзя.
 */
export function guessSpecItemFileCategory(file: {
  /** Подтверждённый MIME (сигнатура уже проверена вызывающим). */
  mimeType: string;
  fileName: string | null;
}): SpecItemFileCategory {
  switch (fileKindOf({ mimeType: file.mimeType, fileName: file.fileName ?? "" })) {
    case "image":
      return "texture";
    case "cad":
      return "drawing";
    // `pdf` и `archive` перечислены явно, а `file` уходит в `default`: так
    // видно, что «PDF — это документ» и «незнакомый формат — тоже документ» —
    // два разных решения, а не одно по умолчанию. Явные ветки здесь не
    // декоративны: если появится формат со своим видом, менять придётся именно
    // их, и пропустить `pdf` будет заметно.
    case "pdf":
    case "archive":
    default:
      return "document";
  }
}
