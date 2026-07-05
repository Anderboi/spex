'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SpecItem, CatalogItem, DraftItem, FileEntry, Variant, TYPE_ORDER, STATUS_FLOW } from '../types';
import { CATALOG } from '../catalog';
import {
  STORAGE_KEY, fmt, prefixFor, nextCode, catKey, plural, prefixOf, numOf,
  renumberAfter, renumberSequential, exportCSV, SEED_ITEMS, FILE_CATS, guessMap, extOf, statusMeta
} from '../utils';

export interface ToastState {
  msg: string;
  actionLabel?: string;
  action?: () => void;
}

export interface GroupData {
  type: string;
  count: number;
  sumStr: string;
  caret: string;
  open: boolean;
  showTable: boolean;
  showCards: boolean;
  items: SpecItem[];
}

export interface ProcStats {
  items: SpecItem[];
  count: number;
  sum: number;
}

export function useSpecBuilder() {
  const [items, setItems] = useState<SpecItem[]>([]);
  const [query, setQuery] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [activeType, setActiveType] = useState('Все типы');
  const [sort, setSort] = useState<'code' | 'az' | 'sum'>('code');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [statusMenuId, setStatusMenuId] = useState<string | null>(null);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [replaceHidden, setReplaceHidden] = useState(false);
  const [procureOpen, setProcureOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<'catalog' | 'manual'>('catalog');
  const [catQuery, setCatQuery] = useState('');
  const [catQueryInput, setCatQueryInput] = useState('');
  const [catType, setCatType] = useState('Все типы');
  const [catSort, setCatSort] = useState('default');
  const [catSortDir, setCatSortDir] = useState<'asc' | 'desc'>('asc');
  const [catHideInSpec, setCatHideInSpec] = useState(false);
  const [catSelected, setCatSelected] = useState<Record<string, boolean>>({});
  const [fileTab, setFileTab] = useState('schemas');
  const [draft, setDraft] = useState<DraftItem>({ name: '', brand: '', type: 'Отделка', spec: '', qty: '1', unit: 'шт', price: '' });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [mobMenuOpen, setMobMenuOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [vw, setVw] = useState(1200);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const catDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastFocusRef = useRef<Element | null>(null);
  const visibleIdsRef = useRef<string[]>([]);
  const lastReplaceCountRef = useRef(0);

  // Init
  useEffect(() => {
    setVw(window.innerWidth);
    const handleResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', handleResize);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) { setItems(arr); setSaveStatus('saved'); return; }
      }
    } catch { }
    setItems(SEED_ITEMS);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Autosave
  useEffect(() => {
    if (items.length === 0) return;
    setSaveStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { }
      setSaveStatus('saved');
    }, 650);
    const rc = items.filter(it => it.status === 'Заменить').length;
    if (rc > lastReplaceCountRef.current && replaceHidden) setReplaceHidden(false);
    lastReplaceCountRef.current = rc;
  }, [items, replaceHidden]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (statusMenuId || bulkMenuOpen)) { e.preventDefault(); setStatusMenuId(null); setBulkMenuOpen(false); return; }
      const k = modalKey();
      if (e.key === 'Escape' && k) { e.preventDefault(); closeModal(k); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [statusMenuId, bulkMenuOpen, summaryOpen, procureOpen, deleteId, addOpen, openId]);

  // Focus management
  useEffect(() => {
    const now = modalKey();
    if (now) {
      if (!document.querySelector('[data-modal]')) lastFocusRef.current = document.activeElement;
      setTimeout(() => { const el = document.querySelector(`[data-modal="${now}"]`) as HTMLElement; if (el) el.focus(); }, 30);
    } else {
      const lf = lastFocusRef.current;
      if (lf && 'focus' in lf) setTimeout(() => { try { (lf as HTMLElement).focus(); } catch { } }, 30);
    }
  }, [summaryOpen, procureOpen, deleteId, addOpen, openId]);

  function modalKey(): string | null {
    if (summaryOpen) return 'summary';
    if (procureOpen) return 'procure';
    if (deleteId) return 'delete';
    if (addOpen) return 'add';
    if (openId) return 'detail';
    return null;
  }

  function closeModal(k: string) {
    if (k === 'summary') setSummaryOpen(false);
    else if (k === 'procure') setProcureOpen(false);
    else if (k === 'delete') { setDeleteId(null); setDeleteMode(null); }
    else if (k === 'add') { setAddOpen(false); setEditId(null); }
    else if (k === 'detail') setOpenId(null);
  }

  const showToast = useCallback((msg: string, actionLabel?: string, onAction?: () => void) => {
    setToast({ msg, actionLabel, action: onAction });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), actionLabel ? 6000 : 2400);
  }, []);

  function updateItem(id: string, fn: (it: SpecItem) => Partial<SpecItem>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...fn(it) } : it));
  }

  const setStatus = useCallback((id: string, s: string) => { updateItem(id, () => ({ status: s })); setStatusMenuId(null); }, []);
  const incQty = useCallback((id: string, d: number) => { updateItem(id, it => ({ qty: Math.max(1, it.qty + d) })); }, []);
  const setPrice = useCallback((id: string, v: string) => { const n = parseInt(v.replace(/\D/g, '')) || 0; updateItem(id, () => ({ price: n })); }, []);
  const setUnit = useCallback((id: string, v: string) => { updateItem(id, () => ({ unit: v })); }, []);
  const toggleSel = useCallback((id: string) => { setSelected(prev => { const s = { ...prev }; if (s[id]) delete s[id]; else s[id] = true; return s; }); }, []);

  function deleteFull(id: string) {
    const target = items.find(it => it.id === id);
    if (!target) return;
    const p = prefixOf(target.code), n = numOf(target.code);
    const snapshot = items.map(it => ({ ...it }));
    setItems(prev => { let next = prev.filter(it => it.id !== id); next = renumberAfter(next, p, n); return next; });
    setSelected(prev => { const s = { ...prev }; delete s[id]; return s; });
    if (openId === id) setOpenId(null);
    setDeleteId(null); setDeleteMode(null);
    showToast('Марка ' + target.code + ' удалена · номера смещены', 'Отменить', () => { setItems(snapshot); showToast('Действие отменено'); });
  }

  function replaceWithMark(id: string, targetId: string) {
    const src = items.find(it => it.id === id);
    const tgt = items.find(it => it.id === targetId);
    if (!src || !tgt) return;
    const p = prefixOf(src.code), n = numOf(src.code);
    const snapshot = items.map(it => ({ ...it }));
    setItems(prev => {
      let next = prev.map(it => it.id === targetId ? { ...it, rooms: Array.from(new Set([...(it.rooms || []), ...(src.rooms || [])])) } : it);
      next = next.filter(it => it.id !== id);
      next = renumberAfter(next, p, n);
      return next;
    });
    setSelected(prev => { const s = { ...prev }; delete s[id]; return s; });
    setDeleteId(null); setDeleteMode(null); setOpenId(null);
    const cnt = (src.rooms || []).length;
    const msg = cnt ? ('Назначения (' + cnt + ') перенесены на ' + tgt.code + ' · ' + src.code + ' удалена') : (src.code + ' удалена · принимающая марка ' + tgt.code);
    showToast(msg, 'Отменить', () => { setItems(snapshot); showToast('Действие отменено'); });
  }

  function createAndReplace(id: string) {
    const src = items.find(it => it.id === id);
    if (!src) return;
    const p = prefixOf(src.code), n = numOf(src.code);
    const snapshot = items.map(it => ({ ...it }));
    const newId = 'i' + Date.now();
    setItems(prev => {
      let next = [...prev, { id: newId, type: src.type, code: '', name: '', brand: '—', spec: '—', qty: 1, unit: src.unit || 'шт', price: 0, status: 'Черновик' as const, article: '—', format: '—', surface: '—', color: '—', variants: [], rooms: [...(src.rooms || [])], placeholder: true }];
      next = next.filter(it => it.id !== id);
      next = renumberAfter(next, p, n);
      const cnt = next.filter(it => it.type === src.type).length;
      next = next.map(it => it.id === newId ? { ...it, code: prefixFor(src.type) + '-' + String(cnt).padStart(2, '0') } : it);
      return next;
    });
    setDeleteId(null); setDeleteMode(null); setOpenId(null);
    showToast('Создана новая пустая марка · назначения перенесены', 'Отменить', () => { setItems(snapshot); showToast('Действие отменено'); });
  }

  function clearContent(id: string) {
    const snapshot = items.map(it => ({ ...it }));
    updateItem(id, () => ({ name: '', brand: '—', spec: '—', price: 0, status: 'Черновик', article: '—', format: '—', surface: '—', color: '—', variants: [], placeholder: true, cleared: true }));
    setDeleteId(null); setDeleteMode(null); setOpenId(null);
    showToast('Содержимое очищено · пустая марка сохранена', 'Отменить', () => { setItems(snapshot); showToast('Действие отменено'); });
  }

  function bulkDelete() {
    const ids = Object.keys(selected).filter(id => items.some(it => it.id === id));
    if (!ids.length) return;
    const snapshot = items.map(it => ({ ...it }));
    setItems(prev => { let next = prev.filter(it => !selected[it.id]); next = renumberSequential(next); return next; });
    setSelected({});
    showToast('Удалено марок: ' + ids.length + ' · номера пересчитаны', 'Отменить', () => { setItems(snapshot); showToast('Действие отменено'); });
  }

  function bulkStatus(s: string) {
    setItems(prev => prev.map(it => (selected[it.id] && !it.placeholder) ? { ...it, status: s } : it));
    showToast('Статус «' + s + '» · марок: ' + Object.keys(selected).length);
  }

  function reorderItems(dragIdVal: string, overIdVal: string) {
    if (!dragIdVal || dragIdVal === overIdVal) { setDragId(null); setDragOverId(null); return; }
    setItems(prev => {
      let list = [...prev];
      if (visibleIdsRef.current.length) {
        const pos: Record<string, number> = {};
        visibleIdsRef.current.forEach((id, i) => pos[id] = i);
        list = list.sort((a, b) => { const pa = pos[a.id], pb = pos[b.id]; if (pa == null && pb == null) return 0; if (pa == null) return 1; if (pb == null) return -1; return pa - pb; });
      }
      const from = list.findIndex(i => i.id === dragIdVal);
      const to = list.findIndex(i => i.id === overIdVal);
      if (from < 0 || to < 0 || list[from].type !== list[to].type) return prev;
      const [m] = list.splice(from, 1);
      list.splice(to, 0, m);
      const counters: Record<string, number> = {};
      list = list.map(it => { const p = prefixOf(it.code); counters[p] = (counters[p] || 0) + 1; return { ...it, code: p + '-' + String(counters[p]).padStart(2, '0') }; });
      setSort('code');
      return list;
    });
    setDragId(null); setDragOverId(null);
  }

  function shareItem(it: SpecItem) {
    const base = typeof location !== 'undefined' ? (location.origin + location.pathname) : '';
    const url = base + '#material=' + it.id;
    if (typeof navigator !== 'undefined' && navigator.share) { navigator.share({ title: it.name + ' · ' + it.brand, text: it.name + ' (' + it.code + ') — ' + it.spec, url }).catch(() => { }); }
    else if (typeof navigator !== 'undefined' && navigator.clipboard) { navigator.clipboard.writeText(url).then(() => showToast('Ссылка на карточку скопирована')).catch(() => showToast('Не удалось скопировать')); }
    else showToast('Ссылка: ' + url);
  }

  function addPlaceholder(type: string) {
    const item: SpecItem = { id: 'i' + Date.now(), type, code: nextCode([...items], type), name: '', brand: '', spec: '', qty: 1, unit: 'шт', price: 0, status: 'Черновик', article: '', format: '', surface: '', color: '', variants: [], placeholder: true };
    setItems(prev => [...prev, item]);
    showToast('Добавлена пустая позиция · ' + item.code);
  }

  function openFill(it: SpecItem) {
    setAddOpen(true); setEditId(it.id); setAddMode('catalog'); setCatSelected({}); setCatQuery(''); setCatQueryInput(''); setCatSort('default'); setCatSortDir('asc');
    setCatType(CATALOG.some(c => c.type === it.type) ? it.type : 'Все типы');
    setDraft({ name: it.name || '', brand: (it.brand && it.brand !== '—') ? it.brand : '', type: it.type, spec: (it.spec && it.spec !== '—') ? it.spec : '', qty: String(it.qty || 1), unit: it.unit || 'шт', price: it.price ? String(it.price) : '' });
  }

  function submitAdd() {
    const price = parseInt(draft.price.replace(/\D/g, '')) || 0;
    if (!draft.name.trim()) return;
    if (editId) {
      updateItem(editId, () => ({ name: draft.name.trim(), brand: draft.brand.trim() || '—', spec: draft.spec.trim() || '—', qty: Math.max(1, parseInt(draft.qty) || 1), unit: (draft.unit || 'шт').trim(), price, status: price > 0 ? 'Подобрано' : 'Не выбрано', placeholder: false }));
      setAddOpen(false); setEditId(null); setDraft({ name: '', brand: '', type: draft.type, spec: '', qty: '1', unit: 'шт', price: '' });
      showToast('Позиция заполнена');
      return;
    }
    if (!(price > 0)) return;
    const item: SpecItem = { id: 'i' + Date.now(), type: draft.type, code: nextCode([...items], draft.type), name: draft.name.trim(), brand: draft.brand.trim() || '—', spec: draft.spec.trim() || '—', qty: Math.max(1, parseInt(draft.qty) || 1), unit: (draft.unit || 'шт').trim(), price, status: 'Не выбрано', article: '—', format: '—', surface: '—', color: '—', variants: [] };
    setItems(prev => [item, ...prev]);
    setAddOpen(false); setDraft({ name: '', brand: '', type: draft.type, spec: '', qty: '1', unit: 'шт', price: '' });
  }

  function toggleCat(key: string) {
    if (editId) { setCatSelected(catSelected[key] ? {} : { [key]: true }); return; }
    setCatSelected(prev => { const s = { ...prev }; if (s[key]) delete s[key]; else s[key] = true; return s; });
  }

  function addFromCatalog() {
    const chosen = CATALOG.filter(c => catSelected[catKey(c)]);
    if (!chosen.length) return;
    if (editId) {
      const c = chosen[0];
      updateItem(editId, () => ({ name: c.name, brand: c.brand, spec: c.spec, unit: c.unit, price: c.price, article: c.article || '—', format: c.format || '—', surface: c.surface || '—', color: c.color || '—', status: 'Подобрано', placeholder: false }));
      setAddOpen(false); setEditId(null); setCatSelected({}); showToast('Позиция заполнена · ' + c.name);
      return;
    }
    let extra = 0;
    const seq: Record<string, number> = {};
    const newItems = chosen.map(c => {
      const type = c.type;
      const n = items.filter(it => it.type === type).length + 1 + (seq[type] || 0);
      seq[type] = (seq[type] || 0) + 1;
      const code = prefixFor(type) + '-' + String(n).padStart(2, '0');
      return { id: 'i' + (Date.now() + extra++), type, code, name: c.name, brand: c.brand, spec: c.spec, qty: 1, unit: c.unit, price: c.price, status: 'Подобрано' as const, article: c.article, format: c.format, surface: c.surface, color: c.color, variants: [] };
    });
    setItems(prev => [...newItems, ...prev]);
    setAddOpen(false); setCatSelected({});
    showToast('Добавлено из каталога · ' + newItems.length + ' ' + plural(newItems.length, 'позиция', 'позиции', 'позиций'));
  }

  function addFiles(itemId: string, cat: string, fileList: FileList | null) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    const isTex = FILE_CATS.find(c => c.key === cat)?.kind === 'tex';
    let pending = files.length;
    const built: FileEntry[] = [];
    const commit = () => {
      setItems(prev => prev.map(it => {
        if (it.id !== itemId) return it;
        const f = { ...(it.files || {}) };
        f[cat] = (f[cat] || []).concat(built);
        return { ...it, files: f };
      }));
      showToast(built.length + ' ' + plural(built.length, 'файл добавлен', 'файла добавлено', 'файлов добавлено'));
    };
    files.forEach((file: File) => {
      const base: FileEntry = { id: 'f' + Date.now() + Math.random().toString(36).slice(2, 6), name: file.name, size: file.size, ext: extOf(file.name), at: Date.now() };
      if (isTex) base.map = guessMap(file.name);
      const isImg = isTex && /^image\//.test(file.type);
      if (isImg) {
        const rd = new FileReader();
        rd.onload = () => { base.url = rd.result as string; built.push(base); if (--pending === 0) commit(); };
        rd.onerror = () => { built.push(base); if (--pending === 0) commit(); };
        rd.readAsDataURL(file);
      } else { built.push(base); if (--pending === 0) commit(); }
    });
  }

  function removeFile(itemId: string, cat: string, fid: string) {
    setItems(prev => prev.map(it => {
      if (it.id !== itemId) return it;
      const f = { ...(it.files || {}) };
      f[cat] = (f[cat] || []).filter(x => x.id !== fid);
      return { ...it, files: f };
    }));
  }

  function setTextureMap(itemId: string, fid: string, map: string) {
    setItems(prev => prev.map(it => {
      if (it.id !== itemId) return it;
      const f = { ...(it.files || {}) };
      f.textures = (f.textures || []).map(x => x.id === fid ? { ...x, map } : x);
      return { ...it, files: f };
    }));
  }

  const isDesktop = vw >= 820;
  const accent = '#1b1a17';

  const list = useMemo(() => {
    let l = items.filter(it => {
      if (activeType !== 'Все типы' && it.type !== activeType) return false;
      if (statusFilter && it.status !== statusFilter) return false;
      if (query.trim()) { const hay = (it.name + ' ' + it.brand + ' ' + it.code + ' ' + it.spec).toLowerCase(); if (!hay.includes(query.trim().toLowerCase())) return false; }
      return true;
    });
    if (sort === 'az') l = [...l].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    else if (sort === 'sum') l = [...l].sort((a, b) => (b.qty * b.price) - (a.qty * a.price));
    else l = [...l].sort((a, b) => a.code.localeCompare(b.code, 'ru'));
    return l;
  }, [items, activeType, statusFilter, query, sort]);

  const groups = useMemo((): GroupData[] => {
    const gs = TYPE_ORDER.map(type => {
      const its = list.filter(it => it.type === type);
      if (!its.length) return null;
      const sum = its.reduce((s, it) => s + it.qty * it.price, 0);
      const open = !collapsed[type];
      return { type, count: its.length, sumStr: fmt(sum), caret: open ? 'rotate(0deg)' : 'rotate(-90deg)', open, showTable: open && isDesktop, showCards: open && !isDesktop, items: its };
    }).filter(Boolean) as GroupData[];
    visibleIdsRef.current = [];
    gs.forEach(g => g.items.forEach(i => visibleIdsRef.current.push(i.id)));
    return gs;
  }, [list, collapsed, isDesktop]);

  const selItems = items.filter(it => selected[it.id]);
  const selectionActive = selItems.length > 0;
  const visIds = visibleIdsRef.current;
  const allVisibleSelected = visIds.length > 0 && visIds.every(id => selected[id]);
  const totalCount = list.length;
  const totalSum = fmt(list.reduce((s, it) => s + it.qty * it.price, 0));
  const cur = items.find(it => it.id === openId);

  const catTypesPresent = ['Все типы', ...TYPE_ORDER.filter(t => CATALOG.some(c => c.type === t))];
  const cq = catQuery.trim().toLowerCase();
  const specKeys = new Set<string>();
  items.filter(it => !it.placeholder).forEach(it => {
    if (it.article && it.article !== '—') specKeys.add('a:' + it.article);
    specKeys.add('n:' + (it.name || '').toLowerCase().trim() + '|' + (it.brand || '').toLowerCase().trim());
  });
  const catInSpec = (c: CatalogItem) => (!!c.article && specKeys.has('a:' + c.article)) || specKeys.has('n:' + (c.name || '').toLowerCase().trim() + '|' + (c.brand || '').toLowerCase().trim());
  const catBase = CATALOG.filter(c => {
    if (catType !== 'Все типы' && c.type !== catType) return false;
    if (!cq) return true;
    return (c.name + ' ' + c.brand + ' ' + c.article + ' ' + c.spec).toLowerCase().includes(cq);
  });
  const catInSpecCount = catBase.filter(catInSpec).length;
  const catVisible = catHideInSpec ? catBase.filter(c => !catInSpec(c)) : catBase;
  const catSorted = [...catVisible].sort((a, b) => {
    const ia = catInSpec(a) ? 1 : 0, ib = catInSpec(b) ? 1 : 0;
    if (ia !== ib) return ia - ib;
    let r = 0;
    if (catSort === 'name') r = a.name.localeCompare(b.name, 'ru') * (catSortDir === 'desc' ? -1 : 1);
    else if (catSort === 'brand') r = (a.brand.localeCompare(b.brand, 'ru') || a.name.localeCompare(b.name, 'ru')) * (catSortDir === 'desc' ? -1 : 1);
    else if (catSort === 'price') r = (a.price - b.price) * (catSortDir === 'desc' ? -1 : 1);
    return r;
  });
  const catSelectedList = CATALOG.filter(c => catSelected[catKey(c)]);
  const catSelCount = catSelectedList.length;
  const catSelSum = catSelectedList.reduce((s, c) => s + c.price, 0);
  const fillItem: SpecItem | null = editId ? (items.find(it => it.id === editId) ?? null) : null;

  const realItems = items.filter(it => !it.placeholder);
  const procMap = (key: string): ProcStats => { const its = realItems.filter(it => it.status === key); return { items: its, count: its.length, sum: its.reduce((s, it) => s + it.qty * it.price, 0) }; };
  const stAwait = procMap('Согласовано'), stOrder = procMap('Приобретено'), stDeliv = procMap('Доставлено'), stReplace = procMap('Заменить');
  const procScopeSum = stAwait.sum + stOrder.sum + stDeliv.sum;
  const procScopeCount = stAwait.count + stOrder.count + stDeliv.count;
  const pickPhase = realItems.filter(it => it.status === 'Не выбрано' || it.status === 'Подобрано');
  const pickSum = pickPhase.reduce((s, it) => s + it.qty * it.price, 0);
  const sortLabel = sort === 'code' ? 'По коду' : sort === 'az' ? 'А→Я' : 'По сумме';

  // Procurement stages for the procure modal
  const mkProcStage = (st: ProcStats, key: string, label: string, sub: string) => ({
    label, sub, color: statusMeta(key, accent).bar, count: st.count, sumStr: fmt(st.sum),
    hasItems: st.count > 0, noItems: st.count === 0, items: st.items,
  });
  const procStages = [
    mkProcStage(stAwait, 'Согласовано', 'Ожидает закупки', 'Согласовано — можно заказывать'),
    mkProcStage(stOrder, 'Приобретено', 'Заказано', 'Оплачено · в производстве или в пути'),
    mkProcStage(stDeliv, 'Доставлено', 'Доставлено', 'Получено на объекте'),
  ];
  type ProcBar = { color: string; width: string; show: boolean };
  const procBars: ProcBar[] = [
    { color: statusMeta('Доставлено', accent).bar, width: procScopeSum ? (stDeliv.sum / procScopeSum * 100) + '%' : '0%', show: stDeliv.count > 0 },
    { color: statusMeta('Приобретено', accent).bar, width: procScopeSum ? (stOrder.sum / procScopeSum * 100) + '%' : '0%', show: stOrder.count > 0 },
    { color: statusMeta('Согласовано', accent).bar, width: procScopeSum ? (stAwait.sum / procScopeSum * 100) + '%' : '0%', show: stAwait.count > 0 },
  ].filter(b => b.show);
  const procEmpty = procScopeCount === 0 && stReplace.count === 0;
  const procDeliveredPct = procScopeSum ? Math.round(stDeliv.sum / procScopeSum * 100) : 0;
  const procHeadline = `${stDeliv.count} из ${procScopeCount} ${plural(procScopeCount, 'позиции', 'позиций', 'позиций')} доставлено`;
  const hasProcReplace = stReplace.count > 0;
  const hasProcPick = pickPhase.length > 0;

  return {
    // State
    items, setItems, query, setQuery, queryInput, setQueryInput,
    activeType, setActiveType, sort, setSort, collapsed, setCollapsed,
    openId, setOpenId, detailTab, setDetailTab, addOpen, setAddOpen,
    editId, setEditId, deleteId, setDeleteId, deleteMode, setDeleteMode,
    selected, setSelected, statusMenuId, setStatusMenuId, bulkMenuOpen, setBulkMenuOpen,
    replaceHidden, setReplaceHidden, procureOpen, setProcureOpen,
    summaryOpen, setSummaryOpen, statusFilter, setStatusFilter,
    addMode, setAddMode, catQuery, setCatQuery, catQueryInput, setCatQueryInput,
    catType, setCatType, catSort, setCatSort, catSortDir, setCatSortDir,
    catHideInSpec, setCatHideInSpec, catSelected, setCatSelected,
    fileTab, setFileTab, draft, setDraft, toast, setToast,
    mobMenuOpen, setMobMenuOpen, dragId, setDragId, dragOverId, setDragOverId,
    saveStatus, vw, debounceTimer, catDebounce, visibleIdsRef,

    // Computed
    isDesktop, accent, list, groups, selItems, selectionActive, visIds,
    allVisibleSelected, totalCount, totalSum, cur,
    catTypesPresent, catInSpec, catInSpecCount, catSorted, catSelectedList,
    catSelCount, catSelSum, fillItem,
    stAwait, stOrder, stDeliv, stReplace, procScopeSum, procScopeCount,
    procScopeSumStr: fmt(procScopeSum), pickPhase, pickSum, sortLabel,
    procStages, procBars, procEmpty, procDeliveredPct, procHeadline,
    procDeliveredCount: stDeliv.count,
    hasProcReplace, procReplaceCount: stReplace.count, procReplaceSumStr: fmt(stReplace.sum),
    hasProcPick, procPickCount: pickPhase.length, procPickSumStr: fmt(pickSum),

    // Actions
    showToast, updateItem, setStatus, incQty, setPrice, setUnit, toggleSel,
    deleteFull, replaceWithMark, createAndReplace, clearContent,
    bulkDelete, bulkStatus, reorderItems, shareItem, addPlaceholder,
    openFill, submitAdd, toggleCat, addFromCatalog, addFiles, removeFile, setTextureMap,
    closeModal, modalKey,
  };
}