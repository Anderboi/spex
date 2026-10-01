import ActivityTab from "./activity-tab";

/**
 * Вкладка «Комментарии» карточки позиции.
 *
 * Тонкая обёртка: пока вкладка целиком занята лентой активности, всё её
 * содержимое — `ActivityTab`. Слой оставлен намеренно, потому что следующая
 * задача добавит сюда то, чего у ленты быть не должно: composer и, возможно,
 * переключатель «Все / Комментарии / События». Тогда вкладка станет
 * композицией, а лента останется самостоятельным компонентом.
 */
const CommentsTab = ({
  orgSlug,
  specItemId,
  onViewportScroll,
}: {
  orgSlug: string;
  specItemId: string;
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
      specItemId={specItemId}
      onViewportScroll={onViewportScroll}
    />
  );
};

export default CommentsTab;
