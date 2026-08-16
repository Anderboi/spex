"use client";

import React, {
  useState,
  useTransition,
  useOptimistic,
  useMemo,
  useDeferredValue,
  useCallback,
} from "react";
import { Button } from "@/components/ui/button";
import { Building2, Plus, Search, UserPlus } from "lucide-react";
import { CompanyCard } from "./company-card";
import { CompanyRow, ContactRow } from "@/lib/validations";
import {
  deleteCompany,
  deleteContact,
} from "@/app/(protected)/contacts/actions";
import { CompanyDialog } from "./company-dialog";
import { ContactDialog } from "./contact-dialog";
import TypeChipsSection from "../spec-builder/components/TypeChipsSection";
import { ContactCard } from "./contact-card";
import { normPhone, normText } from "@/lib/utils";
import { toast } from "sonner";

interface ContactsViewProps {
  initialCompanies: CompanyRow[];
  initialContacts: ContactRow[];
}

type CompanyAction = { type: "remove"; id: string };
type ContactAction =
  | { type: "remove"; id: string }
  | { type: "detachFromCompany"; companyId: string };

export default function ContactsView({
  initialCompanies,
  initialContacts,
}: ContactsViewProps) {
  const [tab, setTab] = useState<"companies" | "independent">("companies");
  const [query, setQuery] = useState("");

  const deferredQuery = useDeferredValue(query);

  const qRaw = deferredQuery.trim();
  const qText = useMemo(() => normText(qRaw), [qRaw]);
  const qDigits = useMemo(() => normPhone(qRaw), [qRaw]);

  const [selectedCategory, setSelectedCategory] = useState("Все типы");
  const [, startTransition] = useTransition();

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
    (state, action: CompanyAction) => {
      switch (action.type) {
        case "remove":
          return state.filter((c) => c.id !== action.id);
        default:
          return state;
      }
    },
  );

  const [optimisticContacts, setOptimisticContacts] = useOptimistic(
    initialContacts,
    (state, action: ContactAction) => {
      switch (action.type) {
        case "remove":
          return state.filter((c) => c.id !== action.id);
        case "detachFromCompany":
          // Удаляем контакты привязанные к удаляемой компании
          return state.filter((c) => c.company_id !== action.companyId);
        default:
          return state;
      }
    },
  );

  const [contacts, applyContact] = useOptimistic(
    initialContacts,
    (state, a: ContactAction) =>
      a.type === "remove"
        ? state.filter((c) => c.id !== a.id)
        : state.map((c) =>
            c.company_id === a.companyId ? { ...c, company_id: null } : c,
          ),
  );

  const expandByDefault = optimisticCompanies.length <= 5;

  const managersByCompanyId = useMemo(() => {
    const map = new Map<string, ContactRow[]>();

    for (const contact of optimisticContacts) {
      if (contact.company_id) {
        const list = map.get(contact.company_id) || [];
        list.push(contact);
        map.set(contact.company_id, list);
      }
    }

    return map;
  }, [optimisticContacts]);

  const independentContacts = useMemo(
    () => optimisticContacts.filter((m) => !m.company_id),
    [optimisticContacts],
  );

  // Фильтрация поиска по компаниям и контактам
  const q = deferredQuery.trim().toLowerCase();

  const indexedCompanies = useMemo(() => {
    return optimisticCompanies.map((c) => {
      const companyManagers = managersByCompanyId.get(c.id) || [];

      // Собираем весь текстовый контент компании и ее менеджеров в один массив
      const textParts = [
        c.name,
        c.address,
        c.note,
        Array.isArray(c.category) ? c.category.join(" ") : c.category,
        ...companyManagers.flatMap((m) => [m.name, m.title, m.email, m.note]),
      ];

      // Собираем все телефоны (компании + менеджеров)
      const phoneParts = [c.phone, ...companyManagers.map((m) => m.phone)];

      return {
        company: c,
        // Предрассчитанная нормализованная текстовая строка поиска
        searchText: normText(textParts.filter(Boolean).join(" ")),
        // Предрассчитанный массив из чистых цифр для всех связанных телефонов
        searchPhones: phoneParts.map(normPhone).filter(Boolean),
      };
    });
  }, [optimisticCompanies, managersByCompanyId]);

  // Фильтрация компаний
  const filteredCompanies = useMemo(() => {
    const isAllCategories =
      !selectedCategory ||
      selectedCategory === "" ||
      selectedCategory === "Все типы";

    return indexedCompanies
      .filter(({ company, searchText, searchPhones }) => {
        // Проверка категории
        if (!isAllCategories) {
          const categories = Array.isArray(company.category)
            ? company.category
            : [company.category];
          if (!categories.includes(selectedCategory)) return false;
        }

        // Если поискового запроса нет — отдаем результат
        if (!qText && !qDigits) return true;

        // Поиск по тексту (буквы, ё/е, email и т.д.)
        const matchesText = qText ? searchText.includes(qText) : false;

        // Поиск по цифрам телефона (если в поиске ввели хотя бы одну цифру)
        const matchesPhone = qDigits
          ? searchPhones.some((phoneDigits) => phoneDigits.includes(qDigits))
          : false;

        return matchesText || matchesPhone;
      })
      .map((item) => item.company);
  }, [indexedCompanies, selectedCategory, qText, qDigits]);

  // Фильтрация специалистов
  const indexedIndependent = useMemo(() => {
    return independentContacts.map((m) => {
      const textParts = [
        m.name,
        m.title,
        m.email,
        m.note,
        Array.isArray(m.category) ? m.category.join(" ") : m.category,
      ];

      return {
        contact: m,
        searchText: normText(textParts.filter(Boolean).join(" ")),
        searchPhone: normPhone(m.phone),
      };
    });
  }, [independentContacts]);

  const filteredIndependent = useMemo(() => {
    const isAllCategories =
      !selectedCategory ||
      selectedCategory === "" ||
      selectedCategory === "Все типы";

    return indexedIndependent
      .filter(({ contact, searchText, searchPhone }) => {
        if (!isAllCategories) {
          const categories = Array.isArray(contact.category)
            ? contact.category
            : [contact.category];
          if (!categories.includes(selectedCategory)) return false;
        }

        if (!qText && !qDigits) return true;

        const matchesText = qText ? searchText.includes(qText) : false;
        const matchesPhone = qDigits ? searchPhone.includes(qDigits) : false;

        return matchesText || matchesPhone;
      })
      .map((item) => item.contact);
  }, [indexedIndependent, selectedCategory, qText, qDigits]);
  // Обработчики удаления с оптимистичным обновлением
  const handleRemoveCompany = useCallback(
    (id: string) => {
      startTransition(async () => {
        // Оптимистично удаляем компанию и связку ее контактов
        setOptimisticContacts({ type: "remove", id });
        applyContact({
          type: "detachFromCompany",
          companyId: id,
        });

        const res = await deleteCompany(id);
        if (!res?.success)
          toast.error("Не удалось удалить компанию", {
            description: res.error,
          });
      });
    },
    [setOptimisticContacts, applyContact],
  );

  const handleRemoveContact = (id: string) => {
    startTransition(async () => {
      setOptimisticContacts({ type: "remove", id });

      try {
        await deleteContact(id);
        toast.success("Контакт удален");
      } catch (error) {
        toast.error("Не удалось удалить контакт.");
        console.error("Failed to delete contact:", error);
      }
    });
  };

  return (
    <>
      <div role="toolbar" className="flex flex-col gap-4 ">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          {/* title n description */}
          {/* <div>
            <PageTitle>Контакты</PageTitle>
            <p className="text-base text-pretty text-fg-secondary mt-2 font-normal">
              Компании, поставщики и представители. Управляйте справочником и
              привязывайте их к позициям спецификации.
            </p>
          </div> */}
          <div className="flex flex-wrap w-full justify-end items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              className="flex-1 whitespace-nowrap bg-bg sm:flex-none"
              onClick={() =>
                setManagerDialog({ open: true, independent: true })
              }
            >
              <UserPlus className="mr-1 size-4" /> Добавить специалиста
            </Button>
            <Button
              size="lg"
              className="flex-1 bg-fg whitespace-nowrap sm:flex-none"
              onClick={() => setCompanyDialogOpen(true)}
            >
              <Plus className="mr-1 size-4" /> Добавить компанию
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
              className="h-10 w-full rounded-lg border border-input bg-bg-card pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>
        </div>

        <TypeChipsSection
          activeType={selectedCategory}
          setActiveType={setSelectedCategory}
        />

        {/* Табы */}
        <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
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

      {/* Основной контент */}
      <ul>
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
            <li className="flex flex-col gap-4">
              {filteredCompanies.map((c) => (
                <CompanyCard
                  key={c.id}
                  company={c}
                  managers={managersByCompanyId.get(c.id) || []}
                  onAddManager={(companyId) =>
                    setManagerDialog({ open: true, companyId })
                  }
                  onRemoveManager={handleRemoveContact}
                  onRemoveCompany={handleRemoveCompany}
                  defaultOpen={expandByDefault}
                />
              ))}
            </li>
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
            {filteredIndependent.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onRemove={handleRemoveContact}
              />
            ))}
          </ul>
        )}
      </ul>

      {/* Диалоговые окна */}
      {companyDialogOpen && (
        <CompanyDialog
          open={companyDialogOpen}
          onClose={() => setCompanyDialogOpen(false)}
        />
      )}
      {managerDialog.open && (
        <ContactDialog
          open={managerDialog.open}
          companies={optimisticCompanies}
          fixedCompanyId={managerDialog.companyId}
          independentOnly={managerDialog.independent}
          onClose={() => setManagerDialog({ open: false })}
        />
      )}
    </>
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
      className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium font-mono transition-colors ${
        active
          ? "border-fg-brand text-fg"
          : "border-transparent text-fg-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-bg-brand px-1.5 py-0.5 text-xs font-medium text-fg">
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
