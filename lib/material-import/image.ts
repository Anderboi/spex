/**
 * Скачивание внешнего изображения товара и загрузка его в Supabase Storage.
 *
 * Зачем перехостить, а не хранить ссылку вендора: `next/image` в этом проекте
 * пускает только `*.supabase.co` (`next.config.ts`), расширять его на
 * произвольные хосты нельзя, а vendor-ссылки к тому же умирают вместе с
 * каталогом. Поэтому картинка переносится в существующий bucket материалов.
 *
 * Безопасность: адрес картинки — такой же SSRF-периметр, как адрес страницы.
 * Сеть выполняется общим `safeFetch`, то есть ровно теми же правилами
 * (запрет localhost/private/loopback/link-local/metadata/multicast, проверка
 * КАЖДОГО редиректа, лимит переходов, таймаут) — своей копии проверок здесь нет.
 *
 * Доверять заголовку `Content-Type` нельзя: тип подтверждается сигнатурой
 * файла. Изображение никогда не исполняется и не разбирается как разметка.
 *
 * Ошибка загрузки картинки НЕ ломает импорт материала: вызывающий получает
 * `ok: false` и оставляет `image_url = null`. Повторов нет — один запрос.
 */

import { MAX_IMAGE_BYTES, ALLOWED_IMAGE_MIME, storeMaterialImage } from "./storage";
import { safeFetch, type HostResolver } from "./http";

export type ImageFailureCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "UNSUPPORTED_PORT"
  | "CREDENTIALS_NOT_ALLOWED"
  | "HOST_NOT_ALLOWED"
  | "PRIVATE_ADDRESS"
  | "DNS_RESOLUTION_FAILED"
  | "NETWORK_ERROR"
  | "FETCH_TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "REDIRECT_WITHOUT_LOCATION"
  | "HTTP_ERROR"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "EMPTY_IMAGE"
  | "IMAGE_TOO_LARGE"
  | "STORAGE_FAILED";

export type RehostedImage = { ok: true; url: string } | { ok: false; code: ImageFailureCode };

export type RehostImageOptions = {
  /** Организация-владелец: определяет папку в bucket'е. */
  orgId: string;
  /** Переопределить проверку хоста (тесты). По умолчанию — реальный DNS. */
  resolveHost?: HostResolver;
};

/**
 * Интерфейс перехостинга — единственное, что нужно конвейеру.
 *
 * Конвейер не импортирует Supabase: конкретную реализацию (`rehostImage`)
 * подставляет server action. Так `runImportPipeline` остаётся проверяемым в
 * unit-тестах, как и слой LLM.
 */
export type ImageRehoster = (
  imageUrl: string,
  options: RehostImageOptions,
) => Promise<RehostedImage>;

/* ------------------------------------------------------------------ */
/*  Проверка формата по сигнатуре                                      */
/* ------------------------------------------------------------------ */

type SniffResult = { mime: string } | null;

/**
 * Определяет формат изображения по первым байтам.
 *
 * Это защита от подмены: сервер может объявить `image/jpeg`, а отдать HTML или
 * SVG со скриптом. Расширение и заголовок не доказательство — доказательство
 * только содержимое.
 *
 * SVG намеренно НЕ поддерживаем: это XML, который может содержать скрипты.
 */
export function sniffImageMime(bytes: Uint8Array): SniffResult {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG.every((byte, index) => bytes[index] === byte)) {
    return { mime: "image/png" };
  }

  // GIF: "GIF87a" / "GIF89a"
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { mime: "image/gif" };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp" };
  }

  // AVIF: ISO-BMFF, бренд "avif" в 4..8 байтах поля ftyp.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "avif" || brand === "avis") return { mime: "image/avif" };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Чтение тела с лимитом                                              */
/* ------------------------------------------------------------------ */

type ReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; code: "IMAGE_TOO_LARGE" | "EMPTY_IMAGE" };

/**
 * Читает картинку в память, обрывая чтение при превышении лимита.
 * Проверяет и объявленный размер (если сервер его сообщил), и фактический:
 * заголовку `Content-Length` доверять нельзя.
 */
async function readBytesCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<ReadResult> {
  if (!body) return { ok: false, code: "EMPTY_IMAGE" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "IMAGE_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) return { ok: false, code: "EMPTY_IMAGE" };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/* ------------------------------------------------------------------ */
/*  Перехостинг                                                        */
/* ------------------------------------------------------------------ */

/**
 * Скачивает изображение по внешней ссылке и кладёт его в bucket материалов.
 *
 * Один запрос, без повторов. Любая неудача — `ok: false` с кодом причины:
 * импорт материала от этого не страдает, просто остаётся без картинки.
 */
export async function rehostImage(
  imageUrl: string,
  options: RehostImageOptions,
): Promise<RehostedImage> {
  const result = await safeFetch(imageUrl, { resolveHost: options.resolveHost });
  if (!result.ok) {
    return { ok: false, code: result.code as ImageFailureCode };
  }

  // Объявленный размер — быстрый отказ, но не доказательство: фактический
  // размер всё равно контролируется при чтении.
  const declaredLength = Number(result.response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    await result.response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "IMAGE_TOO_LARGE" };
  }

  const declaredType = result.response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (declaredType && !(declaredType in ALLOWED_IMAGE_MIME)) {
    await result.response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "UNSUPPORTED_IMAGE_TYPE" };
  }

  const body = await readBytesCapped(result.response.body, MAX_IMAGE_BYTES);
  if (!body.ok) return { ok: false, code: body.code };

  // Формат подтверждаем содержимым, а не заголовком и не расширением.
  const sniffed = sniffImageMime(body.bytes);
  if (!sniffed || !(sniffed.mime in ALLOWED_IMAGE_MIME)) {
    return { ok: false, code: "UNSUPPORTED_IMAGE_TYPE" };
  }

  const stored = await storeMaterialImage(options.orgId, body.bytes, sniffed.mime);
  if (!stored.ok) return { ok: false, code: "STORAGE_FAILED" };

  return { ok: true, url: stored.url };
}

/* ------------------------------------------------------------------ */
/*  Выбор основного изображения                                        */
/* ------------------------------------------------------------------ */

/**
 * Приоритет основного изображения:
 *   1. детерминированное из JSON-LD/OG (`imageUrl` детерминированного слоя);
 *   2. изображение от модели;
 *   3. нет изображения.
 *
 * Галерею не перебираем: «случайная» картинка из галереи хуже, чем её
 * отсутствие — пользователь поправит пустое поле, но не заметит чужой кадр.
 */
export function pickPrimaryImage(input: {
  deterministicImageUrl: string | null | undefined;
  aiImageUrl: string | null | undefined;
}): string | null {
  const deterministic = input.deterministicImageUrl?.trim();
  if (deterministic && isHttpUrl(deterministic)) return deterministic;

  const ai = input.aiImageUrl?.trim();
  if (ai && isHttpUrl(ai)) return ai;

  return null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
