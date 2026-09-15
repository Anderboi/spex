"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Шаг округления замера: раскладка меняется только на порогах (640/896), а
 *  `ResizeObserver` при перетаскивании края окна срабатывает каждый кадр. */
const STEP = 16;

/**
 * Ширина контейнера (`clientWidth`) с подпиской на `ResizeObserver`.
 *
 * Список позиций выбирает раскладку по фактической ширине контента, а не по
 * ширине окна: сайдбар сворачивается (⌘/Ctrl+B) и помнит состояние в cookie
 * `sidebar_state`, поэтому при одном и том же viewport контенту достаётся от
 * `100vw − 336px` (открытый сайдбар 256px + отступы страницы 80px) до
 * `100vw − 128px` (сайдбар свёрнут в иконки). Media query на таком разбросе
 * врёт: 1280px окна — это и 944px контента, и 1152px.
 *
 * Первый замер — в layout-эффекте, то есть до отрисовки: серверная разметка и
 * первый клиентский рендер совпадают («узкая» раскладка), а таблица встаёт на
 * место без вспышки карточек.
 */
export function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      // Округляем вниз: решение «таблица влезает» принимается по значению не
      // больше реальной ширины, поэтому таблица не появится раньше, чем ей
      // действительно хватает места (см. SPEC_TABLE_MIN_CONTAINER).
      setWidth(Math.floor(node.clientWidth / STEP) * STEP);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
