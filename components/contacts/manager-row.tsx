"use client";

import { Mail, Pencil, Phone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactRow } from "@/lib/validations";
import { initials } from "@/lib/utils";
import { memo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

interface ManagerRowProps {
  manager: ContactRow;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export const ManagerRow = memo(
  function ManagerRow({ manager, onEdit, onRemove }: ManagerRowProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const handleConfirmDelete = () => {
      setShowDeleteDialog(false);
      onRemove(manager.id);
    };

    return (
      <>
        <li className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-bg-card">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-brand2 text-xs font-medium text-fg">
            {initials(manager.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium text-fg">
                {manager.name}
              </span>
              {manager.title ? (
                <span className="text-xs text-fg-muted">{manager.title}</span>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-muted">
              {manager.email ? (
                <a
                  href={`mailto:${manager.email}`}
                  className="inline-flex items-center gap-1.5 hover:text-fg"
                >
                  <Mail className="size-3" /> {manager.email}
                </a>
              ) : null}
              {manager.phone ? (
                <a
                  href={`tel:${manager.phone}`}
                  className="inline-flex items-center gap-1.5 hover:text-fg"
                >
                  <Phone className="size-3" /> {manager.phone}
                </a>
              ) : null}
            </div>
            {manager.note ? (
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                {manager.note}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={`Редактировать контакт ${manager.name}`}
              onClick={() => onEdit(manager.id)}
              className="text-fg-muted hover:text-fg"
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={`Удалить контакт ${manager.name}`}
              onClick={() => setShowDeleteDialog(true)}
              className="text-fg-muted hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </li>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить «{manager.name}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Представитель компании будет удален из справочника. Это действие
                нельзя отменить.
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
      prevProps.manager.id === nextProps.manager.id &&
      prevProps.manager.name === nextProps.manager.name &&
      prevProps.manager.title === nextProps.manager.title &&
      prevProps.manager.email === nextProps.manager.email &&
      prevProps.manager.phone === nextProps.manager.phone
    );
  },
);
