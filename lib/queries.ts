import { LibraryMaterial } from "./types";
import { requireSession } from "@/lib/auth";
import { createAdminClient } from "./supabase/admin";
import { CompanyInput, ContactInput, MaterialInput } from "./validations";

/**
 * ==========================================
 * MATERIALS QUERIES
 * ==========================================
 */
export type MaterialListItem = {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  article: string | null;
  price: number | null;
  unit: string;
  image_url: string | null;
  created_at: string;
  companies: { id: string; name: string } | null;
  contacts: { id: string; name: string } | null;
};

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
    .eq("orgId", orgId)
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

  return (data as unknown as MaterialListItem[]) ?? [];
}

export async function getMaterialById(id: string) {
  const { orgId } = await requireSession();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("materials")
    .select(MATERIAL_LIST_SELECT)
    .eq("orgId", orgId)
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

export type ProjectListItem = {
  id: string;
  name: string;
  code: string | null;
  client_name: string | null;
  status: "active" | "archived" | "completed";
  cover_url: string | null;
  updated_at: string;
};
const PROJECT_LIST_SELECT =
  "id, name, code, client_name, status, cover_url, updated_at";

export async function getProjects(status?: ProjectStatus) {
  const { orgId } = await requireSession();
  const supabase = createAdminClient();

  let query = supabase
    .from("projects")
    .select(PROJECT_LIST_SELECT)
    .eq("orgId", orgId)
    .order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching projects:", error.message);
    throw new Error(`Failed to fetch projects: ${error.message}`);
  }

  return (data as ProjectListItem[]) ?? [];
}

export async function getProjectById(projectId: string) {
  const { orgId } = await requireSession();

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_LIST_SELECT)
    .eq("orgId", orgId)
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
    .eq("orgId", orgId)
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
    .select("id, name, category, phone, email, note")
    .eq("orgId", orgId)
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
      .eq("orgId", orgId)
      .order("name"),
    supabase
      .from("contacts")
      .select("id, name, company_id, companies(name), category")
      .eq("orgId", orgId)
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
