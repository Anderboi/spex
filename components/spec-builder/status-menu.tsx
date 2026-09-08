"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  allowedStatuses,
  SPEC_STATUS_CONFIG,
  statusWarning,
} from "@/lib/spec/status";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { SpecItem } from "@/lib/types";
import { SpecStatus } from "@/lib/constants";

export function StatusMenu({
  item,
  onChange,
  className,
}: {
  item: SpecItem;
  onChange: (s: SpecStatus) => void;
  className?: string;
}) {
  const [pending, setPending] = useState<{
    status: SpecStatus;
    warning: string;
  } | null>(null);
  const cfg = SPEC_STATUS_CONFIG[item.status];

  const pick = (s: SpecStatus) => {
    if (s === item.status) return;
    const w = statusWarning(item.status, s);
    if (w) {
      setPending({ status: s, warning: w });
      return;
    }
    onChange(s);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Статус: ${cfg.label}`}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium",
            cfg.chip,
            className,
          )}
        >
          <span className={cn("size-1.5 rounded-full", cfg.dot)} />
          {cfg.label}
          <ChevronDown className="size-3 opacity-60" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-52 bg-bg-card">
          {allowedStatuses(item).map((s) => (
            <DropdownMenuItem
              key={s}
              onClick={() => pick(s)}
              className="gap-2 text-[13px]"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  SPEC_STATUS_CONFIG[s].dot,
                )}
              />
              {SPEC_STATUS_CONFIG[s].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={pending !== null}
        title={`Сменить статус на «${pending ? SPEC_STATUS_CONFIG[pending.status].label : ""}»?`}
        description={pending?.warning ?? ""}
        confirmLabel="Сменить статус"
        onConfirm={() => {
          if (pending) onChange(pending.status);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
