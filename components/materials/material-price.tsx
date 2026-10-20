import { cn, fmt } from '@/lib/utils';

/** Цена с единицей измерения либо честное «не указана» при нуле. */
function MaterialPrice({
  price,
  unit,
  hasPrice,
  size = "sm",
}: {
  price: number | null;
  unit: string | null;
  hasPrice: boolean;
  size?: "sm" | "md" | "lg";
}) {
  if (!hasPrice) {
    return (
      <span className="min-w-0 font-sans text-xs text-fg-muted">
        Цена не указана
      </span>
    );
  }

  return (
    <span
      className={cn(
        "min-w-0 font-mono font-semibold",
        size === "md" && "text-[13px]",
        size === "sm" && "text-xs",
        size === "lg" && "text-[16px]",
      )}
    >
      {fmt(price)} ₽
      {unit && (
        <span className={cn("text-fg-muted", size === "lg" && "text-sm")}>
          {" "}
          / {unit}
        </span>
      )}
    </span>
  );
}
export default MaterialPrice;
