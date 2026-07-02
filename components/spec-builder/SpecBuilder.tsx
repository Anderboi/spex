'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SpecItem, CatalogItem, DraftItem, FileEntry, Variant, TYPE_ORDER, STATUS_FLOW, UNIT_OPTIONS, PREFIX_MAP } from './types';
import { CATALOG } from './catalog';

const STORAGE_KEY = 'spec_items_v1';
const BRAND_SITES: Record<string, string> = {
  'ABK': 'https://www.abk.it',
  'Ideal Work': 'https://www.idealwork.com',
  'GESSI': 'https://www.gessi.com',
  'Cassina': 'https://www.cassina.com',
  'Astep': 'https://asteplight.com',
};

function fmt(n: number | string): string {
  return Number(n || 0).toLocaleString('ru-RU');
}

function prefixFor(type: string): string {
  return PREFIX_MAP[type] || 'М';
}

function nextCode(items: SpecItem[], type: string): string {
  const n = items.filter(it => it.type === type).length + 1;
  return prefixFor(type) + '-' + String(n).padStart(2, '0');
}

function brandSite(brand: string): string {
  return BRAND_SITES[brand] || ('https://www.google.com/search?q=' + encodeURIComponent((brand || '') + ' официальный сайт'));
}

function statusMeta(s: string, accent: string) {
  if (s === 'Подобрано') return { dot: accent, bg: `color-mix(in srgb, ${accent} 15%, #f3efe7)`, fg: accent, bd: `color-mix(in srgb, ${accent} 38%, #f3efe7)`, bar: accent };
  const M: Record<string, { dot: string; bg: string; fg: string; bd: string; bar: string }> = {
    'Не выбрано': { dot: '#c79a35', bg: '#f6e6c5', fg: '#936713', bd: '#e8d29c', bar: '#d8b65a' },
    'Согласовано': { dot: '#1b1a17', bg: '#1b1a17', fg: '#f3efe7', bd: '#1b1a17', bar: '#1b1a17' },
    'Приобретено': { dot: '#3f6b80', bg: '#e7eef3', fg: '#365a6b', bd: '#cbdbe5', bar: '#3f6b80' },
    'Доставлено': { dot: '#5f7a3f', bg: '#e7efe0', fg: '#4d6633', bd: '#d0e0c3', bar: '#5f7a3f' },
    'Заменить': { dot: '#bf5345', bg: '#f7e7e3', fg: '#a23b2e', bd: '#ecccc4', bar: '#bf5345' },
    'Черновик': { dot: '#bcb7ab', bg: '#efe9dc', fg: '#9a958a', bd: '#e2dccd', bar: '#bcb7ab' },
  };
  return M[s] || M['Черновик'];
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && !(b >= 12 && b <= 14)) return few;
  return many;
}

function catKey(c: CatalogItem): string {
  return c.article || (c.brand + '|' + c.name);
}

function availMeta(a: string): string {
  const M: Record<string, string> = { 'В наличии': '#5f7a3f', 'Под заказ': '#3f6b80', 'Нет в наличии': '#bf5345', 'Уточняется': '#c79a35' };
  return M[a] || '#c79a35';
}

const FILE_CATS = [
  { key: 'schemas', label: 'Схемы', accept: '.pdf,.dwg,.dxf,.png,.jpg,.jpeg', kind: 'doc' as const, upTitle: 'Загрузить схему производителя', upHint: 'PDF, DWG, DXF · спецлисты, узлы, чертежи', empty: 'Чертежи, технические листы и узлы от производителя' },
  { key: 'textures', label: 'Текстуры', accept: 'image/*,.exr,.tif,.tiff', kind: 'tex' as const, upTitle: 'Загрузить текстуру', upHint: 'JPG, PNG, TIFF, EXR · карты для визуализации', empty: 'PBR-карты для 3ds Max, Corona, V-Ray, Blender' },
  { key: 'care', label: 'Инструкции', accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png', kind: 'doc' as const, upTitle: 'Загрузить инструкцию', upHint: 'PDF, DOC · монтаж, укладка, уход', empty: 'Инструкции по монтажу, укладке и уходу' },
  { key: 'cad', label: '3D / CAD', accept: '.skp,.rfa,.3ds,.max,.obj,.fbx,.dwg', kind: 'doc' as const, upTitle: 'Загрузить 3D / CAD-блок', upHint: 'SKP, RFA, MAX, 3DS, OBJ, FBX', empty: 'Готовые блоки и модели для дизайнера' },
];

const MAP_OPTIONS = ['Diffuse / Albedo', 'Normal', 'Roughness', 'Bump', 'Displacement', 'Metallic', 'AO', 'Opacity', 'Gloss'];

function guessMap(n: string): string {
  const s = n.toLowerCase();
  if (/normal|_nrm|_n[\._]/.test(s)) return 'Normal';
  if (/rough|_rgh/.test(s)) return 'Roughness';
  if (/disp|height|_dsp/.test(s)) return 'Displacement';
  if (/metal|_mtl/.test(s)) return 'Metallic';
  if (/_ao|occlusion/.test(s)) return 'AO';
  if (/bump/.test(s)) return 'Bump';
  if (/gloss/.test(s)) return 'Gloss';
  if (/alpha|opacity|mask/.test(s)) return 'Opacity';
  return 'Diffuse / Albedo';
}

function extOf(n: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(n || '');
  return m ? m[1].toUpperCase() : 'FILE';
}

function humanSize(b: number): string {
  if (!b) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

const SEED_ITEMS: SpecItem[] = [
  { id: 'i1', type: 'Отделка', code: 'От-01', name: 'Rome Vein', brand: 'ABK', spec: 'Керамогранит, 120×278', qty: 30, unit: 'м²', price: 6500, status: 'Не выбрано', article: 'PF60005800', format: '120 × 278 см · 6 мм', surface: 'Матовая, ректификат', color: 'Statuario', variants: [{ name: 'Rome Vein · ABK', lead: 'срок 4–6 недель', price: 6500, selected: true }, { name: 'Marvel Onyx · Atlas', lead: 'срок 2–3 недели', price: 5900, selected: false }], rooms: ['Гостиная', 'Кухня-столовая', 'Холл'], avail: 'Под заказ', leadTime: '4–6 недель', manager: { name: 'Анна Лебедева · ABK Studio', phone: '+7 495 120-44-90', email: 'a.lebedeva@abk.ru' }, notes: 'Заказывать с запасом +5% на подрезку. Раскладку согласовать с прорабом до отгрузки.' },
  { id: 'i2', type: 'Отделка', code: 'От-02', name: 'Rome Vein', brand: 'ABK', spec: 'Керамогранит, 60×120', qty: 11, unit: 'м²', price: 6500, status: 'Подобрано', article: 'PF60005801', format: '60 × 120 см · 9 мм', surface: 'Матовая', color: 'Statuario', variants: [{ name: 'Rome Vein · ABK', lead: 'срок 4–6 недель', price: 6500, selected: true }] },
  { id: 'i3', type: 'Отделка', code: 'От-03', name: 'Microtopping', brand: 'Ideal Work', spec: 'Микроцемент, серый', qty: 65, unit: 'м²', price: 1000, status: 'Согласовано', article: 'MT-GREY', format: 'наливной', surface: 'Шёлк-матовая', color: 'Grigio', variants: [] },
  { id: 'i4', type: 'Сантехника', code: 'С-01', name: 'Гигиенический душ', brand: 'GESSI', spec: 'Один вывод, чёрный', qty: 2, unit: 'шт', price: 18500, status: 'Заменить', article: 'GE-31643', format: 'настенный', surface: 'Black metal', color: 'Чёрный матовый', variants: [{ name: 'GESSI 316', lead: 'в наличии', price: 18500, selected: true }], rooms: ['Гостевой санузел', 'Постирочная'] },
  { id: 'i5', type: 'Сантехника', code: 'С-02', name: 'Inciso смеситель', brand: 'GESSI', spec: 'Настенный, хром', qty: 4, unit: 'шт', price: 13200, status: 'Не выбрано', article: 'GE-58111', format: 'настенный', surface: 'Chrome', color: 'Хром', variants: [], rooms: ['Ванная мастер', 'Гостевой санузел', 'Кухня-столовая', 'Санузел детский'] },
  { id: 'i6', type: 'Мебель', code: 'М-01', name: 'Soriana диван', brand: 'Cassina', spec: '3-местный, кожа Pelle', qty: 1, unit: 'шт', price: 340000, status: 'Приобретено', article: 'CAS-SOR3', format: '240 × 95 см', surface: 'Кожа Pelle', color: 'Sabbia', variants: [{ name: 'Soriana · кожа', lead: 'срок 10–12 недель', price: 340000, selected: true }, { name: 'Soriana · ткань', lead: 'срок 8 недель', price: 268000, selected: false }], rooms: ['Гостиная'] },
  { id: 'i7', type: 'Мебель', code: 'М-02', name: 'Mex кресло', brand: 'Cassina', spec: 'Ткань Rohi, песочный', qty: 2, unit: 'шт', price: 36000, status: 'Доставлено', article: 'CAS-MEX', format: '78 × 80 см', surface: 'Ткань Rohi', color: 'Песочный', variants: [] },
  { id: 'i8', type: 'Освещение', code: 'О-01', name: 'Model 2065', brand: 'Astep', spec: 'Подвес, опал + латунь', qty: 3, unit: 'шт', price: 31500, status: 'Не выбрано', article: 'AST-2065', format: 'Ø 25 см', surface: 'Опал. стекло', color: 'Латунь', variants: [{ name: 'Model 2065', lead: 'срок 5 недель', price: 31500, selected: true }] },
];

export default function SpecBuilder() {
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
  const [toast, setToast] = useState<{ msg: string; actionLabel?: string; action?: () => void } | null>(null);
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
    } catch (_) { }
    setItems(SEED_ITEMS);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    setSaveStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (_) { }
      setSaveStatus('saved');
    }, 650);
    const rc = items.filter(it => it.status === 'Заменить').length;
    if (rc > lastReplaceCountRef.current && replaceHidden) setReplaceHidden(false);
    lastReplaceCountRef.current = rc;
  }, [items]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (statusMenuId || bulkMenuOpen)) { e.preventDefault(); setStatusMenuId(null); setBulkMenuOpen(false); return; }
      const k = modalKey();
      if (e.key === 'Escape' && k) { e.preventDefault(); closeModal(k); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [statusMenuId, bulkMenuOpen, summaryOpen, procureOpen, deleteId, addOpen, openId]);

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

  function setStatus(id: string, s: string) { updateItem(id, () => ({ status: s })); setStatusMenuId(null); }
  function incQty(id: string, d: number) { updateItem(id, it => ({ qty: Math.max(1, it.qty + d) })); }
  function setPrice(id: string, v: string) { const n = parseInt(v.replace(/\D/g, '')) || 0; updateItem(id, () => ({ price: n })); }
  function setUnit(id: string, v: string) { updateItem(id, () => ({ unit: v })); }
  function toggleSel(id: string) { setSelected(prev => { const s = { ...prev }; if (s[id]) delete s[id]; else s[id] = true; return s; }); }

  function prefixOf(code: string) { return String(code || '').split('-')[0]; }
  function numOf(code: string) { return parseInt(String(code || '').split('-')[1], 10) || 0; }

  function renumberAfter(arr: SpecItem[], prefix: string, removedNum: number): SpecItem[] {
    return arr.map(it => {
      if (prefixOf(it.code) !== prefix) return it;
      const n = numOf(it.code);
      if (n > removedNum) return { ...it, code: prefix + '-' + String(n - 1).padStart(2, '0') };
      return it;
    });
  }

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

  function renumberSequential(arr: SpecItem[]): SpecItem[] {
    const byPrefix: Record<string, SpecItem[]> = {};
    arr.forEach(it => { const p = prefixOf(it.code); (byPrefix[p] = byPrefix[p] || []).push(it); });
    const map: Record<string, string> = {};
    Object.keys(byPrefix).forEach(p => {
      byPrefix[p].slice().sort((a, b) => numOf(a.code) - numOf(b.code)).forEach((it, i) => { map[it.id] = p + '-' + String(i + 1).padStart(2, '0'); });
    });
    return arr.map(it => map[it.id] ? { ...it, code: map[it.id] } : it);
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

  function exportCSV() {
    const head = ['Код', 'Наименование', 'Бренд', 'Тип', 'Спецификация', 'Кол-во', 'Ед.', 'Цена/шт, ₽', 'Итого, ₽', 'Статус'];
    const esc = (v: any) => { v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [head.join(';')];
    items.forEach(it => { lines.push([it.code, it.name, it.brand, it.type, it.spec, it.qty, it.unit, it.price, it.qty * it.price, it.status].map(esc).join(';')); });
    const grand = items.reduce((s, it) => s + it.qty * it.price, 0);
    lines.push('', 'ИТОГО;;;;;;;' + grand + ';');
    const csv = '\uFEFF' + lines.join('\r\n');
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'Спецификация.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast('CSV выгружен · откроется в Excel');
    } catch { showToast('Не удалось выгрузить'); }
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

  const groups = useMemo(() => {
    const gs = TYPE_ORDER.map(type => {
      const its = list.filter(it => it.type === type);
      if (!its.length) return null;
      const sum = its.reduce((s, it) => s + it.qty * it.price, 0);
      const open = !collapsed[type];
      return { type, count: its.length, sumStr: fmt(sum), caret: open ? 'rotate(0deg)' : 'rotate(-90deg)', open, showTable: open && isDesktop, showCards: open && !isDesktop, items: its };
    }).filter(Boolean);
    visibleIdsRef.current = [];
    gs.forEach(g => g!.items.forEach(i => visibleIdsRef.current.push(i.id)));
    return gs;
  }, [list, collapsed, isDesktop]);

  const selObj = selected;
  const selItems = items.filter(it => selObj[it.id]);
  const selectionActive = selItems.length > 0;
  const visIds = visibleIdsRef.current;
  const allVisibleSelected = visIds.length > 0 && visIds.every(id => selObj[id]);
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
  const fillItem = editId ? items.find(it => it.id === editId) : null;

  const realItems = items.filter(it => !it.placeholder);
  const procMap = (key: string) => { const its = realItems.filter(it => it.status === key); return { items: its, count: its.length, sum: its.reduce((s, it) => s + it.qty * it.price, 0) }; };
  const stAwait = procMap('Согласовано'), stOrder = procMap('Приобретено'), stDeliv = procMap('Доставлено'), stReplace = procMap('Заменить');
  const procScopeSum = stAwait.sum + stOrder.sum + stDeliv.sum;
  const procScopeCount = stAwait.count + stOrder.count + stDeliv.count;
  const pickPhase = realItems.filter(it => it.status === 'Не выбрано' || it.status === 'Подобрано');
  const pickSum = pickPhase.reduce((s, it) => s + it.qty * it.price, 0);
  const sortLabel = sort === 'code' ? 'По коду' : sort === 'az' ? 'А→Я' : 'По сумме';

  return (
    <div style={{ minHeight: '100vh', background: '#f3efe7', color: '#1b1a17', padding: '0 clamp(16px,4vw,48px) 140px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <HeaderSection saveStatus={saveStatus} mobMenuOpen={mobMenuOpen} setMobMenuOpen={setMobMenuOpen} setProcureOpen={setProcureOpen} setSummaryOpen={setSummaryOpen} setAddOpen={() => { setAddOpen(true); setEditId(null); setAddMode('catalog'); setCatSelected({}); setCatQuery(''); setCatQueryInput(''); setCatType('Все типы'); }} />
        <SearchSortSection queryInput={queryInput} setQueryInput={setQueryInput} setQuery={setQuery} sortLabel={sortLabel} onSort={() => setSort(s => s === 'code' ? 'az' : s === 'az' ? 'sum' : 'code')} debounceTimer={debounceTimer} />
        <TypeChipsSection activeType={activeType} setActiveType={setActiveType} />

        {stReplace.count > 0 && !replaceHidden && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18, background: '#f7e7e3', border: '1px solid #ecccc4', borderRadius: 14, padding: '13px 16px' }}>
            <span style={{ flex: 'none', width: 30, height: 30, borderRadius: '50%', background: '#bf5345', color: '#f7e7e3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700, lineHeight: 1 }}>!</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: '#a23b2e' }}>{stReplace.count} {plural(stReplace.count, 'позиция требует', 'позиции требуют', 'позиций требуют')} замены</div>
              <div style={{ fontSize: 12.5, color: '#9b6f64', marginTop: 1 }}>Отмечены статусом «Заменить» · {fmt(stReplace.sum)} ₽</div>
            </div>
            <button onClick={() => setStatusFilter(statusFilter === 'Заменить' ? null : 'Заменить')} style={{ flex: 'none', background: '#bf5345', color: '#fbf4f2', border: 'none', borderRadius: 10, padding: '10px 15px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>{statusFilter === 'Заменить' ? 'Показать все' : 'Показать только их'}</button>
            <button onClick={() => setReplaceHidden(true)} type="button" aria-label="Скрыть" style={{ flex: 'none', width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: '#bf5345', cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        )}

        {groups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '90px 20px', color: '#9a958a' }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: '#1b1a17' }}>Ничего не найдено</div>
            <div style={{ fontSize: 15, marginTop: 8 }}>Измените запрос или сбросьте фильтр по типу.</div>
            <button onClick={() => { setQuery(''); setQueryInput(''); setActiveType('Все типы'); setStatusFilter(null); }} style={{ marginTop: 20, background: '#1b1a17', color: '#f3efe7', border: 'none', borderRadius: 11, padding: '11px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Сбросить фильтры</button>
          </div>
        )}

        <div style={{ paddingTop: 6 }}>
          {groups.map(g => g && (
            <GroupSection key={g.type} group={g} collapsed={collapsed} setCollapsed={setCollapsed} showTable={g.showTable} showCards={g.showCards} selected={selected} accent={accent} dragId={dragId} dragOverId={dragOverId} statusMenuId={statusMenuId} setStatusMenuId={setStatusMenuId} setStatus={setStatus} onOpen={(id: string) => { setOpenId(id); setDetailTab('overview'); }} onOpenFill={openFill} onToggleSel={toggleSel} onRemove={(id: string) => { setDeleteId(id); setDeleteMode(null); setOpenId(null); }} onDeleteFull={deleteFull} onDragStart={(id: string, e: React.DragEvent) => { setDragId(id); try { e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', id); const row = (e.currentTarget as HTMLElement).closest('.spec-row'); if (row) e.dataTransfer!.setDragImage(row, 18, 18); } catch { } }} onDragOver={(id: string, e: React.DragEvent) => { e.preventDefault(); const d = dragId ? items.find(x => x.id === dragId) : null; if (d && d.type !== (items.find(x => x.id === id)?.type || '')) return; setDragOverId(id); }} onDrop={(e: React.DragEvent) => { e.preventDefault(); reorderItems(dragId!, dragOverId!); }} onDragEnd={() => { setDragId(null); setDragOverId(null); }} onAddPlaceholder={addPlaceholder} shareItem={shareItem} />
          ))}
        </div>
      </div>

      <BottomBar totalCount={totalCount} totalSum={totalSum} selectionActive={selectionActive} selCount={selItems.length} selSumStr={fmt(selItems.reduce((s, it) => s + it.qty * it.price, 0))} allVisibleSelected={allVisibleSelected} visIds={visIds} selected={selected} bulkMenuOpen={bulkMenuOpen} setBulkMenuOpen={setBulkMenuOpen} onClearSel={() => setSelected({})} onSelectAllVisible={() => { if (allVisibleSelected) { setSelected({}); } else { const s = { ...selected }; visIds.forEach(id => s[id] = true); setSelected(s); } }} onBulkDelete={bulkDelete} bulkStatus={bulkStatus} />

      {cur && <DetailModal item={cur} accent={accent} detailTab={detailTab} setDetailTab={setDetailTab} fileTab={fileTab} setFileTab={setFileTab} onClose={() => setOpenId(null)} onMinus={() => incQty(cur.id, -1)} onPlus={() => incQty(cur.id, 1)} onPrice={(v: string) => setPrice(cur.id, v)} onUnit={(v: string) => setUnit(cur.id, v)} onRemove={() => { setDeleteId(cur.id); setDeleteMode(null); setOpenId(null); }} setStatus={(s: string) => setStatus(cur.id, s)} onAvail={(v: string) => updateItem(cur.id, () => ({ avail: v }))} onLead={(v: string) => updateItem(cur.id, () => ({ leadTime: v }))} onMgrName={(v: string) => setItems(prev => prev.map(it => it.id === cur.id ? { ...it, manager: { ...(it.manager || {}), name: v } } : it))} onMgrPhone={(v: string) => setItems(prev => prev.map(it => it.id === cur.id ? { ...it, manager: { ...(it.manager || {}), phone: v } } : it))} onMgrEmail={(v: string) => setItems(prev => prev.map(it => it.id === cur.id ? { ...it, manager: { ...(it.manager || {}), email: v } } : it))} onNotes={(v: string) => updateItem(cur.id, () => ({ notes: v }))} onAddRoom={(name: string) => { name = name.trim(); if (!name) return; setItems(prev => prev.map(it => { if (it.id !== cur.id) return it; const r = it.rooms || []; if (r.indexOf(name) >= 0) return it; return { ...it, rooms: r.concat(name) }; })); }} onRemoveRoom={(name: string) => { setItems(prev => prev.map(it => { if (it.id !== cur.id) return it; return { ...it, rooms: (it.rooms || []).filter(x => x !== name) }; })); }} onAddVariant={() => { const variant: Variant = { name: (cur.name || 'Вариант') + ' · альтернатива', lead: (cur.leadTime ? 'срок ' + cur.leadTime : 'срок уточняется'), price: cur.price || 0, selected: false }; updateItem(cur.id, it => ({ variants: [...(it.variants || []), variant] })); showToast('Вариант добавлен — отредактируйте детали'); }} onAddFiles={(cat: string, fileList: FileList | null) => addFiles(cur.id, cat, fileList)} onRemoveFile={(cat: string, fid: string) => removeFile(cur.id, cat, fid)} onSetTextureMap={(fid: string, map: string) => setTextureMap(cur.id, fid, map)} onShare={() => shareItem(cur)} saveStatus={saveStatus} />}

      {addOpen && <AddModal editId={editId} addMode={addMode} setAddMode={setAddMode} draft={draft} setDraft={setDraft} onClose={() => { setAddOpen(false); setEditId(null); }} onSubmit={submitAdd} catQueryInput={catQueryInput} setCatQueryInput={setCatQueryInput} setCatQuery={setCatQuery} catDebounce={catDebounce} catType={catType} setCatType={setCatType} catSort={catSort} setCatSort={setCatSort} catSortDir={catSortDir} setCatSortDir={setCatSortDir} catHideInSpec={catHideInSpec} setCatHideInSpec={setCatHideInSpec} catSelected={catSelected} toggleCat={toggleCat} catSorted={catSorted} catInSpec={catInSpec} catInSpecCount={catInSpecCount} catSelCount={catSelCount} catSelSumStr={fmt(catSelSum)} addFromCatalog={addFromCatalog} fillItem={fillItem} catTypesPresent={catTypesPresent} catSelectedList={catSelectedList} setCatSelected={setCatSelected} prefixOf={prefixOf} />}

      {deleteId && (() => {
        const del = items.find(it => it.id === deleteId);
        if (!del) return null;
        return <DeleteModal item={del} items={items} deleteMode={deleteMode} setDeleteMode={setDeleteMode} onClose={() => { setDeleteId(null); setDeleteMode(null); }} onDeleteFull={() => deleteFull(deleteId)} onReplaceWithMark={(targetId: string) => replaceWithMark(deleteId, targetId)} onCreateReplace={() => createAndReplace(deleteId)} onClear={() => clearContent(deleteId)} prefixOf={prefixOf} />;
      })()}

      {procureOpen && <ProcureModal stAwait={stAwait} stOrder={stOrder} stDeliv={stDeliv} stReplace={stReplace} procScopeSum={procScopeSum} procScopeCount={procScopeCount} pickPhase={pickPhase} pickSum={pickSum} onClose={() => setProcureOpen(false)} onOpen={(id: string) => { setProcureOpen(false); setOpenId(id); setDetailTab('overview'); }} onShowReplace={() => { setProcureOpen(false); setStatusFilter('Заменить'); setActiveType('Все типы'); setQuery(''); setQueryInput(''); }} />}

      {summaryOpen && <SummaryModal items={items} onClose={() => setSummaryOpen(false)} onPrint={() => window.print()} onExportCsv={exportCSV} />}

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 108, transform: 'translateX(-50%)', zIndex: 80, display: 'flex', alignItems: 'center', gap: 16, background: '#1b1a17', color: '#f3efe7', padding: '13px 16px 13px 22px', borderRadius: 12, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 500, boxShadow: '0 14px 40px rgba(27,26,23,.32)' }}>
          <span>{toast.msg}</span>
          {toast.actionLabel && toast.action && <span onClick={() => { toast.action!(); setToast(null); }} style={{ flex: 'none', cursor: 'pointer', fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(243,239,231,.32)', color: '#f3efe7' }}>{toast.actionLabel}</span>}
        </div>
      )}
    </div>
  );
}

function HeaderSection({ saveStatus, mobMenuOpen, setMobMenuOpen, setProcureOpen, setSummaryOpen, setAddOpen }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', paddingTop: 'clamp(28px,5vw,48px)' }}>
      <div style={{ width: '100%' }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>Седьмой тестовый проект</span><span style={{ opacity: 0.5 }}>/</span><span style={{ color: '#1b1a17' }}>Спецификации</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <h1 style={{ fontSize: 'clamp(34px,6vw,54px)', fontWeight: 700, letterSpacing: '-.02em', margin: '12px 0 0 0', lineHeight: 0.98 }}>Спецификации</h1>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', width: '100%', justifyContent: 'flex-end' }}>
        <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, letterSpacing: '.02em', color: '#6a665a', whiteSpace: 'nowrap' }}>
          {saveStatus === 'saving' && <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: '#b07d1e' }}></span>}
          {saveStatus === 'saved' && <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: '#5f7a3f' }}></span>}
          <span>{saveStatus === 'saving' ? 'Сохранение…' : 'Сохранено'}</span>
        </div>
        <button onClick={() => setProcureOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#faf8f3', color: '#1b1a17', border: '1px solid #d9d3c6', borderRadius: 13, padding: '14px 20px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 16 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#5f7a3f' }}></span><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3f6b80' }}></span></span>&nbsp;Закупка
        </button>
        <button onClick={() => setSummaryOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#faf8f3', color: '#1b1a17', border: '1px solid #d9d3c6', borderRadius: 13, padding: '14px 20px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2.5, width: 13, fontSize: 16 }}><span style={{ height: 1.7, background: 'currentColor', borderRadius: 2 }}></span><span style={{ height: 1.7, width: 9, background: 'currentColor', borderRadius: 2 }}></span><span style={{ height: 1.7, background: 'currentColor', borderRadius: 2 }}></span></span>Экспорт
        </button>
        <button onClick={setAddOpen} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1b1a17', color: '#f3efe7', border: 'none', borderRadius: 13, padding: '15px 22px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          <span style={{ fontSize: 18, lineHeight: 1, marginTop: -2 }}>+</span> Добавить материал
        </button>
      </div>
    </div>
  );
}

function SearchSortSection({ queryInput, setQueryInput, setQuery, sortLabel, onSort, debounceTimer }: any) {
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 'clamp(22px,4vw,34px)', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240, display: 'flex', alignItems: 'center', gap: 13, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 14, padding: '0 18px', height: 54 }}>
        <div style={{ width: 15, height: 15, border: '1.6px solid #b3aea2', borderRadius: '50%', position: 'relative', flex: 'none' }}><div style={{ position: 'absolute', width: 6, height: 1.6, background: '#b3aea2', right: -4, bottom: 0, transform: 'rotate(45deg)', transformOrigin: 'left' }}></div></div>
        <input value={queryInput} onChange={(e) => { const v = e.target.value; setQueryInput(v); clearTimeout(debounceTimer.current); debounceTimer.current = setTimeout(() => setQuery(v), 240); }} aria-label="Поиск по материалам" placeholder="Поиск по материалам, артикулам, брендам…" style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 15.5, color: '#1b1a17', minWidth: 0, outline: 'none' }} />
        {queryInput.trim().length > 0 && <button onClick={() => { clearTimeout(debounceTimer.current); setQueryInput(''); setQuery(''); }} type="button" aria-label="Очистить поиск" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, border: 'none', background: '#ece6da', color: '#46423a', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>}
      </div>
      <button onClick={onSort} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 14, padding: '0 20px', height: 54, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, letterSpacing: '.04em', color: '#1b1a17', cursor: 'pointer', whiteSpace: 'nowrap' }}>{sortLabel} <span style={{ color: '#9a958a' }}>↕</span></button>
    </div>
  );
}

function TypeChipsSection({ activeType, setActiveType }: any) {
  return (
    <div style={{ display: 'flex', gap: 9, marginTop: 18, overflowX: 'auto', paddingBottom: 4 }}>
      {['Все типы', ...TYPE_ORDER].map(label => {
        const on = label === activeType;
        return <button key={label} onClick={() => setActiveType(label)} style={{ flex: 'none', padding: '11px 18px', borderRadius: 11, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', background: on ? '#1b1a17' : '#faf8f3', color: on ? '#f3efe7' : '#4a463d', border: on ? '1px solid #1b1a17' : '1px solid #e6e1d5' }}>{label}</button>;
      })}
    </div>
  );
}

function GroupSection({ group, collapsed, setCollapsed, showTable, showCards, selected, accent, dragId, dragOverId, statusMenuId, setStatusMenuId, setStatus, onOpen, onOpenFill, onToggleSel, onRemove, onDeleteFull, onDragStart, onDragOver, onDrop, onDragEnd, onAddPlaceholder, shareItem }: any) {
  return (
    <div style={{ marginTop: 30 }}>
      <div onClick={() => setCollapsed({ ...collapsed, [group.type]: !collapsed[group.type] })} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 14px 4px', borderBottom: '1px solid #1b1a17', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ color: '#9a958a', fontSize: 11, display: 'inline-block', transition: 'transform .2s', transform: group.caret }}>▾</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>{group.type}</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#9a958a', border: '1px solid #d9d3c6', borderRadius: 20, padding: '2px 9px' }}>{group.count}</span>
        </div>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5, fontWeight: 600, letterSpacing: '.02em' }}>{group.sumStr} ₽</span>
      </div>

      {showTable && group.open && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '38px 46px 58px minmax(150px,1.5fr) 1.1fr 90px 104px 122px 140px 86px', gap: 14, padding: '11px 4px 9px 4px', fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#a8a296' }}>
            <span></span><span></span><span>Код</span><span>Наименование</span><span>Спецификация</span><span style={{ textAlign: 'right' }}>Кол-во</span><span style={{ textAlign: 'right' }}>Цена/шт</span><span style={{ textAlign: 'right' }}>Итого</span><span>Статус</span><span></span>
          </div>
          {group.items.map((it: SpecItem) => (
            <SpecRow key={it.id} it={it} selected={!!selected[it.id]} accent={accent} dragId={dragId} dragOverId={dragOverId} statusMenuId={statusMenuId} setStatusMenuId={setStatusMenuId} setStatus={setStatus} onOpen={() => onOpen(it.id)} onOpenFill={() => onOpenFill(it)} onToggleSel={() => onToggleSel(it.id)} onRemove={() => onRemove(it.id)} onDeleteFull={() => onDeleteFull(it.id)} onDragStart={(e: React.DragEvent) => onDragStart(it.id, e)} onDragOver={(e: React.DragEvent) => onDragOver(it.id, e)} onDrop={(e: React.DragEvent) => onDrop(e)} onDragEnd={onDragEnd} shareItem={() => shareItem(it)} />
          ))}
          <div onClick={() => onAddPlaceholder(group.type)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 4px', borderTop: '1px dashed #cfc9bb', color: '#9a958a', cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600 }}>
            <span style={{ width: 24, height: 24, borderRadius: 7, border: '1.5px dashed #cdc6b6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1 }}>+</span> Добавить позицию
          </div>
        </>
      )}

      {showCards && group.open && group.items.map((it: SpecItem) => (
        it.placeholder ? (
          <div key={it.id} onClick={() => onOpenFill(it)} style={{ background: 'transparent', border: '1.5px dashed #cfc9bb', borderRadius: 16, padding: 15, marginTop: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 13 }}>
            <div style={{ width: 50, height: 50, borderRadius: 9, border: '1.5px dashed #cdc6b6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b3aea2', fontSize: 24, lineHeight: 1, flex: 'none' }}>+</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 16, fontWeight: 500, fontStyle: 'italic', color: '#6a665a' }}>Материал не выбран</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#6a665a', marginTop: 3 }}>{it.code} · нажмите, чтобы заполнить</div></div>
            <span onClick={(e) => { e.stopPropagation(); onDeleteFull(it.id); }} style={{ fontFamily: "'JetBrains Mono',monospace", color: '#c2bdb1', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</span>
          </div>
        ) : (
          <div key={it.id} style={{ background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 16, padding: 14, marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div onClick={() => onOpen(it.id)} style={{ width: 54, height: 54, borderRadius: 9, border: '1px solid #e2ddd1', background: 'repeating-linear-gradient(135deg,#e9e4d9,#e9e4d9 5px,#f0ebe1 5px,#f0ebe1 10px)', flex: 'none', cursor: 'pointer' }}></div>
              <div onClick={() => onOpen(it.id)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#9a958a', marginTop: 3, letterSpacing: '.04em' }}>{it.code} · {it.brand}</div>
                <div style={{ fontSize: 14, color: '#46423a', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.spec}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                <a href={brandSite(it.brand)} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, color: '#9a958a', textDecoration: 'none', fontSize: 16 }}>↗</a>
                <span onClick={() => shareItem(it)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, color: '#9a958a', cursor: 'pointer' }}>🔗</span>
                <span onClick={() => onRemove(it.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, color: '#b3aea2', cursor: 'pointer', fontSize: 16 }}>✕</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 11, borderTop: '1px solid #ece6da' }}>
              <div style={{ position: 'relative' }}>
                <StatusBadge status={it.status} accent={accent} menuOpen={statusMenuId === it.id} onToggleMenu={(e: React.MouseEvent) => { e.stopPropagation(); setStatusMenuId(statusMenuId === it.id ? null : it.id); }} onPick={(s: string) => { setStatus(it.id, s); }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#9a958a' }}>{it.qty} {it.unit} × {fmt(it.price)}</span>
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>{fmt(it.qty * it.price)} ₽</span>
              </div>
            </div>
          </div>
        )
      ))}
      {showCards && group.open && (
        <div onClick={() => onAddPlaceholder(group.type)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 15, marginTop: 10, border: '1.5px dashed #cfc9bb', borderRadius: 16, color: '#9a958a', cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, border: '1.5px dashed #cdc6b6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, lineHeight: 1 }}>+</span> Добавить позицию
        </div>
      )}
    </div>
  );
}

function SpecRow({ it, selected, accent, dragId, dragOverId, statusMenuId, setStatusMenuId, setStatus, onOpen, onOpenFill, onToggleSel, onRemove, onDeleteFull, onDragStart, onDragOver, onDrop, onDragEnd, shareItem }: any) {
  if (it.placeholder) {
    return (
      <div className="spec-row" onClick={onOpenFill} onDragOver={onDragOver} onDrop={onDrop} style={{ display: 'grid', gridTemplateColumns: '38px 46px 58px minmax(150px,1.5fr) 1.1fr 90px 104px 122px 140px 86px', gap: 14, alignItems: 'center', padding: '14px 4px', borderTop: '1px dashed #cfc9bb', cursor: 'pointer', background: 'transparent', opacity: dragId === it.id ? 0.4 : 1, boxShadow: dragOverId === it.id ? `inset 0 2px 0 0 ${accent}` : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className="drag-dots" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} style={{ display: 'grid', gridTemplateColumns: 'repeat(2,2.5px)', gridAutoRows: '2.5px', gap: 2.5, cursor: 'grab' }}>
            {[1, 2, 3, 4, 5, 6].map(i => <span key={i} style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: '#cdc6b6' }}></span>)}
          </span>
          <span onClick={(e) => { e.stopPropagation(); onToggleSel(); }} style={{ width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${selected ? accent : '#c2bdb1'}`, background: selected ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#f3efe7', fontSize: 11, lineHeight: 1, flex: 'none' }}>{selected ? '✓' : ''}</span>
        </div>
        <div style={{ width: 42, height: 42, borderRadius: 9, border: '1.5px dashed #cdc6b6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b3aea2', fontSize: 20, lineHeight: 1 }}>+</div>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, fontWeight: 500, color: '#a8a296' }}>{it.code}</span>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 15.5, fontWeight: 500, fontStyle: 'italic', color: '#6a665a' }}>Материал не выбран</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: '#6a665a', marginTop: 2, letterSpacing: '.02em' }}>Нажмите, чтобы заполнить</div></div>
        <span style={{ color: '#cdc6b6' }}>—</span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5, textAlign: 'right', color: '#a8a296' }}>{it.qty} <span style={{ color: '#cdc6b6' }}>{it.unit}</span></span>
        <span style={{ textAlign: 'right', color: '#cdc6b6', fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5 }}>—</span>
        <span style={{ textAlign: 'right', color: '#cdc6b6', fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700 }}>—</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#a8a296' }}><span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: 'transparent', border: '1px dashed #bcb7ab' }}></span>Черновик</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 11 }}>
          <span onClick={(e) => { e.stopPropagation(); onDeleteFull(); }} style={{ fontFamily: "'JetBrains Mono',monospace", color: '#c2bdb1', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>✕</span>
        </div>
      </div>
    );
  }
  return (
    <div className="spec-row" onDragOver={onDragOver} onDrop={onDrop} style={{ display: 'grid', gridTemplateColumns: '38px 46px 58px minmax(150px,1.5fr) 1.1fr 90px 104px 122px 140px 86px', gap: 14, alignItems: 'center', padding: '14px 4px', borderTop: '1px solid #e2ddd1', background: selected ? '#efe9dc' : 'transparent', opacity: dragId === it.id ? 0.4 : 1, boxShadow: dragOverId === it.id ? `inset 0 2px 0 0 ${accent}` : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span className="drag-dots" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} style={{ display: 'grid', gridTemplateColumns: 'repeat(2,2.5px)', gridAutoRows: '2.5px', gap: 2.5, cursor: 'grab' }}>
          {[1, 2, 3, 4, 5, 6].map(i => <span key={i} style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: '#b3aea2' }}></span>)}
        </span>
        <span onClick={(e) => { e.stopPropagation(); onToggleSel(); }} style={{ width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${selected ? accent : '#c2bdb1'}`, background: selected ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#f3efe7', fontSize: 11, lineHeight: 1, flex: 'none' }}>{selected ? '✓' : ''}</span>
      </div>
      <div onClick={onOpen} style={{ width: 42, height: 42, borderRadius: 9, border: '1px solid #e2ddd1', background: 'repeating-linear-gradient(135deg,#e9e4d9,#e9e4d9 5px,#f0ebe1 5px,#f0ebe1 10px)', cursor: 'pointer' }}></div>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, fontWeight: 500 }}>{it.code}</span>
      <div onClick={onOpen} style={{ minWidth: 0, cursor: 'pointer' }}>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#9a958a', marginTop: 2 }}>{it.brand}</div>
      </div>
      <span style={{ fontSize: 14.5, color: '#46423a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.spec}</span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5, textAlign: 'right' }}>{it.qty} <span style={{ color: '#a8a296' }}>{it.unit}</span></span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13.5, textAlign: 'right', color: '#46423a' }}>{fmt(it.price)}</span>
      <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, textAlign: 'right', letterSpacing: '-.01em' }}>{fmt(it.qty * it.price)} ₽</span>
      <div style={{ position: 'relative' }}>
        <StatusBadge status={it.status} accent={accent} menuOpen={statusMenuId === it.id} onToggleMenu={(e: React.MouseEvent) => { e.stopPropagation(); setStatusMenuId(statusMenuId === it.id ? null : it.id); }} onPick={(s: string) => { setStatus(it.id, s); }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 11 }}>
        <a href={brandSite(it.brand)} target="_blank" rel="noopener noreferrer" title="Сайт производителя" style={{ color: '#b3aea2', textDecoration: 'none', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>↗</a>
        <span onClick={shareItem} title="Поделиться" style={{ color: '#b3aea2', cursor: 'pointer', fontSize: 14 }}>🔗</span>
        <span onClick={onRemove} style={{ fontFamily: "'JetBrains Mono',monospace", color: '#c2bdb1', cursor: 'pointer', fontSize: 15, lineHeight: 1 }} title="Удалить">✕</span>
      </div>
    </div>
  );
}

function StatusBadge({ status, accent, menuOpen, onToggleMenu, onPick }: any) {
  const m = statusMeta(status, accent);
  return (
    <>
      <span onClick={onToggleMenu} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 8px 5px 11px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', background: m.bg, color: m.fg, border: `1px solid ${m.bd}` }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', flex: 'none', background: 'currentColor', opacity: 0.8 }}></span>{status}<span style={{ fontSize: 9, opacity: 0.6, marginLeft: 1 }}>▾</span>
      </span>
      {menuOpen && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40, minWidth: 182, background: '#faf8f3', border: '1px solid #d9d3c6', borderRadius: 13, padding: 6, boxShadow: '0 16px 40px rgba(27,26,23,.18)' }}>
          {STATUS_FLOW.map(s => {
            const sm2 = statusMeta(s, accent);
            return <div key={s} onClick={() => onPick(s)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: '#1b1a17' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: sm2.dot }}></span><span style={{ flex: 1 }}>{s}</span><span style={{ color: '#1b1a17', fontSize: 12, width: 12, textAlign: 'right' }}>{s === status ? '✓' : ''}</span>
            </div>;
          })}
        </div>
      )}
    </>
  );
}

function BottomBar({ totalCount, totalSum, selectionActive, selCount, selSumStr, allVisibleSelected, visIds, selected, bulkMenuOpen, setBulkMenuOpen, onClearSel, onSelectAllVisible, onBulkDelete, bulkStatus }: any) {
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, display: 'flex', justifyContent: 'center', padding: '0 clamp(16px,4vw,48px) clamp(16px,3vw,28px)', pointerEvents: 'none' }}>
      <div style={{ width: '100%', maxWidth: 1180, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: '#1b1a17', color: '#f3efe7', borderRadius: 16, padding: '18px clamp(18px,3vw,30px)', boxShadow: '0 18px 50px rgba(27,26,23,.28)', pointerEvents: 'auto' }}>
        {!selectionActive ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8d887d' }}>Позиций</span>
              <span style={{ fontSize: 'clamp(20px,4vw,26px)', fontWeight: 700 }}>{totalCount}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8d887d' }}>Сумма</span>
              <span style={{ fontSize: 'clamp(22px,5vw,30px)', fontWeight: 700, letterSpacing: '-.01em' }}>{totalSum} ₽</span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, width: '100%', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 11 }}>
              <span style={{ fontSize: 'clamp(19px,3.5vw,24px)', fontWeight: 700 }}>{selCount}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8d887d' }}>выбрано · {selSumStr} ₽</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span onClick={onSelectAllVisible} style={{ background: 'transparent', border: '1px solid rgba(243,239,231,.28)', color: '#f3efe7', borderRadius: 9, padding: '8px 13px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{allVisibleSelected ? 'Снять все' : 'Выбрать все'}</span>
              <div style={{ position: 'relative' }}>
                <span onClick={() => setBulkMenuOpen(!bulkMenuOpen)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px solid rgba(243,239,231,.28)', color: '#f3efe7', borderRadius: 9, padding: '8px 13px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Статус <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span></span>
                {bulkMenuOpen && (
                  <div style={{ position: 'absolute', bottom: 'calc(100% + 9px)', left: 0, zIndex: 60, minWidth: 192, background: '#faf8f3', border: '1px solid #d9d3c6', borderRadius: 13, padding: 6, boxShadow: '0 18px 44px rgba(27,26,23,.3)' }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a', padding: '6px 10px 5px' }}>Назначить статус</div>
                    {STATUS_FLOW.map(s => <div key={s} onClick={() => { bulkStatus(s); setBulkMenuOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 9, cursor: 'pointer', color: '#1b1a17', fontSize: 13.5, fontWeight: 500 }}><span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: statusMeta(s, '#1b1a17').dot }}></span>{s}</div>)}
                  </div>
                )}
              </div>
              <span onClick={onBulkDelete} style={{ background: 'transparent', border: '1px solid rgba(231,160,150,.5)', color: '#f0b3a8', borderRadius: 9, padding: '8px 13px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Удалить {selCount}</span>
              <span onClick={onClearSel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(243,239,231,.28)', color: '#f3efe7', cursor: 'pointer', fontSize: 15 }}>✕</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailModal({ item, accent, detailTab, setDetailTab, fileTab, setFileTab, onClose, onMinus, onPlus, onPrice, onUnit, onRemove, setStatus, onAvail, onLead, onMgrName, onMgrPhone, onMgrEmail, onNotes, onAddRoom, onRemoveRoom, onAddVariant, onAddFiles, onRemoveFile, onSetTextureMap, onShare, saveStatus }: any) {
  const allFiles = item.files || {};
  const totalCount = FILE_CATS.reduce((n: number, c: any) => n + (allFiles[c.key] || []).length, 0);
  const activeCat = fileTab;
  const cfg = FILE_CATS.find((c: any) => c.key === activeCat) || FILE_CATS[0];
  const curList = allFiles[activeCat] || [];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(27,26,23,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'clamp(12px,4vh,48px) 16px', zIndex: 60, overflowY: 'auto' }}>
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" data-modal="detail" tabIndex={-1} style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: '#f3efe7', borderRadius: 22, overflow: 'hidden', boxShadow: '0 30px 80px rgba(27,26,23,.3)', outline: 'none' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 13, padding: '16px 20px 15px 24px', borderBottom: '1px solid #e2ddd1', background: '#f3efe7' }}>
          <span style={{ flex: 'none', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, background: '#1b1a17', color: '#f3efe7', padding: '6px 11px', borderRadius: 7 }}>{item.code}</span>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name || ('Марка ' + item.code)}</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a', marginTop: 1 }}>{item.type}</div></div>
          <button onClick={onClose} type="button" aria-label="Закрыть" style={{ flex: 'none', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#1b1a17', lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 'none', display: 'flex', gap: 2, padding: '0 16px', borderBottom: '1px solid #e2ddd1', background: '#f3efe7', overflowX: 'auto' }}>
          {[
            { key: 'overview', label: 'Обзор', badge: '' },
            { key: 'files', label: 'Файлы', badge: totalCount ? String(totalCount) : '' },
            { key: 'supply', label: 'Поставка и помещения', badge: '' },
            { key: 'notes', label: 'Заметки', badge: (item.notes && item.notes.trim()) ? '•' : '' },
          ].map((t: any) => {
            const on = t.key === detailTab;
            return <button key={t.key} onClick={() => setDetailTab(t.key)} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: 'none', padding: '14px 11px 12px', marginBottom: -1, fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, color: on ? '#1b1a17' : '#9a958a', cursor: 'pointer', borderBottom: `2px solid ${on ? '#1b1a17' : 'transparent'}`, whiteSpace: 'nowrap' }}>
              {t.label}{t.badge && <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, minWidth: 17, height: 17, padding: '0 5px', borderRadius: 20, background: on ? '#1b1a17' : '#ece6da', color: on ? '#f3efe7' : '#9a958a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{t.badge}</span>}
            </button>;
          })}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 24px' }}>
          {detailTab === 'overview' && (
            <>
              <div style={{ width: '100%', height: 200, borderRadius: 16, border: '1px solid #e2ddd1', background: 'repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6 8px,#efe9df 8px,#efe9df 16px)', display: 'flex', alignItems: 'flex-end', padding: 16, marginBottom: 18 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#a8a296' }}>фото · 1200×1200</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {STATUS_FLOW.map((s: string) => {
                  const on = s === item.status;
                  const m = statusMeta(s, accent);
                  return <span key={s} onClick={() => setStatus(s)} style={{ flex: '1 1 28%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, textAlign: 'center', padding: '11px 6px', borderRadius: 11, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: on ? m.bg : '#faf8f3', color: on ? m.fg : '#9a958a', border: `1px solid ${on ? m.bd : '#e6e1d5'}` }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', flex: 'none', background: m.dot, opacity: on ? 1 : 0 }}></span>{s}
                  </span>;
                })}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'stretch' }}>
                <div style={{ flex: 1, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 12, padding: '13px 14px' }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Кол-во</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 7 }}>
                    <span onClick={onMinus} style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #d9d3c6', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, userSelect: 'none' }}>−</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 600 }}>{item.qty}</span>
                    <span onClick={onPlus} style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #d9d3c6', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, userSelect: 'none' }}>+</span>
                    <select value={item.unit} onChange={(e) => onUnit(e.target.value)} style={{ marginLeft: 'auto', height: 30, padding: '0 8px', border: '1px solid #d9d3c6', borderRadius: 7, background: '#fff', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#46423a', cursor: 'pointer' }}>
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ flex: 1, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 12, padding: '13px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Цена / шт, ₽</span><span style={{ fontSize: 11, color: '#b3aea2', lineHeight: 1 }}>✎</span></div>
                  <input value={item.price} onChange={(e) => onPrice(e.target.value)} aria-label="Цена за единицу" style={{ width: '100%', border: 'none', borderBottom: '1.5px dashed #c9c2b3', background: 'transparent', fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 600, marginTop: 7, paddingBottom: 3, color: '#1b1a17', outline: 'none' }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1b1a17', color: '#f3efe7', borderRadius: 12, padding: '16px 18px', marginTop: 12 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8d887d' }}>Итого</span>
                <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.01em' }}>{fmt(item.qty * item.price)} ₽</span>
              </div>
              <div style={{ marginTop: 14, borderTop: '1px solid #e2ddd1' }}>
                {[['Артикул', item.article], ['Формат', item.format], ['Поверхность', item.surface], ['Цвет', item.color]].map(([label, val]) => (
                  <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #e2ddd1' }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9a958a' }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{val || '—'}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 9, marginTop: 18, flexWrap: 'wrap' }}>
                <a href={brandSite(item.brand)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'transparent', border: '1px solid #d9d3c6', color: '#46423a', borderRadius: 11, padding: '12px 14px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Сайт <span style={{ fontSize: 13 }}>↗</span></a>
                <button onClick={onShare} style={{ flex: 1, minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'transparent', border: '1px solid #d9d3c6', color: '#46423a', borderRadius: 11, padding: '12px 14px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>🔗 Поделиться</button>
              </div>
            </>
          )}

          {detailTab === 'files' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Файлы и текстуры</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#9a958a' }}>{totalCount ? totalCount + ' ' + plural(totalCount, 'файл', 'файла', 'файлов') : 'нет файлов'}</span>
              </div>
              <div style={{ display: 'flex', gap: 7, marginTop: 13, overflowX: 'auto', paddingBottom: 2 }}>
                {FILE_CATS.map((c: any) => {
                  const on = c.key === activeCat;
                  const cnt = (allFiles[c.key] || []).length;
                  return <button key={c.key} onClick={() => setFileTab(c.key)} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 13px', borderRadius: 10, fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', background: on ? '#1b1a17' : '#faf8f3', color: on ? '#f3efe7' : '#4a463d', border: on ? '1px solid #1b1a17' : '1px solid #e6e1d5' }}>
                    {c.label}<span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, padding: '1px 6px', borderRadius: 20, background: on ? 'rgba(243,239,231,.18)' : '#ece6da', color: on ? '#f3efe7' : '#9a958a' }}>{cnt}</span>
                  </button>;
                })}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 12, border: '1.5px dashed #d2ccbe', borderRadius: 13, padding: '15px 17px', cursor: 'pointer', background: '#faf8f3' }}>
                <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 9, background: '#ece6da', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, color: '#46423a', lineHeight: 1 }}>↑</span>
                <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{cfg.upTitle}</span><span style={{ display: 'block', fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: '#9a958a', marginTop: 2 }}>{cfg.upHint}</span></span>
                <input type="file" multiple accept={cfg.accept} onChange={(e) => { onAddFiles(activeCat, e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
              </label>
              {cfg.kind === 'tex' && curList.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginTop: 12 }}>
                  {curList.map((t: any) => (
                    <div key={t.id} style={{ border: '1px solid #e2ddd1', borderRadius: 13, overflow: 'hidden', background: '#faf8f3' }}>
                      <div style={{ position: 'relative', height: 108, backgroundImage: t.url ? `url(${t.url})` : 'repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6 8px,#efe9df 8px,#efe9df 16px)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#e7e1d6' }}>
                        <span style={{ position: 'absolute', top: 8, left: 8, fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase', background: 'rgba(27,26,23,.78)', color: '#f3efe7', padding: '3px 7px', borderRadius: 6 }}>{(t.map || 'Diffuse / Albedo').split(' ')[0]}</span>
                        <span onClick={() => onRemoveFile(activeCat, t.id)} style={{ position: 'absolute', top: 7, right: 7, width: 23, height: 23, borderRadius: 7, background: 'rgba(27,26,23,.78)', color: '#f3efe7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>✕</span>
                      </div>
                      <div style={{ padding: '9px 10px' }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                        <select value={t.map || 'Diffuse / Albedo'} onChange={(e) => onSetTextureMap(t.id, e.target.value)} style={{ width: '100%', marginTop: 7, height: 30, padding: '0 7px', border: '1px solid #e0dacd', borderRadius: 7, background: '#fff', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#46423a', cursor: 'pointer' }}>
                          {MAP_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: '#9a958a', marginTop: 6 }}>{t.ext} · {humanSize(t.size)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {cfg.kind === 'doc' && curList.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {curList.map((d: any) => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e2ddd1', borderRadius: 12, padding: '11px 13px', background: '#faf8f3' }}>
                      <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 9, background: d.ext === 'PDF' ? '#f1ddd6' : '#e7eef3', color: d.ext === 'PDF' ? '#a23b2e' : '#365a6b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 600 }}>{d.ext}</span>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#9a958a', marginTop: 2 }}>{d.ext} · {humanSize(d.size)}</div></div>
                      <span onClick={() => onRemoveFile(activeCat, d.id)} style={{ flex: 'none', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b3aea2', cursor: 'pointer', fontSize: 14 }}>✕</span>
                    </div>
                  ))}
                </div>
              )}
              {curList.length === 0 && <div style={{ textAlign: 'center', padding: '22px 12px 6px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#a8a296' }}>{cfg.empty}</div>}
            </>
          )}

          {detailTab === 'supply' && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                <div style={{ flex: 1, minWidth: 0, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 12, padding: '13px 14px' }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Наличие</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 9 }}>
                    <span style={{ flex: 'none', width: 9, height: 9, borderRadius: '50%', background: availMeta(item.avail || 'Уточняется') }}></span>
                    <select value={item.avail || 'Уточняется'} onChange={(e) => onAvail(e.target.value)} style={{ flex: 1, minWidth: 0, height: 32, padding: '0 8px', border: '1px solid #d9d3c6', borderRadius: 7, background: '#fff', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, color: '#1b1a17', cursor: 'pointer' }}>
                      {['В наличии', 'Под заказ', 'Нет в наличии', 'Уточняется'].map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 12, padding: '13px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Срок поставки</span><span style={{ fontSize: 11, color: '#b3aea2', lineHeight: 1 }}>✎</span></div>
                  <input value={item.leadTime || ''} onChange={(e) => onLead(e.target.value)} placeholder="напр. 4–6 недель" style={{ width: '100%', border: 'none', borderBottom: '1.5px dashed #c9c2b3', background: 'transparent', fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, marginTop: 9, paddingBottom: 3, color: '#1b1a17', outline: 'none' }} />
                </div>
              </div>
              <div style={{ marginTop: 18, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 14, padding: '15px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Менеджер поставщика</span><span style={{ fontSize: 11, color: '#b3aea2', lineHeight: 1 }}>✎</span></div>
                <input value={(item.manager && item.manager.name) || ''} onChange={(e) => onMgrName(e.target.value)} placeholder="Имя · компания" style={{ width: '100%', height: 42, marginTop: 9, padding: '0 13px', border: '1px solid #e0dacd', borderRadius: 9, background: '#fff', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, color: '#1b1a17', outline: 'none' }} />
                <div style={{ display: 'flex', gap: 9, marginTop: 9 }}>
                  <input value={(item.manager && item.manager.phone) || ''} onChange={(e) => onMgrPhone(e.target.value)} placeholder="Телефон" style={{ flex: 1, minWidth: 0, height: 42, padding: '0 13px', border: '1px solid #e0dacd', borderRadius: 9, background: '#fff', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: '#1b1a17', outline: 'none' }} />
                  <input value={(item.manager && item.manager.email) || ''} onChange={(e) => onMgrEmail(e.target.value)} placeholder="E-mail" style={{ flex: 1, minWidth: 0, height: 42, padding: '0 13px', border: '1px solid #e0dacd', borderRadius: 9, background: '#fff', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: '#1b1a17', outline: 'none' }} />
                </div>
                {(item.manager && (item.manager.phone || item.manager.email)) && (
                  <div style={{ display: 'flex', gap: 9, marginTop: 11 }}>
                    {item.manager.phone && <a href={`tel:${item.manager.phone.replace(/[^+\d]/g, '')}`} style={{ flex: 1, textAlign: 'center', background: '#1b1a17', color: '#f3efe7', borderRadius: 9, padding: 11, fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>Позвонить</a>}
                    {item.manager.email && <a href={`mailto:${item.manager.email}`} style={{ flex: 1, textAlign: 'center', background: 'transparent', border: '1px solid #d9d3c6', color: '#46423a', borderRadius: 9, padding: 11, fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>Написать</a>}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Помещения · {(item.rooms || []).length}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#9a958a' }}>опционально</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
                  {(item.rooms || []).map((r: string) => (
                    <span key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#ece6da', color: '#46423a', borderRadius: 9, padding: '8px 9px 8px 13px', fontSize: 13, fontWeight: 500 }}>
                      {r}<span onClick={() => onRemoveRoom(r)} style={{ cursor: 'pointer', color: '#9a958a', fontSize: 12, lineHeight: 1 }}>✕</span>
                    </span>
                  ))}
                  <input list="room-suggest" onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); onAddRoom((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} placeholder="+ помещение" style={{ border: '1px dashed #d2ccbe', background: 'transparent', borderRadius: 9, padding: '8px 13px', fontSize: 13, color: '#46423a', minWidth: 140, outline: 'none' }} />
                </div>
              </div>
              <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Варианты · {(item.variants || []).length}</span>
                <button onClick={onAddVariant} type="button" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid #d9d3c6', borderRadius: 9, padding: '7px 12px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, color: '#46423a', cursor: 'pointer' }}><span style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>+</span> Добавить</button>
              </div>
              {(item.variants || []).map((v: any, i: number) => (
                <div key={i} style={{ border: '1px solid #e2ddd1', borderRadius: 14, padding: 14, marginTop: 10, background: v.selected ? '#faf8f3' : 'transparent', borderColor: v.selected ? '#1b1a17' : '#e2ddd1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: v.selected ? accent : '#9a958a', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: v.selected ? accent : '#9a958a' }}></span>{v.selected ? 'Выбран' : 'Альтернатива'}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#9a958a' }}>Вариант {i + 1}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 11, marginTop: 11, alignItems: 'center' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 8, border: '1px solid #e2ddd1', background: 'repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6 5px,#efe9df 5px,#efe9df 10px)', flex: 'none' }}></div>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{v.name}</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#9a958a', marginTop: 2 }}>{v.lead}</div></div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}><div style={{ fontFamily: "'Space Grotesk'", fontSize: 16, fontWeight: 700 }}>{fmt(v.price)} ₽</div></div>
                  </div>
                </div>
              ))}
            </>
          )}

          {detailTab === 'notes' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>Заметки</span>
                <span style={{ fontSize: 11, color: '#b3aea2', lineHeight: 1 }}>✎</span>
              </div>
              <textarea value={item.notes || ''} onChange={(e) => onNotes(e.target.value)} placeholder="Комментарии для закупки, монтажа, замечания по объекту…" style={{ width: '100%', marginTop: 11, minHeight: 200, padding: '13px 14px', border: '1px solid #e6e1d5', borderRadius: 12, background: '#faf8f3', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, lineHeight: 1.5, color: '#1b1a17', resize: 'vertical', outline: 'none' }} />
            </>
          )}
        </div>

        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderTop: '1px solid #e2ddd1', background: '#f3efe7' }}>
          <div role="status" aria-live="polite" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.02em', color: '#6a665a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {saveStatus === 'saving' && <><span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: '#b07d1e' }}></span><span>Сохранение…</span></>}
            {saveStatus === 'saved' && <><span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: '#5f7a3f' }}></span><span>Сохранено</span></>}
          </div>
          <button onClick={onRemove} style={{ flex: 'none', background: 'transparent', border: '1px solid #e0c9c3', color: '#a23b2e', borderRadius: 12, padding: '13px 16px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Удалить</button>
          <button onClick={onClose} style={{ flex: 'none', minWidth: 130, background: '#1b1a17', color: '#f3efe7', border: 'none', borderRadius: 12, padding: '13px 22px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Готово</button>
        </div>
      </div>
    </div>
  );
}

function AddModal({ editId, addMode, setAddMode, draft, setDraft, onClose, onSubmit, catQueryInput, setCatQueryInput, setCatQuery, catDebounce, catType, setCatType, catSort, setCatSort, catSortDir, setCatSortDir, catHideInSpec, setCatHideInSpec, catSelected, toggleCat, catSorted, catInSpec, catInSpecCount, catSelCount, catSelSumStr, addFromCatalog, fillItem, catTypesPresent, catSelectedList, setCatSelected, prefixOf }: any) {
  const canSubmit = !!draft.name.trim() && (editId ? true : parseInt(String(draft.price).replace(/\D/g, '')) > 0);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(27,26,23,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'clamp(12px,6vh,80px) 16px', zIndex: 60, overflowY: 'auto' }}>
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" data-modal="add" tabIndex={-1} style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#f3efe7', borderRadius: 22, overflow: 'hidden', boxShadow: '0 30px 80px rgba(27,26,23,.3)', outline: 'none' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid #e2ddd1' }}>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.01em' }}>{editId ? 'Заполнить позицию' : 'Новый материал'}</span>
          <button onClick={onClose} type="button" aria-label="Закрыть" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#1b1a17', lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 'none', padding: '14px 24px 0' }}>
          <div style={{ display: 'flex', gap: 4, background: '#e9e3d7', borderRadius: 12, padding: 4 }}>
            <button onClick={() => setAddMode('catalog')} style={{ flex: 1, padding: 10, border: 'none', borderRadius: 9, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: addMode === 'catalog' ? '#1b1a17' : 'transparent', color: addMode === 'catalog' ? '#f3efe7' : '#46423a' }}>Из каталога</button>
            <button onClick={() => setAddMode('manual')} style={{ flex: 1, padding: 10, border: 'none', borderRadius: 9, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: addMode === 'manual' ? '#1b1a17' : 'transparent', color: addMode === 'manual' ? '#f3efe7' : '#46423a' }}>Вручную</button>
          </div>
        </div>

        {addMode === 'manual' && (
          <>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 24px' }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Наименование</div>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Напр. Rome Vein" style={{ width: '100%', height: 46, marginTop: 7, padding: '0 14px', border: '1px solid #e6e1d5', borderRadius: 11, background: '#faf8f3', fontSize: 15, outline: 'none' }} />
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Бренд</div>
                  <input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} placeholder="ABK" style={{ width: '100%', height: 46, marginTop: 7, padding: '0 14px', border: '1px solid #e6e1d5', borderRadius: 11, background: '#faf8f3', fontSize: 15, outline: 'none' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Тип</div>
                  <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} style={{ width: '100%', height: 46, marginTop: 7, padding: '0 12px', border: '1px solid #e6e1d5', borderRadius: 11, background: '#faf8f3', fontSize: 15, fontFamily: "'Space Grotesk',sans-serif", color: '#1b1a17', outline: 'none' }}>
                    {TYPE_ORDER.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Спецификация</div>
                <input value={draft.spec} onChange={(e) => setDraft({ ...draft, spec: e.target.value })} placeholder="Керамогранит, 120×278" style={{ width: '100%', height: 46, marginTop: 7, padding: '0 14px', border: '1px solid #e6e1d5', borderRadius: 11, background: '#faf8f3', fontSize: 15, outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div style={{ width: 90 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Кол-во</div>
                  <input value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} style={{ width: '100%', height: 46, marginTop: 7, padding: '0 14px', border: '1px solid #e6e1d5', borderRadius: 11, background: '#faf8f3', fontSize: 15, fontFamily: "'JetBrains Mono',monospace", outline: 'none' }} />
                </div>
                <div style={{ width: 80 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Ед.</div>
                  <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} style={{ width: '100%', height: 46, marginTop: 7, padding: '0 10px', border: '1px solid #e6e1d5', borderRadius: 11, background: '#faf8f3', fontSize: 15, fontFamily: "'JetBrains Mono',monospace", color: '#1b1a17', outline: 'none' }}>
                    {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Цена / шт, ₽</div>
                  <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="6500" style={{ width: '100%', height: 46, marginTop: 7, padding: '0 14px', border: '1px solid #e6e1d5', borderRadius: 11, background: '#faf8f3', fontSize: 15, fontFamily: "'JetBrains Mono',monospace", outline: 'none' }} />
                </div>
              </div>
            </div>
            <div style={{ flex: 'none', display: 'flex', gap: 10, padding: '16px 24px', borderTop: '1px solid #e2ddd1' }}>
              <button onClick={onClose} style={{ flex: 'none', background: 'transparent', border: '1px solid #d9d3c6', color: '#46423a', borderRadius: 12, padding: '14px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Отмена</button>
              <button onClick={onSubmit} style={{ flex: 1, background: canSubmit ? '#1b1a17' : '#bcb7ab', color: '#f3efe7', border: 'none', borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>{editId ? 'Сохранить позицию' : 'Добавить материал'}</button>
            </div>
          </>
        )}

        {addMode === 'catalog' && (
          <>
            <div style={{ flex: 'none', padding: '14px 24px 0' }}>
              {editId && fillItem && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 600, background: '#1b1a17', color: '#f3efe7', padding: '5px 11px', borderRadius: 7 }}>{fillItem.code}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.04em', color: '#9a958a' }}>Выберите материал для этой позиции</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 12, padding: '0 14px', height: 46 }}>
                <div style={{ width: 14, height: 14, border: '1.6px solid #b3aea2', borderRadius: '50%', position: 'relative', flex: 'none' }}><div style={{ position: 'absolute', width: 6, height: 1.6, background: '#b3aea2', right: -4, bottom: 0, transform: 'rotate(45deg)', transformOrigin: 'left' }}></div></div>
                <input value={catQueryInput} onChange={(e) => { const v = e.target.value; setCatQueryInput(v); clearTimeout(catDebounce.current); catDebounce.current = setTimeout(() => setCatQuery(v), 120); }} aria-label="Поиск по каталогу" placeholder="Название, бренд, артикул…" style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 15, color: '#1b1a17', minWidth: 0, outline: 'none' }} />
                {catQueryInput.trim().length > 0 && <button onClick={() => { setCatQueryInput(''); setCatQuery(''); }} type="button" aria-label="Очистить" style={{ flex: 'none', width: 24, height: 24, borderRadius: 7, border: 'none', background: '#ece6da', color: '#46423a', cursor: 'pointer', fontSize: 13 }}>✕</button>}
              </div>
              <div style={{ display: 'flex', gap: 7, marginTop: 12, overflowX: 'auto', paddingBottom: 2 }}>
                {catTypesPresent.map((t: string) => (
                  <button key={t} onClick={() => setCatType(t)} style={{ flex: 'none', padding: '8px 14px', borderRadius: 20, fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', background: catType === t ? '#1b1a17' : 'transparent', color: catType === t ? '#f3efe7' : '#46423a', border: catType === t ? '1px solid #1b1a17' : '1px solid #d9d3c6' }}>{t}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 11 }}>
                <span style={{ flex: 'none', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#a8a296' }}>Сорт.</span>
                <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
                  {[
                    { key: 'default', label: 'По каталогу' },
                    { key: 'name', label: 'Название' },
                    { key: 'price', label: 'Цена' },
                    { key: 'brand', label: 'Производитель' },
                  ].map(def => {
                    const on = catSort === def.key;
                    return (
                      <button key={def.key} onClick={() => {
                        if (def.key === 'default') setCatSort('default');
                        else if (catSort === def.key) setCatSortDir(catSortDir === 'asc' ? 'desc' : 'asc');
                        else { setCatSort(def.key); setCatSortDir('asc'); }
                      }} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 20, fontFamily: "'Space Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', background: on ? '#1b1a17' : 'transparent', color: on ? '#f3efe7' : '#46423a', border: on ? '1px solid #1b1a17' : '1px solid #d9d3c6' }}>
                        {def.label}{on && def.key !== 'default' && <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, lineHeight: 1 }}>{catSortDir === 'desc' ? '↓' : '↑'}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              {(catInSpecCount > 0 || catHideInSpec) && (
                <div style={{ display: 'flex', marginTop: 10 }}>
                  <button onClick={() => setCatHideInSpec(!catHideInSpec)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 13px 7px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', background: catHideInSpec ? '#eef0e6' : 'transparent', color: '#1b1a17', border: catHideInSpec ? '1px solid #1b1a17' : '1px solid #d9d3c6' }}>
                    <span style={{ flex: 'none', width: 16, height: 16, borderRadius: 5, border: `1.6px solid ${catHideInSpec ? '#1b1a17' : '#c9c2b3'}`, background: catHideInSpec ? '#1b1a17' : 'transparent', color: '#f3efe7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1 }}>{catHideInSpec ? '✓' : ''}</span>
                    Скрыть добавленные · {catInSpecCount}
                  </button>
                </div>
              )}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 24px 8px' }}>
              {catSorted.length === 0 && (
                <div style={{ textAlign: 'center', padding: '36px 12px', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#a8a296' }}>Ничего не найдено — измените запрос или фильтр</div>
              )}
              {catSorted.map((c: any) => {
                const key = catKey(c);
                const on = !!catSelected[key];
                return (
                  <button key={key} onClick={() => toggleCat(key)} style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 9, border: `1px solid ${on ? '#1b1a17' : '#e6e1d5'}`, background: on ? '#eef0e6' : '#faf8f3', borderRadius: 14, padding: 13, marginBottom: 10, cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif" }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                      <span style={{ flex: 'none', width: 52, height: 52, borderRadius: 9, border: '1px solid #e2ddd1', background: 'repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6 5px,#efe9df 5px,#efe9df 10px)' }}></span>
                      <span style={{ flex: 1, minWidth: 0, paddingRight: 26 }}>
                        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.2 }}>{c.name}</span>
                        <span style={{ display: 'block', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9a958a', marginTop: 3 }}>{c.brand}</span>
                        {catInSpec(c) && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7, fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase', color: '#5f7a3f', background: '#eef1e7', border: '1px solid #d4dcc2', borderRadius: 20, padding: '3px 8px' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#5f7a3f' }}></span>в спецификации</span>
                        )}
                      </span>
                    </div>
                    <span style={{ display: 'block', fontSize: 12, color: '#6a665a', lineHeight: 1.35 }}>{c.spec}</span>
                    <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 2 }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a296' }}>{c.type}</span>
                      <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700 }}>{fmt(c.price)} ₽<span style={{ fontSize: 10, fontWeight: 500, color: '#9a958a' }}>/{c.unit}</span></span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ flex: 'none', padding: '12px 24px 14px', borderTop: '1px solid #e2ddd1' }}>
              {catSelCount > 0 && !editId && (
                <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 10 }}>
                  {catSelectedList.map((c: any) => (
                    <span key={catKey(c)} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, background: '#eef0e6', border: '1px solid #cdd3bd', borderRadius: 20, padding: '6px 8px 6px 12px', fontSize: 12.5, fontWeight: 600, color: '#1b1a17', whiteSpace: 'nowrap' }}>
                      {c.name}<span onClick={(e) => { e.stopPropagation(); toggleCat(catKey(c)); }} style={{ cursor: 'pointer', width: 17, height: 17, borderRadius: '50%', background: '#dfe3d3', color: '#46423a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1 }}>✕</span>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0, fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#6a665a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {catSelCount > 0 && <span>{catSelCount} · {catSelSumStr} ₽ · <span onClick={() => { setCatSelected({}); }} style={{ cursor: 'pointer', textDecoration: 'underline' }}>сбросить</span></span>}
                </div>
                <button onClick={addFromCatalog} style={{ flex: 'none', background: catSelCount > 0 ? '#1b1a17' : '#bcb7ab', color: '#f3efe7', border: 'none', borderRadius: 12, padding: '14px 22px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, cursor: catSelCount > 0 ? 'pointer' : 'not-allowed' }}>
                  {editId ? (catSelCount > 0 ? 'Заполнить позицию' : 'Выберите материал') : (catSelCount > 0 ? `Добавить выбранное · ${catSelCount}` : 'Выберите материалы')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DeleteModal({ item, items, deleteMode, setDeleteMode, onClose, onDeleteFull, onReplaceWithMark, onCreateReplace, onClear, prefixOf }: any) {
  const rooms = item.rooms || [];
  const candidates = items.filter((it: SpecItem) => it.type === item.type && it.id !== item.id && !it.placeholder).map((it: SpecItem) => ({ code: it.code, name: it.name, brand: it.brand, onPick: () => onReplaceWithMark(it.id) }));
  const replacing = deleteMode === 'replace';

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(27,26,23,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'clamp(12px,5vh,64px) 16px', zIndex: 65, overflowY: 'auto' }}>
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" data-modal="delete" tabIndex={-1} style={{ width: '100%', maxWidth: 496, background: '#f3efe7', borderRadius: 22, overflow: 'hidden', boxShadow: '0 30px 80px rgba(27,26,23,.3)', outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #e2ddd1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, background: '#1b1a17', color: '#f3efe7', padding: '5px 11px', borderRadius: 7 }}>{item.code}</span>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>Удаление марки</span>
          </div>
          <button onClick={onClose} type="button" aria-label="Закрыть" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#1b1a17', lineHeight: 1, padding: 4 }}>✕</button>
        </div>
        <div style={{ padding: '22px 24px' }}>
          <div style={{ fontSize: 15, color: '#46423a', lineHeight: 1.4 }}>{item.name || ('Марка ' + item.code)} <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#9a958a' }}>· {item.type}</span></div>
          {rooms.length > 0 && (
            <div style={{ marginTop: 14, background: '#faf6ee', border: '1px solid #e7d9c2', borderRadius: 13, padding: '13px 15px' }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9c7b46' }}>Назначена в {rooms.length} помещениях</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>{rooms.map((r: string) => <span key={r} style={{ fontSize: 12.5, fontWeight: 500, background: '#fff', border: '1px solid #e7d9c2', color: '#6b5836', borderRadius: 20, padding: '5px 11px' }}>{r}</span>)}</div>
            </div>
          )}
          {rooms.length === 0 && (
            <div style={{ marginTop: 14, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 13, padding: '13px 15px', fontSize: 13, color: '#9a958a' }}>Назначений в помещениях нет — марку можно безопасно удалить.</div>
          )}

          {!replacing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
              <div onClick={onDeleteFull} style={{ border: '1px solid #e0c9c3', background: '#fbf4f2', borderRadius: 14, padding: '15px 16px', cursor: 'pointer' }}>
                <div style={{ fontSize: 15.5, fontWeight: 600, color: '#a23b2e' }}>🗑 Удалить полностью</div>
                <div style={{ fontSize: 13, color: '#8a7d74', marginTop: 5, lineHeight: 1.45 }}>Марка удаляется безвозвратно. Последующие марки с префиксом «{prefixOf(item.code)}» сместятся вверх.</div>
              </div>
              <div onClick={() => setDeleteMode('replace')} style={{ border: '1px solid #e6e1d5', background: '#faf8f3', borderRadius: 14, padding: '15px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 15.5, fontWeight: 600 }}>🔄 Заменить на другую марку</div><div style={{ fontSize: 13, color: '#8a7d74', marginTop: 5, lineHeight: 1.45 }}>Перенести назначения на другую марку категории «{item.type}», затем удалить эту.</div></div>
                <span style={{ flex: 'none', color: '#9a958a', fontSize: 18 }}>→</span>
              </div>
              <div onClick={onClear} style={{ border: '1px solid #e6e1d5', background: '#faf8f3', borderRadius: 14, padding: '15px 16px', cursor: 'pointer' }}>
                <div style={{ fontSize: 15.5, fontWeight: 600 }}>Очистить содержимое</div>
                <div style={{ fontSize: 13, color: '#8a7d74', marginTop: 5, lineHeight: 1.45 }}>Материал обнуляется, на месте останется пустая марка {item.code}.</div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
                <span onClick={() => setDeleteMode(null)} style={{ cursor: 'pointer', fontSize: 18, color: '#9a958a' }}>←</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a958a' }}>Выберите марку-приёмник</span>
              </div>
              {candidates.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 13 }}>
                  {candidates.map((c: any) => (
                    <div key={c.code} onClick={c.onPick} style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px solid #e6e1d5', background: '#faf8f3', borderRadius: 13, padding: '12px 14px', cursor: 'pointer' }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 600, background: '#efe9dc', color: '#1b1a17', padding: '4px 9px', borderRadius: 6, flex: 'none' }}>{c.code}</span>
                      <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: '#9a958a', marginTop: 2 }}>{c.brand}</div></div>
                      <span style={{ flex: 'none', color: '#9a958a', fontSize: 16 }}>→</span>
                    </div>
                  ))}
                </div>
              )}
              {candidates.length === 0 && (
                <>
                  <div style={{ marginTop: 13, fontSize: 13.5, color: '#8a7d74', lineHeight: 1.45 }}>Подходящих марок категории «{item.type}» нет.</div>
                  <div onClick={onCreateReplace} style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 11, border: '1.5px dashed #cdc6b6', borderRadius: 13, padding: 14, cursor: 'pointer', color: '#46423a' }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, border: '1.5px dashed #cdc6b6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, lineHeight: 1, flex: 'none' }}>+</span>
                    <div><div style={{ fontSize: 14.5, fontWeight: 600 }}>Создать новую пустую марку</div><div style={{ fontSize: 12, color: '#9a958a', marginTop: 2 }}>Назначения перенесутся на неё</div></div>
                  </div>
                </>
              )}
            </>
          )}
          {!replacing && <button onClick={onClose} style={{ width: '100%', marginTop: 14, background: 'transparent', border: '1px solid #d9d3c6', color: '#46423a', borderRadius: 12, padding: 13, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Отмена</button>}
        </div>
      </div>
    </div>
  );
}

function ProcureModal({ stAwait, stOrder, stDeliv, stReplace, procScopeSum, procScopeCount, pickPhase, pickSum, onClose, onOpen, onShowReplace }: any) {
  const procStages = [
    { label: 'Ожидает закупки', sub: 'Согласовано — можно заказывать', color: statusMeta('Согласовано', '#1b1a17').bar, count: stAwait.count, sumStr: fmt(stAwait.sum), hasItems: stAwait.count > 0, items: stAwait.items },
    { label: 'Заказано', sub: 'Оплачено · в производстве или в пути', color: statusMeta('Приобретено', '#1b1a17').bar, count: stOrder.count, sumStr: fmt(stOrder.sum), hasItems: stOrder.count > 0, items: stOrder.items },
    { label: 'Доставлено', sub: 'Получено на объекте', color: statusMeta('Доставлено', '#1b1a17').bar, count: stDeliv.count, sumStr: fmt(stDeliv.sum), hasItems: stDeliv.count > 0, items: stDeliv.items },
  ];
  const procEmpty = procScopeCount === 0 && stReplace.count === 0;
  const procDeliveredPct = procScopeSum ? Math.round(stDeliv.sum / procScopeSum * 100) : 0;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(27,26,23,.5)', zIndex: 70, overflowY: 'auto', padding: 'clamp(10px,4vh,40px) 14px' }}>
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" data-modal="procure" tabIndex={-1} style={{ maxWidth: 760, margin: '0 auto', background: '#f3efe7', borderRadius: 20, overflow: 'hidden', boxShadow: '0 30px 80px rgba(27,26,23,.34)', outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 24px', background: '#f3efe7', borderBottom: '1px solid #e2ddd1' }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a' }}>Закупка и поставка</span>
          <button onClick={onClose} type="button" aria-label="Закрыть" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#1b1a17', lineHeight: 1, padding: 4 }}>✕</button>
        </div>
        <div style={{ padding: 'clamp(20px,4vw,32px)', maxHeight: '78vh', overflowY: 'auto' }}>
          {procEmpty ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: '#9a958a' }}>
              <div style={{ fontSize: 19, fontWeight: 600, color: '#1b1a17' }}>Закупка ещё не началась</div>
              <div style={{ fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>Как только позиции получат статус «Согласовано», они появятся в воронке закупки и поставки.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: 'clamp(24px,4vw,34px)', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1 }}>{procDeliveredPct}%</div><div style={{ fontSize: 14, color: '#6a665a', marginTop: 6 }}>{stDeliv.count} из {procScopeCount} {plural(procScopeCount, 'позиции', 'позиций', 'позиций')} доставлено</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a' }}>Сумма в закупке</div><div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{fmt(procScopeSum)} ₽</div></div>
              </div>
              <div style={{ display: 'flex', height: 12, borderRadius: 7, overflow: 'hidden', marginTop: 16, background: '#ece6da' }}>
                {[stDeliv, stOrder, stAwait].filter(s => procScopeSum > 0 && s.sum > 0).map((s, i) => <div key={i} style={{ width: (s.sum / procScopeSum * 100) + '%', background: statusMeta(s === stDeliv ? 'Доставлено' : s === stOrder ? 'Приобретено' : 'Согласовано', '#1b1a17').bar }}></div>)}
              </div>
              {procStages.map((stage: any, i: number) => (
                <div key={i} style={{ marginTop: 26 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 11, borderBottom: '1px solid #1b1a17' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: stage.color }}></span>
                      <div style={{ minWidth: 0 }}><div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-.01em' }}>{stage.label} <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 500, color: '#9a958a' }}>· {stage.count}</span></div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '.02em', color: '#9a958a', marginTop: 2 }}>{stage.sub}</div></div>
                    </div>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{stage.sumStr} ₽</span>
                  </div>
                  {stage.hasItems && stage.items.map((it: SpecItem) => (
                    <div key={it.id} onClick={() => onOpen(it.id)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '11px 4px', borderBottom: '1px solid #ece6da', cursor: 'pointer' }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 500, color: '#46423a', width: 56 }}>{it.code}</span>
                      <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name || ('Марка ' + it.code)}</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: '#9a958a' }}>{it.brand}</div></div>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, textAlign: 'right', color: '#46423a', width: 116 }}>{it.qty} {it.unit} × {fmt(it.price)}</span>
                      <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, textAlign: 'right', width: 116 }}>{fmt(it.qty * it.price)} ₽</span>
                    </div>
                  ))}
                  {!stage.hasItems && <div style={{ padding: '12px 4px', fontSize: 13, color: '#a8a296' }}>Нет позиций на этой стадии.</div>}
                </div>
              ))}
              {stReplace.count > 0 && (
                <div style={{ marginTop: 24, background: '#f7e7e3', border: '1px solid #ecccc4', borderRadius: 14, padding: '15px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: '#bf5345' }}></span><span style={{ fontSize: 14.5, fontWeight: 700, color: '#a23b2e' }}>Требуют замены · {stReplace.count}</span></div>
                    <span onClick={onShowReplace} style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, color: '#a23b2e', cursor: 'pointer', whiteSpace: 'nowrap' }}>Открыть в списке →</span>
                  </div>
                  {stReplace.items.map((it: SpecItem) => (
                    <div key={it.id} onClick={() => onOpen(it.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0 0', cursor: 'pointer' }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, fontWeight: 500, color: '#a23b2e', flex: 'none' }}>{it.code}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: '#6b4039', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name || ('Марка ' + it.code)}</span>
                      <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#9b6f64', whiteSpace: 'nowrap' }}>{fmt(it.qty * it.price)} ₽</span>
                    </div>
                  ))}
                </div>
              )}
              {pickPhase.length > 0 && (
                <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#faf8f3', border: '1px solid #e6e1d5', borderRadius: 13, padding: '13px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: '#bcb7ab' }}></span><span style={{ fontSize: 13.5, color: '#46423a' }}>Ещё в подборе · {pickPhase.length}</span></div>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#9a958a' }}>{fmt(pickSum)} ₽ · до закупки</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryModal({ items, onClose, onPrint, onExportCsv }: any) {
  const grandTotal = items.reduce((s: number, it: SpecItem) => s + it.qty * it.price, 0);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(27,26,23,.5)', zIndex: 70, overflowY: 'auto', padding: 'clamp(10px,4vh,40px) 14px' }}>
      <div id="spec-summary" onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" data-modal="summary" tabIndex={-1} style={{ maxWidth: 900, margin: '0 auto', background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px rgba(27,26,23,.34)', outline: 'none' }}>
        <div className="summary-bar" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px clamp(18px,4vw,28px)', background: '#fff', borderBottom: '1px solid #e2ddd1' }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a' }}>Сводка спецификации</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button onClick={onExportCsv} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#faf8f3', border: '1px solid #d9d3c6', color: '#1b1a17', borderRadius: 11, padding: '11px 16px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Excel (CSV)</button>
            <button onClick={onPrint} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1b1a17', border: 'none', color: '#f3efe7', borderRadius: 11, padding: '11px 16px', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Печать / PDF</button>
            <button onClick={onClose} type="button" aria-label="Закрыть" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#1b1a17', lineHeight: 1, padding: 4 }}>✕</button>
          </div>
        </div>
        <div style={{ padding: 'clamp(24px,5vw,46px)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', borderBottom: '2px solid #1b1a17', paddingBottom: 22 }}>
            <div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a' }}>Седьмой тестовый проект</div><div style={{ fontSize: 'clamp(28px,5vw,40px)', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1, marginTop: 8 }}>Спецификация материалов</div></div>
            <div style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#9a958a', lineHeight: 1.7 }}><div>Дата · {new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}</div><div>Позиций · {items.length}</div></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginTop: 24, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a958a' }}>Итого по спецификации</span>
            <span style={{ fontSize: 'clamp(30px,6vw,44px)', fontWeight: 700, letterSpacing: '-.02em' }}>{fmt(grandTotal)} ₽</span>
          </div>
          <div style={{ display: 'flex', height: 12, borderRadius: 7, overflow: 'hidden', marginTop: 18, background: '#ece6da' }}>
            {STATUS_FLOW.map((key: string) => {
              const its = items.filter((it: SpecItem) => it.status === key);
              if (!its.length) return null;
              const sum = its.reduce((s: number, it: SpecItem) => s + it.qty * it.price, 0);
              return <div key={key} style={{ width: (sum / (grandTotal || 1)) * 100 + '%', background: statusMeta(key, '#1b1a17').bar }}></div>;
            })}
          </div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 14 }}>
            {STATUS_FLOW.map((key: string) => {
              const its = items.filter((it: SpecItem) => it.status === key);
              if (!its.length) return null;
              const sum = its.reduce((s: number, it: SpecItem) => s + it.qty * it.price, 0);
              return <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusMeta(key, '#1b1a17').bar }}></span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{key}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#9a958a' }}>{its.length} · {fmt(sum)} ₽ · {Math.round(sum / (grandTotal || 1) * 100)}%</span>
              </div>;
            })}
          </div>
          {TYPE_ORDER.map((type: string) => {
            const its = items.filter((it: SpecItem) => it.type === type);
            if (!its.length) return null;
            const sum = its.reduce((s: number, it: SpecItem) => s + it.qty * it.price, 0);
            return (
              <div key={type} className="summary-break" style={{ marginTop: 34 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid #1b1a17' }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>{type} <span style={{ color: '#9a958a' }}>· {its.length}</span></span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600 }}>{fmt(sum)} ₽</span>
                </div>
                {its.map((it: SpecItem) => (
                  <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '56px minmax(140px,1.5fr) 1fr 78px 92px 110px 118px', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #ece6da', fontSize: 13.5 }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#46423a' }}>{it.code}</span>
                    <span style={{ fontWeight: 600 }}>{it.name} <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: '#9a958a', fontWeight: 400 }}>{it.brand}</span></span>
                    <span style={{ color: '#46423a', fontSize: 12.5 }}>{it.spec}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, textAlign: 'right' }}>{it.qty} {it.unit}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, textAlign: 'right', color: '#46423a' }}>{fmt(it.price)}</span>
                    <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, textAlign: 'right' }}>{fmt(it.qty * it.price)} ₽</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: statusMeta(it.status, '#1b1a17').dot }}></span><span style={{ fontSize: 11.5, color: '#46423a', whiteSpace: 'nowrap' }}>{it.status}</span></span>
                  </div>
                ))}
              </div>
            );
          })}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 30, paddingTop: 18, borderTop: '2px solid #1b1a17' }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>Всего</span>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.01em' }}>{fmt(grandTotal)} ₽</span>
          </div>
        </div>
      </div>
    </div>
  );
}
