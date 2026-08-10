import { LibraryMaterial } from "./types";
import { requireSession } from "@/lib/auth";
import { createAdminClient } from "./supabase/admin";
import { CompanyInput, ContactInput, MaterialInput } from "./validations";

/**
 * ==========================================
 * MATERIALS QUERIES
 * ==========================================
 */

export async function getMaterials(options?: {
  search?: string;
  category?: string;
}) {
  const { userId } = await requireSession();
  const supabase = createAdminClient();

  // Делаем JOIN с таблицей suppliers, чтобы сразу получать данные о поставщике
  let query = supabase
    .from("materials")
    .select(
      `
      *,
      companies:company_id (id, name),
      contacts:contact_id (id, name)
    `,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options?.search && options.search.trim() !== "") {
    const s = options.search.trim();
    query = query.or(
      `name.ilike.%${s}%,brand.ilike.%${s}%,article.ilike.%${s}%`,
    );
  }

  if (options?.category) {
    query = query.eq("category", options.category);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching materials:", error.message);
    throw new Error(`Failed to fetch materials: ${error.message}`);
  }

  return data;
}

export async function getMaterialById(id: string) {
  const { userId } = await requireSession();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("materials")
    .select(
      `
      *,
      companies:company_id (id, name),
      contacts:contact_id (id, name)
    `,
    )
    .eq("user_id", userId)
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

export async function getProjects(status?: ProjectStatus) {
  const { userId } = await requireSession();

  const supabase = createAdminClient();

  let query = supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
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
}

export async function getProjectById(projectId: string) {
  const { userId } = await requireSession();

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
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

export async function getCompanies() {
  const { userId } = await requireSession();

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Error fetching companies:`, error.message);
    throw new Error(`Failed to fetch companies: ${error.message}`);
  }

  return data;
}

export async function getContacts() {
  const { userId } = await requireSession();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
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
  const { userId } = await requireSession();
  const supabase = createAdminClient();

  const [companiesRes, contactsRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name,category")
      .eq("user_id", userId)
      .order("name"),
    supabase
      .from("contacts")
      .select("id, name, company_id, companies(name), category")
      .eq("user_id", userId)
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
