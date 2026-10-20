"use client";

import { memo, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  ExternalLink,
  ImageIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { MaterialListItem } from "@/lib/queries";
import {
  cheapestMaterialSupplier,
  type MaterialSupplierRow,
} from "@/lib/materials/suppliers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import IconButtonBlock from "../layout/icon-button-block";
import FavoriteButton from '../layout/favorite-button';
import MobileMaterialRow from './material-mobile-row';
import SupplierAndArticle from './supplier-and-article';
import MaterialPrice from './material-price';

interface MaterialCardProps {
  mat: MaterialListItem;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  /** Открыть выбор проекта, в спецификацию которого добавить материал. */
  onAttach: (id: string) => void;
  /** Поставить/снять личную отметку «избранное» (целевое состояние). */
  onToggleFavorite: (id: string, favorite: boolean) => void;
}

const MaterialCard = memo(
  function MaterialCard({
    mat,
    onEdit,
    onDelete,
    onAttach,
    onToggleFavorite,
  }: MaterialCardProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    /** Менеджер конкретнее компании: если он выбран, показываем его. */
    const supplierName = mat.contactName || mat.companyName;
    const hasPrice = typeof mat.price === "number" && mat.price > 0;
    const isArchived = mat.deletedAt !== null;

    /**
     * Поставщики: в строке карточки видно одного, остальные — счётчиком и самой
     * низкой ценой. Полный список с ценами живёт в диалоге материала: карточка
     * отвечает на «сколько их и от какой цены», а не заменяет сравнение.
     */
    const suppliers = mat.suppliers ?? [];
    const extraSuppliers = Math.max(0, suppliers.length - 1);
    const cheapestPrice =
      cheapestMaterialSupplier(
        suppliers.map(
          (s): MaterialSupplierRow => ({
            id: s.id,
            company_id: s.companyId,
            contact_id: s.contactId,
            price: s.price,
            product_url: s.productUrl,
            position: s.position,
          }),
        ),
      )?.row.price ?? null;

    const handleEdit = () => onEdit(mat.id);
    const handleRequestDelete = () => setShowDeleteDialog(true);
    const handleAttach = () => onAttach(mat.id);
    const handleToggleFavorite = () =>
      onToggleFavorite(mat.id, !mat.isFavorite);

    return (
      <div className="group flex flex-col">
        <MobileMaterialRow
          mat={mat}
          supplierName={supplierName}
          hasPrice={hasPrice}
          extraSuppliers={extraSuppliers}
          cheapestPrice={cheapestPrice}
          onEdit={handleEdit}
          onRequestDelete={handleRequestDelete}
          onAttach={handleAttach}
          onToggleFavorite={handleToggleFavorite}
        />

        <div className="hidden flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg-card transition-colors hover:border-border-muted md:flex">
          {/* Превью с бейджем категории и действиями */}
          <div className="relative h-40 shrink-0 overflow-hidden bg-bg-brand2">
            {mat.imageUrl ? (
              <Image
                src={mat.imageUrl}
                alt={mat.name}
                fill
                sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                className="object-cover"
                loading='eager'
              />
            ) : (
              <div
                aria-hidden
                className="flex size-full items-center justify-center text-fg-icon"
              >
                <ImageIcon className="size-7" />
              </div>
            )}

            <span className="absolute top-2.5 left-2.5 z-10 max-w-[calc(100%-4.5rem)] truncate rounded border border-border bg-bg/80 px-2 py-0.5 font-mono text-[10px] uppercase backdrop-blur">
              {mat.category || "Без категории"}
            </span>
            <IconButtonBlock
              onClick={handleEdit}
              onDelete={handleRequestDelete}
            />

            {/* Сердце видно всегда, а не по наведению: состояние отметки — это
                ответ на вопрос «мой материал или нет», а не скрытое действие.
                У архивного материала сердца нет: там отметками не управляют. */}
            {!isArchived && (
              <FavoriteButton
                favorite={mat.isFavorite}
                materialName={mat.name}
                onToggle={handleToggleFavorite}
                className="absolute right-2 bottom-2 z-20"
              />
            )}
          </div>

          <div className="flex flex-1 flex-col justify-between gap-3 p-4">
            <div className="space-y-1.5">
              {(mat.brand || mat.product_url) && (
                <div className="flex items-center gap-1.5">
                  {mat.brand && (
                    <span
                      className="min-w-0 truncate font-mono text-xs text-fg-muted"
                      title={mat.brand}
                    >
                      {mat.brand}
                    </span>
                  )}
                  {mat.product_url && (
                    <a
                      href={mat.product_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Открыть страницу материала ${mat.name}`}
                      title={mat.product_url}
                      className="shrink-0 text-fg-icon transition-colors hover:text-fg"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              )}

              {/* Название — вход в правку: у материала нет отдельной страницы,
                  диалог по URL и есть его карточка-деталь. */}
              <h3
                className="line-clamp-2 text-sm leading-snug font-semibold"
                title={mat.name}
              >
                <button
                  type="button"
                  onClick={handleEdit}
                  className="cursor-pointer text-left hover:underline"
                >
                  {mat.name}
                </button>
              </h3>

              {mat.product_type && (
                <p className="line-clamp-2 text-xs text-fg-muted">
                  {mat.product_type}
                </p>
              )}

              <SupplierAndArticle
                mat={mat}
                supplierName={supplierName}
                extraSuppliers={extraSuppliers}
                cheapestPrice={cheapestPrice}
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <MaterialPrice
                price={mat.price}
                unit={mat.unit}
                hasPrice={hasPrice}
                size="lg"
              />
              <Button
                size="sm"
                variant="outline"
                className="gap-2 text-xs"
                onClick={handleAttach}
                disabled={isArchived}
                title={
                  isArchived
                    ? "Материал удалён из библиотеки — сначала восстановите его"
                    : `Добавить «${mat.name}» в спецификацию проекта`
                }
              >
                В проект <ArrowRight className="size-3" />
              </Button>
            </div>
          </div>
        </div>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить «{mat.name}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Материал исчезнет из библиотеки. Позиции в спецификациях, где он
                использован, сохранятся, но материал больше нельзя будет выбрать
                в новых проектах.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDelete(mat.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  },
  // Ссылочное сравнение: `useOptimistic` заменяет только изменённый объект,
  // поэтому при оптимистичном апдейте перерисовывается одна карточка, а не все.
  (prev, next) =>
    prev.mat === next.mat &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.onAttach === next.onAttach &&
    prev.onToggleFavorite === next.onToggleFavorite,
);

export default MaterialCard;
