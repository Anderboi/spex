"use server";

import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import { getProjectSpecItems } from "@/lib/queries";
import { priceOf } from "@/lib/spec/pricing";
import { fmt, fmtQty } from "@/lib/utils";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import * as XLSX from "xlsx";

type ExportOpts = { clientView?: boolean };

export async function exportSpecToExcel(
  orgSlug: string,
  projectId: string,
  opts: ExportOpts = {},
): Promise<ActionResult<{ filename: string; base64: string }>> {
  // const ctx = await requireOrgBySlug(orgSlug);
  const items = (await getProjectSpecItems(orgSlug, projectId)).filter(
    (i) => !i.isPlaceholder,
  );

  const client = opts.clientView === true;

  const rows = items.map((it) => {
    const p = priceOf(it);
    // порядок ключей = порядок колонок
    const base: Record<string, string> = client ? {} : { Марка: it.code };

    Object.assign(base, {
      Наименование: it.name,
      Бренд: it.brand || "",
      Характеристика: it.spec || "",
      ...(client ? {} : { Артикул: it.article || "" }),
      "Кол-во": fmtQty(p.qtyFinal),
      "Ед.": it.unit,
      Цена: fmt(p.priceFinal),
      Сумма: fmt(p.total),
    });

    if (!client) {
      Object.assign(base, {
        Статус: SPEC_STATUS_CONFIG[it.status].label,
        Поставщик: it.companyName || "",
        Помещения: it.rooms.join(", "),
        Заметки: it.notes || "",
      });
    }
    return base;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // ширины колонок
  ws["!cols"] = client
    ? [
        { wch: 30 },
        { wch: 15 },
        { wch: 25 },
        { wch: 8 },
        { wch: 6 },
        { wch: 10 },
        { wch: 12 },
      ]
    : [
        { wch: 8 },
        { wch: 30 },
        { wch: 15 },
        { wch: 25 },
        { wch: 12 },
        { wch: 8 },
        { wch: 6 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 20 },
        { wch: 20 },
        { wch: 30 },
      ];

  XLSX.utils.book_append_sheet(wb, ws, "Спецификация");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const base64 = Buffer.from(buf).toString("base64");

    const suffix = client ? "client" : "full";
    const filename = `spec-${projectId.slice(0, 8)}-${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return ok({ filename, base64: Buffer.from(buf).toString("base64") });
}

export async function generatePublicLink(
  orgSlug: string,
  projectId: string,
  opts: ExportOpts = {},
): Promise<ActionResult<{ token: string }>> {
  const ctx = await requireOrgBySlug(orgSlug);
  const supabase = createAdminClient();

  // токен живёт 7 дней
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const { error } = await supabase.from("public_links").insert({
    token,
    org_id: ctx.orgId,
    project_id: projectId,
    type: "spec",
    client_view: opts.clientView === true,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    console.error("[generatePublicLink]", error.message);
    return fail("Не удалось создать ссылку");
  }

  return ok({ token });
}

export async function generateSpecPdf(
  orgSlug: string,
  projectId: string,
  opts: ExportOpts = {},
): Promise<ActionResult<{ token: string }>> {
  // PDF генерируется на лету через API-роут
   return generatePublicLink(orgSlug, projectId, opts);
}
