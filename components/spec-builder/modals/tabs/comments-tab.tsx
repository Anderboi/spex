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
}: {
  orgSlug: string;
  specItemId: string;
}) => {
  return <ActivityTab orgSlug={orgSlug} specItemId={specItemId} />;
};

export default CommentsTab;
