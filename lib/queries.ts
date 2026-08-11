import { requireSession } from "@/lib/auth";
import { createAdminClient } from "./supabase/admin";
import { CompanyInput, ContactInput, MaterialInput } from "./validations";

/**
 * ==========================================
 * MATERIALS QUERIES
 * ==========================================
 */
// export type MaterialListItem = {
//   id: string;
//   name: string;
//   category: string;
//   brand: string | null;
//   article: string | null;
//   price: number | null;
//   unit: string;
//   image_url: string | null;
//   created_at: string;
//   companies: { id: string; name: string } | null;
//   contacts: { id: string; name: string } | null;
//   tags: string[];
// };

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
  const { orgId } = await requireSession();
  const supabase = createAdminClient();

  // Делаем JOIN с таблицей suppliers, чтобы сразу получать данные о поставщике
  let query = supabase
    .from("materials")
    .select(MATERIAL_LIST_SELECT)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (options?.search && options.search.trim() !== "") {
    const s = options.search.trim();
    query = query.or(
      `name.ilike.%${s}%,brand.ilike.%${s}%,article.ilike.%${s}%`,
    );
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
  const { orgId } = await requireSession();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("materials")
    .select(MATERIAL_LIST_SELECT)
    .eq("org_id", orgId)
    .eq("id", id)
    .single();

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
const PROJECT_STATUSES = ["active", "archived", "completed"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// export type ProjectListItem = {
//   id: string;
//   title: string;
//   accent_color: string | null;
//   client_name: string | null;
//   status: "active" | "archived" | "completed";
//   cover_url: string | null;
//   updated_at: string;
//   created_at: string;
//   org_id: string;
//   budget: number | null;
//   address: string | null;
// };
const PROJECT_LIST_SELECT =
  "id, title, client_name, accent_color, status, cover_url, updated_at, created_at, org_id, budget, address, type";

export async function getProjects(status?: ProjectStatus) {
  const { orgId } = await requireSession();
  const supabase = createAdminClient();

  let query = supabase
    .from("projects")
    .select(PROJECT_LIST_SELECT)
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching projects:", error.message);
    throw new Error(`Failed to fetch projects: ${error.message}`);
  }

  return data ?? [];
}

export async function getProjectById(projectId: string) {
  const { orgId } = await requireSession();

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_LIST_SELECT)
    .eq("org_id", orgId)
    .eq("id", projectId)
    .single();

  if (error) {
    console.error(`Error fetching project ${projectId}:`, error.message);
    return null;
  }

  return data;
}

/**
 * Получение всех элементов спецификации для конкретного проекта
 * Включает связанные данные поставщика и оригинального материала
 */
export async function getProjectSpecItems(projectId: string) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("spec_items")
    .select(
      `
      *,
      supplier:suppliers(*),
      material:materials(*)
    `,
    )
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) {
    console.error(
      `Error fetching spec items for project ${projectId}:`,
      error.message,
    );
    throw new Error(`Failed to fetch spec items: ${error.message}`);
  }

  return data;
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

export async function getCompanies() {
  const { orgId } = await requireSession();
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

  return (data as CompanyListItem[]) ?? [];
}

export async function getContacts() {
  const { orgId } = await requireSession();
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

  return data;
}

export type CounterpartyData = {
  companies: CompanyInput[];
  contacts: ContactInput[];
};

export async function getCounterparties(): Promise<CounterpartyData> {
  const { orgId } = await requireSession();
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
  is_active: boolean;
};

//* Teams */

export async function getUserOrganizations(): Promise<UserOrganization[]> {
  const { userId, orgId: activeOrgId } = await requireSession();
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
    is_active: item.organizations.id === activeOrgId,
  }));
}

export type TeamMember = {
  id: string; // ID записи в organization_members
  user_id: string;
  role: "owner" | "admin" | "member";
  created_at: string;
  profile: {
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
};

export type ActiveInvite = {
  id: string;
  email: string;
  role: "admin" | "member";
  created_at: string;
  expires_at: string;
};

export async function getTeamData(): Promise<{
  members: TeamMember[];
  invites: ActiveInvite[];
  currentUserRole: "owner" | "admin" | "member";
  currentUserId: string;
}> {
  const { userId, orgId } = await requireSession();
  const supabase = createAdminClient();

  // 1. Получаем список всех участников
  const { data: membersData, error: membersError } = await supabase
    .from("organization_members")
    .select(
      `
      id,
      user_id,
      role,
      created_at,
      profiles:user_id (
        full_name,
        email,
        avatar_url
      )
    `,
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (membersError) {
    console.error("[getTeamData] Members Error:", membersError.message);
    throw new Error("Не удалось загрузить список участников");
  }

  // 2. Получаем активные приглашения
  const { data: invitesData, error: invitesError } = await supabase
    .from("organization_invites")
    .select("id, email, role, created_at, expires_at")
    .eq("org_id", orgId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (invitesError) {
    console.error("[getTeamData] Invites Error:", invitesError.message);
    throw new Error("Не удалось загрузить приглашения");
  }

  // 3. Находим роль текущего пользователя
  const currentMember = membersData?.find((m: any) => m.user_id === userId);
  if (!currentMember) {
    throw new Error("У вас нет доступа к этой организации");
  }

  const members: TeamMember[] = (membersData ?? []).map((m: any) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    created_at: m.created_at,
    profile: m.profiles
      ? {
          full_name: m.profiles.full_name,
          email: m.profiles.email,
          avatar_url: m.profiles.avatar_url,
        }
      : null,
  }));

  return {
    members,
    invites: (invitesData as ActiveInvite[]) ?? [],
    currentUserRole: currentMember.role as "owner" | "admin" | "member",
    currentUserId: userId,
  };
}
