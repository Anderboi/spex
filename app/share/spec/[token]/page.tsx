import { notFound } from "next/navigation";
import { loadPublicSpec } from "@/lib/spec/public-spec";
import { SummaryItemRow } from "@/components/spec-builder/summary-item-row";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { SPEC_STATUSES, TYPE_ORDER } from "@/lib/constants";
import { priceOf } from "@/lib/spec/pricing";
import {
  calcProjectTotal,
  sumServiceOperationAmounts,
} from "@/lib/spec/project-budget";
import { fmt, cn } from "@/lib/utils";
import { PrintButton } from "@/components/spec-builder/print-button";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export default async function PublicSpecPage({ params }: Props) {
  const { token } = await params;
  const data = await loadPublicSpec(token);
  if (!data) notFound();

  const { project, items, clientView, createdAt } = data;
  const totalSum = items.reduce((s, i) => s + priceOf(i).total, 0);
  const serviceTotals = sumServiceOperationAmounts(data.serviceOperations);
  const projectTotal = calcProjectTotal(totalSum, serviceTotals.servicesTotal);

  const byStatus = SPEC_STATUSES.map((s) => {
    const list = items.filter((i) => i.status === s);
    const sum = list.reduce((a, i) => a + priceOf(i).total, 0);
    const pct = totalSum ? Math.round((sum / totalSum) * 100) : 0;
    return {
      status: s,
      label: SPEC_STATUS_CONFIG[s].label,
      color: SPEC_STATUS_CONFIG[s].bar,
      count: list.length,
      sum,
      pct,
    };
  }).filter((b) => b.count > 0);

  const byType = TYPE_ORDER.map((type) => {
    const list = items.filter((i) => i.type === type);
    const sum = list.reduce((a, i) => a + priceOf(i).total, 0);
    return { type, items: list, count: list.length, sum };
  }).filter((g) => g.count > 0);

  return (
    <div className="@container mx-auto min-h-screen max-w-225 bg-bg px-6 py-12 print:px-8">
      {/* заголовок */}
      <div className="flex items-end justify-between gap-5 border-b-2 border-fg pb-5 print:break-inside-avoid">
        <div>
          {project.client_name && (
            <p className="font-mono text-[11px] uppercase tracking-widest text-fg-dim">
              {project.client_name}
            </p>
          )}
          <h1 className="mt-2 text-[clamp(28px,5vw,40px)] font-bold leading-none tracking-[-.02em]">
            {project.title}
          </h1>
        </div>
        <div className="text-right font-mono text-[11px] leading-relaxed text-fg-dim">
          <p>Дата · {new Date(createdAt).toLocaleDateString("ru")}</p>
          <p>Позиций · {items.length}</p>
          {clientView && (
            <p className="mt-1 text-fg-muted">Коммерческое предложение</p>
          )}
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

      {/* полоса статусов — только в рабочей версии */}
      {!clientView && byStatus.length > 0 && (
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
          {g.items.map((it) => (
            <SummaryItemRow
              key={it.id}
              item={it}
              clientView={clientView}
              composition={data.compositions[it.id]}
            />
          ))}
        </div>
      ))}

      {/* бюджет проекта — отдельными строками */}
      <div className="mt-8 border-t-2 border-fg pt-4 print:break-inside-avoid">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-6">
            <span className="font-mono text-[12px] uppercase tracking-[.12em] text-fg-muted">
              Стоимость материалов
            </span>
            <span className="font-mono text-[15px] font-bold tabular-nums">
              {fmt(totalSum)} ₽
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-6">
            <span className="font-mono text-[12px] uppercase tracking-[.12em] text-fg-muted">
              Доставка
            </span>
            <span className="font-mono text-[15px] font-bold tabular-nums">
              {fmt(serviceTotals.delivery)} ₽
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-6">
            <span className="font-mono text-[12px] uppercase tracking-[.12em] text-fg-muted">
              Монтаж
            </span>
            <span className="font-mono text-[15px] font-bold tabular-nums">
              {fmt(serviceTotals.installation)} ₽
            </span>
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-6 border-t border-fg pt-3">
          <span className="text-[16px] font-bold">Общий бюджет проекта</span>
          <span className="text-[24px] font-bold tracking-[-.01em]">
            {fmt(projectTotal)} ₽
          </span>
        </div>
      </div>

      <div className="mt-8 text-center print:hidden">
        <PrintButton />
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const data = await loadPublicSpec(token);
  return {
    title: data
      ? `${data.project.title} · Спецификация`
      : "Ссылка недействительна",
  };
}
