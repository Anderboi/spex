import type { SpecItem } from "../types";

/* ------------------------------------------------------------------ */
/*  Иерархия по parentId                                                */
/* ------------------------------------------------------------------ */

/** Позиция в иерархии: исходные поля SpecItem + ссылки на детей. */
export type SpecTreeNode = SpecItem & {
  children: SpecTreeNode[];
};

/**
 * Строит дерево из плоского списка позиций спецификации.
 *
 * Правила:
 * - parentId === null → узел попадает в корневой список;
 * - parentId указывает на отсутствующую позицию или на саму себя →
 *   узел не теряется и остаётся в корневом списке;
 * - циклы в parentId (A → B → A) безопасны: участники цикла остаются
 *   на верхнем уровне, построение не зацикливается;
 * - корни и дети сохраняют порядок исходного массива;
 * - входной массив не мутируется: узлы копируются.
 *
 * Сложность детекта циклов O(n²) в худшем случае (подъём по parentId
 * с защитой от повторного посещения), приемлемо для размеров спецификации.
 */
export function buildSpecTree(items: SpecItem[]): SpecTreeNode[] {
  const nodes: SpecTreeNode[] = items.map((it) => ({ ...it, children: [] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const claimed = new Set<SpecTreeNode>();

  /** Достижим ли target из from, поднимаясь по parentId вверх. */
  const reaches = (from: SpecTreeNode, target: SpecTreeNode): boolean => {
    const seen = new Set<string>();
    let cur: SpecTreeNode | undefined = from;
    while (cur && cur !== target && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return cur === target;
  };

  for (const node of nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;

    // нет родителя / родитель не найден / самоссылка / цикл → узел корневой
    if (!parent || parent === node || reaches(parent, node)) continue;

    parent.children.push(node);
    claimed.add(node);
  }

  return nodes.filter((n) => !claimed.has(n));
}
