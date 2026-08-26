"use server";

import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import { getProjectSpecItems } from "@/lib/queries";
import { priceOf } from "@/lib/spec/pricing";
import { fmt, fmtQty } from "@/lib/utils";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import * as XLSX from "xlsx";

export async function exportSpecToExcel(
  orgSlug: string,
  projectId: string,
): Promise<ActionResult<{ filename: string; base64: string }>> {
  const ctx = await requireOrgBySlug(orgSlug);
  const items = await getProjectSpecItems(orgSlug, projectId);

  const rows = items.map((it) => {
    const p = priceOf(it);
    return {
      Марка: it.code,
      Наименование: it.name,
      Бренд: it.brand || "",
      Спецификация: it.spec || "",
      Артикул: it.article || "",
      "Кол-во": fmtQty(p.qtyFinal),
      "Ед.": it.unit,
      Цена: fmt(p.priceFinal),
      Сумма: fmt(p.total),
      Статус: SPEC_STATUS_CONFIG[it.status].label,
      Поставщик: it.companyName || "",
      Контакт: it.contactName || "",
      Помещения: it.rooms.join(", "),
      Заметки: it.notes || "",
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // ширины колонок
  ws["!cols"] = [
    { wch: 8 }, // Марка
    { wch: 30 }, // Наименование
    { wch: 15 }, // Бренд
    { wch: 25 }, // Спецификация
    { wch: 12 }, // Артикул
    { wch: 8 }, // Кол-во
    { wch: 6 }, // Ед.
    { wch: 10 }, // Цена
    { wch: 12 }, // Сумма
    { wch: 12 }, // Статус
    { wch: 20 }, // Поставщик
    { wch: 20 }, // Контакт
    { wch: 20 }, // Помещения
    { wch: 30 }, // Заметки
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Спецификация");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const base64 = Buffer.from(buf).toString("base64");

  const filename = `spec-${projectId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return ok({ filename, base64 });
}

export async function generatePublicLink(
  orgSlug: string,
  projectId: string,
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
): Promise<ActionResult<{ token: string }>> {
  // PDF генерируется на лету через API-роут
  return generatePublicLink(orgSlug, projectId);
}
