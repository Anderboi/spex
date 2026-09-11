"use client";

import { memo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { ContactRow } from "@/lib/validations";
import { initials } from "@/lib/utils";
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

interface ContactCardProps {
  contact: ContactRow;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export const ContactCard = memo(
  function ContactCard({ contact, onEdit, onRemove }: ContactCardProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const handleConfirmDelete = () => {
      setShowDeleteDialog(false);
      onRemove(contact.id);
    };

    return (
      <>
        <li className="flex items-start gap-3 rounded-xl border border-border bg-bg-card p-4">
          {contact.avatar_url ? (
            <div className="relative size-10 shrink-0 overflow-hidden rounded-full border border-border">
              <Image
                src={contact.avatar_url}
                alt={contact.name}
                fill
                sizes="40px"
                className="object-cover"
              />
            </div>
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-brand2 text-sm font-medium text-fg-body">
              {initials(contact.name)}
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-fg-body">{contact.name}</span>
              {contact.title && (
                <span className="text-xs text-fg-muted">{contact.title}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {contact.category.length > 0 ? (
                contact.category.map((cat) => (
                  <span
                    key={cat}
                    className="rounded-full border border-fg-brand/50 bg-bg-brand/30 text-fg-brand px-2 py-0.5 text-xs font-medium"
                  >
                    {cat}
                  </span>
                ))
              ) : (
                <span className="text-xs text-fg-muted">Без категории</span>
              )}
            </div>
            <div className="mt-1 flex flex-col gap-0.5 text-xs text-fg-muted">
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="hover:text-fg">
                  {contact.email}
                </a>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="hover:text-fg-muted"
                >
                  {contact.phone}
                </a>
              )}
            </div>

            {contact.note && (
              <p className="mt-2 text-xs text-fg-muted">{contact.note}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Редактировать контакт ${contact.name}`}
              onClick={() => onEdit(contact.id)}
              className="cursor-pointer text-fg-muted hover:text-fg"
            >
              <Pencil className="size-4 shrink-0" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Удалить контакт ${contact.name}`}
              onClick={() => setShowDeleteDialog(true)}
              className="cursor-pointer text-fg-muted hover:text-destructive"
            >
              <Trash2 className="size-4 shrink-0" />
            </Button>
          </div>
        </li>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить «{contact.name}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Контакт будет удален из справочника. Если он привязан к позициям
                в спецификациях, данные о нем могут стать недоступны. Это
                действие нельзя отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
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
  (prevProps, nextProps) => {
    return (
      prevProps.contact.id === nextProps.contact.id &&
      prevProps.contact.name === nextProps.contact.name &&
      prevProps.contact.title === nextProps.contact.title &&
      prevProps.contact.email === nextProps.contact.email &&
      prevProps.contact.phone === nextProps.contact.phone &&
      prevProps.contact.note === nextProps.contact.note &&
      prevProps.contact.avatar_url === nextProps.contact.avatar_url
    );
  },
);
