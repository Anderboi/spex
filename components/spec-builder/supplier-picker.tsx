"use client";

import { AlertCircle } from "lucide-react";

export function SupplierPicker({
  companies,
  contacts,
  companyId,
  contactId,
  snapshot,
  onChange,
}: {
  companies: { id: string; name: string }[];
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
}) {
  const company = companies.find((c) => c.id === companyId) ?? null;
  const available = contacts.filter(
    (c) => !companyId || c.company_id === companyId || c.company_id === null,
  );
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const renamed = snapshot && company && snapshot !== company.name;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Компания
        </span>
        <select
          value={companyId ?? ""}
          onChange={(e) => onChange(e.target.value || null, null)}
          className="h-9 rounded-md border border-border-muted bg-bg px-3 text-sm"
        >
          <option value="">Не указана</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {renamed && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-[12.5px] text-amber-700">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />В спецификации
          сохранено прежнее название «{snapshot}». Оно обновится при следующем
          изменении позиции.
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Менеджер
        </span>
        <select
          value={contactId ?? ""}
          onChange={(e) => onChange(companyId, e.target.value || null)}
          className="h-9 rounded-md border border-border-muted bg-bg px-3 text-sm"
        >
          <option value="">Не указан</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {contact && (
        <div className="rounded-lg border border-border-muted p-3 text-[13px]">
          <p className="font-medium">{contact.name}</p>
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="block text-fg-brand hover:underline"
            >
              {contact.phone}
            </a>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="block text-fg-brand hover:underline"
            >
              {contact.email}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
