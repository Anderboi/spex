"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canMutateRecord } from "@/lib/permissions";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import {
  ManualSpecItemInput,
  manualSpecItemSchema,
  specItemPatchSchema,
} from "@/lib/validations";
import { patchToRow } from "@/lib/spec/mappers";
import {
  buildClearedEvents,
  buildCodeChangedEvents,
  buildCreatedEvents,
  buildDetailsChangedEvents,
  buildFilledEvents,
  buildParentChangedEvents,
  buildPriceChangedEvents,
  buildQuantityChangedEvents,
  buildRemovedEvents,
  buildRestoredEvents,
  buildStatusChangedEvents,
  buildSupplierChangedEvents,
  eventActorOf,
  recordSpecItemEvents,
  SPEC_ITEM_DETAIL_FIELDS,
  type SpecItemCreateOrigin,
  type SpecItemDetailField,
  type SpecItemDetailValues,
  type SpecItemFillOrigin,
  type SpecItemParentRef,
  type SpecItemSupplierSnapshot,
} from "@/lib/spec/history";
import { callRpc } from "@/lib/supabase/rpc";
import { TablesInsert } from "@/lib/supabase/database.types";
import { SpecStatus, SpecType } from "@/lib/constants";
import { SpecItemPatch } from '@/lib/types';

async function assertProject(orgSlug: string, projectId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, created_by")
    .eq("id", projectId)
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();
  return { ...ctx, supabase, project };
}

async function guard(orgSlug: string, projectId: string) {
  const c = await assertProject(orgSlug, projectId);
  if (!c.project) return { error: "Проект не найден" as const, c: null };
  if (
    !canMutateRecord({
      role: c.role,
      userId: c.userId,
      createdBy: c.project.created_by,
    })
  ) {
    return { error: "Недостаточно прав" as const, c: null };
  }
  return { error: null, c };
}

/** Название компании на момент записи. null — компания не указана. */
async function companySnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  companyId: string | null | undefined,
): Promise<{ ok: true; name: string | null } | { ok: false }> {
  if (!companyId) return { ok: true, name: null };
  const { data } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data ? { ok: true, name: data.name } : { ok: false };
}

/**
 * Записать патч позиции. Сюда приходит и серия быстрых правок одной позиции,
 * уже склеенная дебаунсом (`useSpecPersistence`), поэтому один пользовательский
 * жест-серия — это один вызов и одна mutation.
 *
 * Пометки доменов (`explicitQuantity`, `explicitSupplier`) означают «это явная
 * правка пользователя, а не побочный эффект составного жеста». Только они дают
 * события истории: ручное заполнение заглушки пишет и количество, и поставщика,
 * но приходит без пометок и остаётся за будущим `filled`.
 *
 * `composite` — обратная пометка: «это заполнение заглушки или очистка».
 * Составной жест меняет сразу много обычных полей, и событие у него будет одно
 * (`filled` / `cleared`), поэтому полевые события по такому патчу не пишутся.
 * Определять составной жест по набору полей нельзя — это угадывание.
 */
export async function saveSpecItemPatch(
  orgSlug: string,
  projectId: string,
  itemId: string,
  patch: SpecItemPatch,
  options: {
    explicitQuantity?: boolean;
    explicitSupplier?: boolean;
    composite?: boolean;
    fillOrigin?: SpecItemFillOrigin;
    cleared?: boolean;
  } = {},
): Promise<ActionResult<null>> {
  const parsed = specItemPatchSchema.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);

  const row = patchToRow(parsed.data);
  if (Object.keys(row).length === 0) return ok(null);

  // Составной жест не порождает полевых событий вообще: ни количества, ни
  // поставщика, ни деталей.
  const fieldEvents = !options.composite;

  // Заполнение заглушки и её очистка — противоположные составные жесты, и
  // обоим нужен снимок «до»: заполнению — чтобы отличить настоящее заполнение
  // от повторного, очистке — чтобы знать, было ли что очищать.
  const contentBefore =
    options.fillOrigin || options.cleared
      ? await contentSnapshot(c.supabase, projectId, itemId, c.orgId)
      : null;

  // Прежнее количество и единица измерения — из БД, до записи. Лишний SELECT
  // платится только за помеченные патчи: остальные правки пишутся как раньше.
  const nextQty = parsed.data.qty;
  const quantity =
    fieldEvents && options.explicitQuantity && nextQty !== undefined
      ? await quantitySnapshot(c.supabase, projectId, itemId, c.orgId)
      : null;

  // Поставщик — один домен из четырёх значений, и `from` для него берётся
  // целиком из строки БД: сравнивать только `company_id` мало, имя компании и
  // менеджер меняются независимо.
  const supplierBefore =
    fieldEvents && options.explicitSupplier
      ? await supplierSnapshot(c.supabase, projectId, itemId, c.orgId)
      : null;

  // Обычные поля: один SELECT на все колонки сразу — и только если патч их
  // действительно несёт.
  const detailsTouched = SPEC_ITEM_DETAIL_FIELDS.filter(
    (field) => row[field] !== undefined,
  );
  const detailsBefore =
    fieldEvents && detailsTouched.length > 0
      ? await detailsSnapshot(c.supabase, projectId, itemId, c.orgId)
      : null;

  // Итоговое состояние известно из патча, поэтому решаем до UPDATE:
  //   * заполнение — позиция была заглушкой и патч снимает этот признак;
  //     второе условие отсекает отмену очистки пустой заглушки, где `before`
  //     возвращает `isPlaceholder: true`;
  //   * очистка — позиция была заполнена (уже пустую очищать нечем, и
  //     повторный вызов события не даёт).
  const fill =
    options.fillOrigin &&
    contentBefore?.is_placeholder === true &&
    row.is_placeholder === false
      ? { origin: options.fillOrigin, before: contentBefore }
      : null;

  const clearedBefore =
    options.cleared && contentBefore?.is_placeholder === false
      ? contentBefore
      : null;

  // Смена родителя — иерархия, а не значение: `parent_id` пишет только пункт
  // «В состав…», составные жесты его не трогают, поэтому отдельной пометки не
  // нужно. Снимок читается до записи и он же проверяет нового родителя.
  const parentChange =
    row.parent_id !== undefined
      ? await parentChangeSnapshot(
          c.supabase,
          projectId,
          c.orgId,
          itemId,
          row.parent_id,
        )
      : null;

  // Недоступный или чужой родитель — mutation не проходит вовсе.
  if (parentChange && !parentChange.ok) return fail(parentChange.error);

  const { companyId, companyName, contactId } = parsed.data;

  if (companyId) {
    // Компания указана: имя берём из справочника — клиент мог прислать
    // устаревшее название или вовсе ничего. Если компании нет в организации,
    // подставлять её имя нельзя.
    const snap = await companySnapshot(c.supabase, c.orgId, companyId);
    if (!snap.ok) return fail("Компания не найдена");
    row.company_name_snapshot = snap.name;
  } else if (companyId === null && companyName !== undefined) {
    // Поставщика сняли — снапшот должен уйти вместе с ним, иначе список и
    // карточка продолжат показывать прежнюю компанию.
    row.company_name_snapshot = companyName || null;
  }

  if (contactId !== undefined) {
    // Снапшот имени менеджера ведём так же, как у компании. До этого он
    // проставлялся только при создании позиции и с тех пор оставался прежним,
    // хотя `contact_id` менялся: событию истории нечего было бы показать в `to`.
    // Имя ищется бережно: ненайденный контакт не должен валить правку позиции.
    row.contact_name_snapshot = contactId
      ? await contactSnapshot(c.supabase, c.orgId, contactId)
      : null;
  }

  const { error } = await c.supabase
    .from("spec_items")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null);

  if (error) {
    if (error.code === "23505") return fail("Марка уже занята другой позицией");
    console.error("[saveSpecItemPatch]", error.message);
    return fail("Не удалось сохранить изменения");
  }

  // События — строго после успешной мутации и только при реальном изменении:
  // серия, закончившаяся теми же значениями, ничего не меняла.
  if (quantity && nextQty !== undefined && quantity.qty !== nextQty) {
    await recordSpecItemEvents(
      c.supabase,
      buildQuantityChangedEvents({
        orgId: c.orgId,
        actor: eventActorOf(c),
        items: [
          { id: itemId, from: quantity.qty, to: nextQty, unit: quantity.unit },
        ],
      }),
    );
  }

  if (supplierBefore) {
    // `to` собирается из того, что реально ушло в UPDATE: поля, которых нет в
    // патче, остаются прежними.
    const keep = <T>(next: T | undefined, prev: T): T =>
      next === undefined ? prev : next;

    await recordSpecItemEvents(
      c.supabase,
      buildSupplierChangedEvents({
        orgId: c.orgId,
        actor: eventActorOf(c),
        items: [
          {
            id: itemId,
            from: supplierBefore,
            to: {
              company_id: keep(row.company_id, supplierBefore.company_id),
              company_name: keep(
                row.company_name_snapshot,
                supplierBefore.company_name,
              ),
              contact_id: keep(row.contact_id, supplierBefore.contact_id),
              contact_name: keep(
                row.contact_name_snapshot,
                supplierBefore.contact_name,
              ),
            },
          },
        ],
      }),
    );
  }

  if (detailsBefore) {
    // Имена колонок у `from` и `to` одни и те же — те, что нёс патч. Поля с
    // неизменившимся значением отсеет сам билдер.
    const snapshots = detailsBefore as unknown as Record<string, unknown>;

    await recordSpecItemEvents(
      c.supabase,
      buildDetailsChangedEvents({
        orgId: c.orgId,
        actor: eventActorOf(c),
        items: [
          {
            id: itemId,
            from: pickDetailValues(snapshots, detailsTouched),
            to: pickDetailValues(
              row as unknown as Record<string, unknown>,
              detailsTouched,
            ),
          },
        ],
      }),
    );
  }

  // Заполнение: событие одно на весь составной жест — поля, которые он поменял,
  // остаются внутри `filled`, своих событий у них нет.
  if (fill) {
    await recordSpecItemEvents(
      c.supabase,
      buildFilledEvents({
        orgId: c.orgId,
        actor: eventActorOf(c),
        origin: fill.origin,
        items: [
          {
            id: itemId,
            code: fill.before.code,
            name: row.name ?? fill.before.name,
          },
        ],
      }),
    );
  }

  // Очистка: `name` — то, что было очищено, поэтому он из снимка до записи.
  if (clearedBefore) {
    await recordSpecItemEvents(
      c.supabase,
      buildClearedEvents({
        orgId: c.orgId,
        actor: eventActorOf(c),
        items: [
          { id: itemId, code: clearedBefore.code, name: clearedBefore.name },
        ],
      }),
    );
  }

  // Смена родителя: и `from`, и `to` — читаемые снимки с сервера.
  if (parentChange?.ok) {
    await recordSpecItemEvents(
      c.supabase,
      buildParentChangedEvents({
        orgId: c.orgId,
        actor: eventActorOf(c),
        items: [{ id: itemId, from: parentChange.from, to: parentChange.to }],
      }),
    );
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

/** Значения перечисленных колонок строки — как есть, без преобразований. */
function pickDetailValues(
  source: Record<string, unknown>,
  fields: readonly SpecItemDetailField[],
): SpecItemDetailValues {
  const values: SpecItemDetailValues = {};
  for (const field of fields) values[field] = source[field];
  return values;
}

/** Количество и единица измерения позиции на момент до записи. */
async function quantitySnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
  itemId: string,
  orgId: string,
): Promise<{ qty: number; unit: string } | null> {
  const { data, error } = await supabase
    .from("spec_items")
    .select("qty, unit")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    // Снимок не прочитан — молча писать событие с выдуманным `from` нельзя.
    console.error("[saveSpecItemPatch] quantity snapshot", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Смена родителя: снимок прежнего и нового родителя + проверка нового.
 *
 * Оба родителя читаются одним запросом: прежний — «как было», поэтому
 * удалённая позиция тоже годится в `from`; новый обязан быть живым и из того же
 * проекта организации, иначе mutation не проходит. Имя и марку берём с сервера,
 * а не из присланных клиентом подсказок.
 */
async function parentChangeSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
  orgId: string,
  itemId: string,
  parentId: string | null,
): Promise<
  | {
      ok: true;
      from: SpecItemParentRef | null;
      to: SpecItemParentRef | null;
    }
  | { ok: false; error: string }
> {
  const { data: current, error: currentError } = await supabase
    .from("spec_items")
    .select("id, parent_id")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (currentError) {
    console.error("[saveSpecItemPatch] parent snapshot", currentError.message);
    return { ok: false, error: "Не удалось сохранить изменения" };
  }
  // Позиция удалена, чужая или её нет — писать нечего и логировать нечего.
  if (!current) return { ok: false, error: "Позиция не найдена" };

  // Самоссылку клиент не пропускает, но server action доступен и напрямую.
  if (parentId !== null && parentId === itemId) {
    return { ok: false, error: "Позиция не может быть родителем самой себе" };
  }

  const ids = [...new Set([current.parent_id, parentId])].filter(
    (id): id is string => Boolean(id),
  );

  const refs = new Map<string, { code: string | null; name: string; deleted: boolean }>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("spec_items")
      .select("id, code, name, deleted_at")
      .in("id", ids)
      .eq("project_id", projectId)
      .eq("org_id", orgId);

    if (error) {
      console.error("[saveSpecItemPatch] parent refs", error.message);
      return { ok: false, error: "Не удалось сохранить изменения" };
    }
    for (const row of data ?? []) {
      refs.set(row.id, {
        code: row.code,
        name: row.name,
        deleted: row.deleted_at !== null,
      });
    }
  }

  const ref = (id: string | null): SpecItemParentRef | null => {
    if (!id) return null;
    const found = refs.get(id);
    return found ? { specItemId: id, code: found.code, name: found.name } : null;
  };

  if (parentId !== null) {
    const next = refs.get(parentId);
    if (!next || next.deleted) {
      return { ok: false, error: "Родитель не найден в этом проекте" };
    }
  }

  return { ok: true, from: ref(current.parent_id), to: ref(parentId) };
}

/**
 * Состояние содержимого позиции до записи: марка, имя и признак «заглушка».
 *
 * Один снимок на два противоположных жеста. `is_placeholder` — единственный
 * надёжный признак: заполнить можно только заглушку, а очищать — только
 * заполненную позицию, поэтому по нему решается, было ли действие настоящим.
 */
async function contentSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
  itemId: string,
  orgId: string,
): Promise<{
  code: string | null;
  name: string;
  is_placeholder: boolean;
} | null> {
  const { data, error } = await supabase
    .from("spec_items")
    .select("code, name, is_placeholder")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[saveSpecItemPatch] content snapshot", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Обычные поля позиции на момент до записи — одним SELECT на всю строку:
 * событие сравнивает все поля списка сразу, а не по запросу на поле.
 *
 * Берём `*`, а не перечень колонок: список ведёт `SPEC_ITEM_DETAIL_FIELDS`, и
 * дублировать его в строке запроса значило бы завести второй источник правды.
 * Строка читается по первичному ключу, так что лишние колонки ничего не стоят.
 */
async function detailsSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
  itemId: string,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("spec_items")
    .select("*")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[saveSpecItemPatch] details snapshot", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Поставщик позиции на момент до записи: компания и менеджер вместе со
 * снапшотами имён — ровно те четыре колонки, из которых собирается событие.
 */
async function supplierSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
  itemId: string,
  orgId: string,
): Promise<SpecItemSupplierSnapshot | null> {
  const { data, error } = await supabase
    .from("spec_items")
    .select(
      "company_id, company_name_snapshot, contact_id, contact_name_snapshot",
    )
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[saveSpecItemPatch] supplier snapshot", error.message);
    return null;
  }
  if (!data) return null;

  // В payload имена полей короче, чем колонки: `company_name` — это
  // `company_name_snapshot`.
  return {
    company_id: data.company_id,
    company_name: data.company_name_snapshot,
    contact_id: data.contact_id,
    contact_name: data.contact_name_snapshot,
  };
}

/**
 * Имя контакта-менеджера. null — контакт не указан, удалён или принадлежит
 * другой организации.
 *
 * В отличие от компании, отсутствие контакта правку не отменяет: менеджер —
 * необязательная деталь поставки, а `contact_id` из библиотечного материала
 * мог устареть. Событию в этом случае достаётся `contact_name: null`, и это
 * честнее выдуманного имени.
 */
async function contactSnapshot(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  contactId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("contacts")
    .select("name")
    .eq("id", contactId)
    .eq("org_id", orgId)
    .maybeSingle();

  return data?.name ?? null;
}

/**
 * Явная смена статуса одной или нескольких позиций — отдельное действие, а не
 * патч через `saveSpecItemPatch`. Причины:
 *
 *   * `from` обязан прийти из БД (иначе вторая вкладка соврёт о прежнем
 *     статусе), а общий сейвер пишет патч вслепую;
 *   * патчи склеиваются дебаунсом, поэтому «статус + цена» в одном запросе —
 *     обычное дело, и по содержимому патча нельзя отличить явную смену статуса
 *     от побочной: очистка позиции и заполнение заглушки тоже меняют статус;
 *   * массовая смена становится одним запросом вместо N.
 *
 * Побочные смены статуса (очистка, заполнение заглушки, исполнение доставки)
 * сюда намеренно не заходят и `status_changed` не порождают: у них будут свои
 * агрегированные события — `cleared`, `filled`, `service_completed`.
 *
 * Событие пишется только для позиций, у которых статус реально изменился:
 * повторная установка того же статуса не даёт ни UPDATE, ни записи в историю.
 */
export async function setSpecItemsStatus(
  orgSlug: string,
  projectId: string,
  ids: string[],
  status: SpecStatus,
): Promise<ActionResult<null>> {
  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);
  if (ids.length === 0) return ok(null);

  // Прежний статус — только из БД: значение, присланное клиентом как «старое»,
  // устаревает молча (вторая вкладка, чужой участник).
  const { data: current, error: readError } = await c.supabase
    .from("spec_items")
    .select("id, status")
    .in("id", ids)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null);

  if (readError) {
    console.error("[setSpecItemsStatus] read", readError.message);
    return fail("Не удалось изменить статус");
  }

  const changed = (current ?? []).filter((row) => row.status !== status);

  // Статус уже такой, как просят, — это не изменение. Ни UPDATE, ни события:
  // иначе лента заполнится «статус изменён на тот же самый».
  if (changed.length === 0) return ok(null);

  const { error } = await c.supabase
    .from("spec_items")
    .update({ status, updated_at: new Date().toISOString() })
    .in(
      "id",
      changed.map((row) => row.id),
    )
    .eq("project_id", projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null);

  if (error) {
    console.error("[setSpecItemsStatus]", error.message);
    return fail("Не удалось изменить статус");
  }

  // Событие — строго после успешной мутации и только на изменившиеся позиции.
  await recordSpecItemEvents(
    c.supabase,
    buildStatusChangedEvents({
      orgId: c.orgId,
      actor: eventActorOf(c),
      to: status,
      items: changed.map((row) => ({ id: row.id, from: row.status })),
    }),
  );

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

/**
 * Явная смена цены позиции — отдельное действие, а не патч через
 * `saveSpecItemPatch`. Причина та же, что у статуса: патчи склеиваются
 * дебаунсом, поэтому в одном запросе может прийти «цена + что угодно ещё»,
 * а цену меняют ещё и составные жесты — заполнение заглушки и очистка позиции.
 * По содержимому патча явную правку не отличить от побочной, а событию нужен
 * `from` из БД, а не присланное клиентом «старое».
 *
 * Цена — поле материала: источник истины для неё активный вариант, а плоская
 * колонка `spec_items.price` — зеркало, которое `applyActiveVariant`
 * перекрывает при каждой загрузке. Зеркалирование в вариант остаётся за
 * клиентом (`updateItem` → `updateVariantLocal`); здесь пишется только
 * `spec_items` — это и есть место-владелец `price_changed`.
 *
 * Побочные изменения цены (создание, заполнение заглушки, очистка, правка
 * неактивного варианта) сюда не заходят и `price_changed` не порождают.
 */
export async function setSpecItemPrice(
  orgSlug: string,
  projectId: string,
  itemId: string,
  price: number,
): Promise<ActionResult<null>> {
  // Та же проверка значения, что у обычного патча: границы и округление до
  // копеек описаны один раз, в specItemPatchSchema.
  const parsed = specItemPatchSchema.safeParse({ price });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const next = parsed.data.price;
  if (next === undefined) return fail("Не удалось изменить цену");

  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);

  // Прежняя цена — только из БД.
  const { data: current, error: readError } = await c.supabase
    .from("spec_items")
    .select("id, price")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (readError) {
    console.error("[setSpecItemPrice] read", readError.message);
    return fail("Не удалось изменить цену");
  }

  // Позиции нет (удалена в другой вкладке) — менять нечего и логировать нечего.
  if (!current) return ok(null);

  const from = current.price;

  // Та же цена — не изменение: ни UPDATE, ни события.
  if (from === next) return ok(null);

  const { error } = await c.supabase
    .from("spec_items")
    .update({ price: next, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null);

  if (error) {
    console.error("[setSpecItemPrice]", error.message);
    return fail("Не удалось изменить цену");
  }

  // Событие — строго после успешной мутации.
  await recordSpecItemEvents(
    c.supabase,
    buildPriceChangedEvents({
      orgId: c.orgId,
      actor: eventActorOf(c),
      items: [{ id: itemId, from, to: next }],
    }),
  );

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

export async function createSpecItems(
  orgSlug: string,
  projectId: string,
  items: (SpecItemPatch & { id: string; name: string; type: SpecType })[],
  /**
   * Откуда пришла позиция. Определить это на сервере нельзя: дубликат
   * переносит `materialId` источника и неотличим от добавления из библиотеки,
   * поэтому origin называет клиент — ровно тот, кто инициировал жест.
   */
  origin: SpecItemCreateOrigin,
): Promise<ActionResult<null>> {
  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);
  if (items.length === 0) return ok(null);

  const { data: last } = await c.supabase
    .from("spec_items")
    .select("position")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  // снапшоты названий — одним запросом на все компании сразу
  const companyIds = [
    ...new Set(items.map((i) => i.companyId).filter(Boolean)),
  ] as string[];
  const names = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data } = await c.supabase
      .from("companies")
      .select("id, name")
      .in("id", companyIds)
      .eq("org_id", c.orgId);
    for (const co of data ?? []) names.set(co.id, co.name);
  }

  // снапшоты контактов — отдельным запросом (идентификаторы из contacts)
  const contactIds = [
    ...new Set(items.map((i) => i.contactId).filter(Boolean)),
  ] as string[];
  const contactNames = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data } = await c.supabase
      .from("contacts")
      .select("id, name")
      .in("id", contactIds)
      .eq("org_id", c.orgId);
    for (const co of data ?? []) contactNames.set(co.id, co.name);
  }

  let pos = (last?.position ?? -1) + 1;
  const rows: TablesInsert<"spec_items">[] = items.map((it) => ({
    ...patchToRow(it),
    id: it.id,
    project_id: projectId,
    org_id: c.orgId,
    name: it.name,
    type: it.type,
    company_name_snapshot: it.companyId
      ? (names.get(it.companyId) ?? null)
      : null,
    contact_name_snapshot: it.contactId
      ? (contactNames.get(it.contactId) ?? null)
      : null,
    product_url: it.product_url,
    product_type: it.product_type,
    position: pos++,
  }));

  const { error } = await c.supabase.from("spec_items").insert(rows);
  if (error) {
    if (error.code === "23505") return fail("Одна из марок уже занята");
    console.error("[createSpecItems]", error.message);
    return fail("Не удалось добавить позиции");
  }

  // Только после успешной вставки. Значения для payload уже в памяти
  // (их же вставляли), дополнительный SELECT не нужен.
  await recordSpecItemEvents(
    c.supabase,
    buildCreatedEvents({
      orgId: c.orgId,
      actor: eventActorOf(c),
      origin,
      items: items.map((it) => ({
        id: it.id,
        code: it.code ?? null,
        name: it.name,
        type: it.type,
      })),
    }),
  );

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

export async function createManualSpecItem(
  orgSlug: string,
  projectId: string,
  payload: ManualSpecItemInput & {
    itemId: string;
    materialId: string | null;
    code: string;
    /** Родитель создаваемой позиции (null — обычное создание без родителя). */
    parentId?: string | null;
  },
): Promise<ActionResult<null>> {
  const parsed = manualSpecItemSchema.safeParse(payload);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);
  const d = parsed.data;

  const snap = await companySnapshot(c.supabase, c.orgId, d.companyId);
  if (!snap.ok) return fail("Компания не найдена");

  // атомарно: материал (если нужен) + позиция — в одной транзакции на сервере
  const saveToLibrary = d.saveToLibrary && !!payload.materialId;
  const { error } = await callRpc(c.supabase, "create_manual_spec_item", {
    p_org_id: c.orgId,
    p_project_id: projectId,
    p_item_id: payload.itemId,
    p_material_id: saveToLibrary ? payload.materialId : null,
    p_company_id: d.companyId,
    p_company_name: snap.name,
    p_created_by: c.userId,
    p_code: payload.code,
    p_type: d.type,
    p_name: d.name,
    p_brand: d.brand || null,
    p_spec: d.spec || null,
    p_article: d.article || null,
    p_qty: d.qty,
    p_unit: d.unit,
    p_price: d.price,
    p_stock_pct: d.stockPct,
    p_client_discount_pct: d.clientDiscountPct,
    p_supplier_discount_pct: d.supplierDiscountPct,
    p_save_to_library: saveToLibrary,
    p_image_url: d.imageUrl,
    p_parent_id: payload.parentId ?? null,
    p_product_type: d.productType || null,
    p_product_url: d.productUrl || null,
    p_lead_time: d.leadTime || null,
    p_attrs: d.attrs ?? {},
  });

  if (error) {
    if (error.message.includes("CODE_TAKEN"))
      return fail("Марка уже занята — обновите страницу");
    if (error.message.includes("PROJECT_NOT_FOUND"))
      return fail("Проект не найден");
    console.error("[createManualSpecItem]", error.message);
    return fail("Не удалось добавить позицию");
  }

  // Путь создания ровно один — RPC выше. Отдельного createSpecItems здесь нет,
  // поэтому второго `created` для этой позиции не появится.
  await recordSpecItemEvents(
    c.supabase,
    buildCreatedEvents({
      orgId: c.orgId,
      actor: eventActorOf(c),
      origin: "manual",
      items: [
        {
          id: payload.itemId,
          code: payload.code,
          name: d.name,
          type: d.type,
        },
      ],
    }),
  );

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  if (payload.materialId) revalidatePath(`/${orgSlug}/materials`);
  return ok(null);
}

export async function deleteSpecItems(
  orgSlug: string,
  projectId: string,
  ids: string[],
): Promise<ActionResult<null>> {
  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);
  if (ids.length === 0) return ok(null);

  // Снимок ДО soft-delete: после него строки «удалены», а марка и название
  // нужны событию. Фильтр `deleted_at is null` отсекает уже удалённые id —
  // повторный вызов с тем же id не должен породить второе `removed`.
  const { data: items, error: snapshotError } = await c.supabase
    .from("spec_items")
    .select("id, code, name")
    .in("id", ids)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null);

  if (snapshotError) {
    console.error("[deleteSpecItems] snapshot", snapshotError.message);
    return fail("Не удалось удалить");
  }

  const { error } = await c.supabase
    .from("spec_items")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId);

  if (error) {
    console.error("[deleteSpecItems]", error.message);
    return fail("Не удалось удалить");
  }

  // Событие — строго после успешной мутации: неудавшееся удаление не должно
  // оставить в истории запись об удалении.
  await recordSpecItemEvents(
    c.supabase,
    buildRemovedEvents({
      orgId: c.orgId,
      actor: eventActorOf(c),
      items: items ?? [],
    }),
  );

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

export async function restoreSpecItems(
  orgSlug: string,
  projectId: string,
  ids: string[],
): Promise<ActionResult<null>> {
  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);
  if (ids.length === 0) return ok(null);

  // Снимок ДО восстановления. Здесь наоборот: интересны строки, которые
  // сейчас удалены, — иначе повторный вызов породил бы второе `restored`.
  const { data: items, error: snapshotError } = await c.supabase
    .from("spec_items")
    .select("id, code, name")
    .in("id", ids)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId)
    .not("deleted_at", "is", null);

  if (snapshotError) {
    console.error("[restoreSpecItems] snapshot", snapshotError.message);
    return fail("Не удалось восстановить");
  }

  const { error } = await c.supabase
    .from("spec_items")
    .update({ deleted_at: null })
    .in("id", ids)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId);

  if (error) {
    if (error.code === "23505") {
      return fail("Марка позиции уже занята другой — восстановить нельзя");
    }
    console.error("[restoreSpecItems]", error.message);
    return fail("Не удалось восстановить");
  }

  await recordSpecItemEvents(
    c.supabase,
    buildRestoredEvents({
      orgId: c.orgId,
      actor: eventActorOf(c),
      items: items ?? [],
    }),
  );

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

type SetCodeRow = {
  result: "ok" | "swapped" | "unchanged";
  swapped_id: string | null;
  swapped_name: string | null;
};

/**
 * Смена марки позиции. Mutation живёт в RPC `set_spec_item_code`: уникальность
 * марки в проекте и обмен между позициями проверяются в БД, поэтому через
 * `saveSpecItemPatch` марка не ходит и его владельцем не является.
 */
export async function setSpecItemCode(
  orgSlug: string,
  projectId: string,
  itemId: string,
  code: string,
  allowSwap = false,
): Promise<
  ActionResult<{ result: SetCodeRow["result"]; swappedName: string | null }>
> {
  const { error: guardErr, c } = await guard(orgSlug, projectId);
  if (!c) return fail(guardErr);

  // Прежняя марка — из БД, до mutation: RPC её не возвращает, а событию нужен
  // `from`. Снимок scoped по организации и проекту, поэтому по удалённой или
  // чужой позиции его не будет — и события тоже.
  const { data: before, error: readError } = await c.supabase
    .from("spec_items")
    .select("id, code")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (readError) {
    console.error("[setSpecItemCode] snapshot", readError.message);
    return fail("Не удалось изменить марку");
  }

  const { data, error } = await callRpc(c.supabase, "set_spec_item_code", {
    p_org_id: c.orgId,
    p_project_id: projectId,
    p_item_id: itemId,
    p_code: code,
    p_allow_swap: allowSwap,
  });

  if (error) {
    const m = error.message;
    if (m.includes("CODE_INVALID")) return fail("Формат марки: «О-03»");
    if (m.includes("CODE_TAKEN"))
      return fail(`CODE_TAKEN:${m.split("CODE_TAKEN:")[1]?.trim() ?? ""}`);
    console.error("[setSpecItemCode]", m);
    return fail("Не удалось изменить марку");
  }

  const row = data?.[0];
  if (!row) return fail("Пустой ответ сервера");

  // Событие — строго после успешной mutation. Обмен меняет марку у двух
  // позиций, поэтому записываем обе: у второй `from` — запрошенная марка (она
  // и была занята), а `to` — прежняя марка текущей позиции.
  if (before) {
    await recordSpecItemEvents(
      c.supabase,
      buildCodeChangedEvents({
        orgId: c.orgId,
        actor: eventActorOf(c),
        items: [
          { id: itemId, from: before.code, to: code },
          ...(row.result === "swapped" && row.swapped_id
            ? [{ id: row.swapped_id, from: code, to: before.code }]
            : []),
        ],
      }),
    );
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok({ result: row.result, swappedName: row.swapped_name });
}
