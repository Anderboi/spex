'use client';

import { useSpecBuilder } from './hooks/useSpecBuilder';
import { fmt, plural, prefixOf } from './utils';
import HeaderSection from './components/HeaderSection';
import SearchSortSection from './components/SearchSortSection';
import TypeChipsSection from './components/TypeChipsSection';
import GroupSection from './components/GroupSection';
import BottomBar from './components/BottomBar';
import { DetailModal, AddModal, DeleteModal, ProcureModal, SummaryModal } from './components/Modals';

export default function SpecBuilder() {
  const ctx = useSpecBuilder();

  return (
    <div style={{ minHeight: '100vh', background: '#f3efe7', color: '#1b1a17', padding: '0 clamp(16px,4vw,48px) 140px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <HeaderSection
          saveStatus={ctx.saveStatus}
          mobMenuOpen={ctx.mobMenuOpen}
          setMobMenuOpen={ctx.setMobMenuOpen}
          setProcureOpen={ctx.setProcureOpen}
          setSummaryOpen={ctx.setSummaryOpen}
          setAddOpen={() => { ctx.setAddOpen(true); ctx.setEditId(null); ctx.setAddMode('catalog'); ctx.setCatSelected({}); ctx.setCatQuery(''); ctx.setCatQueryInput(''); ctx.setCatType('Все типы'); }}
        />
        <SearchSortSection
          queryInput={ctx.queryInput}
          setQueryInput={ctx.setQueryInput}
          setQuery={ctx.setQuery}
          sortLabel={ctx.sortLabel}
          onSort={() => ctx.setSort(s => s === 'code' ? 'az' : s === 'az' ? 'sum' : 'code')}
          debounceTimer={ctx.debounceTimer}
        />
        <TypeChipsSection activeType={ctx.activeType} setActiveType={ctx.setActiveType} />

        {ctx.stReplace.count > 0 && !ctx.replaceHidden && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18, background: '#f7e7e3', border: '1px solid #ecccc4', borderRadius: 14, padding: '13px 16px' }}>
            <span style={{ flex: 'none', width: 30, height: 30, borderRadius: '50%', background: '#bf5345', color: '#f7e7e3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700, lineHeight: 1 }}>!</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: '#a23b2e' }}>{ctx.stReplace.count} {plural(ctx.stReplace.count, 'позиция требует', 'позиции требуют', 'позиций требуют')} замены</div>
              <div style={{ fontSize: 12.5, color: '#9b6f64', marginTop: 1 }}>Отмечены статусом «Заменить» · {fmt(ctx.stReplace.sum)} ₽</div>
            </div>
            <button onClick={() => ctx.setStatusFilter(ctx.statusFilter === 'Заменить' ? null : 'Заменить')} style={{ flex: 'none', background: '#bf5345', color: '#fbf4f2', border: 'none', borderRadius: 10, padding: '10px 15px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>{ctx.statusFilter === 'Заменить' ? 'Показать все' : 'Показать только их'}</button>
            <button onClick={() => ctx.setReplaceHidden(true)} type="button" aria-label="Скрыть" style={{ flex: 'none', width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: '#bf5345', cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        )}

        {ctx.groups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '90px 20px', color: '#9a958a' }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: '#1b1a17' }}>Ничего не найдено</div>
            <div style={{ fontSize: 15, marginTop: 8 }}>Измените запрос или сбросьте фильтр по типу.</div>
            <button onClick={() => { ctx.setQuery(''); ctx.setQueryInput(''); ctx.setActiveType('Все типы'); ctx.setStatusFilter(null); }} style={{ marginTop: 20, background: '#1b1a17', color: '#f3efe7', border: 'none', borderRadius: 11, padding: '11px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Сбросить фильтры</button>
          </div>
        )}

        <div style={{ paddingTop: 6 }}>
          {ctx.groups.map(g => (
            <GroupSection key={g.type} group={g} collapsed={ctx.collapsed} setCollapsed={ctx.setCollapsed} selected={ctx.selected} accent={ctx.accent} dragId={ctx.dragId} dragOverId={ctx.dragOverId} statusMenuId={ctx.statusMenuId} setStatusMenuId={ctx.setStatusMenuId} setStatus={ctx.setStatus} onOpen={(id: string) => { ctx.setOpenId(id); ctx.setDetailTab('overview'); }} onOpenFill={ctx.openFill} onToggleSel={ctx.toggleSel} onRemove={(id: string) => { ctx.setDeleteId(id); ctx.setDeleteMode(null); ctx.setOpenId(null); }} onDeleteFull={ctx.deleteFull} onDragStart={(id: string, e: React.DragEvent) => { ctx.setDragId(id); try { e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', id); const row = (e.currentTarget as HTMLElement).closest('.spec-row'); if (row) e.dataTransfer!.setDragImage(row, 18, 18); } catch { } }} onDragOver={(id: string, e: React.DragEvent) => { e.preventDefault(); const d = ctx.dragId ? ctx.items.find(x => x.id === ctx.dragId) : null; if (d && d.type !== (ctx.items.find(x => x.id === id)?.type || '')) return; ctx.setDragOverId(id); }} onDrop={(e: React.DragEvent) => { e.preventDefault(); ctx.reorderItems(ctx.dragId!, ctx.dragOverId!); }} onDragEnd={() => { ctx.setDragId(null); ctx.setDragOverId(null); }} onAddPlaceholder={ctx.addPlaceholder} shareItem={ctx.shareItem} />
          ))}
        </div>
      </div>

      <BottomBar totalCount={ctx.totalCount} totalSum={ctx.totalSum} selectionActive={ctx.selectionActive} selCount={ctx.selItems.length} selSumStr={fmt(ctx.selItems.reduce((s, it) => s + it.qty * it.price, 0))} allVisibleSelected={ctx.allVisibleSelected} visIds={ctx.visIds} selected={ctx.selected} bulkMenuOpen={ctx.bulkMenuOpen} setBulkMenuOpen={ctx.setBulkMenuOpen} onClearSel={() => ctx.setSelected({})} onSelectAllVisible={() => { if (ctx.allVisibleSelected) { ctx.setSelected({}); } else { const s = { ...ctx.selected }; ctx.visIds.forEach(id => s[id] = true); ctx.setSelected(s); } }} onBulkDelete={ctx.bulkDelete} bulkStatus={ctx.bulkStatus} />

      {ctx.cur && (() => {
        const cur = ctx.cur!;
        return (
        <DetailModal
          item={cur} accent={ctx.accent} detailTab={ctx.detailTab} setDetailTab={ctx.setDetailTab}
          fileTab={ctx.fileTab} setFileTab={ctx.setFileTab} onClose={() => ctx.setOpenId(null)}
          onMinus={() => ctx.incQty(cur.id, -1)} onPlus={() => ctx.incQty(cur.id, 1)}
          onPrice={(v: string) => ctx.setPrice(cur.id, v)} onUnit={(v: string) => ctx.setUnit(cur.id, v)}
          onRemove={() => { ctx.setDeleteId(cur.id); ctx.setDeleteMode(null); ctx.setOpenId(null); }}
          setStatus={(s: string) => ctx.setStatus(cur.id, s)}
          onAvail={(v: string) => ctx.updateItem(cur.id, () => ({ avail: v }))}
          onLead={(v: string) => ctx.updateItem(cur.id, () => ({ leadTime: v }))}
          onMgrName={(v: string) => ctx.setItems(prev => prev.map(it => it.id === cur.id ? { ...it, manager: { ...(it.manager || {}), name: v } } : it))}
          onMgrPhone={(v: string) => ctx.setItems(prev => prev.map(it => it.id === cur.id ? { ...it, manager: { ...(it.manager || {}), phone: v } } : it))}
          onMgrEmail={(v: string) => ctx.setItems(prev => prev.map(it => it.id === cur.id ? { ...it, manager: { ...(it.manager || {}), email: v } } : it))}
          onNotes={(v: string) => ctx.updateItem(cur.id, () => ({ notes: v }))}
          onAddRoom={(name: string) => { name = name.trim(); if (!name) return; ctx.setItems(prev => prev.map(it => { if (it.id !== cur.id) return it; const r = it.rooms || []; if (r.indexOf(name) >= 0) return it; return { ...it, rooms: r.concat(name) }; })); }}
          onRemoveRoom={(name: string) => { ctx.setItems(prev => prev.map(it => { if (it.id !== cur.id) return it; return { ...it, rooms: (it.rooms || []).filter(x => x !== name) }; })); }}
          onAddVariant={() => { const variant: import('./types').Variant = { name: (cur.name || 'Вариант') + ' · альтернатива', lead: (cur.leadTime ? 'срок ' + cur.leadTime : 'срок уточняется'), price: cur.price || 0, selected: false }; ctx.updateItem(cur.id, it => ({ variants: [...(it.variants || []), variant] })); ctx.showToast('Вариант добавлен — отредактируйте детали'); }}
          onAddFiles={(cat: string, fileList: FileList | null) => ctx.addFiles(cur.id, cat, fileList)}
          onRemoveFile={(cat: string, fid: string) => ctx.removeFile(cur.id, cat, fid)}
          onSetTextureMap={(fid: string, map: string) => ctx.setTextureMap(cur.id, fid, map)}
          onShare={() => ctx.shareItem(cur)} saveStatus={ctx.saveStatus}
        />);
      })()}

      {ctx.addOpen && (
        <AddModal
          editId={ctx.editId} addMode={ctx.addMode} setAddMode={ctx.setAddMode}
          draft={ctx.draft} setDraft={ctx.setDraft}
          onClose={() => { ctx.setAddOpen(false); ctx.setEditId(null); }}
          onSubmit={ctx.submitAdd}
          catQueryInput={ctx.catQueryInput} setCatQueryInput={ctx.setCatQueryInput}
          setCatQuery={ctx.setCatQuery} catDebounce={ctx.catDebounce}
          catType={ctx.catType} setCatType={ctx.setCatType}
          catSort={ctx.catSort} setCatSort={ctx.setCatSort}
          catSortDir={ctx.catSortDir} setCatSortDir={ctx.setCatSortDir}
          catHideInSpec={ctx.catHideInSpec} setCatHideInSpec={ctx.setCatHideInSpec}
          catSelected={ctx.catSelected} toggleCat={ctx.toggleCat}
          catSorted={ctx.catSorted} catInSpec={ctx.catInSpec}
          catInSpecCount={ctx.catInSpecCount} catSelCount={ctx.catSelCount}
          catSelSumStr={fmt(ctx.catSelSum)} addFromCatalog={ctx.addFromCatalog}
          fillItem={ctx.fillItem} catTypesPresent={ctx.catTypesPresent}
          catSelectedList={ctx.catSelectedList} setCatSelected={ctx.setCatSelected}
          prefixOf={prefixOf}
        />
      )}

      {ctx.deleteId != null && (() => {
        const del = ctx.items.find(it => it.id === ctx.deleteId);
        if (!del) return null;
        return (
          <DeleteModal
            item={del} items={ctx.items} deleteMode={ctx.deleteMode}
            setDeleteMode={ctx.setDeleteMode}
            onClose={() => { ctx.setDeleteId(null); ctx.setDeleteMode(null); }}
            onDeleteFull={() => ctx.deleteFull(ctx.deleteId!)}
            onReplaceWithMark={(targetId: string) => ctx.replaceWithMark(ctx.deleteId!, targetId)}
            onCreateReplace={() => ctx.createAndReplace(ctx.deleteId!)}
            onClear={() => ctx.clearContent(ctx.deleteId!)}
            prefixOf={prefixOf}
          />
        );
      })()}

      {ctx.procureOpen && (
        <ProcureModal
          stAwait={ctx.stAwait} stOrder={ctx.stOrder} stDeliv={ctx.stDeliv}
          stReplace={ctx.stReplace} procScopeSum={ctx.procScopeSum}
          procScopeCount={ctx.procScopeCount} pickPhase={ctx.pickPhase}
          pickSum={ctx.pickSum} onClose={() => ctx.setProcureOpen(false)}
          onOpen={(id: string) => { ctx.setProcureOpen(false); ctx.setOpenId(id); ctx.setDetailTab('overview'); }}
          onShowReplace={() => { ctx.setProcureOpen(false); ctx.setStatusFilter('Заменить'); ctx.setActiveType('Все типы'); ctx.setQuery(''); ctx.setQueryInput(''); }}
        />
      )}

      {ctx.summaryOpen && (
        <SummaryModal
          items={ctx.items} onClose={() => ctx.setSummaryOpen(false)}
          onPrint={() => window.print()}
          onExportCsv={() => {
            import('./utils').then(mod => mod.exportCSV(ctx.items, ctx.showToast));
          }}
        />
      )}

      {ctx.toast != null && (
        <div style={{ position: 'fixed', left: '50%', bottom: 108, transform: 'translateX(-50%)', zIndex: 80, display: 'flex', alignItems: 'center', gap: 16, background: '#1b1a17', color: '#f3efe7', padding: '13px 16px 13px 22px', borderRadius: 12, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 500, boxShadow: '0 14px 40px rgba(27,26,23,.32)' }}>
          <span>{ctx.toast!.msg}</span>
          {ctx.toast!.actionLabel && ctx.toast!.action && <span onClick={() => { ctx.toast!.action!(); ctx.setToast(null); }} style={{ flex: 'none', cursor: 'pointer', fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(243,239,231,.32)', color: '#f3efe7' }}>{ctx.toast!.actionLabel}</span>}
        </div>
      )}
    </div>
  );
}