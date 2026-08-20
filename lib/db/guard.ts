import "server-only";
import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canMutateRecord, can, type Permission } from "@/lib/permissions";

type OwnedTable = "projects" | "materials" | "companies" | "contacts";

/** Контекст + клиент. orgId ВСЕГДА из сессии, никогда из аргументов. */
export async function scoped(orgSlug: string) {
   const ctx = await requireOrgBySlug(orgSlug);
  return { ...ctx, supabase: createAdminClient() };
}

export function forbidden(msg = "Недостаточно прав") {
  return { success: false as const, error: msg };
}
export function notFound(msg = "Запись не найдена") {
  return { success: false as const, error: msg };
}

/**
 * Проверяет, что запись принадлежит организации из сессии,
 * и что у пользователя есть право её изменить.
 */
export async function assertCanMutate(orgSlug: string, table: OwnedTable, id: string) {
  const ctx = await scoped(orgSlug);

  const { data: row } = await ctx.supabase
    .from(table)
    .select("id, created_by")
    .eq("id", id)
    .eq("org_id", ctx.orgId) // ← ключевая строка
    .maybeSingle();

  // чужая организация → «не найдено», а не «нет прав»:
  // посторонний не должен узнать, что запись существует
  if (!row) return { ok: false as const, response: notFound(), ctx };

  if (
    !canMutateRecord({
      role: ctx.role,
      userId: ctx.userId,
      createdBy: row.created_by,
    })
  ) {
    return {
      ok: false as const,
      response: forbidden("Изменять чужие записи может только администратор"),
      ctx,
    };
  }

  return { ok: true as const, ctx, row };
}

export async function assertCan(orgSlug: string, p: Permission) {
  const ctx = await scoped(orgSlug);
  if (!can(ctx.role, p))
    return { ok: false as const, response: forbidden(), ctx };
  return { ok: true as const, ctx };
}
