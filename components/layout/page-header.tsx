import React from "react";
import PageTitle from "./page-title";
import { SidebarTrigger } from "../ui/sidebar";

interface PageHeaderProps {
  title: string;
  children?: React.ReactNode;
  className?: string;
  editButton?: React.ReactNode;
  /** Хлебные крошки (`PageBreadcrumbs`) — рендерятся в строке с `SidebarTrigger`. */
  breadcrumbs?: React.ReactNode;
}

export function PageHeader({
  title,
  children,
  className,
  editButton,
  breadcrumbs,
}: PageHeaderProps) {
  return (
    <header className={`flex flex-col py-2 ${className}`}>
      <div className="flex h-10 shrink-0 items-center gap-2">
        <SidebarTrigger />
        {breadcrumbs && <div className="min-w-0 flex-1">{breadcrumbs}</div>}
      </div>
      {/* Заголовок и действия. На узких экранах действия переносятся на
          следующую строку (`flex-wrap` + `gap-y`), а не выдавливают контент
          за вьюпорт, где его обрезает `overflow-x-hidden` контейнера. */}
      <div
        className={`flex flex-row //flex-wrap items-end justify-between gap-x-4 gap-y-3 //pt-[clamp(28px,5vw,48px)] `}
      >
        <div className="flex min-w-0 items-end">
          <PageTitle >{title}</PageTitle>
          {editButton && <div className="ml-2 shrink-0">{editButton}</div>}
        </div>
        {children && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {children}
          </div>
        )}
      </div>
    </header>
  );
}
