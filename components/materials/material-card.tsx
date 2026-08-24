import { Button } from "../ui/button";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { fmt } from "@/lib/utils";
import Image from "next/image";
import { MaterialListItem } from "@/lib/queries";

interface MaterialCardProps {
  mat: MaterialListItem;
  handleEdit: (mat: MaterialListItem) => void;
  handleDelete: (mat: any) => void;
}
const MaterialCard = ({ mat, handleEdit, handleDelete }: MaterialCardProps) => {
  return (
    <div
      key={mat.id}
      className="group rounded-xl border border-border bg-bg-card overflow-hidden hover:border-fg/30 transition-all flex flex-col"
    >
      {/* Превью с кнопками действия при наведении */}
      <div className="relative h-40 overflow-hidden bg-bg-brand2 p-3 flex flex-col justify-between">
        {mat.imageUrl && (
          <Image
            src={mat.imageUrl}
            alt={mat.name}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
          />
        )}

        <span className="relative z-10 self-start text-[10px] font-mono uppercase bg-bg/80 backdrop-blur px-2 py-0.5 rounded border border-border">
          {mat.category || "Без категории"}
        </span>

        <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
          <p className="text-xs line-clamp-2 text-fg-muted">{mat.product_type}</p>
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
