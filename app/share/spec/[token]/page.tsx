import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectSpecItems } from "@/lib/queries";
import { priceOf } from "@/lib/spec/pricing";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { SPEC_STATUSES, TYPE_ORDER } from "@/lib/constants";
import { fmt, fmtQty, cn } from "@/lib/utils";

type Props = {
  params: Promise<{ token: string }>;
};

async function getPublicSpec(token: string) {
  const supabase = createAdminClient();

  // проверка токена
  const { data: link } = await supabase
    .from("public_links")
    .select("project_id, org_id, expires_at, projects(title, client_name)")
    .eq("token", token)
    .eq("type", "spec")
    .maybeSingle();

  if (!link) return null;
  if (new Date(link.expires_at) < new Date()) return null;

  // проект
  const project = Array.isArray(link.projects)
    ? link.projects[0]
    : link.projects;
  if (!project) return null;

  // позиции — через внутренний хелпер, но без проверки прав
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

  const items = (rows ?? []).map((r) => ({
    ...r,
    stockPct: Number(r.stock_pct ?? 0),
    clientDiscountPct: Number(r.client_discount_pct ?? 0),
    supplierDiscountPct: 0, // не показываем клиенту
    isPlaceholder: r.is_placeholder ?? false,
    companyName: r.company_name_snapshot ?? "",
    rooms: r.rooms ?? [],
  }));

  return { project, items };
}

export default async function PublicSpecPage({ params }: Props) {
  const { token } = await params;
  const data = await getPublicSpec(token);

  if (!data) notFound();

  const { project, items } = data;
  const real = items.filter((i) => !i.isPlaceholder);
  const totalSum = real.reduce((s, i) => s + priceOf(i).total, 0);

  // группировка по статусам
  const byStatus = SPEC_STATUSES.map((s) => {
    const list = real.filter((i) => i.status === s);
    const sum = list.reduce((a, i) => a + priceOf(i).total, 0);
    const pct = totalSum ? Math.round((sum / totalSum) * 100) : 0;
    return {
      status: s,
      label: SPEC_STATUS_CONFIG[s].label,
      color: SPEC_STATUS_CONFIG[s].dot,
      count: list.length,
      sum,
      pct,
    };
  }).filter((b) => b.count > 0);

  // группировка по типам
  const byType = TYPE_ORDER.map((type) => {
    const list = real.filter((i) => i.type === type);
    const sum = list.reduce((a, i) => a + priceOf(i).total, 0);
    return { type, items: list, count: list.length, sum };
  }).filter((g) => g.count > 0);

  return (
    <div className="mx-auto min-h-screen max-w-[900px] bg-bg px-6 py-12 print:px-8">
      {/* заголовок */}
      <div className="flex items-end justify-between gap-5 border-b-2 border-fg pb-5 print:break-inside-avoid">
        <div>
          {project.client_name && (
            <p className="font-mono text-[11px] uppercase tracking-[.1em] text-fg-dim">
              {project.client_name}
            </p>
          )}
          <h1 className="mt-2 text-[clamp(28px,5vw,40px)] font-bold leading-none tracking-[-.02em]">
            {project.title}
          </h1>
        </div>
        <div className="text-right font-mono text-[11px] leading-relaxed text-fg-dim">
          <p>Дата · {new Date().toLocaleDateString("ru")}</p>
          <p>Позиций · {real.length}</p>
        </div>
      </div>

      {/* итого */}
      <div className="mt-6 flex items-baseline justify-between gap-4 print:break-inside-avoid">
        <span className="font-mono text-[11px] uppercase tracking-[.12em] text-fg-dim">
          Итого по спецификации
        </span>
        <span className="text-[clamp(30px,6vw,44px)] font-bold tracking-[-.02em]">
          {fmt(totalSum)} ₽
        </span>
      </div>

      {/* полоса по статусам */}
      {byStatus.length > 0 && (
        <>
          <div className="mt-4 flex h-3 overflow-hidden rounded-lg bg-bg-select print:break-inside-avoid">
            {byStatus.map((b) => (
              <div
                key={b.status}
                style={{ width: `${b.pct}%`, background: b.color }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-5 print:break-inside-avoid">
            {byStatus.map((b) => (
              <div key={b.status} className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", b.color)} />
                <span className="text-[13.5px] font-semibold">{b.label}</span>
                <span className="font-mono text-[12px] text-fg-dim tabular-nums">
                  {b.count} · {fmt(b.sum)} ₽ · {b.pct}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* группы */}
      {byType.map((g) => (
        <div key={g.type} className="mt-8 print:break-inside-avoid-page">
          <div className="flex items-center justify-between border-b border-fg pb-2">
            <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[.12em]">
              {g.type} <span className="text-fg-dim">· {g.count}</span>
            </span>
            <span className="font-mono text-[13px] font-semibold tabular-nums">
              {fmt(g.sum)} ₽
            </span>
          </div>

          {g.items.map((it) => {
            const p = priceOf(it);
            const config = SPEC_STATUS_CONFIG[it.status];
            return (
              <div
                key={it.id}
                className="grid grid-cols-[56px_minmax(140px,1.5fr)_1fr_78px_92px_110px_118px] items-center gap-3 border-b border-border-muted py-2.5 text-[13.5px]"
              >
                <span className="font-mono text-[11.5px] text-fg-secondary">
                  {it.code}
                </span>
                <span className="font-semibold">
                  {it.name}{" "}
                  {it.brand && (
                    <span className="font-mono text-[10.5px] font-normal text-fg-dim">
                      {it.brand}
                    </span>
                  )}
                </span>
                <span className="text-[12.5px] text-fg-secondary">
                  {it.spec || "—"}
                </span>
                <span className="font-mono text-[12.5px] text-right tabular-nums">
                  {fmtQty(p.qtyFinal)} {it.unit}
                </span>
                <span className="font-mono text-[12.5px] text-right tabular-nums text-fg-secondary">
                  {fmt(p.priceFinal)}
                </span>
                <span className="text-right text-[14px] font-bold tabular-nums">
                  {fmt(p.total)} ₽
                </span>
                <span className="flex items-center justify-end gap-2">
                  <span className={cn("size-1.5 rounded-full", config.dot)} />
                  <span className="whitespace-nowrap text-[11.5px] text-fg-secondary">
                    {config.label}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {/* подвал */}
      <div className="mt-8 flex items-center justify-between border-t-2 border-fg pt-4 print:break-inside-avoid">
        <span className="text-[16px] font-bold">Всего</span>
        <span className="text-[24px] font-bold tracking-[-.01em]">
          {fmt(totalSum)} ₽
        </span>
      </div>

      {/* кнопка печати — только на экране */}
      <div className="mt-8 text-center print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-xl bg-bg-accent px-6 py-3 text-[14px] font-semibold text-bg"
        >
          Распечатать или сохранить в PDF
        </button>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const data = await getPublicSpec(token);
  return {
    title: data
      ? `${data.project.title} · Спецификация`
      : "Ссылка недействительна",
  };
}
