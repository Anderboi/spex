import { Button } from "../ui/button";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { fmt } from "@/lib/utils";

interface MaterialCardProps {
  mat: any;
  handleEdit: (mat: any) => void;
  handleDelete: (mat: any) => void;
}
const MaterialCard = ({ mat, handleEdit, handleDelete }: MaterialCardProps) => {
  return (
    <div
      key={mat.id}
      className="group rounded-xl border border-border bg-bg-card overflow-hidden hover:border-fg/30 transition-all flex flex-col"
    >
      {/* Превью с кнопками действия при наведении */}
      <div className="h-40 bg-[repeating-linear-gradient(135deg,#e9e4d9,#e9e4d9_5px,#f0ebe1_5px,#f0ebe1_10px)] relative p-3 flex flex-col justify-between">
        <span className="self-start text-[10px] font-mono uppercase bg-bg/80 backdrop-blur px-2 py-0.5 rounded border border-border">
          {mat.category || "Без категории"}
        </span>

        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="icon"
            variant="secondary"
            className="size-8"
            onClick={() => handleEdit(mat)}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="destructive"
            className="size-8"
            onClick={() => handleDelete(mat.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div>
          {mat.brand && (
            <div className="text-xs text-fg-muted font-mono">{mat.brand}</div>
          )}
          <h3 className="font-semibold text-sm line-clamp-1">{mat.name}</h3>
        </div>

        <div className="pt-2 flex items-center justify-between border-t border-border">
          <span className="font-mono text-xs font-semibold">
            {fmt(mat.price)} ₽ / {mat.unit}
          </span>
          <Button size="sm" variant="outline" className="gap-2 text-xs">
            В проект <ArrowRight className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MaterialCard;
