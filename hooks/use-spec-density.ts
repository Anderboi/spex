"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Плотность списка позиций на узких экранах:
 *  - `row`     — строка, на месте превью марка (максимум позиций на экране);
 *  - `compact` — компактная карточка с превью и правкой количества;
 *  - `card`    — полная карточка (текущее поведение, значение по умолчанию).
 */
export type SpecDensity = "row" | "compact" | "card";

export const SPEC_DENSITY_STORAGE_KEY = "spectrack:spec-density";

const DENSITIES: readonly SpecDensity[] = ["row", "compact", "card"];
const CHANGE_EVENT = "spectrack:spec-density-change";
const DEFAULT_DENSITY: SpecDensity = "card";

/** Настройка вида, а не фильтр данных: живёт в localStorage, а не в URL,
 *  чтобы ссылка на спецификацию не навязывала чужому устройству плотность. */
function readDensity(): SpecDensity {
  try {
    const raw = localStorage.getItem(SPEC_DENSITY_STORAGE_KEY);
    return DENSITIES.includes(raw as SpecDensity)
      ? (raw as SpecDensity)
      : DEFAULT_DENSITY;
  } catch {
    // Приватный режим / отключённое хранилище — работаем на дефолте.
    return DEFAULT_DENSITY;
  }
}

/** Событие `storage` приходит из других вкладок, CHANGE_EVENT — из этой же. */
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useSpecDensity() {
  // На сервере и в первом рендере — дефолт, поэтому гидратация совпадает;
  // выбранная плотность применяется сразу после подписки (как в useMediaQuery).
  const density = useSyncExternalStore(
    subscribe,
    readDensity,
    () => DEFAULT_DENSITY,
  );

  const setDensity = useCallback((next: SpecDensity) => {
    try {
      localStorage.setItem(SPEC_DENSITY_STORAGE_KEY, next);
    } catch {
      // Игнорируем: вид всё равно применится на текущей странице.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { density, setDensity };
}
