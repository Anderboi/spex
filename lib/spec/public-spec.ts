import { createAdminClient } from "@/lib/supabase/admin";
import { SpecItem, type SpecVariant } from "../types";
import { applyActiveVariant, rowToVariant } from "./variants";

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

  // Активные варианты всех позиций одним запросом (без N+1).
  // Публичный канал видит только активный вариант.
  const variantByItem = new Map<string, SpecVariant[]>();
  if (rows && rows.length > 0) {
    const { data: variantRows } = await supabase
      .from("spec_item_variants")
      .select("*")
      .in(
        "spec_item_id",
        rows.map((r) => r.id),
      )
      .eq("is_active", true);

    for (const vr of variantRows ?? []) {
      variantByItem.set(vr.spec_item_id, [rowToVariant(vr)]);
    }
  }

  const items = (rows ?? [])
    .filter((r) => !r.is_placeholder)
    .map((r) =>
      applyActiveVariant({
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
        variants: variantByItem.get(r.id) ?? [],
        activeVariantId: null,
      } as SpecItem),
    );

  return {
    project,
    items,
    clientView: link.client_view === true,
    createdAt: link.created_at,
  };
}
