/**
 * Марки позиций спецификации («ОТ-03», «М-12»).
 *
 * Нумерация монотонна: берётся максимальный занятый номер для префикса и к
 * нему добавляется единица. «Дыры» от удалённых позиций не заполняются —
 * марка из чертежа не должна переиспользоваться под другой материал.
 *
 * Один источник правды для клиента (`hooks/use-spec-builder.ts`) и сервера
 * (`actions/materials.ts`): правила обязаны совпадать, иначе позиция из
 * конструктора и материал, добавленный из библиотеки, получат одну марку.
 */

/** Номера марок уходят в БД как есть; ограничение — CODE_PATTERN. */
const MAX_CODE_NUMBER = 999;

/**
 * Следующие свободные марки для префикса.
 *
 * @param prefix    Префикс типа позиции без дефиса (`ОТ`, `М`, …).
 * @param usedCodes Коды, уже занятые в проекте (любые, лишние отфильтруются).
 * @param count     Сколько последовательных марок вернуть.
 */
export function nextCodesFrom(
  prefix: string,
  usedCodes: Iterable<string>,
  count = 1,
): string[] {
  const p = prefix.toUpperCase();
  const marker = `${p}-`;

  let max = 0;
  for (const code of usedCodes) {
    if (typeof code !== "string" || !code.startsWith(marker)) continue;
    const n = parseInt(code.slice(marker.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }

  return Array.from({ length: count }, (_, k) => {
    const n = Math.min(max + 1 + k, MAX_CODE_NUMBER);
    return `${p}-${String(n).padStart(2, "0")}`;
  });
}
