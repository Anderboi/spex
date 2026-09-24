"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Link2 } from "lucide-react";
import { listSpecItemComponents } from "@/actions/spec-components";
import { fmt } from "@/lib/utils";

/**
 * Минимальная форма строки состава, которой хватает предпросмотру. Совпадает с
 * подмножеством `SpecItemComponentRow` из `@/actions/spec-components`, но не
 * импортирует его: тип пришлось бы тянуть из серверного модуля.
 */
type ComponentRow = {
  id: string;
  kind: "group" | "component" | "spec_ref";
  name: string;
  cost: number | null;
  additional_cost: number | null;
  parent_component_id: string | null;
  position: number;
  ref_spec_item: {
    id: string;
    available: boolean;
    code?: string;
    name?: string;
  } | null;
};

/** Строка состава стоит денег только как компонент или ссылка. */
const costOf = (r: ComponentRow) => {
  const value = r.kind === "spec_ref" ? r.additional_cost : r.cost;
  return value ?? 0;
};

const nameOf = (r: ComponentRow) => {
  if (r.kind !== "spec_ref") return r.name;
  const ref = r.ref_spec_item;
  if (!ref?.available) return "Позиция недоступна";
  return [ref.code, ref.name].filter(Boolean).join(" · ") || "Ссылка на позицию";
};

const byPosition = (a: ComponentRow, b: ComponentRow) =>
  a.position - b.position;

/**
 * Предпросмотр состава для вкладки «Обзор»: только чтение. Строка состава —
 * лёгкая сущность (группа, компонент или ссылка на позицию спецификации) и в
 * основную таблицу не попадает, поэтому здесь показываем её состав и сумму, а
 * добавление, правку и удаление оставляем вкладке «Состав».
 */
export function ComponentsPreview({
  orgSlug,
  projectId,
  specItemId,
}: {
  orgSlug: string;
  projectId: string;
  specItemId: string;
}) {
  const [rows, setRows] = useState<ComponentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSpecItemComponents(orgSlug, projectId, specItemId).then((res) => {
      if (cancelled) return;
      // Состав приходит из отдельной таблицы, а модель строки шире той, что
      // нужна предпросмотру: лишние поля просто не читаем.
      if (res.success) setRows(res.data as ComponentRow[]);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, projectId, specItemId]);

  const total = useMemo(
    () => (rows ?? []).reduce((sum, r) => sum + costOf(r), 0),
    [rows],
  );

  if (rows === null) {
    return (
      <p className="py-4 text-center text-[12.5px] text-fg-muted">
        {error ?? "Загрузка состава…"}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-4 text-center text-[12.5px] text-fg-muted">
        Состав не заполнен. Группы, компоненты и ссылки на позиции добавляются на
        вкладке «Состав».
      </p>
    );
  }

  const top = rows
    .filter((r) => r.parent_component_id === null)
    .sort(byPosition);
  const childrenOf = (id: string) =>
    rows.filter((r) => r.parent_component_id === id).sort(byPosition);

  const row = (r: ComponentRow, nested: boolean) => (
    <div
      key={r.id}
      className={
        nested
          ? "flex items-baseline gap-3 py-1.5 pl-4"
          : "flex items-baseline gap-3 py-2"
      }
    >
      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
        {nameOf(r)}
      </span>
      {r.kind === "spec_ref" && (
        <span className="shrink-0 font-mono text-[10.5px] text-fg-dim">
          ссылка
        </span>
      )}
      <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-fg-secondary">
        {costOf(r) > 0 ? `${fmt(costOf(r))} ₽` : "—"}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="divide-y divide-border-muted">
        {top.map((r) => {
          if (r.kind !== "group") return row(r, false);
          const children = childrenOf(r.id);
          return (
            <div key={r.id} className="py-1.5">
              <div className="flex items-center gap-2 py-1">
                <FolderOpen className="size-3.5 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">
                  {r.name}
                </span>
                <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-fg-secondary">
                  {children.length > 0
                    ? `${fmt(children.reduce((s, c) => s + costOf(c), 0))} ₽`
                    : "—"}
                </span>
              </div>
              {children.length > 0 && (
                <div className="divide-y divide-border-muted/60">
                  {children.map((c) => row(c, true))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between border-t border-border-muted pt-2">
        <span
          className="flex items-center gap-1.5 text-[12px] text-fg-muted"
          title="Для ссылок на позиции учитывается только дополнительная стоимость: сама позиция уже посчитана в спецификации"
        >
          <Link2 className="size-3" />
          Состав позиции
        </span>
        <span className="font-mono text-[13.5px] font-semibold tabular-nums text-fg">
          {total > 0 ? `${fmt(total)} ₽` : "—"}
        </span>
      </div>
    </div>
  );
}

export default ComponentsPreview;
