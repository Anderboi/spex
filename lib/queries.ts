import { createAdminClient } from "./supabase/admin";
import {
  CompanyInput,
  CompanyRow,
  ContactInput,
  ContactRow,
  type ProjectStatus,
} from "./validations";
import { cache } from "react";
import { OrgRole, requireOrgBySlug } from "./auth/session";
import { rowToItem } from "./spec/mappers";
import {
  ContactsFilters,
  MaterialsFilters,
  ProjectType,
  ProjectsFilters,
  SpecItem,
} from "./types";
import { one } from "./utils";
import { MATERIALS_PAGE_SIZE } from "./materials/filters";
import { CONTACTS_PAGE_SIZE } from "./contacts/filters";
import { PROJECTS_PAGE_SIZE } from "./projects/filters";
import { applyActiveVariant, rowToVariant } from './spec/variants';

export type SpecPickerCompany = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  note?: string | null;
};
export type SpecPickerContact = {
  id: string;
  name: string;
  company_id: string | null;
  phone?: string | null;
  email?: string | null;
};

export const getSpecPickerData = cache(async (orgSlug: string) => {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const [companiesRes, contactsRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, phone, email, website, address, note")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("contacts")
      .select("id, name, company_id, phone, email")
      .eq("org_id", orgId)
      .order("name"),
  ]);

  if (companiesRes.error)
    console.error("[getSpecPickerData] companies", companiesRes.error.message);
  if (contactsRes.error)
    console.error("[getSpecPickerData] contacts", contactsRes.error.message);

  return {
    companies: (companiesRes.data ?? []) as SpecPickerCompany[],
    contacts: (contactsRes.data ?? []) as SpecPickerContact[],
  };
});

const MATERIAL_LIST_SELECT = `
  id,
  name,
  category,
  brand,
  article,
  price,
  unit,
  image_url,
  created_at,
  companies:company_id (id, name),
  contacts:contact_id (id, name),
  product_url,
  product_type
`;

export type MaterialListItem = {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  article: string | null;
  price: number | null;
  unit: string | null;
  imageUrl: string | null;
  companyId: string | null;
  companyName: string;
  contactName: string;
  createdAt: string;
  contactId: string | null;
  product_url: string | null;
  product_type: string | null;
};

function toMaterialListItem(r: any): MaterialListItem {
  const company = one<{ id: string; name: string }>(r.companies);
  const contact = one<{ id: string; name: string }>(r.contacts);
  return {
    id: r.id,
    name: r.name,
    category: r.category ?? null,
    brand: r.brand ?? null,
    article: r.article ?? null,
    price: r.price === null ? null : Number(r.price),
    unit: r.unit ?? null,
    imageUrl: r.image_url ?? null,
    companyId: company?.id ?? null,
    companyName: company?.name ?? "",
    contactName: contact?.name ?? "",
    createdAt: r.created_at,
    contactId: contact?.id ?? null,
    product_url: r.product_url ?? null,
    product_type: r.product_type ?? null,
  };
}

export async function getMaterials(
  orgSlug: string,
  options?: { search?: string; category?: string },
) {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  let query = supabase
    .from("materials")
    .select(MATERIAL_LIST_SELECT)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (options?.search?.trim()) {
    // убираем всё, что имеет значение в грамматике PostgREST
    const s = options.search
      .trim()
      .replace(/[,.()"\\%]/g, " ")
      .slice(0, 100)
      .trim();
    if (s) {
      query = query.or(
        `name.ilike."%${s}%",brand.ilike."%${s}%",article.ilike."%${s}%"`,
      );
    }
  }

  const cleanCategory = options?.category?.trim();
  if (cleanCategory && cleanCategory !== "all") {
    query = query.eq("category", cleanCategory);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching materials:", error.message);
    throw new Error(`Failed to fetch materials: ${error.message}`);
  }

  return (data ?? []).map(toMaterialListItem);
}

function sanitizeSearch(search?: string): string {
  return (search ?? "")
    .trim()
    .replace(/[,.()"\\%]/g, " ")
    .slice(0, 100)
    .trim();
}

export async function getMaterialsPage(
  orgSlug: string,
  filters: MaterialsFilters,
): Promise<{ items: MaterialListItem[]; pageCount: number }> {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  let query = supabase
    .from("materials")
    .select(MATERIAL_LIST_SELECT, { count: "exact" })
    .eq("org_id", orgId);

  if (filters.status === "archived") {
    query = query.not("deleted_at", "is", null);
  } else {
    query = query.is("deleted_at", null);
  }

  const s = sanitizeSearch(filters.query);
  if (s) {
    query = query.or(
      `name.ilike."%${s}%",brand.ilike."%${s}%",article.ilike."%${s}%"`,
    );
  }

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.manufacturer) query = query.eq("brand", filters.manufacturer);

  if (filters.sort === "name_asc") {
    query = query.order("name", { ascending: true });
  } else if (filters.sort === "name_desc") {
    query = query.order("name", { ascending: false });
  } else if (filters.sort === "created_asc") {
    query = query.order("created_at", { ascending: true });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const from = (filters.page - 1) * MATERIALS_PAGE_SIZE;
  const to = from + MATERIALS_PAGE_SIZE - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error("[getMaterialsPage]", error.message);
    throw new Error(`Failed to fetch materials: ${error.message}`);
  }

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / MATERIALS_PAGE_SIZE));
  return { items: (data ?? []).map(toMaterialListItem), pageCount };
}

export async function getMaterialBrands(orgSlug: string): Promise<string[]> {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("materials")
    .select("brand")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .not("brand", "is", null)
    .order("brand", { ascending: true });

  if (error) {
    console.error("[getMaterialBrands]", error.message);
    return [];
  }

  const brands = new Set<string>();
  for (const row of data ?? []) {
    const brand = row.brand?.trim();
    if (brand) brands.add(brand);
  }
  return [...brands];
}

export async function getMaterialById(orgSlug: string, id: string) {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("materials")
    .select(MATERIAL_LIST_SELECT)
    .eq("org_id", orgId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error(`Error fetching material ${id}:`, error.message);
    throw new Error(`Failed to fetch material: ${error.message}`);
  }

  return data ? toMaterialListItem(data) : null;
}

/**
 * ==========================================
 * PROJECTS QUERIES
 * ==========================================
 */
const PROJECT_LIST_SELECT =
  "id, title, client_name, accent_color, status, cover_url, updated_at, created_at, org_id, budget, address, type, rooms";

export type ProjectListItem = {
  id: string;
  title: string;
  client_name: string | null;
  accent_color: string | null;
  status: ProjectStatus;
  cover_url: string | null;
  updated_at: string;
  created_at: string;
  budget: number;
  address: string | null;
  type: ProjectType;
  rooms: string[];
};

type ProjectRow = {
  id: string;
  title: string;
  client_name: string | null;
  accent_color: string | null;
  status: string;
  cover_url: string | null;
  updated_at: string;
  created_at: string;
  org_id: string;
  budget: number | null;
  address: string | null;
  type: string | null;
  rooms: string[] | null;
};

function toProjectListItem(r: ProjectRow): ProjectListItem {
  return {
    id: r.id,
    title: r.title,
    client_name: r.client_name,
    accent_color: r.accent_color,
    status: r.status as ProjectStatus,
    cover_url: r.cover_url,
    updated_at: r.updated_at,
    created_at: r.created_at,
    budget: r.budget ?? 0,
    address: r.address,
    type: (r.type ?? "Интерьер") as ProjectType,
    rooms: r.rooms ?? [],
  };
}

export const getProjects = cache(
  async (
    orgSlug: string,
    filters: ProjectsFilters,
  ): Promise<{ items: ProjectListItem[]; pageCount: number }> => {
    const { orgId } = await requireOrgBySlug(orgSlug);
    const supabase = createAdminClient();

    let query = supabase
      .from("projects")
      .select(PROJECT_LIST_SELECT, { count: "exact" })
      .eq("org_id", orgId)
      .is("deleted_at", null);

    const s = sanitizeSearch(filters.query);
    if (s) {
      query = query.or(
        `title.ilike."%${s}%",client_name.ilike."%${s}%",address.ilike."%${s}%"`,
      );
    }
    if (filters.status) query = query.eq("status", filters.status);

    if (filters.sort === "name") {
      query = query.order("title", { ascending: true });
    } else if (filters.sort === "budget") {
      query = query.order("budget", { ascending: false, nullsFirst: false });
    } else {
      query = query.order("updated_at", { ascending: false });
    }

    const from = (filters.page - 1) * PROJECTS_PAGE_SIZE;
    const to = from + PROJECTS_PAGE_SIZE - 1;
    const { data, error, count } = await query.range(from, to);

    if (error) {
      console.error("[getProjects]", error.message);
      throw new Error("Не удалось загрузить проекты");
    }

    const total = count ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / PROJECTS_PAGE_SIZE));
    return { items: (data ?? []).map(toProjectListItem), pageCount };
  },
);

export async function getProjectById(orgSlug: string, projectId: string) {
  const { orgId } = await requireOrgBySlug(orgSlug);

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_LIST_SELECT)
    .eq("org_id", orgId)
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error(`Error fetching project ${projectId}:`, error.message);
    return null;
  }

  return data;
}

export const getProjectsStats = cache(async (orgSlug: string) => {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("projects")
    .select("budget, status")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  if (error) {
    console.error("[getProjectsStats]", error.message);
    return { total: 0, active: 0, budget: 0 };
  }
  return {
    total: data.length,
    active: data.filter((p) => p.status === "active").length,
    budget: data.reduce((s, p) => s + (p.budget ?? 0), 0),
  };
});

export async function getProjectSpecItems(
  orgSlug: string,
  projectId: string,
): Promise<SpecItem[]> {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("org_id", orgId)
    .is("deleted_at", null) // удалённый проект тоже не отдаём
    .maybeSingle();
  if (!project) return []; // чужой проект — пусто, без намёков

  const { data, error } = await supabase
    .from("spec_items")
    .select(
      `*,
       contact:contact_id ( id, name, phone, email ),
       material:material_id ( id, name, image_url )`,
    )
    .eq("project_id", projectId)
    .eq("org_id", orgId) // вторая линия: org_id есть в таблице, используем
    .is("deleted_at", null) // ← без этого удалённые вернутся после перезагрузки
    .order("position", { ascending: true })
    .order("code", { ascending: true }); // стабильный порядок при равных position

  if (error) {
    console.error("[getProjectSpecItems]", error.message);
    throw new Error("Не удалось загрузить спецификацию");
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // ── варианты: один запрос на все позиции проекта ──────────────
  const itemIds = rows.map((r) => r.id);
  const { data: variantRows, error: vErr } = await supabase
    .from("spec_item_variants")
    .select("*")
    .in("spec_item_id", itemIds)
    .order("position", { ascending: true });

  if (vErr) {
    console.error("[getProjectSpecItems] variants", vErr.message);
    // не роняем спецификацию из-за вариантов — отдаём позиции без них
  }

  // группируем варианты по spec_item_id
  const byItem = new Map<string, ReturnType<typeof rowToVariant>[]>();
  for (const vr of variantRows ?? []) {
    const list = byItem.get(vr.spec_item_id) ?? [];
    list.push(rowToVariant(vr));
    byItem.set(vr.spec_item_id, list);
  }

  // собираем позицию → прикрепляем варианты → накладываем активный
  return rows.map((r) => {
    const item = rowToItem(r);
    const variants = byItem.get(r.id) ?? [];
    return applyActiveVariant({ ...item, variants, activeVariantId: null });
  });
}

export type CompanyListItem = {
  id: string;
  name: string;
  category: string[];
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  note: string | null;
};

export type ContactListItem = {
  id: string;
  name: string;
  title: string | null;
  category: string[];
  phone: string | null;
  email: string | null;
  note: string | null;
  company_id: string | null;
  company_name: string | null;
};

export async function getCompanies(orgSlug: string): Promise<CompanyRow[]> {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("companies")
    .select("id, name, category, phone, email, website,address, note")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Error fetching companies:`, error.message);
    throw new Error(`Failed to fetch companies: ${error.message}`);
  }

  return (data as CompanyRow[]) ?? [];
}

export async function getContacts(orgSlug: string): Promise<ContactRow[]> {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Error fetching contacts:`, error.message);
    throw new Error(`Failed to fetch contacts: ${error.message}`);
  }

  return (data as ContactRow[]) ?? [];
}

export type CounterpartyData = {
  companies: CompanyInput[];
  contacts: ContactInput[];
};

export const getCounterparties = cache(async (orgSlug: string) => {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const [companiesRes, contactsRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, category, phone, email, website, address, note")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("contacts")
      .select(
        "id, name, title, category, phone, email, note, company_id, companies(name)",
      )
      .eq("org_id", orgId)
      .order("name"),
  ]);

  if (companiesRes.error)
    console.error("[getCounterparties] companies", companiesRes.error.message);
  if (contactsRes.error)
    console.error("[getCounterparties] contacts", contactsRes.error.message);

  const companies: CompanyListItem[] = (companiesRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category ?? [],
    phone: r.phone ?? null,
    email: r.email ?? null,
    website: r.website ?? null,
    address: r.address ?? null,
    note: r.note ?? null,
  }));

  const contacts: ContactListItem[] = (contactsRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    title: r.title ?? null,
    category: r.category ?? [],
    phone: r.phone ?? null,
    email: r.email ?? null,
    note: r.note ?? null,
    company_id: r.company_id,
    company_name: one<{ name: string }>(r.companies)?.name ?? null,
  }));

  return { companies, contacts };
});

export type ContactsDirectory = {
  companies: CompanyRow[];
  independentContacts: ContactRow[];
  managers: ContactRow[];
  companiesCount: number;
  independentCount: number;
  pageCount: number;
};

export async function getContactsDirectory(
  orgSlug: string,
  filters: ContactsFilters,
): Promise<ContactsDirectory> {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const search = sanitizeSearch(filters.query);
  const from = (filters.page - 1) * CONTACTS_PAGE_SIZE;
  const to = from + CONTACTS_PAGE_SIZE - 1;

  let companiesQuery = supabase
    .from("companies")
    .select("*", { count: "exact" })
    .eq("org_id", orgId);

  if (search) {
    companiesQuery = companiesQuery.or(
      `name.ilike."%${search}%",address.ilike."%${search}%",note.ilike."%${search}%",phone.ilike."%${search}%",email.ilike."%${search}%",website.ilike."%${search}%"`,
    );
  }
  if (filters.category) {
    companiesQuery = companiesQuery.contains("category", [filters.category]);
  }
  if (filters.sort === "name_asc") {
    companiesQuery = companiesQuery.order("name", { ascending: true });
  } else if (filters.sort === "name_desc") {
    companiesQuery = companiesQuery.order("name", { ascending: false });
  } else if (filters.sort === "created_asc") {
    companiesQuery = companiesQuery.order("created_at", { ascending: true });
  } else {
    companiesQuery = companiesQuery.order("created_at", { ascending: false });
  }

  let independentQuery = supabase
    .from("contacts")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .is("company_id", null);

  if (search) {
    independentQuery = independentQuery.or(
      `name.ilike."%${search}%",title.ilike."%${search}%",note.ilike."%${search}%",phone.ilike."%${search}%",email.ilike."%${search}%"`,
    );
  }
  if (filters.category) {
    independentQuery = independentQuery.contains("category", [
      filters.category,
    ]);
  }
  if (filters.sort === "name_asc") {
    independentQuery = independentQuery.order("name", { ascending: true });
  } else if (filters.sort === "name_desc") {
    independentQuery = independentQuery.order("name", { ascending: false });
  } else if (filters.sort === "created_asc") {
    independentQuery = independentQuery.order("created_at", {
      ascending: true,
    });
  } else {
    independentQuery = independentQuery.order("created_at", {
      ascending: false,
    });
  }

  // Пагинация только для активной вкладки; для неактивной нужен лишь счётчик.
  if (filters.tab === "companies") {
    companiesQuery = companiesQuery.range(from, to);
  } else {
    companiesQuery = companiesQuery.range(0, 0);
  }
  if (filters.tab === "independent") {
    independentQuery = independentQuery.range(from, to);
  } else {
    independentQuery = independentQuery.range(0, 0);
  }

  const [companiesRes, independentRes] = await Promise.all([
    companiesQuery,
    independentQuery,
  ]);

  if (companiesRes.error) {
    console.error("[getContactsDirectory] companies", companiesRes.error.message);
    throw new Error("Не удалось загрузить компании");
  }
  if (independentRes.error) {
    console.error("[getContactsDirectory] contacts", independentRes.error.message);
    throw new Error("Не удалось загрузить контакты");
  }

  const companies = (
    filters.tab === "companies" ? (companiesRes.data ?? []) : []
  ) as CompanyRow[];
  const independentContacts = (
    filters.tab === "independent" ? (independentRes.data ?? []) : []
  ) as ContactRow[];
  const companiesCount = companiesRes.count ?? 0;
  const independentCount = independentRes.count ?? 0;

  const totalForTab =
    filters.tab === "companies" ? companiesCount : independentCount;
  const pageCount = Math.max(1, Math.ceil(totalForTab / CONTACTS_PAGE_SIZE));

  let managers: ContactRow[] = [];
  if (companies.length > 0) {
    const companyIds = companies.map((c) => c.id);
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("org_id", orgId)
      .in("company_id", companyIds)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[getContactsDirectory] managers", error.message);
    } else {
      managers = (data as ContactRow[]) ?? [];
    }
  }

  return {
    companies,
    independentContacts,
    managers,
    companiesCount,
    independentCount,
    pageCount,
  };
}
export type UserOrganization = {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
  slug: string;
  is_active: boolean;
};

//* Teams */

export type TeamMember = {
  user_id: string;
  role: OrgRole;
  created_at: string;
  is_me: boolean;
  profile: {
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
};

export type ActiveInvite = {
  id: string;
  email: string;
  role: "admin" | "member";
  created_at: string;
  expires_at: string;
};

export async function getTeamData(orgSlug: string) {
  const { userId, orgId, role } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  // 1. Получаем список всех участников
  const [
    { data: membersData, error: mErr },
    { data: invitesData, error: iErr },
  ] = await Promise.all([
    supabase
      .from("organization_members")
      .select(
        `user_id, role, created_at, users:user_id ( id, name, email, image )`,
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: true }),
    supabase
      .from("organization_invites")
      .select("id, email, role, created_at, expires_at")
      .eq("org_id", orgId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  ]);

  if (mErr) {
    console.error("[getTeamData] members", mErr.message);
    throw new Error("Не удалось загрузить участников");
  }
  if (iErr) {
    console.error("[getTeamData] invites", iErr.message);
    throw new Error("Не удалось загрузить приглашения");
  }

  type MemberRow = {
    user_id: string;
    role: OrgRole;
    created_at: string;
    users:
      | {
          id: string;
          name: string | null;
          email: string | null;
          image: string | null;
        }
      | {
          id: string;
          name: string | null;
          email: string | null;
          image: string | null;
        }[]
      | null;
  };

  const members: TeamMember[] = ((membersData ?? []) as MemberRow[]).map(
    (m) => {
      const u = one(m.users);
      return {
        user_id: m.user_id,
        role: m.role,
        created_at: m.created_at,
        is_me: m.user_id === userId,
        profile: u ? { name: u.name, email: u.email, image: u.image } : null,
      };
    },
  );

  return {
    members,
    invites: invitesData ?? [],
    currentUserRole: role,
    currentUserId: userId,
  };
}
