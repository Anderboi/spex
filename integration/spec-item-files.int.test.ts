import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MAX_SPEC_ITEM_FILE_BYTES,
  SPEC_ITEM_FILES_BUCKET,
} from "../lib/spec/file-content";
import {
  deleteSpecItemFile,
  getSpecItemFileUrl,
  listSpecItemFiles,
  uploadSpecItemFile,
  type SpecItemFilesStorage,
} from "../lib/spec/spec-item-files";

/**
 * Интеграционный тест файлов позиции: ЖИВАЯ БД и ЖИВОЙ Storage linked-проекта.
 *
 * ── Почему отдельный файл и отдельный конфиг ───────────────────────────────
 *
 * Этот тест пишет в реальную БД и реально загружает объект в Storage, поэтому он
 * НЕ входит в `npm test` (см. `vitest.integration.config.mts`) и запускается
 * только вручную:
 *
 *   npx vitest run --config vitest.integration.config.mts
 *
 * ── Что проверяется ────────────────────────────────────────────────────────
 *
 * Ровно то, что unit-тесты проверить не могут: реальные DDL-ограничения, реальные
 * Storage-политики, работающий signed URL, поведение приватного bucket'а.
 *
 * ── Безопасность данных ────────────────────────────────────────────────────
 *
 * Цель — существующая позиция организации «MINIMAL» (тестовая организация
 * проекта), выбранная явно, а не «первая попавшаяся». Тест создаёт ОДНУ строку и
 * ОДИН объект и убирает за собой:
 *
 *   * строка удаляется мягко самим `deleteSpecItemFile` (это и есть проверка
 *     мягкого удаления) и дополнительно физически — в `afterAll`, чтобы в
 *     `spec_item_files` не оставалось мусора от прогонов;
 *   * объект удаляется через Storage API, даже если soft-delete уже его убрал
 *     (повторное удаление безопасно);
 *   * ничего, кроме этой строки и объекта, не создаётся и не меняется.
 *
 * Порядок шагов внутри файла — последовательный: Vitest выполняет тесты одного
 * файла по порядку, а конфиг дополнительно закрепляет один воркер.
 */

/* ------------------------------------------------------------------ */
/*  Окружение                                                          */
/* ------------------------------------------------------------------ */

const ENV_PATH = resolve(process.cwd(), ".env.local");
if (existsSync(ENV_PATH)) {
  // Node 20.6+: свой загрузчик .env, без дополнительной зависимости.
  process.loadEnvFile(ENV_PATH);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Цель прогона. Организация «MINIMAL» — тестовая: 5 проектов, ни одной строки
 * файлов на момент проверки. Позиция выбрана явно, чтобы прогон был
 * воспроизводимым, а не зависел от порядка строк в БД.
 */
const TARGET = {
  orgId: "a0a3fc2f-4bc6-4088-ab7c-68b70acb1e3c",
  projectId: "103ba9fe-43e1-4f00-919d-2cf9d7d37281",
  specItemId: "15753bce-598e-4fc8-ae8e-f6df837fc047",
};

/** Соседняя позиция того же проекта — для проверки «файл другой позиции». */
const NEIGHBOUR_ITEM = "a48a8c82-5556-4f66-8c92-a108c8c4e68a";

/** Чужая организация для проверки cross-org. */
const OTHER_ORG = "62a172b9-314a-4975-8420-f550f2a4417c";

/** Другая позиция/проект той же организации — для проверки несовпадения проекта. */
const OTHER_PROJECT = "8f029934-7a98-4542-b500-730f82d6913a";

const PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n",
);
const FILE_NAME = "ПРОВЕРКА ФАЙЛОВ (тест).pdf";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Тот же адаптер, что в server action: узкий интерфейс вокруг Storage API. */
const storage: SpecItemFilesStorage = {
  async upload({ path, bytes, contentType }) {
    const { error } = await admin.storage
      .from(SPEC_ITEM_FILES_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    return { error: error ? { message: error.message } : null };
  },
  async remove(path) {
    const { error } = await admin.storage
      .from(SPEC_ITEM_FILES_BUCKET)
      .remove([path]);
    return { error: error ? { message: error.message } : null };
  },
  async createSignedUrl({ path, expiresIn }) {
    const { data, error } = await admin.storage
      .from(SPEC_ITEM_FILES_BUCKET)
      .createSignedUrl(path, expiresIn);
    return {
      data: data?.signedUrl ? { signedUrl: data.signedUrl } : null,
      error: error ? { message: error.message } : null,
    };
  },
};

const baseArgs = {
  orgId: TARGET.orgId,
  projectId: TARGET.projectId,
  specItemId: TARGET.specItemId,
};

/** Состояние прогона: заполняется по шагам, убирается в `afterAll`. */
const created = {
  id: null as string | null,
  storagePath: null as string | null,
};

beforeAll(() => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Интеграционный тест требует NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local",
    );
  }
});

afterAll(async () => {
  // 1. Строка: физически, чтобы прогоны не копили мусор в spec_item_files.
  if (created.id) {
    const { error } = await admin
      .from("spec_item_files")
      .delete()
      .eq("id", created.id);
    if (error) console.error("[integration] cleanup row", error.message);
  }

  // 2. Объект: повторное удаление безопасно (soft-delete уже мог его убрать).
  if (created.storagePath) {
    const { error } = await admin.storage
      .from(SPEC_ITEM_FILES_BUCKET)
      .remove([created.storagePath]);
    if (error) console.error("[integration] cleanup object", error.message);
  }
});

/* ------------------------------------------------------------------ */
/*  1-3. list → upload → list                                          */
/* ------------------------------------------------------------------ */

describe("smoke: list → upload → list", () => {
  it("позиция существует в БД и доступна организации", async () => {
    const { data, error } = await admin
      .from("spec_items")
      .select("id, org_id, project_id, deleted_at")
      .eq("id", TARGET.specItemId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.org_id).toBe(TARGET.orgId);
    expect(data!.project_id).toBe(TARGET.projectId);
    expect(data!.deleted_at).toBeNull();
  });

  it("до загрузки файлов у позиции нет", async () => {
    const result = await listSpecItemFiles(admin, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toEqual([]);
  });

  it("upload небольшого разрешённого файла", async () => {
    const result = await uploadSpecItemFile(admin, storage, {
      ...baseArgs,
      uploadedBy: null,
      data: {
        bytes: PDF,
        fileName: FILE_NAME,
        declaredMime: "application/pdf",
        category: "document",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    created.id = result.file.id;
    expect(result.file.fileName).toBe(FILE_NAME);
    expect(result.file.mimeType).toBe("application/pdf");
    expect(result.file.sizeBytes).toBe(PDF.length);
    expect(result.file.category).toBe("document");

    // Путь в БД — ровно тот, что ждёт код, и в нём нет оригинального имени.
    const { data, error } = await admin
      .from("spec_item_files")
      .select("storage_path, org_id, project_id, spec_item_id, deleted_at")
      .eq("id", created.id)
      .single();

    expect(error).toBeNull();
    created.storagePath = data!.storage_path;
    expect(data!.storage_path).toBe(
      `${TARGET.orgId}/spec-items/${TARGET.specItemId}/${created.id}.pdf`,
    );
    expect(data!.storage_path).not.toContain("ПРОВЕРКА");
    expect(data!.org_id).toBe(TARGET.orgId);
    expect(data!.project_id).toBe(TARGET.projectId);
    expect(data!.spec_item_id).toBe(TARGET.specItemId);
    expect(data!.deleted_at).toBeNull();
  });

  it("list показывает загруженный файл", async () => {
    const result = await listSpecItemFiles(admin, baseArgs);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.id)).toContain(created.id);
    const entry = result.files.find((f) => f.id === created.id)!;
    expect(entry.fileName).toBe(FILE_NAME);
    // Контракт: ни пути, ни URL в списке.
    expect(JSON.stringify(entry)).not.toContain("storage_path");
    expect(JSON.stringify(entry)).not.toContain("storagePath");
  });

  it("объект реально лежит в приватном bucket'е", async () => {
    const { data, error } = await admin.storage
      .from(SPEC_ITEM_FILES_BUCKET)
      .list(`${TARGET.orgId}/spec-items/${TARGET.specItemId}`, { limit: 100 });

    expect(error).toBeNull();
    const names = (data ?? []).map((entry) => entry.name);
    expect(names).toContain(`${created.id}.pdf`);
  });
});

/* ------------------------------------------------------------------ */
/*  4-5. getUrl: работающий signed URL и TTL                           */
/* ------------------------------------------------------------------ */

describe("smoke: signed URL", () => {
  let url = "";
  let expiresAt = "";

  it("getUrl возвращает ссылку с ожидаемым TTL (5 минут)", async () => {
    const result = await getSpecItemFileUrl(admin, storage, {
      ...baseArgs,
      fileId: created.id!,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    url = result.url;
    expiresAt = result.expiresAt;

    expect(url).toContain("/storage/v1/object/sign/");
    expect(url).toContain(SPEC_ITEM_FILES_BUCKET);
    expect(url).toContain(created.storagePath!);

    // TTL: ссылка живёт 5 минут, не больше 10 — и `expiresAt` согласован с ним.
    const ttlMs = new Date(expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(4 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(300 * 1000);
  });

  it("signed URL реально отдаёт содержимое файла", async () => {
    const response = await fetch(url);

    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(PDF.length);
    expect(new TextDecoder().decode(body.slice(0, 8))).toBe("%PDF-1.4");
  });

  it("bucket приватный: публичный URL без подписи не работает", async () => {
    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/${SPEC_ITEM_FILES_BUCKET}/${created.storagePath}`,
    );

    expect(response.status).not.toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  6-7. delete                                                        */
/* ------------------------------------------------------------------ */

describe("smoke: delete", () => {
  it("delete скрывает файл из list", async () => {
    const before = await listSpecItemFiles(admin, baseArgs);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.files.map((f) => f.id)).toContain(created.id);

    const result = await deleteSpecItemFile(admin, storage, {
      ...baseArgs,
      fileId: created.id!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toBe(true);

    const after = await listSpecItemFiles(admin, baseArgs);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.files.map((f) => f.id)).not.toContain(created.id);

    // Мягкое удаление: строка на месте, `deleted_at` заполнен.
    const { data } = await admin
      .from("spec_item_files")
      .select("deleted_at")
      .eq("id", created.id!)
      .single();
    expect(data!.deleted_at).not.toBeNull();
  });

  it("после delete getUrl не выдаёт ссылку", async () => {
    const result = await getSpecItemFileUrl(admin, storage, {
      ...baseArgs,
      fileId: created.id!,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("повторный delete предсказуем: deleted = false", async () => {
    const result = await deleteSpecItemFile(admin, storage, {
      ...baseArgs,
      fileId: created.id!,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Security: изоляция                                                 */
/* ------------------------------------------------------------------ */

describe("security: изоляция", () => {
  it("чужая организация не видит позицию (list/upload/getUrl/delete)", async () => {
    const otherOrgArgs = { ...baseArgs, orgId: OTHER_ORG };

    const list = await listSpecItemFiles(admin, otherOrgArgs);
    const upload = await uploadSpecItemFile(admin, storage, {
      ...otherOrgArgs,
      uploadedBy: null,
      data: {
        bytes: PDF,
        fileName: "чужой.pdf",
        declaredMime: "application/pdf",
        category: "document",
      },
    });
    const url = await getSpecItemFileUrl(admin, storage, {
      ...otherOrgArgs,
      fileId: created.id!,
    });
    const remove = await deleteSpecItemFile(admin, storage, {
      ...otherOrgArgs,
      fileId: created.id!,
    });

    for (const result of [list, upload, url, remove]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("несовпадающий project_id отвергается", async () => {
    const result = await getSpecItemFileUrl(admin, storage, {
      ...baseArgs,
      projectId: OTHER_PROJECT,
      fileId: created.id!,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("подмена fileId на файл другой позиции отвергается", async () => {
    // Файл принадлежит TARGET.specItemId; спрашиваем его от имени соседней позиции.
    const result = await getSpecItemFileUrl(admin, storage, {
      ...baseArgs,
      specItemId: NEIGHBOUR_ITEM,
      fileId: created.id!,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("удалить чужой файл через чужую позицию нельзя", async () => {
    const result = await deleteSpecItemFile(admin, storage, {
      ...baseArgs,
      specItemId: NEIGHBOUR_ITEM,
      fileId: created.id!,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");

    // Файл по-прежнему не подписывается (он soft-deleted) — состояние не
    // изменилось от чужого запроса.
    const url = await getSpecItemFileUrl(admin, storage, {
      ...baseArgs,
      fileId: created.id!,
    });
    expect(url.ok).toBe(false);
  });

  it("строка с подменённым storage_path не подписывается и не удаляется", async () => {
    // Прямая вставка строки «в обход кода»: свой org_id и spec_item_id, но путь
    // ведёт в чужую организацию. Ядро обязано отказать, не обращаясь в Storage.
    const foreignPath = `${OTHER_ORG}/spec-items/${TARGET.specItemId}/rogue.pdf`;
    const { data, error } = await admin
      .from("spec_item_files")
      .insert({
        org_id: TARGET.orgId,
        project_id: TARGET.projectId,
        spec_item_id: TARGET.specItemId,
        storage_path: foreignPath,
        file_name: "rogue.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        category: "document",
        uploaded_by: null,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    const rogueId = data!.id;

    try {
      const url = await getSpecItemFileUrl(admin, storage, {
        ...baseArgs,
        fileId: rogueId,
      });
      expect(url.ok).toBe(false);
      if (url.ok) return;
      // Строка «своя», поэтому отказ не NOT_FOUND, а FAILED: путь не тот.
      expect(url.error.code).toBe("FAILED");

      const remove = await deleteSpecItemFile(admin, storage, {
        ...baseArgs,
        fileId: rogueId,
      });
      expect(remove.ok).toBe(false);
      if (remove.ok) return;
      expect(remove.error.code).toBe("FAILED");

      // Строка по-прежнему активна: удалять чужой объект нельзя.
      const { data: still } = await admin
        .from("spec_item_files")
        .select("deleted_at")
        .eq("id", rogueId)
        .single();
      expect(still!.deleted_at).toBeNull();
    } finally {
      await admin.from("spec_item_files").delete().eq("id", rogueId);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Security: RLS через Data API (контур, не покрытый unit-тестами)     */
/* ------------------------------------------------------------------ */

describe("security: RLS Data API", () => {
  it("таблица существует и содержит нашу строку", async () => {
    const { count, error } = await admin
      .from("spec_item_files")
      .select("id", { count: "exact", head: true });

    expect(error).toBeNull();
    expect(count).toBeGreaterThan(0);
  });

  it("anon без токена не читает строки (политика выдана только authenticated)", async () => {
    const { data } = await anon.from("spec_item_files").select("id").limit(5);

    expect(data ?? []).toEqual([]);
  });

  it("anon не может вставить строку (write-политик нет по замыслу)", async () => {
    const { error } = await anon.from("spec_item_files").insert({
      org_id: TARGET.orgId,
      project_id: TARGET.projectId,
      spec_item_id: TARGET.specItemId,
      storage_path: "anon/evil.pdf",
      file_name: "evil.pdf",
      mime_type: "application/pdf",
      size_bytes: 1,
      category: "document",
    });

    expect(error).not.toBeNull();
  });

  it("anon не может загрузить объект в bucket", async () => {
    const { error } = await anon.storage
      .from(SPEC_ITEM_FILES_BUCKET)
      .upload(`anon-probe/${Date.now()}.pdf`, PDF, {
        contentType: "application/pdf",
      });

    expect(error).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Основание у планового платежа: spec_item_files.payment_plan_id     */
/* ------------------------------------------------------------------ */

/**
 * Миграция `20261012_001`: счёт, приложенный к строке графика.
 *
 * ── Что проверяется и почему только здесь ──────────────────────────────────
 *
 * Триггер проверки принадлежности и внешний ключ — объекты БД, и на подставном
 * клиенте их не проверить: unit-тесты проверяют ЯДРО (оно отвергает чужую ссылку
 * понятным текстом), а здесь — второй контур, для записи в обход кода. Правило у
 * него другое: расхождение СНИМАЕТ ссылку, а не роняет операцию, — и это ровно
 * то, что нельзя подделать заглушкой.
 *
 * ── Своя уборка ────────────────────────────────────────────────────────────
 *
 * Строки создаются здесь и убираются здесь же, до `afterAll` файла: файл с
 * непустым `payment_plan_id` не удалится, пока жива строка графика (RESTRICT,
 * ADR 0004), а строка графика не удалится, пока на неё ссылается файл.
 */
describe("миграция: payment_plan_id у файла позиции", () => {
  /** Строки графика прогона: по ним ищутся и убираются ссылки. */
  const planIds: string[] = [];
  /** Файлы прогона — чтобы убрать их раньше строк графика. */
  const fileIds: string[] = [];

  async function addPlan(over: { specItemId?: string; orgId?: string } = {}) {
    const { data, error } = await admin
      .from("spec_item_payment_plans")
      .insert({
        org_id: over.orgId ?? TARGET.orgId,
        project_id: TARGET.projectId,
        spec_item_id: over.specItemId ?? TARGET.specItemId,
        title: "ОСНОВАНИЕ (тест)",
        amount: 1000,
        position: 900,
      })
      .select("id, org_id, project_id, spec_item_id")
      .single();

    expect(error).toBeNull();
    if (!data) throw new Error("строка графика не создана");
    planIds.push(data.id);
    return data;
  }

  /** Файл строкой, а не через Storage: проверяется триггер, а не загрузка. */
  async function addFileRow(over: { paymentPlanId?: string | null } = {}) {
    const { data, error } = await admin
      .from("spec_item_files")
      .insert({
        org_id: TARGET.orgId,
        project_id: TARGET.projectId,
        spec_item_id: TARGET.specItemId,
        storage_path: `${TARGET.orgId}/spec-items/${TARGET.specItemId}/${crypto.randomUUID()}.pdf`,
        file_name: "ОСНОВАНИЕ (тест).pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        category: "invoice",
        payment_plan_id: over.paymentPlanId ?? null,
      })
      .select("id, payment_plan_id")
      .single();

    expect(error).toBeNull();
    if (!data) throw new Error("строка файла не создана");
    fileIds.push(data.id);
    return data;
  }

  afterAll(async () => {
    if (fileIds.length > 0) {
      const { error } = await admin
        .from("spec_item_files")
        .delete()
        .in("id", fileIds);
      if (error) console.error("[integration] cleanup plan files", error.message);
    }

    if (planIds.length > 0) {
      const { error } = await admin
        .from("spec_item_payment_plans")
        .delete()
        .in("id", planIds);
      if (error) console.error("[integration] cleanup plan rows", error.message);
    }
  });

  it("живая строка графика принимается: ссылка ложится в строку файла", async () => {
    const plan = await addPlan();

    const file = await addFileRow({ paymentPlanId: plan.id });

    expect(file.payment_plan_id).toBe(plan.id);
  });

  it("строка графика ЧУЖОЙ позиции: ссылка снята, а строка файла жива", async () => {
    const plan = await addPlan({ specItemId: NEIGHBOUR_ITEM });

    const file = await addFileRow({ paymentPlanId: plan.id });

    // Не ошибка, а починка: триггер обнуляет ссылку, и файл остаётся обычным
    // документом позиции — его можно открыть и удалить.
    expect(file.payment_plan_id).toBeNull();
  });

  it("несуществующая строка графика: отказ внешнего ключа, а не тихая ссылка", async () => {
    // Второй контур: у ссылки есть цель. Триггер снимает РАСХОЖДЕНИЕ, но выдумку
    // (ссылка в никуда) не пропускает ни он, ни ключ.
    const missing = crypto.randomUUID();

    const { error } = await admin.from("spec_item_files").insert({
      org_id: TARGET.orgId,
      project_id: TARGET.projectId,
      spec_item_id: TARGET.specItemId,
      storage_path: `${TARGET.orgId}/spec-items/${TARGET.specItemId}/${missing}.pdf`,
      file_name: "НИКУДА (тест).pdf",
      mime_type: "application/pdf",
      size_bytes: 10,
      category: "invoice",
      payment_plan_id: missing,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");
  });

  it("мягко удалённая строка графика принимается: счёт объясняет снятое обязательство", async () => {
    // Отличие от оплаты намеренное: документ к ОТМЕНЁННОЙ оплате ссылку не
    // принимает, а счёт к удалённой строке графика — принимает. Иначе основание
    // уже случившейся оплаты пропало бы вместе со строкой графика.
    const plan = await addPlan();
    const { error: softError } = await admin
      .from("spec_item_payment_plans")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", plan.id);
    expect(softError).toBeNull();

    const file = await addFileRow({ paymentPlanId: plan.id });

    expect(file.payment_plan_id).toBe(plan.id);
  });

  it("RESTRICT: строку графика с приложенным счётом физически не удалить", async () => {
    const plan = await addPlan();
    await addFileRow({ paymentPlanId: plan.id });

    const { error } = await admin
      .from("spec_item_payment_plans")
      .delete()
      .eq("id", plan.id);

    // ADR 0004: финансовая история не исчезает каскадом. Штатный путь снятия
    // обязательства — мягкое удаление, и оно ссылку не трогает.
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23503");
  });
});

/* ------------------------------------------------------------------ */
/*  Валидация на живом Storage                                         */
/* ------------------------------------------------------------------ */

describe("storage: лимиты и allow-list", () => {
  it("лимит размера в коде совпадает с ожидаемым значением bucket'а", async () => {
    expect(MAX_SPEC_ITEM_FILE_BYTES).toBe(26214400);
  });

  it("запрещённый тип не проходит серверную проверку и не попадает в bucket", async () => {
    const result = await uploadSpecItemFile(admin, storage, {
      ...baseArgs,
      uploadedBy: null,
      data: {
        bytes: new TextEncoder().encode("<svg onload=alert(1)></svg>"),
        fileName: "texture.svg",
        declaredMime: "image/svg+xml",
        category: "texture",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("HTML под видом PDF не проходит серверную проверку", async () => {
    const result = await uploadSpecItemFile(admin, storage, {
      ...baseArgs,
      uploadedBy: null,
      data: {
        bytes: new TextEncoder().encode("<html><script>alert(1)</script></html>"),
        fileName: "schet.pdf",
        declaredMime: "application/pdf",
        category: "document",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_INPUT");
  });
});
