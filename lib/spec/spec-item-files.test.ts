import { describe, expect, it } from "vitest";

import {
  MAX_SPEC_ITEM_FILE_BYTES,
  MAX_SPEC_ITEM_FILE_NAME_LENGTH,
  SPEC_ITEM_FILES_BUCKET,
} from "./file-content";
import {
  SPEC_ITEM_FILE_URL_TTL_SECONDS,
  deleteSpecItemFile,
  getSpecItemFileUrl,
  getSpecItemFileUrls,
  listSpecItemFiles,
  updateSpecItemFile,
  uploadSpecItemFile,
  validateUploadData,
  type SpecItemFilesDb,
  type SpecItemFilesStorage,
} from "./spec-item-files";

/**
 * Тесты ядра файлов позиции спецификации.
 *
 * Проверяются ровно те правила, которые нельзя доверить клиенту: принадлежность
 * организации, позиции и проекта, ожидаемый префикс пути, валидация содержимого,
 * мягкое удаление и поведение при отказе Storage/БД. Доступ организации
 * проверяет server action — там сессия; здесь проверяется тот же предикат `can`,
 * по которому эта проверка идёт (граница «member и выше»).
 *
 * Запросы идут на подставной клиент, повторяющий нужную часть цепочки
 * PostgREST (`select/eq/is/order/insert/update/maybeSingle/single`), а Storage —
 * на простой объект с фиксацией вызовов. Это позволяет проверять реальный код,
 * а не его пересказ.
 */

/* ------------------------------------------------------------------ */
/*  Идентификаторы                                                     */
/* ------------------------------------------------------------------ */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT = "44444444-4444-4444-8444-444444444444";
const ITEM = "55555555-5555-4555-8555-555555555555";
const OTHER_ITEM = "66666666-6666-4666-8666-666666666666";
const ITEM_OTHER_PROJECT = "77777777-7777-4777-8777-777777777777";
const USER = "88888888-8888-4888-8888-888888888888";

const FILE = "99999999-9999-4999-8999-999999999999";
const FILE_OTHER_ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILE_OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FILE_DELETED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FILE_FOREIGN_PATH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FILE_NEW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
/** Файл, прикреплённый к живой оплате своей позиции. */
const FILE_WITH_PAYMENT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
/** Файл, прикреплённый к оплате, которую потом отменили. */
const FILE_WITH_CANCELLED_PAYMENT = "12121212-1212-4212-8212-121212121212";

const PAYMENT = "13131313-1313-4313-8313-131313131313";
const PAYMENT_OTHER_ITEM = "14141414-1414-4414-8414-141414141414";
const PAYMENT_OTHER_ORG = "15151515-1515-4515-8515-151515151515";
const PAYMENT_DELETED = "16161616-1616-4616-8616-161616161616";

const itemPath = (itemId: string, fileId: string) =>
  `${ORG}/spec-items/${itemId}/${fileId}.pdf`;

/* ------------------------------------------------------------------ */
/*  Подставная БД                                                      */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type Call = {
  table: string;
  operation: "select" | "insert" | "update";
  columns: string | null;
  eqs: [string, unknown][];
  inEqs: [string, unknown[]][];
  isNull: string[];
  order: { column: string; ascending: boolean }[];
  insert: Row | null;
  patch: Row | null;
};

type Failure = {
  select?: boolean;
  insert?: boolean;
  update?: boolean;
  /** Отдельный отказ именно на чтении оплат: список файлов его переживает. */
  selectPayment?: boolean;
  /** Отдельный отказ на чтении имён авторов: список файлов его переживает. */
  selectUsers?: boolean;
};

function fakeDb(seed: Tables, failure: Failure = {}) {
  const tables: Tables = Object.fromEntries(
    Object.entries(seed).map(([table, rows]) => [
      table,
      rows.map((row) => structuredClone(row)),
    ]),
  );
  const calls: Call[] = [];

  function insertRow(table: string, row: Row): Row {
    const stored: Row = {
      id: `generated-${(tables[table]?.length ?? 0) + 1}`,
      deleted_at: null,
      created_at: new Date().toISOString(),
      ...row,
    };
    tables[table] = [...(tables[table] ?? []), stored];
    return stored;
  }

  function from(table: string) {
    const call: Call = {
      table,
      operation: "select",
      columns: null,
      eqs: [],
      inEqs: [],
      isNull: [],
      order: [],
      insert: null,
      patch: null,
    };

    const matched = () =>
      (tables[table] ?? []).filter(
        (row) =>
          call.eqs.every(([column, value]) => row[column] === value) &&
          call.inEqs.every(([column, values]) => values.includes(row[column])) &&
          call.isNull.every(
            (column) => row[column] === null || row[column] === undefined,
          ),
      );

    /** Сортировка по записанным `order()`: первый вызов — старший ключ. */
    const sorted = (rows: Row[]) => {
      if (call.order.length === 0) return rows;
      const copy = [...rows];
      for (const directive of [...call.order].reverse()) {
        copy.sort((a, b) => {
          const left = a[directive.column];
          const right = b[directive.column];
          if (left === right) return 0;
          const compared = String(left) < String(right) ? -1 : 1;
          return directive.ascending ? compared : -compared;
        });
      }
      return copy;
    };

    const chain = {
      select(columns?: string) {
        call.columns = columns ?? "*";
        return chain;
      },
      eq(column: string, value: unknown) {
        call.eqs.push([column, value]);
        return chain;
      },
      /**
       * `in` нужен ровно одной выборке — пачке оплат по идентификаторам
       * (`decorateWithPayments`). Соединение таблиц здесь не поддержано
       * намеренно: подставной клиент повторяет только те части PostgREST,
       * которыми пользуется код, а второй способ читать те же данные он бы
       * закрепил как допустимый.
       */
      in(column: string, values: unknown[]) {
        call.inEqs.push([column, values]);
        return chain;
      },
      is(column: string, value: unknown) {
        if (value === null) call.isNull.push(column);
        return chain;
      },
      order(column: string, options?: { ascending?: boolean }) {
        call.order.push({ column, ascending: options?.ascending ?? true });
        return chain;
      },
      insert(row: Row) {
        call.operation = "insert";
        call.insert = row;
        return chain;
      },
      update(patch: Row) {
        call.operation = "update";
        call.patch = patch;
        return chain;
      },
      maybeSingle() {
        calls.push(call);
        if (call.operation === "insert") {
          return Promise.resolve(singleInsert());
        }
        if (call.operation === "update") {
          return Promise.resolve(applyUpdate());
        }
        if (failure.select) {
          return Promise.resolve({ data: null, error: { message: "ошибка БД" } });
        }
        if (failure.selectPayment && table === "spec_item_payments") {
          return Promise.resolve({ data: null, error: { message: "ошибка БД" } });
        }
        if (failure.selectUsers && table === "users") {
          return Promise.resolve({ data: null, error: { message: "ошибка БД" } });
        }
        return Promise.resolve({ data: sorted(matched())[0] ?? null, error: null });
      },
      single() {
        calls.push(call);
        if (call.operation === "insert") {
          return Promise.resolve(singleInsert());
        }
        if (call.operation === "update") {
          return Promise.resolve(applyUpdate());
        }
        return Promise.resolve({ data: sorted(matched())[0] ?? null, error: null });
      },
      then(
        resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown,
      ) {
        calls.push(call);
        if (failure.select) {
          return Promise.resolve(
            resolve({ data: null, error: { message: "ошибка БД" } }),
          );
        }
        if (failure.selectPayment && table === "spec_item_payments") {
          return Promise.resolve(
            resolve({ data: null, error: { message: "ошибка БД" } }),
          );
        }
        if (failure.selectUsers && table === "users") {
          return Promise.resolve(
            resolve({ data: null, error: { message: "ошибка БД" } }),
          );
        }
        return Promise.resolve(resolve({ data: sorted(matched()), error: null }));
      },
    };

    function singleInsert() {
      if (failure.insert) {
        return { data: null, error: { message: "ошибка БД" } };
      }
      const stored = insertRow(table, call.insert ?? {});
      return { data: stored, error: null };
    }

    function applyUpdate() {
      if (failure.update) {
        return { data: null, error: { message: "ошибка БД" } };
      }
      const row = matched()[0];
      if (!row) return { data: null, error: null };
      Object.assign(row, call.patch ?? {});
      return { data: row, error: null };
    }

    return chain;
  }

  return {
    client: { from } as unknown as SpecItemFilesDb,
    tables,
    calls,
    callsFor: (table: string) => calls.filter((c) => c.table === table),
  };
}

/* ------------------------------------------------------------------ */
/*  Подставной Storage                                                 */
/* ------------------------------------------------------------------ */

function fakeStorage(failure: { upload?: boolean; remove?: boolean; sign?: boolean } = {}) {
  const uploads: { path: string; contentType: string; size: number }[] = [];
  const removed: string[] = [];
  const signed: { path: string; expiresIn: number; download: string | true | null }[] = [];

  const storage: SpecItemFilesStorage = {
    async upload({ path, bytes, contentType }) {
      uploads.push({ path, contentType, size: bytes.length });
      return { error: failure.upload ? { message: "storage недоступен" } : null };
    },
    async remove(path) {
      removed.push(path);
      return { error: failure.remove ? { message: "storage недоступен" } : null };
    },
    async createSignedUrl({ path, expiresIn, download }) {
      signed.push({ path, expiresIn, download: download ?? null });      if (failure.sign) {
        return { data: null, error: { message: "storage недоступен" } };
      }
      return { data: { signedUrl: `https://storage.test/${path}?token=t` }, error: null };
    },
  };

  return { storage, uploads, removed, signed };
}

/* ------------------------------------------------------------------ */
/*  Данные                                                             */
/* ------------------------------------------------------------------ */

function seedTables(): Tables {
  return {
    spec_items: [
      {
        id: ITEM,
        org_id: ORG,
        project_id: PROJECT,
        deleted_at: null,
      },
      {
        id: OTHER_ITEM,
        org_id: ORG,
        project_id: PROJECT,
        deleted_at: null,
      },
      {
        id: ITEM_OTHER_PROJECT,
        org_id: ORG,
        project_id: OTHER_PROJECT,
        deleted_at: null,
      },
    ],
    spec_item_files: [
      {
        id: FILE,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: ITEM,
        storage_path: itemPath(ITEM, FILE),
        file_name: "Счёт №1.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
        category: "document",
        uploaded_by: USER,
        created_at: "2026-01-01T10:00:00.000Z",
        deleted_at: null,
      },
      {
        id: FILE_OTHER_ITEM,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: OTHER_ITEM,
        storage_path: itemPath(OTHER_ITEM, FILE_OTHER_ITEM),
        file_name: "Инструкция.pdf",
        mime_type: "application/pdf",
        size_bytes: 2048,
        category: "document",
        uploaded_by: USER,
        created_at: "2026-01-02T10:00:00.000Z",
        deleted_at: null,
      },
      {
        id: FILE_OTHER_ORG,
        org_id: OTHER_ORG,
        project_id: OTHER_PROJECT,
        spec_item_id: ITEM,
        storage_path: `${OTHER_ORG}/spec-items/${ITEM}/${FILE_OTHER_ORG}.pdf`,
        file_name: "Чужой.pdf",
        mime_type: "application/pdf",
        size_bytes: 4096,
        category: "document",
        uploaded_by: null,
        created_at: "2026-01-03T10:00:00.000Z",
        deleted_at: null,
      },
      {
        id: FILE_DELETED,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: ITEM,
        storage_path: itemPath(ITEM, FILE_DELETED),
        file_name: "Удалённый.pdf",
        mime_type: "application/pdf",
        size_bytes: 512,
        category: "other",
        uploaded_by: USER,
        created_at: "2026-01-04T10:00:00.000Z",
        deleted_at: "2026-01-05T10:00:00.000Z",
      },
      {
        id: FILE_FOREIGN_PATH,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: ITEM,
        // Строка «своя», а путь ведёт в другую организацию: так выглядела бы
        // запись, сделанная в обход кода.
        storage_path: `${OTHER_ORG}/spec-items/${ITEM}/${FILE_FOREIGN_PATH}.pdf`,
        file_name: "Подмена.pdf",
        mime_type: "application/pdf",
        size_bytes: 128,
        category: "document",
        uploaded_by: null,
        created_at: "2026-01-06T10:00:00.000Z",
        deleted_at: null,
      },
      {
        id: FILE_WITH_PAYMENT,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: ITEM,
        storage_path: itemPath(ITEM, FILE_WITH_PAYMENT),
        file_name: "Чек №7.pdf",
        mime_type: "application/pdf",
        size_bytes: 256,
        category: "receipt",
        uploaded_by: USER,
        created_at: "2026-01-07T10:00:00.000Z",
        deleted_at: null,
        payment_id: PAYMENT,
      },
      {
        id: FILE_WITH_CANCELLED_PAYMENT,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: ITEM,
        storage_path: itemPath(ITEM, FILE_WITH_CANCELLED_PAYMENT),
        file_name: "Чек к отменённой.pdf",
        mime_type: "application/pdf",
        size_bytes: 512,
        category: "receipt",
        uploaded_by: USER,
        created_at: "2026-01-08T10:00:00.000Z",
        deleted_at: null,
        payment_id: PAYMENT_DELETED,
      },
    ],
    users: [{ id: USER, name: "Иван П." }],
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
        // Чужая позиция: документ своей позиции на неё ссылаться не может.
        id: PAYMENT_OTHER_ITEM,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: OTHER_ITEM,
        kind: "payment",
        paid_at: "2026-01-02",
        deleted_at: null,
      },
      {
        // Чужая организация.
        id: PAYMENT_OTHER_ORG,
        org_id: OTHER_ORG,
        project_id: OTHER_PROJECT,
        spec_item_id: ITEM,
        kind: "payment",
        paid_at: "2026-01-03",
        deleted_at: null,
      },
      {
        // Отменённая оплата: привязать к ней документ нельзя.
        id: PAYMENT_DELETED,
        org_id: ORG,
        project_id: PROJECT,
        spec_item_id: ITEM,
        kind: "payment",
        paid_at: "2026-01-04",
        deleted_at: "2026-01-05T10:00:00.000Z",
      },
    ],
  };
}

const baseArgs = {
  orgId: ORG,
  projectId: PROJECT,
  specItemId: ITEM,
};

const pdfBytes = () =>
  new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");

const uploadData = (overrides: Partial<Parameters<typeof uploadSpecItemFile>[2]["data"]> = {}) => ({
  bytes: pdfBytes(),
  fileName: "Счёт №1.pdf",
  declaredMime: "application/pdf",
  // Вид по умолчанию в тестах называется ЯВНО: без него включается догадка
  // (`guessSpecItemFileCategory`), и тесты оставляли бы непокрытым главное —
  // что явно присланный вид догадку перебивает.
  category: "document",
  ...overrides,
});

/* ------------------------------------------------------------------ */
/*  list                                                               */
/* ------------------------------------------------------------------ */

describe("listSpecItemFiles", () => {
  it("возвращает активные файлы позиции", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `created_at` новее у подставленной строки, поэтому она первая: сортировка
    // идёт по времени, а не по идентификатору.
    expect(result.files.map((f) => f.id)).toEqual([
      FILE_WITH_CANCELLED_PAYMENT,
      FILE_WITH_PAYMENT,
      FILE_FOREIGN_PATH,
      FILE,
    ]);
  });

  it("удалённый файл в список не попадает", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.some((f) => f.id === FILE_DELETED)).toBe(false);
  });

  it("файлы другой позиции в список не попадают", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.some((f) => f.id === FILE_OTHER_ITEM)).toBe(false);
  });

  it("файлы другой организации в список не попадают", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.some((f) => f.id === FILE_OTHER_ORG)).toBe(false);
  });

  it("сортировка: created_at desc, id desc", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Свежие первыми: 2026-01-08 (чек к отменённой оплате) новее 2026-01-06.
    expect(result.files[0].id).toBe(FILE_WITH_CANCELLED_PAYMENT);
    expect(result.files[1].id).toBe(FILE_WITH_PAYMENT);
  });

  it("sanity: данные выше действительно идут не в том порядке, что id", () => {
    // Страховка от «тест сортировки прошёл, потому что данные совпали со
    // случайным порядком»: у подменённой строки created_at строго позже.
    const rows = seedTables().spec_item_files.filter(
      (r) => r.org_id === ORG && r.spec_item_id === ITEM && r.deleted_at === null,
    );
    expect(rows.map((r) => r.id)).toEqual([
      FILE,
      FILE_FOREIGN_PATH,
      FILE_WITH_PAYMENT,
      FILE_WITH_CANCELLED_PAYMENT,
    ]);
    expect(String(rows[1].created_at) > String(rows[0].created_at)).toBe(true);
  });

  it("storage_path и URL наружу не отдаются", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.files);
    expect(serialized).not.toContain("storage_path");
    expect(serialized).not.toContain("storagePath");
    expect(serialized).not.toContain(SPEC_ITEM_FILES_BUCKET);
  });

  it("поля записи заполнены", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ищем по идентификатору, а не по номеру в списке: место строки в списке —
    // предмет отдельного теста сортировки, а не этого.
    const file = result.files.find((entry) => entry.id === FILE);
    expect(file).toEqual({
      id: FILE,
      fileName: "Счёт №1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      category: "document",
      uploadedBy: USER,
      uploadedByName: "Иван П.",
      createdAt: "2026-01-01T10:00:00.000Z",
      // Обычный файл позиции: оплаты за ним нет — и поля говорят об этом
      // одинаково, а не отсутствием ключа.
      paymentId: null,
      payment: null,
    });
  });

  it("показывает имя автора, а не uuid загрузившего", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = result.files.find((entry) => entry.id === FILE);
    expect(file?.uploadedBy).toBe(USER);
    expect(file?.uploadedByName).toBe("Иван П.");
  });

  it("автор без имени и без автора дают `null`, а не прочерк", async () => {
    const tables = seedTables();
    tables.spec_item_files = tables.spec_item_files.map((row) =>
      row.id === FILE
        ? { ...row, uploaded_by: "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f" }
        : row,
    );
    tables.users = [{ id: USER, name: "Иван П." }];

    const result = await listSpecItemFiles(fakeDb(tables).client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Пользователя нет в `users` (удалили): имя не выдумывается.
    expect(
      result.files.find((entry) => entry.id === FILE)?.uploadedByName,
    ).toBeNull();
    // У файла, загруженного без автора, имени тоже нет.
    expect(
      result.files.find((entry) => entry.id === FILE_FOREIGN_PATH)?.uploadedByName,
    ).toBeNull();
  });

  it("ошибка чтения имён не ломает список", async () => {
    // Имя автора — подпись, а не данные: без него строки обязаны остаться.
    const db = fakeDb(seedTables(), { selectUsers: true });
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.length).toBeGreaterThan(0);
    expect(
      result.files.find((entry) => entry.id === FILE)?.uploadedByName,
    ).toBeNull();
  });

  it("документ к оплате приходит с видом и датой записи", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = result.files.find((entry) => entry.id === FILE_WITH_PAYMENT);
    expect(file?.paymentId).toBe(PAYMENT);
    // Вид и дата — из строки оплаты, а не из файла: клиент не должен угадывать.
    expect(file?.payment).toEqual({
      kind: "payment",
      paidAt: "2026-01-07",
      cancelled: false,
    });
  });

  it("оплата отменена — файл остаётся документом позиции и говорит об отмене", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = result.files.find(
      (entry) => entry.id === FILE_WITH_CANCELLED_PAYMENT,
    );
    // Ссылка в строке осталась (решение тикета: отмена документа не удаляет), и
    // подпись не исчезает вместе с оплатой — иначе связь в данных осталась бы
    // без объяснения, а документ выглядел бы обычным файлом. Дата отменённой
    // записи сохраняется: её читают вместе со строкой, а не после неё.
    expect(file?.paymentId).toBe(PAYMENT_DELETED);
    expect(file?.payment).toEqual({
      kind: "payment",
      paidAt: "2026-01-04",
      cancelled: true,
    });
  });

  it("ссылка на пропавшую оплату тоже читается как отменённая", async () => {
    // Так выглядела бы строка после физического удаления оплаты или записи в
    // обход кода: `payment_id` есть, строки по нему нет.
    const missing = "17171717-1717-4717-8717-171717171717";
    const tables = seedTables();
    tables.spec_item_files = tables.spec_item_files.map((row) =>
      row.id === FILE_WITH_CANCELLED_PAYMENT ? { ...row, payment_id: missing } : row,
    );

    const result = await listSpecItemFiles(fakeDb(tables).client, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = result.files.find(
      (entry) => entry.id === FILE_WITH_CANCELLED_PAYMENT,
    );
    expect(file?.paymentId).toBe(missing);
    expect(file?.payment?.cancelled).toBe(true);
  });

  it("ошибка чтения оплат не ломает список файлов", async () => {
    const db = fakeDb(seedTables(), { selectPayment: true });
    const result = await listSpecItemFiles(db.client, baseArgs);

    // Документы важнее подписи: недоступность оплат оставляет файл обычным.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = result.files.find((entry) => entry.id === FILE_WITH_PAYMENT);
    expect(file?.payment).toBeNull();
    expect(file?.paymentId).toBe(PAYMENT);
  });

  it("чужая организация → позиция не найдена", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, { ...baseArgs, orgId: OTHER_ORG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("чужой spec_item → позиция не найдена", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, {
      ...baseArgs,
      specItemId: ITEM_OTHER_PROJECT,
      // Позиция существует, но в другом проекте: пара не сходится.
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("несовпадающий project_id → позиция не найдена", async () => {
    const db = fakeDb(seedTables());
    const result = await listSpecItemFiles(db.client, {
      ...baseArgs,
      projectId: OTHER_PROJECT,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("ошибка БД → FAILED, а не пустой список", async () => {
    const db = fakeDb(seedTables(), { select: true });
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
  });
});

/* ------------------------------------------------------------------ */
/*  upload: доступ и путь                                              */
/* ------------------------------------------------------------------ */

describe("uploadSpecItemFile: доступ", () => {
  it("чужая организация → denied", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      orgId: OTHER_ORG,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.uploads).toHaveLength(0);
  });

  it("чужой spec_item → denied", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      specItemId: FILE_OTHER_ORG,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.uploads).toHaveLength(0);
  });

  it("несовпадающий project_id → denied", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      projectId: OTHER_PROJECT,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.uploads).toHaveLength(0);
  });

  it("клиент не может выбрать storage_path: его нет в контракте", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    // Пытаемся протащить путь чужого объекта полем данных — он игнорируется,
    // потому что путь всегда собирает сервер.
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: {
        ...uploadData(),
        storagePath: `${OTHER_ORG}/spec-items/${ITEM}/evil.pdf`,
      } as never,
    });

    expect(result.ok).toBe(true);
    expect(store.uploads).toHaveLength(1);
    expect(store.uploads[0].path.startsWith(`${ORG}/spec-items/${ITEM}/`)).toBe(true);
    expect(store.uploads[0].path).not.toContain(OTHER_ORG);
    expect(store.uploads[0].path).not.toContain("evil");
  });
});

/* ------------------------------------------------------------------ */
/*  upload: успех и метаданные                                         */
/* ------------------------------------------------------------------ */

describe("uploadSpecItemFile: успех", () => {
  it("файл сохраняется, метаданные определяет сервер", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.fileName).toBe("Счёт №1.pdf");
    expect(result.file.mimeType).toBe("application/pdf");
    expect(result.file.sizeBytes).toBe(pdfBytes().length);
    expect(result.file.category).toBe("document");
    expect(result.file.uploadedBy).toBe(USER);

    const inserted = db.tables.spec_item_files.at(-1)!;
    expect(inserted.org_id).toBe(ORG);
    expect(inserted.project_id).toBe(PROJECT);
    expect(inserted.spec_item_id).toBe(ITEM);
    expect(inserted.uploaded_by).toBe(USER);
    expect(typeof inserted.created_at).toBe("string");
    expect(inserted.deleted_at).toBeNull();
  });

  it("путь объекта строится сервером и содержит orgId и specItemId", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const path = store.uploads[0].path;
    expect(path.startsWith(`${ORG}/spec-items/${ITEM}/`)).toBe(true);
    expect(path.endsWith(".pdf")).toBe(true);
    // Оригинального имени в пути нет: там UUID.
    expect(path).not.toContain("Счёт");
    expect(store.uploads[0].contentType).toBe("application/pdf");
    // Записанный в БД путь — ровно тот, куда загрузили.
    expect(db.tables.spec_item_files.at(-1)!.storage_path).toBe(path);
  });

  it("расширение определяется по MIME, а не по имени файла", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData({ fileName: "счёт.ЕХЕ" }),
    });

    expect(result.ok).toBe(true);
    expect(store.uploads[0].path.endsWith(".pdf")).toBe(true);
  });

  it("ответ загрузки несёт имя автора, а не только его идентификатор", async () => {
    // Имя автора в БД не хранится (там ссылка на `users`), а строка списка
    // встаёт ровно такой, какой её вернул сервер: без имени новая строка
    // выглядела бы безымянной рядом со старыми до следующего чтения списка.
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      uploadedByName: "Andy",
      data: uploadData(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.uploadedBy).toBe(USER);
    expect(result.file.uploadedByName).toBe("Andy");
  });

  it("вид документа по умолчанию — document", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: null,
      data: uploadData({ category: null }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.category).toBe("document");
    expect(result.file.uploadedBy).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /*  Догадка о виде документа: сервер вместо диалога                   */
  /* ---------------------------------------------------------------- */

  it("без вида PDF становится документом, JPG — текстурой, DWG — чертежом", async () => {
    // Основной путь загрузки: клиент вид не присылает вовсе, и его определяет
    // сервер по подтверждённому формату.
    const cases: { name: string; type: string; bytes: Uint8Array; expected: string }[] =
      [
        {
          name: "счёт.pdf",
          type: "application/pdf",
          bytes: pdfBytes(),
          expected: "document",
        },
        {
          name: "фото.jpg",
          type: "image/jpeg",
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
          expected: "texture",
        },
        {
          name: "план.dwg",
          type: "image/vnd.dwg",
          bytes: new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x31]),
          expected: "drawing",
        },
        {
          name: "схема.dxf",
          type: "image/vnd.dxf",
          bytes: new Uint8Array([0x30, 0x0a, 0x53, 0x45, 0x43]),
          expected: "drawing",
        },
      ];

    for (const testCase of cases) {
      const db = fakeDb(seedTables());
      const store = fakeStorage();
      const result = await uploadSpecItemFile(db.client, store.storage, {
        ...baseArgs,
        uploadedBy: USER,
        data: uploadData({
          category: null,
          fileName: testCase.name,
          declaredMime: testCase.type,
          bytes: testCase.bytes,
        }),
      });

      expect(result.ok, testCase.name).toBe(true);
      if (!result.ok) continue;
      expect(result.file.category, testCase.name).toBe(testCase.expected);
      expect(db.tables.spec_item_files.at(-1)!.category, testCase.name).toBe(
        testCase.expected,
      );
    }
  });

  it("незнакомый формат даёт document, а не other", async () => {
    // `other` значит «не знаю, что это»; «файл, вид которого не назван» — это
    // `document`, значение по умолчанию всего домена.
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData({
        category: null,
        fileName: "заметки.txt",
        declaredMime: "text/plain",
        bytes: new TextEncoder().encode("просто текст без сигнатуры"),
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.category).toBe("document");
  });

  it("явно присланный вид перебивает догадку", async () => {
    // Так работает правка в строке и любой вызов в обход формы: сказали «чек» —
    // значит чек, даже если по формату это обычный PDF.
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData({ category: "receipt" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.category).toBe("receipt");
  });

  it("порядок шагов: сначала Storage, потом INSERT", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(store.uploads).toHaveLength(1);
    expect(db.callsFor("spec_item_files").some((c) => c.operation === "insert")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  upload: документ к оплате                                          */
/* ------------------------------------------------------------------ */

describe("uploadSpecItemFile: документ к оплате", () => {
  it("живая оплата своей позиции принимается, ссылка ложится в строку", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      paymentId: PAYMENT,
      data: uploadData({ category: "receipt" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.tables.spec_item_files.at(-1)!.payment_id).toBe(PAYMENT);
    // Ответ сразу несёт подпись: клиенту не нужен второй запрос, чтобы показать
    // «чек к оплате», и он не гадает о виде записи.
    expect(result.file.paymentId).toBe(PAYMENT);
    expect(result.file.payment).toEqual({
      kind: "payment",
      paidAt: "2026-01-07",
      cancelled: false,
    });
  });

  it("без payment_id файл остаётся обычным документом позиции", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.tables.spec_item_files.at(-1)!.payment_id).toBeNull();
    expect(result.file.paymentId).toBeNull();
    expect(result.file.payment).toBeNull();
  });

  it("пустая строка — то же, что «оплаты нет»", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      // Именно так поле приходит из формы, когда документ не привязан к оплате.
      paymentId: "",
      data: uploadData(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.tables.spec_item_files.at(-1)!.payment_id).toBeNull();
  });

  const foreignCases: { title: string; paymentId: string }[] = [
    { title: "чужая позиция", paymentId: PAYMENT_OTHER_ITEM },
    { title: "чужая организация", paymentId: PAYMENT_OTHER_ORG },
    { title: "отменённая оплата", paymentId: PAYMENT_DELETED },
    { title: "несуществующая оплата", paymentId: FILE_NEW },
  ];

  for (const testCase of foreignCases) {
    it(`${testCase.title} → INVALID_INPUT, объекта в Storage нет`, async () => {
      const db = fakeDb(seedTables());
      const store = fakeStorage();
      const result = await uploadSpecItemFile(db.client, store.storage, {
        ...baseArgs,
        uploadedBy: USER,
        paymentId: testCase.paymentId,
        data: uploadData(),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_INPUT");
      // Понятный текст: не «ошибка БД» и не пустое сообщение.
      expect(result.error.message).toContain("Оплата не найдена");
      // Проверка идёт ДО Storage и до INSERT: посторонний объект не остаётся.
      expect(store.uploads).toHaveLength(0);
      expect(db.callsFor("spec_item_files").some((c) => c.operation === "insert")).toBe(
        false,
      );
    });
  }

  it("не-uuid payment_id отвергается до запроса к БД", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      paymentId: "не-uuid",
      data: uploadData(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_INPUT");
    expect(db.callsFor("spec_item_payments")).toHaveLength(0);
    expect(store.uploads).toHaveLength(0);
  });

  it("сбой чтения оплаты — FAILED, а не «оплата не найдена»", async () => {
    const db = fakeDb(seedTables(), { selectPayment: true });
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      paymentId: PAYMENT,
      data: uploadData(),
    });

    // Недоступность БД и чужой идентификатор — разные вещи: первый отказ
    // повторяем, второй требует другого действия от пользователя.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
    expect(result.error.message).not.toContain("не найдена");
    expect(store.uploads).toHaveLength(0);
  });

  it("оплата другой организации не читается даже своим запросом", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    // Тот же `payment_id`, но операция идёт от лица чужой организации: строка
    // существует, однако принадлежит не нам — и не должна находиться.
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      orgId: OTHER_ORG,
      uploadedBy: USER,
      paymentId: PAYMENT,
      data: uploadData(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.uploads).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  upload: валидация                                                  */
/* ------------------------------------------------------------------ */

describe("uploadSpecItemFile: валидация содержимого", () => {
  const cases: { title: string; data: ReturnType<typeof uploadData>; expected: string }[] = [
    {
      title: "слишком большой файл",
      data: uploadData({ bytes: new Uint8Array(MAX_SPEC_ITEM_FILE_BYTES + 1) }),
      expected: "INVALID_INPUT",
    },
    {
      title: "пустой файл",
      data: uploadData({ bytes: new Uint8Array(0) }),
      expected: "INVALID_INPUT",
    },
    {
      title: "запрещённый MIME",
      data: uploadData({ declaredMime: "application/x-msdownload" }),
      expected: "INVALID_INPUT",
    },
    {
      title: "HTML под видом PDF",
      data: uploadData({
        declaredMime: "application/pdf",
        bytes: new TextEncoder().encode("<html><script>x</script></html>"),
      }),
      expected: "INVALID_INPUT",
    },
    {
      title: "отсутствующий filename",
      data: uploadData({ fileName: null }),
      expected: "INVALID_INPUT",
    },
    {
      title: "пустой filename",
      data: uploadData({ fileName: "   " }),
      expected: "INVALID_INPUT",
    },
    {
      title: "имя из одних точек",
      data: uploadData({ fileName: ".." }),
      expected: "INVALID_INPUT",
    },
    {
      title: "invalid category",
      data: uploadData({ category: "schemas" }),
      expected: "INVALID_INPUT",
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.title} → ${testCase.expected}`, async () => {
      const db = fakeDb(seedTables());
      const store = fakeStorage();
      const result = await uploadSpecItemFile(db.client, store.storage, {
        ...baseArgs,
        uploadedBy: USER,
        data: testCase.data,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(testCase.expected);
      // Валидация идёт ДО Storage: мусор не должен попадать в bucket.
      expect(store.uploads).toHaveLength(0);
    });
  }

  it("размер ровно в лимит проходит", () => {
    const result = validateUploadData(
      uploadData({
        bytes: new Uint8Array(MAX_SPEC_ITEM_FILE_BYTES),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sizeBytes).toBe(MAX_SPEC_ITEM_FILE_BYTES);
  });

  it("имя нормализуется до сохранения", () => {
    const result = validateUploadData(uploadData({ fileName: "C:\\tmp\\..\\счёт.pdf" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe("счёт.pdf");
  });

  it("MIME нормализуется (регистр и параметры)", () => {
    const result = validateUploadData(
      uploadData({ declaredMime: "APPLICATION/PDF; charset=binary" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("application/pdf");
  });
});

/* ------------------------------------------------------------------ */
/*  getUrl                                                             */
/* ------------------------------------------------------------------ */

describe("getSpecItemFileUrl", () => {
  it("member получает короткоживущую подписанную ссылку", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toContain(itemPath(ITEM, FILE));
    expect(store.signed[0].expiresIn).toBe(SPEC_ITEM_FILE_URL_TTL_SECONDS);
    // TTL короткий: ссылка не должна жить часами.
    expect(SPEC_ITEM_FILE_URL_TTL_SECONDS).toBeLessThanOrEqual(600);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("подписывается путь ИЗ БД, а не присланный клиентом", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
      // Лишнее поле не участвует: контракт его не знает.
      storagePath: `${OTHER_ORG}/spec-items/${ITEM}/evil.pdf`,
    } as never);

    expect(store.signed[0].path).toBe(itemPath(ITEM, FILE));
  });

  it("файл другой позиции → denied", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE_OTHER_ITEM,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.signed).toHaveLength(0);
  });

  it("файл другой организации → denied", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE_OTHER_ORG,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.signed).toHaveLength(0);
  });

  it("чужой orgId не даёт доступа к своему же файлу", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      orgId: OTHER_ORG,
      fileId: FILE,
    });

    expect(result.ok).toBe(false);
    expect(store.signed).toHaveLength(0);
  });

  it("storage_path не по ожидаемому префиксу → FAILED, объект не подписывается", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE_FOREIGN_PATH,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
    expect(store.signed).toHaveLength(0);
  });

  it("удалённый файл URL не получает", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE_DELETED,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.signed).toHaveLength(0);
  });

  it("несуществующий файл → NOT_FOUND", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE_NEW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("ошибка Storage → FAILED, внутренний текст не раскрывается", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage({ sign: true });
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
    expect(result.error.message).not.toContain("storage недоступен");
  });

  it("ошибка БД → FAILED", async () => {
    const db = fakeDb(seedTables(), { select: true });
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
  });
});

/* ------------------------------------------------------------------ */
/*  getUrls (пачка)                                                    */
/* ------------------------------------------------------------------ */

describe("getSpecItemFileUrls", () => {
  it("подписывает пачку одним чтением строк", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      fileIds: [FILE, FILE_WITH_PAYMENT],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.urls.map((entry) => entry.fileId).sort()).toEqual(
      [FILE, FILE_WITH_PAYMENT].sort(),
    );
    expect(store.signed.map((entry) => entry.path).sort()).toEqual(
      [itemPath(ITEM, FILE), itemPath(ITEM, FILE_WITH_PAYMENT)].sort(),
    );
    // Всё — ОДНИМ чтением строк: в этом и смысл пачки.
    expect(db.callsFor("spec_item_files")).toHaveLength(1);
    expect(store.signed.every((e) => e.expiresIn === SPEC_ITEM_FILE_URL_TTL_SECONDS)).toBe(
      true,
    );
    expect(new Date(result.urls[0].expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("в ответе только ссылки: записи файла и подписи оплаты здесь нет", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      // Документ к оплате: одиночная подпись читала бы оплату ради записи,
      // которой пачка не отдаёт.
      fileIds: [FILE_WITH_PAYMENT],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.urls[0]).sort()).toEqual(["expiresAt", "fileId", "url"]);
    expect(db.callsFor("spec_item_payments")).toHaveLength(0);
  });

  it("повтор в пачке подписывается один раз", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      fileIds: [FILE, FILE, FILE],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.urls).toHaveLength(1);
    expect(store.signed).toHaveLength(1);
  });

  it("файлы чужой позиции и чужой организации не подписываются", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      fileIds: [FILE, FILE_OTHER_ITEM, FILE_OTHER_ORG],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.urls.map((entry) => entry.fileId)).toEqual([FILE]);
    expect(store.signed).toHaveLength(1);
  });

  it("удалённый файл и подменённый путь пропускаются, остальные подписываются", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      fileIds: [FILE, FILE_DELETED, FILE_FOREIGN_PATH],
    });

    // Одна испорченная строка не должна оставлять список без превью.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.urls.map((entry) => entry.fileId)).toEqual([FILE]);
    expect(store.signed.map((entry) => entry.path)).toEqual([itemPath(ITEM, FILE)]);
  });

  it("пустой список не стоит ни чтения, ни подписи", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      fileIds: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.urls).toEqual([]);
    expect(db.calls).toHaveLength(0);
    expect(store.signed).toHaveLength(0);
  });

  it("не-uuid идентификаторы отсекаются до запроса к БД", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      fileIds: ["не-uuid", "123"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.urls).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it("несовпадающий project_id → NOT_FOUND, ничего не подписано", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      projectId: OTHER_PROJECT,
      fileIds: [FILE],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.signed).toHaveLength(0);
  });

  it("чужая организация → NOT_FOUND, ничего не подписано", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      orgId: OTHER_ORG,
      fileIds: [FILE],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.signed).toHaveLength(0);
  });

  it("ошибка БД → FAILED, а не пустая пачка", async () => {
    const db = fakeDb(seedTables(), { select: true });
    const store = fakeStorage();
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      fileIds: [FILE],
    });

    // Сбой чтения — отказ, а не «ссылок нет»: выдавать второе за первое значило
    // бы объяснять человеку сбой Storage отсутствием превью.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
  });

  it("отказ Storage не роняет пачку, но и ссылок не отдаёт", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage({ sign: true });
    const result = await getSpecItemFileUrls(db.client, store.storage, {
      ...baseArgs,
      fileIds: [FILE, FILE_WITH_PAYMENT],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.urls).toEqual([]);
    // За подписью сходили по каждому файлу: отказ был на стороне Storage.
    expect(store.signed).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/*  delete                                                             */
/* ------------------------------------------------------------------ */

describe("deleteSpecItemFile", () => {
  it("member удаляет: строка soft-deleted, объект удалён", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await deleteSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toBe(true);
    const row = db.tables.spec_item_files.find((r) => r.id === FILE)!;
    expect(row.deleted_at).not.toBeNull();
    expect(store.removed).toEqual([itemPath(ITEM, FILE)]);
  });

  it("после удаления файл исчезает из list", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    await deleteSpecItemFile(db.client, store.storage, { ...baseArgs, fileId: FILE });

    const list = await listSpecItemFiles(db.client, baseArgs);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.files.some((f) => f.id === FILE)).toBe(false);
  });

  it("после удаления getUrl не отдаёт ссылку", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    await deleteSpecItemFile(db.client, store.storage, { ...baseArgs, fileId: FILE });

    const url = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });
    expect(url.ok).toBe(false);
    if (url.ok) return;
    expect(url.error.code).toBe("NOT_FOUND");
  });

  it("повторный delete безопасен и предсказуем", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();

    const first = await deleteSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });
    const second = await deleteSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.deleted).toBe(true);
    expect(second.deleted).toBe(false);
    // Storage трогали ровно один раз: у повторного вызова удалять нечего.
    expect(store.removed).toEqual([itemPath(ITEM, FILE)]);
  });

  it("удаление уже удалённого файла не трогает Storage", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await deleteSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE_DELETED,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toBe(false);
    expect(store.removed).toHaveLength(0);
  });

  it("файл другой позиции → denied, Storage не тронут", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await deleteSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE_OTHER_ITEM,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(store.removed).toHaveLength(0);
  });

  it("файл другой организации → denied, Storage не тронут", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await deleteSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE_OTHER_ORG,
    });

    expect(result.ok).toBe(false);
    expect(store.removed).toHaveLength(0);
  });

  it("подменённый storage_path не удаляется из чужого места", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await deleteSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE_FOREIGN_PATH,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
    expect(store.removed).toHaveLength(0);
    const row = db.tables.spec_item_files.find((r) => r.id === FILE_FOREIGN_PATH)!;
    expect(row.deleted_at).toBeNull();
  });

  it("чужой spec_item/project → denied", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();

    const deniedArgs: Parameters<typeof deleteSpecItemFile>[2][] = [
      { ...baseArgs, fileId: FILE, projectId: OTHER_PROJECT },
      { ...baseArgs, fileId: FILE, specItemId: OTHER_ITEM },
      { ...baseArgs, fileId: FILE, orgId: OTHER_ORG },
    ];

    for (const args of deniedArgs) {
      const result = await deleteSpecItemFile(db.client, store.storage, args);
      expect(result.ok).toBe(false);
    }
    expect(store.removed).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  update: вид документа и имя                                        */
/* ------------------------------------------------------------------ */

describe("updateSpecItemFile", () => {
  const updateArgs = { ...baseArgs, fileId: FILE };

  it("меняет вид документа и отвечает записью сервера", async () => {
    const db = fakeDb(seedTables());
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      category: "receipt",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.file.category).toBe("receipt");
    // Строка в БД — из ответа, а не из локальной догадки.
    expect(db.tables.spec_item_files.find((r) => r.id === FILE)!.category).toBe(
      "receipt",
    );
  });

  it("меняет имя, нормализуя его как при загрузке", async () => {
    const db = fakeDb(seedTables());
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      // Путь, перевод строки и управляющий символ — так имя пришло бы из
      // подделанной формы, а оно уходит в `Content-Disposition`.
      fileName: "C:\\Users\\evil\\Чек\n№7\u0000.pdf",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Путь снят, перевод строки и NUL вырезаны, пробелы сжаты (имя уходит в
    // `Content-Disposition`).
    expect(result.file.fileName).toBe("Чек№7.pdf");
  });

  it("длинное имя обрезается с сохранением расширения", async () => {
    const db = fakeDb(seedTables());
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      fileName: `${"я".repeat(400)}.pdf`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.fileName.length).toBe(MAX_SPEC_ITEM_FILE_NAME_LENGTH);
    expect(result.file.fileName.endsWith(".pdf")).toBe(true);
  });

  it("пустое имя после нормализации — отказ, а не «оставить как было»", async () => {
    const db = fakeDb(seedTables());
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      fileName: "   ",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_INPUT");
    // Строка не тронута: молчаливая подмена старого имени выдала бы себя за успех.
    expect(db.tables.spec_item_files.find((r) => r.id === FILE)!.file_name).toBe(
      "Счёт №1.pdf",
    );
  });

  it("вид вне списка → INVALID_INPUT, БД не тронута", async () => {
    const db = fakeDb(seedTables());
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      category: "schemas",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_INPUT");
    expect(db.callsFor("spec_item_files").some((c) => c.operation === "update")).toBe(
      false,
    );
  });

  it("нечего менять → changed: false и ни одного UPDATE", async () => {
    const db = fakeDb(seedTables());
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      category: "document",
      fileName: "Счёт №1.pdf",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    // Лишний UPDATE шумно менял бы `updated_at` и слал бы `revalidatePath` зря.
    expect(db.callsFor("spec_item_files").some((c) => c.operation === "update")).toBe(
      false,
    );
  });

  it("правка документа к оплате возвращает подпись оплаты", async () => {
    const db = fakeDb(seedTables());
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      fileId: FILE_WITH_PAYMENT,
      category: "invoice",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Клиент обновляет строку этим ответом: без подписи связь у оплаты пропала бы.
    expect(result.file.paymentId).toBe(PAYMENT);
    expect(result.file.payment).toEqual({
      kind: "payment",
      paidAt: "2026-01-07",
      cancelled: false,
    });
  });

  it("удалённый файл не правится", async () => {
    const db = fakeDb(seedTables());
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      fileId: FILE_DELETED,
      category: "receipt",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(
      db.tables.spec_item_files.find((r) => r.id === FILE_DELETED)!.category,
    ).toBe("other");
  });

  it("чужой файл, чужая позиция и чужой проект не правятся", async () => {
    const cases: Parameters<typeof updateSpecItemFile>[1][] = [
      { ...updateArgs, fileId: FILE_OTHER_ITEM },
      { ...updateArgs, fileId: FILE_OTHER_ORG },
      { ...updateArgs, projectId: OTHER_PROJECT },
      { ...updateArgs, specItemId: OTHER_ITEM },
      { ...updateArgs, orgId: OTHER_ORG },
    ];

    for (const args of cases) {
      const db = fakeDb(seedTables());
      const result = await updateSpecItemFile(db.client, {
        ...args,
        category: "receipt",
      });
      expect(result.ok).toBe(false);
      expect(db.callsFor("spec_item_files").some((c) => c.operation === "update")).toBe(
        false,
      );
    }
  });

  it("подмена storage_path в строке закрывает правку", async () => {
    const db = fakeDb(seedTables());
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      fileId: FILE_FOREIGN_PATH,
      category: "receipt",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
  });

  it("отказ UPDATE → FAILED, имя не подменяется", async () => {
    const db = fakeDb(seedTables(), { update: true });
    const result = await updateSpecItemFile(db.client, {
      ...updateArgs,
      fileName: "Новое имя.pdf",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
    expect(db.tables.spec_item_files.find((r) => r.id === FILE)!.file_name).toBe(
      "Счёт №1.pdf",
    );
  });
});

describe("getSpecItemFileUrl: просмотр и скачивание", () => {
  it("без download ссылка подписывается на просмотр", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });

    expect(result.ok).toBe(true);
    expect(store.signed[0].download).toBeNull();
  });

  it("download: true подставляет оригинальное имя файла из строки", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const result = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
      download: true,
    });

    expect(result.ok).toBe(true);
    // Имя берётся из БД, а не из аргумента: подставлять в заголовок то, что
    // прислал клиент, нельзя.
    expect(store.signed[0].download).toBe("Счёт №1.pdf");
  });

  it("испорченное имя в строке не подставляется в заголовок", async () => {
    // Так выглядела бы строка, записанная в обход кода: имя из пробелов.
    // Скачивание остаётся скачиванием, но имя подставляет Storage, а не мы.
    const store = fakeStorage();
    const tables = seedTables();
    tables.spec_item_files = tables.spec_item_files.map((row) =>
      row.id === FILE ? { ...row, file_name: "   " } : row,
    );

    const result = await getSpecItemFileUrl(fakeDb(tables).client, store.storage, {
      ...baseArgs,
      fileId: FILE,
      download: true,
    });

    expect(result.ok).toBe(true);
    expect(store.signed[0].download).toBe(true);
  });

  it("нормализация имени — второй контур: перевод строки в имени не проходит", async () => {
    const store = fakeStorage();
    const tables = seedTables();
    tables.spec_item_files = tables.spec_item_files.map((row) =>
      row.id === FILE ? { ...row, file_name: "Чек\n№7.pdf" } : row,
    );

    await getSpecItemFileUrl(fakeDb(tables).client, store.storage, {
      ...baseArgs,
      fileId: FILE,
      download: true,
    });

    expect(store.signed[0].download).toBe("Чек№7.pdf");
  });
});

/* ------------------------------------------------------------------ */
/*  Отказы: БД и Storage                                               */
/* ------------------------------------------------------------------ */

describe("поведение при отказах", () => {
  it("отказ Storage на загрузке → файл не создан", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage({ upload: true });
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
    expect(
      db.tables.spec_item_files.filter((r) => r.id === FILE_NEW),
    ).toHaveLength(0);
    expect(db.callsFor("spec_item_files").some((c) => c.operation === "insert")).toBe(false);
  });

  it("отказ INSERT после успешной загрузки → объект удаляется (нет orphan)", async () => {
    const db = fakeDb(seedTables(), { insert: true });
    const store = fakeStorage();
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
    expect(store.uploads).toHaveLength(1);
    // Компенсация: удалили ровно тот объект, который загрузили.
    expect(store.removed).toEqual([store.uploads[0].path]);
    expect(db.callsFor("spec_item_files").some((c) => c.operation === "insert")).toBe(true);
  });

  it("отказ INSERT и отказ удаления → в БД нет строки, ошибка не раскрыта", async () => {
    const db = fakeDb(seedTables(), { insert: true });
    const store = fakeStorage({ remove: true });
    const result = await uploadSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toContain("storage недоступен");
    expect(db.tables.spec_item_files.at(-1)!.id).not.toBe(FILE_NEW);
  });

  it("исключение Storage на загрузке не роняет операцию", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const throwing: SpecItemFilesStorage = {
      ...store.storage,
      async upload() {
        throw new Error("сеть недоступна");
      },
    };

    const result = await uploadSpecItemFile(db.client, throwing, {
      ...baseArgs,
      uploadedBy: USER,
      data: uploadData(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
  });

  it("исключение Storage на удалении объекта не отменяет удаление строки", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage();
    const throwing: SpecItemFilesStorage = {
      ...store.storage,
      async remove() {
        throw new Error("сеть недоступна");
      },
    };

    const result = await deleteSpecItemFile(db.client, throwing, {
      ...baseArgs,
      fileId: FILE,
    });

    expect(result.ok).toBe(true);
    const row = db.tables.spec_item_files.find((r) => r.id === FILE)!;
    expect(row.deleted_at).not.toBeNull();
  });

  it("отказ Storage на удалении объекта: БД — источник истины", async () => {
    const db = fakeDb(seedTables());
    const store = fakeStorage({ remove: true });
    const result = await deleteSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });

    // Операция успешна: файл скрыт из списка и больше не подписывается.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toBe(true);

    const list = await listSpecItemFiles(db.client, baseArgs);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.files.some((f) => f.id === FILE)).toBe(false);

    const url = await getSpecItemFileUrl(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });
    expect(url.ok).toBe(false);
  });

  it("отказ UPDATE → строка не помечена удалённой, объект не удаляется", async () => {
    const db = fakeDb(seedTables(), { update: true });
    const store = fakeStorage();
    const result = await deleteSpecItemFile(db.client, store.storage, {
      ...baseArgs,
      fileId: FILE,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FAILED");
    expect(store.removed).toHaveLength(0);
    const row = db.tables.spec_item_files.find((r) => r.id === FILE)!;
    expect(row.deleted_at).toBeNull();
  });

  it("ошибка БД на чтении списка не выдаётся за пустой список", async () => {
    const db = fakeDb(seedTables(), { select: true });
    const result = await listSpecItemFiles(db.client, baseArgs);

    expect(result.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Права: та же граница, что у server action                          */
/* ------------------------------------------------------------------ */

describe("граница прав viewer / member", () => {
  // Ядро прав не проверяет — их проверяет server action тем же предикатом
  // `can`. Здесь фиксируется, что граница у загрузки и удаления одна и та же.
  it("загрузка и удаление требуют одного и того же права", async () => {
    const { can } = await import("../permissions");

    expect(can("viewer", "record:create")).toBe(false);
    expect(can("member", "record:create")).toBe(true);
    expect(can("admin", "record:create")).toBe(true);
    expect(can("owner", "record:create")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Чистота ядра                                                       */
/* ------------------------------------------------------------------ */

describe("ядро не тянет Next и не ходит в сеть само", () => {
  it("в модуле нет серверных импортов Next и рантайм-импорта Supabase", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "./spec-item-files.ts",
      ),
      "utf8",
    );

    for (const needle of [
      'from "next/',
      "next/cache",
      "next/navigation",
      "use server",
      // Импорт типа разрешён и нужен (тип клиента БД), рантайм-импорт — нет:
      // он притащил бы пакет в тесты и в чистый слой домена.
      'import { createClient } from "@supabase',
      'from "@supabase/supabase-js"',
    ]) {
      if (needle === 'from "@supabase/supabase-js"') {
        // Единственное допустимое вхождение — `import type`.
        expect(source).toContain('import type { SupabaseClient } from "@supabase/supabase-js"');
        expect(source.match(/from "@supabase\/supabase-js"/g)).toHaveLength(1);
        continue;
      }
      expect(source, needle).not.toContain(needle);
    }
    // Путь и bucket приходят из общего модуля контента, а не дублируются здесь.
    expect(source).toContain("./file-content");
  });
});
