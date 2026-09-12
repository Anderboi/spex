"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useProjectsUrl } from "@/hooks/use-projects-url";
import { cn } from "@/lib/utils";

/** Минимальный контракт URL-хука раздела, достаточный для строки поиска. */
type SearchUrlHook = () => {
  update: (patch: { query: string }) => void;
  isPending: boolean;
};

interface SearchBlockProps {
  /**
   * Хук URL-обновления того раздела, в котором стоит поиск. Раньше компонент
   * жёстко использовал `useProjectsUrl`, из-за чего поиск в контактах и
   * материалах обновлял URL через парсер фильтров проектов и брал чужой
   * `isPending`. Значение по умолчанию — для страницы проектов.
   */
  useSearchUrl?: SearchUrlHook;
  placeholder?: string;
  className?: string;
}

export function SearchBlock({
  useSearchUrl = useProjectsUrl,
  placeholder = "Поиск проекта по адресу, клиенту, названию...",
  className,
}: SearchBlockProps) {
  const { update, isPending } = useSearchUrl();
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get("query") ?? "";

  // Производное состояние вместо setState в эффекте: пока URL не изменился
  // извне, источник истины для поля — то, что ввёл пользователь.
  const [state, setState] = useState({ value: urlQuery, urlQuery });
  if (state.urlQuery !== urlQuery) {
    setState({ value: urlQuery, urlQuery });
  }

  const value = state.value;

  /** Последний запрос, который мы сами отправили в URL. Нужен, чтобы отложенный
      сброс не перебивал внешнее изменение URL (например, клик по чипу категории). */
  const sentQuery = useRef<string | null>(null);

  useEffect(() => {
    const query = value.trim();

    if (query === urlQuery) {
      // URL догнал поле — отложенный сброс больше не нужен.
      sentQuery.current = query;
      return;
    }

    if (sentQuery.current === query) {
      // Значение уже отправлено (или URL изменился независимо от нас) — не дублируем навигацию.
      return;
    }

    const timer = setTimeout(() => {
      sentQuery.current = query;
      update({ query });
    }, 350);

    return () => clearTimeout(timer);
  }, [value, urlQuery, update]);

  /** Очистка применяется сразу: ждать дебаунс на явное действие незачем. */
  const handleClear = () => {
    sentQuery.current = "";
    setState({ value: "", urlQuery });
    update({ query: "" });
  };

  const busy = isPending || value.trim() !== urlQuery;

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
        onChange={(e) => setState({ value: e.target.value, urlQuery })}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        className="min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-muted"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Очистить поиск"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-brand hover:text-fg"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
