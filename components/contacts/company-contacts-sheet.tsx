"use client";

import Image from "next/image";
import {
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  StickyNote,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactAvatar } from "./contact-avatar";
import { CompanyRow, ContactRow } from "@/lib/validations";
import { initials, normalizeWebsite, telHref } from "@/lib/utils";
import { pluralizeContacts } from "./contact-shared";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface CompanyContactsSheetProps {
  company: CompanyRow | undefined;
  managers: ContactRow[];
  onClose: () => void;
  onAddManager: (companyId: string) => void;
  onEditManager: (id: string) => void;
  onEditCompany: (id: string) => void;
  onRemoveManager: (id: string) => void;
}

/**
 * Панель контактов компании.
 *
 * Открывается оверлеем, а не раскрытием внутри карточки: высота сетки не
 * меняется вообще, а затемнённый backdrop и тень отделяют панель от карточек
 * под ней. Внутри — контакты, реквизиты и заметка компании.
 */
export function CompanyContactsSheet({
  company,
  managers,
  onClose,
  onAddManager,
  onEditManager,
  onEditCompany,
  onRemoveManager,
}: CompanyContactsSheetProps) {
  const website = normalizeWebsite(company?.website);
  const hasDetails = Boolean(
    company?.address || company?.phone || company?.email || website,
  );

  return (
    <Sheet open={Boolean(company)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-l border-border bg-bg-card p-0 shadow-2xl sm:max-w-md"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Шапка: та же якорная связка логотип + название, что и в карточке */}
          <SheetHeader className="flex-row items-start gap-3 border-b border-border-subtle p-4">
            {company?.logo_url ? (
              <div className="relative size-12.5 shrink-0 overflow-hidden rounded-lg border border-border-subtle bg-bg-card2">
                <Image
                  src={company.logo_url}
                  alt=""
                  fill
                  sizes="50px"
                  className="object-contain"
                />
              </div>
            ) : (
              <div
                aria-hidden
                className="flex size-12.5 shrink-0 items-center justify-center rounded-lg bg-bg-brand font-serif text-base text-fg-brand"
              >
                {initials(company?.name ?? "")}
              </div>
            )}

            <div className="min-w-0 flex-1 pr-8">
              <SheetTitle className="line-clamp-2 break-words font-serif text-base font-semibold leading-snug text-fg-body">
                {company?.name}
              </SheetTitle>
              <p className="mt-1 font-mono text-xs tabular-nums text-fg-muted">
                {managers.length > 0
                  ? pluralizeContacts(managers.length)
                  : "контактов нет"}
              </p>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Контакты: имя и роль — главные данные, поэтому крупнее реквизитов */}
            <section aria-label="Контакты" className="p-2">
              {managers.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-12 text-center">
                  <span
                    aria-hidden
                    className="flex size-12 items-center justify-center rounded-full border border-dashed border-border-dash text-fg-icon"
                  >
                    <UserRound className="size-5" />
                  </span>
                  <p className="mt-4 text-sm font-medium text-fg-body">
                    Контактов пока нет
                  </p>
                  <p className="mt-1 max-w-60 text-xs text-fg-muted">
                    Добавьте представителя, менеджера или мастера этой компании.
                  </p>
                  <Button
                    size="sm"
                    className="mt-4 cursor-pointer"
                    onClick={() => onAddManager(company?.id ?? "")}
                  >
                    <Plus className="size-3.5 shrink-0" /> Добавить контакт
                  </Button>
                </div>
              ) : (
                <ul>
                  {managers.map((m) => (
                    <li
                      key={m.id}
                      className="group/contact flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-bg-card2"
                    >
                      <ContactAvatar
                        name={m.name}
                        avatarUrl={m.avatar_url}
                        size="sm"
                      />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">
                          {m.name}
                        </p>
                        {m.title && (
                          <p className="mt-0.5 truncate text-xs text-fg-muted">
                            {m.title}
                          </p>
                        )}

                        {(m.phone || m.email) && (
                          <div className="mt-2 flex flex-col gap-1 text-xs text-fg-muted">
                            {m.phone && (
                              <a
                                href={telHref(m.phone)}
                                title={m.phone}
                                className="flex min-w-0 items-center gap-1.5 font-mono tabular-nums transition-colors hover:text-fg"
                              >
                                <Phone className="size-3.5 shrink-0 text-fg-icon" />
                                <span className="truncate">{m.phone}</span>
                              </a>
                            )}
                            {m.email && (
                              <a
                                href={`mailto:${m.email}`}
                                title={m.email}
                                className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-fg"
                              >
                                <Mail className="size-3.5 shrink-0 text-fg-icon" />
                                <span className="truncate">{m.email}</span>
                              </a>
                            )}
                          </div>
                        )}

                        {m.note && (
                          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-fg-muted">
                            {m.note}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-0.5 transition-opacity group-focus-within/contact:opacity-100 max-md:opacity-100 md:opacity-0 md:group-hover/contact:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Редактировать контакт ${m.name}`}
                          onClick={() => onEditManager(m.id)}
                          className="cursor-pointer text-fg-muted hover:text-fg"
                        >
                          <Pencil className="size-4 shrink-0" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Удалить контакт ${m.name}`}
                          onClick={() => onRemoveManager(m.id)}
                          className="cursor-pointer text-fg-muted hover:text-destructive"
                        >
                          <Trash2 className="size-4 shrink-0" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Реквизиты: раскрываем то, что в карточке обрезано */}
            {hasDetails && (
              <section
                aria-label="Реквизиты компании"
                className="border-t border-border-subtle p-4"
              >
                <h3 className="font-mono text-[11px] uppercase tracking-wide text-fg-dim">
                  О компании
                </h3>
                <dl className="mt-3 flex flex-col gap-2 text-sm text-fg-body">
                  {company?.address && (
                    <div className="flex items-start gap-2">
                      <dt className="sr-only">Адрес</dt>
                      <MapPin className="mt-0.5 size-4 shrink-0 text-fg-icon" />
                      <dd className="min-w-0 break-words">{company.address}</dd>
                    </div>
                  )}
                  {company?.phone && (
                    <div className="flex items-start gap-2">
                      <dt className="sr-only">Телефон</dt>
                      <Phone className="mt-0.5 size-4 shrink-0 text-fg-icon" />
                      <dd>
                        <a
                          href={telHref(company.phone)}
                          className="font-mono tabular-nums transition-colors hover:text-fg-brand"
                        >
                          {company.phone}
                        </a>
                      </dd>
                    </div>
                  )}
                  {company?.email && (
                    <div className="flex items-start gap-2">
                      <dt className="sr-only">Эл. почта</dt>
                      <Mail className="mt-0.5 size-4 shrink-0 text-fg-icon" />
                      <dd className="min-w-0">
                        <a
                          href={`mailto:${company.email}`}
                          className="break-all transition-colors hover:text-fg-brand"
                        >
                          {company.email}
                        </a>
                      </dd>
                    </div>
                  )}
                  {website && (
                    <div className="flex items-start gap-2">
                      <dt className="sr-only">Сайт</dt>
                      <Globe className="mt-0.5 size-4 shrink-0 text-fg-icon" />
                      <dd className="min-w-0">
                        <a
                          href={website.href}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all transition-colors hover:text-fg-brand"
                        >
                          {website.label}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
            )}

            {company?.note && (
              <section
                aria-label="Заметка о компании"
                className="border-t border-border-subtle p-4"
              >
                <h3 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-fg-dim">
                  <StickyNote className="size-3.5" /> Заметка
                </h3>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-fg-body">
                  {company.note}
                </p>
              </section>
            )}
          </div>

          {/* Подвал: добавление контакта — частое действие, поэтому всегда на виду */}
          <div className="flex items-center justify-between gap-2 border-t border-border-subtle p-4">
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={() => onAddManager(company?.id ?? "")}
            >
              <Plus className="size-3.5 shrink-0" /> Добавить контакт
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer text-fg-muted hover:text-fg"
              onClick={() => company && onEditCompany(company.id)}
            >
              <Pencil className="size-3.5 shrink-0" /> Редактировать
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
