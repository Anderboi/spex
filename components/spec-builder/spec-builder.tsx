"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, ArrowUpDown, AlertCircle, X } from "lucide-react";
import { useSpecBuilder } from "@/hooks/use-spec-builder";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSpecDensity } from "@/hooks/use-spec-density";
import { useContainerWidth } from "@/hooks/use-container-width";
import { useDialogUrl } from "@/hooks/use-dialog-url";
import { GroupSection } from "./group-section";
import {
  SPEC_LIST_MIN_CONTAINER,
  resolveSpecListLayout,
  showsServices,
} from "./spec-table";
import { DensitySwitcher } from "./layout/density-switcher";
import { SpecFilterSheet } from "./spec-filter-sheet";
import { ActiveFilterChips } from "./layout/active-filter-chips";
import { DetailModal } from "./modals/spec-mat-detail-modal";
import { CodeConflictDialog } from "./modals/code-conflict-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isLocked } from "@/lib/spec/status";
import type { SpecRowHandlers } from "./spec-row";
import type {
  MaterialListItem,
  SpecPickerCompany,
  SpecPickerContact,
} from "@/lib/queries";
import { ALL_CATEGORIES, TYPE_ORDER } from "@/lib/constants";
import { fmt, plural, cn } from "@/lib/utils";
import { SpecItem } from "@/lib/types";
import BottomBar from "./layout/bottom-bar";
import AddModalForm from "./modals/add-spec-mat-modal-form";
import { ProcureModal } from "./modals/procure-modal";
import { SpecSummary } from "./summary/spec-summary";
import EmptyFilter from "./empty-filter";
import EmptyProject from "./empty-project";
import TypeChip from "../layout/type-chip";
import SaveIndicator from "../layout/save-indicator";
import AddSectionPicker from "./layout/add-section-picker";
import { ProjectExpenses } from "./project-expenses";
import { ServiceOperationModal } from "./modals/service-operation-modal";

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
    rooms: string[];
  };
  initialItems: SpecItem[];
  companies: SpecPickerCompany[];
  contacts: SpecPickerContact[];
  library: MaterialListItem[];
}) {
  const ctx = useSpecBuilder({ orgSlug, projectId, initialItems });
  const [localCompanies, setLocalCompanies] = useState(companies);
  const isDesktop = useMediaQuery("(min-width: 820px)");
  const { density, setDensity } = useSpecDensity();

  /**
   * Раскладку списка выбираем по ширине контейнера, а не окна: сайдбар
   * сворачивается независимо от viewport, а таблице нужны свои 928px
   * (см. spec-table.tsx). Замер приходит до отрисовки, поэтому таблица не
   * мигает карточками.
   */
  const [contentRef, contentWidth] = useContainerWidth<HTMLDivElement>();
  const layout = resolveSpecListLayout(contentWidth, density);
  /**
   * Необязательная колонка «услуги»: видимость считаем по тому же замеру
   * контейнера, а не container queries — они зависят от поддержки браузера и от
   * того, попал ли новый файл в сборку Tailwind, и при промахе колонка остаётся
   * скрытой навсегда.
   */
  const showServices = showsServices(contentWidth);

  /** Созданную CompanyDialog запись используем сразу, без повторного fetch. */
  const upsertLocalCompany = useCallback((company: SpecPickerCompany) => {
    setLocalCompanies((prev) => {
      const index = prev.findIndex((item) => item.id === company.id);
      if (index < 0) return [...prev, company];
      const next = [...prev];
      next[index] = company;
      return next;
    });
  }, []);

  const { value: dialog, close: closeDialog } = useDialogUrl("dialog");

  useEffect(() => {
    const v = dialog;
    if (v === "add" || v === "procure" || v === "summary") {
      ctx.closeModal();
      if (v === "add") ctx.openAdd(null);
      else if (v === "procure") ctx.openProcure();
      else if (v === "summary") ctx.openSummary();
    } else {
      ctx.closeModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  const prevModalKindRef = useRef(ctx.modal.kind);
  useEffect(() => {
    const prev = prevModalKindRef.current;
    prevModalKindRef.current = ctx.modal.kind;
    if (prev !== "none" && ctx.modal.kind === "none" && dialog) {
      closeDialog();
    }
  }, [ctx.modal.kind, dialog, closeDialog]);

  const handlers = useMemo<SpecRowHandlers>(
    () => ({
      onOpen: ctx.openDetail,
      onCode: ctx.setItemCode,
      onQty: ctx.incQty,
      onPrice: ctx.setPrice,
      onStatus: ctx.setStatus,
      onToggleSel: ctx.toggleSel,
      onToggleSelGroup: ctx.toggleSelGroup,
      onDuplicate: ctx.duplicateItem,
      onAddChild: (parentId) => ctx.openAdd(null, parentId),
      onClear: ctx.clearContent,
      onDelete: ctx.openDelete,
      onShare: ctx.shareItem,
      onSetParent: ctx.setItemParent,
      onFill: (id) => ctx.openAdd(id),
      onProcure: ctx.openProcure,
      onSwitchVariant: ctx.switchVariantLocal,
      onAddVariant: ctx.addVariantLocal,
      onDraftName: (id, name) => ctx.updateItem(id, { name }),
      onEditOperation: ctx.openServiceOperationEdit,
    }),
    [ctx],
  );

  /** Непосредственные дети позиции, открытой в детализации (для секции «Субэлементы»). */
  const current = ctx.current;
  const currentChildren = current
    ? ctx.items.filter((child) => child.parentId === current.id)
    : [];

  /**
   * «Открыть исходную позицию» (kind = 'spec_ref' из «Состава»): переходим в
   * DetailModal целевой позиции и запоминаем владельца состава, чтобы после
   * закрытия вернуться к нему на вкладке «Состав».
   */
  const openRefFromComposition = useCallback(
    (refId: string) => {
      const ownerId = current?.id;
      if (!ownerId || !ctx.items.some((i) => i.id === refId)) return;
      ctx.openDetail(refId, { id: ownerId, tab: "components" });
    },
    [current, ctx],
  );

  const overBudget =
    project.budget !== null && ctx.stats.totalSum > project.budget;

  return (
    <div
      ref={contentRef}
      className="relative min-h-screen w-full min-w-0 bg-bg text-fg"
    >
      {/* ── статус и статистика (шапка на странице: PageHeader) ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 sm:pt-6 text-[13px] text-fg-muted">
        <SaveIndicator status={ctx.saveStatus} error={ctx.saveError} />
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
            {fmt(ctx.stats.totalSum)} из {fmt(project.budget)} ₽
            {overBudget &&
              ` · перерасход ${fmt(ctx.stats.totalSum - project.budget)} ₽`}
          </span>
        )}
      </div>

      {/* ── поиск, фильтры и сортировка ───────────────────── */}
      <div className="mt-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
          <input
            defaultValue={ctx.filters.query}
            onChange={(e) => ctx.filters.setQuery(e.target.value)}
            placeholder="Название, бренд, марка, артикул"
            aria-label="Поиск по спецификации"
            className="h-10 w-full rounded-lg border border-border-muted bg-bg-card pl-9 pr-3 text-sm outline-none focus:border-fg-brand"
          />
        </div>
        {isDesktop ? (
          // На широких экранах сортировка переключается одной кнопкой по кругу.
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
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border-muted px-3 text-[13px] text-fg-secondary"
          >
            <ArrowUpDown className="size-3.5" />
            {ctx.filters.sort === "code"
              ? "По марке"
              : ctx.filters.sort === "az"
                ? "А→Я"
                : "По сумме"}
          </button>
        ) : (
          // На узких экранах статус и сортировка уезжают в нижнюю шторку —
          // как на страницах материалов и контактов.
          <>
            <SpecFilterSheet filters={ctx.filters} items={ctx.items} />
            {/* Плотность управляет только карточками: пока контейнер вмещает
              list-раскладку, переключатель не нужен (см. resolveSpecListLayout). */}
            {contentWidth > 0 && contentWidth < SPEC_LIST_MIN_CONTAINER && (
              <DensitySwitcher value={density} onChange={setDensity} />
            )}
          </>
        )}
      </div>

      {/* ── чипсы типов (веб-версия) ─────────────────────── */}
      {isDesktop && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          <TypeChip
            label={ALL_CATEGORIES}
            active={ctx.filters.activeType === ALL_CATEGORIES}
            count={ctx.items.length}
            onClick={() => ctx.filters.setActiveType(ALL_CATEGORIES)}
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
      )}

      {/* ── активные фильтры и вид списка (мобильная версия) ── */}
      {!isDesktop && (
        <div className="mt-2 flex items-center gap-2">
          <ActiveFilterChips filters={ctx.filters} className="flex-1 pb-1" />
          {/* <DensitySwitcher value={density} onChange={setDensity} /> */}
        </div>
      )}

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
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* ── содержимое ────────────────────────────────────── */}
      {ctx.items.length === 0 ? (
        <EmptyProject onAdd={() => ctx.openAdd(null)} />
      ) : ctx.groups.length === 0 ? (
        <EmptyFilter onReset={ctx.filters.reset} />
      ) : (
        <>
          {ctx.groups.map((g) => (
            <div key={g.type}>
              <GroupSection
                type={g.type}
                items={g.items}
                sum={g.sum}
                collapsed={ctx.collapsed.has(g.type)}
                onToggle={() => ctx.toggleCollapsed(g.type)}
                allItems={ctx.items}
                selected={ctx.selected}
                layout={layout}
                showServices={showServices}
                opsByItem={ctx.opsByItem}
                h={handlers}
              />
              <AddSectionPicker
                onAddPlaceholder={() => ctx.addPlaceholder(g.type)}
                usedTypes={ctx.groups.map((g) => g.type)}
                onPick={(type) => ctx.addPlaceholder(type)}
              />
            </div>
          ))}
        </>
      )}

      {/* ── расходы проекта (доставка и монтаж) ────────────── */}
      <ProjectExpenses
        ops={ctx.operations}
        onOpen={ctx.openServiceOperationEdit}
      />

      {/* ── нижняя панель ─────────────────────────────────── */}
      <BottomBar ctx={ctx} />

      {/* ── модалки ───────────────────────────────────────── */}
      {ctx.current && (
        <DetailModal
          key={ctx.current.id}
          orgSlug={orgSlug}
          projectId={projectId}
          item={ctx.current}
          childrenItems={currentChildren}
          onOpenItem={ctx.openDetail}
          onOpenRefItem={openRefFromComposition}
          initialTab={ctx.modal.kind === "detail" ? ctx.modal.tab : undefined}
          allItems={ctx.items}
          companies={localCompanies}
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
          projectRooms={project.rooms}
          onCompanyCreated={upsertLocalCompany}
          onSwitchVariant={(vid) =>
            ctx.switchVariantLocal(ctx.current!.id, vid)
          }
          onAddVariant={() => ctx.addVariantLocal(ctx.current!.id)}
          onUpdateVariant={(vid, patch) =>
            ctx.updateVariantLocal(ctx.current!.id, vid, patch)
          }
          onDeleteVariant={(vid) =>
            ctx.deleteVariantLocal(ctx.current!.id, vid)
          }
          onEditVariant={(vid) => ctx.openEditVariant(ctx.current!.id, vid)}
          saveStatus={ctx.saveStatus}
          saveError={ctx.saveError}
          ops={ctx.opsByItem[ctx.current.id] ?? []}
          onOpenOperation={(operationId) =>
            ctx.openServiceOperationEdit(operationId, {
              kind: "detail",
              id: ctx.current!.id,
            })
          }
        />
      )}

      {ctx.modal.kind === "edit-variant" &&
        (() => {
          const { itemId, variantId } = ctx.modal;
          const item = ctx.items.find((i) => i.id === itemId);
          const variant = item?.variants.find((v) => v.id === variantId);
          if (!item || !variant) return null;

          // собираем «псевдо-SpecItem» из полей варианта для предзаполнения формы
          const editingLike = {
            ...item,
            name: variant.name,
            brand: variant.brand,
            article: variant.article,
            spec: variant.spec,
            price: variant.price,
            imageUrl: variant.imageUrl,
            companyId: variant.companyId,
            product_url: variant.productUrl,
          };

          return (
            <AddModalForm
              library={library.filter((m) => m.category === item.type)}
              items={ctx.items}
              companies={localCompanies}
              orgSlug={orgSlug}
              editing={editingLike}
              variantMode
              variantFor={item}
              onClose={ctx.closeModal}
              onAddFromLibrary={() => {}}
              onFillFromLibrary={() => {}}
              onAddManual={(input) => {
                ctx.updateVariantLocal(itemId, variantId, {
                  name: input.name,
                  brand: input.brand,
                  article: input.article,
                  spec: input.spec,
                  price: input.price,
                  imageUrl: input.imageUrl ?? null,
                  companyId: input.companyId ?? null,
                  companyName:
                    localCompanies.find((c) => c.id === input.companyId)
                      ?.name ?? "",
                });
                ctx.closeModal();
              }}
              onFillManual={(input) => {
                ctx.updateVariantLocal(itemId, variantId, {
                  name: input.name,
                  brand: input.brand,
                  article: input.article,
                  spec: input.spec,
                  price: input.price,
                  imageUrl: input.imageUrl ?? null,
                  companyId: input.companyId ?? null,
                  companyName:
                    localCompanies.find((c) => c.id === input.companyId)
                      ?.name ?? "",
                });
                ctx.closeModal();
              }}
            />
          );
        })()}

      {ctx.modal.kind === "add" && (
        <AddModalForm
          library={library}
          items={ctx.items}
          companies={localCompanies}
          orgSlug={orgSlug}
          editing={ctx.editing}
          parentId={ctx.modal.parentId}
          onClose={ctx.closeModal}
          onAddFromLibrary={(materials, parentId) => {
            ctx.addFromLibrary(materials, parentId);
            ctx.closeModal();
          }}
          onFillFromLibrary={(m) => ctx.fillPlaceholder(ctx.editing!.id, m)}
          onAddManual={(input, parentId) => {
            ctx.addManual(input, parentId);
            ctx.closeModal();
          }}
          onFillManual={(input) => ctx.fillManual(ctx.editing!.id, input)}
        />
      )}

      {ctx.modal.kind === "add-variant" &&
        (() => {
          const targetItemId = ctx.modal.itemId;
          const targetItem = ctx.items.find((i) => i.id === targetItemId);
          const variantLibrary = targetItem
            ? library.filter((m) => m.category === targetItem.type)
            : library;

          return (
            <AddModalForm
              library={variantLibrary}
              items={ctx.items}
              companies={localCompanies}
              orgSlug={orgSlug}
              editing={null}
              variantMode
              variantFor={targetItem}
              onClose={ctx.closeModal}
              onAddFromLibrary={(materials) => {
                // берём первый выбранный материал как вариант
                if (materials[0])
                  ctx.commitVariantFromLibrary(
                    targetItemId,
                    materials[0],
                    localCompanies,
                  );
              }}
              onFillFromLibrary={(m) =>
                ctx.commitVariantFromLibrary(targetItemId, m, localCompanies)
              }
              onAddManual={(input) =>
                ctx.commitVariantManual(targetItemId, input, localCompanies)
              }
              onFillManual={(input) =>
                ctx.commitVariantManual(targetItemId, input, localCompanies)
              }
            />
          );
        })()}

      {ctx.modal.kind === "procure" && (
        <ProcureModal ctx={ctx} onClose={ctx.closeModal} />
      )}

      {ctx.modal.kind === "summary" && (
        <SpecSummary ctx={ctx} project={project} onClose={ctx.closeModal} />
      )}

      {ctx.modal.kind === "operation" && (
        <ServiceOperationModal
          type={ctx.modal.type}
          ctx={ctx}
          companies={localCompanies}
          onClose={ctx.closeModal}
        />
      )}

      {ctx.modal.kind === "edit-operation" &&
        (() => {
          const { operationId } = ctx.modal;
          const op = ctx.operations.find((o) => o.id === operationId);
          if (!op) return null;
          return (
            <ServiceOperationModal
              key={op.id}
              type={op.type}
              operation={op}
              ctx={ctx}
              companies={localCompanies}
              onClose={ctx.closeModal}
            />
          );
        })()}

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
