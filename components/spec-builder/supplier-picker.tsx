"use client";

import { useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronsUpDown,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import CopyButton from "../layout/copy-button";

export function SupplierPicker({
  companies,
  contacts,
  companyId,
  contactId,
  snapshot,
  onChange,
  onCreateCompany,
}: {
  companies: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    note?: string;
  }[];
  contacts: {
    id: string;
    name: string;
    company_id: string | null;
    phone: string | null;
    email: string | null;
  }[];
  companyId: string | null;
  contactId: string | null;
  snapshot: string;
  onChange: (companyId: string | null, contactId: string | null) => void;
  onCreateCompany?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const company = companies.find((c) => c.id === companyId) ?? null;
  const available = contacts.filter(
    (c) => !companyId || c.company_id === companyId || c.company_id === null,
  );
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const renamed = snapshot && company && snapshot !== company.name;

  const q = query.trim().toLowerCase();
  const filteredCompanies = q
    ? companies.filter((c) => c.name.toLowerCase().includes(q))
    : companies;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-fg-muted">
          Компания
        </span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className={cn(
                  "h-10 w-full justify-between bg-bg-card font-normal",
                  !company && "text-fg-muted",
                )}
              >
                {company ? (
                  <span className="truncate">{company.name}</span>
                ) : (
                  <span>Не указана</span>
                )}
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            }
          />
          <PopoverContent className="w-full p-0 bg-bg-card" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder="Поиск компании..."
              />
              <CommandList>
                <CommandItem
                  value="none"
                  onSelect={() => {
                    onChange(null, null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      !companyId ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="text-muted-foreground">Не указана</span>
                </CommandItem>
                {filteredCompanies.map((c) => {
                  const isSelected = companyId === c.id;
                  return (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => {
                        onChange(c.id, null);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{c.name}</span>
                    </CommandItem>
                  );
                })}
                {onCreateCompany && (
                  <>
                    <CommandSeparator />
                    <CommandItem
                      value="__create__"
                      onSelect={() => {
                        onCreateCompany(query.trim());
                        setOpen(false);
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4 text-fg-brand" />
                      {q && filteredCompanies.length === 0
                        ? `Создать компанию «${query.trim()}»`
                        : "Добавить компанию"}
                    </CommandItem>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {renamed && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-[12.5px] text-amber-700">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />В спецификации
          сохранено прежнее название «{snapshot}». Оно обновится при следующем
          изменении позиции.
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold font-mono uppercase tracking-wider text-fg-muted">
          Менеджер
        </span>
        <select
          value={contactId ?? ""}
          onChange={(e) => onChange(companyId, e.target.value || null)}
          className="h-10 rounded-lg border border-border-muted bg-bg-card px-2 text-sm"
        >
          <option value="">Не указан</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {company && (
        <div className="rounded-lg border border-border-muted bg-bg-card2 p-3 text-[13px]">
          <p className="font-medium text-lg w-full text-center pb-2">
            {company.name}
          </p>
          {company.phone && (
            <ContactDataField label="Телефон">
              <a
                href={`tel:${company.phone}`}
                className="block text-fg-brand hover:underline col-span-2"
              >
                {company.phone}
              </a>
            </ContactDataField>
          )}
          {company.email && (
            <ContactDataField label="Эл. почта">
              <a
                href={`mailto:${company.email}`}
                className="block text-fg-brand hover:underline col-span-2"
              >
                {company.email}
              </a>
            </ContactDataField>
          )}
          {company.address && (
            <ContactDataField label="Адрес">
              <span>{company.address}</span>
              <CopyButton textToCopy={company.address} />
            </ContactDataField>
          )}
        </div>
      )}
      {contact && (
        <div className="rounded-lg border border-border-muted bg-bg-card2 p-3 text-[13px]">
          <p className="font-medium text-lg w-full text-center pb-2">
            {contact.name}
          </p>
          {contact.phone && (
            <ContactDataField label="Телефон">
              <a
                href={`tel:${contact.phone}`}
                className="block text-fg-brand hover:underline"
              >
                {contact.phone}
              </a>
            </ContactDataField>
          )}

          {contact.email && (
            <ContactDataField label="Эл. почта">
              <a
                href={`mailto:${contact.email}`}
                className="block text-fg-brand hover:underline"
              >
                {contact.email}
              </a>
            </ContactDataField>
          )}
        </div>
      )}
    </div>
  );
}

const ContactDataField = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => {
  return (
    <div className="grid grid-cols-3 items-center gap-2 h-6">
      <span className="text-fg-muted text-[12px] text-right font-mono">
        {label}
      </span>
      <div className="col-span-2 flex-wrap items-center flex gap-2">
        {children}
      </div>
    </div>
  );
};
