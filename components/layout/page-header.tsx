import React from "react";
import PageTitle from "./page-title";
import { SidebarTrigger } from "../ui/sidebar";

interface PageHeaderProps {
  title: string;
  children?: React.ReactNode;
  className?: string;
  editButton?: React.ReactNode;
}

export function PageHeader({
  title,
  children,
  className,
  editButton,
}: PageHeaderProps) {
  return (
    <header className={`flex flex-col py-2 ${className}`}>
      <div className="flex h-10 shrink-0 items-center gap-2">
        <SidebarTrigger />
      </div>
      <div
        className={`flex flex-col sm:flex-row sm:items-end //pb-4 sm:justify-between gap-4 //pt-[clamp(28px,5vw,48px)] `}
      >
        <div className="flex items-end">
          <PageTitle>{title}</PageTitle>
          {editButton && <div className="ml-2">{editButton}</div>}
        </div>
        {children && (
          <div className="flex items-center gap-3 shrink-0">{children}</div>
        )}
      </div>
    </header>
  );
}
