import { cn } from "@/lib/utils";

interface Props {
  /** Подпись параметра: «Наименование», «Формат», «Морозостойкость». */
  label: string;
  /** `id` поля, на который ссылается подпись (`htmlFor`). */
  htmlFor?: string;
  /** Свои классы колонки значения (поле + кнопки). */
  className?: string;
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
function SpecParameterInlineEdit({ label, htmlFor, className, children }: Props) {
  return (
    <div className="group/param flex flex-col py-1 md:flex-row md:items-center md:gap-4">
      <label
        htmlFor={htmlFor}
        className={cn(
          "w-36 shrink-0 truncate px-2 font-mono text-xs tracking-tighter text-fg-muted md:px-0",
          className,
        )}
        title={label}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export default SpecParameterInlineEdit;
