"use client";

import { AlertCircle } from "lucide-react";
import CopyButton from "../../layout/copy-button";
import Field from "../../layout/modal-field";
import { Avatar } from "../../ui/avatar";
import {
  CompanyPicker,
  type CompanyOption,
} from "@/components/layout/company-picker";

export function SupplierPicker({
  orgSlug,
  companies,
  contacts,
  companyId,
  contactId,
  snapshot,
  onChange,
  onCreateCompany,
  onCompanyCreated,
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
  /**
   * Выбор поставщика. `companyName` — имя выбранной компании: вкладки
   * «Обзор»/«Состав» показывают снапшот, и без него подпись не обновилась бы
   * до следующего изменения позиции.
   */
  onChange: (
    companyId: string | null,
    contactId: string | null,
    companyName?: string,
  ) => void;
  /**
   * Запрос на создание компании: карточку открывает родитель модалки.
   * `onCreated` он обязан позвать с сохранённой компанией — так `CompanyPicker`
   * узнаёт результат и выбирает её сам (свой `CompanyDialog` в этом сценарии не
   * рендерится).
   */
  onCreateCompany?: (
    name: string,
    onCreated: (company: CompanyOption) => void,
  ) => void;
  /** Компания создана — родитель добавляет её в свой список без перезагрузки. */
  onCompanyCreated?: (company: CompanyOption) => void;
}) {
  const company = companies.find((c) => c.id === companyId) ?? null;
  const available = contacts.filter(
    (c) => !companyId || c.company_id === companyId || c.company_id === null,
  );
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const renamed = snapshot && company && snapshot !== company.name;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <Field label="Компания">
          {/* Единый выбор поставщика: поиск по справочнику и создание компании,
              если её ещё нет (см. CompanyPicker). */}
          <CompanyPicker
            orgSlug={orgSlug}
            companies={companies}
            value={companyId}
            onChange={({ companyId: next, companyName }) => {
              // Имя едет вместе с id: без него вкладки «Обзор»/«Состав» показали
              // бы старый снапшот до следующего изменения позиции. Пустое имя не
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
          />
        </Field>
      </div>

      {renamed && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-[12.5px] text-amber-700">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />В спецификации
          сохранено прежнее название «{snapshot}». Оно обновится при следующем
          изменении позиции.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Field label="Менеджер">
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
        </Field>
      </div>

      {company && (
        <div className="rounded-lg border border-border-muted bg-bg-card2 p-3 text-[13px]">
          <div className="flex gap-4">
            <div className="flex flex-col items-center gap-2 p-4">
              <Avatar size="lg" />
              <p className="font-medium text-lg w-full text-center">
                {company.name}
              </p>
            </div>
            <div className="flex flex-col items-start gap-1">
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
                  <div className="flex gap-2">
                    <span className="block text-fg-brand hover:underline col-span-2">
                      {company.address}
                    </span>
                    <CopyButton textToCopy={company.address} />
                  </div>
                </ContactDataField>
              )}
              {company.website && (
                <ContactDataField label="Сайт">
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-fg-brand hover:underline col-span-2"
                  >
                    {company.website}
                  </a>
                </ContactDataField>
              )}
            </div>
          </div>
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
    <div className="w-full grid grid-cols-3 items-start gap-3 h-6">
      <span className="text-fg-muted text-[12px] text-right font-mono">
        {label}
      </span>
      <div className="col-span-2 flex-wrap items-center flex gap-2">
        {children}
      </div>
    </div>
  );
};
