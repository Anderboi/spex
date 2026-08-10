"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Search, ArrowUpDown, X, Loader2 } from "lucide-react";

interface SearchSortBarProps {
  /** Плейсхолдер для инпута */
  placeholder?: string;
  /** Имя URL-параметра для поиска (по умолчанию 'q') */
  searchParamKey?: string;
  /** Опции для сортировки (например, [{ label: 'По названию', value: 'name' }, ...]) */
  sortOptions?: { label: string; value: string }[];
  /** Имя URL-параметра для сортировки (по умолчанию 'sort') */
  sortParamKey?: string;
  /** Дополнительные CSS классы */
  className?: string;
}

export function SearchSortBar({
  placeholder = "Поиск...",
  searchParamKey = "q",
  sortOptions = [],
  sortParamKey = "sort",
  className = "",
}: SearchSortBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isPending, startTransition] = useTransition();

  // Локальное состояние инпута для мгновенного отклика UI
  const paramValue = searchParams.get(searchParamKey) || "";
  const [inputValue, setInputValue] = useState(paramValue);

  // Синхронизируем локальное состояние, если URL изменился извне (например, при клике Назад в браузере)
  useEffect(() => {
    setInputValue(paramValue);
  }, [paramValue]);

  // Вспомогательная функция обновления URL параметров
  const createQueryString = useCallback(
    (name: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      return params.toString();
    },
    [searchParams],
  );

  // Дебаунс обновления URL (300мс)
  useEffect(() => {
    // Если локальное значение совпадает с URL, ничего не делаем
    if (inputValue === paramValue) return;

    const timer = setTimeout(() => {
      startTransition(() => {
        const queryString = createQueryString(
          searchParamKey,
          inputValue.trim(),
        );
        router.replace(`${pathname}?${queryString}`, { scroll: false });
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [
    inputValue,
    paramValue,
    searchParamKey,
    createQueryString,
    pathname,
    router,
  ]);

  // Очистка поиска
  const handleClear = () => {
    setInputValue("");
    startTransition(() => {
      const queryString = createQueryString(searchParamKey, null);
      router.replace(`${pathname}?${queryString}`, { scroll: false });
    });
  };

  // Переключение сортировки
  const currentSort = searchParams.get(sortParamKey) || "";

  const handleSortChange = (nextValue: string) => {
    startTransition(() => {
      const queryString = createQueryString(sortParamKey, nextValue || null);
      router.replace(`${pathname}?${queryString}`, { scroll: false });
    });
  };

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {/* Поле поиска */}
      <div className="relative flex-1 min-w-60 h-10 flex items-center gap-2 bg-bg-card border border-border rounded-lg px-3 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
        {isPending ? (
          <Loader2 className="size-4 animate-spin text-fg-icon shrink-0" />
        ) : (
          <Search className="size-4 text-fg-icon shrink-0" />
        )}

        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-muted min-w-0"
        />

        {inputValue.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Очистить поиск"
            className="flex shrink-0 items-center justify-center size-6 rounded-md  text-fg-muted hover:bg-bg-brand hover:text-fg transition-colors"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Селект/Кнопка сортировки (если переданы options) */}
      {sortOptions.length > 0 && (
        <div className="relative inline-flex items-center">
          <select
            value={currentSort}
            onChange={(e) => handleSortChange(e.target.value)}
            className="h-10 appearance-none bg-bg-card border border-border rounded-lg pl-3 pr-6 text-xs font-mono text-fg cursor-pointer outline-none hover:bg-bg-brand/50 transition-colors"
          >
            <option value="">Сортировка по умолчанию</option>
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ArrowUpDown className="pointer-events-none absolute right-2.5 size-3.5 text-fg-muted" />
        </div>
      )}
    </div>
  );
}
