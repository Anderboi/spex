"use client";

import React, { useState, useTransition, useOptimistic, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  Loader2,
} from "lucide-react";
import { CompanyCard } from "./company-card";
// import { CompanyDialog, ManagerDialog } from "./contact-dialogs";
import { initials } from "@/lib/utils";
import { CompanyInput, ContactInput } from "@/lib/validations";
import { deleteCompany, deleteContact } from "@/app/contacts/actions";
import PageHeader from "../layout/PageHeader";
import { CompanyDialog } from "./contact-dialogs";

interface ContactsViewProps {
  initialCompanies: CompanyInput[];
  initialContacts: ContactInput[];
}

export default function ContactsView({
  initialCompanies,
  initialContacts,
}: ContactsViewProps) {
  const [tab, setTab] = useState<"companies" | "independent">("companies");
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  // Состояния диалогов
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [managerDialog, setManagerDialog] = useState<{
    open: boolean;
    companyId?: string;
    independent?: boolean;
  }>({ open: false });

  // Optimistic UI для отзывчивого интерфейса при удалении
  const [optimisticCompanies, setOptimisticCompanies] = useOptimistic(
    initialCompanies,
    (state, idToRemove: string) => state.filter((c) => c.id !== idToRemove),
  );

  const [optimisticContacts, setOptimisticContacts] = useOptimistic(
    initialContacts,
    (state, idToRemove: string) => state.filter((c) => c.id !== idToRemove),
  );

  // Группировка независимых контактов
  const independentContacts = useMemo(
    () => optimisticContacts.filter((m) => !m.id),
    [optimisticContacts],
  );

  // Фильтрация поиска по компаниям и контактам
  const q = query.trim().toLowerCase();

  const filteredCompanies = useMemo(() => {
    if (!q) return optimisticCompanies;
    return optimisticCompanies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q) ||
        c.address?.toLowerCase().includes(q),
    );
  }, [optimisticCompanies, q]);

  const filteredIndependent = useMemo(() => {
    if (!q) return independentContacts;
    return independentContacts.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.title?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q),
    );
  }, [independentContacts, q]);

  // Обработчики удаления с оптимистичным обновлением
  const handleRemoveCompany = (id: string) => {
    startTransition(async () => {
      setOptimisticCompanies(id);
      await deleteCompany(id);
    });
  };

  const handleRemoveContact = (id: string) => {
    startTransition(async () => {
      setOptimisticContacts(id);
      await deleteContact(id);
    });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
            <div>
              <PageHeader>Контакты</PageHeader>
              <p className="mt-2 max-w-xl text-pretty text-sm text-muted-foreground">
                Компании, поставщики и представители. Управляйте справочником и
                привязывайте их к позициям спецификации.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="lg"
                className="flex-1 whitespace-nowrap sm:flex-none"
                onClick={() =>
                  setManagerDialog({ open: true, independent: true })
                }
              >
                <UserPlus className="mr-2 size-4" /> Добавить специалиста
              </Button>
              <Button
                size="lg"
                className="flex-1 whitespace-nowrap sm:flex-none"
                onClick={() => setCompanyDialogOpen(true)}
              >
                <Plus className="mr-2 size-4" /> Добавить компанию
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 basis-full sm:basis-auto sm:min-w-56">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по названию, категории, имени..."
                className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </div>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Building2 className="size-4" /> {optimisticCompanies.length}{" "}
                компаний
              </span>
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Users className="size-4" /> {optimisticContacts.length}{" "}
                контактов
              </span>
            </div>
          </div>

          {/* Табы */}
          <div role="tablist" className="flex gap-1 border-b border-border">
            <TabButton
              active={tab === "companies"}
              onClick={() => setTab("companies")}
            >
              Компании
              <Count>{optimisticCompanies.length}</Count>
            </TabButton>
            <TabButton
              active={tab === "independent"}
              onClick={() => setTab("independent")}
            >
              Специалисты
              <Count>{independentContacts.length}</Count>
            </TabButton>
          </div>
        </div>
      </header>

      {/* Основной контент */}
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {tab === "companies" ? (
          filteredCompanies.length === 0 ? (
            <EmptyState
              icon={<Building2 className="size-6" />}
              title={q ? "Ничего не найдено" : "Нет компаний"}
              body={
                q
                  ? "Попробуйте изменить поисковый запрос."
                  : "Добавьте первого поставщика или салон."
              }
              action={
                !q && (
                  <Button onClick={() => setCompanyDialogOpen(true)}>
                    <Plus className="mr-2 size-4" /> Добавить компанию
                  </Button>
                )
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {filteredCompanies.map((c) => (
                <CompanyCard
                  key={c.id}
                  company={c}
                  managers={optimisticContacts.filter((m) => m.id === c.id)}
                  onAddManager={(companyId) =>
                    setManagerDialog({ open: true, companyId })
                  }
                  onRemoveManager={handleRemoveContact}
                  onRemoveCompany={handleRemoveCompany}
                />
              ))}
            </div>
          )
        ) : filteredIndependent.length === 0 ? (
          <EmptyState
            icon={<UserPlus className="size-6" />}
            title={q ? "Ничего не найдено" : "Нет независимых контактов"}
            body={
              q
                ? "Попробуйте изменить запрос."
                : "Добавьте фрилансеров, мастеров или подрядчиков."
            }
            action={
              !q && (
                <Button
                  onClick={() =>
                    setManagerDialog({ open: true, independent: true })
                  }
                >
                  <UserPlus className="mr-2 size-4" /> Добавить контакт
                </Button>
              )
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredIndependent.map((m) => (
              <li
                key={m.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground">
                  {initials(m.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-foreground">
                      {m.name}
                    </span>
                    {m.title && (
                      <span className="text-xs text-muted-foreground">
                        {m.title}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {m.email && (
                      <a
                        href={`mailto:${m.email}`}
                        className="hover:text-foreground"
                      >
                        {m.email}
                      </a>
                    )}
                    {m.phone && (
                      <a
                        href={`tel:${m.phone}`}
                        className="hover:text-foreground"
                      >
                        {m.phone}
                      </a>
                    )}
                  </div>
                  {m.note && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {m.note}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Удалить ${m.name}`}
                  onClick={() => handleRemoveContact(m.id!)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* Диалоговые окна */}
      <CompanyDialog
        open={companyDialogOpen}
        onClose={() => setCompanyDialogOpen(false)}
      />

      {/* <ManagerDialog
        open={managerDialog.open}
        onClose={() => setManagerDialog({ open: false })}
        companies={optimisticCompanies}
        fixedCompanyId={managerDialog.companyId}
        independentOnly={managerDialog.independent}
      /> */}
    </div>
  );
}

// Вспомогательные микрокомпоненты
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "border-brand text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
      {children}
    </span>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        {icon}
      </div>
      <h3 className="mt-4 font-serif text-lg text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
