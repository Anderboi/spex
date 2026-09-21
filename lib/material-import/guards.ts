/**
 * Защита от SSRF и политика исходящих запросов импортёра.
 *
 * Модуль намеренно разделён на две части:
 *
 *  1. **Чистые правила** — `parseImportUrl` и `evaluateHostPolicy`. Работают с
 *     уже разобранным `URL` и не знают ни про DNS, ни про сеть, поэтому
 *     тестируются без моков (см. guards.test.ts).
 *  2. **Сетевые проверки** — `assertPublicHost` и `assertSafeRequestUrl`.
 *     Резолвят DNS через `node:dns/promises` и потому годятся только для сервера.
 *
 * Почему проверяется именно имя хоста, а не строка: `new URL()` уже приводит
 * IPv4-обфускацию к каноническому виду — `0177.0.0.1`, `2130706433`, `0x7f.1`
 * и `127.1` превращаются в `127.0.0.1` (проверено на Node 22). Поэтому
 * достаточно разобрать `hostname`, а не бороться с регулярками по тексту URL.
 *
 * DNS проверяется отдельно от хоста, потому что атакующий может указать
 * публичное имя, которое резолвится в приватный адрес (DNS rebinding), либо
 * сменить адрес между проверкой и запросом. Полностью закрыть эту гонку на
 * уровне `fetch` нельзя, но проверка КАЖДОГО редиректа и резолв перед запросом
 * поднимают планку до приемлемой для MVP.
 *
 * Модуль только для сервера по факту: `assertPublicHost` импортирует
 * `node:dns/promises`, а `lib/material-import/fetch.ts` использует
 * `node:stream/consumers`. Директиву `server-only` здесь не ставим намеренно —
 * см. комментарий в fetch.ts.
 */

/** Коды отказа. Тексты для пользователя живут в actions/material-import.ts. */
export type ImportUrlErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "UNSUPPORTED_PORT"
  | "CREDENTIALS_NOT_ALLOWED"
  | "HOST_NOT_ALLOWED"
  | "PRIVATE_ADDRESS"
  | "DNS_RESOLUTION_FAILED";

export type ImportUrlFailure = { ok: false; code: ImportUrlErrorCode };

export type ParsedImportUrl = {
  ok: true;
  url: URL;
  /** Канонический вид — его и сохраняем в `product_url`. */
  href: string;
  /** Имя хоста без скобок IPv6 и без завершающей точки. */
  hostname: string;
};

export type ImportUrlPolicy = ParsedImportUrl | ImportUrlFailure;

/* ------------------------------------------------------------------ */
/*  Ограничения запроса                                                */
/* ------------------------------------------------------------------ */

/** Общий бюджет одного исходящего запроса. */
export const FETCH_TIMEOUT_MS = 10_000;
/** Сколько редиректов проходим, прежде чем сдаться. */
export const MAX_REDIRECTS = 3;
/** Потолок тела ответа: product-страницы редко больше, а память экономит. */
export const MAX_RESPONSE_BYTES = 2_000_000;
/** Максимальная длина URL, которую вообще принимаем от пользователя. */
export const MAX_URL_LENGTH = 2_048;

/** Content-Type, которые считаем HTML и готовы разбирать. */
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

/** Порты, которые не должны встречаться в пользовательских ссылках. */
const BLOCKED_PORTS = new Set([
  22, 23, 25, 110, 143, 445, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 9200,
  11211, 27017,
]);

/* ------------------------------------------------------------------ */
/*  Синхронная политика                                                */
/* ------------------------------------------------------------------ */

/** Убирает IPv6-скобки и завершающую точку FQDN. */
export function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

/**
 * Разбирает пользовательский ввод и применяет правила, не требующие сети:
 * протокол, порт, отсутствие учётных данных, диапазон адреса.
 *
 * `allowHttp` — «предпочтительно https» из требований: для обычного импорта
 * http запрещён, но при переходе по редиректу мы обязаны проверять и его,
 * поэтому политика вынесена в параметр, а не зашита в функцию.
 */
export function parseImportUrl(
  raw: string,
  opts: { allowHttp?: boolean } = {},
): ImportUrlPolicy {
  const allowHttp = opts.allowHttp ?? false;

  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, code: "INVALID_URL" };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: "INVALID_URL" };
  }

  const isHttp = url.protocol === "http:";
  const isHttps = url.protocol === "https:";
  if (!isHttps && !(allowHttp && isHttp)) {
    return { ok: false, code: "UNSUPPORTED_PROTOCOL" };
  }

  // URL допускает `https://user:pass@host` — такие ссылки маскируют реальный
  // хост в логах и в UI, поэтому отклоняем целиком.
  if (url.username || url.password) {
    return { ok: false, code: "CREDENTIALS_NOT_ALLOWED" };
  }

  if (url.port) {
    const port = Number(url.port);
    // Порт по умолчанию `URL` не отдаёт, поэтому пустой порт сюда не попадает.
    if (port !== 80 && port !== 443 && BLOCKED_PORTS.has(port)) {
      return { ok: false, code: "UNSUPPORTED_PORT" };
    }
  }

  const hostname = bareHostname(url);
  if (!hostname || hostname.length > 253) {
    return { ok: false, code: "HOST_NOT_ALLOWED" };
  }
  // localhost и его варианты — до DNS, чтобы не ходить в сеть вообще.
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, code: "HOST_NOT_ALLOWED" };
  }

  const literal = parseIpLiteral(hostname);
  if (literal && isBlockedIp(literal)) {
    return { ok: false, code: "PRIVATE_ADDRESS" };
  }

  return { ok: true, url, href: url.href, hostname };
}

/**
 * Применяет к уже разобранному URL те же правила адреса, что и `parseImportUrl`.
 * Нужна для редиректов: цель редиректа приходит не от пользователя, но правило
 * «не ходить внутрь сети» для неё ровно то же.
 */
export function evaluateHostPolicy(url: URL): ImportUrlFailure | { ok: true } {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "UNSUPPORTED_PROTOCOL" };
  }
  if (url.username || url.password) {
    return { ok: false, code: "CREDENTIALS_NOT_ALLOWED" };
  }
  if (url.port) {
    const port = Number(url.port);
    if (port !== 80 && port !== 443 && BLOCKED_PORTS.has(port)) {
      return { ok: false, code: "UNSUPPORTED_PORT" };
    }
  }
  const hostname = bareHostname(url);
  if (!hostname) return { ok: false, code: "HOST_NOT_ALLOWED" };
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, code: "HOST_NOT_ALLOWED" };
  }
  const literal = parseIpLiteral(hostname);
  if (literal && isBlockedIp(literal)) {
    return { ok: false, code: "PRIVATE_ADDRESS" };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  IP-адреса                                                          */
/* ------------------------------------------------------------------ */

export type IpLiteral =
  | { kind: "ipv4"; bytes: [number, number, number, number] }
  | { kind: "ipv6"; bytes: Uint8Array };

/**
 * Разбирает строку как IP-литерал. Возвращает `null`, если это обычное имя
 * хоста — тогда решение принимает DNS-проверка.
 */
export function parseIpLiteral(host: string): IpLiteral | null {
  const v4 = parseIpv4(host);
  if (v4) return { kind: "ipv4", bytes: v4 };

  const v6 = parseIpv6(host);
  if (v6) return { kind: "ipv6", bytes: v6 };

  return null;
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;

  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
}

/**
 * Поддерживает полную и сжатую форму, IPv4-хвост (`::ffff:93.184.216.34`) и
 * зону (`fe80::1%eth0`). Зона отбрасывается: она не влияет на «приватность».
 */
function parseIpv6(host: string): Uint8Array | null {
  if (!host.includes(":")) return null;

  let value = host;
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);

  // IPv4-хвост разворачиваем в два 16-битных блока.
  const lastColon = value.lastIndexOf(":");
  const tail = value.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    value = `${value.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (chunk: string): number[] | null => {
    if (!chunk) return [];
    const out: number[] = [];
    for (const group of chunk.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0]);
  const tailGroups = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !tailGroups) return null;

  const total = head.length + tailGroups.length;
  if (halves.length === 1 && total !== 8) return null;
  if (halves.length === 2 && total > 7) return null;

  const groups = [
    ...head,
    ...new Array<number>(8 - total).fill(0),
    ...tailGroups,
  ];

  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    bytes[i * 2] = (g >> 8) & 0xff;
    bytes[i * 2 + 1] = g & 0xff;
  });
  return bytes;
}

/**
 * Приватные, служебные и локальные диапазоны. Список сознательно шире
 * «приватных сетей»: сюда попадают link-local (в том числе metadata-эндпоинты
 * облаков — `169.254.169.254`), CGNAT, документация, multicast и reserve.
 */
export function isBlockedIp(ip: IpLiteral): boolean {
  if (ip.kind === "ipv4") {
    const [a, b] = ip.bytes;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // приватная
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // приватная
    if (a === 192 && b === 168) return true; // приватная
    if (a === 192 && b === 0) return true; // 192.0.0.0/24, 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51) return true; // 198.51.100.0/24
    if (a === 203 && b === 0) return true; // 203.0.113.0/24
    if (a >= 224) return true; // multicast, reserve, broadcast
    return false;
  }

  const bytes = ip.bytes;
  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) return true; // ::

  // ::1 — IPv6-loopback. Отдельное правило обязательно: остальные диапазоны
  // ниже его не покрывают, и без этой строки `https://[::1]/` проходил проверку.
  if (bytes.slice(0, 15).every((byte) => byte === 0)) return true; // ::1 … ::ffff

  // ::ffff:a.b.c.d — проверяем вложенный IPv4, иначе 127.0.0.1 прошёл бы как IPv6.
  const isMapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (isMapped) {
    return isBlockedIp({
      kind: "ipv4",
      bytes: [bytes[12], bytes[13], bytes[14], bytes[15]],
    });
  }

  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (bytes[0] === 0xff) return true; // multicast
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  ) {
    return true; // 2001:db8::/32 документация
  }
  return false;
}

/** Обратная сборка IPv4-адреса из DNS-ответа в привычную запись. */
export function formatIpv4(bytes: Uint8Array): string {
  return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
}

/* ------------------------------------------------------------------ */
/*  Content-Type                                                       */
/* ------------------------------------------------------------------ */

/** Приводит `Content-Type` к базовому MIME без параметров. */
export function baseContentType(value: string | null): string | null {
  if (!value) return null;
  const base = value.split(";")[0]?.trim().toLowerCase();
  return base || null;
}

/**
 * Готовы ли мы разбирать этот ответ как HTML. `null` (заголовок отсутствует)
 * считаем допустимым: часть сайтов его не отдаёт, а вред от этого нулевой —
 * HTML всё равно не исполняется, а парсится как данные.
 */
export function isExtractableContentType(value: string | null): boolean {
  const base = baseContentType(value);
  if (base === null) return true;
  return ALLOWED_CONTENT_TYPES.includes(base);
}

/* ------------------------------------------------------------------ */
/*  DNS (только сервер: node:dns)                                      */
/* ------------------------------------------------------------------ */

export type HostCheck =
  | { ok: true; addresses: string[] }
  | { ok: false; code: ImportUrlErrorCode };

/**
 * Резолвит имя хоста и убеждается, что ни один из адресов не ведёт внутрь
 * сети. Если хотя бы один адрес запрещён — отказываем целиком: выбирать
 * «хороший» адрес из смешанного ответа значит оставить окно для rebinding.
 *
 * IP-литералы пропускаем: они уже проверены правилами хоста.
 */
export async function assertPublicHost(hostname: string): Promise<HostCheck> {
  const literal = parseIpLiteral(hostname);
  if (literal) {
    return isBlockedIp(literal)
      ? { ok: false, code: "PRIVATE_ADDRESS" }
      : { ok: true, addresses: [hostname] };
  }

  const dns = await import("node:dns/promises");
  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    return { ok: false, code: "DNS_RESOLUTION_FAILED" };
  }

  if (records.length === 0) {
    return { ok: false, code: "DNS_RESOLUTION_FAILED" };
  }

  for (const record of records) {
    const ip = parseIpLiteral(record.address);
    if (ip && isBlockedIp(ip)) {
      return { ok: false, code: "PRIVATE_ADDRESS" };
    }
  }

  return { ok: true, addresses: records.map((r) => r.address) };
}

/**
 * Полная проверка перед запросом: синхронная политика + резолв DNS.
 * Используется и для исходного URL, и для каждого редиректа.
 */
export async function assertSafeRequestUrl(url: URL): Promise<HostCheck> {
  const policy = evaluateHostPolicy(url);
  if (!policy.ok) return policy;
  return assertPublicHost(bareHostname(url));
}
