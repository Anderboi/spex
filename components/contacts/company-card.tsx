"use client";

import { useState } from "react";
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
import { CompanyInput, ContactInput } from '@/lib/validations';
import { initials } from '@/lib/utils';
import { ManagerRow } from './manager-row';

export function CompanyCard({
  company,
  managers,
  onAddManager,
  onRemoveManager,
  onRemoveCompany,
}: {
  company: CompanyInput;
  managers: ContactInput[];
  onAddManager: (companyId: string) => void;
  onRemoveManager: (id: string) => void;
  onRemoveCompany: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-muted font-serif text-base text-brand sm:size-11 sm:text-lg">
          {initials(company.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-serif text-lg leading-tight text-card-foreground">
              {company.name}
            </h3>
            <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
              {company.category}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {company.address ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" /> {company.address}
              </span>
            ) : null}
            {company.phone ? (
              <a
                href={`tel:${company.phone}`}
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <Phone className="size-3.5" /> {company.phone}
              </a>
            ) : null}
            {company.email ? (
              <a
                href={`mailto:${company.email}`}
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <Mail className="size-3.5" /> {company.email}
              </a>
            ) : null}
            {company.website ? (
              <a
                href={`https://${company.website}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <Globe className="size-3.5" /> {company.website}
              </a>
            ) : null}
          </div>
          {company.note ? (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {company.note}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${company.name}`}
          onClick={() => onRemoveCompany(company.id)}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>

      <div className="border-t border-border bg-muted/30">
        <div className="flex items-center justify-between px-3 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground"
          >
            <ChevronDown
              className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`}
            />
            <UserRound className="size-3.5 text-muted-foreground" />
            {managers.length} {managers.length === 1 ? "contact" : "contacts"}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAddManager(company.id)}
          >
            <Plus /> Add contact
          </Button>
        </div>
        {open ? (
          <div className="px-2 pb-2">
            {managers.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No contacts yet. Add a rep or manager you work with here.
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
  );
}
