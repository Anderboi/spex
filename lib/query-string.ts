/** Значение searchParams-пропа страницы App Router. */
export type SearchParamsInput = Record<
  string,
  string | string[] | undefined
>;

/**
 * Одно значение search-параметра. Массив приходит, когда параметр повторён
 * в URL (`?id=a&id=b`); для фильтров и диалогов осмысленен только первый.
 */
export function singleParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Строит URL из базового пути, текущих search params и патча.
 * Существующие параметры сохраняются; `null` в патче удаляет параметр.
 *
 * Используется на сервере (страницы), где нет `useSearchParams`, чтобы
 * открывать диалоги по ссылке, не сбрасывая фильтры и пагинацию.
 *
 * @example
 * withSearchParams("/org/materials", { page: "2", query: "пол" }, { action: "create" })
 * // → "/org/materials?page=2&query=пол&action=create"
 */
export function withSearchParams(
  base: string,
  sp: SearchParamsInput,
  patch: Record<string, string | null>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
