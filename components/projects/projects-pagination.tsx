"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const base =
  "flex size-9 items-center justify-center rounded-lg border text-sm font-medium transition-colors";
const idle = "border-border bg-bg-card text-fg hover:bg-bg-brand/50";
const active = "border-bg-accent bg-bg-accent text-bg";
const disabled = "cursor-not-allowed border-border bg-bg-card text-fg-muted opacity-50";

function pageNumbers(current: number, total: number): (number | "ellipsis")[] {
  const pages: (number | "ellipsis")[] = [];
  const start = Math.max(1, current - 1);
  const end = Math.min(total, current + 1);

  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push("ellipsis");
  }
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total) {
    if (end < total - 1) pages.push("ellipsis");
    pages.push(total);
  }
  return pages;
}

export function ProjectsPagination({
  page,
  pageCount,
}: {
  page: number;
  pageCount: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pageCount <= 1) return null;

  const href = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) params.delete("page");
    else params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <nav
      aria-label="Пагинация"
      className="mt-6 flex items-center justify-center gap-1"
    >
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          aria-label="Предыдущая страница"
          className={cn(base, idle)}
        >
          <ChevronLeft className="size-4" />
        </Link>
      ) : (
        <span aria-disabled className={cn(base, disabled)}>
          <ChevronLeft className="size-4" />
        </span>
      )}

      {pageNumbers(page, pageCount).map((p, i) =>
        p === "ellipsis" ? (
          <span key={`e-${i}`} className="px-1 text-fg-muted">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            className={cn(base, p === page ? active : idle)}
          >
            {p}
          </Link>
        ),
      )}

      {page < pageCount ? (
        <Link
          href={href(page + 1)}
          aria-label="Следующая страница"
          className={cn(base, idle)}
        >
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span aria-disabled className={cn(base, disabled)}>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
