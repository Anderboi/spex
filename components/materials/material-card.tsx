"use client";

import { memo, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  Building2,
  ExternalLink,
  ImageIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn, fmt } from "@/lib/utils";
import { MaterialListItem } from "@/lib/queries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface MaterialCardProps {
  mat: MaterialListItem;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Карточка материала в библиотеке.
 *
 * Две раскладки одной сущности:
 *   `< md`  — компактная строка: превью 88px, справа категория, бренд, название,
 *             артикул с поставщиком и цена. Вертикальная карточка с превью 160px
 *             давала ~340px на позицию, то есть ~4000px скролла на страницу.
 *   `>= md` — прежняя вертикальная карточка в сетке 2/3/4 колонки.
 *
 * Вся строка на мобиле — одна кнопка редактирования (большой тап-таргет), а
 * действия правки и удаления лежат в меню «⋯»: на тач-устройствах hover нет,
 * поэтому иконочные кнопки в углу превью там были бы недоступны.
 *
 * Поставщик и артикул — рабочие поля закупки, поэтому выводятся сразу. Цена `0`
 * в базе означает «не указана» и показывается как «Цена не указана».
 */
const MaterialCard = memo(
  function MaterialCard({ mat, onEdit, onDelete }: MaterialCardProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    /** Менеджер конкретнее компании: если он выбран, показываем его. */
    const supplierName = mat.contactName || mat.companyName;
    const hasPrice = typeof mat.price === "number" && mat.price > 0;

    const handleEdit = () => onEdit(mat.id);
    const handleRequestDelete = () => setShowDeleteDialog(true);

    // Одна ячейка сетки на две раскладки: внешний контейнер растянут по высоте
    // строки, поэтому на `md+` карточка занимает её целиком (`flex-1`), а на
    // мобиле подстраивается под компактную строку.
    return (
      <div className="group flex flex-col">
        <MobileMaterialRow
          mat={mat}
          supplierName={supplierName}
          hasPrice={hasPrice}
          onEdit={handleEdit}
          onRequestDelete={handleRequestDelete}
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

            <div className="absolute top-2 right-2 z-10 flex gap-1 transition-opacity group-focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
              <Button
                size="icon"
                variant="secondary"
                className="size-8"
                aria-label={`Редактировать материал ${mat.name}`}
                onClick={handleEdit}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="destructive"
                className="size-8"
                aria-label={`Удалить материал ${mat.name}`}
                onClick={handleRequestDelete}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
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

              <SupplierAndArticle mat={mat} supplierName={supplierName} />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <MaterialPrice
                price={mat.price}
                unit={mat.unit}
                hasPrice={hasPrice}
              />
              <Button size="sm" variant="outline" className="gap-2 text-xs">
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
    prev.onDelete === next.onDelete,
);

/** Артикул и поставщик одной строкой — общие данные обеих раскладок. */
function SupplierAndArticle({
  mat,
  supplierName,
  className,
}: {
  mat: MaterialListItem;
  supplierName: string;
  className?: string;
}) {
  if (!mat.article && !supplierName) return null;

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
    </div>
  );
}

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
  size?: "sm" | "md";
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
        size === "md" ? "text-[13px]" : "text-xs",
      )}
    >
      {fmt(price)} ₽
      {unit && <span className="text-fg-muted"> / {unit}</span>}
    </span>
  );
}

/**
 * Компактная строка для мобильной ширины: одна кнопка на всю строку плюс меню
 * действий. Высота ≈ 100px вместо ~340px у вертикальной карточки.
 */
function MobileMaterialRow({
  mat,
  supplierName,
  hasPrice,
  onEdit,
  onRequestDelete,
}: {
  mat: MaterialListItem;
  supplierName: string;
  hasPrice: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
}) {
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
              alt=""
              fill
              sizes="88px"
              className="object-cover"
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

          <SupplierAndArticle mat={mat} supplierName={supplierName} />

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

export default MaterialCard;
