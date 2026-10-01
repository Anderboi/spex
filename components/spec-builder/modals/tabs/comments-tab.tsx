import ActivityTab from "./activity-tab";

/**
 * Вкладка «Комментарии» карточки позиции.
 *
 * Тонкая обёртка: пока вкладка целиком занята лентой активности, всё её
 * содержимое — `ActivityTab`. Слой оставлен намеренно: следующий шаг добавит
 * сюда то, чего у ленты быть не должно, — например, переключатель
 * «Все / Комментарии / События». Тогда вкладка станет композицией, а лента
 * останется самостоятельным компонентом.
 */
const CommentsTab = ({
  orgSlug,
  orgId,
  specItemId,
  currentUser,
  onViewportScroll,
}: {
  orgSlug: string;
  /** Организация позиции: нужна optimistic-записи комментария. */
  orgId: string;
  specItemId: string;
  /** Автор для optimistic-предпросмотра; окончательный actor даёт сервер. */
  currentUser: { id: string; name: string | null; email: string | null };
  /**
   * Прокрутка ленты наружу — в `SpecMatDetailModal`, где живёт состояние
   * свёрнутости `DetailsHeader`. Проп только пробрасывается: своей логики
   * вкладка не добавляет.
   */
  onViewportScroll?: (scrollTop: number) => void;
}) => {
  return (
    <ActivityTab
      orgSlug={orgSlug}
      orgId={orgId}
      specItemId={specItemId}
      currentUser={currentUser}
      onViewportScroll={onViewportScroll}
    />
  );
};

export default CommentsTab;
