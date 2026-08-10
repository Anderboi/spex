import { createClient } from "@/lib/supabase/server";
import { LibraryMaterial, SupplierContact } from "./types";
import { auth } from "@/auth";
import { createAdminClient } from "./supabase/admin";
import { CompanyInput, ContactInput, MaterialInput } from "./validations";

/**
 * ==========================================
 * CONTACTS / SUPPLIERS QUERIES
 * ==========================================
 */

export async function getSuppliers(searchQuery?: string) {
  const supabase = await createClient();

  let query = supabase
    .from("suppliers")
    .select("*")
    .order("name", { ascending: true });

  if (searchQuery && searchQuery.trim() !== "") {
    // Поиск по названию, имени менеджера или городу
    query = query.or(
      `name.ilike.%${searchQuery}%,contact_person.ilike.%${searchQuery}%,city.ilike.%${searchQuery}%`,
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching suppliers:", error.message);
    return [];
  }

  return data as SupplierContact[];
}

export async function getSupplierById(id: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error(`Error fetching supplier ${id}:`, error.message);
    return null;
  }

  return data as SupplierContact;
}

/**
 * ==========================================
 * MATERIALS QUERIES
 * ==========================================
 */

export async function getMaterials(options?: {
  search?: string;
  category?: string;
}) {
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
    return [];
  }

  return data as MaterialInput[];
}

export async function getMaterialById(id: string) {
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
    .eq("id", id)
    .single();

  if (error) {
    console.error(`Error fetching material ${id}:`, error.message);
    return null;
  }

  return data as LibraryMaterial;
}

/**
 * ==========================================
 * PROJECTS QUERIES
 * ==========================================
 */
const PROJECT_STATUSES = ["active", "archived", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export async function getProjects(
  status?: ProjectStatus,
) {
  const session = await auth();

  if (!session?.user?.id) {
    return [];
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", session.user.id)
    .eq("status", status)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching projects:", error.message);
    return [];
  }

  return data;
}

export async function getProjectById(projectId: string) {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", session.user.id)
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
  const supabase = await createClient();

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
    return [];
  }

  return data;
}

export async function getCompanies() {
  const session = await auth();

  if (!session?.user?.id) {
    return [];
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Error fetching companies:`, error.message);
    return [];
  }

  return data;
}

export async function getContacts() {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Error fetching contacts:`, error.message);
    return [];
  }

  return data ?? [];
}

export type CounterpartyData = {
  companies: CompanyInput[];
  contacts: ContactInput[];
};

export async function getCounterparties(): Promise<CounterpartyData> {
  const supabase = createAdminClient();

  const [companiesRes, contactsRes] = await Promise.all([
    supabase.from("companies").select("id, name,category").order("name"),
    supabase
      .from("contacts")
      .select("id, name, company_id, companies(name), category")
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
