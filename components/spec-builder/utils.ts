import { SpecItem, CatalogItem, FileEntry, Variant, TYPE_ORDER, STATUS_FLOW, UNIT_OPTIONS, PREFIX_MAP } from './types';

export const STORAGE_KEY = 'spec_items_v1';

export const BRAND_SITES: Record<string, string> = {
  'ABK': 'https://www.abk.it',
  'Ideal Work': 'https://www.idealwork.com',
  'GESSI': 'https://www.gessi.com',
  'Cassina': 'https://www.cassina.com',
  'Astep': 'https://asteplight.com',
};

export function fmt(n: number | string): string {
  return Number(n || 0).toLocaleString('ru-RU');
}

export function prefixFor(type: string): string {
  return PREFIX_MAP[type] || 'М';
}

export function nextCode(items: SpecItem[], type: string): string {
  const n = items.filter(it => it.type === type).length + 1;
  return prefixFor(type) + '-' + String(n).padStart(2, '0');
}

export function brandSite(brand: string): string {
  return BRAND_SITES[brand] || ('https://www.google.com/search?q=' + encodeURIComponent((brand || '') + ' официальный сайт'));
}

export function statusMeta(s: string, accent: string) {
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

export function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && !(b >= 12 && b <= 14)) return few;
  return many;
}

export function catKey(c: CatalogItem): string {
  return c.article || (c.brand + '|' + c.name);
}

export function availMeta(a: string): string {
  const M: Record<string, string> = { 'В наличии': '#5f7a3f', 'Под заказ': '#3f6b80', 'Нет в наличии': '#bf5345', 'Уточняется': '#c79a35' };
  return M[a] || '#c79a35';
}

export const FILE_CATS = [
  { key: 'schemas', label: 'Схемы', accept: '.pdf,.dwg,.dxf,.png,.jpg,.jpeg', kind: 'doc' as const, upTitle: 'Загрузить схему производителя', upHint: 'PDF, DWG, DXF · спецлисты, узлы, чертежи', empty: 'Чертежи, технические листы и узлы от производителя' },
  { key: 'textures', label: 'Текстуры', accept: 'image/*,.exr,.tif,.tiff', kind: 'tex' as const, upTitle: 'Загрузить текстуру', upHint: 'JPG, PNG, TIFF, EXR · карты для визуализации', empty: 'PBR-карты для 3ds Max, Corona, V-Ray, Blender' },
  { key: 'care', label: 'Инструкции', accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png', kind: 'doc' as const, upTitle: 'Загрузить инструкцию', upHint: 'PDF, DOC · монтаж, укладка, уход', empty: 'Инструкции по монтажу, укладке и уходу' },
  { key: 'cad', label: '3D / CAD', accept: '.skp,.rfa,.3ds,.max,.obj,.fbx,.dwg', kind: 'doc' as const, upTitle: 'Загрузить 3D / CAD-блок', upHint: 'SKP, RFA, MAX, 3DS, OBJ, FBX', empty: 'Готовые блоки и модели для дизайнера' },
];

export const MAP_OPTIONS = ['Diffuse / Albedo', 'Normal', 'Roughness', 'Bump', 'Displacement', 'Metallic', 'AO', 'Opacity', 'Gloss'];

export function guessMap(n: string): string {
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

export function extOf(n: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(n || '');
  return m ? m[1].toUpperCase() : 'FILE';
}

export function humanSize(b: number): string {
  if (!b) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export function prefixOf(code: string) { return String(code || '').split('-')[0]; }
export function numOf(code: string) { return parseInt(String(code || '').split('-')[1], 10) || 0; }

export function renumberAfter(arr: SpecItem[], prefix: string, removedNum: number): SpecItem[] {
  return arr.map(it => {
    if (prefixOf(it.code) !== prefix) return it;
    const n = numOf(it.code);
    if (n > removedNum) return { ...it, code: prefix + '-' + String(n - 1).padStart(2, '0') };
    return it;
  });
}

export function renumberSequential(arr: SpecItem[]): SpecItem[] {
  const byPrefix: Record<string, SpecItem[]> = {};
  arr.forEach(it => { const p = prefixOf(it.code); (byPrefix[p] = byPrefix[p] || []).push(it); });
  const map: Record<string, string> = {};
  Object.keys(byPrefix).forEach(p => {
    byPrefix[p].slice().sort((a, b) => numOf(a.code) - numOf(b.code)).forEach((it, i) => { map[it.id] = p + '-' + String(i + 1).padStart(2, '0'); });
  });
  return arr.map(it => map[it.id] ? { ...it, code: map[it.id] } : it);
}

export function exportCSV(items: SpecItem[], showToast: (msg: string) => void) {
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

export const SEED_ITEMS: SpecItem[] = [
  { id: 'i1', type: 'Отделка', code: 'От-01', name: 'Rome Vein', brand: 'ABK', spec: 'Керамогранит, 120×278', qty: 30, unit: 'м²', price: 6500, status: 'Не выбрано', article: 'PF60005800', format: '120 × 278 см · 6 мм', surface: 'Матовая, ректификат', color: 'Statuario', variants: [{ name: 'Rome Vein · ABK', lead: 'срок 4–6 недель', price: 6500, selected: true }, { name: 'Marvel Onyx · Atlas', lead: 'срок 2–3 недели', price: 5900, selected: false }], rooms: ['Гостиная', 'Кухня-столовая', 'Холл'], avail: 'Под заказ', leadTime: '4–6 недель', manager: { name: 'Анна Лебедева · ABK Studio', phone: '+7 495 120-44-90', email: 'a.lebedeva@abk.ru' }, notes: 'Заказывать с запасом +5% на подрезку. Раскладку согласовать с прорабом до отгрузки.' },
  { id: 'i2', type: 'Отделка', code: 'От-02', name: 'Rome Vein', brand: 'ABK', spec: 'Керамогранит, 60×120', qty: 11, unit: 'м²', price: 6500, status: 'Подобрано', article: 'PF60005801', format: '60 × 120 см · 9 мм', surface: 'Матовая', color: 'Statuario', variants: [{ name: 'Rome Vein · ABK', lead: 'срок 4–6 недель', price: 6500, selected: true }] },
  { id: 'i3', type: 'Отделка', code: 'От-03', name: 'Microtopping', brand: 'Ideal Work', spec: 'Микроцемент, серый', qty: 65, unit: 'м²', price: 1000, status: 'Согласовано', article: 'MT-GREY', format: 'наливной', surface: 'Шёлк-матовая', color: 'Grigio', variants: [] },
  { id: 'i4', type: 'Сантехника', code: 'С-01', name: 'Гигиенический душ', brand: 'GESSI', spec: 'Один вывод, чёрный', qty: 2, unit: 'шт', price: 18500, status: 'Заменить', article: 'GE-31643', format: 'настенный', surface: 'Black metal', color: 'Чёрный матовый', variants: [{ name: 'GESSI 316', lead: 'в наличии', price: 18500, selected: true }], rooms: ['Гостевой санузел', 'Постирочная'] },
  { id: 'i5', type: 'Сантехника', code: 'С-02', name: 'Inciso смеситель', brand: 'GESSI', spec: 'Настенный, хром', qty: 4, unit: 'шт', price: 13200, status: 'Не выбрано', article: 'GE-58111', format: 'настенный', surface: 'Chrome', color: 'Хром', variants: [], rooms: ['Ванная мастер', 'Гостевой санузел', 'Кухня-столовая', 'Санузел детский'] },
  { id: 'i6', type: 'Мебель', code: 'М-01', name: 'Soriana диван', brand: 'Cassina', spec: '3-местный, кожа Pelle', qty: 1, unit: 'шт', price: 340000, status: 'Приобретено', article: 'CAS-SOR3', format: '240 × 95 см', surface: 'Кожа Pelle', color: 'Sabbia', variants: [{ name: 'Soriana · кожа', lead: 'срок 10–12 недель', price: 340000, selected: true }, { name: 'Soriana · ткань', lead: 'срок 8 недель', price: 268000, selected: false }], rooms: ['Гостиная'] },
  { id: 'i7', type: 'Мебель', code: 'М-02', name: 'Mex кресло', brand: 'Cassina', spec: 'Ткань Rohi, песочный', qty: 2, unit: 'шт', price: 36000, status: 'Доставлено', article: 'CAS-MEX', format: '78 × 80 см', surface: 'Ткань Rohi', color: 'Песочный', variants: [] },
  { id: 'i8', type: 'Освещение', code: 'О-01', name: 'Model 2065', brand: 'Astep', spec: 'Подвес, опал + латунь', qty: 3, unit: 'шт', price: 31500, status: 'Не выбрано', article: 'AST-2065', format: 'Ø 25 см', surface: 'Опал. стекло', color: 'Латунь', variants: [{ name: 'Model 2065', lead: 'срок 5 недель', price: 31500, selected: true }] },
];