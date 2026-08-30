import { SpecVariant } from "@/lib/types";
import { cn, fmt } from "@/lib/utils";
import Image from "next/image";
import {
  Building2,
  Check,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";

const VariantCard = ({
  item,
  onSwitch,
  onEdit,
  onDelete,
  delta,
  variants,
}: {
  item: SpecVariant;
  onSwitch: (variantId: string) => void;
  onEdit: (variantId: string) => void;
  onDelete: (variantId: string) => void;
  delta: number;
  variants: SpecVariant[];
}) => {
  const minPrice =
    variants.length > 1 ? Math.min(...variants.map((v) => v.price)) : null;

  // бейдж только если цена уникально минимальна: при равных ценах
  // «Дешевле всех» не показываем ни одному варианту
  const isCheapest =
    minPrice !== null &&
    item.price === minPrice &&
    variants.filter((v) => v.price === minPrice).length === 1;

  return (
    <div
      key={item.id}
      role="button"
      tabIndex={0}
      onClick={() => !item.isActive && onSwitch(item.id)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !item.isActive) {
          e.preventDefault();
          onSwitch(item.id);
        }
      }}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all bg-bg-card",
        item.isActive
          ? "border-fg ring-1 ring-fg cursor-default"
          : "border-border-muted cursor-pointer hover:border-fg hover:shadow-sm",
      )}
    >
      {/* картинка */}
      <div className="relative aspect-video w-full bg-bg-card">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-fg-dim">
            <Building2 className="size-8 opacity-40" />
          </div>
        )}

        {/* бейджи поверх картинки */}
        <div className="absolute left-2 top-2 flex gap-1.5">
          {item.isActive && (
            <span className="flex items-center gap-1 rounded-md bg-fg px-2 py-0.5 text-[11px] font-semibold text-bg">
              <Check className="size-3" /> Активный
            </span>
          )}
          {isCheapest && (
            <span className="rounded-md bg-bg-green/90 px-2 py-0.5 text-[11px] font-semibold text-bg">
              Дешевле всех
            </span>
          )}
        </div>

        {/* меню ⋯ */}
        <div
          className="absolute right-2 top-2"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Действия"
              className="flex size-7 items-center justify-center rounded-md bg-bg/80 text-fg backdrop-blur hover:bg-bg"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 bg-bg-card">
              {!item.isActive && (
                <DropdownMenuItem
                  onClick={() => onSwitch(item.id)}
                  className="gap-2 text-[13px]"
                >
                  <Check className="size-3.5" /> Сделать активным
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onEdit(item.id)}
                className="gap-2 text-[13px]"
              >
                <Pencil className="size-3.5" /> Редактировать
              </DropdownMenuItem>
              {variants.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(item.id)}
                    className="gap-2 text-[13px] text-fg-red"
                  >
                    <Trash2 className="size-3.5" /> Удалить
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* тело карточки */}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {item.name || "Без названия"}
          </p>
          {item.productUrl && (
            <a
              href={item.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="Открыть на сайте"
              className="shrink-0 text-fg-muted hover:text-fg"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>

        {item.brand && (
          <p className="truncate text-[12px] text-fg-muted">{item.brand}</p>
        )}

        <div className="mt-auto flex items-end justify-between pt-1.5">
          <div className="min-w-0">
            {item.companyName && (
              <p className="flex items-center gap-1 truncate text-[11.5px] text-fg-dim">
                <Building2 className="size-3 shrink-0" />
                {item.companyName}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-mono text-[15px] font-semibold tabular-nums">
              {fmt(item.price)} ₽
            </p>
            {delta !== 0 && (
              <p
                className={cn(
                  "font-mono text-[11px] tabular-nums",
                  delta < 0 ? "text-fg-approved" : "text-fg-red",
                )}
              >
                {delta < 0 ? "−" : "+"}
                {fmt(Math.abs(delta))} ₽
              </p>
            )}
          </div>
        </div>
        <Separator />
        <div className="flex items-center justify-between font-mono text-[12px]">
          <span className=" text-fg-muted">Срок поставки</span>
          {item.leadTime}
        </div>
      </div>
    </div>
  );
};

export default VariantCard;
