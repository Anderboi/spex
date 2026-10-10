import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Тесты server action'ов файлов позиции: сессия, права, разбор `FormData`.
 *
 * Ядро (`lib/spec/spec-item-files.ts`) уже покрыто отдельно и работает на
 * подставных клиентах. Здесь проверяется ровно слой НАД ним — то, что нельзя
 * проверить в ядре: граница прав (`can`), проверка организации из сессии,
 * отсутствие `storage_path` в контракте и поведение при разборе формы.
 *
 * `requireOrgBySlug` и `createAdminClient` подменяются модульными моками:
 * реальная сессия требует next-auth и БД, а интересует именно решение action'а
 * по готовому контексту.
 */

const sessionMock = vi.hoisted(() => ({
  current: {
    userId: "user-1",
    // Значения — плейсхолдеры: настоящие uuid подставляются в `beforeEach`
    // (orgId обязан совпадать с `ORG`, иначе action честно ответит NOT_FOUND).
    orgId: "00000000-0000-4000-8000-000000000000",
    orgSlug: "org-1",
    role: "member" as "owner" | "admin" | "member" | "viewer",
    // Имя автора приходит из сессии (`ctx.user.name`): действий оно не
    // касается, но уходит в ответ — по нему строка показывает автора.
    user: { name: "Andy" },
  },
}));

const adminMock = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/auth/session", () => ({
  requireOrgBySlug: async () => ({ ...sessionMock.current }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminMock.client,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  deleteSpecItemFile,
  getSpecItemFileUrl,
  getSpecItemFileUrls,
  listSpecItemFiles,
  updateSpecItemFile,
  uploadSpecItemFile,
} from "./spec-item-files";

/* ------------------------------------------------------------------ */
/*  Подставной клиент                                                  */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

/**
 * Идентификаторы — настоящие UUID.
 *
 * Это не косметика: action проверяет ФОРМУ `fileId` до запроса, а Postgres
 * сравнивает `uuid`-колонки как uuid. Строки вида `org-1` в тесте давали бы
 * отказ по форме, а не по доступу, — то есть проверяли бы не то правило.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const PAYMENT = "55555555-5555-4555-8555-555555555555";
const PAYMENT_CANCELLED = "66666666-6666-4666-8666-666666666666";
const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORAGE_PATH = `${ORG}/spec-items/${ITEM}/${FILE}.pdf`;

/** Повторяет приведение к uuid в Postgres: не-uuid значение не совпадёт ни с чем. */
function asUuid(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return FILE_ID_RE.test(value) ? value.toLowerCase() : null;
}

function fakeAdmin() {
  const tables: Record<string, Row[]> = {
    spec_items: [
      { id: ITEM, org_id: ORG, project_id: PROJECT, deleted_at: null },
    ],
    // Имя автора загрузки: список файлов читает его из `users`.
    users: [{ id: "user-1", name: "Andy" }],
    // Оплата позиции и отменённая оплата: на них проверяется разбор
    // `payment_id` из формы.
    spec_item_payments: [
      {
        id: PAYMENT,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: ITEM,
        kind: "payment",
        paid_at: "2026-01-07",
        deleted_at: null,
      },
      {
        id: PAYMENT_CANCELLED,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: ITEM,
        kind: "payment",
        paid_at: "2026-01-04",
        deleted_at: "2026-01-05T00:00:00.000Z",
      },
    ],
    spec_item_files: [
      {
        id: FILE,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: ITEM,
        storage_path: STORAGE_PATH,
        file_name: "Счёт.pdf",
        mime_type: "application/pdf",
        size_bytes: 30,
        category: "document",
        uploaded_by: "user-1",
        created_at: "2026-01-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
  };

  const uploads: string[] = [];
  const removed: string[] = [];
  const signed: string[] = [];

  function from(table: string) {
    const eqs: [string, unknown][] = [];
    const inEqs: [string, unknown[]][] = [];
    const isNull: string[] = [];
    let insertRow: Row | null = null;
    let patch: Row | null = null;
    let operation: "select" | "insert" | "update" = "select";

    const matched = () =>
      (tables[table] ?? []).filter(
        (row) =>
          eqs.every(([column, value]) => {
            const expected = asUuid(value);
            if (expected === null) return false;
            const actual =
              typeof row[column] === "string"
                ? (row[column] as string).toLowerCase()
                : row[column];
            return actual === expected;
          }) &&
          inEqs.every(([column, values]) => values.includes(row[column])) &&
          isNull.every(
            (column) => row[column] === null || row[column] === undefined,
          ),
      );

    const finish = () => {
      if (operation === "insert") {
        const stored = { id: "generated", ...insertRow };
        tables[table] = [...(tables[table] ?? []), stored];
        return { data: stored, error: null };
      }
      if (operation === "update") {
        const row = matched()[0];
        if (!row) return { data: null, error: null };
        Object.assign(row, patch ?? {});
        return { data: row, error: null };
      }
      return { data: matched(), error: null };
    };

    const chain = {
      select: () => chain,
      eq(column: string, value: unknown) {
        eqs.push([column, value]);
        return chain;
      },
      /**
       * `in` нужен выборке имён авторов (пачка `spec_item_files.uploaded_by`).
       * Сравнение — по значению как есть: `users.id` в подставных данных уже
       * uuid в нижнем регистре, и приводить его не нужно.
       */
      in(column: string, values: unknown[]) {
        inEqs.push([column, values.map((value) => asUuid(value) ?? value)]);
        return chain;
      },
      is(column: string, value: unknown) {
        if (value === null) isNull.push(column);
        return chain;
      },
      order: () => chain,
      insert(row: Row) {
        operation = "insert";
        insertRow = row;
        return chain;
      },
      update(next: Row) {
        operation = "update";
        patch = next;
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: single(finish()), error: null }),
      single: () => Promise.resolve({ data: single(finish()), error: null }),
      then: (resolve: (value: { data: Row[] | null; error: null }) => unknown) =>
        Promise.resolve(resolve(finish() as { data: Row[] | null; error: null })),
    };

    function single(result: { data: unknown; error: unknown }) {
      const data = result.data;
      return Array.isArray(data) ? (data[0] ?? null) : data;
    }

    return chain;
  }

  const client = {
    from,
    storage: {
      from: () => ({
        async upload(path: string) {
          uploads.push(path);
          return { data: { path }, error: null };
        },
        async remove(paths: string[]) {
          removed.push(...paths);
          return { data: null, error: null };
        },
        async createSignedUrl(path: string) {
          signed.push(path);
          return { data: { signedUrl: `https://signed.test/${path}` }, error: null };
        },
      }),
    },
  };

  return { client, tables, uploads, removed, signed };
}

/** `FormData` с файлом: как её собирает браузер в реальном действии. */
function formOf(options: {
  name?: string;
  type?: string;
  bytes?: Uint8Array;
  category?: string | null;
  fileName?: string | null;
  rawValue?: unknown;
} = {}) {
  const form = new FormData();

  if ("rawValue" in options) {
    form.set("file", String(options.rawValue));
  } else {
    /**
     * `Uint8Array<ArrayBuffer>`, а не просто `Uint8Array`: `File` принимает
     * `BlobPart`, куда `ArrayBufferView<ArrayBufferLike>` не входит. Именно так
     * типизирован результат `await file.arrayBuffer()` в самом action'е.
     */
    const bytes: Uint8Array<ArrayBuffer> =
      options.bytes !== undefined
        ? Uint8Array.from(options.bytes)
        : new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n%%EOF");
    form.set(
      "file",
      new File([bytes], options.name ?? "Счёт.pdf", {
        type: options.type ?? "application/pdf",
      }),
    );
  }

  if (options.category !== null) {
    form.set("category", options.category ?? "document");
  }
  if (options.fileName !== null && options.fileName !== undefined) {
    form.set("file_name", options.fileName);
  }

  return form;
}

let admin: ReturnType<typeof fakeAdmin>;

beforeEach(() => {
  admin = fakeAdmin();
  adminMock.client = admin.client;
  sessionMock.current.role = "member";
  sessionMock.current.orgId = ORG;
  sessionMock.current.orgSlug = "org-1";
});

/* ------------------------------------------------------------------ */
/*  Права: viewer                                                        */
/* ------------------------------------------------------------------ */

describe("права: viewer", () => {
  it("viewer не может загрузить файл", async () => {
    sessionMock.current.role = "viewer";

    const result = await uploadSpecItemFile(ORG, ITEM, formOf());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("FORBIDDEN");
    // Ни Storage, ни БД не тронуты: отказ вынесен ДО чтения файла.
    expect(admin.uploads).toHaveLength(0);
  });

  it("viewer не может удалить файл", async () => {
    sessionMock.current.role = "viewer";

    const result = await deleteSpecItemFile(ORG, ITEM, FILE);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("FORBIDDEN");
    expect(admin.removed).toHaveLength(0);
    expect(admin.tables.spec_item_files[0].deleted_at).toBeNull();
  });

  it("viewer может читать список и получить ссылку", async () => {
    sessionMock.current.role = "viewer";

    const list = await listSpecItemFiles(ORG, ITEM);
    const url = await getSpecItemFileUrl(ORG, ITEM, FILE);

    // Чтение правами в этом проекте не описывается: наблюдатель видит то, что
    // видит организация.
    expect(list.success).toBe(true);
    expect(url.success).toBe(true);
  });

  it("member, admin и owner загружают и удаляют", async () => {
    for (const role of ["member", "admin", "owner"] as const) {
      admin = fakeAdmin();
      adminMock.client = admin.client;
      sessionMock.current.role = role;

      const uploaded = await uploadSpecItemFile(ORG, ITEM, formOf());
      const deleted = await deleteSpecItemFile(ORG, ITEM, FILE);

      expect(uploaded.success, role).toBe(true);
      expect(deleted.success, role).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Доступ: организация, позиция, проект                                */
/* ------------------------------------------------------------------ */

describe("доступ", () => {
  it("чужая организация: позиция не находится в сессионной организации", async () => {
    // Сессия другой организации, а позиция принадлежит ORG.
    sessionMock.current.orgId = OTHER_ORG;

    const list = await listSpecItemFiles(ORG, ITEM);
    const upload = await uploadSpecItemFile(ORG, ITEM, formOf());

    expect(list.success).toBe(false);
    expect(upload.success).toBe(false);
    if (upload.success) return;
    expect(upload.code).toBe("NOT_FOUND");
    expect(admin.uploads).toHaveLength(0);
  });

  it("чужой spec_item → NOT_FOUND", async () => {
    const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    const upload = await uploadSpecItemFile(ORG, other, formOf());
    const remove = await deleteSpecItemFile(ORG, other, FILE);

    expect(upload.success).toBe(false);
    expect(remove.success).toBe(false);
    expect(admin.uploads).toHaveLength(0);
  });

  it("project_id берётся из строки позиции, а не из формы", async () => {
    const form = formOf();
    form.set("project_id", "99999999-9999-4999-8999-999999999999");
    form.set("org_id", OTHER_ORG);

    const result = await uploadSpecItemFile(ORG, ITEM, form);

    expect(result.success).toBe(true);
    const inserted = admin.tables.spec_item_files.at(-1)!;
    expect(inserted.org_id).toBe(ORG);
    expect(inserted.project_id).toBe(PROJECT);
  });

  it("storage_path из формы игнорируется: путь строит сервер", async () => {
    const form = formOf();
    form.set("storage_path", `${OTHER_ORG}/spec-items/evil/evil.pdf`);

    await uploadSpecItemFile(ORG, ITEM, form);

    expect(admin.uploads).toHaveLength(1);
    expect(admin.uploads[0].startsWith(`${ORG}/spec-items/${ITEM}/`)).toBe(true);
    expect(admin.uploads[0]).not.toContain("evil");
    expect(admin.tables.spec_item_files.at(-1)!.storage_path).toBe(
      admin.uploads[0],
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Разбор формы                                                        */
/* ------------------------------------------------------------------ */

describe("разбор FormData", () => {
  it("файл — строка вместо File → INVALID_INPUT", async () => {
    const result = await uploadSpecItemFile(
      ORG,
      ITEM,
      formOf({ rawValue: "не файл" }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
    expect(admin.uploads).toHaveLength(0);
  });

  it("поле file отсутствует → INVALID_INPUT", async () => {
    const result = await uploadSpecItemFile(ORG, ITEM, new FormData());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("file_name из формы имеет приоритет над именем файла", async () => {
    const result = await uploadSpecItemFile(
      ORG,
      ITEM,
      formOf({ name: "browser.pdf", fileName: "Счёт №7.pdf" }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fileName).toBe("Счёт №7.pdf");
  });

  it("без file_name берётся имя из File", async () => {
    const result = await uploadSpecItemFile(
      ORG,
      ITEM,
      formOf({ name: "schet.pdf", fileName: null }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fileName).toBe("schet.pdf");
  });

  it("без category файл сохраняется как document", async () => {
    const result = await uploadSpecItemFile(
      ORG,
      ITEM,
      formOf({ category: null }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.category).toBe("document");
  });

  it("payment_id из формы ложится в строку файла", async () => {
    const form = formOf();
    form.set("payment_id", PAYMENT);

    const result = await uploadSpecItemFile(ORG, ITEM, form);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(admin.tables.spec_item_files.at(-1)!.payment_id).toBe(PAYMENT);
    // Ответ несёт подпись документа к оплате — без второго запроса.
    expect(result.data.paymentId).toBe(PAYMENT);
    expect(result.data.payment).toEqual({
      kind: "payment",
      paidAt: "2026-01-07",
      cancelled: false,
    });
  });

  it("пустой payment_id — обычный документ позиции", async () => {
    const form = formOf();
    form.set("payment_id", "");

    const result = await uploadSpecItemFile(ORG, ITEM, form);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(admin.tables.spec_item_files.at(-1)!.payment_id).toBeNull();
  });

  it("отменённая оплата → INVALID_INPUT с понятным текстом, Storage не тронут", async () => {
    const form = formOf();
    form.set("payment_id", PAYMENT_CANCELLED);

    const result = await uploadSpecItemFile(ORG, ITEM, form);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
    expect(result.error).toContain("Оплата не найдена");
    expect(admin.uploads).toHaveLength(0);
  });

  it("payment_id чужой позиции → INVALID_INPUT", async () => {
    const form = formOf();
    form.set("payment_id", "77777777-7777-4777-8777-777777777777");

    const result = await uploadSpecItemFile(ORG, ITEM, form);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
    expect(admin.uploads).toHaveLength(0);
  });

  it("лишние поля формы не влияют на вид оплаты: он читается из строки", async () => {
    // Вид и сумма оплаты приходят из БД, а не из формы: подсунуть их нечем.
    const form = formOf();
    form.set("payment_id", PAYMENT);
    form.set("kind", "refund");
    form.set("amount", "999999");

    const result = await uploadSpecItemFile(ORG, ITEM, form);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.payment).toEqual({
      kind: "payment",
      paidAt: "2026-01-07",
      cancelled: false,
    });
  });

  it("запрещённый MIME → INVALID_INPUT, Storage не тронут", async () => {
    const result = await uploadSpecItemFile(
      ORG,
      ITEM,
      formOf({ type: "application/x-msdownload", name: "evil.exe" }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
    expect(admin.uploads).toHaveLength(0);
  });

  it("подделка содержимого → INVALID_INPUT", async () => {
    const result = await uploadSpecItemFile(
      ORG,
      ITEM,
      formOf({
        bytes: new TextEncoder().encode("<html><script>x</script></html>"),
        type: "application/pdf",
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("success-ответ содержит запись без storage_path", async () => {
    const result = await uploadSpecItemFile(ORG, ITEM, formOf());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(JSON.stringify(result.data)).not.toContain("storage_path");
    expect(result.data.uploadedBy).toBe("user-1");
  });
});

/* ------------------------------------------------------------------ */
/*  getUrl и delete: форма id                                           */
/* ------------------------------------------------------------------ */

describe("getUrl и delete: идентификатор файла", () => {
  it("невалидный uuid отсекается до запроса в БД", async () => {
    const url = await getSpecItemFileUrl(ORG, ITEM, "не-uuid");
    const remove = await deleteSpecItemFile(ORG, ITEM, "../../etc/passwd");

    expect(url.success).toBe(false);
    expect(remove.success).toBe(false);
    if (url.success || remove.success) return;
    expect(url.code).toBe("NOT_FOUND");
    expect(remove.code).toBe("NOT_FOUND");
    expect(admin.removed).toHaveLength(0);
    expect(admin.signed).toHaveLength(0);
  });

  it("валидный uuid другого файла → NOT_FOUND", async () => {
    const other = "55555555-5555-4555-8555-555555555555";
    expect(FILE_ID_RE.test(other)).toBe(true);

    const url = await getSpecItemFileUrl(ORG, ITEM, other);
    expect(url.success).toBe(false);
    expect(admin.signed).toHaveLength(0);
  });

  it("подписывается путь из БД", async () => {
    const result = await getSpecItemFileUrl(ORG, ITEM, FILE);

    expect(result.success).toBe(true);
    expect(admin.signed).toEqual([STORAGE_PATH]);
  });

  it("delete возвращает признак повторного вызова", async () => {
    const first = await deleteSpecItemFile(ORG, ITEM, FILE);
    const second = await deleteSpecItemFile(ORG, ITEM, FILE);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(first.data.deleted).toBe(true);
    expect(second.data.deleted).toBe(false);
    expect(admin.removed).toEqual([STORAGE_PATH]);
  });
});

/* ------------------------------------------------------------------ */
/*  getUrls: пачка                                                     */
/* ------------------------------------------------------------------ */

describe("getSpecItemFileUrls", () => {
  it("подписывает пачку одним вызовом действия", async () => {
    const result = await getSpecItemFileUrls(ORG, ITEM, [FILE]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map((entry) => entry.fileId)).toEqual([FILE]);
    expect(admin.signed).toEqual([STORAGE_PATH]);
  });

  it("viewer тоже получает ссылки: чтение правами не описывается", async () => {
    sessionMock.current.role = "viewer";

    const result = await getSpecItemFileUrls(ORG, ITEM, [FILE]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
  });

  it("чужой spec_item → NOT_FOUND, ничего не подписано", async () => {
    const other = "77777777-7777-4777-8777-777777777777";

    const result = await getSpecItemFileUrls(ORG, other, [FILE]);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("NOT_FOUND");
    expect(admin.signed).toHaveLength(0);
  });

  it("чужая организация сессии → NOT_FOUND, ничего не подписано", async () => {
    sessionMock.current.orgId = OTHER_ORG;

    const result = await getSpecItemFileUrls(ORG, ITEM, [FILE]);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("NOT_FOUND");
    expect(admin.signed).toHaveLength(0);
  });

  /**
   * `fileIds` приходит от клиента, поэтому форму значения проверяет действие, а
   * не доверие типу: строка вместо массива — отказ клиента, а не падение.
   */
  it("не-массив идентификаторов не роняет действие", async () => {
    const result = await getSpecItemFileUrls(
      ORG,
      ITEM,
      "не-массив" as unknown as string[],
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual([]);
    expect(admin.signed).toHaveLength(0);
  });

  it("не-uuid идентификаторы отсекаются до запроса в БД", async () => {
    const result = await getSpecItemFileUrls(ORG, ITEM, [
      "не-uuid",
      "../../etc/passwd",
    ]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual([]);
    expect(admin.signed).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  update: права и разбор формы                                       */
/* ------------------------------------------------------------------ */

describe("updateSpecItemFile: права и разбор формы", () => {
  /** Форма правки: обе графы необязательны, пустая значит «не менять». */
  function patchForm(fields: { category?: string; fileName?: string } = {}) {
    const form = new FormData();
    if (fields.category !== undefined) form.set("category", fields.category);
    if (fields.fileName !== undefined) form.set("file_name", fields.fileName);
    return form;
  }

  it("viewer не может править файл", async () => {
    sessionMock.current.role = "viewer";

    const result = await updateSpecItemFile(
      ORG,
      ITEM,
      FILE,
      patchForm({ category: "receipt" }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("FORBIDDEN");
  });

  it("ответ загрузки несёт имя автора: строка не должна стать безымянной", async () => {
    // Именно этот случай ломался: запись вставала в список ровно такой, какой
    // её вернул сервер, а имя автора в БД не хранится (там ссылка на `users`).
    // Запрос на список при этом делается только при следующем открытии, поэтому
    // новая строка выглядела безымянной рядом со старыми.
    const result = await uploadSpecItemFile(ORG, ITEM, formOf());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.uploadedBy).toBe("user-1");
    expect(result.data.uploadedByName).toBe("Andy");
  });

  it("ответ правки тоже несёт имя автора", async () => {
    const form = new FormData();
    form.set("category", "receipt");

    const result = await updateSpecItemFile(ORG, ITEM, FILE, form);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.file.uploadedByName).toBe("Andy");
  });

  it("ссылка выдаётся, а строка при открытии не перечитывается", async () => {
    const result = await getSpecItemFileUrl(ORG, ITEM, FILE);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Ответ ссылки — только URL и срок: список от него не обновляется, поэтому
    // имя автора здесь не нужно (оно приходит с загрузкой и правкой, а при
    // чтении списка — из `users`).
    expect(result.data.url).toBeTruthy();
    expect(Object.keys(result.data).sort()).toEqual(["expiresAt", "url"]);
  });

  it("смена вида из формы доходит до строки", async () => {    const result = await updateSpecItemFile(
      ORG,
      ITEM,
      FILE,
      patchForm({ category: "invoice" }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.changed).toBe(true);
    expect(result.data.file.category).toBe("invoice");
    expect(
      admin.tables.spec_item_files.find((row) => row.id === FILE)!.category,
    ).toBe("invoice");
  });

  it("переименование из формы нормализуется", async () => {
    const result = await updateSpecItemFile(
      ORG,
      ITEM,
      FILE,
      patchForm({ fileName: "  Чек №7.pdf  " }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.file.fileName).toBe("Чек №7.pdf");
  });

  it("невалидный uuid отсекается до запроса в БД", async () => {
    const result = await updateSpecItemFile(
      ORG,
      ITEM,
      "не-uuid",
      patchForm({ category: "receipt" }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("NOT_FOUND");
  });

  it("чужой файл своей позиции → NOT_FOUND", async () => {
    const other = "77777777-7777-4777-8777-777777777777";
    const result = await updateSpecItemFile(
      ORG,
      ITEM,
      other,
      patchForm({ category: "receipt" }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("NOT_FOUND");
  });

  it("пустая форма ничего не меняет и отвечает успехом", async () => {
    // Так выглядит «открыл селект и выбрал то же значение»: менять нечего, но
    // это не ошибка.
    const result = await updateSpecItemFile(ORG, ITEM, FILE, patchForm());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.changed).toBe(false);
  });

  it("лишние поля формы игнорируются: storage_path и mime_type не правятся", async () => {
    const form = patchForm({ category: "receipt" });
    form.set("storage_path", `${OTHER_ORG}/spec-items/evil/evil.pdf`);
    form.set("mime_type", "application/x-msdownload");
    form.set("size_bytes", "999");

    await updateSpecItemFile(ORG, ITEM, FILE, form);

    const row = admin.tables.spec_item_files.find((entry) => entry.id === FILE)!;
    expect(row.storage_path).toBe(STORAGE_PATH);
    expect(row.mime_type).toBe("application/pdf");
    expect(row.size_bytes).toBe(30);
  });
});
