"use client";

import { useState } from "react";
import { AlertCircle, Check, ChevronsUpDown, Pencil, Plus } from "lucide-react";
import CopyButton from "../../layout/copy-button";
import Field from "../../layout/modal-field";
import { Avatar } from "../../ui/avatar";
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
import { LEAD_TIME_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { CompanyDialog } from "@/components/contacts/company-dialog";
import { ContactDialog } from "@/components/contacts/contact-dialog";
import {
  CompanyPicker,
  type CompanyOption,
} from "@/components/layout/company-picker";

type ContactEntry = {
  id: string;
  name: string;
  company_id: string | null;
  phone?: string | null;
  email?: string | null;
};

/** Что отдаёт сохранённая карточка менеджера. */
type SavedContact = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  company_id?: string | null;
};

/**
 * Выбор поставщика: компания, её менеджер и срок поставки.
 *
 * Живёт внутри раскрывающегося блока «Поставка» вкладки «Обзор» — отдельной
 * вкладки «Поставка» нет, поэтому здесь же и правка, и карточка компании
 * (телефон, почта, адрес, сайт) с переходом в полную карточку справочника.
 *
 * Порядок чтения — сверху вниз и от общего к частному: компания, её реквизиты,
 * менеджер этой компании, срок поставки. Менеджер поэтому не поле рядом с
 * компанией, а строка под карточкой: там же его телефон и почта, а смена
 * контакта — отдельным действием, а не ещё одним селектом в общей сетке.
 *
 * Списки компаний и контактов приходят от родителя: созданная или изменённая
 * запись сразу попадает в его состояние (`onCompanyCreated`), и подпись поля
 * не ждёт повторной загрузки страницы.
 */
export function SupplierPicker({
  orgSlug,
  companies,
  contacts,
  companyId,
  contactId,
  snapshot,
  leadTime,
  onChange,
  onChangeLeadTime,
  onCreateCompany,
  onCompanyCreated,
  onContactSaved,
}: {
  orgSlug: string;
  companies: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    address?: string | null;
    note?: string | null;
  }[];
  contacts: {
    id: string;
    name: string;
    company_id: string | null;
    phone?: string | null;
    email?: string | null;
  }[];
  companyId: string | null;
  contactId: string | null;
  snapshot: string;
  /** Срок поставки позиции (`SpecItem.leadTime`) — правится здесь же. */
  leadTime: string;
  /**
   * Выбор поставщика. `companyName` — имя выбранной компании: блок «Поставка»
   * показывает снапшот, и без него подпись не обновилась бы до следующего
   * изменения позиции.
   */
  onChange: (
    companyId: string | null,
    contactId: string | null,
    companyName?: string,
  ) => void;
  /** Смена срока поставки: `?` переводит позицию в «срок не указан». */
  onChangeLeadTime: (leadTime: string) => void;
  /**
   * Запрос на создание компании из поиска. Не передан — `CompanyPicker`
   * открывает свой `CompanyDialog` (см. company-picker.tsx).
   */
  onCreateCompany?: (
    name: string,
    onCreated: (company: CompanyOption) => void,
  ) => void;
  /** Компания создана — родитель добавляет её в свой список без перезагрузки. */
  onCompanyCreated?: (company: CompanyOption) => void;
  /** Менеджер создан или изменён — родитель обновляет список контактов. */
  onContactSaved?: (contact: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    company_id?: string | null;
  }) => void;
}) {
  const company = companies.find((c) => c.id === companyId) ?? null;
  /**
   * Контакты для выбора менеджера: контакты выбранной компании плюс «свободные»
   * (без компании) — они тоже могут вести поставку. Список не сужаем до
   * company_id === companyId: у компании может не быть своих контактов, а
   * менеджер у неё всё равно есть.
   */
  const available = contacts.filter(
    (c) => !companyId || c.company_id === companyId || c.company_id === null,
  );
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const renamed = snapshot && company && snapshot !== company.name;

  /** Карточка выбранной компании поверх модалки (правка реквизитов). */
  const [companyCard, setCompanyCard] = useState<CompanyOption | null>(null);
  /** Список менеджеров в поповере и запрос в нём. */
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerQuery, setManagerQuery] = useState("");
  /** Карточка менеджера: создание нового или правка текущего. */
  const [contactCard, setContactCard] = useState<
    { mode: "create" } | { mode: "edit"; contact: ContactEntry } | null
  >(null);
  /**
   * Счётчик открытий карточки создания: `key` карточки должен меняться, иначе
   * повторное открытие покажет поля предыдущего черновика.
   */
  const [managersRefreshKey, setManagersRefreshKey] = useState(0);

  const managerQueryText = managerQuery.trim().toLowerCase();
  const filteredContacts = managerQueryText
    ? available.filter((c) => c.name.toLowerCase().includes(managerQueryText))
    : available;

  /**
   * Варианты срока: штатный список плюс сохранённое значение, если его там нет
   * (срок мог прийти из импорта или из старой записи). Без этого селект
   * показывал бы чужое значение и «съедал» сохранённый срок.
   */
  const leadOptions: string[] = LEAD_TIME_OPTIONS.includes(
    leadTime as (typeof LEAD_TIME_OPTIONS)[number],
  )
    ? [...LEAD_TIME_OPTIONS]
    : [leadTime, ...LEAD_TIME_OPTIONS].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Компания">
        <div className="flex items-center gap-2">
          {/* Единый выбор поставщика: поиск по справочнику и создание
              компании, если её ещё нет (см. CompanyPicker). */}
          <CompanyPicker
            orgSlug={orgSlug}
            companies={companies}
            value={companyId}
            onChange={({ companyId: next, companyName }) => {
              // Имя едет вместе с id: без него блок «Поставка» показал бы
              // старый снапшот до следующего изменения позиции. Пустое имя не
              // затирает снапшот — только явное снятие поставщика.
              if (next && !companyName) onChange(next, null);
              else onChange(next, null, companyName);
            }}
            onOpenCreate={onCreateCompany}
            onCompanyCreated={onCompanyCreated}
            placeholder="Не указана"
            searchPlaceholder="Поиск компании..."
            emptyText="Компания не найдена — создайте её."
            clearLabel="Не указана"
            className="min-w-0 flex-1"
          />
          {/* Полная карточка: контакты компании часто нужно поправить или
              просто посмотреть, не уходя из позиции. */}
          {company && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setCompanyCard(company)}
              aria-label={`Открыть карточку «${company.name}»`}
              title="Карточка компании"
              className="shrink-0"
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
        </div>
      </Field>

      {renamed && (
        <p className="flex items-start gap-2 rounded-lg bg-bg-amber/10 p-2.5 text-[12.5px] text-fg-gold-text">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />В спецификации
          сохранено прежнее название «{snapshot}». Оно обновится при следующем
          изменении позиции.
        </p>
      )}

      {company && (
        <div className="rounded-lg border border-border-muted bg-bg-card px-3 py-2.5 text-[13px]">
          <div className="flex items-center gap-2.5">
            <Avatar size="sm" />
            <p className="min-w-0 flex-1 truncate font-medium">{company.name}</p>
          </div>
          {(company.phone ||
            company.email ||
            company.address ||
            company.website) && (
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
              {company.phone && (
                <ContactDataField label="Телефон">
                  <a
                    href={`tel:${company.phone}`}
                    className="text-fg-brand hover:underline"
                  >
                    {company.phone}
                  </a>
                </ContactDataField>
              )}
              {company.email && (
                <ContactDataField label="Эл. почта">
                  <a
                    href={`mailto:${company.email}`}
                    className="truncate text-fg-brand hover:underline"
                  >
                    {company.email}
                  </a>
                </ContactDataField>
              )}
              {company.address && (
                <ContactDataField label="Адрес">
                  <span className="truncate">{company.address}</span>
                  <CopyButton textToCopy={company.address} />
                </ContactDataField>
              )}
              {company.website && (
                <ContactDataField label="Сайт">
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-fg-brand hover:underline"
                  >
                    {company.website}
                  </a>
                </ContactDataField>
              )}
            </dl>
          )}

          {/* Менеджер — часть компании, поэтому живёт внутри её карточки:
              контакты и смена контакта в одном месте, а не полем в общей
              сетке, где подпись и значение спорили за ширину. */}
          <div className="mt-2.5 border-t border-border-muted pt-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
                Менеджер
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                {contact ? (
                  contact.name
                ) : (
                  <span className="font-normal text-fg-muted">не выбран</span>
                )}
              </span>
              <Popover
                open={managerOpen}
                onOpenChange={(next, eventDetails) => {
                  if (!companyId) {
                    eventDetails.cancel();
                    return;
                  }
                  setManagerOpen(next);
                }}
              >
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      role="combobox"
                      aria-expanded={managerOpen}
                      aria-label="Изменить менеджера"
                      disabled={!companyId}
                      className="shrink-0 gap-1.5"
                    >
                      Изменить
                      <ChevronsUpDown className="size-3.5 opacity-60" />
                    </Button>
                  }
                />
                <PopoverContent
                  className="w-(--anchor-width) min-w-64 bg-bg-card p-0"
                  align="end"
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      autoFocus
                      value={managerQuery}
                      onValueChange={setManagerQuery}
                      placeholder="Поиск менеджера..."
                    />
                    <CommandList>
                      <CommandItem
                        value="__none__"
                        onSelect={() => {
                          onChange(companyId, null);
                          setManagerOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4",
                            contactId ? "opacity-0" : "opacity-100",
                          )}
                        />
                        <span className="text-muted-foreground">
                          Без менеджера
                        </span>
                      </CommandItem>

                      {filteredContacts.length > 0 && (
                        <>
                          <CommandSeparator />
                          <CommandGroup heading="Менеджеры">
                            {filteredContacts.map((c) => (
                              <CommandItem
                                key={c.id}
                                value={c.id}
                                onSelect={() => {
                                  onChange(companyId, c.id);
                                  setManagerOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 size-4",
                                    contactId === c.id
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                <span className="min-w-0 truncate">
                                  {c.name}
                                </span>
                                {c.company_id === null && (
                                  <span className="ml-auto shrink-0 text-[11px] text-fg-dim">
                                    без компании
                                  </span>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
                      )}

                      {filteredContacts.length === 0 && (
                        <CommandEmpty>Менеджер не найден.</CommandEmpty>
                      )}

                      <CommandSeparator />
                      <CommandGroup>
                        {/* Завести менеджера можно и отсюда: у нового
                            поставщика контактов обычно ещё нет. */}
                        <CommandItem
                          value="__create__"
                          onSelect={() => {
                            setManagerOpen(false);
                            setManagersRefreshKey((k) => k + 1);
                            requestAnimationFrame(() =>
                              setContactCard({ mode: "create" }),
                            );
                          }}
                        >
                          <Plus className="mr-2 size-4" />
                          Добавить менеджера
                        </CommandItem>
                        {contact && (
                          <CommandItem
                            value="__edit__"
                            onSelect={() => {
                              setManagerOpen(false);
                              requestAnimationFrame(() =>
                                setContactCard({ mode: "edit", contact }),
                              );
                            }}
                          >
                            <Pencil className="mr-2 size-4" />
                            Изменить контакты менеджера
                          </CommandItem>
                        )}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {(contact?.phone || contact?.email) && (
              <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
                {contact.phone && (
                  <ContactDataField label="Телефон">
                    <a
                      href={`tel:${contact.phone}`}
                      className="text-fg-brand hover:underline"
                    >
                      {contact.phone}
                    </a>
                  </ContactDataField>
                )}
                {contact.email && (
                  <ContactDataField label="Эл. почта">
                    <a
                      href={`mailto:${contact.email}`}
                      className="truncate text-fg-brand hover:underline"
                    >
                      {contact.email}
                    </a>
                  </ContactDataField>
                )}
              </dl>
            )}
            {contact && !contact.phone && !contact.email && (
              <p className="mt-1.5 text-[12px] text-fg-muted">
                Контакты не заполнены — их можно добавить в карточке менеджера.
              </p>
            )}
          </div>
        </div>
      )}

      <Field label="Срок поставки">
        <select
          value={leadTime}
          onChange={(e) => onChangeLeadTime(e.target.value)}
          className="h-10 w-full rounded-lg border border-border-muted bg-bg-card px-2 font-mono text-sm"
        >
          {leadOptions.map((option) => (
            <option key={option} value={option}>
              {option === "-" ? "Не указан" : option}
            </option>
          ))}
        </select>
      </Field>

      {/* Карточка компании: та же форма, что в справочнике контактов. Для
          создания её открывает CompanyPicker через onCreateCompany, здесь —
          только правка уже выбранной компании. */}
      {companyCard && (
        <CompanyDialog
          orgSlug={orgSlug}
          open
          company={companyCard}
          onClose={() => setCompanyCard(null)}
          onSuccess={(updated) => {
            // Родитель обновляет запись в своём списке, блок сразу видит новые
            // телефон и адрес, а снапшот названия в позиции не устаревает.
            onCompanyCreated?.(updated);
          }}
        />
      )}

      {/* Карточка менеджера. `onSuccess` не отдаёт запись, а список контактов
          приходит пропсом, перезагрузки которого мы не ждём: правки телефона и
          почты видны после перезагрузки страницы. `key` — чтобы повторное
          открытие карточки начиналось с чистых полей. */}
      {contactCard && (
        <ContactDialog
          key={
            contactCard.mode === "edit"
              ? `edit-${contactCard.contact.id}`
              : `create-${managersRefreshKey}`
          }
          orgSlug={orgSlug}
          open
          // `ContactDialog` ждёт полный `CompanyInput`: категории компаниям
          // назначает справочник, а для выбора компании в карточке контакта они
          // не нужны — состав полей здесь задаёт `SupplierPicker`.
          companies={companies.map((c) => ({ ...c, category: [] }))}
          fixedCompanyId={companyId ?? undefined}
          contact={contactCard.mode === "edit" ? contactCard.contact : undefined}
          onClose={() => setContactCard(null)}
          onSuccess={(saved: SavedContact) => {
            // Сохранённого менеджера отдаём наверх — родитель обновит свой
            // список контактов, и строка блока увидит новое имя, телефон и
            // почту без перезагрузки страницы.
            onContactSaved?.(saved);
            // Созданного менеджера сразу назначаем: иначе после «Добавить
            // менеджера» его пришлось бы выбирать вторым действием.
            if (contactCard.mode === "create") {
              onChange(companyId, saved.id);
            }
          }}
        />
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
    <>
      <dt className="font-mono text-[11.5px] text-fg-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">{children}</dd>
    </>
  );
};
