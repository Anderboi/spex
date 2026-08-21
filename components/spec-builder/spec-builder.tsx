"use client";

import { useMemo } from "react";
import {
  Plus,
  Search,
  ArrowUpDown,
  PackageSearch,
  AlertCircle,
  Loader2,
  Check,
} from "lucide-react";
import { useSpecBuilder } from "@/hooks/use-spec-builder";
import { useMediaQuery } from "@/hooks/use-media-query";
import { GroupSection } from "./group-section";
import { DetailModal } from "./detail-modal";
import { CodeConflictDialog } from "./code-conflict-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isLocked } from "@/lib/spec/status";
import type { SpecRowHandlers } from "./spec-row";
import type {
  MaterialListItem,
  SpecPickerCompany,
  SpecPickerContact,
} from "@/lib/queries";
import { TYPE_ORDER } from "@/lib/constants";
import { fmt, plural, cn } from "@/lib/utils";
import { SpecItem } from '@/lib/types';
import BottomBar from './bottom-bar';
import AddModalForm from './add-modal-form';

export default function SpecBuilder({
  orgSlug,
  projectId,
  project,
  initialItems,
  companies,
  contacts,
  library,
}: {
  orgSlug: string;
  projectId: string;
  project: {
    id: string;
    title: string;
    budget: number | null;
    client_name: string | null;
  };
  initialItems: SpecItem[];
  companies: SpecPickerCompany[];
  contacts: SpecPickerContact[];
  library: MaterialListItem[];
}) {
  const ctx = useSpecBuilder({ orgSlug, projectId, initialItems });
  const isDesktop = useMediaQuery("(min-width: 820px)");

  const handlers = useMemo<SpecRowHandlers>(
    () => ({
      onOpen: ctx.openDetail,
      onCode: ctx.setItemCode,
      onQty: ctx.incQty,
      onPrice: ctx.setPrice,
      onStatus: ctx.setStatus,
      onToggleSel: ctx.toggleSel,
      onDuplicate: ctx.duplicateItem,
      onClear: ctx.clearContent,
      onDelete: ctx.openDelete,
      onShare: ctx.shareItem,

      onFill: (id) => ctx.openAdd(id),
    }),
    [ctx],
  );

  const overBudget =
    project.budget !== null && ctx.stats.grandTotal > project.budget;

  return (
    <div className="relative min-h-screen w-full min-w-0 overflow-x-hidden bg-bg px-4 pb-36 text-fg sm:px-6 md:px-10">
      {/* ── шапка ─────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start gap-3 pt-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-heading text-xl font-semibold">
            {project.title}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-fg-muted">
            {project.client_name && (
              <span className="truncate">{project.client_name}</span>
            )}
            <span>
              {ctx.items.length}{" "}
              {plural(ctx.items.length, "позиция", "позиции", "позиций")}
            </span>
            {project.budget !== null && (
              <span
                className={cn(
                  "tabular-nums",
                  overBudget && "font-semibold text-fg-red",
                )}
              >
                {fmt(ctx.stats.grandTotal)} из {fmt(project.budget)} ₽
                {overBudget &&
                  ` · перерасход ${fmt(ctx.stats.grandTotal - project.budget)} ₽`}
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <SaveIndicator status={ctx.saveStatus} error={ctx.saveError} />
          <button
            type="button"
            onClick={() => ctx.openAdd(null)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-bg-accent px-4 text-[13.5px] font-semibold text-bg"
          >
            <Plus className="size-4" /> Добавить
          </button>
        </div>
      </header>

      {/* ── поиск и сортировка ────────────────────────────── */}
      <div className="mt-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
          <input
            defaultValue={ctx.filters.query}
            onChange={(e) => ctx.filters.setQuery(e.target.value)}
            placeholder="Название, бренд, марка, артикул"
            aria-label="Поиск по спецификации"
            className="h-9 w-full rounded-lg border border-border-muted bg-bg-card pl-9 pr-3 text-sm outline-none focus:border-fg-brand"
          />
        </div>
        <button
          type="button"
          onClick={() =>
            ctx.filters.setSort(
              ctx.filters.sort === "code"
                ? "az"
                : ctx.filters.sort === "az"
                  ? "sum"
                  : "code",
            )
          }
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[13px] text-fg-secondary"
        >
          <ArrowUpDown className="size-3.5" />
          {ctx.filters.sort === "code"
            ? "По марке"
            : ctx.filters.sort === "az"
              ? "А→Я"
              : "По сумме"}
        </button>
      </div>

      {/* ── чипсы типов ───────────────────────────────────── */}
      <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <TypeChip
          label="Все типы"
          active={ctx.filters.activeType === "Все типы"}
          count={ctx.items.length}
          onClick={() => ctx.filters.setActiveType("Все типы")}
        />
        {TYPE_ORDER.map((t) => {
          const n = ctx.items.filter((i) => i.type === t).length;
          if (n === 0) return null;
          return (
            <TypeChip
              key={t}
              label={t}
              count={n}
              active={ctx.filters.activeType === t}
              onClick={() => ctx.filters.setActiveType(t)}
            />
          );
        })}
      </div>

      {/* ── баннер «требуют замены» ───────────────────────── */}
      {ctx.stats.replace.count > 0 && !ctx.replaceHidden && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border-red bg-bg-red-light px-3 py-2">
          <AlertCircle className="size-5 shrink-0 text-fg-red" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-fg-red">
              {ctx.stats.replace.count}{" "}
              {plural(
                ctx.stats.replace.count,
                "позиция требует",
                "позиции требуют",
                "позиций требуют",
              )}{" "}
              замены
            </p>
            <p className="hidden text-[12.5px] text-fg-dim-text md:block">
              На сумму {fmt(ctx.stats.replace.sum)} ₽
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              ctx.filters.setStatusFilter(
                ctx.filters.statusFilter === "replace" ? null : "replace",
              )
            }
            className="shrink-0 rounded-[10px] bg-bg-red px-4 py-2 text-[13px] font-semibold text-bg-delete"
          >
            {ctx.filters.statusFilter === "replace"
              ? "Показать все"
              : "Показать их"}
          </button>
          <button
            type="button"
            onClick={() => ctx.setReplaceHidden(true)}
            aria-label="Скрыть"
            className="shrink-0 text-[16px] leading-none text-bg-red"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── содержимое ────────────────────────────────────── */}
      {ctx.items.length === 0 ? (
        <EmptyProject onAdd={() => ctx.openAdd(null)} />
      ) : ctx.groups.length === 0 ? (
        <EmptyFilter onReset={ctx.filters.reset} />
      ) : (
        ctx.groups.map((g) => (
          <GroupSection
            key={g.type}
            type={g.type}
            items={g.items}
            sum={g.sum}
            collapsed={ctx.collapsed.has(g.type)}
            onToggle={() => ctx.toggleCollapsed(g.type)}
            onAddPlaceholder={() => ctx.addPlaceholder(g.type)}
            selected={ctx.selected}
            isDesktop={isDesktop}
            h={handlers}
          />
        ))
      )}

      {/* ── нижняя панель ─────────────────────────────────── */}
      <BottomBar ctx={ctx} />

      {/* ── модалки ───────────────────────────────────────── */}
      {ctx.current && (
        <DetailModal
          item={ctx.current}
          companies={companies}
          contacts={contacts}
          onClose={ctx.closeModal}
          onPatch={(p) => ctx.updateItem(ctx.current!.id, p)}
          onCode={(c) => ctx.setItemCode(ctx.current!.id, c)}
          onQty={(d) => ctx.incQty(ctx.current!.id, d)}
          onPrice={(v) => ctx.setPrice(ctx.current!.id, v)}
          onStatus={(s) => ctx.setStatus(ctx.current!.id, s)}
          onClear={() => ctx.clearContent(ctx.current!.id)}
          onDelete={() => ctx.openDelete(ctx.current!.id)}
          onShare={() => ctx.shareItem(ctx.current!)}
        />
      )}

      {ctx.modal.kind === "add" && (
        <AddModalForm
          library={library}
          items={ctx.items}
          editing={ctx.editing}
          onClose={ctx.closeModal}
          companies={companies} 
          onAddManual={()=>{}}
          onAdd={(materials: any) => {
            ctx.addFromLibrary(materials);
            ctx.closeModal();
          }}
          onFill={(m: any) => ctx.fillPlaceholder(ctx.editing!.id, m)}
        />
      )}

      <CodeConflictDialog
        conflict={ctx.codeConflict}
        onConfirm={ctx.confirmCodeSwap}
        onCancel={ctx.dismissCodeConflict}
      />

      {ctx.deleting.length > 0 && (
        <ConfirmDialog
          open
          title={
            ctx.deleting.length === 1
              ? `Удалить ${ctx.deleting[0].code}?`
              : `Удалить позиций: ${ctx.deleting.length}?`
          }
          description={(() => {
            const withRooms = ctx.deleting.filter(
              (i) => i.rooms.length > 0,
            ).length;
            const locked = ctx.deleting.filter((i) =>
              isLocked(i.status),
            ).length;
            const parts = [
              "Нумерация остальных позиций сохранится. Действие можно отменить.",
            ];
            if (withRooms > 0)
              parts.unshift(
                `Назначения в помещениях будут сняты (позиций: ${withRooms}).`,
              );
            if (locked > 0)
              parts.unshift(
                `Среди удаляемых есть позиции в закупке: ${locked}.`,
              );
            return parts.join(" ");
          })()}
          confirmLabel="Удалить"
          destructive
          onConfirm={() => {
            const ids = ctx.deleting.map((i) => i.id);
            if (ids.length === 1) ctx.deleteItem(ids[0]);
            else ctx.bulkDelete();
          }}
          onCancel={ctx.closeModal}
        />
      )}

      {/* ── тост ──────────────────────────────────────────── */}
      {ctx.toast && (
        <div
          role="status"
          className="fixed bottom-28 left-1/2 z-80 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-bg-accent py-3 pl-6 pr-4 text-[14px] font-medium text-bg shadow-[0_14px_40px_rgba(27,26,23,.32)]"
        >
          <span>{ctx.toast.msg}</span>
          {ctx.toast.actionLabel && ctx.toast.action && (
            <button
              type="button"
              onClick={() => {
                ctx.toast!.action!();
                ctx.dismissToast();
              }}
              className="shrink-0 rounded-lg border border-[rgba(243,239,231,.32)] px-3 py-1.5 font-bold text-bg"
            >
              {ctx.toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function TypeChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors",
        active
          ? "border-fg-brand bg-bg-brand font-semibold"
          : "border-border-muted text-fg-secondary",
      )}
    >
      {label}
      <span className="text-[11px] opacity-60">{count}</span>
    </button>
  );
}

function SaveIndicator({
  status,
  error,
}: {
  status: string;
  error: string | null;
}) {
  if (status === "error") {
    return (
      <span
        role="alert"
        className="flex items-center gap-1.5 text-[12.5px] text-fg-red"
        title={error ?? ""}
      >
        <AlertCircle className="size-3.5" /> Не сохранено
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" /> Сохранение
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        <Check className="size-3.5" /> Сохранено
      </span>
    );
  }
  return null;
}

function EmptyProject({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-border-muted py-20 text-center">
      <PackageSearch className="mx-auto size-10 text-fg-muted" />
      <p className="mt-4 font-heading text-lg font-semibold">
        Спецификация пуста
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-pretty text-[14px] text-fg-muted">
        Добавьте материалы из библиотеки или заведите пустые марки — заполните
        их, когда определитесь с подбором.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-bg-accent px-5 text-[14px] font-semibold text-bg"
      >
        <Plus className="size-4" /> Добавить позиции
      </button>
    </div>
  );
}

function EmptyFilter({ onReset }: { onReset: () => void }) {
  return (
    <div className="py-20 text-center">
      <p className="font-heading text-lg font-semibold">Ничего не найдено</p>
      <p className="mt-1.5 text-[14px] text-fg-muted">
        Измените запрос или сбросьте фильтры.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-5 rounded-xl bg-bg-accent px-5 py-2.5 text-[14px] font-semibold text-bg"
      >
        Сбросить фильтры
      </button>
    </div>
  );
}
