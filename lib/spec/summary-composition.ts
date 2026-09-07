/**
 * Отображаемая модель «Состава» для сводки спецификации.
 *
 * Используется тремя потребителями, которые показывают состав одинаково:
 *  - сводка в билдере (drawer, SpecSummary);
 *  - публичная страница /share/spec/[token];
 *  - PDF (lib/spec/pdf-document).
 *
 * Здесь нет служебных полей БД (id, org_id, company_id, contact_id, notes,
 * created_at и т.п.) — только то, что нужно нарисовать. Для kind = 'spec_ref'
 * название берётся из связанного SpecItem (свежее, только для отображения);
 * стоимость исходной позиции сюда не попадает — участвует только
 * additional_cost ссылки.
 */

export type SpecSummaryCompositionNode =
  | { kind: "group"; name: string; children: SpecSummaryCompositionNode[] }
  | { kind: "component"; name: string; cost: number | null }
  | {
      kind: "spec_ref";
      /** Связанный SpecItem доступен (не удалён/недоступен). */
      available: boolean;
      /** Название из связанного SpecItem; null, если позиция недоступна. */
      name: string | null;
      /** Код связанного SpecItem (в клиентской версии не показывается). */
      code: string | null;
      /** Ручная дополнительная сумма ссылки (null = нет доплаты). */
      additional_cost: number | null;
    };

/** Исходная плоская строка состава, из которой строится дерево сводки. */
export type SpecSummaryCompositionSourceRow = {
  id: string;
  kind: "component" | "group" | "spec_ref";
  name: string;
  cost: number | null;
  additional_cost: number | null;
  parent_component_id: string | null;
  ref_spec_item?:
    | { available: true; code?: string | null; name?: string | null }
    | { available: false }
    | null;
};

/** Составы позиций спецификации: spec_item_id → дерево строк для показа. */
export type SpecSummaryCompositions = Record<
  string,
  SpecSummaryCompositionNode[]
>;

/**
 * Собирает плоский список строк состава (верхний уровень + строки групп,
 * связанные через parent_component_id) в дерево для отображения в сводке.
 * Вложенность групп в данных запрещена, поэтому дерево максимум 2 уровня.
 */
export function buildSpecSummaryComposition(
  rows: readonly SpecSummaryCompositionSourceRow[],
): SpecSummaryCompositionNode[] {
  const childrenOf = new Map<string | null, SpecSummaryCompositionSourceRow[]>();
  for (const row of rows) {
    const list = childrenOf.get(row.parent_component_id);
    if (list) list.push(row);
    else childrenOf.set(row.parent_component_id, [row]);
  }

  const walk = (parentId: string | null): SpecSummaryCompositionNode[] =>
    (childrenOf.get(parentId) ?? []).map((row) => {
      if (row.kind === "group") {
        return { kind: "group", name: row.name, children: walk(row.id) };
      }
      if (row.kind === "spec_ref") {
        const ref = row.ref_spec_item;
        const available = ref?.available === true;
        return {
          kind: "spec_ref",
          available,
          name: available ? (ref?.name ?? null) : null,
          code: available ? (ref?.code ?? null) : null,
          additional_cost: row.additional_cost,
        };
      }
      return { kind: "component", name: row.name, cost: row.cost };
    });

  return walk(null);
}
