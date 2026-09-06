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

/**
 * Безопасно меняет parentId у одной позиции, не трогая остальные.
 *
 * Валидные операции:
 * - parentId === null → позиция становится корневой;
 * - parentId — существующая позиция, назначение которой не создаёт цикл
 *   (новый родитель не должен находиться в подчинении перемещаемого элемента).
 *
 * Невалидная операция (нет позиции itemId, parentId указывает на саму себя,
 * на отсутствующую позицию или на потомка) ничего не меняет и возвращает
 * исходный массив (ту же ссылку). Пустая операция (parentId уже такой же)
 * тоже возвращает исходный массив.
 *
 * Иммутабельность: исходный массив и его элементы не мутируются; при успехе
 * возвращается новый массив, у которого заменён только объект позиции itemId.
 */
export function setSpecItemParent(
  items: SpecItem[],
  itemId: string,
  parentId: string | null,
): SpecItem[] {
  const target = items.find((i) => i.id === itemId);
  if (!target || target.parentId === parentId) return items;

  if (parentId !== null) {
    if (parentId === itemId) return items;
    const parent = items.find((i) => i.id === parentId);
    if (!parent) return items;

    // Цикл: если цепочка parentId от будущего родителя уже достигает
    // перемещаемой позиции, линк itemId → parentId замкнёт дерево.
    const byId = new Map(items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    let cur: SpecItem | undefined = parent;
    while (cur && cur.id !== itemId && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    if (cur?.id === itemId) return items;
  }

  return items.map((i) => (i.id === itemId ? { ...i, parentId } : i));
}

/**
 * Множество id, которые нельзя назначать родителем для позиции itemId:
 * сама позиция и все её потомки (прямые и транзитивные). Кандидат, дающий
 * цикл, — это в точности потомок перемещаемой позиции: назначив его родителем,
 * мы замкнули бы дерево (ср. проверку в setSpecItemParent).
 *
 * Исходный массив не мутируется; порядок не важен, возвращается Set.
 */
export function collectForbiddenParentIds(
  items: SpecItem[],
  itemId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const it of items) {
    if (!it.parentId) continue;
    const children = childrenOf.get(it.parentId);
    if (children) children.push(it.id);
    else childrenOf.set(it.parentId, [it.id]);
  }

  const forbidden = new Set<string>([itemId]);
  const stack = [itemId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const child of childrenOf.get(cur) ?? []) {
      if (forbidden.has(child)) continue;
      forbidden.add(child);
      stack.push(child);
    }
  }
  return forbidden;
}

