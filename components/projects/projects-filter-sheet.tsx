"use client";

import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FilterField } from "@/components/layout/filter-field";
import { useProjectsUrl } from "@/hooks/use-projects-url";
import {
  DEFAULT_PROJECTS_SORT,
  PROJECTS_SORTS,
  PROJECTS_STATUS_OPTIONS,
} from "@/lib/projects/filters";
import { cn } from "@/lib/utils";
import { ProjectsSort } from "./projects-sort";
import { ProjectsStatusFilter } from "./projects-status-filter";

/**
 * Статус и сортировка проектов в нижней шторке (`< sm`).
 *
 * На телефоне в тулбаре остаётся один ряд: свёрнутый поиск и кнопка шторки
 * (ряд рисует сам `SearchBlock`). Два селекта рядом с иконкой поиска не
 * помещаются, поэтому они переезжают сюда — как в библиотеке материалов.
 *
 * Контролы те же, что в тулбаре (`ProjectsStatusFilter`, `ProjectsSort`), только
 * с `side="top"` и во всю ширину: так пункты, подписи и разбор значений в URL
 * живут в одном месте, а не дублируются в шторке. Счётчик активных фильтров
 * читает URL теми же правилами, что и парсер страницы.
 *
 * Изменения применяются сразу (состояние в URL), «Готово» просто закрывает
 * шторку.
 */
export function ProjectsFilterSheet({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();
  const { update } = useProjectsUrl();

  const status = searchParams.get("status");
  const sort = searchParams.get("sort") ?? "";
  const activeCount =
    Number(
      PROJECTS_STATUS_OPTIONS.some((option) => option.value === status),
    ) +
    Number(
      (PROJECTS_SORTS as readonly string[]).includes(sort) &&
        sort !== DEFAULT_PROJECTS_SORT,
    );

  const handleReset = () =>
    update({ status: null, sort: DEFAULT_PROJECTS_SORT });

  return (
    <>
      <Button
        variant="outline"
        className={cn("h-10 shrink-0 gap-2", className)}
        aria-label={
          activeCount > 0
            ? `Фильтры, активно ${activeCount}`
            : "Фильтры и сортировка"
        }
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="size-4" />
        {activeCount > 0 && (
          <span className="flex size-5 items-center justify-center rounded-full bg-bg-accent text-[11px] font-medium text-bg">
            {activeCount}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] gap-0 overflow-y-auto border-t border-border bg-bg-card p-0"
        >
          <SheetHeader className="border-b border-border-subtle p-4 pr-12">
            <SheetTitle>Фильтры и сортировка</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-4 p-4">
            <FilterField label="Статус">
              <ProjectsStatusFilter side="top" className="w-full" />
            </FilterField>

            <FilterField label="Сортировка">
              <ProjectsSort side="top" className="w-full" />
            </FilterField>
          </div>

          <SheetFooter className="flex-row gap-2 border-t border-border-subtle p-4">
            <Button
              size="lg"
              variant="outline"
              className="flex-1"
              onClick={handleReset}
              disabled={activeCount === 0}
            >
              <RotateCcw className="mr-2 size-4" /> Сбросить
            </Button>
            <Button size="lg" className="flex-1" onClick={() => setOpen(false)}>
              Готово
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
