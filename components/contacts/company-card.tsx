"use client";

import { memo, useId, useMemo, useState } from "react";
import Image from "next/image";
import {
  ChevronDown,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Users,
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

/** Сколько контактов показываем в «рельсе» до раскрытия полного списка. */
const VISIBLE_MANAGERS = 3;

/** Сколько категорий показываем чипами, остальные сворачиваем в «+N». */
const VISIBLE_CATEGORIES = 2;

const areCategoriesEqual = (
  a: string[] | undefined | null,
  b: string[] | undefined | null,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a?.length && !b?.length;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const pluralizeContacts = formatContactsCount;

interface CompanyCardProps {
  company: CompanyRow;
  managers: ContactRow[];
  onAddManager: (companyId: string) => void;
  onEditCompany: (id: string) => void;
  onEditManager: (id: string) => void;
  onRemoveManager: (id: string) => void;
  onRemoveCompany: (id: string) => void;
}

/**
 * Карточка компании в справочнике.
 *
 * Раскладка рассчитана на сетку из 2–3 колонок, поэтому ширина ориентировочная
 * и адаптируется контейнерными запросами (`@container` / `@[...]:`), а не
 * вьюпортными брейкпоинтами:
 *   шапка (логотип · название · категории · счётчик · действия)
 *   рельса контактов (первые {@link VISIBLE_MANAGERS} + «показать всех»)
 *   подвал реквизитов (адрес · телефон · почта · сайт)
 */
export const CompanyCard = memo(
  function CompanyCard({
    company,
    managers,
    onAddManager,
    onEditCompany,
    onEditManager,
    onRemoveManager,
    onRemoveCompany,
  }: CompanyCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const titleId = useId();

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

    const categories = useMemo(
      () =>
        Array.isArray(company.category)
          ? Array.from(new Set(company.category.filter(Boolean)))
          : [],
      [company.category],
    );

    const shownCategories = categories.slice(0, VISIBLE_CATEGORIES);
    const restCategories = categories.length - shownCategories.length;

    // Если контактов мало, «раскрывать» нечего — список показывается целиком.
    const isExpanded = expanded || managers.length <= VISIBLE_MANAGERS;
    const visibleManagers = isExpanded
      ? managers
      : managers.slice(0, VISIBLE_MANAGERS);
    const hiddenCount = managers.length - visibleManagers.length;

    return (
      <>
        <article
          aria-labelledby={titleId}
          style={{
            contentVisibility: "auto",
            containIntrinsicSize: "0 280px",
          }}
          className="group @container flex flex-col overflow-hidden rounded-2xl border border-border bg-bg-card transition-colors hover:border-border-muted"
        >
          {/* Шапка: логотип-якорь, название, категории, действия */}
          <header className="flex items-start gap-3 p-4">
            {company.logo_url ? (
              <div className="relative size-12.5 shrink-0 overflow-hidden rounded-lg border border-border-subtle bg-bg-card2">
                <Image
                  src={company.logo_url}
                  alt=""
                  fill
                  sizes="44px"
                  className="object-contain"
                />
              </div>
            ) : (
              <div
                aria-hidden
                className="flex size-12.5 shrink-0 items-center justify-center rounded-lg bg-bg-brand font-serif text-base text-fg-brand"
              >
                {initials(company.name)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <h3
                id={titleId}
                className="line-clamp-2 font-serif text-base font-semibold leading-snug text-fg-body"
              >
                {company.name}
              </h3>

              <div className="mt-1.5 flex items-center gap-1.5">
                {shownCategories.map((cat) => (
                  <span
                    key={cat}
                    className="max-w-28 truncate rounded-full border border-fg-brand/50 bg-bg-brand/30 px-2 py-0.5 text-xs font-medium text-fg-brand"
                  >
                    {cat}
                  </span>
                ))}
                {restCategories > 0 && (
                  <span
                    className="shrink-0 rounded-full border border-border bg-bg-card2 px-2 py-0.5 text-xs font-medium text-fg-muted"
                    title={categories.join(", ")}
                  >
                    +{restCategories}
                  </span>
                )}
                {managers.length > 0 && (
                  <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-fg-muted">
                    {pluralizeContacts(managers.length)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-0.5 transition-opacity group-focus-within:opacity-100 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Редактировать компанию ${company.name}`}
                onClick={() => onEditCompany(company.id)}
                className="cursor-pointer text-fg-muted hover:text-fg"
              >
                <Pencil className="size-4 shrink-0" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Удалить компанию ${company.name}`}
                onClick={() => setShowDeleteDialog(true)}
                className="cursor-pointer text-fg-muted hover:text-destructive"
              >
                <Trash2 className="size-4 shrink-0" />
              </Button>
            </div>
          </header>

          {/* Рельса контактов: люди — основной контент карточки, а не аккордеон */}
          {managers.length > 0 ? (
            <div className="divide-y divide-border-subtle border-t border-border-subtle">
              <ul className="divide-y divide-border-subtle">
                {visibleManagers.map((m) => (
                  <ManagerRow
                    key={m.id}
                    manager={m}
                    onEdit={onEditManager}
                    onRemove={onRemoveManager}
                  />
                ))}
              </ul>

              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-card2 hover:text-fg"
                >
                  <ChevronDown className="size-3.5 shrink-0" />
                  Показать всех ({managers.length})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onAddManager(company.id || "")}
                  className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-card2 hover:text-fg"
                >
                  <Plus className="size-3.5 shrink-0" />
                  Добавить контакт
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onAddManager(company.id || "")}
              className="flex w-full cursor-pointer items-center gap-2 border-t border-border-subtle px-4 py-3 text-sm text-fg-muted transition-colors hover:bg-bg-card2 hover:text-fg"
            >
              <Users className="size-4 shrink-0 text-fg-icon" />
              Пока нет контактов — добавить представителя
            </button>
          )}

          {/* Подвал реквизитов: фиксированный ритм, длинные значения обрезаются */}
          {(company.address ||
            company.phone ||
            company.email ||
            websiteHref) && (
            <footer className="mt-auto grid grid-cols-1 gap-x-6 gap-y-1 border-t border-border-subtle px-4 py-3 text-xs text-fg-muted @[24rem]:grid-cols-2">
              {company.address && (
                <span
                  className="flex min-w-0 items-center gap-1.5"
                  title={company.address}
                >
                  <MapPin className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">{company.address}</span>
                </span>
              )}
              {company.phone && (
                <a
                  href={telHref(company.phone)}
                  title={company.phone}
                  className="flex min-w-0 items-center gap-1.5 font-mono tabular-nums transition-colors hover:text-fg"
                >
                  <Phone className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">{company.phone}</span>
                </a>
              )}
              {company.email && (
                <a
                  href={`mailto:${company.email}`}
                  title={company.email}
                  className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-fg"
                >
                  <Mail className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">{company.email}</span>
                </a>
              )}
              {websiteHref && websiteLabel && (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                  title={websiteLabel}
                  className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-fg"
                >
                  <Globe className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">{websiteLabel}</span>
                </a>
              )}
            </footer>
          )}

          {/* Заметка сворачиваемая: длинный текст не ломает ритм сетки */}
          {company.note && (
            <details className="group/note border-t border-border-subtle">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-card2 hover:text-fg">
                <ChevronDown className="size-3.5 shrink-0 transition-transform group-open/note:rotate-180" />
                Заметка
              </summary>
              <p className="whitespace-pre-line px-4 pb-3 text-xs leading-relaxed text-fg-body">
                {company.note}
              </p>
            </details>
          )}
        </article>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Удалить компанию «{company.name}»?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {managers.length > 0
                  ? `Компания будет удалена. Её контакты (${pluralizeContacts(managers.length)}) ` +
                    `останутся в справочнике как независимые специалисты. Материалы этого поставщика сохранятся.`
                  : "Компания будет удалена. Материалы этого поставщика сохранятся."}
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
    if (prevProps.company !== nextProps.company) {
      // Сравниваем по ключевым свойствам компании
      if (
        prevProps.company.id !== nextProps.company.id ||
        prevProps.company.name !== nextProps.company.name ||
        prevProps.company.address !== nextProps.company.address ||
        prevProps.company.phone !== nextProps.company.phone ||
        prevProps.company.email !== nextProps.company.email ||
        prevProps.company.website !== nextProps.company.website ||
        prevProps.company.note !== nextProps.company.note ||
        prevProps.company.logo_url !== nextProps.company.logo_url ||
        !areCategoriesEqual(
          prevProps.company.category,
          nextProps.company.category,
        )
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
