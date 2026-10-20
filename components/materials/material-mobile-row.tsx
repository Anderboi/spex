import { ExternalLink, FolderPlus, ImageIcon, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import FavoriteButton from '../layout/favorite-button';
import Image from "next/image";
import { MaterialListItem } from '@/lib/queries';
import SupplierAndArticle from './supplier-and-article';
import MaterialPrice from './material-price';

/**
 * Компактная строка для мобильной ширины: одна кнопка на всю строку плюс меню
 * действий. Высота ≈ 100px вместо ~340px у вертикальной карточки.
 */
function MobileMaterialRow({
  mat,
  supplierName,
  hasPrice,
  extraSuppliers,
  cheapestPrice,
  onEdit,
  onRequestDelete,
  onAttach,
  onToggleFavorite,
}: {
  mat: MaterialListItem;
  supplierName: string;
  hasPrice: boolean;
  extraSuppliers: number;
  cheapestPrice: number | null;
  onEdit: () => void;
  onRequestDelete: () => void;
  onAttach: () => void;
  onToggleFavorite: () => void;
}) {
  const isArchived = mat.deletedAt !== null;

  return (
    <div className="flex items-start gap-1 rounded-xl border border-border bg-bg-card p-2.5 transition-colors md:hidden">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Открыть материал ${mat.name}`}
        className="flex min-w-0 flex-1 cursor-pointer gap-3 text-left"
      >
        <div className="relative size-22 shrink-0 overflow-hidden rounded-lg bg-bg-brand2">
          {mat.imageUrl ? (
            <Image
              src={mat.imageUrl}
              alt="material cover"
              fill
              sizes="88px"
              className="object-cover"
              loading="eager"
            />
          ) : (
            <div
              aria-hidden
              className="flex size-full items-center justify-center text-fg-icon"
            >
              <ImageIcon className="size-6" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate rounded-full border border-fg-brand/50 bg-bg-brand/30 px-1.5 py-px text-[10px] font-medium text-fg-brand">
              {mat.category || "Без категории"}
            </span>
            {mat.brand && (
              <span className="min-w-0 truncate font-mono text-[10px] text-fg-muted">
                {mat.brand}
              </span>
            )}
          </div>

          <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-fg-body">
            {mat.name}
          </h3>

          <SupplierAndArticle
            mat={mat}
            supplierName={supplierName}
            extraSuppliers={extraSuppliers}
            cheapestPrice={cheapestPrice}
          />

          <div className="pt-0.5">
            <MaterialPrice
              price={mat.price}
              unit={mat.unit}
              hasPrice={hasPrice}
              size="md"
            />
          </div>
        </div>
      </button>

      {/* Отдельная кнопка, а не вложенная в строку: строка сама — кнопка, и
          вложенный `<button>` внутри неё недопустим. */}
      {!isArchived && (
        <FavoriteButton
          favorite={mat.isFavorite}
          materialName={mat.name}
          onToggle={onToggleFavorite}
          className="mt-0.5 shrink-0"
        />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              className="shrink-0 cursor-pointer text-fg-muted"
              aria-label={`Действия с материалом ${mat.name}`}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44 bg-bg-card">
          <DropdownMenuItem
            className="h-9 gap-2"
            onClick={onAttach}
            disabled={isArchived}
            title={
              isArchived
                ? "Материал удалён из библиотеки — сначала восстановите его"
                : undefined
            }
          >
            <FolderPlus className="size-4" /> В проект
          </DropdownMenuItem>
          <DropdownMenuItem className="h-9 gap-2" onClick={onEdit}>
            <Pencil className="size-4" /> Редактировать
          </DropdownMenuItem>
          {mat.product_url && (
            <DropdownMenuItem
              className="h-9 gap-2"
              render={
                <a
                  href={mat.product_url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Открыть страницу материала ${mat.name}`}
                />
              }
            >
              <ExternalLink className="size-4" /> Открыть на сайте
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="h-9 gap-2"
            onClick={onRequestDelete}
          >
            <Trash2 className="size-4" /> Удалить
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
export default MobileMaterialRow;
