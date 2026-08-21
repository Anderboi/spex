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
import { SpecItem } from "./types";
import { one } from "./utils";

export type SpecPickerCompany = { id: string; name: string };
export type SpecPickerContact = {
  id: string;
  name: string;
  company_id: string | null;
  phone: string | null;
  email: string | null;
};

export const getSpecPickerData = cache(async (orgSlug: string) => {
  const { orgId } = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  const [companiesRes, contactsRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
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
  contacts:contact_id (id, name)
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
  "id, title, client_name, accent_color, status, cover_url, updated_at, created_at, org_id, budget, address, type";

export type ProjectSort = "date" | "name" | "budget";

export const getProjects = cache(
  async (opts: {
    orgSlug: string;
    search?: string;
    sort?: ProjectSort;
    status?: ProjectStatus;
  }) => {
    const { orgId } = await requireOrgBySlug(opts.orgSlug);
    const supabase = createAdminClient();

    let query = supabase
      .from("projects")
      .select(PROJECT_LIST_SELECT)
      .eq("org_id", orgId)
      .is("deleted_at", null);

    const s = opts.search
      ?.trim()
      .replace(/[,.()"\\%]/g, " ")
      .slice(0, 100)
      .trim();
    if (s) {
      query = query.or(
        `title.ilike."%${s}%",client_name.ilike."%${s}%",address.ilike."%${s}%"`,
      );
    }
    if (opts.status) query = query.eq("status", opts.status);

    query =
      opts.sort === "name"
        ? query.order("title", { ascending: true })
        : opts.sort === "budget"
          ? query.order("budget", { ascending: false, nullsFirst: false })
          : query.order("updated_at", { ascending: false });

    const { data, error } = await query;
    if (error) {
      console.error("[getProjects]", error.message);
      throw new Error("Не удалось загрузить проекты");
    }
    return data ?? [];
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

  return (data ?? []).map(rowToItem);
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

export async function getContactsData(orgSlug: string) {
  // Вызываем параллельно и сразу получаем готовые массивы
  const [companies, contacts] = await Promise.all([
    getCompanies(orgSlug),
    getContacts(orgSlug),
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

// export async function getUserOrganizations(): Promise<UserOrganization[]> {
//   const { userId, orgId: activeOrgId } = await requireOrg();
//   const supabase = createAdminClient();

//   const { data, error } = await supabase
//     .from("organization_members")
//     .select(
//       `
//       role,
//       organizations:org_id (
//         id,
//         name
//       )
//     `,
//     )
//     .eq("user_id", userId);

//   if (error) {
//     console.error("[getUserOrganizations] Database error:", error.message);
//     throw new Error("Не удалось загрузить список организаций");
//   }

//   return (data ?? []).map((item: any) => ({
//     id: item.organizations.id,
//     name: item.organizations.name,
//     role: item.role,
//     slug: item.organizations.slug,
//     is_active: item.organizations.id === activeOrgId,
//   }));
// }

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
