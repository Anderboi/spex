import { cn } from "@/lib/utils";

interface Props {
  /** Подпись параметра: «Наименование», «Формат», «Морозостойкость». */
  label: string;
  /** `id` поля, на который ссылается подпись (`htmlFor`). */
  htmlFor?: string;
  /** Свои классы колонки значения (поле + кнопки). */
  className?: string;
  hint?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Строка параметра «подпись слева, значение справа»: базовая раскладка всех
 * блоков в модалке позиции.
 *
 * Значение живёт внутри `group`: контрол сам подсвечивается на
 * `group-hover:bg-bg-card`, а действия строки (удалить, открыть ссылку)
 * показываются через `group-hover`. `group` именованный (`group/param`), чтобы
 * вложенные строки не зажигали подсветку друг друга.
 */
function SpecParameterInlineEdit({ label, htmlFor, className, hint, children }: Props) {
  return (
    <div className="group/param flex flex-col py-1 md:flex-row md:items-center md:gap-4">
      <label
        htmlFor={htmlFor}
        className={cn(
          "flex w-36 shrink-0 items-baseline gap-1.5 truncate px-2 font-mono text-xs tracking-tighter text-fg-muted md:px-0",
          className,
        )}
        title={label}
      >
        <span className="truncate">{label}</span>
        {hint && (
          <span className="shrink-0 text-[10px] text-fg-dim">{hint}</span>
        )}
      </label>
      {children}
    </div>
  );
}

export default SpecParameterInlineEdit;
