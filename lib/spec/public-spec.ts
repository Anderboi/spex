import { createAdminClient } from "@/lib/supabase/admin";
import { SpecItem } from "../types";

export type PublicSpec = {
  project: { title: string; client_name: string | null };
  items: SpecItem[];
  clientView: boolean;
  createdAt: string;
};

export async function loadPublicSpec(
  token: string,
): Promise<PublicSpec | null> {
  const supabase = createAdminClient();

  const { data: link } = await supabase
    .from("public_links")
    .select(
      "project_id, org_id, expires_at, client_view, created_at, projects(title, client_name)",
    )
    .eq("token", token)
    .eq("type", "spec")
    .maybeSingle();

  if (!link) return null;
  if (new Date(link.expires_at) < new Date()) return null;

  const project = Array.isArray(link.projects)
    ? link.projects[0]
    : link.projects;
  if (!project) return null;

  const { data: rows } = await supabase
    .from("spec_items")
    .select(
      `
      id, code, type, name, brand, spec, article, qty, unit, price,
      stock_pct, client_discount_pct, status, is_placeholder,
      company_name_snapshot, rooms
    `,
    )
    .eq("project_id", link.project_id)
    .eq("org_id", link.org_id)
    .is("deleted_at", null)
    .order("position");

  const items = (rows ?? [])
    .filter((r) => !r.is_placeholder)
    .map((r) => ({
      id: r.id,
      code: r.code,
      type: r.type,
      name: r.name,
      brand: r.brand ?? "",
      spec: r.spec ?? "",
      article: r.article ?? "",
      qty: Number(r.qty ?? 0),
      unit: r.unit ?? "шт",
      price: Number(r.price ?? 0),
      stockPct: Number(r.stock_pct ?? 0),
      clientDiscountPct: Number(r.client_discount_pct ?? 0),
      supplierDiscountPct: 0, // клиенту не отдаём никогда
      status: r.status,
      isPlaceholder: false,
      companyName: r.company_name_snapshot ?? "",
      rooms: r.rooms ?? [],
      // поля, не нужные для рендера сводки — заглушки под тип
      projectId: link.project_id,
      materialId: null,
      companyId: null,
      contactId: null,
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      imageUrl: null,
      notes: "",
      leadTime: "",
      avail: "",
      attrs: {},
      position: 0,
      product_url: "",
      product_type: "",
      updatedAt: new Date().toISOString(),
    })) as SpecItem[];

  return {
    project,
    items,
    clientView: link.client_view === true,
    createdAt: link.created_at,
  };
}
