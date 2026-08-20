"use server";

import { revalidatePath } from "next/cache";
import {
  companySchema,
  contactSchema,
  CompanyInput,
  ContactInput,
} from "@/lib/validations";
import { assertCanMutate, forbidden, scoped } from "@/lib/db/guard";
import { can } from "@/lib/permissions";

// --- КОМПАНИИ ---

export async function upsertCompany(orgSlug: string, input: CompanyInput) {
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  const { id, ...fields } = parsed.data as CompanyInput & { id?: string };

  // ── обновление
  if (id) {
    const guard = await assertCanMutate(orgSlug, "companies", id);
    if (!guard.ok) return guard.response;

    const { data, error } = await guard.ctx.supabase
      .from("companies")
      .update(fields)
      .eq("id", id)
      .eq("org_id", guard.ctx.orgId) // ← защита даже здесь
      .select()
      .single();

    if (error) {
      console.error("[upsertCompany:update]", error.message);
      return {
        success: false as const,
        error: "Не удалось сохранить компанию",
      };
    }
    revalidatePath(`/${orgSlug}/contacts`);
    return { success: true as const, data };
  }

  // ── создание
  const ctx = await scoped(orgSlug);
  if (!can(ctx.role, "record:create")) return forbidden();

  const { data, error } = await ctx.supabase
    .from("companies")
    .insert({ ...fields, org_id: ctx.orgId, created_by: ctx.userId })
    .select()
    .single();

  if (error) {
    console.error("[upsertCompany:insert]", error.message);
    return { success: false as const, error: "Не удалось создать компанию" };
  }

  revalidatePath(`/${orgSlug}/contacts`);
  return { success: true as const, data };
}

export async function deleteCompany(orgSlug: string, id: string) {
  const guard = await assertCanMutate(orgSlug, "companies", id);
  if (!guard.ok) return guard.response;

  // FK: contacts.company_id → SET NULL, materials.company_id → SET NULL
  // контакты станут независимыми, материалы останутся без поставщика
  const { error } = await guard.ctx.supabase
    .from("companies")
    .delete()
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    console.error("[deleteCompany]", error.message);
    return { success: false as const, error: "Не удалось удалить компанию" };
  }

  revalidatePath(`/${orgSlug}/contacts`);
  revalidatePath(`/${orgSlug}/materials`); // ← у материалов пропал поставщик
  return { success: true as const };
}

// --- КОНТАКТЫ / МЕНЕДЖЕРЫ ---

export async function upsertContact(
  orgSlug: string,
  input: ContactInput & { company_id?: string | null },
) {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    console.error("[upsertContact] validation:", parsed.error.format());
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  const { id, ...fields } = parsed.data as ContactInput & { id?: string };
  const companyId = input.company_id ?? null;

  if (id) {
    const guard = await assertCanMutate(orgSlug, "contacts", id);
    if (!guard.ok) return guard.response;

    // компания обязана быть из той же организации
    if (companyId) {
      const { data: co } = await guard.ctx.supabase
        .from("companies")
        .select("id")
        .eq("id", companyId)
        .eq("org_id", guard.ctx.orgId)
        .maybeSingle();
      if (!co) return { success: false as const, error: "Компания не найдена" };
    }

    const { data, error } = await guard.ctx.supabase
      .from("contacts")
      .update({ ...fields, company_id: companyId })
      .eq("id", id)
      .eq("org_id", guard.ctx.orgId)
      .select()
      .single();

    if (error) {
      console.error("[upsertContact:update]", error.message);
      return { success: false as const, error: "Не удалось сохранить контакт" };
    }
    revalidatePath(`/${orgSlug}/contacts`);
    return { success: true as const, data };
  }

  const ctx = await scoped(orgSlug);
  if (!can(ctx.role, "record:create")) return forbidden();

  if (companyId) {
    const { data: co } = await ctx.supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    if (!co) return { success: false as const, error: "Компания не найдена" };
  }

  const { data, error } = await ctx.supabase
    .from("contacts")
    .insert({
      ...fields,
      company_id: companyId,
      org_id: ctx.orgId,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (error) {
    console.error("[upsertContact:insert]", error.message);
    return { success: false as const, error: "Не удалось создать контакт" };
  }

  revalidatePath(`/${orgSlug}/contacts`);
  return { success: true as const, data };
}

export async function deleteContact(orgSlug: string, id: string) {
  const guard = await assertCanMutate(orgSlug, "contacts", id);
  if (!guard.ok) return guard.response;

  const { error } = await guard.ctx.supabase
    .from("contacts")
    .delete()
    .eq("id", id)
    .eq("org_id", guard.ctx.orgId);

  if (error) {
    console.error("[deleteContact]", error.message);
    return { success: false as const, error: "Не удалось удалить контакт" };
  }

  revalidatePath(`/${orgSlug}/contacts`);
  revalidatePath(`/${orgSlug}/materials`);
  return { success: true as const };
}
