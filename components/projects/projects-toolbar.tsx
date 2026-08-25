import { SearchBlock } from "../layout/search-block";
import { ProjectsStatusFilter } from "./projects-status-filter";
import { ProjectsSort } from "./projects-sort";

export function ProjectsToolbar() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SearchBlock
        className="min-w-60 flex-1"
        placeholder="Поиск проекта по адресу, клиенту, названию..."
      />
      <ProjectsStatusFilter />
      <ProjectsSort />
    </div>
  );
}
