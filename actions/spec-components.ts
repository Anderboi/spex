"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canMutateRecord } from "@/lib/permissions";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import type { Tables } from "@/lib/supabase/database.types";
import {
  specItemComponentCreateSchema,
  specItemComponentRefSchema,
  specItemGroupSchema,
  type SpecItemComponentCreateInput,
  type SpecItemComponentRefInput,
  type SpecItemGroupInput,
} from "@/lib/validations";

/** Вид строки состава, который возвращается клиенту: компонент, группа или ссылка. */
export type SpecItemComponentKind = "component" | "group" | "spec_ref";

/** Тип строки spec_items, из которой собираем «свежие» данные для показа ссылки. */
type RefItemRow = Pick<
  Tables<"spec_items">,
  | "id"
  | "code"
  | "name"
  | "type"
  | "org_id"
  | "project_id"
  | "deleted_at"
>;

/**
 * «Свежие» данные связанного SpecItem для строки kind = 'spec_ref'.
 * Только для отображения: значения НЕ копируются в spec_item_components.
 * Стоимость исходной позиции сюда не включается: она уже учтена в основной
 * таблице, а в стоимости состава участвует только additional_cost ссылки.
 */
export type SpecItemComponentRefView =
  | {
      id: string;
      available: true;
      code: string;
      name: string;
      type: string;
    }
  | { id: string; available: false };

/**
 * Строка состава, как её отдаём клиенту (без служебных полей и связей).
 * Группа — это строка kind = 'group' этой же таблицы; для неё стоимость,
 * компания, контакт, заметки и parent_component_id всегда null.
 * Строка kind = 'spec_ref' хранит только ref_spec_item_id и additional_cost;
 * `name` — технический маркер 'spec_ref' и в UI не показывается.
 */
export type SpecItemComponentRow = {
  id: string;
  kind: SpecItemComponentKind;
  /** Для component/group — собственное название; для spec_ref — 'spec_ref'. */
  name: string;
  notes: string | null;
  cost: number | null;
  /** Ручная дополнительная сумма (используется для kind = 'spec_ref'). */
  additional_cost: number | null;
  company_id: string | null;
  contact_id: string | null;
  /** Для kind = 'spec_ref' — id исходной позиции спецификации. */
  ref_spec_item_id: string | null;
  /** Для компонента внутри группы — id группы; для группы и верхнего уровня — null. */
  parent_component_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  /**
   * Для kind = 'spec_ref' — данные связанной позиции (свежие, только для
   * отображения); для component/group всегда null.
   */
  ref_spec_item: SpecItemComponentRefView | null;
};

/**
 * Клиент всегда создаётся на сервере, org_id всегда из сессии пользователя.
 * Паттерн повторяет actions/specifications.ts: проверяется, что проект
 * принадлежит организации из сессии, и что у пользователя есть к нему доступ.
 */

async function scoped(orgSlug: string, projectId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();
  return { ...ctx, supabase, projectId, createdBy: null as string | null };
}

type ComponentCtx = Awaited<ReturnType<typeof scoped>>;

/** Проект существует в организации сессии (для чтения состава). */
async function projectInOrg(
  orgSlug: string,
  projectId: string,
): Promise<{ error: null; c: ComponentCtx } | { error: string; c: null }> {
  const c = await scoped(orgSlug, projectId);
  const { data: project } = await c.supabase
    .from("projects")
    .select("id, created_by")
    .eq("id", projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) return { error: "Проект не найден", c: null };
  return { error: null, c: { ...c, createdBy: project.created_by } };
}

/**
 * Позиция spec_items принадлежит проекту и организации сессии.
 * Без этого клиент не должен читать/создавать состав для чужих позиций.
 */
async function assertSpecItemInProject(
  c: ComponentCtx,
  specItemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: item } = await c.supabase
    .from("spec_items")
    .select("id")
    .eq("id", specItemId)
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!item) return { ok: false, error: "Позиция не найдена" };
  return { ok: true };
}

/**
 * Компонент существует в организации сессии и является строкой
 * kind = 'component' (группы и spec_ref не подходят). Компонент может
 * находиться на верхнем уровне или внутри группы. Возвращает spec_item_id
 * для последующей сверки с проектом.
 */
async function assertComponentInOrg(
  c: ComponentCtx,
  componentId: string,
): Promise<{ ok: true; specItemId: string } | { ok: false; error: string }> {
  const { data: comp } = await c.supabase
    .from("spec_item_components")
    .select("spec_item_id")
    .eq("id", componentId)
    .eq("org_id", c.orgId)
    .eq("kind", "component")
    .maybeSingle();

  if (!comp) return { ok: false, error: "Компонент не найден" };
  return { ok: true, specItemId: comp.spec_item_id };
}

/**
 * Группа существует в организации сессии и является прямой строкой
 * kind = 'group' без родителя (вложенность групп запрещена). Возвращает
 * spec_item_id для последующей сверки с проектом.
 */
async function assertGroupInOrg(
  c: ComponentCtx,
  groupId: string,
): Promise<{ ok: true; specItemId: string } | { ok: false; error: string }> {
  const { data: group } = await c.supabase
    .from("spec_item_components")
    .select("spec_item_id")
    .eq("id", groupId)
    .eq("org_id", c.orgId)
    .eq("kind", "group")
    .is("parent_component_id", null)
    .maybeSingle();

  if (!group) return { ok: false, error: "Группа не найдена" };
  return { ok: true, specItemId: group.spec_item_id };
}

/**
 * Родитель компонента при создании внутри группы: существующая группа
 * той же позиции состава и той же организации. Вложенные группы запрещены,
 * поэтому у родителя parent_component_id = null.
 */
async function assertParentGroupInContainer(
  c: ComponentCtx,
  specItemId: string,
  parentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: parent } = await c.supabase
    .from("spec_item_components")
    .select("spec_item_id, kind, parent_component_id")
    .eq("id", parentId)
    .eq("org_id", c.orgId)
    .maybeSingle();

  if (!parent) return { ok: false, error: "Группа не найдена" };
  if (parent.spec_item_id !== specItemId) {
    return { ok: false, error: "Группа принадлежит другой позиции" };
  }
  if (parent.kind !== "group") {
    return { ok: false, error: "Родитель должен быть группой" };
  }
  if (parent.parent_component_id !== null) {
    return { ok: false, error: "Вложенные группы не разрешены" };
  }
  return { ok: true };
}

/**
 * Следующая позиция в «контейнере»: среди строк без родителя (для групп и
 * верхнеуровневых компонентов) или среди строк конкретной группы. Позиции
 * разных контейнеров независимы.
 */
async function nextComponentPosition(
  c: ComponentCtx,
  specItemId: string,
  parentId: string | null,
): Promise<number> {
  let query = c.supabase
    .from("spec_item_components")
    .select("position")
    .eq("spec_item_id", specItemId)
    .eq("org_id", c.orgId)
    .order("position", { ascending: false })
    .limit(1);
  if (parentId) query = query.eq("parent_component_id", parentId);
  else query = query.is("parent_component_id", null);
  const { data: last } = await query.maybeSingle();
  return (last?.position ?? -1) + 1;
}

/** Компания и контакт обязаны существовать в организации сессии. */
async function assertCompanyContactInOrg(
  c: ComponentCtx,
  companyId: string | null,
  contactId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (companyId) {
    const { data: co } = await c.supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("org_id", c.orgId)
      .maybeSingle();
    if (!co) return { ok: false, error: "Компания не найдена" };
  }
  if (contactId) {
    const { data: ct } = await c.supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("org_id", c.orgId)
      .maybeSingle();
    if (!ct) return { ok: false, error: "Контакт не найден" };
  }
  return { ok: true };
}
/** Колонки для списка и ответов клиенту (kind и parent нужны для иерархии). */
const ROW_COLUMNS =
  "id, kind, name, notes, cost, additional_cost, company_id, contact_id, ref_spec_item_id, parent_component_id, position, created_at, updated_at";

/** Колонки spec_items для «свежих» данных ссылки (только для отображения). */
const REF_ITEM_COLUMNS =
  "id, code, name, type, org_id, project_id, deleted_at";

/** В БД kind — обычный text; приводим к клиентскому объединению типов. */
function toClientRow(
  row: Omit<SpecItemComponentRow, "kind" | "ref_spec_item"> & {
    kind: string;
  },
): SpecItemComponentRow {
  if (row.kind === "group")
    return { ...row, kind: "group", ref_spec_item: null };
  if (row.kind === "spec_ref")
    return { ...row, kind: "spec_ref", ref_spec_item: null };
  return { ...row, kind: "component", ref_spec_item: null };
}

/**
 * Дозаполняет строки kind = 'spec_ref' свежими данными связанной позиции
 * (id, code, name, type) для отображения. Значения в spec_item_components
 * не пишутся. Если связанная позиция удалена/недоступна — available = false.
 */
async function hydrateRefItems(
  c: ComponentCtx,
  rows: SpecItemComponentRow[],
): Promise<SpecItemComponentRow[]> {
  const refIds = [
    ...new Set(
      rows
        .filter((r) => r.kind === "spec_ref" && r.ref_spec_item_id)
        .map((r) => r.ref_spec_item_id as string),
    ),
  ];
  if (refIds.length === 0) return rows;

  const { data } = await c.supabase
    .from("spec_items")
    .select(REF_ITEM_COLUMNS)
    .in("id", refIds);

  const byId = new Map((data ?? []).map((it) => [it.id, it as RefItemRow]));
  return rows.map((row) => {
    if (row.kind !== "spec_ref" || !row.ref_spec_item_id) return row;
    const it = byId.get(row.ref_spec_item_id);
    if (
      it &&
      it.org_id === c.orgId &&
      it.project_id === c.projectId &&
      it.deleted_at === null
    ) {
      return {
        ...row,
        ref_spec_item: {
          id: it.id,
          available: true,
          code: it.code ?? "",
          name: it.name,
          type: it.type,
        },
      };
    }
    return {
      ...row,
      ref_spec_item: { id: row.ref_spec_item_id, available: false },
    };
  });
}

/** Строка spec_ref существует в организации сессии; возвращает spec_item_id и её группу. */
async function assertSpecRefInOrg(
  c: ComponentCtx,
  componentId: string,
): Promise<
  | { ok: true; specItemId: string; parentComponentId: string | null }
  | { ok: false; error: string }
> {
  const { data: ref } = await c.supabase
    .from("spec_item_components")
    .select("spec_item_id, parent_component_id")
    .eq("id", componentId)
    .eq("org_id", c.orgId)
    .eq("kind", "spec_ref")
    .maybeSingle();

  if (!ref) return { ok: false, error: "Ссылка не найдена" };
  return {
    ok: true,
    specItemId: ref.spec_item_id,
    parentComponentId: ref.parent_component_id,
  };
}

/**
 * Целевая позиция ссылки обязана существовать в том же проекте/организации,
 * не быть удалённой и не совпадать с владельцем состава.
 */
async function assertRefSpecItemInProject(
  c: ComponentCtx,
  specItemId: string,
  refSpecItemId: string,
): Promise<{ ok: true; ref: RefItemRow } | { ok: false; error: string }> {
  if (refSpecItemId === specItemId) {
    return {
      ok: false,
      error: "Нельзя ссылаться на эту же позицию",
    };
  }
  const { data: ref } = await c.supabase
    .from("spec_items")
    .select(REF_ITEM_COLUMNS)
    .eq("id", refSpecItemId)
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!ref) {
    return { ok: false, error: "Позиция не найдена в этом проекте" };
  }
  return { ok: true, ref: ref as RefItemRow };
}

/**
 * Защита от дублей: одна и та же позиция спецификации не может быть добавлена
 * в один контейнер состава (выбранную группу или верхний уровень) дважды.
 * Дубликатом считается существующая строка kind = 'spec_ref' с теми же
 * spec_item_id, parent_component_id и ref_spec_item_id. Ссылки из других
 * групп/уровней не учитываются.
 */
async function assertNoDuplicateSpecRef(
  c: ComponentCtx,
  specItemId: string,
  parentComponentId: string | null,
  refSpecItemId: string,
  excludeId: string | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let query = c.supabase
    .from("spec_item_components")
    .select("id", { count: "exact", head: true })
    .eq("spec_item_id", specItemId)
    .eq("org_id", c.orgId)
    .eq("kind", "spec_ref")
    .eq("ref_spec_item_id", refSpecItemId);

  if (parentComponentId) query = query.eq("parent_component_id", parentComponentId);
  else query = query.is("parent_component_id", null);

  if (excludeId) query = query.neq("id", excludeId);

  const { count, error } = await query;
  if (error) {
    console.error("[assertNoDuplicateSpecRef]", error.message);
    return { ok: false, error: "Не удалось проверить состав" };
  }
  if ((count ?? 0) > 0) {
    return { ok: false, error: "Эта позиция уже добавлена в группу" };
  }
  return { ok: true };
}

/**
 * Собрать строки состава позиции после уже выполненных проверок доступа:
 * полный отсортированный по position список (группы, компоненты, ссылки),
 * пригодный для ответа клиенту и для обновления списка без перезагрузки.
 */
async function fetchSpecItemComponentRows(
  c: ComponentCtx,
  specItemId: string,
): Promise<{ ok: true; rows: SpecItemComponentRow[] } | { ok: false; error: string }> {
  const { data, error } = await c.supabase
    .from("spec_item_components")
    .select(ROW_COLUMNS)
    .eq("spec_item_id", specItemId)
    .eq("org_id", c.orgId)
    .in("kind", ["component", "group", "spec_ref"])
    .order("position", { ascending: true });

  if (error) {
    console.error("[fetchSpecItemComponentRows]", error.message);
    return { ok: false, error: "Не удалось загрузить состав" };
  }

  return { ok: true, rows: await hydrateRefItems(c, (data ?? []).map(toClientRow)) };
}

/**
 * Элементы состава позиции — группы, компоненты и ссылки на позиции
 * (и верхнего уровня, и внутри групп), отсортированные по position внутри
 * своего контейнера. Клиент группирует их по parent_component_id.
 */
export async function listSpecItemComponents(
  orgSlug: string,
  projectId: string,
  specItemId: string,
): Promise<ActionResult<SpecItemComponentRow[]>> {
  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);
  const item = await assertSpecItemInProject(base.c, specItemId);
  if (!item.ok) return fail(item.error);

  const res = await fetchSpecItemComponentRows(base.c, specItemId);
  if (!res.ok) return fail(res.error);
  return ok(res.rows);
}

/**
 * Составы всех позиций проекта одним запросом (без N+1) — для сводки.
 * Возвращает словарь spec_item_id → строки состава в той же клиентской модели,
 * что и в listSpecItemComponents. Гидрация ссылок выполняется одним общим
 * запросом по всем строкам. Позиции без состава в ответе отсутствуют.
 */
export async function listProjectSpecCompositions(
  orgSlug: string,
  projectId: string,
  specItemIds: string[],
): Promise<ActionResult<Record<string, SpecItemComponentRow[]>>> {
  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  const ids = [...new Set(specItemIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return ok({});

  const { data, error } = await base.c.supabase
    .from("spec_item_components")
    .select(`${ROW_COLUMNS}, spec_item_id`)
    .in("spec_item_id", ids)
    .eq("org_id", base.c.orgId)
    .in("kind", ["component", "group", "spec_ref"])
    .order("position", { ascending: true });

  if (error) {
    console.error("[listProjectSpecCompositions]", error.message);
    return fail("Не удалось загрузить состав");
  }

  // spec_item_id нужен только чтобы разложить строки по позициям; наружу он
  // не уходит — ключ словаря и есть владелец состава.
  type RowWithOwner = SpecItemComponentRow & { spec_item_id: string };
  const rowsWithOwner = (data ?? []).map(
    (row) =>
      ({ ...toClientRow(row), spec_item_id: row.spec_item_id }) as RowWithOwner,
  );
  const hydrated = (await hydrateRefItems(
    base.c,
    rowsWithOwner,
  )) as RowWithOwner[];

  const byItem: Record<string, SpecItemComponentRow[]> = {};
  for (const row of hydrated) {
    const list = byItem[row.spec_item_id];
    if (list) list.push(row);
    else byItem[row.spec_item_id] = [row];
  }
  return ok(byItem);
}

/** Создать компонент состава. Никогда не трогает spec_items/основную таблицу. */
export async function createSpecItemComponent(
  orgSlug: string,
  projectId: string,
  specItemId: string,
  input: SpecItemComponentCreateInput,
  parentComponentId: string | null = null,
): Promise<ActionResult<SpecItemComponentRow>> {
  const parsed = specItemComponentCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Неверные данные");
  }

  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }
  const item = await assertSpecItemInProject(base.c, specItemId);
  if (!item.ok) return fail(item.error);

  const d = parsed.data;

  // Если компонент создаётся внутри группы — проверить группу (та же позиция,
  // та же организация, kind = 'group', без родителя).
  if (parentComponentId) {
    const parent = await assertParentGroupInContainer(
      base.c,
      specItemId,
      parentComponentId,
    );
    if (!parent.ok) return fail(parent.error);
  }

  // Компания/контакт обязаны быть из организации сессии.
  if (d.companyId) {
    const { data: co } = await base.c.supabase
      .from("companies")
      .select("id")
      .eq("id", d.companyId)
      .eq("org_id", base.c.orgId)
      .maybeSingle();
    if (!co) return fail("Компания не найдена");
  }
  if (d.contactId) {
    const { data: ct } = await base.c.supabase
      .from("contacts")
      .select("id")
      .eq("id", d.contactId)
      .eq("org_id", base.c.orgId)
      .maybeSingle();
    if (!ct) return fail("Контакт не найден");
  }

  // Позиция считается отдельно для верхнего уровня и для каждой группы.
  const position = await nextComponentPosition(
    base.c,
    specItemId,
    parentComponentId,
  );

  const { data, error } = await base.c.supabase
    .from("spec_item_components")
    .insert({
      org_id: base.c.orgId,
      spec_item_id: specItemId,
      kind: "component",
      name: d.name,
      company_id: d.companyId,
      contact_id: d.contactId,
      cost: d.cost,
      notes: d.notes?.trim() ? d.notes.trim() : null,
      parent_component_id: parentComponentId,
      position,
    })
    .select(ROW_COLUMNS)
    .single();

  if (error) {
    console.error("[createSpecItemComponent]", error.message);
    return fail("Не удалось добавить компонент");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(toClientRow(data));
}

/**
 * Обновить компонент состава.
 * Меняются только name/cost/company/contact/notes; kind, spec_item_id,
 * org_id, position и parent_component_id остаются нетронутыми.
 */
export async function updateSpecItemComponent(
  orgSlug: string,
  projectId: string,
  componentId: string,
  input: SpecItemComponentCreateInput,
): Promise<ActionResult<SpecItemComponentRow>> {
  const parsed = specItemComponentCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Неверные данные");
  }

  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }

  // Компонент обязан принадлежать организации и быть прямой строкой состава.
  const comp = await assertComponentInOrg(base.c, componentId);
  if (!comp.ok) return fail(comp.error);

  // Его spec_item обязан быть в проекте этой организации.
  const item = await assertSpecItemInProject(base.c, comp.specItemId);
  if (!item.ok) return fail(item.error);

  const d = parsed.data;

  // Компания/контакт обязаны быть из организации сессии.
  const refs = await assertCompanyContactInOrg(base.c, d.companyId, d.contactId);
  if (!refs.ok) return fail(refs.error);

  const { data, error } = await base.c.supabase
    .from("spec_item_components")
    .update({
      name: d.name,
      company_id: d.companyId,
      contact_id: d.contactId,
      cost: d.cost,
      notes: d.notes?.trim() ? d.notes.trim() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", componentId)
    .eq("spec_item_id", comp.specItemId)
    .eq("org_id", base.c.orgId)
    .select(ROW_COLUMNS)
    .single();

  if (error) {
    console.error("[updateSpecItemComponent]", error.message);
    return fail("Не удалось сохранить компонент");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(toClientRow(data));
}

/**
 * Удалить конкретный компонент состава.
 * Удаляется только строка spec_item_components; spec_items и основная
 * таблица не затрагиваются.
 */
export async function deleteSpecItemComponent(
  orgSlug: string,
  projectId: string,
  componentId: string,
): Promise<ActionResult<null>> {
  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }

  const comp = await assertComponentInOrg(base.c, componentId);
  if (!comp.ok) return fail(comp.error);

  const item = await assertSpecItemInProject(base.c, comp.specItemId);
  if (!item.ok) return fail(item.error);

  const { error } = await base.c.supabase
    .from("spec_item_components")
    .delete()
    .eq("id", componentId)
    .eq("spec_item_id", comp.specItemId)
    .eq("org_id", base.c.orgId)
    .eq("kind", "component");

  if (error) {
    console.error("[deleteSpecItemComponent]", error.message);
    return fail("Не удалось удалить компонент");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

/** Направление перемещения компонента внутри группы. */
export type SpecItemComponentMoveDirection = "up" | "down";

/**
 * Переместить компонент внутри его группы на одну позицию.
 *
 * Меняются местами только position текущего компонента и его соседа по той же
 * группе (одинаковый parent_component_id). parent_component_id, kind и все
 * остальные поля не затрагиваются: компонент не может перейти в другую группу
 * или на верхний уровень. Группы, компоненты вне групп и обычные SpecItem не
 * меняются. Если соседний элемент отсутствует (граница группы), ничего не
 * меняется и возвращается ok(null). После успешного обмена возвращается свежий
 * отсортированный список состава позиции для обновления UI без перезагрузки.
 */
export async function moveSpecItemComponent(
  orgSlug: string,
  projectId: string,
  componentId: string,
  direction: SpecItemComponentMoveDirection,
): Promise<ActionResult<SpecItemComponentRow[] | null>> {
  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  if (direction !== "up" && direction !== "down") {
    return fail("Неверное направление перемещения");
  }

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }

  // Исходный компонент: строка kind = 'component' организации сессии.
  const { data: comp, error: compError } = await base.c.supabase
    .from("spec_item_components")
    .select("spec_item_id, parent_component_id, position")
    .eq("id", componentId)
    .eq("org_id", base.c.orgId)
    .eq("kind", "component")
    .maybeSingle();

  if (compError) {
    console.error("[moveSpecItemComponent]", compError.message);
    return fail("Не удалось найти компонент");
  }
  if (!comp) return fail("Компонент не найден");

  // Пока перемещение поддержано только для строк внутри группы.
  if (!comp.parent_component_id) {
    return ok(null);
  }

  // Его позиция спецификации обязана быть в проекте этой организации.
  const item = await assertSpecItemInProject(base.c, comp.spec_item_id);
  if (!item.ok) return fail(item.error);

  // Родитель — настоящая группа той же позиции (не вложенная, та же org).
  const parent = await assertParentGroupInContainer(
    base.c,
    comp.spec_item_id,
    comp.parent_component_id,
  );
  if (!parent.ok) return fail(parent.error);

  // Сосед — ближайшая строка той же группы: для «вверх» — предыдущая по
  // position, для «вниз» — следующая.
  let neighborQuery = base.c.supabase
    .from("spec_item_components")
    .select("id, position")
    .eq("spec_item_id", comp.spec_item_id)
    .eq("org_id", base.c.orgId)
    .eq("parent_component_id", comp.parent_component_id)
    .order("position", { ascending: direction === "down" });

  neighborQuery =
    direction === "up"
      ? neighborQuery.lt("position", comp.position).limit(1)
      : neighborQuery.gt("position", comp.position).limit(1);

  const { data: neighbor, error: neighborError } =
    await neighborQuery.maybeSingle();

  if (neighborError) {
    console.error("[moveSpecItemComponent]", neighborError.message);
    return fail("Не удалось найти соседа в группе");
  }

  // Компонент на границе группы — соседа нет, менять нечего.
  if (!neighbor) return ok(null);

  const now = new Date().toISOString();

  // Безопасный обмен position двух соседних строк одного контейнера:
  // сначала переносим позицию соседа на компонент, затем позицию компонента
  // на соседа. При сбое второго обновления первое откатывается назад.
  const swapCurrent = await base.c.supabase
    .from("spec_item_components")
    .update({ position: neighbor.position, updated_at: now })
    .eq("id", componentId)
    .eq("org_id", base.c.orgId)
    .eq("spec_item_id", comp.spec_item_id)
    .eq("parent_component_id", comp.parent_component_id);

  if (swapCurrent.error) {
    console.error("[moveSpecItemComponent]", swapCurrent.error.message);
    return fail("Не удалось переместить компонент");
  }

  const swapNeighbor = await base.c.supabase
    .from("spec_item_components")
    .update({ position: comp.position, updated_at: now })
    .eq("id", neighbor.id)
    .eq("org_id", base.c.orgId)
    .eq("spec_item_id", comp.spec_item_id)
    .eq("parent_component_id", comp.parent_component_id);

  if (swapNeighbor.error) {
    // Возвращаем компоненту его исходную позицию, чтобы не оставить дубль.
    await base.c.supabase
      .from("spec_item_components")
      .update({ position: comp.position, updated_at: new Date().toISOString() })
      .eq("id", componentId)
      .eq("org_id", base.c.orgId)
      .eq("spec_item_id", comp.spec_item_id)
      .eq("parent_component_id", comp.parent_component_id);
    console.error("[moveSpecItemComponent]", swapNeighbor.error.message);
    return fail("Не удалось переместить компонент");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);

  const rows = await fetchSpecItemComponentRows(base.c, comp.spec_item_id);
  if (!rows.ok) return fail(rows.error);
  return ok(rows.rows);
}

/**
 * Создать группу состава. Группа — это только название: без родителя,
 * стоимости, компании, контакта и заметок; position считается на сервере.
 * Вложенность групп запрещена, поэтому parent_component_id = null.
 */
export async function createSpecItemComponentGroup(
  orgSlug: string,
  projectId: string,
  specItemId: string,
  input: SpecItemGroupInput,
): Promise<ActionResult<SpecItemComponentRow>> {
  const parsed = specItemGroupSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Неверные данные");
  }

  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }

  const item = await assertSpecItemInProject(base.c, specItemId);
  if (!item.ok) return fail(item.error);

  const d = parsed.data;

  // Новая строка — в конец верхнего уровня (группы и верхнеуровневые
  // компоненты используют общую последовательность position).
  const position = await nextComponentPosition(base.c, specItemId, null);

  const { data, error } = await base.c.supabase
    .from("spec_item_components")
    .insert({
      org_id: base.c.orgId,
      spec_item_id: specItemId,
      kind: "group",
      name: d.name,
      parent_component_id: null,
      cost: null,
      company_id: null,
      contact_id: null,
      notes: null,
      position,
    })
    .select(ROW_COLUMNS)
    .single();

  if (error) {
    console.error("[createSpecItemComponentGroup]", error.message);
    return fail("Не удалось создать группу");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(toClientRow(data));
}

/**
 * Переименовать группу состава. Меняется только name; kind, position,
 * spec_item_id, org_id и parent_component_id остаются нетронутыми.
 */
export async function updateSpecItemComponentGroup(
  orgSlug: string,
  projectId: string,
  groupId: string,
  input: SpecItemGroupInput,
): Promise<ActionResult<SpecItemComponentRow>> {
  const parsed = specItemGroupSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Неверные данные");
  }

  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }

  // Группа обязана принадлежать организации и быть прямой строкой состава.
  const group = await assertGroupInOrg(base.c, groupId);
  if (!group.ok) return fail(group.error);

  const item = await assertSpecItemInProject(base.c, group.specItemId);
  if (!item.ok) return fail(item.error);

  const { data, error } = await base.c.supabase
    .from("spec_item_components")
    .update({
      name: parsed.data.name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId)
    .eq("spec_item_id", group.specItemId)
    .eq("org_id", base.c.orgId)
    .eq("kind", "group")
    .is("parent_component_id", null)
    .select(ROW_COLUMNS)
    .single();

  if (error) {
    console.error("[updateSpecItemComponentGroup]", error.message);
    return fail("Не удалось сохранить группу");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(toClientRow(data));
}

/**
 * Удалить группу состава.
 * Группа удаляется, только если в ней нет строк (parent_component_id не
 * ссылается на группу); иначе возвращается ошибка и группа сохраняется.
 */
export async function deleteSpecItemComponentGroup(
  orgSlug: string,
  projectId: string,
  groupId: string,
): Promise<ActionResult<null>> {
  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }

  const group = await assertGroupInOrg(base.c, groupId);
  if (!group.ok) return fail(group.error);

  const item = await assertSpecItemInProject(base.c, group.specItemId);
  if (!item.ok) return fail(item.error);

  // Не удаляем непустую группу: сначала проверяем, есть ли в ней строки.
  const { count, error: countError } = await base.c.supabase
    .from("spec_item_components")
    .select("id", { count: "exact", head: true })
    .eq("parent_component_id", groupId);

  if (countError) {
    console.error("[deleteSpecItemComponentGroup]", countError.message);
    return fail("Не удалось проверить содержимое группы");
  }
  if ((count ?? 0) > 0) {
    return fail("Нельзя удалить группу: сначала удалите её элементы");
  }

  const { error } = await base.c.supabase
    .from("spec_item_components")
    .delete()
    .eq("id", groupId)
    .eq("spec_item_id", group.specItemId)
    .eq("org_id", base.c.orgId)
    .eq("kind", "group")
    .is("parent_component_id", null);

  if (error) {
    console.error("[deleteSpecItemComponentGroup]", error.message);
    return fail("Не удалось удалить группу");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

/**
 * Добавить в состав ссылку на существующий SpecItem (kind = 'spec_ref').
 * Создаётся только строка spec_item_components: стоимость, компания, контакт
 * и заметки не используются; исходный SpecItem и основная таблица не меняются.
 */
export async function createSpecItemComponentRef(
  orgSlug: string,
  projectId: string,
  specItemId: string,
  input: SpecItemComponentRefInput,
  parentComponentId: string | null = null,
): Promise<ActionResult<SpecItemComponentRow>> {
  const parsed = specItemComponentRefSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Неверные данные");
  }

  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }

  const owner = await assertSpecItemInProject(base.c, specItemId);
  if (!owner.ok) return fail(owner.error);

  // Ссылка внутри группы — проверить группу (та же позиция и организация).
  if (parentComponentId) {
    const parent = await assertParentGroupInContainer(
      base.c,
      specItemId,
      parentComponentId,
    );
    if (!parent.ok) return fail(parent.error);
  }

  // Целевая позиция: тот же проект/организация, не удалена, не сам владелец.
  const target = await assertRefSpecItemInProject(
    base.c,
    specItemId,
    parsed.data.refSpecItemId,
  );
  if (!target.ok) return fail(target.error);

  // Одна и та же позиция не может быть добавлена в одну группу дважды.
  const duplicate = await assertNoDuplicateSpecRef(
    base.c,
    specItemId,
    parentComponentId,
    parsed.data.refSpecItemId,
  );
  if (!duplicate.ok) return fail(duplicate.error);

  const position = await nextComponentPosition(
    base.c,
    specItemId,
    parentComponentId,
  );

  const { data, error } = await base.c.supabase
    .from("spec_item_components")
    .insert({
      org_id: base.c.orgId,
      spec_item_id: specItemId,
      kind: "spec_ref",
      // name обязателен в БД, но для ссылки это технический маркер:
      // отображаются свежие данные связанной позиции, а не name.
      name: "spec_ref",
      ref_spec_item_id: parsed.data.refSpecItemId,
      additional_cost: parsed.data.additionalCost,
      parent_component_id: parentComponentId,
      position,
    })
    .select(ROW_COLUMNS)
    .single();

  if (error) {
    console.error("[createSpecItemComponentRef]", error.message);
    return fail("Не удалось добавить ссылку");
  }

  const row = toClientRow(data);
  const [hydrated] = await hydrateRefItems(base.c, [row]);
  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(hydrated);
}



/**
 * Изменить ссылку на позицию (kind = 'spec_ref'): можно сменить целевую
 * позицию и дополнительную сумму. kind, spec_item_id, org_id, position и
 * parent_component_id не меняются.
 */
export async function updateSpecItemComponentRef(
  orgSlug: string,
  projectId: string,
  componentId: string,
  input: SpecItemComponentRefInput,
): Promise<ActionResult<SpecItemComponentRow>> {
  const parsed = specItemComponentRefSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Неверные данные");
  }

  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }

  // Строка обязана быть ссылкой и принадлежать организации сессии.
  const specRef = await assertSpecRefInOrg(base.c, componentId);
  if (!specRef.ok) return fail(specRef.error);

  const owner = await assertSpecItemInProject(base.c, specRef.specItemId);
  if (!owner.ok) return fail(owner.error);

  // Новая целевая позиция: тот же проект/организация, не удалена, не владелец.
  const target = await assertRefSpecItemInProject(
    base.c,
    specRef.specItemId,
    parsed.data.refSpecItemId,
  );
  if (!target.ok) return fail(target.error);

  // Смена целевой позиции не должна создавать дубль внутри той же группы.
  const duplicate = await assertNoDuplicateSpecRef(
    base.c,
    specRef.specItemId,
    specRef.parentComponentId,
    parsed.data.refSpecItemId,
    componentId,
  );
  if (!duplicate.ok) return fail(duplicate.error);

  const { data, error } = await base.c.supabase
    .from("spec_item_components")
    .update({
      ref_spec_item_id: parsed.data.refSpecItemId,
      additional_cost: parsed.data.additionalCost,
      updated_at: new Date().toISOString(),
    })
    .eq("id", componentId)
    .eq("spec_item_id", specRef.specItemId)
    .eq("org_id", base.c.orgId)
    .eq("kind", "spec_ref")
    .select(ROW_COLUMNS)
    .single();

  if (error) {
    console.error("[updateSpecItemComponentRef]", error.message);
    return fail("Не удалось сохранить ссылку");
  }

  const row = toClientRow(data);
  const [hydrated] = await hydrateRefItems(base.c, [row]);
  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(hydrated);
}

/**
 * Удалить ссылку на позицию из состава. Удаляется только строка
 * spec_item_components; исходный SpecItem и основная таблица не меняются.
 */
export async function deleteSpecItemComponentRef(
  orgSlug: string,
  projectId: string,
  componentId: string,
): Promise<ActionResult<null>> {
  const base = await projectInOrg(orgSlug, projectId);
  if (!base.c) return fail(base.error);

  // Право на изменение проекта (как у остальных действий со спецификацией).
  if (
    !canMutateRecord({
      role: base.c.role,
      userId: base.c.userId,
      createdBy: base.c.createdBy,
    })
  ) {
    return fail("Недостаточно прав");
  }

  const specRef = await assertSpecRefInOrg(base.c, componentId);
  if (!specRef.ok) return fail(specRef.error);

  const owner = await assertSpecItemInProject(base.c, specRef.specItemId);
  if (!owner.ok) return fail(owner.error);

  const { error } = await base.c.supabase
    .from("spec_item_components")
    .delete()
    .eq("id", componentId)
    .eq("spec_item_id", specRef.specItemId)
    .eq("org_id", base.c.orgId)
    .eq("kind", "spec_ref");

  if (error) {
    console.error("[deleteSpecItemComponentRef]", error.message);
    return fail("Не удалось удалить ссылку");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

