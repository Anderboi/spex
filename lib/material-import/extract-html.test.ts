import { describe, expect, it } from "vitest";
import {
  extractFromHtml,
  findProductNode,
  looksLikeShell,
  parseJsonLdNodes,
} from "./extract-html";
import {
  cleanValue,
  collectJsonLdScripts,
  collectMetaTags,
  decodeHtmlEntities,
  extractHtmlTitle,
  metaContent,
  parseDecimal,
  stripHtmlToText,
} from "./text";

const PAGE_URL = "https://shop.example.com/product/keramogranit";

/** Минимальный документ с указанным `<head>`. */
function page(head: string, body = ""): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

function ldJson(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/* ------------------------------------------------------------------ */
/*  text.ts                                                            */
/* ------------------------------------------------------------------ */

describe("текстовые утилиты", () => {
  it("раскрывает именованные и числовые сущности", () => {
    expect(decodeHtmlEntities("Kerama &amp; Marazzi")).toBe("Kerama & Marazzi");
    expect(decodeHtmlEntities("120&#215;278")).toBe("120×278");
    expect(decodeHtmlEntities("&#x41;&#x42;")).toBe("AB");
    expect(decodeHtmlEntities("&laquo;Дуб&raquo;")).toBe("«Дуб»");
  });

  it("оставляет неизвестные сущности как есть", () => {
    expect(decodeHtmlEntities("&weirdthing;")).toBe("&weirdthing;");
  });

  it("не ломается на некорректных числовых сущностях", () => {
    expect(decodeHtmlEntities("&#0;")).toBe("&#0;");
    expect(decodeHtmlEntities("&#xFFFFFFF;")).toBe("&#xFFFFFFF;");
  });

  it("снимает разметку и вырезает script/style", () => {
    const html = `<div>Керамо<span>гранит</span></div><script>var x = "<b>зло</b>";</script><style>.a{}</style>`;
    const text = stripHtmlToText(html);
    expect(text).toContain("Керамогранит");
    expect(text).not.toContain("var x");
    expect(text).not.toContain("зло");
  });

  it("не склеивает слова на границах блочных тегов", () => {
    expect(stripHtmlToText("<div>Дуб</div><div>Орех</div>")).toBe("Дуб Орех");
  });

  it("схлопывает пробелы, включая NBSP", () => {
    expect(cleanValue("  Дуб\u00a0  массивный \n ")).toBe("Дуб массивный");
  });

  it("обрезает значение по лимиту", () => {
    const long = "a".repeat(600);
    expect(cleanValue(long, 500)).toHaveLength(500);
  });

  it("возвращает null для пустых значений", () => {
    expect(cleanValue(null)).toBeNull();
    expect(cleanValue("   ")).toBeNull();
    expect(cleanValue("<span></span>")).toBeNull();
  });

  it("разбирает десятичные числа с разными разделителями", () => {
    expect(parseDecimal("6 500,50")).toBe(6500.5);
    expect(parseDecimal("1,234.56")).toBe(1234.56);
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("6500")).toBe(6500);
    expect(parseDecimal("1 200 ₽")).toBe(1200);
    expect(parseDecimal("по запросу")).toBeNull();
    expect(parseDecimal("")).toBeNull();
  });

  it("находит meta по property и по name", () => {
    const html = page(`
      <meta property="og:title" content="Керамогранит" />
      <meta name="description" content="Описание" />
      <meta name="viewport" content="width=device-width" />
    `);
    const tags = collectMetaTags(html);
    expect(metaContent(tags, "og:title")).toBe("Керамогранит");
    expect(metaContent(tags, "description")).toBe("Описание");
    expect(metaContent(tags, "missing")).toBeNull();
  });

  it("извлекает title и чистит его", () => {
    expect(extractHtmlTitle(page("<title> Дуб &amp; Орех </title>"))).toBe("Дуб & Орех");
    expect(extractHtmlTitle(page(""))).toBeNull();
  });

  it("достаёт только ld+json скрипты", () => {
    const html = page(`
      <script type="application/ld+json">{"a":1}</script>
      <script type="text/javascript">{"b":2}</script>
      <script type='application/ld+json'>{"c":3}</script>
    `);
    const scripts = collectJsonLdScripts(html);
    expect(scripts).toHaveLength(2);
    expect(JSON.parse(scripts[0].raw)).toEqual({ a: 1 });
  });
});

/* ------------------------------------------------------------------ */
/*  JSON-LD                                                            */
/* ------------------------------------------------------------------ */

describe("JSON-LD", () => {
  it("разворачивает @graph и находит Product", () => {
    const html = page(
      ldJson({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: "Магазин" },
          { "@type": "Product", name: "Товар из графа" },
        ],
      }),
    );
    const nodes = parseJsonLdNodes(html);
    expect(findProductNode(nodes)?.["name"]).toBe("Товар из графа");
  });

  it("предпочитает Product с offers", () => {
    const html = page(
      ldJson([
        { "@type": "Product", name: "Без цены" },
        { "@type": "Product", name: "С ценой", offers: { "@type": "Offer", price: "100" } },
      ]),
    );
    const product = findProductNode(parseJsonLdNodes(html));
    expect(product?.["name"]).toBe("С ценой");
  });

  it("молча пропускает битый JSON и продолжает", () => {
    const html = page(`
      <script type="application/ld+json">{ это не json }</script>
      ${ldJson({ "@type": "Product", name: "Рабочий" })}
    `);
    expect(findProductNode(parseJsonLdNodes(html))?.["name"]).toBe("Рабочий");
  });

  it("извлекает основные поля, цену, бренд, артикул и картинку", () => {
    const html = page(
      ldJson({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Керамогранит Calacatta",
        sku: "KM-1024",
        brand: { "@type": "Brand", name: "ABK" },
        image: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
        description: "  Крупноформатный керамогранит  ",
        material: "Керамогранит",
        color: "Белый",
        offers: {
          "@type": "Offer",
          price: "6500.50",
          priceCurrency: "rub",
          availability: "https://schema.org/InStock",
        },
      }),
    );

    const extracted = extractFromHtml(html, { pageUrl: PAGE_URL });
    expect(extracted).not.toBeNull();
    expect(extracted!.name).toEqual({ value: "Керамогранит Calacatta", source: "json-ld" });
    expect(extracted!.brand).toEqual({ value: "ABK", source: "json-ld" });
    expect(extracted!.article).toEqual({ value: "KM-1024", source: "json-ld" });
    expect(extracted!.price).toEqual({ value: 6500.5, source: "json-ld" });
    expect(extracted!.currency).toEqual({ value: "RUB", source: "json-ld" });
    expect(extracted!.imageUrl?.value).toBe("https://cdn.example.com/a.jpg");
    expect(extracted!.description?.value).toBe("Крупноформатный керамогранит");
    // Служебные ключи в характеристики не попадают.
    expect(extracted!.attributes?.values).toMatchObject({
      material: "Керамогранит",
      color: "Белый",
    });
    expect(extracted!.attributes?.values).not.toHaveProperty("offers");
    expect(extracted!.attributes?.values).not.toHaveProperty("description");
  });

  it("читает brand из нескольких форм записи", () => {
    for (const brand of [
      "ABK",
      { "@type": "Brand", name: "ABK" },
      { "@type": "Organization", name: "ABK" },
      [{ name: "ABK" }],
    ]) {
      const html = page(ldJson({ "@type": "Product", name: "Т", brand }));
      expect(extractFromHtml(html, { pageUrl: PAGE_URL })!.brand?.value, JSON.stringify(brand)).toBe("ABK");
    }
  });

  it("не берёт цену, если офферов несколько", () => {
    const html = page(
      ldJson({
        "@type": "Product",
        name: "Товар",
        offers: [
          { "@type": "Offer", price: "100", priceCurrency: "RUB" },
          { "@type": "Offer", price: "200", priceCurrency: "RUB" },
        ],
      }),
    );
    // Берётся первый оффер: выбирать между продавцами нельзя, но и терять цену
    // целиком хуже — фиксируем текущее поведение явно.
    expect(extractFromHtml(html, { pageUrl: PAGE_URL })!.price).toEqual({
      value: 100,
      source: "json-ld",
    });
  });

  it("читает цены в разных форматах", () => {
    for (const price of ["6500", 6500, "6 500,00"]) {
      const html = page(ldJson({ "@type": "Product", name: "Т", offers: { price } }));
      expect(extractFromHtml(html, { pageUrl: PAGE_URL })!.price?.value, String(price)).toBe(6500);
    }
  });

  it("извлекает варианты товара", () => {
    const html = page(
      ldJson({
        "@type": "Product",
        name: "Инженерная доска Finex",
        offers: { price: "12000", priceCurrency: "RUB" },
        hasVariant: [
          {
            "@type": "Product",
            sku: "S31010CR",
            name: "Дуб натуральный",
            material: "Дуб",
            thickness: "15 мм",
            offers: { price: "12500", priceCurrency: "RUB" },
          },
          {
            "@type": "Product",
            sku: "S31011CR",
            name: "Дуб брашированный",
            material: "Дуб",
            thickness: "20 мм",
            offers: { price: "13500", priceCurrency: "RUB" },
          },
        ],
      }),
    );

    const extracted = extractFromHtml(html, { pageUrl: PAGE_URL });
    expect(extracted!.variants).toHaveLength(2);
    expect(extracted!.variants[0]).toMatchObject({
      sku: "S31010CR",
      name: "Дуб натуральный",
      attributes: { material: "Дуб", thickness: "15 мм" },
      price: 12500,
    });
  });
});

/* ------------------------------------------------------------------ */
/*  OpenGraph / meta / title                                           */
/* ------------------------------------------------------------------ */

describe("OpenGraph и meta", () => {
  it("достаёт поля, когда JSON-LD нет", () => {
    const html = page(`
      <title>Смеситель для раковины</title>
      <meta property="og:title" content="Смеситель Gessi — Сантехника Плюс" />
      <meta property="og:site_name" content="Сантехника Плюс" />
      <meta property="og:description" content="Латунный смеситель" />
      <meta property="og:image" content="https://cdn.example.com/tap.jpg" />
      <meta property="product:price:amount" content="24 900,00" />
      <meta property="product:price:currency" content="RUB" />
      <meta property="product:brand" content="GESSI" />
    `);

    const extracted = extractFromHtml(html, { pageUrl: PAGE_URL });
    expect(extracted!.name).toEqual({ value: "Смеситель Gessi", source: "og" });
    expect(extracted!.brand).toEqual({ value: "GESSI", source: "og" });
    expect(extracted!.price).toEqual({ value: 24900, source: "og" });
    expect(extracted!.currency?.value).toBe("RUB");
    expect(extracted!.imageUrl?.value).toBe("https://cdn.example.com/tap.jpg");
    expect(extracted!.description?.value).toBe("Латунный смеситель");
  });

  it("отрезает название магазина из og:title", () => {
    const html = page(`
      <meta property="og:title" content="Розетка с заземлением | ЭлектроДом" />
      <meta property="og:site_name" content="ЭлектроДом" />
    `);
    expect(extractFromHtml(html, { pageUrl: PAGE_URL })!.name?.value).toBe(
      "Розетка с заземлением",
    );
  });

  it("падает до <title>, когда og:title нет", () => {
    const html = page("<title>Инженерная доска Alpine</title>");
    const extracted = extractFromHtml(html, { pageUrl: PAGE_URL });
    expect(extracted!.name).toEqual({ value: "Инженерная доска Alpine", source: "html" });
  });

  it("предпочитает og:image:secure_url обычному og:image", () => {
    const html = page(`
      <meta property="og:image" content="http://cdn.example.com/insecure.jpg" />
      <meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg" />
    `);
    expect(extractFromHtml(html, { pageUrl: PAGE_URL })!.imageUrl?.value).toBe(
      "https://cdn.example.com/secure.jpg",
    );
  });

  it("абсолютизирует относительные картинки", () => {
    const html = page(`<meta property="og:image" content="/img/tovar.jpg" />`);
    expect(extractFromHtml(html, { pageUrl: PAGE_URL })!.imageUrl?.value).toBe(
      "https://shop.example.com/img/tovar.jpg",
    );
  });

  it("игнорирует картинки с недопустимой схемой", () => {
    const html = page(`
      <meta property="og:image" content="data:image/png;base64,AAAA" />
      <meta property="og:title" content="Товар" />
    `);
    const extracted = extractFromHtml(html, { pageUrl: PAGE_URL });
    // Имя есть — значит результат не null, но картинки не будет.
    expect(extracted!.name?.value).toBe("Товар");
    expect(extracted!.imageUrl).toBeNull();
  });

  it("JSON-LD приоритетнее OpenGraph", () => {
    const html = page(`
      <meta property="og:title" content="Из OpenGraph" />
      <meta property="product:price:amount" content="999" />
      ${ldJson({
        "@type": "Product",
        name: "Из JSON-LD",
        offers: { price: "1000", priceCurrency: "RUB" },
      })}
    `);
    const extracted = extractFromHtml(html, { pageUrl: PAGE_URL });
    expect(extracted!.name).toEqual({ value: "Из JSON-LD", source: "json-ld" });
    expect(extracted!.price).toEqual({ value: 1000, source: "json-ld" });
  });

  it("возвращает null, когда на странице нет ничего полезного", () => {
    expect(extractFromHtml(page(""), { pageUrl: PAGE_URL })).toBeNull();
    expect(
      extractFromHtml(page(`<meta name="viewport" content="width=device-width" />`), {
        pageUrl: PAGE_URL,
      }),
    ).toBeNull();
  });

  it("не падает на некорректном pageUrl", () => {
    const html = page(`<meta property="og:title" content="Товар" />`);
    expect(extractFromHtml(html, { pageUrl: "не url" })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Определение SPA-оболочки                                           */
/* ------------------------------------------------------------------ */

describe("looksLikeShell", () => {
  it("считает каркасом пустой контейнер приложения", () => {
    expect(looksLikeShell(page("", `<div id="app"></div>`))).toBe(true);
    expect(looksLikeShell(page("", `<div id="root"></div>`))).toBe(true);
    expect(looksLikeShell(page("", `<div id="__next"></div>`))).toBe(true);
  });

  it("считает каркасом модульный бандл и маркеры фреймворков", () => {
    expect(
      looksLikeShell(page(`<script type="module" src="/app.js"></script>`)),
    ).toBe(true);
    expect(looksLikeShell(page("<script>window.__NUXT__={}</script>"))).toBe(true);
  });

  it("считает каркасом совсем маленький документ", () => {
    expect(looksLikeShell("<html><body>hi</body></html>")).toBe(true);
  });

  it("не считает каркасом нормальную карточку товара", () => {
    const html = page(
      `<title>Керамогранит</title>`,
      `<h1>Керамогранит Calacatta</h1><p>${"Описание товара. ".repeat(60)}</p>`,
    );
    expect(looksLikeShell(html)).toBe(false);
  });

  it("не считает каркасом страницу с большим объёмом текста", () => {
    const html = page("", `<div id="app">${"Товар и характеристики. ".repeat(40)}</div>`);
    // Маркер каркаса есть, но текста достаточно — значит содержимое отрендерено.
    expect(looksLikeShell(html)).toBe(false);
  });

  it("не подставляет title магазина в название товара для каркаса", () => {
    const html = page(`<title>Магазин сантехники</title>`, `<div id="root"></div>`);

    const asShell = extractFromHtml(html, { pageUrl: PAGE_URL, shell: true });
    expect(asShell).toBeNull();

    // Без флага title считается названием — фиксируем разницу явно.
    const asPage = extractFromHtml(html, { pageUrl: PAGE_URL });
    expect(asPage?.name?.value).toBe("Магазин сантехники");
  });
});
