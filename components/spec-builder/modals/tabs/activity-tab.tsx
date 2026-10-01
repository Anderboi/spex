"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import ActivityComment from "../activity/activity-comment";
import ActivityDateSeparator from "../activity/activity-date-separator";
import ActivityEvent from "../activity/activity-event";
import { getSpecItemActivity } from "@/actions/spec-activity";
import {
  ACTIVITY_SKELETON_COUNT,
  type ActivityCursor,
  type ActivityFeedPage,
  type ActivityRecord,
} from "@/lib/spec/activity-types";
import { buildActivityFeed } from "@/lib/spec/activity-view";

/**
 * Вкладка «Комментарии»: read-only лента активности позиции.
 *
 * ── Что здесь есть ─────────────────────────────────────────────────────────
 *
 * Только чтение, скролл и раскладка. Записи приходят с сервера одной страницей
 * (`getSpecItemActivity`), порядок `createdAt DESC, id DESC`, то есть новые
 * сверху, а клиент их НЕ пересортировывает: сервер — единственный источник
 * истины и порядка. «Показать ещё» догружает более старые записи и дописывает
 * их в конец — лента растёт вниз, `scrollTop` не меняется, поэтому читаемая
 * позиция не прыгает.
 *
 * ── Разделение ответственности ─────────────────────────────────────────────
 *
 * Этот файл отвечает за данные и состояния: загрузка, ошибка, пусто,
 * пагинация, скролл-контейнер. Оформление вынесено:
 *
 *   * `lib/spec/activity-format.ts` — 21 вид событий, словарь полей, даты,
 *     значения (чистые функции, покрыты unit-тестами);
 *   * `lib/spec/activity-view.ts` — разделители дней и ветки ответов;
 *   * `components/.../activity/*` — `Marker` для событий, `Message` для
 *     комментариев.
 *
 * ── Скролл ─────────────────────────────────────────────────────────────────
 *
 * Контейнер — `MessageScroller` (не `ScrollArea`): он даёт вьюпорт с
 * `overflow-y-auto`, а `MessageScrollerItem` — будущие точки привязки
 * (`data-message-id` / `scroll-anchor`). Chat-механика намеренно выключена:
 * `autoScroll` не передаём, якорь не ставим, кнопок перехода к концу и
 * «непрочитанных» нет. `defaultScrollPosition="start"` фиксирует старт сверху —
 * лента живёт в порядке «новые → старые».
 *
 * ── Состояния ──────────────────────────────────────────────────────────────
 *
 * Загрузка не хранится отдельным флагом: `loadedKey` — это позиция, для
 * которой пришли данные. Пока он не совпадает с текущей, рендерится skeleton,
 * поэтому ни сброс состояния в эффекте, ни «мигание» прошлой ленты при смене
 * позиции невозможны.
 */

/** Скелет записи: та же геометрия, что у настоящей строки ленты. */
function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-2 py-2.5">
      <div className="flex items-center gap-2">
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="ml-auto h-3 w-12" />
      </div>
      <Skeleton className="h-3.5 w-4/5" />
    </div>
  );
}

/**
 * Итог загрузки первой страницы. `stale` — ответ устарел (стартовала новая
 * попытка или сменилась позиция) и в состояние попадать не должен.
 */
type FirstPageResult =
  | { status: "ok"; data: ActivityFeedPage }
  | { status: "error"; message: string }
  | { status: "stale" };

export default function ActivityTab({
  orgSlug,
  specItemId,
  onViewportScroll,
}: {
  orgSlug: string;
  /** Позиция, чью ленту читаем. Больше ничего из `SpecItem` не нужно. */
  specItemId: string;
  /**
   * Прокрутка вьюпорта: наружу уходит только `scrollTop`.
   *
   * Отдаётся число, а не DOM-событие: потребителю (сворачивание
   * `DetailsHeader` в `SpecMatDetailModal`) нужна ровно позиция прокрутки, а
   * `event.currentTarget` живёт только внутри обработчика. Состояние
   * свёрнутости остаётся в модалке — своего состояния лента не заводит.
   */
  onViewportScroll?: (scrollTop: number) => void;
}) {
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<ActivityCursor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * Для какой позиции пришли `records`. Не совпало с текущей — идёт загрузка
   * (в том числе первая, когда значение ещё `null`).
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  /**
   * Номер попытки. Ответ устаревшего запроса не должен перезаписать результат
   * нового: «Повторить», смена позиции и быстрый повторный клик — обычное дело.
   */
  const requestIdRef = useRef(0);

  /**
   * Первая страница ленты.
   *
   * Функция ничего не пишет в состояние: она возвращает страницу или причину
   * отказа, а применяет результат вызывающий (эффект или «Повторить»). Так
   * загрузку можно запустить и из эффекта, и из обработчика, не снимая
   * защиту от гонки и не дублируя логику.
   */
  const requestFirstPage = useCallback(async (): Promise<FirstPageResult> => {
    const requestId = ++requestIdRef.current;

    try {
      const res = await getSpecItemActivity(orgSlug, specItemId, null);
      if (requestId !== requestIdRef.current) return { status: "stale" };
      return res.success
        ? { status: "ok", data: res.data }
        : { status: "error", message: res.error };
    } catch (cause) {
      // Server action может отклониться, не дойдя до ActionResult (сеть,
      // повторная валидация): для UI это то же самое «не удалось».
      if (requestId !== requestIdRef.current) return { status: "stale" };
      console.error("[ActivityTab] initial load", cause);
      return { status: "error", message: "Не удалось загрузить историю" };
    }
  }, [orgSlug, specItemId]);

  /** Применить первую страницу: актуальный результат или отказ. */
  const applyFirstPage = useCallback(
    (result: FirstPageResult) => {
      if (result.status === "stale") return;

      if (result.status === "ok") {
        setRecords(result.data.records);
        setNextCursor(result.data.nextCursor);
        setLoadedKey(specItemId);
        setError(null);
      } else {
        setError(result.message);
      }
    },
    [specItemId],
  );

  useEffect(() => {
    requestFirstPage().then(applyFirstPage);
    // Смена позиции отменяет ответ прошлого запроса: номер попытки растёт.
    return () => {
      requestIdRef.current += 1;
    };
  }, [requestFirstPage, applyFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;

    const requestId = requestIdRef.current;
    setLoadingMore(true);

    try {
      const res = await getSpecItemActivity(orgSlug, specItemId, nextCursor);
      if (requestId !== requestIdRef.current) return;

      if (res.success) {
        // Строго в конец и без пересортировки: сервер уже отдал продолжение
        // хронологии. Дубликат по `id` возможен только если данные изменились
        // между страницами — лишнюю строку отбрасываем, порядок не трогаем.
        setRecords((current) => {
          const seen = new Set(current.map((record) => record.id));
          return [
            ...current,
            ...res.data.records.filter((record) => !seen.has(record.id)),
          ];
        });
        setNextCursor(res.data.nextCursor);
      } else {
        setError(res.error);
      }
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      console.error("[ActivityTab] load more", cause);
      setError("Не удалось загрузить историю");
    } finally {
      // Только для своей попытки: сброс флага устаревшего запроса снял бы
      // блокировку с уже идущего нового.
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [orgSlug, specItemId, nextCursor, loadingMore]);

  /**
   * Раскладка ленты: разделители дней и ветки ответов.
   *
   * Момент `now` фиксируется один раз на набор записей, чтобы все разделители
   * считались от одного времени: иначе «Сегодня» могло бы появиться в одном
   * месте ленты и не появиться в другом при отрисовке через полночь.
   */
  const feed = useMemo(() => {
    if (loadedKey !== specItemId) return [];
    return buildActivityFeed(records);
  }, [records, loadedKey, specItemId]);

  const isCurrent = loadedKey === specItemId;
  const loading = !isCurrent && error === null;
  const failed = !isCurrent && error !== null;

  /**
   * Прокрутка вьюпорта → число наружу.
   *
   * Читается в момент события: `currentTarget` после обработчика уже не тот
   * элемент, а `scrollTop` как значение от него не зависит.
   */
  const handleViewportScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      onViewportScroll?.(event.currentTarget.scrollTop);
    },
    [onViewportScroll],
  );

  return (
    <MessageScrollerProvider defaultScrollPosition="start">
      <MessageScroller>
        {/*
          `role` не задаём: примитив сам помечает контент журналом (`role="log"`,
          `aria-relevant="additions"`), а мы даём области понятное имя.
        */}
        <MessageScrollerViewport
          aria-label="Лента активности"
          onScroll={handleViewportScroll}
        >
          <MessageScrollerContent className="gap-0 px-4 py-4">
            {loading &&
              Array.from({ length: ACTIVITY_SKELETON_COUNT }, (_, index) => (
                <div key={index} aria-hidden="true">
                  <ActivitySkeleton />
                </div>
              ))}

            {failed && (
              <div
                role="alert"
                className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-muted px-4 py-8 text-center"
              >
                <p className="text-[13px] text-fg-muted">{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Ошибку снимаем до запроса: пока идёт повторная попытка,
                    // место занимает skeleton, а не текст отказа.
                    setError(null);
                    void requestFirstPage().then(applyFirstPage);
                  }}
                >
                  Повторить
                </Button>
              </div>
            )}

            {isCurrent && records.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <History className="size-7 text-fg-muted" aria-hidden="true" />
                <p className="text-[14px] font-medium text-fg">
                  Пока ничего не происходило
                </p>
                <p className="max-w-xs text-[12.5px] text-fg-muted">
                  Здесь появятся изменения позиции и комментарии участников — с
                  момента создания и по мере работы над спецификацией.
                </p>
              </div>
            )}

            {/*
              Ключ `MessageScrollerItem` — либо запись, либо разделитель. Сам
              разделитель не оборачивается в `MessageScrollerItem`: это не
              сообщение ленты, и привязка скролла к нему смысла не имеет.
            */}
            {feed.map((item) =>
              item.kind === "date" ? (
                <ActivityDateSeparator key={item.id} label={item.label} />
              ) : item.kind === "event" ? (
                <MessageScrollerItem
                  key={item.id}
                  messageId={item.id}
                  className="py-2.5"
                >
                  <ActivityEvent record={item.record} />
                </MessageScrollerItem>
              ) : (
                <MessageScrollerItem
                  key={item.id}
                  messageId={item.id}
                  className="py-3"
                >
                  <ActivityComment
                    comment={item.comment}
                    replies={item.replies}
                  />
                </MessageScrollerItem>
              ),
            )}

            {/*
              Пагинация — обычная кнопка, а не `MessageScrollerButton`: тот
              служит переходам по вьюпорту и на этом этапе не используется.
            */}
            {isCurrent && nextCursor !== null && (
              <div className="flex justify-center py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Загрузка…" : "Показать ещё"}
                </Button>
              </div>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
