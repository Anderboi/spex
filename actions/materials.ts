"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MaterialInput, materialSchema } from "@/lib/validations";
import { assertCanMutate, forbidden, scoped } from "@/lib/db/guard";
import { can, canMutateRecord } from "@/lib/permissions";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import {
  MATERIAL_TARGET_PROJECT_STATUSES,
  TYPE_ORDER,
  type SpecType,
} from "@/lib/constants";
import { prefixFor } from "@/lib/utils";
import {
  materialSupplierMirror,
  normalizeMaterialSuppliers,
  type MaterialSupplierRow,
} from "@/lib/materials/suppliers";
import { callRpc } from "@/lib/supabase/rpc";
import { nextCodesFrom } from "@/lib/spec/codes";
import {
  buildCreatedEvents,
  eventActorOf,
  recordSpecItemEvents,
} from "@/lib/spec/history";
import { getMaterialProjectTargets, type MaterialProjectTarget } from "@/lib/queries";
import { saveMaterialFavorite } from "@/lib/materials/favorites";
import { storeMaterialImage } from "@/lib/material-import/storage";
import type { TablesInsert } from "@/lib/supabase/database.types";

type ActionResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function upsertMaterial(
  orgSlug: string,
  input: MaterialInput,
): Promise<ActionResponse> {
  // const { userId, orgId, role } = await requireOrgBySlug(orgSlug);
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  const { id, suppliers: rawSuppliers, ...fields } = parsed.data as MaterialInput & {
    id?: string;
  };

  /**
   * Поставщики материала: набор чистится здесь, а не в форме.
   *
   * Пустая строка (компанию ещё не выбрали) и повтор компании отбрасываются —
   * так же, как их отбросил бы частичный уникальный индекс в БД, только без
   * ошибки констрейнта в лицо пользователю. Первая строка списка — основной
   * поставщик, и её значения уезжают в колонки материала.
   */
  const suppliers = normalizeMaterialSuppliers(rawSuppliers ?? []);

  /**
   * Зеркало основного поставщика в колонки `materials`.
   *
   * Пишется и здесь, и внутри `sync_material_suppliers`: функция владеет
   * инвариантом «список = зеркало», а этот `update` не даёт материалу остаться
   * без поставщика, если вызов функции не доехал. Материал без поставщиков
   * сохраняет собственную цену и ссылку — их зеркало не переписывает.
   */
  const mirror = materialSupplierMirror(suppliers);

  if (id) {
    const guard = await assertCanMutate(orgSlug, "materials", id);
    if (!guard.ok) return guard.response;

    const { data, error } = await guard.ctx.supabase
      .from("materials")
      .update({ ...fields, ...mirror })
      .eq("id", id)
      .eq("org_id", guard.ctx.orgId)
      .select()
      .single();

    if (error) {
      console.error("[upsertMaterial:update]", error.message);
      return {
        success: false as const,
        error: "Не удалось сохранить материал",
      };
    }

    const synced = await syncMaterialSuppliers(
      guard.ctx.supabase,
      guard.ctx.orgId,
      id,
      suppliers,
    );
    if (synced) return { success: false as const, error: synced };

    revalidatePath(`/${orgSlug}/materials`);
    // Бейдж «Материалы поставщика N» в справочнике считается по тем же связям:
    // материал мог перейти к другой компании прямо сейчас.
    revalidatePath(`/${orgSlug}/contacts`);
    return { success: true as const, data };
  }

  //* ── создание
  const ctx = await scoped(orgSlug);
  if (!can(ctx.role, "record:create")) return forbidden();

  const { data, error } = await ctx.supabase
    .from("materials")
    .insert({ ...fields, ...mirror, org_id: ctx.orgId, created_by: ctx.userId })
    .select()
    .single();

  if (error) {
    console.error("[upsertMaterial:insert]", error.message);
    return { success: false as const, error: "Не удалось создать материал" };
  }

  // Строки поставщиков пишутся после материала: у новой строки ещё нет
  // `material_id`, на который ссылается `on delete cascade`.
  const synced = await syncMaterialSuppliers(
    ctx.supabase,
    ctx.orgId,
    data.id,
    suppliers,
  );
  if (synced) return { success: false as const, error: synced };

  revalidatePath(`/${orgSlug}/materials`);
  revalidatePath(`/${orgSlug}/contacts`);
  return { success: true as const, data };
}

/**
 * Записать список поставщиков материала и пересобрать зеркало — одной транзакцией
 * (`sync_material_suppliers`, миграция 20261013_003).
 *
 * `null` вместо списка значит «набор не менялся, пересобери зеркало»: этот режим
 * нужен там, где строки потеряли компанию сами (`deleteCompany`).
 *
 * Возвращает текст ошибки либо `null` — вызывающий решает, что с ним делать.
 */
async function syncMaterialSuppliers(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  materialId: string,
  suppliers: readonly MaterialSupplierRow[] | null,
): Promise<string | null> {
  const { error } = await callRpc(supabase, "sync_material_suppliers", {
    p_org_id: orgId,
    p_material_id: materialId,
    p_suppliers: suppliers
      ? suppliers.map((row) => ({
          id: row.id,
          company_id: row.company_id as string,
          contact_id: row.contact_id,
          price: row.price,
          product_url: row.product_url,
          position: row.position,
        }))
      : null,
  });

  if (error) {
    console.error("[syncMaterialSuppliers]", materialId, error.message);
    return "Не удалось сохранить поставщиков материала";
  }

  return null;
}

export async function deleteMaterial(orgSlug: string, id: string) {
  const guard = await assertCanMutate(orgSlug, "materials", id);
  if (!guard.ok) return guard.response;

  // мягкое удаление: материал может стоять в спецификациях сданных проектов
  const { error } = await guard.ctx.supabase
    .from("materials")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    console.error("[deleteMaterial]", error.message);
    return { success: false as const, error: "Не удалось удалить материал" };
  }

  revalidatePath(`/${orgSlug}/materials`);
  return { success: true as const };
}

/* ------------------------------------------------------------------ */
/*  Избранное в библиотеке                                             */
/* ------------------------------------------------------------------ */

const materialFavoriteSchema = z.object({
  materialId: z.string().uuid("Некорректный материал"),
  favorite: z.boolean(),
});

/**
 * Поставить или снять личную отметку «избранное».
 *
 * Целевое состояние приходит с клиента явно (`favorite`), а не как «переключи»:
 * повторный вызов идемпотентен, гонка двух вкладок не переворачивает намерение.
 * Организация и пользователь берутся из сессии, поэтому отметить материал «за
 * коллегу» или в чужой библиотеке нечем.
 *
 * Права менять материал не нужны: отметка личная, её ставит и наблюдатель.
 * `revalidatePath` обновляет список — оптимистичное состояние на клиенте
 * подтверждается данными сервера.
 */
export async function setMaterialFavorite(
  orgSlug: string,
  materialId: string,
  favorite: boolean,
): Promise<ActionResult<{ favorite: boolean }>> {
  const parsed = materialFavoriteSchema.safeParse({ materialId, favorite });
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Неверные данные",
      "INVALID_INPUT",
    );
  }

  const ctx = await scoped(orgSlug);

  const result = await saveMaterialFavorite(ctx.supabase, {
    orgId: ctx.orgId,
    userId: ctx.userId,
    materialId: parsed.data.materialId,
    favorite: parsed.data.favorite,
  });

  if (!result.ok) return fail(result.error.message, result.error.code);

  revalidatePath(`/${orgSlug}/materials`);
  return ok({ favorite: result.favorite });
}

/* ------------------------------------------------------------------ */
/*  Материал → спецификация проекта                                    */
/* ------------------------------------------------------------------ */

/** Что нужно клиенту после успешного прикрепления: ссылка и присвоенная марка. */
export type AttachMaterialResult = {
  itemId: string;
  /** Марка новой позиции («ОТ-07»). */
  code: string;
  projectId: string;
  projectTitle: string;
};

const attachMaterialSchema = z.object({
  projectId: z.string().uuid("Некорректный проект"),
  materialId: z.string().uuid("Некорректный материал"),
});

/**
 * Проекты-цели для диалога «В проект» — по требованию.
 *
 * Раньше список приезжал вместе с открытием диалога: параметр
 * `action=to-project` читал серверный компонент страницы, и переход по URL
 * заново рендерил всю библиотеку. Теперь диалог открывается «shallow», без
 * серверного рендера, поэтому данные запрашиваются отдельно — уже после того,
 * как окно показалось (в диалоге на этот случай есть скелет, см.
 * `targets === null` в AttachToProjectDialog).
 */
export async function listMaterialProjectTargets(
  orgSlug: string,
  materialId: string,
): Promise<MaterialProjectTarget[]> {
  return getMaterialProjectTargets(orgSlug, materialId);
}

/** Сколько раз пересчитывать марку, если номер заняли параллельно. */
const ATTACH_CODE_ATTEMPTS = 3;

/**
 * Прикрепить материал библиотеки к проекту: создать в спецификации проекта
 * позицию, связанную с материалом (`spec_items.material_id`).
 *
 * Материал — шаблон, а не ссылка: значения копируются в позицию снимком на
 * момент добавления (так же работает добавление из библиотеки в конструкторе
 * спецификации, см. `addFromLibrary` в hooks/use-spec-builder.ts). Дальше
 * позиция живёт своей жизнью, а правки материала её не трогают.
 *
 * Повторное добавление того же материала в тот же проект запрещено — это
 * дубль в спецификации, а не вторая позиция. Проверка выполняется здесь, а не
 * только в UI: список проектов мог устареть, пока диалог был открыт.
 *
 * Марка присваивается на сервере (следующий свободный номер для категории) —
 * клиент не должен угадывать нумерацию проекта, которого он не открывал.
 */
export async function addMaterialToProject(
  orgSlug: string,
  projectId: string,
  materialId: string,
): Promise<ActionResult<AttachMaterialResult>> {
  const parsed = attachMaterialSchema.safeParse({ projectId, materialId });
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Неверные данные",
      "INVALID_INPUT",
    );
  }

  const ctx = await scoped(orgSlug);

  const { data: material, error: materialError } = await ctx.supabase
    .from("materials")
    .select(
      "id, name, brand, article, category, unit, price, image_url, product_type, product_url, lead_time, attrs, company_id, contact_id, deleted_at",
    )
    .eq("id", materialId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (materialError) {
    console.error("[addMaterialToProject] material", materialError.message);
    return fail("Не удалось загрузить материал");
  }
  if (!material) return fail("Материал не найден в библиотеке", "NOT_FOUND");
  if (material.deleted_at !== null) {
    return fail(
      "Материал удалён из библиотеки — восстановите его, чтобы добавить в проект",
      "NOT_FOUND",
    );
  }

  const { data: project, error: projectError } = await ctx.supabase
    .from("projects")
    .select("id, title, status, created_by")
    .eq("id", projectId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (projectError) {
    console.error("[addMaterialToProject] project", projectError.message);
    return fail("Не удалось загрузить проект");
  }
  if (!project) return fail("Проект не найден", "NOT_FOUND");

  if (
    !(MATERIAL_TARGET_PROJECT_STATUSES as readonly string[]).includes(
      project.status,
    )
  ) {
    return fail(
      `Проект «${project.title}» завершён или в архиве — материалы в него не добавляются`,
      "FORBIDDEN",
    );
  }

  // Право на изменение проекта — то же правило, что у действий спецификации.
  if (
    !canMutateRecord({
      role: ctx.role,
      userId: ctx.userId,
      createdBy: project.created_by,
    })
  ) {
    return fail("Недостаточно прав: проект создан другим участником", "FORBIDDEN");
  }

  const { count, error: duplicateError } = await ctx.supabase
    .from("spec_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("org_id", ctx.orgId)
    .eq("material_id", materialId)
    .is("deleted_at", null);

  if (duplicateError) {
    console.error("[addMaterialToProject] duplicate", duplicateError.message);
    return fail("Не удалось проверить спецификацию проекта");
  }
  if ((count ?? 0) > 0) {
    return fail(
      `Материал уже добавлен в спецификацию проекта «${project.title}»`,
      "ALREADY_IN_PROJECT",
    );
  }

  // Снапшоты поставщика и менеджера: позиция должна читаться и после того,
  // как компанию или контакт переименуют.
  const [companyName, contactName] = await Promise.all([
    snapshotName(ctx.supabase, ctx.orgId, "companies", material.company_id),
    snapshotName(ctx.supabase, ctx.orgId, "contacts", material.contact_id),
  ]);

  // Категория материала — раздел спецификации; неизвестное значение уходит
  // в «Прочее», чтобы позиция не выпала из группировки.
  const type: SpecType = (TYPE_ORDER as readonly string[]).includes(
    material.category,
  )
    ? (material.category as SpecType)
    : "Прочее";
  const prefix = prefixFor(type);

  const [positionRes, codesRes] = await Promise.all([
    ctx.supabase
      .from("spec_items")
      .select("position")
      .eq("project_id", projectId)
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ctx.supabase
      .from("spec_items")
      .select("code")
      .eq("project_id", projectId)
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .like("code", `${prefix}-%`),
  ]);

  const row: TablesInsert<"spec_items"> = {
    project_id: projectId,
    org_id: ctx.orgId,
    material_id: material.id,
    company_id: material.company_id,
    company_name_snapshot: companyName,
    contact_id: material.contact_id,
    contact_name_snapshot: contactName,
    image_url: material.image_url,
    type,
    name: material.name,
    brand: material.brand,
    article: material.article,
    qty: 1,
    unit: material.unit || "шт",
    price: material.price,
    // Как в конструкторе: цена есть — позиция «подобрана», иначе черновик.
    status: material.price > 0 ? "picked" : "draft",
    is_placeholder: false,
    position: (positionRes.data?.position ?? -1) + 1,
    product_type: material.product_type,
    product_url: material.product_url,
    lead_time: material.lead_time,
    attrs: material.attrs,
  };

  const usedCodes = (codesRes.data ?? []).map((r) => r.code ?? "");

  // Нумерация и порядок восстанавливаются из БД; при сбое чтения работаем по
  // пустому списку (марка и позиция всё равно будут проверены вставкой).
  if (positionRes.error) {
    console.error("[addMaterialToProject] position", positionRes.error.message);
  }
  if (codesRes.error) {
    console.error("[addMaterialToProject] codes", codesRes.error.message);
  }

  // Марку мог занять кто-то другой между чтением и вставкой (вторая вкладка,
  // конструктор спецификации). Гонка редкая, но пользователь не должен видеть
  // ошибку уникальности: пересчитываем номер и пробуем снова.
  for (let attempt = 0; attempt < ATTACH_CODE_ATTEMPTS; attempt++) {
    const code = nextCodesFrom(prefix, usedCodes, 1)[0];
    const itemId = crypto.randomUUID();
    const { error } = await ctx.supabase
      .from("spec_items")
      .insert({ ...row, id: itemId, code });

    if (!error) {
      // Событие жизненного цикла: позиция создана этим жестом. Пишем только
      // на успешной попытке — предыдущие падали на уникальности марки и
      // строки не создавали.
      await recordSpecItemEvents(
        ctx.supabase,
        buildCreatedEvents({
          orgId: ctx.orgId,
          actor: eventActorOf(ctx),
          origin: "library_page",
          items: [{ id: itemId, code, name: material.name, type }],
        }),
      );

      revalidatePath(`/${orgSlug}/projects/${projectId}`);
      revalidatePath(`/${orgSlug}/materials`);
      return ok({
        itemId,
        code,
        projectId,
        projectTitle: project.title,
      });
    }

    if (error.code !== "23505") {
      console.error("[addMaterialToProject] insert", error.message);
      return fail("Не удалось добавить материал в проект");
    }

    usedCodes.push(code);
  }

  return fail("Не удалось подобрать свободную марку — обновите страницу проекта");
}

/** Имя компании или контакта для снапшота; null — записи нет или она не указана. */
async function snapshotName(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  table: "companies" | "contacts",
  id: string | null,
): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabase
    .from(table)
    .select("name")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  return data?.name ?? null;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * Загрузка изображения материала из формы.
 *
 * Проверки (это изображение? не больше лимита?) остаются здесь, а работа с
 * bucket'ом — в общем `storeMaterialImage`: те же правила использует серверная
 * загрузка картинки по внешней ссылке (см. `lib/material-import/image.ts`),
 * поэтому контракт хранения теперь один.
 */
export async function uploadMaterialImage(
  orgSlug: string,
  formData: FormData,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const { orgId, role } = await requireOrgBySlug(orgSlug);

  // Загрузка изображения — операция записи, а не чтения: наблюдателю она недоступна.
  if (!can(role, "record:create")) return forbidden();

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { success: false, error: "Файл не найден" };
  }
  if (!file.type.startsWith("image/")) {
    return { success: false, error: "Нужно изображение" };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { success: false, error: "Файл больше 5 МБ" };
  }

  const stored = await storeMaterialImage(
    orgId,
    await file.arrayBuffer(),
    file.type,
  );
  if (!stored.ok) return { success: false, error: stored.error };

  return { success: true, url: stored.url };
}
