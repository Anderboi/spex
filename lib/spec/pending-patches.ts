import type { SpecItemFillOrigin } from "./history";
import type { SpecItemPatch } from "../types";

/**
 * Очередь отложенных патчей позиции — чистая часть `useSpecPersistence`.
 *
 * Логика вынесена из хука, потому что хук импортирует server action, а тот
 * тянет `server-only`: в vitest такой модуль не загрузить. Здесь же — только
 * слияние и выдача очереди, поэтому склейку серии правок (`1 → 2 → … → 6`)
 * можно проверить тестом, а не UI-тестом на пять кликов.
 *
 * Ключ очереди — `spec_item_id`: патчи разных позиций не сливаются и не
 * блокируют друг друга.
 */

export type PendingPatchEntry = {
  /** Накопленный патч позиции: поля объединяются, последнее значение выигрывает. */
  patch: SpecItemPatch;
  /**
   * Серия содержит явную правку количества.
   *
   * Нужен, чтобы `saveSpecItemPatch` записал событие истории: составные жесты
   * (ручное заполнение заглушки) тоже меняют `qty`, но приходят без пометки и
   * события не порождают.
   */
  explicitQuantity: boolean;
  /**
   * Серия содержит явную правку поставщика (компания и/или менеджер).
   *
   * Тот же смысл, что у количества, но помечается отдельно: домены независимы,
   * и один патч может быть явным по одному полю и составным по другому.
   */
  explicitSupplier: boolean;
  /**
   * Патч составного жеста — заполнение заглушки или очистка позиции.
   *
   * Такой жест пишет сразу много обычных полей, но их изменение — часть
   * `filled` / `cleared`, а не самостоятельная правка. Пометка ставится явно
   * вызывающим, а не выводится из набора полей: угадывание по составу патча
   * было бы хрупким.
   */
  composite: boolean;
  /**
   * Составной жест — заполнение заглушки. Значение отличает заполнение из
   * библиотеки и ручное от отмены очистки; `clearContent` этой пометки не
   * ставит.
   *
   * Ставится всегда вместе с `composite`: подавление полевых событий и выбор
   * lifecycle-события — две стороны одного жеста.
   */
  fillOrigin?: SpecItemFillOrigin;
  /**
   * Составной жест — очистка позиции. Отдельная пометка от `fillOrigin`:
   * очистка не заполняет, и её событие другое.
   */
  cleared?: boolean;
};

export type PendingPatches = ReadonlyMap<string, PendingPatchEntry>;

export type PendingPatchOptions = {
  explicitQuantity?: boolean;
  explicitSupplier?: boolean;
  composite?: boolean;
  fillOrigin?: SpecItemFillOrigin;
  cleared?: boolean;
};

/**
 * Слить патч в очередь. Возвращает новую очередь — вызывающий заменяет ею
 * текущую, поэтому случайное изменение «на месте» невозможно.
 *
 * Пометки накапливаются по «ИЛИ»: если в серии была хоть одна явная правка
 * домена, вся серия считается явной — иначе клик «+», поглощённый следующей
 * правкой другого поля, потерял бы событие.
 */
export function mergePendingPatch(
  queue: PendingPatches,
  id: string,
  patch: SpecItemPatch,
  options: PendingPatchOptions = {},
): Map<string, PendingPatchEntry> {
  const prev = queue.get(id);

  return new Map(queue).set(id, {
    patch: { ...prev?.patch, ...patch },
    explicitQuantity: Boolean(
      prev?.explicitQuantity || options.explicitQuantity,
    ),
    explicitSupplier: Boolean(
      prev?.explicitSupplier || options.explicitSupplier,
    ),
    composite: Boolean(prev?.composite || options.composite),
    // Первое значение побеждает: заполнение в серии одно, и именно его
    // происхождение должно попасть в событие, даже если следом в ту же серию
    // добавилась правка другого поля.
    fillOrigin: prev?.fillOrigin ?? options.fillOrigin,
    cleared: Boolean(prev?.cleared || options.cleared),
  });
}

/**
 * Забрать очередь к отправке и очистить её: после этого следующая правка
 * начинает новую серию (то есть новую mutation и новое событие).
 */
export function takePendingPatches(
  queue: Map<string, PendingPatchEntry>,
): [string, PendingPatchEntry][] {
  const batch = [...queue.entries()];
  queue.clear();
  return batch;
}
