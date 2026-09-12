"use client";

import { memo, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  Building2,
  ExternalLink,
  ImageIcon,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "../ui/button";
import { fmt } from "@/lib/utils";
import { MaterialListItem } from "@/lib/queries";
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
 * Поставщик и артикул — не украшение, а рабочие поля закупки, поэтому выводятся
 * прямо на карточке, а не только в диалоге правки. Цена `0` в базе означает
 * «не указана» и показывается как «Цена не указана», а не как «0 ₽».
 *
 * Действия скрыты по наведению только там, где наведение существует
 * (`md:`), на тач-устройствах они видны всегда — см. `max-md:opacity-100`.
 */
const MaterialCard = memo(
  function MaterialCard({ mat, onEdit, onDelete }: MaterialCardProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    /** Менеджер конкретнее компании: если он выбран, показываем его. */
    const supplierName = mat.contactName || mat.companyName;
    const hasPrice = typeof mat.price === "number" && mat.price > 0;

    return (
      <>
        <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card transition-colors hover:border-border-muted">
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

            <div className="absolute top-2 right-2 z-10 flex gap-1 transition-opacity group-focus-within:opacity-100 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100">
              <Button
                size="icon"
                variant="secondary"
                className="size-8"
                aria-label={`Редактировать материал ${mat.name}`}
                onClick={() => onEdit(mat.id)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="destructive"
                className="size-8"
                aria-label={`Удалить материал ${mat.name}`}
                onClick={() => setShowDeleteDialog(true)}
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

              <h3
                className="line-clamp-2 text-sm leading-snug font-semibold"
                title={mat.name}
              >
                {mat.name}
              </h3>

              {mat.product_type && (
                <p className="line-clamp-2 text-xs text-fg-muted">
                  {mat.product_type}
                </p>
              )}

              {(mat.article || supplierName) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
                  {mat.article && (
                    <span className="font-mono" title={`Артикул ${mat.article}`}>
                      арт. {mat.article}
                    </span>
                  )}
                  {supplierName && (
                    <span
                      className="flex min-w-0 items-center gap-1"
                      title={supplierName}
                    >
                      {mat.contactName ? (
                        <UserRound className="size-3.5 shrink-0 text-fg-icon" />
                      ) : (
                        <Building2 className="size-3.5 shrink-0 text-fg-icon" />
                      )}
                      <span className="truncate">{supplierName}</span>
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <span className="min-w-0 font-mono text-xs font-semibold">
                {hasPrice ? (
                  <>
                    {fmt(mat.price)} ₽
                    {mat.unit && (
                      <span className="text-fg-muted"> / {mat.unit}</span>
                    )}
                  </>
                ) : (
                  <span className="font-sans text-fg-muted">
                    Цена не указана
                  </span>
                )}
              </span>
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
      </>
    );
  },
  // Ссылочное сравнение: `useOptimistic` заменяет только изменённый объект,
  // поэтому при оптимистичном апдейте перерисовывается одна карточка, а не все.
  (prev, next) =>
    prev.mat === next.mat &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete,
);

export default MaterialCard;
