"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useContactsUrl } from "./use-contacts-url";
import { cn } from "@/lib/utils";

export function ContactsSearch({
  placeholder = "Поиск по названию, категории, имени...",
  className,
}: {
  placeholder?: string;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { update, isPending } = useContactsUrl();

  const urlQuery = searchParams.get("query") ?? "";
  const [value, setValue] = useState(urlQuery);
  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery);

  // Синхронизируем инпут при изменении URL извне (навигация Back/Forward).
  if (prevUrlQuery !== urlQuery) {
    setPrevUrlQuery(urlQuery);
    setValue(urlQuery);
  }

  useEffect(() => {
    if (value === urlQuery) return;
    const timer = setTimeout(() => update({ query: value.trim() }), 350);
    return () => clearTimeout(timer);
  }, [value, urlQuery, update]);

  const busy = isPending || value !== urlQuery;

  return (
    <div
      className={cn(
        "relative flex h-10 min-w-60 flex-1 items-center gap-2 rounded-lg border border-border bg-bg-card px-3 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
    >
      {busy ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-fg-icon" />
      ) : (
        <Search className="size-4 shrink-0 text-fg-icon" />
      )}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-muted"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Очистить поиск"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-brand hover:text-fg"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
