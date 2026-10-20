import { MaterialListItem, MaterialSupplierItem } from '@/lib/queries';
import { cn, fmt } from '@/lib/utils';
import { Building2, Layers, UserRound } from 'lucide-react';

/**
 * Подсказка к счётчику поставщиков: перечисляет компании и их цены.
 *
 * Названия компаний могут быть ещё не резолвлены (сразу после создания
 * компании справочник догоняет), поэтому пустое имя не превращается в пустую
 * строку списка.
 */
function suppliersTitle(
  suppliers: MaterialSupplierItem[],
  extraSuppliers: number,
  cheapestPrice: number | null,
): string {
  const names = suppliers
    .map((s) => s.companyName)
    .filter(Boolean)
    .join(", ");
  const head = names
    ? `Поставщики: ${names}`
    : `Поставщиков: ${extraSuppliers + 1}`;
  return cheapestPrice !== null
    ? `${head}. Самая низкая цена — ${fmt(cheapestPrice)} ₽`
    : head;
}

/** Артикул и поставщик одной строкой — общие данные обеих раскладок. */
function SupplierAndArticle({
  mat,
  supplierName,
  extraSuppliers,
  cheapestPrice,
  className,
}: {
  mat: MaterialListItem;
  supplierName: string;
  /** Сколько поставщиков, кроме показанного; 0 — остальных нет. */
  extraSuppliers: number;
  /** Самая низкая цена среди поставщиков — «от … ₽». */
  cheapestPrice: number | null;
  className?: string;
}) {
  if (!mat.article && !supplierName && extraSuppliers === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted",
        className,
      )}
    >
      {mat.article && (
        <span className="font-mono" title={`Артикул ${mat.article}`}>
          арт. {mat.article}
        </span>
      )}
      {supplierName && (
        <span className="flex min-w-0 items-center gap-1" title={supplierName}>
          {mat.contactName ? (
            <UserRound className="size-3.5 shrink-0 text-fg-icon" />
          ) : (
            <Building2 className="size-3.5 shrink-0 text-fg-icon" />
          )}
          <span className="truncate">{supplierName}</span>
        </span>
      )}
      {extraSuppliers > 0 && (
        <span
          className="flex min-w-0 items-center gap-1"
          title={
            suppliersTitle(mat.suppliers, extraSuppliers, cheapestPrice)
          }
        >
          <Layers className="size-3.5 shrink-0 text-fg-icon" />
          <span className="truncate">
            ещё {extraSuppliers}
            {cheapestPrice !== null && ` · от ${fmt(cheapestPrice)} ₽`}
          </span>
        </span>
      )}
    </div>
  );
}
export default SupplierAndArticle;