"use client";

import { memo, useId, useMemo, useState } from "react";
import {
  ChevronDown,
  Globe,
  Mail,
  MapPin,
  Phone,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompanyRow, ContactRow } from "@/lib/validations";
import {
  formatContactsCount,
  initials,
  normalizeWebsite,
  telHref,
} from "@/lib/utils";
import { ManagerRow } from "./manager-row";
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

const ruPlural = new Intl.PluralRules("ru-RU");
const CONTACT_FORMS = {
  zero: "контактов",
  one: "контакт",
  two: "контакта", // Intl может не возвращать two для ru-RU, но для TS-безопасности лучше покрыть
  few: "контакта",
  many: "контактов",
  other: "контактов",
};

const pluralizeContacts = (n: number) =>
  `${n} ${CONTACT_FORMS[ruPlural.select(n) as keyof typeof CONTACT_FORMS]}`;

interface CompanyCardProps {
  company: CompanyRow;
  managers: ContactRow[];
  defaultOpen?: boolean;
  onAddManager: (companyId: string) => void;
  onRemoveManager: (id: string) => void;
  onRemoveCompany: (id: string) => void;
}

export const CompanyCard = memo(
  function CompanyCard({
    company,
    managers,
    onAddManager,
    defaultOpen = false,
    onRemoveManager,
    onRemoveCompany,
  }: CompanyCardProps) {
    const [open, setOpen] = useState(true);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const titleId = useId();
    const panelId = useId();

    const website = useMemo(
      () => normalizeWebsite(company.website),
      [company.website],
    );

    const websiteHref = website?.href;
    const websiteLabel = website?.label;

    const handleConfirmDelete = () => {
      setShowDeleteDialog(false);
      onRemoveCompany(company.id);
    };

    const categories = Array.isArray(company.category)
      ? Array.from(new Set(company.category.filter(Boolean)))
      : [];

    return (
      <>
        <article
          aria-labelledby={titleId}
          style={{
            contentVisibility: "auto",
            containIntrinsicSize: "0 180px",
          }}
          className="overflow-hidden rounded-2xl border border-border bg-bg-card"
        >
          <div className="flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
            <div className="bg-bg-brand text-fg-brand flex size-10 shrink-0 items-center justify-center rounded-lg font-serif text-base sm:size-11 sm:text-lg">
              {initials(company.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-4">
                <h3
                  id={titleId}
                  className="font-serif text-lg font-semibold leading-tight text-fg-body"
                >
                  {company.name}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {categories.length > 0 ? (
                    categories.map((cat) => (
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
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
                {company.address && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-4 shrink-0" /> {company.address}
                  </span>
                )}
                {company.phone && (
                  <a
                    href={telHref(company.phone)}
                    className="inline-flex items-center gap-1.5 hover:text-fg"
                  >
                    <Phone className="size-4 shrink-0" /> {company.phone}
                  </a>
                )}
                {company.email && (
                  <a
                    href={`mailto:${company.email}`}
                    className="inline-flex items-center gap-1.5 hover:text-fg"
                  >
                    <Mail className="size-4 shrink-0" /> {company.email}
                  </a>
                )}
                {websiteHref && websiteLabel && (
                  <a
                    href={websiteHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-fg"
                  >
                    <Globe className="size-4 shrink-0" /> {websiteLabel}
                  </a>
                )}
              </div>
              {company.note && (
                <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                  {company.note}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Удалить компанию ${company.name}`}
              onClick={() => setShowDeleteDialog(true)}
              className="text-fg-muted cursor-pointer hover:text-destructive"
            >
              <Trash2 className="size-4 shrink-0" />
            </Button>
          </div>

          <div className="border-t border-border bg-bg-card2">
            <div className="flex items-center justify-between px-3 py-2.5 sm:px-5">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls={panelId}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-fg"
              >
                <ChevronDown
                  className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`}
                />
                <UserRound className="size-4 shrink-0 text-fg-muted" />
                {pluralizeContacts(managers.length)}
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAddManager(company.id || "")}
                className="cursor-pointer"
              >
                <Plus className="size-4 shrink-0" /> Добавить контакт
              </Button>
            </div>
            {open ? (
              <div className="px-2 pb-2">
                {managers.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-fg-muted">
                    Пока нет контактов. Добавьте представителя или менеджера
                    компании.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {managers.map((m) => (
                      <ManagerRow
                        key={m.id}
                        manager={m}
                        onRemove={onRemoveManager}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        </article>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Удалить компанию «{company.name}»?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {managers.length > 0 ? (
                  <>
                    У этой компании есть{" "}
                    <strong>{formatContactsCount(managers.length)}</strong>. Они
                    не будут удалены, а перейдут в список{" "}
                    <strong>«Специалисты»</strong> (как независимые контакты).
                  </>
                ) : (
                  "Это действие нельзя будет отменить."
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                className="bg-destructive text-white hover:bg-destructive/80"
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
    if (prevProps.defaultOpen !== nextProps.defaultOpen) return false;
    if (prevProps.company !== nextProps.company) {
      // Сравниваем по ключевым свойствам компании
      if (
        prevProps.company.id !== nextProps.company.id ||
        prevProps.company.name !== nextProps.company.name ||
        prevProps.company.address !== nextProps.company.address ||
        prevProps.company.phone !== nextProps.company.phone ||
        prevProps.company.email !== nextProps.company.email ||
        prevProps.company.website !== nextProps.company.website ||
        prevProps.company.note !== nextProps.company.note
      ) {
        return false;
      }
    }

    // Проверяем список менеджеров
    if (prevProps.managers !== nextProps.managers) {
      if (prevProps.managers.length !== nextProps.managers.length) return false;
      for (let i = 0; i < prevProps.managers.length; i++) {
        if (prevProps.managers[i] !== nextProps.managers[i]) return false;
      }
    }

    return true;
  },
);
