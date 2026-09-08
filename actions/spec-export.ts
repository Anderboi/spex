"use server";

import { requireOrgBySlug } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import { getProjectSpecItems } from "@/lib/queries";
import { priceOf, sumItems } from "@/lib/spec/pricing";
import {
  calcProjectTotal,
  sumServiceOperationAmounts,
} from "@/lib/spec/project-budget";
import { fmt, fmtQty } from "@/lib/utils";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { SERVICE_OPERATION_CONFIG } from "@/lib/constants";
import * as XLSX from "xlsx";
import { listProjectSpecCompositions } from "@/actions/spec-components";
import { listProjectServiceOperations } from "@/actions/service-operations";
import {
  buildSpecSummaryComposition,
  type SpecSummaryCompositionNode,
} from "@/lib/spec/summary-composition";
import type { SpecItem } from "@/lib/types";

type ExportOpts = { clientView?: boolean };

/** Строка Excel для позиции спецификации (порядок ключей = порядок колонок). */
function itemRow(it: SpecItem, client: boolean): Record<string, string> {
  const p = priceOf(it);
  const row: Record<string, string> = client ? {} : { Марка: it.code };

  Object.assign(row, {
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
    Object.assign(row, {
      Статус: SPEC_STATUS_CONFIG[it.status].label,
      Поставщик: it.companyName || "",
      Помещения: it.rooms.join(", "),
      Заметки: it.notes || "",
    });
  }
  return row;
}

/**
 * Раскладывает дерево состава позиции в плоские строки Excel под позицией.
 * Группы — подзаголовки (их дети идут ниже с отступом), компоненты и ссылки —
 * строки с названием; сумма строки состава пишется текстом (как и остальные
 * ячейки экспорта), поэтому в общую стоимость спецификации не попадает.
 * Ссылка на SpecItem показывает имя/код исходной позиции, но из сумм — только
 * additional_cost: стоимость исходной позиции уже стоит в основной таблице.
 */
function pushCompositionRows(
  nodes: readonly SpecSummaryCompositionNode[],
  client: boolean,
  depth: number,
  out: Record<string, string>[],
): void {
  for (const node of nodes) {
    const row: Record<string, string> = {};
    const indent = "   ".repeat(depth);

    if (node.kind === "group") {
      row["Наименование"] = indent + node.name;
      out.push(row);
      pushCompositionRows(node.children, client, depth + 1, out);
      continue;
    }

    if (node.kind === "component") {
      row["Наименование"] = `${indent}— ${node.name}`;
      if (node.cost != null) row["Сумма"] = `${fmt(node.cost)} ₽`;
      out.push(row);
      continue;
    }

    // kind === "spec_ref" — ссылка на исходный SpecItem.
    if (!client && node.available && node.code) row["Марка"] = node.code;
    row["Наименование"] = node.available
      ? `${indent}— ${node.name ?? ""}`
      : `${indent}— Исходная позиция недоступна`;
    if (node.available && node.additional_cost != null)
      row["Сумма"] = `${fmt(node.additional_cost)} ₽ доп.`;
    out.push(row);
  }
}

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

  // Состав позиций: общая модель загрузки состава (bulk-запрос + гидратация
  // ссылок на SpecItem), используется и сводкой билдера — без дублирования
  // запросов к spec_item_components.
  const compositions = await listProjectSpecCompositions(
    orgSlug,
    projectId,
    items.map((i) => i.id),
  );
  if (!compositions.success) return fail(compositions.error);
  const compByItem: Record<string, SpecSummaryCompositionNode[]> = {};
  for (const [itemId, rows] of Object.entries(compositions.data)) {
    compByItem[itemId] = buildSpecSummaryComposition(rows);
  }

  // Каждая позиция = строка; под позицией с составом идут строки состава.
  const rows: Record<string, string>[] = [];
  for (const it of items) {
    rows.push(itemRow(it, client));
    const comp = compByItem[it.id];
    if (comp && comp.length > 0) {
      pushCompositionRows(comp, client, 0, rows);
    }
  }

  // ── Дополнительные расходы проекта: «Монтаж»/«Доставка» ──────────
  // amount — самостоятельная стоимость операции на уровне проекта; операция
  // пишется одной строкой независимо от числа связанных с ней позиций.
  const opsRes = await listProjectServiceOperations(orgSlug, projectId);
  if (!opsRes.success) return fail(opsRes.error);
  const ops = opsRes.data;

  const opDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU");

  for (const op of ops) {
    const row: Record<string, string> = {
      Наименование: SERVICE_OPERATION_CONFIG[op.type].label,
      Сумма: `${fmt(op.amount)} ₽`,
    };
    if (op.deadline) row.Характеристика = `до ${opDate(op.deadline)}`;
    if (!client) {
      if (op.contractor_name) row.Поставщик = op.contractor_name;
      if (op.notes) row.Заметки = op.notes;
    }
    rows.push(row);
  }

  // ── Бюджет проекта: материалы и услуги отдельными строками ──────
  const materialsTotal = sumItems(items).total;
  const serviceTotals = sumServiceOperationAmounts(ops);
  const budgetTotal = calcProjectTotal(
    materialsTotal,
    serviceTotals.servicesTotal,
  );

  rows.push({});
  rows.push({
    Наименование: "Стоимость материалов",
    Сумма: `${fmt(materialsTotal)} ₽`,
  });
  rows.push({
    Наименование: "Доставка",
    Сумма: `${fmt(serviceTotals.delivery)} ₽`,
  });
  rows.push({
    Наименование: "Монтаж",
    Сумма: `${fmt(serviceTotals.installation)} ₽`,
  });
  rows.push({
    Наименование: "Общий бюджет проекта",
    Сумма: `${fmt(budgetTotal)} ₽`,
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
