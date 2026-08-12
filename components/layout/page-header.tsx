import React from "react";
import PageTitle from "./page-title";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  children,
  className = "",
}: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-[clamp(28px,5vw,48px)] ${className}`}
    >
      <div className="space-y-4">
        <PageTitle>{title}</PageTitle>
        {description && (
          <p className="text-[15px] mt-2 text-pretty text-fg-secondary font-normal">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex items-center gap-3 shrink-0">{children}</div>
      )}
    </div>
  );
}
