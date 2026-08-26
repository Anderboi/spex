import { NextRequest } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { SpecPdfDocument } from "@/lib/spec/pdf-document";
import { SpecType } from "@/lib/constants";
import type { SpecItem } from "@/lib/types";

async function getSpec(token: string) {
  const supabase = createAdminClient();

  const { data: link } = await supabase
    .from("public_links")
    .select("project_id, org_id, expires_at, projects(title, client_name)")
    .eq("token", token)
    .maybeSingle();

  if (!link) return null;
  if (new Date(link.expires_at) < new Date()) return null;

  const project = Array.isArray(link.projects) ? link.projects[0] : link.projects;
  if (!project) return null;

  const { data: rows } = await supabase
    .from("spec_items")
    .select(`
      id, code, type, name, brand, spec, article, qty, unit, price,
      stock_pct, client_discount_pct, status, is_placeholder
    `)
    .eq("project_id", link.project_id)
    .eq("org_id", link.org_id)
    .is("deleted_at", null)
    .order("position");

  const items: SpecItem[] = (rows ?? []).map((r) => ({
    ...r,
    code: r.code ?? "",
    type: r.type as SpecType,
    brand: r.brand ?? "",
    spec: r.spec ?? "",
    article: r.article ?? "",
    stockPct: Number(r.stock_pct ?? 0),
    clientDiscountPct: Number(r.client_discount_pct ?? 0),
    supplierDiscountPct: 0,
    isPlaceholder: r.is_placeholder ?? false,
    companyName: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    imageUrl: null,
    rooms: [],
    notes: "",
    leadTime: "",
    avail: "",
    attrs: {},
    updatedAt: new Date().toISOString(),
    projectId: link.project_id,
    materialId: null,
    companyId: null,
    contactId: null,
    position: 0,
    product_url: "",
    product_type: "",
  }));

  return { project, items };
}


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const data = await getSpec(token);

  if (!data) {
    return new Response("Ссылка недействительна или истекла", { status: 404 });
  }

  const stream = await renderToStream(
    <SpecPdfDocument 
    project={data.project} 
    items={data.items} 
    />,
  );

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="spec-${data.project.title}.pdf"`,
    },
  });
}