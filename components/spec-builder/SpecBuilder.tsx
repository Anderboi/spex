"use client";

import { fmt, plural, prefixOf } from "@/lib/utils";
import HeaderSection from "./components/HeaderSection";
import SearchSortSection from "./components/SearchSortSection";
import TypeChipsSection from "./components/TypeChipsSection";
import GroupSection from "./components/GroupSection";
import BottomBar from "./components/BottomBar";
import { DeleteModal, ProcureModal, SummaryModal } from "./components/modals";
import AddModalForm from "./components/AddModalForm";
import { useSpecBuilder } from "@/hooks/useSpecBuilder";
import { DetailModal } from "./components/DetailsModal";
import { useState, useTransition } from "react";
import { SpecItem } from "@/lib/types";

export default function SpecBuilder({
  projectId,
  initialItems,
}: {
  projectId: string;
  initialItems: SpecItem[];
}) {
  const ctx = useSpecBuilder();

  const [items, setItems] = useState(initialItems);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="min-h-screen w-full min-w-0 bg-bg text-fg px-4 sm:px-6 md:px-10 pb-35 relative overflow-x-hidden">
      <div className="w-full min-w-0 //mx-auto">
        <HeaderSection
          saveStatus={ctx.saveStatus}
          mobMenuOpen={ctx.mobMenuOpen}
          setMobMenuOpen={ctx.setMobMenuOpen}
          setProcureOpen={ctx.setProcureOpen}
          setSummaryOpen={ctx.setSummaryOpen}
          setAddOpen={() => {
            ctx.setAddOpen(true);
            ctx.setEditId(null);
            ctx.setAddMode("catalog");
            ctx.setCatSelected({});
            ctx.setCatQuery("");
            ctx.setCatQueryInput("");
            ctx.setCatType("Все типы");
          }}
        />
        <SearchSortSection
          queryInput={ctx.queryInput}
          setQueryInput={ctx.setQueryInput}
          setQuery={ctx.setQuery}
          sortLabel={ctx.sortLabel}
          onSort={() =>
            ctx.setSort((s) =>
              s === "code" ? "az" : s === "az" ? "sum" : "code",
            )
          }
          debounceTimer={ctx.debounceTimer}
        />
        <TypeChipsSection
          activeType={ctx.activeType}
          setActiveType={ctx.setActiveType}
        />

        {ctx.stReplace.count > 0 && !ctx.replaceHidden && (
          <div className="flex items-center gap-3 mt-4 bg-bg-red-light border border-border-red rounded-lg py-1 sm:py-2 px-2 sm:px-4">
            <span className="flex-none size-7 rounded-full bg-bg-red text-bg-red-light flex items-center justify-center text-[17px] font-bold leading-none">
              !
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[14.5px] font-semibold text-fg-red">
                {ctx.stReplace.count}{" "}
                {plural(
                  ctx.stReplace.count,
                  "позиция требует",
                  "позиции требуют",
                  "позиций требуют",
                )}{" "}
                замены
              </div>
              <div className="text-[12.5px] text-fg-dim-text hidden md:block">
                Отмечены статусом «Заменить» · {fmt(ctx.stReplace.sum)} ₽
              </div>
            </div>
            <button
              onClick={() =>
                ctx.setStatusFilter(
                  ctx.statusFilter === "Заменить" ? null : "Заменить",
                )
              }
              className="flex-none bg-bg-red text-bg-delete border-none rounded-[10px] py-2 px-4 font-sans text-[13.5px] font-semibold cursor-pointer whitespace-nowrap"
            >
              {ctx.statusFilter === "Заменить"
                ? "Показать все"
                : "Показать только их"}
            </button>
            <button
              onClick={() => ctx.setReplaceHidden(true)}
              type="button"
              aria-label="Скрыть"
              className="flex-none size-7 rounded-lg border-none bg-transparent text-bg-red cursor-pointer text-[16px] leading-none flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        )}

        {ctx.groups.length === 0 && (
          <div className="text-center py-22 px-5 text-fg-muted">
            <div className="text-[22px] font-semibold text-fg">
              Ничего не найдено
            </div>
            <div className="text-[15px] mt-2">
              Измените запрос или сбросьте фильтр по типу.
            </div>
            <button
              onClick={() => {
                ctx.setQuery("");
                ctx.setQueryInput("");
                ctx.setActiveType("Все типы");
                ctx.setStatusFilter(null);
              }}
              className="mt-5 bg-bg-accent text-bg border-none rounded-[12px] py-3 px-5 text-[14px] font-semibold cursor-pointer"
            >
              Сбросить фильтры
            </button>
          </div>
        )}

        <div className="pt-1">
          {ctx.groups.map((g) => (
            <GroupSection
              key={g.type}
              group={g}
              collapsed={ctx.collapsed}
              setCollapsed={ctx.setCollapsed}
              selected={ctx.selected}
              accent={ctx.accent}
              dragId={ctx.dragId}
              dragOverId={ctx.dragOverId}
              statusMenuId={ctx.statusMenuId}
              setStatusMenuId={ctx.setStatusMenuId}
              setStatus={ctx.setStatus}
              onOpen={(id: string) => {
                ctx.setOpenId(id);
                ctx.setDetailTab("overview");
              }}
              onOpenFill={ctx.openFill}
              onToggleSel={ctx.toggleSel}
              onRemove={(id: string) => {
                ctx.setDeleteId(id);
                ctx.setDeleteMode(null);
                ctx.setOpenId(null);
              }}
              onDeleteFull={ctx.deleteFull}
              onDragStart={(id: string, e: React.DragEvent) => {
                ctx.setDragId(id);
                try {
                  e.dataTransfer!.effectAllowed = "move";
                  e.dataTransfer!.setData("text/plain", id);
                  const row = (e.currentTarget as HTMLElement).closest(
                    ".spec-row",
                  );
                  if (row) e.dataTransfer!.setDragImage(row, 18, 18);
                } catch {}
              }}
              onDragOver={(id: string, e: React.DragEvent) => {
                e.preventDefault();
                const d = ctx.dragId
                  ? ctx.items.find((x) => x.id === ctx.dragId)
                  : null;
                if (
                  d &&
                  d.type !== (ctx.items.find((x) => x.id === id)?.type || "")
                )
                  return;
                ctx.setDragOverId(id);
              }}
              onDrop={(e: React.DragEvent) => {
                e.preventDefault();
                ctx.reorderItems(ctx.dragId!, ctx.dragOverId!);
              }}
              onDragEnd={() => {
                ctx.setDragId(null);
                ctx.setDragOverId(null);
              }}
              onAddPlaceholder={ctx.addPlaceholder}
              shareItem={ctx.shareItem}
            />
          ))}
        </div>
      </div>

      <BottomBar
        totalCount={ctx.totalCount}
        totalSum={ctx.totalSum}
        selectionActive={ctx.selectionActive}
        selCount={ctx.selItems.length}
        selSumStr={fmt(
          ctx.selItems.reduce((s, it) => s + it.qty * it.price, 0),
        )}
        allVisibleSelected={ctx.allVisibleSelected}
        visIds={ctx.visIds}
        selected={ctx.selected}
        bulkMenuOpen={ctx.bulkMenuOpen}
        setBulkMenuOpen={ctx.setBulkMenuOpen}
        onClearSel={() => ctx.setSelected({})}
        onSelectAllVisible={() => {
          if (ctx.allVisibleSelected) {
            ctx.setSelected({});
          } else {
            const s = { ...ctx.selected };
            ctx.visIds.forEach((id) => (s[id] = true));
            ctx.setSelected(s);
          }
        }}
        onBulkDelete={ctx.bulkDelete}
        bulkStatus={ctx.bulkStatus}
      />

      {ctx.cur &&
        (() => {
          const cur = ctx.cur!;
          return (
            <DetailModal
              item={cur}
              accent={ctx.accent}
              detailTab={ctx.detailTab}
              setDetailTab={ctx.setDetailTab}
              fileTab={ctx.fileTab}
              setFileTab={ctx.setFileTab}
              onClose={() => ctx.setOpenId(null)}
              onMinus={() => ctx.incQty(cur.id, -1)}
              onPlus={() => ctx.incQty(cur.id, 1)}
              onPrice={(v: string) => ctx.setPrice(cur.id, v)}
              onUnit={(v: string) => ctx.setUnit(cur.id, v)}
              onRemove={() => {
                ctx.setDeleteId(cur.id);
                ctx.setDeleteMode(null);
                ctx.setOpenId(null);
              }}
              setStatus={(s: string) => ctx.setStatus(cur.id, s)}
              onAvail={(v: string) =>
                ctx.updateItem(cur.id, () => ({ avail: v }))
              }
              onLead={(v: string) =>
                ctx.updateItem(cur.id, () => ({ leadTime: v }))
              }
              onMgrName={(v: string) =>
                ctx.setItems((prev) =>
                  prev.map((it) =>
                    it.id === cur.id
                      ? { ...it, manager: { ...(it.manager || {}), name: v } }
                      : it,
                  ),
                )
              }
              onMgrPhone={(v: string) =>
                ctx.setItems((prev) =>
                  prev.map((it) =>
                    it.id === cur.id
                      ? { ...it, manager: { ...(it.manager || {}), phone: v } }
                      : it,
                  ),
                )
              }
              onMgrEmail={(v: string) =>
                ctx.setItems((prev) =>
                  prev.map((it) =>
                    it.id === cur.id
                      ? { ...it, manager: { ...(it.manager || {}), email: v } }
                      : it,
                  ),
                )
              }
              onNotes={(v: string) =>
                ctx.updateItem(cur.id, () => ({ notes: v }))
              }
              onAddRoom={(name: string) => {
                name = name.trim();
                if (!name) return;
                ctx.setItems((prev) =>
                  prev.map((it) => {
                    if (it.id !== cur.id) return it;
                    const r = it.rooms || [];
                    if (r.indexOf(name) >= 0) return it;
                    return { ...it, rooms: r.concat(name) };
                  }),
                );
              }}
              onRemoveRoom={(name: string) => {
                ctx.setItems((prev) =>
                  prev.map((it) => {
                    if (it.id !== cur.id) return it;
                    return {
                      ...it,
                      rooms: (it.rooms || []).filter((x) => x !== name),
                    };
                  }),
                );
              }}
              onAddVariant={() => {
                const variant: import("@/lib/types").Variant = {
                  name: (cur.name || "Вариант") + " · альтернатива",
                  lead: cur.leadTime
                    ? "срок " + cur.leadTime
                    : "срок уточняется",
                  price: cur.price || 0,
                  selected: false,
                };
                ctx.updateItem(cur.id, (it) => ({
                  variants: [...(it.variants || []), variant],
                }));
                ctx.showToast("Вариант добавлен — отредактируйте детали");
              }}
              onAddFiles={(cat: string, fileList: FileList | null) =>
                ctx.addFiles(cur.id, cat, fileList)
              }
              onRemoveFile={(cat: string, fid: string) =>
                ctx.removeFile(cur.id, cat, fid)
              }
              onSetTextureMap={(fid: string, map: string) =>
                ctx.setTextureMap(cur.id, fid, map)
              }
              onShare={() => ctx.shareItem(cur)}
              saveStatus={ctx.saveStatus}
            />
          );
        })()}

      {ctx.addOpen &&
        (() => {
          const handleManualSubmit = (data: {
            name: string;
            brand?: string;
            type: string;
            spec?: string;
            qty: number;
            unit: string;
            price: number;
          }) => {
            const price = data.price;
            if (ctx.editId) {
              ctx.updateItem(ctx.editId, () => ({
                name: data.name.trim(),
                brand: (data.brand || "").trim() || "—",
                spec: (data.spec || "").trim() || "—",
                qty: data.qty,
                unit: data.unit,
                price,
                status: price > 0 ? "Подобрано" : "Не выбрано",
                placeholder: false,
              }));
              ctx.showToast("Позиция заполнена");
            } else {
              const item: import("@/lib/types").SpecItem = {
                id: "i" + Date.now(),
                type: data.type,
                code: "",
                name: data.name.trim(),
                brand: (data.brand || "").trim() || "—",
                spec: (data.spec || "").trim() || "—",
                qty: data.qty,
                unit: data.unit,
                price,
                status: "Не выбрано",
                article: "—",
                format: "—",
                surface: "—",
                color: "—",
                variants: [],
              };
              ctx.setItems((prev: import("@/lib/types").SpecItem[]) => [
                item,
                ...prev,
              ]);
            }
            ctx.setAddOpen(false);
            ctx.setEditId(null);
          };
          return (
            <AddModalForm
              editId={ctx.editId}
              onClose={() => {
                ctx.setAddOpen(false);
                ctx.setEditId(null);
              }}
              onSubmitManual={handleManualSubmit}
              fillItem={ctx.fillItem}
              catQueryInput={ctx.catQueryInput}
              setCatQueryInput={ctx.setCatQueryInput}
              setCatQuery={ctx.setCatQuery}
              catDebounce={ctx.catDebounce}
              catType={ctx.catType}
              setCatType={ctx.setCatType}
              catSort={ctx.catSort}
              setCatSort={ctx.setCatSort}
              catSortDir={ctx.catSortDir}
              setCatSortDir={ctx.setCatSortDir}
              catHideInSpec={ctx.catHideInSpec}
              setCatHideInSpec={ctx.setCatHideInSpec}
              catSelected={ctx.catSelected}
              toggleCat={ctx.toggleCat}
              catSorted={ctx.catSorted}
              catInSpec={ctx.catInSpec}
              catInSpecCount={ctx.catInSpecCount}
              catSelCount={ctx.catSelCount}
              catSelSumStr={fmt(ctx.catSelSum)}
              addFromCatalog={ctx.addFromCatalog}
              catTypesPresent={ctx.catTypesPresent}
              catSelectedList={ctx.catSelectedList}
              setCatSelected={ctx.setCatSelected}
            />
          );
        })()}

      {ctx.deleteId != null &&
        (() => {
          const del = ctx.items.find((it) => it.id === ctx.deleteId);
          if (!del) return null;
          return (
            <DeleteModal
              item={del}
              items={ctx.items}
              deleteMode={ctx.deleteMode}
              setDeleteMode={ctx.setDeleteMode}
              onClose={() => {
                ctx.setDeleteId(null);
                ctx.setDeleteMode(null);
              }}
              onDeleteFull={() => ctx.deleteFull(ctx.deleteId!)}
              onReplaceWithMark={(targetId: string) =>
                ctx.replaceWithMark(ctx.deleteId!, targetId)
              }
              onCreateReplace={() => ctx.createAndReplace(ctx.deleteId!)}
              onClear={() => ctx.clearContent(ctx.deleteId!)}
              prefixOf={prefixOf}
            />
          );
        })()}

      {ctx.procureOpen && (
        <ProcureModal
          accent={ctx.accent}
          procEmpty={ctx.procEmpty}
          procDeliveredPct={ctx.procDeliveredPct}
          procHeadline={ctx.procHeadline}
          procScopeSumStr={ctx.procScopeSumStr}
          procBars={ctx.procBars}
          procStages={ctx.procStages}
          hasProcReplace={ctx.hasProcReplace}
          procReplaceCount={ctx.procReplaceCount}
          procReplaceSumStr={ctx.procReplaceSumStr}
          stReplace={ctx.stReplace}
          hasProcPick={ctx.hasProcPick}
          procPickCount={ctx.procPickCount}
          procPickSumStr={ctx.procPickSumStr}
          onClose={() => ctx.setProcureOpen(false)}
          onOpen={(id: string) => {
            ctx.setProcureOpen(false);
            ctx.setOpenId(id);
            ctx.setDetailTab("overview");
          }}
          onShowReplace={() => {
            ctx.setProcureOpen(false);
            ctx.setStatusFilter("Заменить");
            ctx.setActiveType("Все типы");
            ctx.setQuery("");
            ctx.setQueryInput("");
          }}
        />
      )}

      {ctx.summaryOpen && (
        <SummaryModal
          items={ctx.items}
          onClose={() => ctx.setSummaryOpen(false)}
          onPrint={() => window.print()}
          onExportCsv={() => {
            import("@/lib/utils").then((mod) =>
              mod.exportCSV(ctx.items, ctx.showToast),
            );
          }}
        />
      )}

      {ctx.toast != null && (
        <div className="fixed left-1/2 bottom-27 -translate-x-1/2 z-80 flex items-center gap-4 bg-bg-accent text-bg py-3 pl-6 pr-4 rounded-[12px] font-sans text-[14px] font-medium shadow-[0_14px_40px_rgba(27,26,23,.32)]">
          <span>{ctx.toast!.msg}</span>
          {ctx.toast!.actionLabel && ctx.toast!.action && (
            <span
              onClick={() => {
                ctx.toast!.action!();
                ctx.setToast(null);
              }}
              className="flex-none cursor-pointer font-bold py-[6px] px-3 rounded-lg border border-[rgba(243,239,231,.32)] text-bg"
            >
              {ctx.toast!.actionLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
