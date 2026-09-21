/**
 * Текстовые утилиты для разбора внешнего HTML.
 *
 * Всё, что здесь происходит, работает с содержимым чужой страницы как с
 * ДАННЫМИ: никакого исполнения разметки, скриптов и сущностей. Мы только
 * декодируем сущности, снимаем теги и нормализуем пробелы.
 *
 * Модуль намеренно без зависимостей: тащить полноценный HTML-парсер ради
 * `title`, `meta` и `script[type=application/ld+json]` в MVP не нужно, а
 * регулярки по атрибутам терпимы, потому что мы разбираем небольшие,
 * предсказуемые фрагменты `<head>`, а не произвольный DOM.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  deg: "°",
  times: "×",
  sup2: "²",
  sup3: "³",
  euro: "€",
  pound: "£",
  yen: "¥",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  shy: "",
};

/**
 * Раскрывает HTML-сущности: именованные (короткий список частых) и числовые
 * (`&#8212;`, `&#x2014;`). Неизвестные имена оставляем как есть — лучше
 * показать `&weird;`, чем потерять фрагмент названия.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input.includes("&")) return input;

  // Точка с запятой обязательна: без неё `&#x41;&#x42;` разбирался бы как одна
  // сущность `&#x41` без завершения, и вторая терялась.
  return input.replace(
    /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const isHex = entity[1] === "x" || entity[1] === "X";
        const code = Number.parseInt(
          isHex ? entity.slice(2) : entity.slice(1),
          isHex ? 16 : 10,
        );
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      const named = NAMED_ENTITIES[entity.toLowerCase()];
      return named ?? match;
    },
  );
}

/**
 * Блочные теги: на их границах ставим пробел, иначе `<div>Дуб</div><div>Орех</div>`
 * слиплось бы в «ДубОрех». Внутристрочные (`<span>`, `<b>`) просто удаляем —
 * «Керамо<span>гранит</span>» обязано остаться одним словом.
 */
const BLOCK_TAGS =
  "address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul";

/**
 * Снимает разметку и отдаёт плоский текст. `<script>`/`<style>` вырезаются
 * целиком — их содержимое не является текстом страницы.
 */
export function stripHtmlToText(html: string): string {
  const withoutCode = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const spaced = withoutCode
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), " ")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "");

  return collapseWhitespace(decodeHtmlEntities(spaced));
}

/** Схлопывает любые пробельные последовательности (включая NBSP) в один пробел. */
export function collapseWhitespace(input: string): string {
  return input.replace(/[\s\u00a0\u2007\u202f]+/g, " ").trim();
}

/**
 * Приводит значение из внешнего источника к безопасной строке:
 * раскрывает сущности, снимает теги, схлопывает пробелы, ограничивает длину.
 * Возвращает `null` для пустого результата — так «поля нет» и «поле пустое»
 * не различимы вниз по потоку, что соответствует отсутствию данных.
 */
export function cleanValue(
  value: string | null | undefined,
  maxLength = 500,
): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = collapseWhitespace(decodeHtmlEntities(String(value).replace(/<[^>]*>/g, " ")));
  if (!cleaned) return null;
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trim() : cleaned;
}

/** Номер, вытащенный из валюты (в том числе с пробелами-разделителями и запятой). */
export function parseDecimal(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (!raw) return null;

  const normalised = String(raw)
    .replace(/\u00a0|\u202f|\s/g, "")
    .replace(/[^\d.,-]/g, "");
  if (!normalised) return null;

  const lastComma = normalised.lastIndexOf(",");
  const lastDot = normalised.lastIndexOf(".");

  let canonical = normalised;
  if (lastComma !== -1 && lastDot !== -1) {
    // Оба разделителя: правый — десятичный, левый — разряды.
    canonical =
      lastComma > lastDot
        ? normalised.replace(/\./g, "").replace(",", ".")
        : normalised.replace(/,/g, "");
  } else if (lastComma !== -1) {
    const decimals = normalised.length - lastComma - 1;
    canonical = decimals > 0 && decimals <= 2 ? normalised.replace(",", ".") : normalised.replace(/,/g, "");
  }

  const parsed = Number.parseFloat(canonical);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ------------------------------------------------------------------ */
/*  Атрибуты и теги                                                    */
/* ------------------------------------------------------------------ */

/** Значение атрибута из строки тега. Поддерживает одинарные и двойные кавычки. */
export function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = re.exec(tag);
  if (!match) return null;
  return decodeHtmlEntities(match[2] ?? match[3] ?? "");
}

export type MetaTag = { key: string; content: string };

/**
 * Все `<meta>` документа. Ключ — `property`, если он есть, иначе `name`
 * (lowercase): так OpenGraph и обычные мета-теги попадают в одно пространство
 * ключей, а поиск остаётся одним обращением к словарю.
 */
export function collectMetaTags(html: string): MetaTag[] {
  const out: MetaTag[] = [];
  const re = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const tag = match[0];
    const content = attr(tag, "content");
    if (content === null || !content.trim()) continue;
    const key = attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop");
    if (!key) continue;
    out.push({ key: key.trim().toLowerCase(), content: content.trim() });
  }

  return out;
}

/** Первое непустое значение тега по ключу. */
export function metaContent(tags: readonly MetaTag[], key: string): string | null {
  const needle = key.toLowerCase();
  for (const tag of tags) {
    if (tag.key === needle && tag.content.trim()) return tag.content.trim();
  }
  return null;
}

/** Заголовок документа без сущностей и пробельных «хвостов». */
export function extractHtmlTitle(html: string): string | null {
  const head = html.slice(0, 200_000);
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (!match) return null;
  return cleanValue(match[1], 400);
}

export type JsonLdScript = { raw: string; index: number };

/** Содержимое всех `<script type="application/ld+json">` в порядке появления. */
export function collectJsonLdScripts(html: string): JsonLdScript[] {
  const out: JsonLdScript[] = [];
  const re =
    /<script\b[^>]*type\s*=\s*("application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    out.push({ raw: match[2] ?? "", index: out.length });
  }

  return out;
}
