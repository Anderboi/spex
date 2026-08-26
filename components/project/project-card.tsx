"use client";

import { COVER_PALETTE, STATUS_CONFIG, TYPE_COLORS } from "@/lib/constants";
import { fmtDate, plural } from "@/lib/utils";
import type { ProjectListItem } from "@/lib/queries";
import { ProjectStatus } from "@/lib/validations";
import Link from "next/link";
import Image from "next/image";
import { MouseEvent } from "react";
import { Button } from "../ui/button";
import { Edit, Trash } from "lucide-react";

export function ProjectCard({
  orgSlug,
  project,
  index,
}: {
  orgSlug: string;
  project: ProjectListItem;
  index: number;
}) {
  const coverBg = COVER_PALETTE[index % COVER_PALETTE.length];
  const currentStatus: ProjectStatus = project.status ?? "active";
  const st = STATUS_CONFIG[currentStatus] ??
    STATUS_CONFIG.active ?? {
      label: currentStatus,
      dot: "bg-bg-green",
    };

  const handleEdit = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Логика открытия модального окна редактирования / переход
  };

  const handleDelete = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Логика удаления проекта
  };

  return (
    <Link
      href={`/${orgSlug}/projects/${project.id}`}
      className="group block bg-bg-card border border-border-muted rounded-xl overflow-hidden transition-shadow duration-200 hover:shadow-[0_8px_32px_rgba(27,26,23,.08)]"
    >
      {/* Cover */}
      <div
        className={`relative h-60 ${coverBg} flex items-end p-5 overflow-hidden group`}
      >
        <div className="absolute z-20 top-3 right-3 /left-2 transition-all gap-2 hidden duration-200 group-hover:flex">
          <Button
            variant="outline"
            className="size-10 opacity-50 hover:bg-bg-white rounded-full hover:border-none  hover:opacity-100"
            size="icon-lg"
            onClick={handleEdit}
          >
            <Edit size={20} />
          </Button>
          <Button
            variant="outline"
            className="size-10 opacity-50 hover:bg-bg-red-light hover:border-none rounded-full hover:text-fg-red hover:opacity-100"
            size="icon-lg"
            onClick={handleDelete}
          >
            <Trash size={20} />
          </Button>
        </div>
        {project.cover_url ? (
          <Image
            loading="lazy"
            src={project.cover_url}
            alt={project.title || "Обложка проекта"}
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover"
          />
        ) : (
          <svg
            className="absolute -top-6 -right-6 size-48 text-bg-white opacity-[.14] pointer-events-none"
            viewBox="0 0 200 200"
            fill="none"
          >
            <circle
              cx="100"
              cy="100"
              r="96"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle
              cx="100"
              cy="100"
              r="68"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle
              cx="100"
              cy="100"
              r="40"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="100"
              y1="0"
              x2="100"
              y2="200"
              stroke="currentColor"
              strokeWidth="1"
            />
            <line
              x1="0"
              y1="100"
              x2="200"
              y2="100"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
        <span
          className={`relative z-1 inline-flex items-center rounded-[10px] py-1.5 px-3.5 font-mono text-[11px] font-semibold tracking-[.04em] uppercase ${
            TYPE_COLORS[project.type] ?? "bg-bg-accent text-bg"
          }`}
        >
          {project.type || "Интерьер"}
        </span>
      </div>

      {/* Body */}
      <div className="p-5 pt-4">
        <h3 className="text-[19px] font-bold text-fg tracking-[-.01em] leading-[1.15] mb-3">
          {project.title || "Новый проект"}
        </h3>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {/* <div> //TODO: add items
            <div className="font-mono text-[17px] font-semibold text-fg leading-none">
              {project.items ?? 0}
            </div>
            <div className="text-[11.5px] text-fg-muted mt-1 leading-tight">
              {plural(project.items ?? 0, "позиция", "позиции", "позиций")}
            </div>
          </div> */}
          <div>
            <div className="font-mono text-[17px] font-semibold text-fg leading-none truncate">
              {project.rooms.length}
            </div>
            <div className="text-[11px] font-mono capitalize text-fg-muted mt-1 leading-tight">
              {plural(
                project.rooms.length,
                "помещение",
                "помещения",
                "помещений",
              )}
            </div>
          </div>
          <div>
            <div className="font-mono text-[17px] font-semibold text-fg leading-none truncate">
              {/* {fmtRub(project.budget)} */}
              {project.budget.toLocaleString("ru-RU").replace(/,/g, "\u2009") +
                "₽"}
            </div>
            <div className="text-[11px] font-mono capitalize text-fg-muted mt-1 leading-tight">
              Бюджет
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full flex-none ${st.dot}`} />
            <span className="text-[13px] text-fg-secondary font-medium">
              {st.label}
            </span>
          </div>
          {/* //TODO: add date */}
          <span className="font-mono text-[11px] text-fg-muted tracking-[.02em]">
            {project.updated_at ? fmtDate(project.updated_at) : "—"}
          </span>
        </div>

        {/* Hover actions — заменены теги <button> на роли role="button" в <div> */}
        {/* <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <div
            role="button"
            tabIndex={0}
            onClick={handleEdit}
            className="flex-1 flex items-center justify-center gap-1.5 bg-bg-toggle text-fg border-none rounded-[10px] py-2.5 px-3 font-sans text-[13px] font-semibold cursor-pointer hover:bg-bg-select transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 10.5V12h1.5l7.37-7.37-1.5-1.5L2 10.5zM12.71 4.04a.5.5 0 000-.71l-.79-.79a.5.5 0 00-.71 0l-.73.73 1.5 1.5.73-.73z"
                fill="currentColor"
              />
            </svg>
            Ред.
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-label="Удалить"
            onClick={handleDelete}
            className="flex items-center justify-center w-9 h-9 rounded-[10px] border-none bg-bg-toggle text-fg-secondary cursor-pointer hover:bg-bg-red-light hover:text-fg-red transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M4.5 1.5h5M1.5 3.5h11M5.5 5.5v6M8.5 5.5v6M3.5 3.5l.5 9h6l.5-9"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div> */}
      </div>
    </Link>
  );
}
