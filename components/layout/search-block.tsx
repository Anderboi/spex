"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useProjectsUrl } from "@/hooks/use-projects-url";
import { useMediaQuery } from "@/hooks/use-media-query";
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
  /** Свёрнутый на `< sm` поиск: иконка в общем ряду, поле — по тапу. */
  collapsible?: boolean;
  /**
   * Соседние контролы мобильного ряда (категория, кнопка фильтров). Пока поиск
   * свёрнут — рисует их блок `SearchBlock`; когда развёрнут — они убираются, и
   * поле занимает весь ряд. На `sm+` не рендерятся: компонент отдаёт место
   * обычной раскладке тулбара.
   */
  expandedContent?: ReactNode;
}

/**
 * `sm` (40rem) — брейкпоинт свёрнутого поиска. Должен совпадать с классами
 * `sm:hidden` / `hidden sm:flex` на обёртках ниже: JS-ветка (раскрыт ли поиск)
 * и CSS-ветка (какая раскладка видна) обязаны переключаться на одной ширине.
 */
const DESKTOP_QUERY = "(min-width: 40rem)";

/** Метка своего состояния в history: закрытая запись не сворачивает поиск повторно. */
const HISTORY_KEY = "__dshSearchView";

/**
 * Строка поиска раздела.
 *
 * Без `collapsible` — прежнее поведение: поле в потоке тулбара.
 *
 * С `collapsible` на `< sm` поле свёрнуто в иконку, а ряд занимают соседние
 * контролы (`expandedContent`): три фильтра в одну строку на телефоне не
 * помещаются, поэтому разворачивается только то, что нужно прямо сейчас.
 * Раскрытие пишет запись в history, и системное «назад» сворачивает поиск, а не
 * уводит со страницы; запрос при сворачивании не теряется — о нём говорит
 * активная иконка.
 */
export function SearchBlock({
  useSearchUrl = useProjectsUrl,
  placeholder = "Поиск проекта по адресу, клиенту, названию...",
  className,
  collapsible = false,
  expandedContent,
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

  // --- Свёрнутый поиск (mobile-first) -------------------------------------

  const fieldRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const blurTimer = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Ширина, с которой поиск всегда развёрнут: на десктопе иконки-триггера нет.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isExpanded = !collapsible || isDesktop || expanded;
  const showField = isExpanded;
  const showControls = !isExpanded && Boolean(expandedContent);

  /** Раскрытие сразу, а не по клику: иначе задержка 350 мс после blur успела бы
      свернуть поле, которое пользователь только что открыл. */
  const expand = () => {
    if (blurTimer.current !== null) {
      window.clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    setExpanded(true);
    // Запись в history: системное «назад» на телефоне должно закрывать поиск,
    // а не уводить со страницы. `replaceState` при закрытии помечает запись,
    // чтобы повторный вход по «назад» не пытался свернуть уже свёрнутое.
    window.history.pushState(
      { ...window.history.state, [HISTORY_KEY]: "open" },
      "",
      window.location.href,
    );
  };

  const collapse = () => {
    // Прячем клавиатуру сразу: поле исчезнет из разметки. Фокус вернёт эффект
    // ниже — синхронный `focus()` здесь пришёлся бы на ещё скрытую иконку.
    fieldRef.current?.blur();
    setExpanded(false);
    window.history.replaceState(
      { ...window.history.state, [HISTORY_KEY]: "closed" },
      "",
      window.location.href,
    );
  };

  useEffect(() => {
    if (!collapsible || isDesktop) return;

    const onPopState = (event: PopStateEvent) => {
      const state = event.state as Record<string, unknown> | null;
      // Чужая навигация (ушли на другую страницу) — не наше дело.
      if (state?.[HISTORY_KEY] === "open") setExpanded(true);
      else setExpanded(false);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [collapsible, isDesktop]);

  // Фокус при смене состояния: в поле — после раскрытия (в том числе по
  // системному «назад») и после перехода на десктопную ширину, где поле снова в
  // потоке; на иконку — после сворачивания, иначе он уехал бы в `body` и
  // таб-порядок сбился бы. `preventScroll` — чтобы фокус по тапу не дёргал
  // страницу вниз.
  //
  // На монтировании фокус не трогаем: свёрнутый поиск на телефоне открывал бы
  // клавиатуру сразу при заходе на страницу.
  const focusState = useRef<boolean | null>(null);
  useEffect(() => {
    if (focusState.current === null) {
      focusState.current = showField;
      return;
    }
    if (focusState.current === showField) return;
    focusState.current = showField;

    if (showField) {
      const field = fieldRef.current;
      if (field && field !== document.activeElement) {
        field.focus({ preventScroll: true });
      }
      return;
    }
    if (collapsible && !isDesktop) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [showField, isDesktop, collapsible]);

  useEffect(
    () => () => {
      if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
    },
    [],
  );

  return (
    <form
      role="search"
      onSubmit={(event) => {
        // Enter на телефоне = «поиск»: прячем клавиатуру, не перезагружая страницу.
        event.preventDefault();
        fieldRef.current?.blur();
      }}
      className={cn(
        "flex h-10 items-center gap-2",
        // `collapsible`: `< sm` — ряд во всю ширину (соседи живут внутри формы),
        // `sm+` — обычное поле, делящее строку с сортировкой.
        collapsible
          ? "w-full sm:min-w-60 sm:flex-1"
          : "min-w-60 flex-1",
        className,
      )}
    >
      {collapsible && (
        <button
          ref={triggerRef}
          type="button"
          onClick={expand}
          // В свёрнутом виде запрос не виден: без него скринридер не узнал бы,
          // почему список отфильтрован.
          aria-label={
            urlQuery.trim() ? `Поиск, запрос «${urlQuery.trim()}»` : "Поиск"
          }
          aria-expanded={showField}
          className={cn(
            "relative size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-card text-fg-icon transition-colors hover:bg-bg-brand/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring",
            showControls ? "flex sm:hidden" : "hidden",
          )}
        >
          <Search className="size-4" />
          {/* Непустой запрос в свёрнутом виде: без метки список выглядел бы
              отфильтрованным без причины. */}
          {urlQuery.trim().length > 0 && (
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-bg-accent"
            />
          )}
        </button>
      )}

      <div
        className={cn(
          "relative h-10 min-w-0 items-center gap-2 rounded-lg border border-border bg-bg-card px-3 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring",
          showField ? "flex flex-1" : "hidden sm:flex",
        )}
      >
        {busy ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-fg-icon" />
        ) : (
          <Search className="size-4 shrink-0 text-fg-icon" />
        )}
        <input
          ref={fieldRef}
          value={value}
          onChange={(e) => setState({ value: e.target.value, urlQuery })}
          onBlur={() => {
            if (!collapsible) return;
            // Закрываем только пустое поле: иначе сворачивание сразу после тапа
            // (blur успевает прийти раньше click) спрятало бы уже открытый поиск.
            blurTimer.current = window.setTimeout(() => {
              blurTimer.current = null;
              setExpanded((prev) => (value.trim() ? true : prev));
            }, 350);
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          inputMode="search"
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

      {collapsible && (
        <button
          type="button"
          onClick={collapse}
          className={cn(
            "h-10 shrink-0 rounded-lg px-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg",
            showField ? "block sm:hidden" : "hidden",
          )}
        >
          Отмена
        </button>
      )}

      {showControls && expandedContent}
    </form>
  );
}
