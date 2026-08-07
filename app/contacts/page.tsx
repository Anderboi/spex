"use client";

import React, { useState, useTransition } from "react";
import {
  Building2,
  User,
  Phone,
  Mail,
  Globe,
  MapPin,
  Plus,
  Search,
  MoreHorizontal,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/layout/PageHeader";
import { upsertSupplier } from './actions';
import { getSuppliers } from '@/lib/queries';

interface PageProps {
  searchParams: Promise<{ search?: string }>;
}

export default async function ContactsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  
  const [search, setSearch] = useState("");
  // В реальном приложении: fetch из Supabase
  const contacts = await getSuppliers(params.search);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Шапка страницы */}
      <div className="flex items-center justify-between">
        <div>
          <PageHeader>Контакты поставщиков</PageHeader>
          <p className="text-sm text-muted-foreground mt-1">
            База салонов, фабрик и персональных менеджеров
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="size-4" /> Добавить контакт
        </Button>
      </div>

      {/* Панель фильтрации */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию, имени или городу..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Сетка контактов */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {contacts.map((contact) => (
          <div
            key={contact.id}
            className="rounded-xl border border-border bg-card p-5 space-y-4 hover:border-foreground/20 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {contact.category || "Общее"}
                </span>
                <h3 className="text-base font-semibold mt-2">{contact.name}</h3>
                {contact.contactPerson && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                    <User className="size-3.5" /> {contact.contactPerson}
                  </p>
                )}
              </div>
              <Button size="icon" variant="ghost" className="size-8">
                <MoreHorizontal className="size-4" />
              </Button>
            </div>

            <div className="space-y-2 text-xs font-mono text-muted-foreground pt-2 border-t border-border/50">
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-2 hover:text-foreground"
                >
                  <Phone className="size-3.5" /> {contact.phone}
                </a>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-2 hover:text-foreground"
                >
                  <Mail className="size-3.5" /> {contact.email}
                </a>
              )}
              {contact.website && (
                <a
                  href={contact.website}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 hover:text-foreground"
                >
                  <Globe className="size-3.5" />{" "}
                  {contact.website.replace("https://", "")}{" "}
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
