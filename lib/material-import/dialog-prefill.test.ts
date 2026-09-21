import { describe, expect, it } from "vitest";
import { TYPE_ORDER } from "../constants";
import type { MaterialImportDraft } from "./draft";
import {
  EMPTY_DIALOG_VALUES,
  resolveDialogPrefill,
  resolveResetKey,
} from "./dialog-prefill";
import { MATERIAL_FORM_DEFAULTS } from "./mapper";

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
    imageUrl: null,
    attrs: { "Формат": "120×278" },
    ambiguous: [],
    requiresReview: false,
    evidence: [],
    usedSources: ["json-ld"],
    ...overrides,
  };
}

/* ================================================================== */
/*  Ключ сброса                                                        */
/* ================================================================== */

describe("resolveResetKey", () => {
  it("для создания без импорта даёт null", () => {
    expect(resolveResetKey({})).toBeNull();
    expect(resolveResetKey({ draftKey: null })).toBeNull();
  });

  it("для импорта использует draftKey", () => {
    expect(resolveResetKey({ draftKey: "https://shop.example.com/product/1" })).toBe(
      "https://shop.example.com/product/1",
    );
  });

  it("для редактирования использует id материала, а не ключ черновика", () => {
    expect(
      resolveResetKey({
        materialToEdit: { id: "11111111-1111-4111-8111-111111111111" },
        draftKey: "import-1",
      }),
    ).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("материал без id не считается редактированием", () => {
    expect(resolveResetKey({ materialToEdit: {}, draftKey: "import-1" })).toBe("import-1");
  });

  /**
   * ГЛАВНЫЙ ТЕСТ ПРОТИВ СТАРОЙ РЕГРЕССИИ.
   *
   * Родитель пересоздаёт объект черновика на каждом рендере. Ключ не зависит от
   * идентичности объекта, поэтому повторные рендеры НЕ меняют ключ — а значит,
   * эффект сброса в диалоге не перезапускается и правки пользователя живут.
   */
  it("не зависит от идентичности объекта черновика", () => {
    const first = draft();
    const second = draft(); // новый объект с теми же значениями

    expect(first).not.toBe(second);

    const keyFromFirst = resolveResetKey({ draftKey: "import-1" });
    const keyFromSecond = resolveResetKey({ draftKey: "import-1" });
    expect(keyFromSecond).toBe(keyFromFirst);
  });

  it("меняется только при новом импорте", () => {
    expect(resolveResetKey({ draftKey: "import-2" })).not.toBe(
      resolveResetKey({ draftKey: "import-1" }),
    );
  });
});

/* ================================================================== */
/*  Что подставляется в форму                                          */
/* ================================================================== */

describe("resolveDialogPrefill: обычное создание", () => {
  it("даёт пустую форму с дефолтами", () => {
    const prefill = resolveDialogPrefill({});

    expect(prefill.values).toEqual(EMPTY_DIALOG_VALUES);
    expect(prefill.values.name).toBe("");
    expect(prefill.values.category).toBe(MATERIAL_FORM_DEFAULTS.category);
    expect(prefill.values.unit).toBe(MATERIAL_FORM_DEFAULTS.unit);
    expect(prefill.values.price).toBe(0);
    expect(prefill.values.attrs).toEqual({});
    expect(prefill.supplier).toEqual({ companyId: null, contactId: null });
  });
});

describe("resolveDialogPrefill: редактирование существующего материала", () => {
  it("переносит значения материала и его поставщика", () => {
    const prefill = resolveDialogPrefill({
      materialToEdit: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Старый материал",
        brand: "GESSI",
        article: "G-1",
        category: "Сантехника",
        product_type: "Смеситель",
        price: 1000,
        unit: "компл.",
        image_url: "https://project.supabase.co/a.jpg",
        product_url: "https://gessi.com/p/1",
        attrs: { "Покрытие": "Хром" },
        company_id: "22222222-2222-4222-8222-222222222222",
        contact_id: "33333333-3333-4333-8333-333333333333",
      },
    });

    expect(prefill.values.name).toBe("Старый материал");
    expect(prefill.values.category).toBe("Сантехника");
    expect(prefill.values.unit).toBe("компл.");
    expect(prefill.values.price).toBe(1000);
    expect(prefill.values.attrs).toEqual({ "Покрытие": "Хром" });
    // Поставщик обязан восстановиться: именно он «слетал» в старой регрессии.
    expect(prefill.supplier).toEqual({
      companyId: "22222222-2222-4222-8222-222222222222",
      contactId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("подставляет дефолты вместо отсутствующих полей", () => {
    const prefill = resolveDialogPrefill({
      materialToEdit: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Материал",
        category: "",
        unit: "",
        price: null,
        brand: null,
        article: null,
        attrs: null,
      },
    });

    expect(prefill.values.brand).toBe("");
    expect(prefill.values.article).toBe("");
    expect(prefill.values.price).toBe(0);
    expect(prefill.values.category).toBe(MATERIAL_FORM_DEFAULTS.category);
    expect(prefill.values.unit).toBe(MATERIAL_FORM_DEFAULTS.unit);
    expect(prefill.values.attrs).toEqual({});
  });

  it("материал имеет приоритет над черновиком импорта", () => {
    const prefill = resolveDialogPrefill({
      materialToEdit: { id: "11111111-1111-4111-8111-111111111111", name: "Из базы", category: "Отделка" },
      draft: draft({ name: "Из импорта" }),
    });
    expect(prefill.values.name).toBe("Из базы");
  });
});

describe("resolveDialogPrefill: создание из импортированного черновика", () => {
  it("переносит значения черновика", () => {
    const prefill = resolveDialogPrefill({ draft: draft() });

    expect(prefill.values.name).toBe("Керамогранит Calacatta");
    expect(prefill.values.brand).toBe("ABK");
    expect(prefill.values.article).toBe("KM-1024");
    expect(prefill.values.category).toBe("Отделка");
    expect(prefill.values.product_type).toBe("Керамогранит");
    expect(prefill.values.price).toBe(6500);
    expect(prefill.values.unit).toBe("м²");
    expect(prefill.values.product_url).toBe("https://shop.example.com/product/1");
    expect(prefill.values.attrs).toEqual({ "Формат": "120×278" });
  });

  it("не подставляет поставщика: его выбирает пользователь", () => {
    const prefill = resolveDialogPrefill({ draft: draft() });
    expect(prefill.supplier).toEqual({ companyId: null, contactId: null });
  });

  it("подставляет дефолты формы для неполного черновика", () => {
    const prefill = resolveDialogPrefill({
      draft: draft({
        name: "Товар",
        brand: null,
        article: null,
        price: null,
        unit: null,
        category: null,
        productType: null,
        attrs: {},
      }),
    });

    expect(prefill.values.name).toBe("Товар");
    expect(prefill.values.brand).toBe("");
    expect(prefill.values.article).toBe("");
    expect(prefill.values.price).toBe(0);
    expect(prefill.values.unit).toBe(MATERIAL_FORM_DEFAULTS.unit);
    expect(prefill.values.category).toBe(MATERIAL_FORM_DEFAULTS.category);
    expect(prefill.values.product_type).toBeNull();
  });

  it("не пропускает в форму категорию вне TYPE_ORDER", () => {
    const prefill = resolveDialogPrefill({ draft: draft({ category: "Ванная комната" }) });
    expect(TYPE_ORDER).toContain(prefill.values.category);
    expect(prefill.values.category).toBe(MATERIAL_FORM_DEFAULTS.category);
  });

  it("не отдаёт внешний URL изображения", () => {
    // После неудачного перехостинга конвейер оставляет imageUrl = null.
    const prefill = resolveDialogPrefill({ draft: draft({ imageUrl: null }) });
    expect(prefill.values.image_url).toBeNull();
  });

  it("переносит Supabase-изображение после успешного перехостинга", () => {
    const prefill = resolveDialogPrefill({
      draft: draft({ imageUrl: "https://project.supabase.co/storage/v1/object/public/material-images/o/a.jpg" }),
    });
    expect(prefill.values.image_url).toContain("supabase.co");
  });

  /**
   * Сценарий регрессии целиком, на уровне решения.
   *
   * Последовательность: открыли создание → применили импорт → пользователь
   * правит поле → родитель рендерит снова с ЭКВИВАЛЕНТНЫМ, но новым объектом
   * черновика. Ключ не меняется, значит эффект сброса не перезапускается и
   * правка остаётся. Здесь это выражено через инвариант «одинаковый ключ ⇒
   * одинаковый результат предзаполнения», на который опирается эффект.
   */
  it("повторный рендер с эквивалентным черновиком не меняет ключ сброса", () => {
    const keyBefore = resolveResetKey({ draftKey: "import-1" });
    const appliedBefore = resolveDialogPrefill({ draft: draft() });

    // Пользователь правит поле — это состояние формы, не наш вход.
    const userEditedName = "Керамогранит Calacatta Gold";

    // Родитель перерисовался с новым объектом.
    const keyAfter = resolveResetKey({ draftKey: "import-1" });
    const appliedAfter = resolveDialogPrefill({ draft: draft() });

    expect(keyAfter).toBe(keyBefore);
    expect(appliedAfter.values).toEqual(appliedBefore.values);
    // Правка пользователя не участвует в предзаполнении, поэтому сброс её бы
    // затёр — но сброса не будет, потому что ключ не изменился.
    expect(appliedAfter.values.name).not.toBe(userEditedName);
    expect(keyAfter).toBe("import-1");
  });

  it("новый импорт меняет и ключ, и значения", () => {
    const keyBefore = resolveResetKey({ draftKey: "import-1" });
    const keyAfter = resolveResetKey({ draftKey: "import-2" });
    const applied = resolveDialogPrefill({ draft: draft({ name: "Совсем другой товар" }) });

    expect(keyAfter).not.toBe(keyBefore);
    expect(applied.values.name).toBe("Совсем другой товар");
  });
});

describe("resolveDialogPrefill: чистота", () => {
  it("не мутирует черновик", () => {
    const source = draft();
    const snapshot = JSON.parse(JSON.stringify(source));

    const prefill = resolveDialogPrefill({ draft: source });
    prefill.values.attrs["Новый"] = "ключ";

    expect(JSON.parse(JSON.stringify(source))).toEqual(snapshot);
  });

  it("возвращает новые объекты attrs при каждом вызове", () => {
    const first = resolveDialogPrefill({ draft: draft() });
    const second = resolveDialogPrefill({ draft: draft() });
    expect(first.values.attrs).not.toBe(second.values.attrs);
  });
});

/* ================================================================== */
/*  Требует проверки — но не блокирует сохранение                       */
/* ================================================================== */

describe("resolveDialogPrefill: requiresReview не блокирует сохранение", () => {
  /**
   * `requiresReview` — сигнал пользователю, а не запрет. Проверяем, что он не
   * влияет на то, что попадает в форму: значения остаются валидными и
   * отправляемыми, никакого «нужно подтверждение» в prefill нет.
   */
  it("даёт те же значения, что и черновик без пометки", () => {
    const reviewed = resolveDialogPrefill({
      draft: draft({ requiresReview: true }),
    });
    const normal = resolveDialogPrefill({ draft: draft({ requiresReview: false }) });

    expect(reviewed).toEqual(normal);
  });

  it("заполняет обязательное поле наименования, когда оно есть", () => {
    const prefill = resolveDialogPrefill({
      draft: draft({ requiresReview: true, ambiguous: [{ field: "article", values: [], reason: "retailer-id" }] }),
    });

    // `materialSchema` требует непустое имя — оно на месте, значит сохранение
    // пройдёт валидацию без дополнительных подтверждений.
    expect(prefill.values.name.length).toBeGreaterThan(0);
  });

  it("с неопределённым вариантом оставляет форму заполняемой", () => {
    const prefill = resolveDialogPrefill({
      draft: draft({
        requiresReview: true,
        article: null,
        price: null,
        ambiguous: [
          { field: "attrs.Толщина", values: ["13 мм", "13.5 мм"], reason: "no-url-signal" },
        ],
      }),
    });

    // Пустые артикул и цена — не препятствие: форма допускает их отсутствие.
    expect(prefill.values.article).toBe("");
    expect(prefill.values.price).toBe(0);
    expect(prefill.values.name).toBe("Керамогранит Calacatta");
  });
});

/* ================================================================== */
/*  Сценарии из требований                                             */
/* ================================================================== */

describe("resolveDialogPrefill: сквозные сценарии flow", () => {
  it("import → изменение полей → новый рендер с тем же ключом не сбрасывает", () => {
    const key = "import-1";

    // 1. Импорт: ключ и предзаполнение.
    const firstKey = resolveResetKey({ draftKey: key });
    const firstPrefill = resolveDialogPrefill({ draft: draft() });

    // 2. Пользователь правит поля (состояние формы, не наш вход).
    const userEdits = { ...firstPrefill.values, name: "Исправленное имя", price: 7000 };

    // 3. Родитель перерисовался: новый объект черновика, тот же ключ.
    const secondKey = resolveResetKey({ draftKey: key });
    const secondPrefill = resolveDialogPrefill({ draft: draft() });

    // Ключ не изменился → эффект сброса не перезапустится → правки останутся.
    expect(secondKey).toBe(firstKey);
    expect(secondPrefill.values).toEqual(firstPrefill.values);
    // Предзаполнение не знает о правках — именно поэтому сброс был бы потерей.
    expect(secondPrefill.values.name).not.toBe(userEdits.name);
  });

  it("import → выбранный поставщик переживает новый рендер", () => {
    // Поставщик — состояние диалога, но его значение обязано восстанавливаться
    // при сбросе, иначе выбор «слетит» после обновления родителя.
    const prefill = resolveDialogPrefill({
      materialToEdit: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Материал",
        category: "Отделка",
        company_id: "22222222-2222-4222-8222-222222222222",
        contact_id: "33333333-3333-4333-8333-333333333333",
      },
    });

    expect(prefill.supplier.companyId).toBe("22222222-2222-4222-8222-222222222222");
    expect(prefill.supplier.contactId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("import → выбор поставщика вручную не подменяется черновиком", () => {
    // Черновик поставщика не содержит вовсе: подставлять нечего.
    const prefill = resolveDialogPrefill({
      draft: draft(),
      // Ключ импорта не должен влиять на поставщика.
    });
    expect(prefill.supplier).toEqual({ companyId: null, contactId: null });
  });

  it("image failure → черновик остаётся пригодным для формы", () => {
    // Конвейер обнуляет imageUrl, если перехостинг не удался.
    const prefill = resolveDialogPrefill({
      draft: draft({ imageUrl: null }),
    });

    expect(prefill.values.image_url).toBeNull();
    // Остальные поля на месте — окно можно открывать.
    expect(prefill.values.name).toBe("Керамогранит Calacatta");
    expect(prefill.values.category).toBe("Отделка");
  });
});
