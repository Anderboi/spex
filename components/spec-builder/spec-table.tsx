import type { SpecDensity } from "@/hooks/use-spec-density";

/**
 * Раскладка списка позиций проекта.
 *  - `table`   — таблица: единственный вид, где одновременно видны код,
 *                количество, цена и статус;
 *  - `list`    — плотная строка `SpecListRow` (обзор, правка — в детализации);
 *  - `compact` — компактная карточка `SpecCompactCard`;
 *  - `card`    — полная карточка `SpecCard`.
 */
export type SpecListLayout = "table" | "list" | "compact" | "card";

/**
 * Пороги — в пикселях контейнера, а не окна (см. `useContainerWidth`).
 *
 * `928` — минимум для таблицы. Превью материала обязательно к показу, поэтому
 * фиксированные колонки занимают 704px (чекбокс 24, превью 80, марка 56,
 * кол-во 136, цена 112, итого 112, статус 136, действия 48), и наименованию
 * остаётся 224px.
 *
 * `1024` — с этой ширины возвращается «услуги» (доставка, монтаж, доп. расходы
 * по позиции): колонка стоит 96px, и при ней 800px фиксированных колонок всё
 * ещё оставляют наименованию те же 224px.
 *
 * `640` — ниже этого строка-обзор перестаёт помещаться: марка, наименование и
 * сумма конкурируют за место, поэтому отдаём выбор карточкам и их плотности.
 */
export const SPEC_TABLE_MIN_CONTAINER = 928;
export const SPEC_SERVICES_MIN_CONTAINER = 1024;
export const SPEC_LIST_MIN_CONTAINER = 640;

export function resolveSpecListLayout(
  containerWidth: number,
  density: SpecDensity,
): SpecListLayout {
  if (containerWidth >= SPEC_TABLE_MIN_CONTAINER) return "table";
  if (containerWidth >= SPEC_LIST_MIN_CONTAINER) return "list";
  // `row` — та же плотная строка, что и `list`: раскладки совпадают.
  return density === "row" ? "list" : density;
}

/** Видимость необязательной колонки «услуги» на текущей ширине контейнера. */
export function showsServices(containerWidth: number): boolean {
  return containerWidth >= SPEC_SERVICES_MIN_CONTAINER;
}

/**
 * Таблица позиций. `table-fixed` держит ширины колонок стабильными, а «пол»
 * для наименования задаётся не классом, а `min-width` из
 * `SPEC_TABLE_MIN_CONTAINER` (см. `group-section.tsx`): в fixed-раскладке
 * `min-width` на ячейке игнорируется по спецификации CSS, а произвольный
 * `min-w-[...]` пришлось бы держать синхронным с порогом вручную.
 */
export const SPEC_TABLE_CLASS = "w-full table-fixed";

/**
 * Обёртка таблицы: `overflow-x-auto` — страховка на случай, когда таблица всё
 * же шире контейнера (зум, крупный минимальный шрифт браузера, будущие
 * колонки). Область фокусируемая, иначе с клавиатуры до правых колонок не
 * добраться.
 *
 * Видимость необязательных колонок решается в JS по замеру контейнера, а не
 * container queries (`hidden @[64rem]:table-cell`): поддержка range-синтаксиса
 * в `@container` есть не во всех браузерах, а промах сборки по новому файлу
 * оставляет колонку скрытой навсегда. Ширина контейнера уже измерена для
 * выбора раскладки, поэтому один замер обслуживает и её, и колонки.
 */
export const SPEC_TABLE_SCROLL =
  "overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fg-brand";
