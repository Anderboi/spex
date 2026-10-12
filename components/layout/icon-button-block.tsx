import { Edit, Trash } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

interface Props {
  /** Первая кнопка блока: по умолчанию «Изменить». */
  onClick: (e: MouseEvent) => void;
  /**
   * Вторая кнопка блока: по умолчанию «Удалить». Без обработчика она не
   * рендерится — так карточка прячет действие, которого у роли нет (например,
   * «Удалить навсегда» в архиве проектов доступно только администратору).
   */
  onDelete?: (e: MouseEvent) => void;
  className?: string;
  /** Подмена иконки и подписи первой кнопки: в архиве это «Вернуть». */
  icon?: ReactNode;
  label?: string;
  /** Подмена иконки и подписи второй кнопки: архив — «Удалить навсегда», работа — «Убрать в архив». */
  deleteIcon?: ReactNode;
  deleteLabel?: string;
}

const IconButtonBlock = ({
  onClick,
  onDelete,
  className,
  icon = <Edit className="size-3.5" />,
  label = "Изменить",
  deleteIcon = <Trash className="size-3.5" />,
  deleteLabel = "Удалить",
}: Props) => {
  return (
    <div
      className={cn(
        className,
        "absolute z-20 top-1.5 right-1.5 flex gap-1.5 transition-all duration-200 group-hover:opacity-100 md:opacity-0",
      )}
    >
      <Button
        variant="outline"
        className="size-8 rounded-full border-none bg-bg/85 p-0 text-fg-body backdrop-blur-sm hover:bg-bg-white"
        size="icon-lg"
        aria-label={label}
        title={label}
        onClick={onClick}
      >
        {icon}
      </Button>
      {onDelete && (
        <Button
          variant="outline"
          className="size-8 rounded-full border-none bg-bg/85 p-0 text-fg-body backdrop-blur-sm hover:bg-bg-red-light hover:text-fg-red"
          size="icon-lg"
          aria-label={deleteLabel}
          title={deleteLabel}
          onClick={onDelete}
        >
          {deleteIcon}
        </Button>
      )}
    </div>
  );
};

export default IconButtonBlock;
