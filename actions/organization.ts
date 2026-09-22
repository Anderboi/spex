"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrgBySlug } from "@/lib/auth/session";
import { can, canTransferOwnership, isOrgRole } from "@/lib/permissions";
import { renameOrganizationSchema } from "@/lib/validations";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { callRpc } from "@/lib/supabase/rpc";

/**
 * Организация НЕ удаляется одним каскадом: часть FK объявлена без
 * ON DELETE CASCADE, и удаление `organizations(id)` напрямую упало бы на
 * нарушении внешнего ключа. Проверено по фактической схеме:
 *
 *   public_links.org_id                   → NO ACTION
 *   service_operations.org_id             → NO ACTION
 *   spec_item_components.org_id           → NO ACTION
 *   spec_item_components.ref_spec_item_id → ON DELETE RESTRICT
 *
 * Поэтому сначала явно удаляем то, что не уедет само. Состав позиций
 * (`spec_item_components`) удаляем ДО позиций: на `spec_items` висит RESTRICT,
 * а `spec_item_components.spec_item_id` каскадится, так что удаление состава
 * первым безопасно. `spec_items` — самоссылочная таблица (parent_id),
 * поэтому её удаляем волнами: сначала листья, затем следующая волна.
 *
 * Остальные дочерние таблицы (projects, materials, companies, contacts,
 * organization_members, organization_invites, spec_item_variants,
 * service_operation_items) связаны с organizations(id) через ON DELETE CASCADE
 * и уезжают вместе с организацией.
 */
const DELETED_BEFORE_SPEC_ITEMS = [
  "public_links",
  "service_operations",
  "spec_item_components",
] as const;

/** Предел проходов при удалении дерева позиций спецификации. */
const MAX_TREE_DELETE_PASSES = 200;

/**
 * Удаляет спецификации организации с учётом self-FK:
 * сначала позиции, на которые никто не ссылается, затем следующая волна.
 */
async function deleteOrgSpecItems(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<boolean> {
  for (let pass = 0; pass < MAX_TREE_DELETE_PASSES; pass++) {
    const { data: rows, error: readError } = await supabase
      .from("spec_items")
      .select("id, parent_id")
      .eq("org_id", orgId);

    if (readError) {
      console.error("[deleteOrganization] spec_items select", readError.message);
      return false;
    }
    if (!rows || rows.length === 0) return true;

    const referenced = new Set(
      rows.map((r) => r.parent_id).filter((id): id is string => Boolean(id)),
    );
    const leaves = rows.map((r) => r.id).filter((id) => !referenced.has(id));

    if (leaves.length === 0) {
      console.error(
        "[deleteOrganization] цикл в дереве spec_items, удаление прервано",
        { orgId, count: rows.length },
      );
      return false;
    }

    const { error: deleteError } = await supabase
      .from("spec_items")
      .delete()
      .eq("org_id", orgId)
      .in("id", leaves);

    if (deleteError) {
      console.error(
        "[deleteOrganization] spec_items delete",
        deleteError.message,
      );
      return false;
    }
  }

  console.error("[deleteOrganization] превышен предел проходов по spec_items");
  return false;
}


/** Bucket'ы, в которых объекты лежат по пути `<org_id>/...`. */
const ORG_STORAGE_BUCKETS = [
  "material-images",
  "project-images",
  "company-images",
] as const;

function rpcMessage(message: string, fallback: string): string {
  if (message.includes("FORBIDDEN")) return "Это действие доступно только владельцу организации";
  if (message.includes("NOT_A_MEMBER")) return "Вы не состоите в этой организации";
  if (message.includes("ORG_NOT_FOUND")) return "Организация не найдена";
  if (message.includes("EMPTY_NAME")) return "Название не может быть пустым";
  if (message.includes("NAME_TOO_LONG")) return "Слишком длинное название";
  if (message.includes("UNAUTHENTICATED")) return "Требуется вход в систему";
  if (message.includes("ACTOR_MISMATCH")) return "Некорректный вызов операции";
  if (message.includes("TARGET_REQUIRED")) return "Выберите участника";
  if (message.includes("TARGET_NOT_FOUND")) return "Участник не найден в организации";
  if (message.includes("TARGET_AMBIGUOUS")) return "Не удалось однозначно определить участника";
  if (message.includes("ALREADY_OWNER")) return "Этот участник уже владелец";
  return fallback;
}

/**
 * Переименование организации.
 *
 * Право `organization:update` есть только у owner. Проверяем его дважды:
 * здесь (быстрый отказ и понятный текст) и в БД — функцией
 * `update_organization_name`, которая заново читает роль актора.
 *
 * `orgSlug` из клиента — это только адрес страницы, не доказательство права:
 * организация берётся из сессии (`requireOrgBySlug`), роль — из БД.
 */
export async function updateOrganization(
  orgSlug: string,
  input: { name: string },
): Promise<ActionResult<{ name: string }>> {
  const parsed = renameOrganizationSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { userId, orgId, role } = await requireOrgBySlug(orgSlug);

  if (!can(role, "organization:update")) {
    return fail("Менять название организации может только владелец", "FORBIDDEN");
  }

  const supabase = createAdminClient();
  const { data, error } = await callRpc(supabase, "update_organization_name", {
    p_org_id: orgId,
    p_actor_id: userId,
    p_name: parsed.data.name,
  });

  if (error) {
    console.error("[updateOrganization]", error.message);
    return fail(rpcMessage(error.message, "Не удалось сохранить название"));
  }

  // Название показывают сайдбар (в layout) и заголовки страниц.
  revalidatePath("/", "layout");
  revalidatePath(`/${orgSlug}/settings/team`);

  return ok({ name: typeof data === "string" ? data : parsed.data.name });
}

/**
 * Передача владения организацией.
 *
 * Атомарность обеспечивает БД: `transfer_organization_ownership` блокирует
 * состав организации (`for update`) и меняет обе роли в одной транзакции.
 * Двумя отдельными UPDATE из приложения это делать нельзя — между ними
 * возможны состояния «0 владельцев» и «2 владельца».
 */
export async function transferOwnership(
  orgSlug: string,
  targetUserId: string,
): Promise<ActionResult<null>> {
  const { userId, orgId, role } = await requireOrgBySlug(orgSlug);

  if (!targetUserId) return fail("Участник не указан", "INVALID_INPUT");
  if (targetUserId === userId) {
    return fail("Нельзя передать владение самому себе", "FORBIDDEN");
  }
  if (!can(role, "organization:transfer")) {
    return fail("Передать владение может только владелец", "FORBIDDEN");
  }

  const supabase = createAdminClient();

  // Роль цели и её имя читаем из БД: клиент мог прислать что угодно.
  const { data: target } = await supabase
    .from("organization_members")
    .select("user_id, role, users:user_id ( name, email )")
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (!target) return fail("Участник не найден в организации", "NOT_FOUND");

  const targetProfile = Array.isArray(target.users)
    ? target.users[0]
    : target.users;
  const targetName = targetProfile?.name ?? targetProfile?.email ?? null;

  if (!isOrgRole(target.role)) {
    console.error("[transferOwnership] неизвестная роль участника", target.role);
    return fail("Некорректная роль участника", "INVALID_INPUT");
  }
  if (!canTransferOwnership(role, target.role, false)) {
    return fail("Этому участнику нельзя передать владение", "FORBIDDEN");
  }
  if (!targetName) {
    // Без имени RPC не сможет подтвердить получателя — это защита от подмены
    // target_user_id на стороне клиента.
    return fail("У участника не заполнено имя — передача невозможна");
  }

  const { error } = await callRpc(supabase, "transfer_organization_ownership", {
    p_org_id: orgId,
    p_actor_id: userId,
    p_target_name: targetName,
  });

  if (error) {
    console.error("[transferOwnership]", error.message);
    return fail(rpcMessage(error.message, "Не удалось передать владение"));
  }

  // Роль изменилась у обоих участников: обновляем layout (сайдбар) и команду.
  revalidatePath("/", "layout");
  revalidatePath(`/${orgSlug}/settings/team`);

  return ok(null);
}

/** Удаление объектов Storage организации. Best-effort: строки в БД важнее файлов. */
async function removeOrganizationStorage(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<void> {
  for (const bucket of ORG_STORAGE_BUCKETS) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(orgId, { limit: 1000 });

    if (error) {
      console.error("[deleteOrganization] storage list", bucket, error.message);
      continue;
    }

    const paths = (data ?? [])
      .filter((entry) => entry.id !== null) // папки пропускаем
      .map((entry) => `${orgId}/${entry.name}`);

    if (paths.length === 0) continue;

    const { error: removeError } = await supabase.storage
      .from(bucket)
      .remove(paths);

    if (removeError) {
      console.error(
        "[deleteOrganization] storage remove",
        bucket,
        removeError.message,
      );
    }
  }
}

/**
 * Удаляет все данные организации и саму организацию.
 *
 * Вынесено отдельно от `deleteOrganization`, чтобы порядок удаления можно было
 * проверить на реальной схеме (в том числе вручную/скриптом), не поднимая сессию.
 *
 * Порядок обязателен из-за блокирующих FK:
 *   1. `public_links`, `service_operations`, `spec_item_components` — их связи с
 *      projects(id)/organizations(id) объявлены без ON DELETE CASCADE;
 *   2. `spec_items` — волнами по дереву (parent_id);
 *   3. `organizations` — остальное уезжает каскадом, users.active_org_id → NULL.
 */
export async function deleteOrganizationData(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const table of DELETED_BEFORE_SPEC_ITEMS) {
    const { error } = await supabase.from(table).delete().eq("org_id", orgId);
    if (error) {
      console.error("[deleteOrganization]", table, error.message);
      return {
        ok: false,
        error: `Не удалось удалить данные организации (${table})`,
      };
    }
  }

  if (!(await deleteOrgSpecItems(supabase, orgId))) {
    return { ok: false, error: "Не удалось удалить позиции спецификаций" };
  }

  const { error } = await supabase.from("organizations").delete().eq("id", orgId);
  if (error) {
    console.error("[deleteOrganization] organizations", error.message);
    return { ok: false, error: "Не удалось удалить организацию" };
  }

  return { ok: true };
}

/**
 * Удаление организации вместе со связанными данными.
 *
 * Проверки только на сервере и только по данным из БД:
 *   1. сессия (requireOrgBySlug → иначе 404/логин);
 *   2. организация принадлежит пользователю (slug ищется среди его организаций);
 *   3. роль в БД = owner — повторно читается прямо здесь, а не берётся из аргумента;
 *   4. введённое название совпадает с текущим названием в БД.
 */
export async function deleteOrganization(
  orgSlug: string,
  input: { confirmation: string },
): Promise<ActionResult<null>> {
  const { userId, orgId, role } = await requireOrgBySlug(orgSlug);

  const supabase = createAdminClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();

  if (!org) return fail("Организация не найдена", "NOT_FOUND");

  // Роль читаем из БД ещё раз: между проверкой сессии и удалением её могли
  // изменить (например, владение только что передали).
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membership?.role !== "owner") {
    return fail("Удалить организацию может только владелец", "FORBIDDEN");
  }
  if (role !== "owner") {
    // сессия устарела — всё равно отказываем, но фиксируем в логе
    console.warn("[deleteOrganization] роль в сессии устарела", { orgSlug, role });
  }

  const confirmation = (input?.confirmation ?? "").trim();
  if (!confirmation) return fail("Введите название организации", "INVALID_INPUT");
  if (confirmation !== org.name.trim()) {
    return fail("Название не совпадает — удаление отменено");
  }

  // Файлы удаляем до строк: URL перестанут открываться вместе с организацией.
  await removeOrganizationStorage(supabase, orgId);

  const deleted = await deleteOrganizationData(supabase, orgId);
  if (!deleted.ok) return fail(deleted.error);

  revalidatePath("/", "layout");

  // redirect() бросает NEXT_REDIRECT — намеренно вне try/catch.
  redirect("/onboarding/create-org");
}
