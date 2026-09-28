"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canMutateRecord } from "@/lib/permissions";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import {
  buildVariantAddedEvents,
  buildVariantRemovedEvents,
  buildVariantSwitchedEvents,
  buildVariantUpdatedEvents,
  eventActorOf,
  recordSpecItemEvents,
  type SpecItemVariantRef,
  type SpecVariantUpdateOrigin,
} from "@/lib/spec/history";
import { specVariantPatchSchema } from "@/lib/validations";
import { rowToVariant } from "@/lib/spec/variants";
import type { SpecVariant, Tables } from "@/lib/types";

/** Колонки позиции, из которых собирается снимок её базового материала. */
const BASE_SNAPSHOT_COLUMNS =
  "name, brand, article, spec, price, product_url, image_url, lead_time, company_id, contact_id, company_name_snapshot";

/**
 * Проверяет, что позиция принадлежит организации из сессии и что у
 * пользователя есть право её менять (по создателю проекта). Возвращает
 * admin-клиент, projectId для revalidate и актора для истории — или null, если
 * доступа нет.
 */
async function assertSpecItem(orgSlug: string, specItemId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data: item } = await supabase
    .from("spec_items")
    .select("id, project_id, org_id")
    .eq("id", specItemId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!item) return null;

  const { data: project } = await supabase
    .from("projects")
    .select("created_by")
    .eq("id", item.project_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!project) return null;

  if (
    !canMutateRecord({
      role: ctx.role,
      userId: ctx.userId,
      createdBy: project.created_by,
    })
  ) {
    return null;
  }

  return {
    supabase,
    orgId: ctx.orgId,
    projectId: item.project_id,
    // Актор для событий истории: сессия уже прочитана, второй запрос не нужен.
    userId: ctx.userId,
    user: ctx.user,
  };
}

/**
 * Сохраняет текущий материал позиции отдельным вариантом (position = 0,
 * label «Основной»), если у позиции ещё нет ни одного варианта.
 *
 * Без этого снимка замена оказывается единственной записью, а исходный
 * материал остаётся только в плоских полях spec_items: после переключения
 * на замену `applyActiveVariant` перекрывает их, и вернуться к исходному
 * материалу из интерфейса уже нечем.
 *
 * Снимок создаётся только когда других вариантов у позиции нет, поэтому
 * он же и активный.
 */
async function ensureBaseVariant(
  ctx: Awaited<ReturnType<typeof assertSpecItem>>,
  specItemId: string,
): Promise<ActionResult<SpecVariant | null>> {
  if (!ctx) return fail("Проект не найден");

  const { data: existing, error } = await ctx.supabase
    .from("spec_item_variants")
    .select("id, is_active")
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId);

  if (error) return fail("Не удалось прочитать варианты");
  const variants = existing ?? [];
  if (variants.length > 0) return ok(null);

  const { data: item, error: itemErr } = await ctx.supabase
    .from("spec_items")
    .select(BASE_SNAPSHOT_COLUMNS)
    .eq("id", specItemId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (itemErr || !item) return fail("Позиция не найдена");

  const { data: base, error: insertErr } = await ctx.supabase
    .from("spec_item_variants")
    .insert({
      spec_item_id: specItemId,
      org_id: ctx.orgId,
      name: item.name ?? "",
      brand: item.brand ?? "",
      article: item.article ?? "",
      spec: item.spec ?? "",
      price: item.price ?? 0,
      product_url: item.product_url ?? "",
      image_url: item.image_url ?? null,
      lead_time: item.lead_time ?? "",
      company_id: item.company_id ?? null,
      contact_id: item.contact_id ?? null,
      company_name_snapshot: item.company_name_snapshot ?? "",
      label: "Основной",
      // снимок создаётся только когда других вариантов нет — он и активный
      is_active: true,
      position: 0,
    })
    .select("*")
    .single();

  if (insertErr) {
    console.error("[ensureBaseVariant]", insertErr.message);
    return fail("Не удалось сохранить текущий материал как вариант");
  }
  return ok(rowToVariant(base));
}

/**
 * Добавляет вариант замены. Перед этим исходный материал позиции
 * фиксируется отдельным вариантом, чтобы переключение было обратимым.
 *
 * Владелец события `variant_added`: именно здесь создаётся запись варианта.
 */
export async function addVariant(
  orgSlug: string,
  specItemId: string,
  label = "Альтернатива",
): Promise<ActionResult<{ id: string; base: SpecVariant | null }>> {
  const ctx = await assertSpecItem(orgSlug, specItemId);
  if (!ctx) return fail("Проект не найден");

  const base = await ensureBaseVariant(ctx, specItemId);
  if (!base.success) return base;

  // берём активный как основу — альтернативу удобнее править от существующего
  const { data: source } = await ctx.supabase
    .from("spec_item_variants")
    .select("*")
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .eq("is_active", true)
    .maybeSingle();

  const { data: last } = await ctx.supabase
    .from("spec_item_variants")
    .select("position")
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.supabase
    .from("spec_item_variants")
    .insert({
      spec_item_id: specItemId,
      org_id: ctx.orgId,
      name: source?.name ?? "",
      brand: source?.brand ?? "",
      article: source?.article ?? "",
      spec: source?.spec ?? "",
      price: source?.price ?? 0,
      product_url: source?.product_url ?? "",
      image_url: source?.image_url ?? null,
      lead_time: source?.lead_time ?? "",
      company_id: source?.company_id ?? null,
      contact_id: source?.contact_id ?? null,
      company_name_snapshot: source?.company_name_snapshot ?? "",
      label,
      is_active: false,
      position: (last?.position ?? 0) + 1,
    })
    // `label` из вернувшейся строки, а не из аргумента: событию нужен
    // фактически записанный вариант, а не то, что прислал клиент.
    .select("id, label")
    .single();

  if (error) {
    console.error("[addVariant]", error.message);
    return fail("Не удалось добавить вариант");
  }

  // Событие — строго после успешной вставки. `base !== null` означает, что тем
  // же действием зафиксирован снимок «Основной»: это часть жеста, а не
  // отдельное добавление варианта.
  await recordSpecItemEvents(
    ctx.supabase,
    buildVariantAddedEvents({
      orgId: ctx.orgId,
      actor: eventActorOf(ctx),
      items: [
        {
          specItemId,
          variantId: data.id,
          label: data.label,
          baseSnapshotCreated: base.data !== null,
        },
      ],
    }),
  );

  revalidatePath(`/${orgSlug}/projects/${ctx.projectId}`);
  return ok({ id: data.id, base: base.data });
}

/**
 * Переключает активный вариант атомарно: снимает флаг со всех, ставит одному.
 *
 * Владелец события `variant_switched`: переключение не проходит через патч
 * позиции, поэтому и история пишется здесь.
 */
export async function switchVariant(
  orgSlug: string,
  specItemId: string,
  variantId: string,
): Promise<ActionResult> {
  const ctx = await assertSpecItem(orgSlug, specItemId);
  if (!ctx) return fail("Проект не найден");

  // Варианты позиции одним SELECT: из него и «до» (активный), и «после»
  // (целевой), и проверка, что целевой вообще принадлежит этой позиции и
  // организации. Читаем ДО mutation: после неё активный уже другой.
  const { data: variants, error: readError } = await ctx.supabase
    .from("spec_item_variants")
    .select("id, name, is_active")
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId);

  if (readError) {
    console.error("[switchVariant] read", readError.message);
    return fail("Не удалось переключить вариант");
  }

  const rows = variants ?? [];
  const active = rows.find((v) => v.is_active) ?? null;
  const target = rows.find((v) => v.id === variantId) ?? null;

  // Чужой или несуществующий вариант: без этой проверки первый UPDATE снял бы
  // активность со всех, позиция осталась бы вообще без активного варианта, а
  // событие описало бы переключение, которого не было.
  if (!target) return fail("Вариант не найден");

  // снять активность со всех, кроме целевого — иначе уникальный индекс упрётся
  const { error: e1 } = await ctx.supabase
    .from("spec_item_variants")
    .update({ is_active: false })
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .neq("id", variantId);
  if (e1) return fail("Не удалось переключить вариант");

  // целевой обязан принадлежать той же позиции и организации
  const { data: activated, error: e2 } = await ctx.supabase
    .from("spec_item_variants")
    .update({ is_active: true })
    .eq("id", variantId)
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .select("id");

  if (e2) return fail("Не удалось переключить вариант");
  // Варианта не стало между чтением и записью — активного теперь нет ни у кого.
  // Событие в этом случае не пишем: оно утверждало бы то, чего не произошло.
  if ((activated ?? []).length !== 1) return fail("Не удалось переключить вариант");

  // A → A: пользователь выбрал уже активный вариант — мутация идемпотентна,
  // но переключения не было, и события нет.
  if (active?.id !== target.id) {
    await recordSpecItemEvents(
      ctx.supabase,
      buildVariantSwitchedEvents({
        orgId: ctx.orgId,
        actor: eventActorOf(ctx),
        items: [
          {
            specItemId,
            from: active ? { variantId: active.id, name: active.name } : null,
            to: { variantId: target.id, name: target.name },
          },
        ],
      }),
    );
  }

  revalidatePath(`/${orgSlug}/projects/${ctx.projectId}`);
  return ok(null);
}

/**
 * Правит поля варианта — единственная mutation `spec_item_variants`.
 *
 * Владелец события `variant_updated`, но пишет его не всегда: через эту же
 * mutation проходят зеркалирование полей позиции в активный вариант и
 * заполнение только что созданного варианта. Что именно произошло, называет
 * вызывающий — `origin` (см. `SpecVariantUpdateOrigin`).
 */
export async function updateVariant(
  orgSlug: string,
  specItemId: string,
  variantId: string,
  patch: Record<string, unknown>,
  /**
   * Кто инициировал запись (см. `SpecVariantUpdateOrigin`). Событие
   * `variant_updated` пишет только явная правка варианта (`edit`):
   * `create` — вторая половина жеста «добавить вариант», за которую отвечает
   * `variant_added`, `mirror` — зеркалирование полей позиции, уже описанное
   * событиями самой позиции. Параметр обязателен: происхождение нельзя
   * вывести из патча, и умолчание молча решало бы за вызывающего, писать ли
   * историю.
   */
  origin: SpecVariantUpdateOrigin,
): Promise<ActionResult> {
  const ctx = await assertSpecItem(orgSlug, specItemId);
  if (!ctx) return fail("Проект не найден");

  // неизвестные/служебные ключи (id, org_id, spec_item_id, is_active) отбрасываются
  const parsed = specVariantPatchSchema.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  // название компании — снапшот на момент записи: в интерфейсе выбирают
  // только id, поэтому имя резолвит сервер (как в saveSpecItemPatch).
  if ("company_id" in parsed.data) {
    const companyId = parsed.data.company_id;
    if (companyId) {
      const { data: company } = await ctx.supabase
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .eq("org_id", ctx.orgId)
        .maybeSingle();
      if (!company) return fail("Компания не найдена");
      parsed.data.company_name_snapshot = company.name;
    } else {
      parsed.data.company_name_snapshot = "";
    }
  }

  // История только у явной правки: остальным путям не нужны ни лишний SELECT,
  // ни событие. Это они и называют — `origin`.
  const withHistory = origin === "edit";

  // Прежние значения — только из БД: присланное клиентом «было» доверия не
  // заслуживает. Заодно это проверка принадлежности: чужой, удалённый или
  // несуществующий вариант не даёт ни mutation, ни события.
  let before: Tables<"spec_item_variants"> | null = null;

  if (withHistory) {
    const { data, error } = await ctx.supabase
      .from("spec_item_variants")
      .select("*")
      .eq("id", variantId)
      .eq("spec_item_id", specItemId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();

    if (error) {
      console.error("[updateVariant] read", error.message);
      return fail("Не удалось сохранить вариант");
    }
    if (!data) return fail("Вариант не найден");
    before = data;
  }

  // `to` события — применённая строка, а не патч: только она подтверждает, что
  // записалось именно это (в том числе имя компании, разрешённое выше).
  const { data: applied, error } = await ctx.supabase
    .from("spec_item_variants")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", variantId)
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .select("*");

  if (error) {
    console.error("[updateVariant]", error.message);
    return fail("Не удалось сохранить вариант");
  }

  if (withHistory && before) {
    // Варианта не стало между чтением и записью — записывать нечего.
    const after = (applied ?? [])[0];
    if (!after) return fail("Не удалось сохранить вариант");

    // Событие — строго после успешной mutation. Совпавшие поля билдер
    // отбросит сам: повторное сохранение тех же данных события не даёт.
    await recordSpecItemEvents(
      ctx.supabase,
      buildVariantUpdatedEvents({
        orgId: ctx.orgId,
        actor: eventActorOf(ctx),
        items: [{ specItemId, variantId, from: before, to: after }],
      }),
    );
  }

  revalidatePath(`/${orgSlug}/projects/${ctx.projectId}`);
  return ok(null);
}

/**
 * Удаляет вариант. Последний вариант не удаляется: у позиции всегда должен
 * остаться активный.
 *
 * Владелец события `variant_removed`. `.select()` на DELETE отдаёт удалённую
 * строку, поэтому снимок для истории берётся из фактически удалённой записи, а
 * не из отдельного SELECT и не из входных данных клиента.
 */
export async function deleteVariant(
  orgSlug: string,
  specItemId: string,
  variantId: string,
): Promise<ActionResult> {
  const ctx = await assertSpecItem(orgSlug, specItemId);
  if (!ctx) return fail("Проект не найден");

  // последний вариант не удаляем — у позиции всегда должен остаться активный
  const { count } = await ctx.supabase
    .from("spec_item_variants")
    .select("id", { count: "exact", head: true })
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId);
  if ((count ?? 0) <= 1) return fail("Нельзя удалить последний вариант");

  // Снимок для события — из удаляемой строки: после DELETE её уже нет. Удаление
  // физическое (у таблицы нет `deleted_at`), поэтому вернувшаяся строка — это и
  // есть то состояние, которое пользователь видел перед удалением.
  const { data: removed, error } = await ctx.supabase
    .from("spec_item_variants")
    .delete()
    .eq("id", variantId)
    .eq("spec_item_id", specItemId)
    .eq("org_id", ctx.orgId)
    .select("id, name, label, is_active");

  if (error) {
    console.error("[deleteVariant]", error.message);
    return fail("Не удалось удалить вариант");
  }

  // Ноль удалённых строк — вариант чужой, несуществующий или уже удалённый:
  // ни переназначения активного, ни события.
  const snapshot = (removed ?? [])[0];
  if (!snapshot) return fail("Вариант не найден");

  // удалили активный → назначаем активным первый оставшийся.
  // Это техническое следствие удаления, а не переключение пользователем,
  // поэтому своего события у него нет: преемник идёт в payload
  // `variant_removed` (`next_active`).
  let nextActive: SpecItemVariantRef | null = null;

  if (snapshot.is_active) {
    const { data: next } = await ctx.supabase
      .from("spec_item_variants")
      .select("id, name")
      .eq("spec_item_id", specItemId)
      .eq("org_id", ctx.orgId)
      .order("position")
      .limit(1)
      .maybeSingle();

    if (next) {
      const { data: activated, error: activateError } = await ctx.supabase
        .from("spec_item_variants")
        .update({ is_active: true })
        .eq("id", next.id)
        .eq("spec_item_id", specItemId)
        .eq("org_id", ctx.orgId)
        .select("id");

      // Отказ назначения не глушим: строка уже удалена и не вернётся, а позиция
      // осталась бы без активного варианта. Событие при этом не должно
      // утверждать, что замена состоялась, — иначе `next_active` соврёт.
      if (activateError) {
        console.error("[deleteVariant] activate", activateError.message);
      } else if ((activated ?? []).length === 1) {
        nextActive = { variantId: next.id, name: next.name };
      }
    }
  }

  // Событие — строго после успешного удаления.
  await recordSpecItemEvents(
    ctx.supabase,
    buildVariantRemovedEvents({
      orgId: ctx.orgId,
      actor: eventActorOf(ctx),
      items: [
        {
          specItemId,
          variantId: snapshot.id,
          name: snapshot.name,
          label: snapshot.label,
          wasActive: snapshot.is_active,
          nextActive,
        },
      ],
    }),
  );

  revalidatePath(`/${orgSlug}/projects/${ctx.projectId}`);
  return ok(null);
}
