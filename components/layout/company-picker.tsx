"use client";

import { useMemo, useState } from "react";
import { Building2, Check, ChevronsUpDown, Plus, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { CompanyDialog } from "@/components/contacts/company-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Компания в едином списке выбора: поставщик или подрядчик. */
export type CompanyOption = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  note?: string | null;
};

/** Менеджер (контакт) — выбирается вместе с компанией, если список передан. */
export type ContactOption = {
  id: string;
  name: string;
  company_id: string | null;
};

/** Что выбрал пользователь: `contactId` заполнен только для контакта. */
export type CompanySelection = {
  companyId: string | null;
  contactId: string | null;
  /** Имя выбранной компании — для снапшотов, чтобы подпись обновилась сразу. */
  companyName: string;
};

/**
 * Выбор поставщика (компании) и — если передан список контактов — менеджера.
 *
 * Единая точка входа для всех мест, где заполняется поставщик: библиотека
 * материалов, ручная позиция спецификации, состав позиции. Смысл один —
 * если при поиске компании с таким названием нет, её можно завести прямо
 * здесь: открывается карточка компании с предзаполненным названием, а после
 * сохранения новая компания сразу подставляется в поле.
 *
 * Списки компаний живут в состоянии родителя: созданная запись приходит в
 * `onCompanyCreated`, родитель кладёт её к себе — и подпись поля не ждёт
 * повторной загрузки страницы (`revalidatePath` приедет позже).
 */
export function CompanyPicker({
  orgSlug,
  companies,
  contacts,
  value,
  contactValue = null,
  onChange,
  onCompanyCreated,
  onOpenCreate,
  placeholder = "Выберите компанию...",
  searchPlaceholder = "Поиск компании...",
  emptyText = "Поставщик не найден.",
  clearLabel = "Без поставщика",
  createLabel = "Добавить компанию",
  disabled = false,
  className,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  orgSlug: string;
  companies: CompanyOption[];
  /** Передан — в списке появляются менеджеры, а выбор контакта задаёт компанию. */
  contacts?: ContactOption[];
  value: string | null;
  contactValue?: string | null;
  onChange: (selection: CompanySelection) => void;
  onCompanyCreated?: (company: CompanyOption) => void;
  /**
   * Передан — карточку новой компании открывает родитель (например, чтобы
   * показать её поверх своей модалки и обработать сохранение самому).
   *
   * Родитель обязан позвать `onCreated` с сохранённой компанией: только так
   * `CompanyPicker` узнаёт результат создания и выбирает её — в этом сценарии
   * своего `CompanyDialog` у него нет (см. `handleCompanyCreated`).
   */
  onOpenCreate?: (
    name: string,
    onCreated: (company: CompanyOption) => void,
  ) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  clearLabel?: string;
  createLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Пробрасывается на кнопку-триггер (FormControl: id, aria-*). */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** Название для новой компании — снимок поискового запроса на момент клика. */
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  /** Созданные в этом сеансе компании: видны до прихода свежих пропсов. */
  const [created, setCreated] = useState<CompanyOption[]>([]);

  const allCompanies = useMemo(() => {
    if (created.length === 0) return companies;
    const known = new Set(companies.map((c) => c.id));
    return [...companies, ...created.filter((c) => !known.has(c.id))];
  }, [companies, created]);

  const companyNames = useMemo(
    () => new Map(allCompanies.map((c) => [c.id, c.name])),
    [allCompanies],
  );

  const company = allCompanies.find((c) => c.id === value) ?? null;
  const allContacts = contacts ?? [];
  const contact = allContacts.find((c) => c.id === contactValue) ?? null;

  /** Список контактов ограничен выбранной компанией (свободные — всегда видны). */
  const availableContacts = allContacts.filter(
    (c) => !value || c.company_id === value || c.company_id === null,
  );

  const q = query.trim().toLowerCase();
  const filteredCompanies = q
    ? allCompanies.filter((c) => c.name.toLowerCase().includes(q))
    : allCompanies;
  const filteredContacts = q
    ? availableContacts.filter((c) =>
        `${c.name} ${companyNames.get(c.company_id ?? "") ?? ""}`
          .toLowerCase()
          .includes(q),
      )
    : availableContacts;

  const trimmed = query.trim();
  /** Компания с ровно таким названием уже есть — создавать такую же незачем. */
  const canCreate =
    trimmed.length > 0 &&
    !allCompanies.some((c) => c.name.trim().toLowerCase() === q);

  const contactCompanyName = contact
    ? companyNames.get(contact.company_id ?? "")
    : undefined;
  const label = contact
    ? `${contact.name}${contactCompanyName ? ` (${contactCompanyName})` : ""}`
    : (company?.name ?? null);

  /**
   * Сообщить наверх о выборе и закрыть список. Имя компании едет вместе с id:
   * вкладки спецификации показывают снапшот имени, и родителю не нужен
   * повторный поиск по списку (свежесозданной компании в пропсах ещё нет).
   */
  const pick = (
    companyId: string | null,
    contactId: string | null = null,
    companyName?: string,
  ) => {
    onChange({
      companyId,
      contactId,
      companyName: companyId
        ? (companyName ?? companyNames.get(companyId) ?? "")
        : "",
    });
    setOpen(false);
  };

  /**
   * Единый обработчик сохранённой компании в `CompanyDialog` — неважно, кто его
   * отрисовал: сам `CompanyPicker` или родитель по `onOpenCreate` (см.
   * `startCreate`). Порядок важен: сначала компания попадает в локальный список
   * (подпись поля не должна ждать свежих пропсов), затем выбор уходит наверх, и
   * только потом родитель кладёт её в свой справочник — от этого шага подпись
   * больше не зависит. Менеджер всегда сбрасывается: у новой компании контактов
   * ещё нет.
   */
  const handleCompanyCreated = (company: CompanyOption) => {
    setCreating(false);
    const option: CompanyOption = {
      id: company.id,
      name: company.name,
      phone: company.phone,
      email: company.email,
      website: company.website,
      address: company.address,
      note: company.note,
    };
    setCreated((prev) =>
      prev.some((c) => c.id === option.id) ? prev : [...prev, option],
    );
    // Назначение поставщика и есть результат создания компании: id и имя отдаём
    // одним вызовом, чтобы подпись поля и снапшот имени обновились сразу, без
    // ожидания повторной загрузки справочника (`revalidatePath` приедет позже).
    pick(option.id, null, option.name);
    // Список компаний родителя обновляем после `pick`: выбор к этому моменту уже
    // отправлен, поэтому лишний шаг не задерживает подпись поля.
    onCompanyCreated?.(option);
    toast.success(`Компания «${option.name}» создана и выбрана`, {
      description: "Она уже указана как поставщик.",
    });
  };

  /**
   * Карточка компании перекрывает поповер: сначала закрываем список, затем
   * (после кадра) открываем диалог — иначе фокус возвращается в поиск и
   * диалог остаётся без фокуса.
   */
  const startCreate = () => {
    setDraftName(trimmed);
    setQuery("");
    setOpen(false);
    if (onOpenCreate) {
      onOpenCreate(trimmed, handleCompanyCreated);
      return;
    }
    requestAnimationFrame(() => setCreating(true));
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next, eventDetails) => {
          if (disabled) {
            eventDetails.cancel();
            return;
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              type="button"
              role="combobox"
              aria-expanded={open}
              id={id}
              aria-describedby={ariaDescribedBy}
              aria-invalid={ariaInvalid}
              disabled={disabled}
              className={cn(
                "h-10 w-full justify-between bg-bg-card font-normal",
                !label && "text-fg-muted",
                className,
              )}
            >
              {contact ? (
                <span className="flex min-w-0 items-center gap-2">
                  <User className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{label}</span>
                </span>
              ) : company ? (
                <span className="flex min-w-0 items-center gap-2">
                  <Building2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{label}</span>
                </span>
              ) : (
                <span className="truncate">{placeholder}</span>
              )}
              <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          }
        />
        <PopoverContent
          className="w-(--anchor-width) min-w-72 p-0 bg-bg-card"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
            />
            <CommandList>
              <CommandItem
                value="__none__"
                onSelect={() => pick(null, null)}
              >
                <Check
                  className={cn(
                    "mr-2 size-4",
                    !value && !contactValue ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="text-muted-foreground">{clearLabel}</span>
              </CommandItem>

              {filteredCompanies.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup
                    heading={allContacts.length > 0 ? "Компании" : undefined}
                  >
                    {filteredCompanies.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.id}
                        onSelect={() => pick(c.id, null, c.name)}
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4",
                            value === c.id && !contactValue
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <Building2 className="mr-1 size-4 text-muted-foreground" />
                        <span className="truncate">{c.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {filteredContacts.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Менеджеры">
                    {filteredContacts.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.id}
                        onSelect={() => pick(c.company_id, c.id)}
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4",
                            contactValue === c.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <User className="mr-1 size-4 text-muted-foreground" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{c.name}</span>
                          {companyNames.get(c.company_id ?? "") && (
                            <span className="truncate text-xs text-muted-foreground">
                              {companyNames.get(c.company_id ?? "")}
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {q && filteredCompanies.length === 0 && (
                <CommandEmpty>{emptyText}</CommandEmpty>
              )}

              <CommandSeparator />
              <CommandItem value="__create__" onSelect={startCreate}>
                <Plus className="mr-2 size-4 text-fg-brand" />
                <span className="truncate">
                  {canCreate ? `Создать компанию «${trimmed}»` : createLabel}
                </span>
              </CommandItem>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {creating && (
        <CompanyDialog
          orgSlug={orgSlug}
          open={creating}
          initialName={draftName}
          onClose={() => setCreating(false)}
          onSuccess={handleCompanyCreated}
        />
      )}
    </>
  );
}
