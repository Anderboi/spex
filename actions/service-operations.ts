"use server";

import { revalidatePath } from "next/cache";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canMutateRecord } from "@/lib/permissions";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import {
  SERVICE_OPERATION_BLOCKED_STATUSES,
  type ServiceOperationType,
} from "@/lib/constants";
import {
  serviceOperationCreateSchema,
  serviceOperationDeleteSchema,
  serviceOperationUpdateSchema,
  type ServiceOperationFields,
} from "@/lib/validations";

/**
 * Дополнительные расходы проекта: операции «Монтаж» (installation) и
 * «Доставка» (delivery).
 *
 * Стоимость операции (amount) — самостоятельный агрегат: она не пишется в
 * spec_items.cost и не суммируется повторно на каждую связанную позицию.
 * org_id всегда из сессии, никогда из аргументов клиента.
 */

/** Строка service_operations для ответа клиенту (без служебных полей). */
type OperationRow = {
  id: string;
  type: string;
  amount: number;
  completed: boolean;
  deadline: string | null;
  contractor_company_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Колонки service_operations, которые возвращаются клиенту. */
const OP_COLUMNS =
  "id, type, amount, completed, deadline, contractor_company_id, notes, created_at, updated_at";

/**
 * Операция, как её получает клиент: значения + id связанных позиций и
 * «свежее» название компании-подрядчика (только для отображения, в БД
 * не хранится).
 */
export type ServiceOperation = {
  id: string;
  type: ServiceOperationType;
  amount: number;
  /** Отметка «исполнено» (используется для доставки). */
  completed: boolean;
  deadline: string | null;
  contractor_company_id: string | null;
  contractor_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  spec_item_ids: string[];
};

async function scoped(orgSlug: string, projectId: string) {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();
  return { ...ctx, supabase, projectId };
}

type OpCtx = Awaited<ReturnType<typeof scoped>>;

function toType(v: string): ServiceOperationType {
  return v === "installation" ? "installation" : "delivery";
}

/** Проект существует и принадлежит организации сессии (для записи). */
async function guardProject(
  c: OpCtx,
): Promise<{ error: null; createdBy: string | null } | { error: string }> {
  const { data: project } = await c.supabase
    .from("projects")
    .select("id, created_by")
    .eq("id", c.projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) return { error: "Проект не найден" };
  if (
    !canMutateRecord({
      role: c.role,
      userId: c.userId,
      createdBy: project.created_by,
    })
  ) {
    return { error: "Недостаточно прав" };
  }
  return { error: null, createdBy: project.created_by };
}

/** «Короткое» описание заблокированных позиций для понятного сообщения. */
function describeBlocked(rows: Array<{ name: string }>): string {
  const shown = rows.slice(0, 2);
  const names = shown.map((r) => `«${r.name}»`).join(", ");
  const rest = rows.length - shown.length;
  return rest > 0 ? `${names} и ещё ${rest}` : names;
}

/**
 * Текст ошибки при создании операции, в которую попали материалы со
 * статусом, недоступным для этого типа операции.
 */
function blockedStatusError(
  type: ServiceOperationType,
  blocked: Array<{ name: string }>,
): string {
  const names = describeBlocked(blocked);
  return type === "delivery"
    ? `Доставка не создана: ${names} — материалы со статусом «Доставлено» или «Заменить» нельзя включить в новую доставку.`
    : `Монтаж не создан: ${names} — материалы со статусом «Заменить» нельзя включить в монтаж.`;
}

/**
 * Один и тот же материал нельзя включить в две разные доставки.
 *
 * Перед созданием новой доставки (или сохранением связей существующей)
 * проверяем service_operation_items: если выбранная позиция уже связана с
 * какой-либо операцией типа delivery этого проекта/организации — операцию не
 * создаём и не сохраняем. При редактировании (excludeOperationId) собственные
 * связки редактируемой операции «другой доставкой» не считаются.
 */
async function assertNoOtherDelivery(
  c: OpCtx,
  ids: string[],
  opts: { action: "create" | "update"; excludeOperationId?: string } = {
    action: "create",
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true };

  const { data: ops, error: opsErr } = await c.supabase
    .from("service_operations")
    .select("id")
    .eq("type", "delivery")
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId);

  if (opsErr) {
    console.error("[service-operations] deliveries", opsErr.message);
    return { ok: false, error: "Не удалось проверить доставки проекта" };
  }

  const otherOpIds = (ops ?? [])
    .map((o) => o.id)
    .filter((id) => id !== opts.excludeOperationId);
  if (otherOpIds.length === 0) return { ok: true };

  const { data: links, error: linksErr } = await c.supabase
    .from("service_operation_items")
    .select("spec_item_id")
    .in("operation_id", otherOpIds)
    .in("spec_item_id", ids);

  if (linksErr) {
    console.error("[service-operations] delivery links", linksErr.message);
    return { ok: false, error: "Не удалось проверить материалы доставок" };
  }

  const takenIds = [...new Set((links ?? []).map((l) => l.spec_item_id))];
  if (takenIds.length === 0) return { ok: true };

  const { data: taken, error: itemsErr } = await c.supabase
    .from("spec_items")
    .select("id, name")
    .in("id", takenIds)
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId);

  if (itemsErr) {
    console.error("[service-operations] delivery items", itemsErr.message);
    return { ok: false, error: "Не удалось загрузить материалы доставки" };
  }

  const blocked = (taken ?? []).map((r) => ({ name: r.name }));
  const names = describeBlocked(blocked);
  const subject =
    blocked.length === 1
      ? "этот материал уже связан с другой доставкой"
      : "эти материалы уже связаны с другой доставкой";
  const prefix =
    opts.action === "create"
      ? "Доставка не создана"
      : "Доставка не сохранена";
  return { ok: false, error: `${prefix}: ${names} — ${subject}.` };
}

/**
 * Все выбранные позиции обязаны существовать в этом проекте/организации,
 * не быть удалёнными и не быть заглушками (placeholder). При создании
 * операции (forbid) дополнительно проверяются статусы: материалы со
 * статусами из SERVICE_OPERATION_BLOCKED_STATUSES в новую операцию
 * включить нельзя. Редактирование существующей операции разрешено и для
 * таких позиций — список позиций при обновлении не меняется пользователем.
 */
async function assertProjectItems(
  c: OpCtx,
  ids: string[],
  opts: { forbid?: ServiceOperationType } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ids.length === 0) {
    return { ok: false, error: "Выберите хотя бы одну позицию" };
  }

  const { data: rows, error } = await c.supabase
    .from("spec_items")
    .select("id, name, status, is_placeholder, org_id, project_id, deleted_at")
    .in("id", ids)
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId);

  if (error) {
    console.error("[service-operations] spec_items", error.message);
    return { ok: false, error: "Не удалось проверить позиции" };
  }

  const found = new Set((rows ?? []).map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    return { ok: false, error: "Позиция не найдена в этом проекте" };
  }

  const placeholders = (rows ?? []).filter((r) => r.is_placeholder);
  if (placeholders.length > 0) {
    return {
      ok: false,
      error: "Заглушки нельзя включить в операцию — сначала заполните позицию",
    };
  }

  const deleted = (rows ?? []).filter((r) => r.deleted_at !== null);
  if (deleted.length > 0) {
    return { ok: false, error: "Позиция удалена из проекта" };
  }

  if (opts.forbid) {
    const forbidden = SERVICE_OPERATION_BLOCKED_STATUSES[opts.forbid] as string[];
    const blocked = (rows ?? []).filter(
      (r) => r.status !== null && forbidden.includes(r.status),
    );
    if (blocked.length > 0) {
      return { ok: false, error: blockedStatusError(opts.forbid, blocked) };
    }
  }

  return { ok: true };
}

/** Компания-подрядчик обязана существовать в организации сессии. */
async function assertContractorInOrg(
  c: OpCtx,
  companyId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!companyId) return { ok: true };
  const { data: company } = await c.supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .eq("org_id", c.orgId)
    .maybeSingle();
  if (!company) return { ok: false, error: "Подрядчик не найден" };
  return { ok: true };
}

function rowToClient(row: OperationRow): Omit<ServiceOperation, "spec_item_ids"> {
  return {
    id: row.id,
    type: toType(row.type),
    amount: Number(row.amount),
    completed: row.completed,
    deadline: row.deadline,
    contractor_company_id: row.contractor_company_id,
    contractor_name: null,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function hydrateContractorNames(
  c: OpCtx,
  ops: Omit<ServiceOperation, "spec_item_ids">[],
): Promise<void> {
  const companyIds = [
    ...new Set(
      ops.map((o) => o.contractor_company_id).filter((v): v is string => !!v),
    ),
  ];
  if (companyIds.length === 0) return;

  const { data } = await c.supabase
    .from("companies")
    .select("id, name")
    .in("id", companyIds)
    .eq("org_id", c.orgId);

  const byId = new Map((data ?? []).map((co) => [co.id, co.name]));
  for (const op of ops) {
    op.contractor_name =
      (op.contractor_company_id && byId.get(op.contractor_company_id)) ?? null;
  }
}

function dbDeadline(v: string | null): string | null {
  return v && v.trim() ? v.trim() : null;
}

function dbNotes(v: string): string | null {
  const t = v.trim();
  return t ? t : null;
}

function insertPayload(c: OpCtx, d: ServiceOperationFields) {
  return {
    org_id: c.orgId,
    project_id: c.projectId,
    type: d.type,
    amount: d.amount,
    completed: d.completed,
    deadline: dbDeadline(d.deadline),
    contractor_company_id: d.contractorCompanyId,
    notes: dbNotes(d.notes),
  };
}

/**
 * «Исполненная» доставка автоматически переводит связанные позиции в
 * spec_status = 'delivered'. Никакие ценовые поля не трогаются.
 * Материалы со статусом «Заменить» пропускаются: их в доставленные не
 * переводим — иначе отметка «Исполнено» «сбивала» бы статус замены.
 */
async function markLinkedItemsDelivered(
  c: OpCtx,
  specItemIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (specItemIds.length === 0) return { ok: true };
  const { error } = await c.supabase
    .from("spec_items")
    .update({
      status: "delivered",
      updated_at: new Date().toISOString(),
    })
    .in("id", specItemIds)
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null)
    .neq("status", "replace");

  if (error) {
    console.error("[service-operations] mark delivered", error.message);
    return {
      ok: false,
      error: "Не удалось отметить материалы «Доставлено»",
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */

/**
 * Создать операцию для выделенных позиций. org_id — из сессии.
 * Позиции проверяются до вставки; при сбое вставки связок созданная
 * операция удаляется (best effort) — операция не остаётся без позиций.
 */
export async function createServiceOperation(
  orgSlug: string,
  projectId: string,
  input: ServiceOperationFields,
): Promise<ActionResult<ServiceOperation>> {
  const parsed = serviceOperationCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Неверные данные");
  }

  const c = await scoped(orgSlug, projectId);
  const guard = await guardProject(c);
  if (guard.error) return fail(guard.error);

  const d = parsed.data;
  const itemsOk = await assertProjectItems(c, d.specItemIds, {
    forbid: d.type,
  });
  if (!itemsOk.ok) return fail(itemsOk.error);

  // Доставка: материал не может входить в две разные доставки. Проверка идёт
  // до вставки операции — при нарушении ничего не создаём.
  if (d.type === "delivery") {
    const deliveryOk = await assertNoOtherDelivery(c, d.specItemIds);
    if (!deliveryOk.ok) return fail(deliveryOk.error);
  }

  const contractorOk = await assertContractorInOrg(c, d.contractorCompanyId);
  if (!contractorOk.ok) return fail(contractorOk.error);

  const { data: created, error } = await c.supabase
    .from("service_operations")
    .insert(insertPayload(c, d))
    .select(OP_COLUMNS)
    .single();

  if (error) {
    console.error("[createServiceOperation]", error.message);
    return fail("Не удалось создать операцию");
  }

  const links = d.specItemIds.map((spec_item_id) => ({
    operation_id: created.id,
    spec_item_id,
  }));
  const { error: linksError } = await c.supabase
    .from("service_operation_items")
    .insert(links);

  if (linksError) {
    console.error("[createServiceOperation] links", linksError.message);
    // best effort: убираем «пустую» операцию, чтобы не нарушать инвариант
    await c.supabase
      .from("service_operations")
      .delete()
      .eq("id", created.id)
      .eq("org_id", c.orgId);
    return fail("Не удалось связать позиции с операцией");
  }

  // Исполненная доставка сразу отмечает связанные материалы «Доставлено».
  if (d.type === "delivery" && d.completed) {
    const marked = await markLinkedItemsDelivered(c, d.specItemIds);
    if (!marked.ok) {
      console.error("[createServiceOperation]", marked.error);
      return fail(marked.error);
    }
  }

  const client = rowToClient(created as OperationRow);
  await hydrateContractorNames(c, [client]);

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok({ ...client, spec_item_ids: d.specItemIds });
}

/**
 * Обновить операцию. Поля меняются целиком; список позиций обязателен —
 * операция не может остаться без связанных позиций.
 */
export async function updateServiceOperation(
  orgSlug: string,
  projectId: string,
  operationId: string,
  input: ServiceOperationFields,
): Promise<ActionResult<ServiceOperation>> {
  const parsed = serviceOperationUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Неверные данные");
  }

  const c = await scoped(orgSlug, projectId);
  const guard = await guardProject(c);
  if (guard.error) return fail(guard.error);

  const { data: existing, error: opErr } = await c.supabase
    .from("service_operations")
    .select(OP_COLUMNS)
    .eq("id", operationId)
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId)
    .maybeSingle();

  if (opErr) {
    console.error("[updateServiceOperation]", opErr.message);
    return fail("Не удалось загрузить операцию");
  }
  if (!existing) return fail("Операция не найдена");

  const d = parsed.data;
  const itemsOk = await assertProjectItems(c, d.specItemIds);
  if (!itemsOk.ok) return fail(itemsOk.error);
  // При обновлении проверка нужна так же, как при создании: Server Action
  // доступен напрямую, а не только через UI с неизменяемым списком позиций.
  // Собственные связи операции исключаем из поиска дубликатов.
  if (d.type === "delivery") {
    const deliveryOk = await assertNoOtherDelivery(c, d.specItemIds, {
      action: "update",
      excludeOperationId: operationId,
    });
    if (!deliveryOk.ok) return fail(deliveryOk.error);
  }
  const contractorOk = await assertContractorInOrg(c, d.contractorCompanyId);
  if (!contractorOk.ok) return fail(contractorOk.error);

  // Исполненная доставка автоматически отмечает связанные материалы
  // «Доставлено». Обратный переход (снять отметку) статусы не откатывает.
  if (d.type === "delivery" && d.completed && !existing.completed) {
    const marked = await markLinkedItemsDelivered(c, d.specItemIds);
    if (!marked.ok) return fail(marked.error);
  }

  const { data: prevLinks } = await c.supabase
    .from("service_operation_items")
    .select("spec_item_id")
    .eq("operation_id", operationId);
  const prevIds = (prevLinks ?? []).map((r) => r.spec_item_id);

  const { data: updated, error: updErr } = await c.supabase
    .from("service_operations")
    .update({
      ...insertPayload(c, d),
      updated_at: new Date().toISOString(),
    })
    .eq("id", operationId)
    .eq("org_id", c.orgId)
    .select(OP_COLUMNS)
    .single();

  if (updErr) {
    console.error("[updateServiceOperation]", updErr.message);
    return fail("Не удалось сохранить операцию");
  }

  // Заменяем связки целиком: удаляем старые и вставляем новые.
  const { error: delErr } = await c.supabase
    .from("service_operation_items")
    .delete()
    .eq("operation_id", operationId);
  if (delErr) {
    console.error("[updateServiceOperation] clear links", delErr.message);
    return fail("Не удалось обновить связанные позиции");
  }

  const links = d.specItemIds.map((spec_item_id) => ({
    operation_id: operationId,
    spec_item_id,
  }));
  const { error: linksError } = await c.supabase
    .from("service_operation_items")
    .insert(links);

  if (linksError) {
    console.error("[updateServiceOperation] links", linksError.message);
    // best effort: возвращаем прежний список связей
    const oldLinks = prevIds.map((spec_item_id) => ({
      operation_id: operationId,
      spec_item_id,
    }));
    await c.supabase.from("service_operation_items").insert(oldLinks);
    return fail("Не удалось связать позиции с операцией");
  }

  const client = rowToClient(updated as OperationRow);
  await hydrateContractorNames(c, [client]);

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok({ ...client, spec_item_ids: d.specItemIds });
}

/** Удалить операцию вместе со связками service_operation_items. */
export async function deleteServiceOperation(
  orgSlug: string,
  projectId: string,
  operationId: string,
): Promise<ActionResult<null>> {
  const parsed = serviceOperationDeleteSchema.safeParse({ operationId });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Неверные данные");
  }

  const c = await scoped(orgSlug, projectId);
  const guard = await guardProject(c);
  if (guard.error) return fail(guard.error);

  // Операция обязана принадлежать этому проекту организации сессии.
  const { data: existing, error: findErr } = await c.supabase
    .from("service_operations")
    .select("id")
    .eq("id", operationId)
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId)
    .maybeSingle();

  if (findErr) {
    console.error("[deleteServiceOperation] find", findErr.message);
    return fail("Не удалось проверить операцию");
  }
  if (!existing) return fail("Операция не найдена");

  // Сначала связки — чтобы удаление работало и на БД без каскада.
  // (Если каскад включён, этот delete просто не найдёт строк.)
  const { error: linksErr } = await c.supabase
    .from("service_operation_items")
    .delete()
    .eq("operation_id", operationId);

  if (linksErr) {
    console.error("[deleteServiceOperation] links", linksErr.message);
    return fail("Не удалось удалить связанные позиции");
  }

  const { error } = await c.supabase
    .from("service_operations")
    .delete()
    .eq("id", operationId)
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId);

  if (error) {
    console.error("[deleteServiceOperation]", error.message);
    return fail("Не удалось удалить операцию");
  }

  revalidatePath(`/${orgSlug}/projects/${projectId}`);
  return ok(null);
}

/** Все операции проекта (для строк, карточек и сводки). */
export async function listProjectServiceOperations(
  orgSlug: string,
  projectId: string,
): Promise<ActionResult<ServiceOperation[]>> {
  const c = await scoped(orgSlug, projectId);
  const { data: project } = await c.supabase
    .from("projects")
    .select("id")
    .eq("id", c.projectId)
    .eq("org_id", c.orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!project) return fail("Проект не найден");

  const { data: rows, error } = await c.supabase
    .from("service_operations")
    .select(OP_COLUMNS)
    .eq("project_id", c.projectId)
    .eq("org_id", c.orgId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listProjectServiceOperations]", error.message);
    return fail("Не удалось загрузить операции");
  }

  const ops = (rows ?? []).map((row) => rowToClient(row as OperationRow));
  if (ops.length === 0) return ok([]);

  const opIds = ops.map((o) => o.id);
  const { data: linkRows, error: linkErr } = await c.supabase
    .from("service_operation_items")
    .select("operation_id, spec_item_id")
    .in("operation_id", opIds)
    .order("spec_item_id", { ascending: true });

  if (linkErr) {
    console.error("[listProjectServiceOperations] links", linkErr.message);
    return fail("Не удалось загрузить операции");
  }

  const idsByOp = new Map<string, string[]>();
  for (const l of linkRows ?? []) {
    const list = idsByOp.get(l.operation_id) ?? [];
    list.push(l.spec_item_id);
    idsByOp.set(l.operation_id, list);
  }

  await hydrateContractorNames(c, ops);

  return ok(
    ops.map((op) => ({
      ...op,
      spec_item_ids: idsByOp.get(op.id) ?? [],
    })),
  );
}
