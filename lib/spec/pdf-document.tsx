// lib/spec/pdf-document.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./pdf-fonts";
import { priceOf } from "@/lib/spec/pricing";
import {
  calcProjectTotal,
  sumServiceOperationAmounts,
  type ServiceOperationBudgetRow,
} from "@/lib/spec/project-budget";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { TYPE_ORDER } from "@/lib/constants";
import { fmt, fmtQty } from "@/lib/utils";
import { SpecItem } from "../types";
import type { SpecSummaryCompositionNode } from "./summary-composition";

registerPdfFonts();

const C = {
  ink: "#1b1a17",
  sub: "#6a665a",
  dim: "#9a958a",
  line: "#e2ddd1",
  hair: "#ece6da",
  paper: "#ffffff",
};

// hex статусов для точки — из конфига, но react-pdf нужен чистый цвет
const DOT: Record<string, string> = {
  draft: "#bcb7ab",
  picked: "#c8a86b",
  approved: "#7d9b76",
  ordered: "#6b8fa3",
  delivered: "#5a8a5a",
  replace: "#bf5345",
};

const styles = StyleSheet.create({
  page: {
    paddingVertical: 44,
    paddingHorizontal: 46,
    fontSize: 9,
    fontFamily: "Rubik",
    color: C.ink,
    backgroundColor: C.paper,
  },

  /* шапка */
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
    paddingBottom: 16,
  },
  client: {
    fontSize: 8,
    color: C.dim,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: { fontSize: 22, fontWeight: "bold", letterSpacing: -0.4 },
  meta: { textAlign: "right", fontSize: 8, color: C.dim, lineHeight: 1.7 },

  /* итого-строка под шапкой */
  totalBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 18,
    marginBottom: 4,
  },
  totalLabel: {
    fontSize: 8,
    letterSpacing: 1.2,
    color: C.dim,
    textTransform: "uppercase",
  },
  totalValue: { fontSize: 22, fontWeight: "bold", letterSpacing: -0.4 },

  /* группа */
  group: { marginTop: 22 },
  groupHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderBottomWidth: 1,
    borderBottomColor: C.ink,
    paddingBottom: 5,
    marginBottom: 2,
  },
  groupName: {
    fontSize: 9,
    fontWeight: "bold",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  groupCount: { color: C.dim, fontWeight: "normal" },
  groupSum: { fontSize: 9, fontWeight: "bold" },

  /* строка позиции */
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottomWidth: 0.5,
    borderBottomColor: C.hair,
    paddingVertical: 8,
  },

  // колонки — доли, сумма = 100
  cCode: { width: "8%", paddingRight: 6 },
  cName: { width: "34%", paddingRight: 10 },
  cSpec: { width: "18%", paddingRight: 10 },
  cQty: { width: "12%", paddingRight: 8, textAlign: "right" },
  cPrice: { width: "12%", paddingRight: 8, textAlign: "right" },
  cTotal: { width: "16%", textAlign: "right" },

  // клиентская версия — без кода и статуса, name шире
  cNameWide: { width: "44%", paddingRight: 10 },

  code: { fontSize: 8, color: C.sub },
  name: { fontSize: 9.5, fontWeight: "bold", lineHeight: 1.35 },
  brand: { fontSize: 7.5, color: C.dim, marginTop: 1 },
  spec: { fontSize: 8, color: C.sub, lineHeight: 1.35 },
  numMuted: { fontSize: 8.5, color: C.sub },
  num: { fontSize: 8.5 },
  total: { fontSize: 10, fontWeight: "bold" },

  /* состав позиции */
  compBlock: {
    borderLeftWidth: 1,
    borderLeftColor: C.line,
    marginTop: 1,
    marginBottom: 6,
    paddingLeft: 10,
  },
  compTitle: {
    fontSize: 6.5,
    color: C.dim,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 1,
  },
  compNested: { paddingLeft: 10 },
  compGroup: { fontSize: 8.5, fontWeight: "bold", marginTop: 1.5 },
  compRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 1.5,
  },
  compName: { fontSize: 8, color: C.ink, lineHeight: 1.3, paddingRight: 6, flexGrow: 1 },
  compCode: { color: C.sub },
  compAmount: { fontSize: 7.5, color: C.sub },
  compMuted: { fontSize: 8, color: C.dim, marginTop: 1 },

  /* статус — отдельная строка под ценой, не в ряд */
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 3,
  },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 4 },
  statusText: { fontSize: 7.5, color: C.dim },

  /* бюджет проекта (подвал) */
  budget: {
    marginTop: 24,
    borderTopWidth: 1.5,
    borderTopColor: C.ink,
    paddingTop: 12,
  },
  budgetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 5,
  },
  budgetLabel: {
    fontSize: 8,
    letterSpacing: 1,
    color: C.dim,
    textTransform: "uppercase",
  },
  budgetValue: { fontSize: 10.5, fontWeight: "bold" },
  budgetTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderTopWidth: 1,
    borderTopColor: C.line,
    marginTop: 8,
    paddingTop: 8,
  },
  budgetTotalLabel: { fontSize: 11, fontWeight: "bold" },
  budgetTotalValue: { fontSize: 16, fontWeight: "bold", letterSpacing: -0.3 },

  /* колонтитул */
  pageNo: {
    position: "absolute",
    bottom: 22,
    left: 46,
    right: 46,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: C.dim,
  },
});

export function SpecPdfDocument({
  project,
  items,
  compositions = {},
  serviceOperations = [],
  clientView = false,
  createdAt,
}: {
  project: { title: string; client_name: string | null };
  items: SpecItem[];
  compositions?: Record<string, SpecSummaryCompositionNode[]>;
  /** Операции «Монтаж»/«Доставка» проекта — учитываются в общем бюджете. */
  serviceOperations?: readonly ServiceOperationBudgetRow[];
  clientView?: boolean;
  createdAt?: string;
}) {
  const totalSum = items.reduce((s, i) => s + priceOf(i).total, 0);
  const serviceTotals = sumServiceOperationAmounts(serviceOperations);
  const projectTotal = calcProjectTotal(totalSum, serviceTotals.servicesTotal);
  const date = createdAt ? new Date(createdAt) : new Date();

  const byType = TYPE_ORDER.map((type) => {
    const list = items.filter((i) => i.type === type);
    return {
      type,
      items: list,
      sum: list.reduce((a, i) => a + priceOf(i).total, 0),
    };
  }).filter((g) => g.items.length > 0);

  return (
    <Document title={`${project.title} · Спецификация`}>
      <Page size="A4" style={styles.page}>
        {/* шапка */}
        <View style={styles.head} fixed>
          <View>
            {project.client_name ? (
              <Text style={styles.client}>{project.client_name}</Text>
            ) : null}
            <Text style={styles.title}>{project.title}</Text>
          </View>
          <View style={styles.meta}>
            <Text>Дата · {date.toLocaleDateString("ru")}</Text>
            <Text>Позиций · {items.length}</Text>
            {clientView ? <Text>Коммерческое предложение</Text> : null}
          </View>
        </View>

        {/* итого */}
        <View style={styles.totalBar}>
          <Text style={styles.totalLabel}>Итого по спецификации</Text>
          <Text style={styles.totalValue}>{fmt(totalSum)} ₽</Text>
        </View>

        {/* группы */}
        {byType.map((g) => (
          <View key={g.type} style={styles.group} wrap={false}>
            <View style={styles.groupHead}>
              <Text style={styles.groupName}>
                {g.type}{" "}
                <Text style={styles.groupCount}>· {g.items.length}</Text>
              </Text>
              <Text style={styles.groupSum}>{fmt(g.sum)} ₽</Text>
            </View>

            {g.items.map((it) => {
              const p = priceOf(it);
              const comp = compositions[it.id];
              return (
                <View key={it.id} wrap={false}>
                  <View style={styles.row}>
                    {!clientView && (
                      <View style={styles.cCode}>
                        <Text style={styles.code}>{it.code}</Text>
                      </View>
                    )}

                    <View style={clientView ? styles.cNameWide : styles.cName}>
                      <Text style={styles.name}>{it.name}</Text>
                      {it.brand ? (
                        <Text style={styles.brand}>{it.brand}</Text>
                      ) : null}
                    </View>

                    <View style={styles.cSpec}>
                      <Text style={styles.spec}>{it.spec || "—"}</Text>
                    </View>

                    <View style={styles.cQty}>
                      <Text style={styles.num}>
                        {fmtQty(p.qtyFinal)} {it.unit}
                      </Text>
                    </View>

                    <View style={styles.cPrice}>
                      <Text style={styles.numMuted}>{fmt(p.priceFinal)}</Text>
                    </View>

                    <View style={styles.cTotal}>
                      <Text style={styles.total}>{fmt(p.total)} ₽</Text>
                      {!clientView && (
                        <View style={styles.statusLine}>
                          <View
                            style={[
                              styles.dot,
                              { backgroundColor: DOT[it.status] },
                            ]}
                          />
                          <Text style={styles.statusText}>
                            {SPEC_STATUS_CONFIG[it.status].label}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {comp && comp.length > 0 ? (
                    <PdfComposition nodes={comp} clientView={clientView} />
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}

        {/* бюджет проекта — отдельными строками */}
        <View style={styles.budget} wrap={false}>
          <View style={styles.budgetRow}>
            <Text style={styles.budgetLabel}>Стоимость материалов</Text>
            <Text style={styles.budgetValue}>{fmt(totalSum)} ₽</Text>
          </View>
          <View style={styles.budgetRow}>
            <Text style={styles.budgetLabel}>Доставка</Text>
            <Text style={styles.budgetValue}>{fmt(serviceTotals.delivery)} ₽</Text>
          </View>
          <View style={styles.budgetRow}>
            <Text style={styles.budgetLabel}>Монтаж</Text>
            <Text style={styles.budgetValue}>
              {fmt(serviceTotals.installation)} ₽
            </Text>
          </View>
          <View style={styles.budgetTotal}>
            <Text style={styles.budgetTotalLabel}>Общий бюджет проекта</Text>
            <Text style={styles.budgetTotalValue}>{fmt(projectTotal)} ₽</Text>
          </View>
        </View>

        {/* номер страницы */}
        <View style={styles.pageNo} fixed>
          <Text>{project.title}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

/** Блок «Состав» позиции в PDF (та же модель, что и в веб-сводке). */
function PdfComposition({
  nodes,
  clientView,
}: {
  nodes: SpecSummaryCompositionNode[];
  clientView: boolean;
}) {
  return (
    <View style={styles.compBlock}>
      <Text style={styles.compTitle}>Состав</Text>
      <PdfCompositionNodes nodes={nodes} clientView={clientView} />
    </View>
  );
}

function PdfCompositionNodes({
  nodes,
  clientView,
  nested = false,
}: {
  nodes: SpecSummaryCompositionNode[];
  clientView: boolean;
  nested?: boolean;
}) {
  return (
    <View style={nested ? styles.compNested : undefined}>
      {nodes.map((node, i) => {
        if (node.kind === "group") {
          return (
            <View key={i}>
              <Text style={styles.compGroup}>{node.name}</Text>
              {node.children.length > 0 ? (
                <PdfCompositionNodes
                  nodes={node.children}
                  clientView={clientView}
                  nested
                />
              ) : null}
            </View>
          );
        }
        if (node.kind === "component") {
          return (
            <View key={i} style={styles.compRow}>
              <Text style={styles.compName}>{node.name}</Text>
              {node.cost != null ? (
                <Text style={styles.compAmount}>{fmt(node.cost)} ₽</Text>
              ) : null}
            </View>
          );
        }
        // spec_ref: название/код из связанного SpecItem, только additional_cost.
        if (!node.available) {
          return (
            <Text key={i} style={styles.compMuted}>
              Исходная позиция недоступна
            </Text>
          );
        }
        return (
          <View key={i} style={styles.compRow}>
            <Text style={styles.compName}>
              {!clientView && node.code ? (
                <Text style={styles.compCode}>{node.code} · </Text>
              ) : null}
              {node.name}
            </Text>
            {node.additional_cost != null ? (
              <Text style={styles.compAmount}>
                {fmt(node.additional_cost)} ₽ доп.
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

