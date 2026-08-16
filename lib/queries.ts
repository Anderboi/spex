import { createAdminClient } from "./supabase/admin";
import {
  CompanyInput,
  CompanyRow,
  ContactInput,
  ContactRow,
  MaterialInput,
  type ProjectStatus,
} from "./validations";
import { cache } from "react";
import { OrgRole, requireOrg } from "./auth/session";

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
  contacts:contact_id (id, name)
`;

export async function getMaterials(options?: {
  search?: string;
  category?: string;
}) {
  const { orgId } = await requireOrg();
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

  return (data as unknown as MaterialInput[]) ?? [];
}

export async function getMaterialById(id: string) {
  const { orgId } = await requireOrg();
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

  return data;
}

/**
 * ==========================================
 * PROJECTS QUERIES
 * ==========================================
 */
const PROJECT_LIST_SELECT =
  "id, title, client_name, accent_color, status, cover_url, updated_at, created_at, org_id, budget, address, type";

export const getProjects = cache(async (status?: ProjectStatus) => {
  const { orgId } = await requireOrg();
  const supabase = createAdminClient();

  let query = supabase
    .from("projects")
    .select(PROJECT_LIST_SELECT)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching projects:", error.message);
    throw new Error(`Failed to fetch projects: ${error.message}`);
  }

  return data;
});

export async function getProjectById(projectId: string) {
  const { orgId } = await requireOrg();

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

export async function getProjectSpecItems(projectId: string) {
  const { orgId } = await requireOrg();
  const supabase = createAdminClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!project) return []; // чужой проект — пусто, без намёков

  const { data, error } = await supabase
    .from("spec_items")
    .select(
      `*, company:company_id (id, name), contact:contact_id (id, name), material:material_id (id, name, image_url)`,
    )
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) {
    console.error("[getProjectSpecItems]", error.message);
    throw new Error("Не удалось загрузить спецификацию");
  }
  return data ?? [];
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

export async function getCompanies(): Promise<CompanyRow[]> {
  const { orgId } = await requireOrg();
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

export async function getContacts(): Promise<ContactRow[]> {
  const { orgId } = await requireOrg();
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

export async function getCounterparties(): Promise<CounterpartyData> {
  const { orgId } = await requireOrg();
  const supabase = createAdminClient();

  const [companiesRes, contactsRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name,category")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("contacts")
      .select("id, name, company_id, companies(name), category")
      .eq("org_id", orgId)
      .order("name"),
  ]);

  const companies = companiesRes.data || [];
  const contacts = contactsRes.data || [];

  return {
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category || [],
    })),
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category || [],
      company_id: c.company_id,
      company_name:
        (c.companies as unknown as { name: string } | null)?.name || null,
    })),
  };
}

export async function getContactsData() {
  // Вызываем параллельно и сразу получаем готовые массивы
  const [companies, contacts] = await Promise.all([
    getCompanies(),
    getContacts(),
  ]);

  return {
    companies,
    contacts,
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

export async function getUserOrganizations(): Promise<UserOrganization[]> {
  const { userId, orgId: activeOrgId } = await requireOrg();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("organization_members")
    .select(
      `
      role,
      organizations:org_id (
        id,
        name
      )
    `,
    )
    .eq("user_id", userId);

  if (error) {
    console.error("[getUserOrganizations] Database error:", error.message);
    throw new Error("Не удалось загрузить список организаций");
  }

  return (data ?? []).map((item: any) => ({
    id: item.organizations.id,
    name: item.organizations.name,
    role: item.role,
    slug: item.organizations.slug,
    is_active: item.organizations.id === activeOrgId,
  }));
}

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

export async function getTeamData() {
  const { userId, orgId, role } = await requireOrg();
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

  const members = (membersData ?? []).map((m: any) => {
    const u = Array.isArray(m.users) ? m.users[0] : m.users;
    return {
      user_id: m.user_id,
      role: m.role as OrgRole,
      created_at: m.created_at,
      is_me: m.user_id === userId,
      profile: u
        ? {
            name: u.name ?? null,
            email: u.email ?? null,
            image: u.image ?? null,
          }
        : null,
    };
  });

  return {
    members,
    invites: invitesData ?? [],
    currentUserRole: role,
    currentUserId: userId,
  };
}
