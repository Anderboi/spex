"use client";

import { Mail, Phone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactInput } from "@/lib/validations";
import { initials } from "@/lib/utils";

export function ManagerRow({
  manager,
  onRemove,
}: {
  manager: ContactInput;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-card">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg text-xs font-medium text-fg">
        {initials(manager.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-foreground">
            {manager.name}
          </span>
          {manager.title ? (
            <span className="text-xs text-muted-foreground">
              {manager.title}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {manager.email ? (
            <a
              href={`mailto:${manager.email}`}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <Mail className="size-3" /> {manager.email}
            </a>
          ) : null}
          {manager.phone ? (
            <a
              href={`tel:${manager.phone}`}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <Phone className="size-3" /> {manager.phone}
            </a>
          ) : null}
        </div>
        {manager.note ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {manager.note}
          </p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${manager.name}`}
        onClick={() => onRemove(manager.id || "")}
        className="text-muted-foreground opacity-100 transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Trash2 />
      </Button>
    </li>
  );
}
