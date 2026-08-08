import { createClient } from "@/lib/supabase/server";
import { LibraryMaterial, SupplierContact } from "./types";

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
  const supabase = await createClient();

  // Делаем JOIN с таблицей suppliers, чтобы сразу получать данные о поставщике
  let query = supabase
    .from("materials")
    .select(
      `
      *,
      supplier:suppliers(*)
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

  return data as LibraryMaterial[];
}

export async function getMaterialById(id: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("materials")
    .select(
      `
      *,
      supplier:suppliers(*)
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

export async function getProjects(
  status: "active" | "archived" | "completed" = "active",
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("status", status)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching projects:", error.message);
    return [];
  }

  return data;
}

export async function getProjectById(projectId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
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
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Error fetching companies:`, error.message);
    return [];
  }

  return data ?? [];
}

export async function getContacts() {
  const supabase = await createClient();

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
