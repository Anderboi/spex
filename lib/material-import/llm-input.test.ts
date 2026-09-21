import { describe, expect, it } from "vitest";
import {
  buildPageTextBlock,
  PAGE_TEXT_MAX_CHARS,
  reduceHtmlForLlm,
  serializeStructuredHints,
} from "./llm-input";

describe("reduceHtmlForLlm", () => {
  it("вырезает скрипты и стили вместе с содержимым", () => {
    const html = `<div>Керамогранит</div>
      <script>var price = 1; trackPageView();</script>
      <style>.x { color: red }</style>`;
    const text = reduceHtmlForLlm(html);

    expect(text).toContain("Керамогранит");
    expect(text).not.toContain("trackPageView");
    expect(text).not.toContain("color: red");
  });

  it("вырезает меню, подвал и cookie-плашки", () => {
    const html = `
      <nav class="main-nav"><a href="/">Главная</a></nav>
      <div id="cookie-consent">Мы используем cookie</div>
      <div class="newsletter-subscribe">Подпишитесь на рассылку</div>
      <div class="breadcrumbs">Главная / Плитка / Керамогранит</div>
      <footer>© 2026 Магазин</footer>
      <section class="product-specs">Формат: 120×278</section>`;
    const text = reduceHtmlForLlm(html);

    expect(text).toContain("Формат: 120×278");
    expect(text).not.toContain("Мы используем cookie");
    expect(text).not.toContain("Подпишитесь на рассылку");
    expect(text).not.toContain("© 2026 Магазин");
    expect(text).not.toContain("Главная");
  });

  it("вырезает рекомендованные товары и отзывы", () => {
    const html = `
      <div class="related-products">Вам может понравиться</div>
      <div class="reviews">Отличный товар, 5 звёзд</div>
      <div class="product-description">Крупноформатный керамогранит</div>`;
    const text = reduceHtmlForLlm(html);

    expect(text).toContain("Крупноформатный керамогранит");
    expect(text).not.toContain("Вам может понравиться");
    expect(text).not.toContain("5 звёзд");
  });

  it("сохраняет характеристики построчно", () => {
    const html = `
      <table>
        <tr><td>Материал</td><td>Латунь</td></tr>
        <tr><td>Покрытие</td><td>Хром</td></tr>
      </table>`;
    const lines = reduceHtmlForLlm(html).split("\n");
    expect(lines).toContain("Материал");
    expect(lines).toContain("Латунь");
    expect(lines).toContain("Покрытие");
    expect(lines).toContain("Хром");
  });

  it("раскрывает основные HTML-сущности", () => {
    expect(reduceHtmlForLlm("<p>Дуб &amp; Орех</p>")).toContain("Дуб & Орех");
    expect(reduceHtmlForLlm("<p>120&#215;278</p>")).toContain("120×278");
  });

  it("убирает повторяющиеся строки вёрстки", () => {
    const html = `<p>Артикул: KM-1</p><p>Артикул: KM-1</p><p>Артикул: KM-1</p>`;
    const occurrences = reduceHtmlForLlm(html).split("\n").filter((l) => l === "Артикул: KM-1");
    expect(occurrences).toHaveLength(1);
  });

  it("значительно сокращает объём страницы", () => {
    const html = `<html><head><style>${".a{color:red}".repeat(500)}</style>
      <script>${"var x=1;".repeat(500)}</script></head>
      <body><h1>Товар</h1><p>Описание</p></body></html>`;

    expect(reduceHtmlForLlm(html).length).toBeLessThan(html.length / 10);
  });

  it("не исполняет и не разбирает содержимое как код", () => {
    // Разметка внутри текста остаётся текстом.
    const html = `<p>Инструкция: &lt;script&gt;alert(1)&lt;/script&gt;</p>`;
    const text = reduceHtmlForLlm(html);
    expect(text).toContain("Инструкция");
  });
});

describe("buildPageTextBlock", () => {
  it("не превышает лимит и обрезает по границе строки", () => {
    const html = Array.from({ length: 5_000 }, (_, i) => `<p>Строка ${i}</p>`).join("");
    const block = buildPageTextBlock(html, 500);

    expect(block.length).toBeLessThanOrEqual(500);
    // Последняя строка не обрублена посередине.
    const lastLine = block.split("\n").at(-1) ?? "";
    expect(lastLine).toMatch(/^Строка \d+$/);
  });

  it("использует лимит по умолчанию", () => {
    const html = `<p>${"x".repeat(PAGE_TEXT_MAX_CHARS * 3)}</p>`;
    expect(buildPageTextBlock(html).length).toBeLessThanOrEqual(PAGE_TEXT_MAX_CHARS);
  });

  it("короткую страницу отдаёт целиком", () => {
    expect(buildPageTextBlock("<p>Товар</p>", 500)).toBe("Товар");
  });
});

describe("serializeStructuredHints", () => {
  it("не включает пустые поля", () => {
    const json = serializeStructuredHints({
      name: "Товар",
      brand: null,
      article: null,
      price: null,
      attributes: {},
      variants: [],
    });

    expect(json).toContain('"name": "Товар"');
    expect(json).not.toContain("brand");
    expect(json).not.toContain("article");
    expect(json).not.toContain("attributes");
    expect(json).not.toContain("variants");
  });

  it("включает характеристики и варианты, когда они есть", () => {
    const json = serializeStructuredHints({
      name: "Товар",
      attributes: { Формат: "120×278" },
      variants: [
        {
          sku: "143834",
          name: "Kanna Brushed",
          label: "Дуб · 13 мм",
          attributes: { Толщина: "13 мм" },
          price: 12900,
          currency: "RUB",
        },
      ],
    });

    expect(json).toContain("Формат");
    expect(json).toContain("143834");
    expect(json).toContain("Дуб · 13 мм");
    expect(json).toContain("12900");
  });

  it("всегда остаётся валидным JSON", () => {
    const json = serializeStructuredHints({ name: 'Товар "кавычки"' });
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
