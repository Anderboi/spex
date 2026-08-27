import { NextRequest } from "next/server";
import { renderToBuffer, renderToStream } from "@react-pdf/renderer";
import { loadPublicSpec } from "@/lib/spec/public-spec";
import { SpecPdfDocument } from "@/lib/spec/pdf-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const data = await loadPublicSpec(token);
  if (!data)
    return new Response("Ссылка недействительна или истекла", { status: 404 });

  const buffer = await renderToBuffer(
    <SpecPdfDocument
      project={data.project}
      items={data.items}
      clientView={data.clientView}
      createdAt={data.createdAt}
    />,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="spec-${data.clientView ? "client" : "full"}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
