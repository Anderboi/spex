import { Edit, Trash } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

interface Props {
  onClick: (e: any) => void;
  onDelete: (e: any) => void;
  className?: string;
}

const IconButtonBlock = ({ onClick, onDelete, className }: Props) => {
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
        aria-label="Изменить"
        onClick={onClick}
      >
        <Edit className="size-3.5" />
      </Button>
      <Button
        variant="outline"
        className="size-8 rounded-full border-none bg-bg/85 p-0 text-fg-body backdrop-blur-sm hover:bg-bg-red-light hover:text-fg-red"
        size="icon-lg"
        aria-label="Удалить"
        onClick={onDelete}
      >
        <Trash className="size-3.5" />
      </Button>
    </div>
  );
};

export default IconButtonBlock;
