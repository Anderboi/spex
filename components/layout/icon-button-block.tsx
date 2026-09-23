import { Edit, Trash } from "lucide-react";
import { Button } from "../ui/button";

interface Props {
  onClick: (e: any) => void;
  onDelete: (e: any) => void;
}

const IconButtonBlock = ({ onClick, onDelete }: Props) => {
  return (
    <div className="absolute z-20 top-3 right-3 transition-all gap-2 flex sm:hidden duration-200 group-hover:flex">
      <Button
        variant="outline"
        className="size-10 sm:size-9 opacity-50 hover:bg-bg-white rounded-full hover:border-none  hover:opacity-100"
        size="icon-lg"
        onClick={onClick}
      >
        <Edit size={20} />
      </Button>
      <Button
        variant="outline"
        className="size-10 sm:size-9 opacity-50 hover:bg-bg-red-light hover:border-none rounded-full hover:text-fg-red hover:opacity-100"
        size="icon-lg"
        onClick={onDelete}
      >
        <Trash size={20} />
      </Button>
    </div>
  );
};

export default IconButtonBlock;
