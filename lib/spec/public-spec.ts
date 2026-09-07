import { createAdminClient } from "@/lib/supabase/admin";
import { SpecItem, type SpecVariant } from "../types";
import { applyActiveVariant, rowToVariant } from "./variants";
import {
  buildSpecSummaryComposition,
  type SpecSummaryCompositionNode,
  type SpecSummaryCompositionSourceRow,
} from "./summary-composition";

export type PublicSpec = {
  project: { title: string; client_name: string | null };
  items: SpecItem[];
  /** «Тонкая» отображаемая модель состава по spec_item_id (без служебных полей). */
  compositions: Record<string, SpecSummaryCompositionNode[]>;
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

  // ── Состав позиций ─────────────────────────────────────────────
  // Одним запросом (без N+1) грузим spec_item_components для всех позиций
  // проекта и строим «тонкую» отображаемую модель: без служебных id,
  // company/contact и заметок. Имена/коды ссылок гидратируются из уже
  // выбранных spec_items — отдельного запроса не нужно.
  const compositions: Record<string, SpecSummaryCompositionNode[]> = {};
  if (rows && rows.length > 0) {
    const { data: compRows } = await supabase
      .from("spec_item_components")
      .select(
        "id, spec_item_id, kind, name, cost, additional_cost, ref_spec_item_id, parent_component_id",
      )
      .in(
        "spec_item_id",
        rows.map((r) => r.id),
      )
      .eq("org_id", link.org_id)
      .in("kind", ["component", "group", "spec_ref"])
      .order("position", { ascending: true });

    if (compRows && compRows.length > 0) {
      const targetById = new Map(
        rows.map((r) => [r.id, r]),
      );
      const byItem = new Map<string, SpecSummaryCompositionSourceRow[]>();

      for (const cr of compRows) {
        const source: SpecSummaryCompositionSourceRow = {
          id: cr.id,
          kind: cr.kind as SpecSummaryCompositionSourceRow["kind"],
          name: cr.name ?? "",
          cost: cr.cost == null ? null : Number(cr.cost),
          additional_cost:
            cr.additional_cost == null ? null : Number(cr.additional_cost),
          parent_component_id: cr.parent_component_id,
          ref_spec_item: null,
        };
        if (cr.kind === "spec_ref" && cr.ref_spec_item_id) {
          const target = targetById.get(cr.ref_spec_item_id);
          source.ref_spec_item = target
            ? { available: true, code: target.code ?? "", name: target.name }
            : { available: false };
        }
        const list = byItem.get(cr.spec_item_id);
        if (list) list.push(source);
        else byItem.set(cr.spec_item_id, [source]);
      }

      for (const [specItemId, sourceRows] of byItem) {
        compositions[specItemId] = buildSpecSummaryComposition(sourceRows);
      }
    }
  }

  return {
    project,
    items,
    compositions,
    clientView: link.client_view === true,
    createdAt: link.created_at,
  };
}
