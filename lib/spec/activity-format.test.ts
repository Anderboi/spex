import { describe, expect, it } from "vitest";

import {
  SPEC_ITEM_DETAIL_FIELDS,
  SPEC_VARIANT_PATCH_FIELDS,
  SPEC_ITEM_EVENT_KINDS,
  type SpecItemEventKind,
} from "./history";
import {
  activityInitials,
  activityBatchSize,
  activityFieldLabel,
  formatActivityActor,
  formatActivityBatch,
  formatActivityChanges,
  formatActivityDate,
  formatActivityDateTime,
  formatActivityEvent,
  formatActivityTime,
  formatActivityValue,
} from "./activity-format";
import type {
  HistoryCommentEntry,
  HistoryEventEntry,
  HistoryFieldChange,
} from "./history-types";

/**
 * Тесты форматтера ленты активности.
 *
 * Проверяется именно СМЫСЛ: текст события, значения из payload'а, отсутствующие
 * значения, словарь полей, даты и подпись групповой операции. Разметку
 * (`Marker` / `Message`) тесты не трогают — она в UI-компонентах.
 *
 * Записи собираются литералами: контракт `history-types` — это вход рендерера, и
 * он должен быть проверен без БД и без сервера.
 */

/** Событие с минимальной обвязкой: важна только пара `kind` + `payload`. */
function event<K extends SpecItemEventKind>(
  kind: K,
  payload: Record<string, unknown>,
  extra: Partial<HistoryEventEntry> = {},
): HistoryEventEntry {
  return {
    id: `ev-${kind}`,
    orgId: "org-1",
    specItemId: "item-1",
    createdAt: "2026-09-25T14:03:00.000Z",
    actor: { id: "u-1", name: "Анна Петрова" },
    source: "event",
    kind,
    payload,
    ...extra,
  } as unknown as HistoryEventEntry;
}

/**
 * Пробелы приводятся к обычным.
 *
 * `toLocaleString("ru-RU")` разделяет разряды неразрывным пробелом (U+00A0), а
 * «%» — узким неразрывным. Для читателя это тот же пробел, и проверять в тесте
 * конкретный код символа значило бы фиксировать деталь форматтера ICU вместо
 * смысла.
 */
function plain(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, " ");
}

function comment(
  overrides: Partial<HistoryCommentEntry> = {},
): HistoryCommentEntry {
  return {
    id: "cm-1",
    orgId: "org-1",
    specItemId: "item-1",
    createdAt: "2026-09-25T14:03:00.000Z",
    actor: { id: "u-1", name: "Анна Петрова" },
    source: "comment",
    parentId: null,
    rootId: null,
    body: "Текст комментария",
    editedAt: null,
    deleted: false,
    replyCount: 0,
    ...overrides,
  };
}

describe("formatActivityEvent: все 21 вид события", () => {
  const cases: Array<{
    kind: SpecItemEventKind;
    payload: Record<string, unknown>;
    icon: string;
    title: string;
    name?: string;
    code?: string | null;
  }> = [
    {
      kind: "created",
      payload: { code: "М-01", name: "Диван", type: "Мебель", origin: "library" },
      icon: "created",
      title: "Создано · из библиотеки",
      name: "Диван",
      code: "М-01",
    },
    {
      kind: "filled",
      payload: { code: "М-02", name: "Кресло", origin: "manual" },
      icon: "wand",
      title: "Заполнено · из библиотеки",
      name: "Кресло",
      code: "М-02",
    },
    {
      kind: "cleared",
      payload: { code: "М-03", name: "Стол" },
      icon: "eraser",
      title: "Очищено",
      name: "Стол",
      code: "М-03",
    },
    {
      kind: "removed",
      payload: { code: "М-04", name: "Стул" },
      icon: "trash",
      title: "Удалено",
      name: "Стул",
      code: "М-04",
    },
    {
      kind: "restored",
      payload: { code: "М-05", name: "Полка" },
      icon: "restore",
      title: "Восстановлено",
      name: "Полка",
      code: "М-05",
    },
    {
      kind: "code_changed",
      payload: { from: "М-01", to: "М-07" },
      icon: "hash",
      title: "Марка: М-01 → М-07",
    },
    {
      kind: "status_changed",
      payload: {
        from: "picked",
        to: "approved",
        fromLabel: "Подобрано",
        toLabel: "Согласовано",
      },
      icon: "status",
      title: "Статус: Подобрано → Согласовано",
    },
    {
      kind: "price_changed",
      payload: { from: 12_000, to: 15_500, currency: "RUB" },
      icon: "price",
      title: "Цена: 12 000 ₽ → 15 500 ₽",
    },
    {
      kind: "quantity_changed",
      payload: { from: 1, to: 6, unit: "шт" },
      icon: "quantity",
      title: "Количество: 1 шт → 6 шт",
    },
    {
      kind: "supplier_changed",
      payload: {
        from: {
          company_id: "c-1",
          company_name: "Ромашка",
          contact_id: "k-1",
          contact_name: "Пётр",
        },
        to: {
          company_id: null,
          company_name: "",
          contact_id: null,
          contact_name: null,
        },
      },
      icon: "supplier",
      title: "Поставщик: Ромашка · Пётр → —",
    },
    {
      kind: "details_changed",
      payload: {
        changes: {
          brand: { from: "Cersanit", to: "Finex" },
          name: { from: "Диван", to: "Кресло" },
        },
      },
      icon: "details",
      title: "Изменены параметры",
    },
    {
      kind: "parent_changed",
      payload: {
        from: { spec_item_id: "p-a", code: "М-01", name: "Кухня" },
        to: null,
      },
      icon: "parent",
      title: "Расположение: М-01 · Кухня → —",
    },
    {
      kind: "variant_added",
      payload: {
        variant_id: "v-1",
        label: "Альтернатива",
        base_snapshot_created: true,
      },
      icon: "variantAdd",
      title: "Добавлен вариант",
      name: "Альтернатива",
    },
    {
      kind: "variant_switched",
      payload: {
        from: { variant_id: "v-a", name: "Blanco" },
        to: { variant_id: "v-b", name: "Finex" },
      },
      icon: "variantSwitch",
      title: "Активный вариант: Blanco → Finex",
    },
    {
      kind: "variant_updated",
      payload: {
        variant_id: "v-1",
        changes: {
          price: { from: 1200, to: 1500 },
          name: { from: "Blanco", to: "Finex" },
        },
      },
      icon: "variantEdit",
      title: "Изменён вариант",
    },
    {
      kind: "variant_removed",
      payload: {
        variantId: "v-a",
        name: "Blanco",
        label: "Основной",
        wasActive: true,
        nextActive: { variantId: "v-b", name: "Finex" },
      },
      icon: "variantRemove",
      title: "Удалён вариант · активным стал Finex",
      name: "Blanco",
    },
    {
      kind: "component_added",
      payload: { component_id: "c-1", kind: "component", name: "Корпус", ref: null },
      icon: "componentAdd",
      title: "Добавлено в состав",
      name: "Корпус",
    },
    {
      kind: "component_removed",
      payload: {
        component_id: "c-2",
        kind: "spec_ref",
        name: null,
        ref: { spec_item_id: "item-9", code: "О-03", name: "Духовой шкаф" },
      },
      icon: "componentRemove",
      title: "Удалено из состава",
      name: "О-03 · Духовой шкаф",
    },
    {
      kind: "service_added",
      payload: { service_id: "s-1", type: "delivery", name: null, amount: 5000 },
      icon: "serviceAdd",
      title: "Добавлена услуга",
      name: "Доставка · 5 000 ₽",
    },
    {
      kind: "service_completed",
      payload: { service_id: "s-1", type: "installation", name: null, amount: null },
      icon: "serviceDone",
      title: "Выполнена услуга",
      name: "Монтаж",
    },
    {
      kind: "service_removed",
      payload: { service_id: "s-2", type: "service", name: "Подъём на этаж", amount: null },
      icon: "serviceRemove",
      title: "Удалена услуга",
      name: "Подъём на этаж",
    },
  ];

  it("покрывает ровно все виды из домена (21)", () => {
    expect(cases.map((c) => c.kind).sort()).toEqual(
      [...SPEC_ITEM_EVENT_KINDS].sort(),
    );
    expect(cases).toHaveLength(21);
  });

  for (const testCase of cases) {
    it(`${testCase.kind}: текст и иконка`, () => {
      const presentation = formatActivityEvent(
        event(testCase.kind, testCase.payload),
      );

      expect(presentation).not.toBeNull();
      expect(presentation!.icon).toBe(testCase.icon);
      expect(plain(presentation!.title)).toBe(testCase.title);

      if (testCase.name !== undefined) {
        expect(plain(presentation!.detail?.name ?? "")).toBe(testCase.name);
      }
      if (testCase.code !== undefined) {
        expect(presentation!.detail?.code).toBe(testCase.code);
      }
    });
  }
});

describe("formatActivityEvent: устойчивость", () => {
  it("подписи 21 вида описаны полностью, без пропусков в switch", () => {
    // Каждый вид из домена обязан дать представление: пропущенная ветка switch
    // вернула бы `null`, и событие молча исчезло бы из ленты.
    for (const kind of SPEC_ITEM_EVENT_KINDS) {
      expect(formatActivityEvent(event(kind, {}))).not.toBeNull();
    }
  });

  it("незнакомый kind (из будущей версии приложения) не ломает ленту", () => {
    // Вид события, которого нет в доменном объединении: так выглядит запись,
    // записанная более новой версией приложения. Приведение типа намеренное —
    // иначе этот случай не проверить, а рантайм обязан его выдержать.
    const future = event("teleported" as SpecItemEventKind, { name: "Диван" });

    expect(() => formatActivityEvent(future)).not.toThrow();
    expect(formatActivityEvent(future)).toBeNull();
  });

  it("комментарий не форматируется как событие", () => {
    expect(formatActivityEvent(comment())).toBeNull();
  });

  it("отсутствующие значения показываются как —", () => {
    const presentation = formatActivityEvent(
      event("created", { code: null, name: null, type: null, origin: null }),
    );
    expect(presentation!.title).toBe("Создано");
    expect(presentation!.detail).toEqual({ code: null, name: "—" });
  });

  it("незнакомый origin не выдумывает подпись", () => {
    const presentation = formatActivityEvent(
      event("created", { code: "М-01", name: "Диван", origin: "teleport" }),
    );
    expect(presentation!.title).toBe("Создано");
  });

  it("незнакомый статус без подписи даёт —, но подписи снимка остаются", () => {
    const withoutSnapshot = formatActivityEvent(
      event("status_changed", {
        from: "unknown_status",
        to: "picked",
        fromLabel: null,
        toLabel: null,
      }),
    );
    // `picked` — известный код: подпись берётся из словаря статусов.
    expect(withoutSnapshot!.title).toBe("Статус: — → Подобрано");

    const withSnapshot = formatActivityEvent(
      event("status_changed", {
        from: "unknown_status",
        to: "picked",
        fromLabel: "Легаси-статус",
        toLabel: null,
      }),
    );
    expect(withSnapshot!.title).toBe("Статус: Легаси-статус → Подобрано");
  });

  it("мусорный payload не бросает исключение", () => {
    const broken = event("details_changed", { changes: "не объект" });
    expect(() => formatActivityEvent(broken)).not.toThrow();
    expect(formatActivityEvent(broken)!.changes).toEqual([]);
  });
});

describe("details_changed и variant_updated: таблица изменений", () => {
  it("порядок полей фиксированный, а не порядок ключей JSON", () => {
    // payload намеренно перечислен в «неудобном» порядке: результат должен
    // определяться словарём полей, а не тем, как лёг `jsonb`.
    const presentation = formatActivityEvent(
      event("details_changed", {
        changes: [
          { field: "stock_pct", from: 0.1, to: 0.2 },
          { field: "name", from: "Диван", to: "Кресло" },
          { field: "rooms", from: ["Кухня"], to: ["Кухня", "Зал"] },
        ],
      }),
    );

    expect(presentation!.changes!.map((c) => c.field)).toEqual([
      "name",
      "rooms",
      "stock_pct",
    ]);
    expect(presentation!.changes!.map((c) => c.label)).toEqual([
      "Название",
      "Помещения",
      "Запас",
    ]);
  });

  it("незнакомое поле уходит в конец и подписывается как есть", () => {
    const presentation = formatActivityEvent(
      event("variant_updated", {
        changes: [
          { field: "price", from: 1200, to: 1500 },
          { field: "unknown_field", from: 1, to: 2 },
        ],
      }),
    );

    expect(presentation!.changes!.map((c) => c.field)).toEqual([
      "price",
      "unknown_field",
    ]);
    expect(presentation!.changes![1].label).toBe("unknown field");
  });

  it("словари полей покрывают отслеживаемые поля позиции и варианта", () => {
    for (const field of [...SPEC_ITEM_DETAIL_FIELDS, ...SPEC_VARIANT_PATCH_FIELDS]) {
      // Подпись не должна оставаться «сырым» snake_case.
      expect(activityFieldLabel(field)).not.toContain("_");
    }
  });

  it("значения: пусто, массив, attrs, проценты, ссылка", () => {
    const presentation = formatActivityEvent(
      event("details_changed", {
        changes: [
          { field: "name", from: "", to: "Кресло" },
          { field: "rooms", from: null, to: ["Кухня", "Зал"] },
          {
            field: "attrs",
            from: { Цвет: "белый" },
            to: { Цвет: "чёрный", Формат: "60×60" },
          },
          { field: "stock_pct", from: null, to: 0.15 },
          {
            field: "product_url",
            from: null,
            to: "https://example.com/catalog/item-9",
          },
        ],
      }),
    );

    const byField = new Map(
      presentation!.changes!.map((change) => [change.field, change]),
    );

    expect(byField.get("name")).toMatchObject({
      from: "не заполнено",
      to: "Кресло",
    });
    expect(byField.get("rooms")).toMatchObject({
      from: "не заполнено",
      to: "Кухня, Зал",
    });
    expect(plain(byField.get("attrs")!.to)).toBe("Цвет: чёрный, Формат: 60×60");
    expect(plain(byField.get("stock_pct")!.to)).toBe("15 %");
    expect(byField.get("product_url")!.to).toContain("item-9");
  });

  it("formatActivityChanges не меняет исходный payload", () => {
    const changes: HistoryFieldChange[] = [
      { field: "name", from: "А", to: "Б" },
      { field: "brand", from: "В", to: "Г" },
    ];
    const snapshot = JSON.parse(JSON.stringify(changes));

    formatActivityChanges(changes, ["brand", "name"]);

    expect(changes).toEqual(snapshot);
  });

  it("formatActivityValue: null и пустая строка — «не заполнено»", () => {
    expect(formatActivityValue("name", null)).toBe("не заполнено");
    expect(formatActivityValue("name", "")).toBe("не заполнено");
    expect(formatActivityValue("name", null, "—")).toBe("—");
  });
});

describe("batch", () => {
  it("групповая операция с размером > 1 подписана", () => {
    const record = event("status_changed", {
      from: "picked",
      to: "approved",
      batch: true,
      batch_size: 4,
    });

    expect(activityBatchSize(record)).toBe(4);
    expect(formatActivityBatch(4)).toBe("групповая операция · 4 позиции");
  });

  it("размер 1 подписи не даёт", () => {
    expect(
      activityBatchSize(
        event("status_changed", { batch: true, batch_size: 1 }),
      ),
    ).toBeNull();
  });

  it("одиночное действие подписи не даёт", () => {
    expect(activityBatchSize(event("removed", { name: "Стул" }))).toBeNull();
  });

  it("у комментария групповой операции не бывает", () => {
    expect(activityBatchSize(comment())).toBeNull();
  });

  it("склонение размера", () => {
    expect(formatActivityBatch(1)).toContain("1 позиция");
    expect(formatActivityBatch(2)).toContain("2 позиции");
    expect(formatActivityBatch(5)).toContain("5 позиций");
    expect(formatActivityBatch(11)).toContain("11 позиций");
    expect(formatActivityBatch(21)).toContain("21 позиция");
  });
});

describe("дата и время", () => {
  const now = new Date("2026-09-25T18:00:00.000Z");

  it("сегодня", () => {
    expect(formatActivityDate("2026-09-25T14:03:00.000Z", now)).toBe("Сегодня");
  });

  it("вчера", () => {
    expect(formatActivityDate("2026-09-24T14:03:00.000Z", now)).toBe("Вчера");
  });

  it("обычная дата текущего года — без года", () => {
    expect(formatActivityDate("2026-09-20T14:03:00.000Z", now)).toBe(
      "20 сентября",
    );
  });

  it("дата прошлого года — с годом", () => {
    expect(formatActivityDate("2025-12-31T14:03:00.000Z", now)).toContain("2025");
  });

  it("время в 24-часовом формате", () => {
    // Локальное время зависит от пояса машины, поэтому проверяется формат, а не
    // конкретные цифры: AM/PM в выводе быть не должно.
    const time = formatActivityTime("2026-09-25T14:03:00.000Z");
    expect(time).toMatch(/^\d{2}:\d{2}$/);
    expect(time).not.toMatch(/[AP]M/i);
  });

  it("дата и время вместе", () => {
    expect(formatActivityDateTime("2026-09-25T14:03:00.000Z", now)).toMatch(
      /^Сегодня, \d{2}:\d{2}$/,
    );
  });

  it("невалидная дата — «—»", () => {
    expect(formatActivityDate("не дата", now)).toBe("—");
    expect(formatActivityTime("не дата")).toBe("—");
  });
});

describe("автор и инициалы", () => {
  it("имя из снимка, инициалы по первому и последнему слову", () => {
    expect(formatActivityActor({ id: "u-1", name: "Анна Петрова" })).toEqual({
      name: "Анна Петрова",
      initials: "АП",
    });
  });

  it("удалённый пользователь: id нет, имя из снимка сохранено", () => {
    expect(formatActivityActor({ id: null, name: "Анна Петрова" }).name).toBe(
      "Анна Петрова",
    );
  });

  it("одно слово — одна буква", () => {
    expect(activityInitials("Анна")).toBe("А");
  });

  it("пустое имя — «—» без инициалов", () => {
    expect(formatActivityActor({ id: null, name: null })).toEqual({
      name: "—",
      initials: null,
    });
    expect(formatActivityActor({ id: null, name: "   " }).name).toBe("—");
  });
});
