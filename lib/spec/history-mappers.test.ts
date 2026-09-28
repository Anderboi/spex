import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SPEC_ITEM_EVENT_KINDS, type SpecItemEventKind } from "./history";
import type { HistoryEntry, HistoryEventPayloadMap } from "./history-types";
import {
  mapSpecItemComment,
  mapSpecItemEvent,
  type SpecItemCommentRow,
  type SpecItemEventRow,
} from "./history-mappers";

/**
 * Mapper — слой чтения, и проверять его нужно на реальных формах payload'ов,
 * которые пишут билдеры `lib/spec/history.ts`, плюс на мусоре: строки в БД
 * исторические, а `payload` — свободный `jsonb`.
 */

const EVENT_ROW_BASE = {
  id: "ev-1",
  org_id: "org-1",
  spec_item_id: "item-1",
  actor_id: "user-1",
  actor_name_snapshot: "Анна",
  created_at: "2026-09-25T10:00:00.000Z",
};

function eventRow(
  kind: string,
  payload: SpecItemEventRow["payload"],
  over: Partial<SpecItemEventRow> = {},
): SpecItemEventRow {
  return { ...EVENT_ROW_BASE, kind, payload, ...over };
}

function commentRow(over: Partial<SpecItemCommentRow> = {}): SpecItemCommentRow {
  return {
    id: "cm-1",
    org_id: "org-1",
    spec_item_id: "item-1",
    parent_id: null,
    root_id: null,
    author_id: "user-2",
    author_name_snapshot: "Борис",
    body: "Текст комментария",
    created_at: "2026-09-25T11:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/*  Все 21 kind                                                        */
/* ------------------------------------------------------------------ */

/**
 * Реалистичный payload на каждый тип события. Тип `Record` по
 * `SpecItemEventKind` заставляет описать все 21: новый тип в списке без строки
 * здесь не соберётся.
 */
const RAW_PAYLOADS: Record<SpecItemEventKind, SpecItemEventRow["payload"]> = {
  created: {
    code: "М-01",
    name: "Диван",
    type: "Мебель",
    origin: "library",
    batch: true,
    batch_size: 2,
  },
  filled: { code: "М-02", name: "Кресло", origin: "manual" },
  cleared: { code: "М-03", name: "Стол" },
  removed: { code: "М-04", name: "Шкаф", batch: true, batch_size: 3 },
  restored: { code: "М-05", name: "Полка" },
  code_changed: { from: "М-01", to: "М-07" },
  status_changed: {
    from: "picked",
    to: "approved",
    from_label: "Подобрано",
    to_label: "Согласовано",
    batch: true,
    batch_size: 4,
  },
  price_changed: { from: 12_000, to: 15_500, currency: "RUB" },
  quantity_changed: { from: 1, to: 6, unit: "шт" },
  supplier_changed: {
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
  details_changed: {
    changes: {
      brand: { from: "Cersanit", to: "Finex" },
      name: { from: "Диван", to: "Кресло" },
    },
  },
  parent_changed: {
    from: { spec_item_id: "p-a", code: "М-01", name: "Кухня" },
    to: null,
  },
  variant_added: {
    variant_id: "v-1",
    label: "Альтернатива",
    base_snapshot_created: true,
  },
  variant_switched: {
    from: { variant_id: "v-a", name: "Blanco" },
    to: { variant_id: "v-b", name: "Finex" },
  },
  variant_updated: {
    variant_id: "v-1",
    changes: {
      price: { from: 1200, to: 1500 },
      name: { from: "Blanco", to: "Finex" },
    },
  },
  variant_removed: {
    variant_id: "v-a",
    name: "Blanco",
    label: "Основной",
    was_active: true,
    next_active: { variant_id: "v-b", name: "Finex" },
  },
  component_added: {
    component_id: "c-1",
    kind: "component",
    name: "Корпус",
    ref: null,
  },
  component_removed: {
    component_id: "c-2",
    kind: "spec_ref",
    name: null,
    ref: { spec_item_id: "item-9", code: "О-03", name: "Духовой шкаф" },
  },
  service_added: {
    service_id: "s-1",
    type: "delivery",
    name: null,
    amount: 7000,
    batch: true,
    batch_size: 2,
  },
  service_completed: {
    service_id: "s-1",
    type: "installation",
    name: null,
    amount: 5000,
  },
  service_removed: {
    service_id: "s-2",
    type: "service",
    name: "Подъём на этаж",
    amount: 2500,
  },
};

/**
 * Ожидаемый доменный payload на каждый тип. Тип заставляет ожидание совпасть с
 * контрактом `HistoryEventPayloadMap` — расхождение ловит компилятор, а не
 * глаз.
 */
const EXPECTED_PAYLOADS: {
  [K in SpecItemEventKind]: HistoryEventPayloadMap[K];
} = {
  created: {
    code: "М-01",
    name: "Диван",
    type: "Мебель",
    origin: "library",
    batch: true,
    batchSize: 2,
  },
  filled: {
    code: "М-02",
    name: "Кресло",
    origin: "manual",
    batch: false,
    batchSize: null,
  },
  cleared: {
    code: "М-03",
    name: "Стол",
    batch: false,
    batchSize: null,
  },
  removed: {
    code: "М-04",
    name: "Шкаф",
    batch: true,
    batchSize: 3,
  },
  restored: {
    code: "М-05",
    name: "Полка",
    batch: false,
    batchSize: null,
  },
  code_changed: { from: "М-01", to: "М-07" },
  status_changed: {
    from: "picked",
    to: "approved",
    fromLabel: "Подобрано",
    toLabel: "Согласовано",
    batch: true,
    batchSize: 4,
  },
  price_changed: { from: 12_000, to: 15_500, currency: "RUB" },
  quantity_changed: { from: 1, to: 6, unit: "шт" },
  supplier_changed: {
    from: {
      company_id: "c-1",
      company_name: "Ромашка",
      contact_id: "k-1",
      contact_name: "Пётр",
    },
    to: {
      company_id: null,
      company_name: null,
      contact_id: null,
      contact_name: null,
    },
  },
  details_changed: {
    changes: [
      { field: "name", from: "Диван", to: "Кресло" },
      { field: "brand", from: "Cersanit", to: "Finex" },
    ],
  },
  parent_changed: {
    from: { specItemId: "p-a", code: "М-01", name: "Кухня" },
    to: null,
  },
  variant_added: {
    variantId: "v-1",
    label: "Альтернатива",
    baseSnapshotCreated: true,
  },
  variant_switched: {
    from: { variantId: "v-a", name: "Blanco" },
    to: { variantId: "v-b", name: "Finex" },
  },
  variant_updated: {
    variantId: "v-1",
    changes: [
      { field: "name", from: "Blanco", to: "Finex" },
      { field: "price", from: 1200, to: 1500 },
    ],
  },
  variant_removed: {
    variantId: "v-a",
    name: "Blanco",
    label: "Основной",
    wasActive: true,
    nextActive: { variantId: "v-b", name: "Finex" },
  },
  component_added: {
    componentId: "c-1",
    compositionKind: "component",
    name: "Корпус",
    ref: null,
  },
  component_removed: {
    componentId: "c-2",
    compositionKind: "spec_ref",
    name: null,
    ref: { specItemId: "item-9", code: "О-03", name: "Духовой шкаф" },
  },
  service_added: {
    serviceId: "s-1",
    type: "delivery",
    name: null,
    amount: 7000,
    batch: true,
    batchSize: 2,
  },
  service_completed: {
    serviceId: "s-1",
    type: "installation",
    name: null,
    amount: 5000,
    batch: false,
    batchSize: null,
  },
  service_removed: {
    serviceId: "s-2",
    type: "service",
    name: "Подъём на этаж",
    amount: 2500,
    batch: false,
    batchSize: null,
  },
};

describe("mapSpecItemEvent: покрытие типов", () => {
  it("список контракта совпадает со списком из БД", () => {
    // Строки описаны для всех 21 kind; если состав списка изменится, тест
    // упадёт здесь, а не в рантайме на реальной ленте.
    expect(Object.keys(RAW_PAYLOADS).sort()).toEqual(
      [...SPEC_ITEM_EVENT_KINDS].sort(),
    );
  });

  it("каждый kind маппится и сохраняет свой kind", () => {
    for (const kind of SPEC_ITEM_EVENT_KINDS) {
      const entry = mapSpecItemEvent(eventRow(kind, RAW_PAYLOADS[kind]));

      expect(entry, kind).not.toBeNull();
      expect(entry?.kind, kind).toBe(kind);
      expect(entry?.source, kind).toBe("event");
    }
  });

  it("payload каждого kind приводится к доменному виду", () => {
    for (const kind of SPEC_ITEM_EVENT_KINDS) {
      const entry = mapSpecItemEvent(eventRow(kind, RAW_PAYLOADS[kind]));

      expect(entry?.payload, kind).toEqual(EXPECTED_PAYLOADS[kind]);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Базовые поля и автор                                               */
/* ------------------------------------------------------------------ */

describe("mapSpecItemEvent: базовые поля", () => {
  it("snake_case превращается в camelCase, значения сохраняются", () => {
    const entry = mapSpecItemEvent(eventRow("created", RAW_PAYLOADS.created));

    expect(entry).toMatchObject({
      id: "ev-1",
      orgId: "org-1",
      specItemId: "item-1",
      createdAt: "2026-09-25T10:00:00.000Z",
      source: "event",
      kind: "created",
    });
  });

  it("автор берётся из снимка", () => {
    const entry = mapSpecItemEvent(eventRow("cleared", RAW_PAYLOADS.cleared));

    expect(entry?.actor).toEqual({ id: "user-1", name: "Анна" });
  });

  it("удалённый автор сохраняет снимок имени, а id обнуляется", () => {
    // actor_id обнуляет FK ON DELETE SET NULL; подпись остаётся в снимке.
    const entry = mapSpecItemEvent(
      eventRow("cleared", RAW_PAYLOADS.cleared, { actor_id: null }),
    );

    expect(entry?.actor).toEqual({ id: null, name: "Анна" });
  });

  it("пустое имя автора — null, а не пустая строка", () => {
    for (const name of ["", null]) {
      const entry = mapSpecItemEvent(
        eventRow("cleared", RAW_PAYLOADS.cleared, {
          actor_id: null,
          actor_name_snapshot: name,
        }),
      );

      expect(entry?.actor).toEqual({ id: null, name: null });
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Нормализация значений                                              */
/* ------------------------------------------------------------------ */

describe("mapSpecItemEvent: нормализация", () => {
  it("пустые строки и отсутствующие поля становятся null", () => {
    const entry = mapSpecItemEvent(
      eventRow("removed", { code: "", name: "", batch_size: null }),
    );

    expect(entry?.payload).toEqual({
      code: null,
      name: null,
      batch: false,
      batchSize: null,
    });
  });

  it("флаги групповой операции читаются строго по типу", () => {
    const bad = mapSpecItemEvent(
      eventRow("removed", { batch: "да", batch_size: "3" }),
    );
    const single = mapSpecItemEvent(eventRow("removed", { code: "М-01" }));

    expect(bad?.payload).toMatchObject({ batch: false, batchSize: null });
    expect(single?.payload).toMatchObject({ batch: false, batchSize: null });
  });

  it("незнакомый код статуса даёт null, подписи сохраняются", () => {
    const entry = mapSpecItemEvent(
      eventRow("status_changed", {
        from: "archived",
        to: "approved",
        from_label: "Архив",
        to_label: "Согласовано",
      }),
    );

    expect(entry?.payload).toEqual({
      from: null,
      to: "approved",
      fromLabel: "Архив",
      toLabel: "Согласовано",
      batch: false,
      batchSize: null,
    });
  });

  it("незнакомый тип операции даёт null", () => {
    const entry = mapSpecItemEvent(
      eventRow("service_added", {
        service_id: "s-1",
        type: "cleaning",
        name: "Уборка",
        amount: 100,
      }),
    );

    expect(entry?.payload).toMatchObject({ type: null, name: "Уборка" });
  });

  it("нечисловая сумма не превращается в число", () => {
    const entry = mapSpecItemEvent(
      eventRow("service_completed", {
        service_id: "s-1",
        type: "delivery",
        name: null,
        amount: "7000",
      }),
    );

    expect(entry?.payload).toMatchObject({ amount: null });
  });

  it("незнакомые дополнительные поля игнорируются", () => {
    const entry = mapSpecItemEvent(
      eventRow("created", {
        code: "М-01",
        name: "Диван",
        type: "Мебель",
        origin: "library",
        legacy_field: "что-то",
        future: { nested: true },
      }),
    );

    expect(entry?.payload).not.toHaveProperty("legacy_field");
    expect(entry?.payload).not.toHaveProperty("future");
  });

  it("ссылка без идентификатора не превращается в пустой объект", () => {
    const entry = mapSpecItemEvent(
      eventRow("variant_switched", {
        from: { name: "Blanco" },
        to: { variant_id: "v-b", name: "" },
      }),
    );

    expect(entry?.payload).toEqual({
      from: null,
      to: { variantId: "v-b", name: null },
    });
  });

  it("родитель без идентификатора — null", () => {
    const entry = mapSpecItemEvent(
      eventRow("parent_changed", {
        from: { code: "М-01", name: "Кухня" },
        to: null,
      }),
    );

    expect(entry?.payload).toEqual({ from: null, to: null });
  });
});

/* ------------------------------------------------------------------ */
/*  changes: details_changed и variant_updated                         */
/* ------------------------------------------------------------------ */

describe("mapSpecItemEvent: изменения полей", () => {
  it("changes превращается в массив в каноническом порядке", () => {
    // jsonb порядок ключей не сохраняет, поэтому порядок задаёт mapper:
    // сначала поля в порядке SPEC_ITEM_DETAIL_FIELDS, затем незнакомые.
    const entry = mapSpecItemEvent(
      eventRow("details_changed", {
        changes: {
          zzz_legacy: { from: 1, to: 2 },
          brand: { from: "A", to: "B" },
          name: { from: "Диван", to: "Кресло" },
          aaa_legacy: { from: 3, to: 4 },
        },
      }),
    );

    expect(entry?.payload).toEqual({
      changes: [
        { field: "name", from: "Диван", to: "Кресло" },
        { field: "brand", from: "A", to: "B" },
        { field: "aaa_legacy", from: 3, to: 4 },
        { field: "zzz_legacy", from: 1, to: 2 },
      ],
    });
  });

  it("порядок не зависит от порядка ключей в строке", () => {
    const forward = mapSpecItemEvent(
      eventRow("variant_updated", {
        variant_id: "v-1",
        changes: {
          name: { from: "A", to: "B" },
          price: { from: 1, to: 2 },
        },
      }),
    );
    const reversed = mapSpecItemEvent(
      eventRow("variant_updated", {
        variant_id: "v-1",
        changes: {
          price: { from: 1, to: 2 },
          name: { from: "A", to: "B" },
        },
      }),
    );

    expect(forward?.payload).toEqual(reversed?.payload);
  });

  it("битая пара изменения становится null'ами, а не исключением", () => {
    const entry = mapSpecItemEvent(
      eventRow("details_changed", {
        changes: { name: "не пара", notes: { from: "a" } },
      }),
    );

    expect(entry?.payload).toEqual({
      changes: [
        { field: "name", from: null, to: null },
        { field: "notes", from: "a", to: null },
      ],
    });
  });

  it("changes не объект — пустой список", () => {
    for (const changes of [null, "текст", 42, []]) {
      const entry = mapSpecItemEvent(eventRow("details_changed", { changes }));

      expect(entry?.payload).toEqual({ changes: [] });
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Устойчивость                                                       */
/* ------------------------------------------------------------------ */

/** Все примитивы внутри значения — для проверки «ничего не выдумано». */
function primitivesOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(primitivesOf);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(primitivesOf);
  }
  return [value];
}

describe("mapSpecItemEvent: устойчивость", () => {
  it("неизвестный kind даёт null, а не исключение", () => {
    // Событие из более новой версии приложения пропускается, лента не рвётся.
    expect(mapSpecItemEvent(eventRow("invented_kind", { any: 1 }))).toBeNull();
    expect(mapSpecItemEvent(eventRow("", {}))).toBeNull();
    expect(mapSpecItemEvent(eventRow("CREATED", {}))).toBeNull();
  });

  it("мусорный payload не роняет mapper", () => {
    const garbage: SpecItemEventRow["payload"][] = [
      null,
      "текст",
      42,
      true,
      [],
      {},
      { code: 5, name: [], batch: "да", changes: 7 },
    ];

    for (const kind of SPEC_ITEM_EVENT_KINDS) {
      for (const payload of garbage) {
        const entry = mapSpecItemEvent(eventRow(kind, payload));

        expect(entry, `${kind} / ${JSON.stringify(payload)}`).not.toBeNull();
        expect(entry?.kind).toBe(kind);
      }
    }
  });

  it("пустой payload не превращается в выдуманные значения", () => {
    // Контракт запрещает подставлять текст-заглушку: единственное, что можно
    // получить из пустого payload'а, — null, false и пустой список.
    for (const kind of SPEC_ITEM_EVENT_KINDS) {
      const entry = mapSpecItemEvent(eventRow(kind, {}));
      const invented = primitivesOf(entry?.payload).filter(
        (value) => value !== null && value !== false,
      );

      expect(invented, kind).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Сужается ли payload по kind                                        */
/* ------------------------------------------------------------------ */

describe("HistoryEntry: дискриминированный union", () => {
  it("kind сужает payload на этапе компиляции", () => {
    const entry = mapSpecItemEvent(
      eventRow("created", { origin: "library", name: "Диван" }),
    );

    if (entry && entry.kind === "created") {
      // Если бы `payload` не сужался, эти строки не собрались бы: у остальных
      // событий таких полей нет.
      const origin: string | null = entry.payload.origin;
      const name: string | null = entry.payload.name;

      expect(origin).toBe("library");
      expect(name).toBe("Диван");
    } else {
      throw new Error("created не смаппился");
    }
  });

  it("лента различает событие и комментарий по source", () => {
    const entry: HistoryEntry = mapSpecItemComment(commentRow(), 0);

    if (entry.source === "comment") {
      expect(entry.body).toBe("Текст комментария");
    } else {
      throw new Error("комментарий смаппился как событие");
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Комментарии                                                        */
/* ------------------------------------------------------------------ */

describe("mapSpecItemComment", () => {
  it("обычный комментарий: автор, время, тело", () => {
    const entry = mapSpecItemComment(commentRow(), 0);

    expect(entry).toEqual({
      id: "cm-1",
      orgId: "org-1",
      specItemId: "item-1",
      createdAt: "2026-09-25T11:00:00.000Z",
      actor: { id: "user-2", name: "Борис" },
      source: "comment",
      parentId: null,
      rootId: null,
      body: "Текст комментария",
      editedAt: null,
      deleted: false,
      replyCount: 0,
    });
  });

  it("корневой комментарий: parentId и rootId пусты", () => {
    const entry = mapSpecItemComment(commentRow({ root_id: "cm-1" }), 3);

    expect(entry.parentId).toBeNull();
    expect(entry.rootId).toBe("cm-1");
    expect(entry.replyCount).toBe(3);
  });

  it("ответ: parentId и rootId заполнены", () => {
    const entry = mapSpecItemComment(
      commentRow({ parent_id: "cm-1", root_id: "cm-1" }),
      0,
    );

    expect(entry.parentId).toBe("cm-1");
    expect(entry.rootId).toBe("cm-1");
  });

  it("правка отражается в editedAt", () => {
    const entry = mapSpecItemComment(
      commentRow({ edited_at: "2026-09-25T12:30:00.000Z" }),
      0,
    );

    expect(entry.editedAt).toBe("2026-09-25T12:30:00.000Z");
  });

  it("deleted_at !== null — комментарий удалён, тело сохраняется", () => {
    const entry = mapSpecItemComment(
      commentRow({ deleted_at: "2026-09-25T13:00:00.000Z" }),
      2,
    );

    expect(entry.deleted).toBe(true);
    // Тело не вычищается: удалённый корень ветки остаётся плейсхолдером.
    expect(entry.body).toBe("Текст комментария");
    expect(entry.replyCount).toBe(2);
  });

  it("deleted_at === null — комментарий не удалён", () => {
    const entry = mapSpecItemComment(commentRow({ deleted_at: null }), 0);

    expect(entry.deleted).toBe(false);
  });

  it("replyCount передаётся как есть", () => {
    expect(mapSpecItemComment(commentRow(), 0).replyCount).toBe(0);
    expect(mapSpecItemComment(commentRow(), 7).replyCount).toBe(7);
  });

  it("удалённый автор: id обнулён, снимок имени остался", () => {
    const entry = mapSpecItemComment(
      commentRow({ author_id: null, author_name_snapshot: "Борис" }),
      0,
    );

    expect(entry.actor).toEqual({ id: null, name: "Борис" });
  });

  it("пустое имя автора — null", () => {
    const entry = mapSpecItemComment(
      commentRow({ author_id: null, author_name_snapshot: "" }),
      0,
    );

    expect(entry.actor).toEqual({ id: null, name: null });
  });

  it("тело не нормализуется", () => {
    const body = "  первая строка\n\nвторая  ";
    const entry = mapSpecItemComment(commentRow({ body }), 0);

    expect(entry.body).toBe(body);
  });
});

/* ------------------------------------------------------------------ */
/*  Чистота mapper'а                                                   */
/* ------------------------------------------------------------------ */

describe("mapper не ходит в БД", () => {
  it("в модуле нет клиента БД, React и асинхронности", () => {
    const source = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "./history-mappers.ts",
      ),
      "utf8",
    );

    for (const needle of [
      "@supabase",
      "createAdminClient",
      "next/",
      "react",
      "use client",
      "use server",
      "async ",
      "await ",
    ]) {
      expect(source, needle).not.toContain(needle);
    }
  });
});
