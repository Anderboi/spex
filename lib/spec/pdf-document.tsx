import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { priceOf } from "@/lib/spec/pricing";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { TYPE_ORDER } from "@/lib/constants";
import { fmt, fmtQty } from "@/lib/utils";
import { type SpecItem } from '@/lib/types';

// Если хотите кириллицу — подключите шрифт
Font.register({
  family: "Inter",
  src: "https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff2",
});

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Inter",
    backgroundColor: "#f3efe7",
  },
  header: {
    borderBottom: "2pt solid #1b1a17",
    paddingBottom: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1b1a17",
  },
  client: {
    fontSize: 9,
    color: "#9a958a",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  meta: {
    fontSize: 9,
    color: "#9a958a",
    textAlign: "right",
    lineHeight: 1.6,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 12,
  },
  totalLabel: {
    fontSize: 9,
    color: "#9a958a",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  totalAmount: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1b1a17",
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottom: "1pt solid #1b1a17",
    paddingBottom: 6,
    marginTop: 20,
    marginBottom: 8,
  },
  groupName: {
    fontSize: 10,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  groupSum: {
    fontSize: 10,
    fontWeight: "bold",
  },
  itemRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #ece6da",
    paddingVertical: 6,
    fontSize: 9,
  },
  code: { width: "8%", color: "#46423a" },
  name: { width: "28%", fontWeight: "bold" },
  spec: { width: "20%", color: "#46423a" },
  qty: { width: "10%", textAlign: "right" },
  price: { width: "12%", textAlign: "right", color: "#46423a" },
  total: { width: "14%", textAlign: "right", fontWeight: "bold" },
  status: { width: "8%", textAlign: "right", fontSize: 8, color: "#46423a" },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: "2pt solid #1b1a17",
    paddingTop: 10,
    marginTop: 20,
  },
  footerLabel: { fontSize: 12, fontWeight: "bold" },
  footerSum: { fontSize: 16, fontWeight: "bold" },
});

export function SpecPdfDocument({
  project,
  items,
}: {
  project: { title: string; client_name: string | null };
  items: SpecItem[];
}) {
  const real = items.filter((i) => !i.isPlaceholder);
  const totalSum = real.reduce((s, i) => s + priceOf(i).total, 0);

  const byType = TYPE_ORDER.map((type) => {
    const list = real.filter((i) => i.type === type);
    const sum = list.reduce((a, i) => a + priceOf(i).total, 0);
    return { type, items: list, sum };
  }).filter((g) => g.items.length > 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* заголовок */}
        <View style={styles.header}>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <View>
              {project.client_name && (
                <Text style={styles.client}>{project.client_name}</Text>
              )}
              <Text style={styles.title}>{project.title}</Text>
            </View>
            <View style={styles.meta}>
              <Text>Дата · {new Date().toLocaleDateString("ru")}</Text>
              <Text>Позиций · {real.length}</Text>
            </View>
          </View>
        </View>

        {/* итого */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Итого по спецификации</Text>
          <Text style={styles.totalAmount}>{fmt(totalSum)} ₽</Text>
        </View>

        {/* группы */}
        {byType.map((g) => (
          <View key={g.type} wrap={false}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupName}>
                {g.type} · {g.items.length}
              </Text>
              <Text style={styles.groupSum}>{fmt(g.sum)} ₽</Text>
            </View>

            {g.items.map((it) => {
              const p = priceOf(it);
              const config = SPEC_STATUS_CONFIG[it.status];
              return (
                <View key={it.id} style={styles.itemRow}>
                  <Text style={styles.code}>{it.code}</Text>
                  <Text style={styles.name}>
                    {it.name} {it.brand && `(${it.brand})`}
                  </Text>
                  <Text style={styles.spec}>{it.spec || "—"}</Text>
                  <Text style={styles.qty}>
                    {fmtQty(p.qtyFinal)} {it.unit}
                  </Text>
                  <Text style={styles.price}>{fmt(p.priceFinal)}</Text>
                  <Text style={styles.total}>{fmt(p.total)} ₽</Text>
                  <Text style={styles.status}>{config.label}</Text>
                </View>
              );
            })}
          </View>
        ))}

        {/* подвал */}
        <View style={styles.footer}>
          <Text style={styles.footerLabel}>Всего</Text>
          <Text style={styles.footerSum}>{fmt(totalSum)} ₽</Text>
        </View>
      </Page>
    </Document>
  );
}

export default SpecPdfDocument;
