"use client";
import { useCallback, useState } from "react";

export function useUrlFilter(paramName: string, fallback: string) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return fallback;
    return (
      new URLSearchParams(window.location.search).get(paramName) ?? fallback
    );
  });

  const update = useCallback(
    (next: string) => {
      setValue(next);
      const params = new URLSearchParams(window.location.search);
      if (next && next !== fallback) params.set(paramName, next);
      else params.delete(paramName);
      const qs = params.toString();
      // нативный History API: URL меняется, RSC-рефетча нет
      window.history.replaceState(
        null,
        "",
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
      );
    },
    [paramName, fallback],
  );

  return [value, update] as const;
}
