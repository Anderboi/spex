import { SearchBlock } from "../layout/search-block";
import { ProjectsStatusFilter } from "./projects-status-filter";
import { ProjectsSort } from "./projects-sort";
import { ProjectsFilterSheet } from "./projects-filter-sheet";

/**
 * Тулбар списка проектов.
 *
 * `sm+` — как раньше: поиск, статус и сортировка в одной переносящейся строке.
 * Обёртка с `hidden sm:contents` нужна именно такой: `contents` убирает её из
 * раскладки, и оба контрола становятся прямыми flex-элементами строки (как
 * раньше), а `hidden` прячет их на телефоне, где они переехали в шторку.
 *
 * `< sm` — один ряд: свёрнутый поиск и кнопка шторки (ряд рисует сам
 * `SearchBlock` — он же убирает кнопку, пока развёрнуто поле). Статус и
 * сортировка переезжают в нижнюю шторку — как в библиотеке материалов и
 * каталоге контактов.
 */
export function ProjectsToolbar() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SearchBlock
        placeholder="Поиск проекта по адресу, клиенту, названию..."
        collapsible
        expandedContent={<ProjectsFilterSheet className="sm:hidden" />}
      />
      <div className="hidden sm:contents">
        <ProjectsStatusFilter />
        <ProjectsSort />
      </div>
    </div>
  );
}
