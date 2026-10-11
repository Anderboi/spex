import type { ReactNode } from "react";

/**
 * Поле фильтра в нижней шторке: подпись сверху, контрол, необязательная подсказка
 * снизу.
 *
 * Общее для всех шторок (материалы, проекты, контакты, спецификация): раньше
 * копия жила в каждой из них, и стили подписи приходилось править по частям.
 *
 * `<label>` оборачивает контрол намеренно: подпись становится его accessible
 * name, и отдельный `aria-label` не нужен.
 */
export function FilterField({
  label,
  hint,
  children,
  as = "label",
}: {
  label: string;
  /** Пояснение под контролом: например, почему список производителей пуст. */
  hint?: string;
  children: ReactNode;
  /**
   * Чем оборачивать поле. По умолчанию `<label>`: подпись становится accessible
   * name контрола, и отдельный `aria-label` не нужен. `div` нужен там, где
   * контрол несёт собственную подпись (галочка «Только черновики»): вложенный
   * `<label>` — невалидная разметка.
   */
  as?: "label" | "div";
}) {
  const content = (
    <>
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-fg-muted">{hint}</span>}
    </>
  );

  return as === "div" ? (
    <div className="flex flex-col gap-2">{content}</div>
  ) : (
    <label className="flex flex-col gap-2">{content}</label>
  );
}
