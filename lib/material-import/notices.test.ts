import { describe, expect, it } from "vitest";
import type { MaterialImportDraft } from "./draft";
import {
  buildImportNotices,
  buildImportNoticesFromResult,
  createImportReviewState,
} from "./notices";
import type { MaterialImportResult } from "../../actions/material-import";

function draft(overrides: Partial<MaterialImportDraft> = {}): MaterialImportDraft {
  return {
    sourceUrl: "https://shop.example.com/product/1",
    productUrl: "https://shop.example.com/product/1",
    name: "Керамогранит Calacatta",
    brand: "ABK",
    article: "KM-1024",
    category: "Отделка",
    productType: "Керамогранит",
    price: 6500,
    priceCurrency: "RUB",
    unit: "м²",
    imageUrl: "https://project.supabase.co/storage/v1/object/public/material-images/o/a.jpg",
    attrs: { "Формат": "120×278" },
    ambiguous: [],
    requiresReview: false,
    evidence: [],
    usedSources: ["json-ld"],
    ...overrides,
  };
}

function result(overrides: Partial<MaterialImportResult> = {}): MaterialImportResult {
  return {
    draft: draft(),
    draftKey: "import-11111111-1111-4111-8111-111111111111",
    warnings: [],
    imageRehosted: true,
    layers: { deterministic: true, reader: false, ai: true },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Замечания                                                          */
/* ------------------------------------------------------------------ */

describe("buildImportNotices: чистый черновик", () => {
  it("не показывает ничего, когда проверять нечего", () => {
    expect(buildImportNotices(draft())).toEqual([]);
  });

  it("не считает отсутствие изображения замечанием при успешном перехостинге", () => {
    expect(buildImportNotices(draft({ imageUrl: null }), { imageRehosted: true })).toEqual([]);
  });
});

describe("buildImportNotices: неоднозначности", () => {
  it("объясняет спорное поле человеческим языком", () => {
    const notices = buildImportNotices(
      draft({
        ambiguous: [
          {
            field: "attrs.Толщина",
            values: ["13 мм", "13.5 мм"],
            reason: "no-url-signal",
          },
        ],
      }),
    );

    expect(notices).toHaveLength(1);
    expect(notices[0].tone).toBe("warning");
    // Имя характеристики цитируется в понятной формулировке.
    expect(notices[0].message).toContain("«толщина»");
    // Значения берутся из черновика, а не придумываются.
    expect(notices[0].hint).toContain("13 мм");
    expect(notices[0].hint).toContain("13.5 мм");
    expect(notices[0].hint).toContain("не указывает нужный");
  });

  it("не показывает внутренние коды причин", () => {
    const reasons = ["retailer-id", "variant-specific-ai", "no-url-signal", "multiple-url-matches"];

    for (const reason of reasons) {
      const notices = buildImportNotices(
        draft({ ambiguous: [{ field: "article", values: [], reason }] }),
      );
      const text = notices.map((n) => `${n.message} ${n.hint ?? ""}`).join(" ");
      expect(text, reason).not.toContain(reason);
      expect(text, reason).not.toContain("undefined");
    }
  });

  it("ограничивает перечисление значений и сообщает остаток", () => {
    const notices = buildImportNotices(
      draft({
        ambiguous: [
          {
            field: "attrs.Ширина",
            values: ["140", "160", "180", "200", "220"],
            reason: "multiple-url-matches",
          },
        ],
      }),
    );

    expect(notices[0].hint).toContain("140, 160, 180");
    expect(notices[0].hint).toContain("и ещё 2");
  });

  it("переводит поле артикула в понятное имя", () => {
    const notices = buildImportNotices(
      draft({ ambiguous: [{ field: "article", values: ["686224"], reason: "retailer-id" }] }),
    );
    expect(notices[0].message).toContain("артикул");
    expect(notices[0].hint).toContain("код магазина");
  });

  it("не дублирует одинаковые замечания", () => {
    const notices = buildImportNotices(
      draft({
        ambiguous: [
          { field: "article", values: [], reason: "retailer-id" },
          { field: "article", values: [], reason: "retailer-id" },
        ],
      }),
    );
    expect(notices).toHaveLength(1);
  });
});

describe("buildImportNotices: requiresReview и изображение", () => {
  it("подсказывает проверить данные, когда черновик помечен", () => {
    const notices = buildImportNotices(draft({ requiresReview: true }));
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain("Проверьте данные");
    expect(notices[0].tone).toBe("info");
  });

  it("не дублирует подсказку, когда уже есть спорные поля", () => {
    const notices = buildImportNotices(
      draft({
        requiresReview: true,
        ambiguous: [{ field: "article", values: [], reason: "retailer-id" }],
      }),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain("артикул");
  });

  it("сообщает о неудачном изображении", () => {
    const notices = buildImportNotices(draft({ imageUrl: null }), { imageRehosted: false });
    expect(notices.map((n) => n.message).join(" ")).toContain("Изображение");
  });
});

describe("buildImportNoticesFromResult", () => {
  it("добавляет предупреждения конвейера", () => {
    const notices = buildImportNoticesFromResult(
      result({ warnings: ["Проверьте вручную: артикул."] }),
    );
    expect(notices.map((n) => n.message)).toContain("Проверьте вручную: артикул.");
  });

  it("показывает и предупреждения, и неоднозначности", () => {
    const notices = buildImportNoticesFromResult(
      result({
        warnings: ["Категорию спецификации определить не удалось — выберите её вручную."],
        draft: draft({
          ambiguous: [{ field: "article", values: [], reason: "retailer-id" }],
          imageUrl: null,
        }),
        imageRehosted: false,
      }),
    );

    const text = notices.map((n) => n.message).join(" | ");
    expect(text).toContain("артикул");
    expect(text).toContain("Категорию");
    expect(text).toContain("Изображение");
  });

  it("пропускает пустые и повторяющиеся предупреждения", () => {
    const notices = buildImportNoticesFromResult(
      result({ warnings: ["  ", "Одно и то же", "Одно и то же"] }),
    );
    expect(notices.filter((n) => n.message === "Одно и то же")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Состояние окна проверки                                            */
/* ------------------------------------------------------------------ */

describe("createImportReviewState", () => {
  it("переносит черновик и ключ из результата", () => {
    const source = result();
    const state = createImportReviewState(source);

    expect(state.draft).toBe(source.draft);
    expect(state.draftKey).toBe(source.draftKey);
    expect(state.imageRehosted).toBe(true);
  });

  it("собирает замечания для формы", () => {
    const state = createImportReviewState(
      result({
        draft: draft({
          ambiguous: [{ field: "attrs.Толщина", values: ["13 мм", "13.5 мм"], reason: "no-url-signal" }],
          requiresReview: true,
        }),
      }),
    );
    expect(state.notices.length).toBeGreaterThan(0);
  });

  /**
   * Ключ обязан быть уникальным для каждой попытки импорта: та же ссылка,
   * импортированная повторно после правок, должна сбросить форму заново.
   * Поэтому ключ не может быть URL — он приходит из результата экшена.
   */
  it("не использует URL как ключ", () => {
    const state = createImportReviewState(result());
    expect(state.draftKey).not.toBe(state.draft.productUrl);
    expect(state.draftKey).toMatch(/^import-/);
  });

  it("разные результаты дают разные ключи", () => {
    const first = createImportReviewState(result({ draftKey: "import-a" }));
    const second = createImportReviewState(result({ draftKey: "import-b" }));
    expect(second.draftKey).not.toBe(first.draftKey);
  });

  it("повторный импорт той же ссылки получает новый ключ", () => {
    // Один и тот же URL, но разные результаты импорта.
    const sameUrl = "https://shop.example.com/product/1";
    const first = createImportReviewState(
      result({ draftKey: "import-1", draft: draft({ productUrl: sameUrl }) }),
    );
    const second = createImportReviewState(
      result({ draftKey: "import-2", draft: draft({ productUrl: sameUrl }) }),
    );
    expect(second.draftKey).not.toBe(first.draftKey);
  });
});
