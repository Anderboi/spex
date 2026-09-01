"use client";

import { useMemo, useOptimistic, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Building2, Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import { CompanyCard } from "./company-card";
import { CompanyRow, ContactRow } from "@/lib/validations";
import { deleteCompany, deleteContact } from "@/actions/contacts";
import { CompanyDialog } from "./company-dialog";
import { ContactDialog } from "./contact-dialog";
import { ContactCard } from "./contact-card";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { useContactsUrl } from "./use-contacts-url";
import { useDialogUrl } from "@/hooks/use-dialog-url";
import type { ContactsTab } from "@/lib/types";

/** Доп. параметры открытия контактных диалогов, удаляемые при закрытии. */
const CONTACT_DIALOG_CLEANUP = ["company_id", "independent"];

interface ContactsListProps {
  orgSlug: string;
  companies: CompanyRow[];
  independentContacts: ContactRow[];
  managers: ContactRow[];
  companiesCount: number;
  independentCount: number;
  tab: ContactsTab;
}

type DirectoryData = {
  companies: CompanyRow[];
  managers: ContactRow[];
  independentContacts: ContactRow[];
};

type DirectoryAction =
  | { type: "removeCompany"; companyId: string }
  | { type: "removeContact"; contactId: string };

function directoryReducer(
  state: DirectoryData,
  action: DirectoryAction,
): DirectoryData {
  switch (action.type) {
    case "removeCompany":
      return {
        companies: state.companies.filter((c) => c.id !== action.companyId),
        managers: state.managers.filter(
          (m) => m.company_id !== action.companyId,
        ),
        independentContacts: state.independentContacts,
      };
    case "removeContact":
      return {
        companies: state.companies,
        managers: state.managers.filter((m) => m.id !== action.contactId),
        independentContacts: state.independentContacts.filter(
          (c) => c.id !== action.contactId,
        ),
      };
  }
}

export function ContactsList({
  orgSlug,
  companies,
  independentContacts,
  managers,
  companiesCount,
  independentCount,
  tab,
}: ContactsListProps) {
  const searchParams = useSearchParams();
  const { update, isPending } = useContactsUrl();
  const {
    value: dialog,
    hrefFor,
    open: openDialog,
    close: closeDialog,
  } = useDialogUrl("dialog", CONTACT_DIALOG_CLEANUP);
  const [, startTransition] = useTransition();

  const query = searchParams.get("query") ?? "";

  // Диалоги управляются URL:
  //   ?dialog=company                — добавить компанию
  //   ?dialog=contact                — добавить контакт
  //   ?dialog=contact&company_id=X   — контакт для конкретной компании
  //   ?dialog=contact&independent=1  — независимый специалист
  const isCompanyOpen = dialog === "company";
  const isContactOpen = dialog === "contact";
  const fixedCompanyId = searchParams.get("company_id") ?? undefined;
  const independentOnly = searchParams.get("independent") === "1";

  const baseData = useMemo<DirectoryData>(
    () => ({ companies, managers, independentContacts }),
    [companies, managers, independentContacts],
  );

  const [data, dispatch] = useOptimistic(baseData, directoryReducer);

  const managersByCompanyId = useMemo(() => {
    const map = new Map<string, ContactRow[]>();

    for (const contact of data.managers) {
      if (contact.company_id) {
        const list = map.get(contact.company_id) || [];
        list.push(contact);
        map.set(contact.company_id, list);
      }
    }

    return map;
  }, [data.managers]);

  const expandByDefault = data.companies.length <= 5;

  const handleRemoveCompany = (id: string) => {
    startTransition(async () => {
      dispatch({ type: "removeCompany", companyId: id });

      const res = await deleteCompany(orgSlug, id);
      if (!res?.success)
        toast.error("Не удалось удалить компанию", {
          description: res.error,
        });
    });
  };

  const handleRemoveContact = (id: string) => {
    startTransition(async () => {
      dispatch({ type: "removeContact", contactId: id });

      try {
        await deleteContact(orgSlug, id);
        toast.success("Контакт удален");
      } catch (error) {
        toast.error("Не удалось удалить контакт.");
        console.error("Failed to delete contact:", error);
      }
    });
  };

  return (
    <>
      <div
        role="toolbar"
        className={`flex flex-col gap-4 transition-opacity ${isPending ? "opacity-60" : ""}`}
      >
        <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
          <TabButton
            active={tab === "companies"}
            onClick={() => update({ tab: "companies" })}
          >
            Компании
            <Count>{companiesCount}</Count>
          </TabButton>
          <TabButton
            active={tab === "independent"}
            onClick={() => update({ tab: "independent" })}
          >
            Специалисты
            <Count>{independentCount}</Count>
          </TabButton>
        </div>
      </div>

      <ul>
        {tab === "companies" ? (
          data.companies.length === 0 ? (
            <EmptyState
              icon={<Building2 className="size-6" />}
              title={query ? "Ничего не найдено" : "Нет компаний"}
              body={
                query
                  ? "Попробуйте изменить поисковый запрос."
                  : "Добавьте первого поставщика или салон."
              }
              action={
                !query && (
                  <Button
                    nativeButton={false}
                    render={<Link href={hrefFor("company")} />}
                  >
                    <Plus className="mr-2 size-4" /> Добавить компанию
                  </Button>
                )
              }
            />
          ) : (
            <li className="flex flex-col gap-4">
              {data.companies.map((c) => (
                <CompanyCard
                  key={c.id}
                  company={c}
                  managers={managersByCompanyId.get(c.id) || []}
                  onAddManager={(companyId) =>
                    openDialog("contact", { company_id: companyId })
                  }
                  onRemoveManager={handleRemoveContact}
                  onRemoveCompany={handleRemoveCompany}
                  defaultOpen={expandByDefault}
                />
              ))}
            </li>
          )
        ) : data.independentContacts.length === 0 ? (
          <EmptyState
            icon={<UserPlus className="size-6" />}
            title={query ? "Ничего не найдено" : "Нет независимых контактов"}
            body={
              query
                ? "Попробуйте изменить запрос."
                : "Добавьте фрилансеров, мастеров или подрядчиков."
            }
            action={
              !query && (
                <Button
                  nativeButton={false}
                  render={
                    <Link href={hrefFor("contact", { independent: "1" })} />
                  }
                >
                  <UserPlus className="mr-2 size-4" /> Добавить контакт
                </Button>
              )
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.independentContacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onRemove={handleRemoveContact}
              />
            ))}
          </ul>
        )}
      </ul>

      <CompanyDialog
        orgSlug={orgSlug}
        open={isCompanyOpen}
        onClose={closeDialog}
      />
      <ContactDialog
        orgSlug={orgSlug}
        open={isContactOpen}
        companies={data.companies}
        fixedCompanyId={fixedCompanyId}
        independentOnly={independentOnly}
        onClose={closeDialog}
      />
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
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

function Count({ children }: { children: ReactNode }) {
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
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
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
