/**
 * Общие правила хранения изображений материалов.
 *
 * Раньше эти правила (bucket, лимит размера, путь, проверка MIME) жили прямо в
 * теле `uploadMaterialImage`. Они понадобились ещё и серверной загрузке
 * картинки по внешней ссылке, поэтому вынесены сюда — чтобы у обоих путей был
 * ОДИН контракт, а не две расходящиеся копии.
 *
 * Bucket не создаём: используется существующий `material-images`. Публичный URL
 * отдаёт Supabase Storage, и он совместим с текущим `next/image` (в
 * `next.config.ts` разрешён только `*.supabase.co`).
 *
 * Модуль не знает про авторизацию и не решает, можно ли загружать: это дело
 * вызывающего (server action проверяет права до вызова).
 */

// Относительный импорт внутри `lib/` — как в `lib/spec/pdf-fonts.ts`. Алиас `@/`
// настроен только для сборщика Next и `tsc`, поэтому относительный путь
// позволяет импортировать модуль в unit-тестах.
import { createAdminClient } from "../supabase/admin";
import { randomUUID } from "node:crypto";

/** Существующий bucket материалов. Новых bucket'ов не создаём. */
export const MATERIAL_IMAGES_BUCKET = "material-images";

/** Существующий лимит размера изображения материала. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * MIME-allow-list для картинок, скачанных по ссылке.
 *
 * Браузерная загрузка (`uploadMaterialImage`) по-прежнему принимает любой
 * `image/*` — это поведение формы и мы его не меняем. Для server-to-server
 * загрузки список закрытый: тип приходит из недоверенного ответа, и
 * «настоящий» формат мы дополнительно подтверждаем по сигнатуре файла.
 */
export const ALLOWED_IMAGE_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** MIME по расширению — для файлов из браузера, где имя приходит от пользователя. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

/** Безопасное расширение из имени файла: только буквы и цифры, не длиннее 5. */
export function extensionFromFilename(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Расширение для файла из браузера: сначала по имени, иначе по MIME.
 * Имя приходит от пользователя, поэтому берём только хвост и только
 * алфанумерику — иначе через имя можно было бы подсунуть что угодно.
 */
export function extensionForUpload(
  filename: string | null | undefined,
  contentType: string | null | undefined,
): string {
  const fromName = extensionFromFilename(filename);
  if (fromName) return fromName;

  const mime = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXTENSION_BY_MIME[mime] ?? "jpg";
}

/** Путь объекта в bucket. Конвенция проекта: `<orgId>/<uuid>.<ext>`. */
export function materialImagePath(orgId: string, extension: string): string {
  return `${orgId}/${randomUUID()}.${extension}`;
}

export type StoredImage =
  | { ok: true; url: string; path: string }
  | { ok: false; error: string };

/**
 * Загружает готовые байты в bucket материалов и возвращает публичный URL.
 *
 * Единственная точка записи в Storage: и форма, и импортёр ходят сюда, поэтому
 * `upsert: false` и путь с UUID одинаковы для обоих.
 */
export async function storeMaterialImage(
  orgId: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<StoredImage> {
  const extension =
    ALLOWED_IMAGE_MIME[contentType.toLowerCase()] ??
    EXTENSION_BY_MIME[contentType.toLowerCase()] ??
    "jpg";
  const path = materialImagePath(orgId, extension);

  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(MATERIAL_IMAGES_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });

  if (error) {
    console.error("[storeMaterialImage]", error.message);
    return { ok: false, error: "Не удалось сохранить изображение" };
  }

  const { data } = supabase.storage.from(MATERIAL_IMAGES_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl, path };
}
