'use client';

import { SpecItem, Variant, DraftItem, FileEntry, TYPE_ORDER, STATUS_FLOW, UNIT_OPTIONS } from '../types';
import { CATALOG } from '../catalog';
import {
  fmt, brandSite, statusMeta, plural, plural as pl, catKey, availMeta,
  FILE_CATS, MAP_OPTIONS, humanSize
} from '../utils';
import { ToastState } from '../hooks/useSpecBuilder';
import StatusBadge from './StatusBadge';

// ─── DetailModal ─────────────────────────────────────────────────
interface DetailModalProps {
  item: SpecItem;
  accent: string;
  detailTab: string;
  setDetailTab: (t: string) => void;
  fileTab: string;
  setFileTab: (t: string) => void;
  onClose: () => void;
  onMinus: () => void;
  onPlus: () => void;
  onPrice: (v: string) => void;
  onUnit: (v: string) => void;
  onRemove: () => void;
  setStatus: (s: string) => void;
  onAvail: (v: string) => void;
  onLead: (v: string) => void;
  onMgrName: (v: string) => void;
  onMgrPhone: (v: string) => void;
  onMgrEmail: (v: string) => void;
  onNotes: (v: string) => void;
  onAddRoom: (name: string) => void;
  onRemoveRoom: (name: string) => void;
  onAddVariant: () => void;
  onAddFiles: (cat: string, fileList: FileList | null) => void;
  onRemoveFile: (cat: string, fid: string) => void;
  onSetTextureMap: (fid: string, map: string) => void;
  onShare: () => void;
  saveStatus: string;
}

export function DetailModal({
  item, accent, detailTab, setDetailTab, fileTab, setFileTab,
  onClose, onMinus, onPlus, onPrice, onUnit, onRemove, setStatus,
  onAvail, onLead, onMgrName, onMgrPhone, onMgrEmail, onNotes,
  onAddRoom, onRemoveRoom, onAddVariant, onAddFiles, onRemoveFile, onSetTextureMap, onShare, saveStatus
}: DetailModalProps) {
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

// ─── AddModal ────────────────────────────────────────────────────
interface AddModalProps {
  editId: string | null;
  addMode: 'catalog' | 'manual';
  setAddMode: (m: 'catalog' | 'manual') => void;
  draft: DraftItem;
  setDraft: (d: DraftItem) => void;
  onClose: () => void;
  onSubmit: () => void;
  catQueryInput: string;
  setCatQueryInput: (v: string) => void;
  setCatQuery: (v: string) => void;
  catDebounce: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
  catType: string;
  setCatType: (t: string) => void;
  catSort: string;
  setCatSort: (s: string) => void;
  catSortDir: 'asc' | 'desc';
  setCatSortDir: (d: 'asc' | 'desc') => void;
  catHideInSpec: boolean;
  setCatHideInSpec: (v: boolean) => void;
  catSelected: Record<string, boolean>;
  toggleCat: (key: string) => void;
  catSorted: any[];
  catInSpec: (c: any) => boolean;
  catInSpecCount: number;
  catSelCount: number;
  catSelSumStr: string;
  addFromCatalog: () => void;
  fillItem: SpecItem | null | undefined;
  catTypesPresent: string[];
  catSelectedList: any[];
  setCatSelected: (v: Record<string, boolean>) => void;
  prefixOf: (code: string) => string;
}

export function AddModal({
  editId, addMode, setAddMode, draft, setDraft, onClose, onSubmit,
  catQueryInput, setCatQueryInput, setCatQuery, catDebounce,
  catType, setCatType, catSort, setCatSort, catSortDir, setCatSortDir,
  catHideInSpec, setCatHideInSpec, catSelected, toggleCat, catSorted,
  catInSpec, catInSpecCount, catSelCount, catSelSumStr, addFromCatalog,
  fillItem, catTypesPresent, catSelectedList, setCatSelected, prefixOf
}: AddModalProps) {
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

// ─── DeleteModal ─────────────────────────────────────────────────
interface DeleteModalProps {
  item: SpecItem;
  items: SpecItem[];
  deleteMode: string | null;
  setDeleteMode: (m: string | null) => void;
  onClose: () => void;
  onDeleteFull: () => void;
  onReplaceWithMark: (targetId: string) => void;
  onCreateReplace: () => void;
  onClear: () => void;
  prefixOf: (code: string) => string;
}

export function DeleteModal({ item, items, deleteMode, setDeleteMode, onClose, onDeleteFull, onReplaceWithMark, onCreateReplace, onClear, prefixOf }: DeleteModalProps) {
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

// ─── ProcureModal ────────────────────────────────────────────────
interface ProcureModalProps {
  stAwait: any;
  stOrder: any;
  stDeliv: any;
  stReplace: any;
  procScopeSum: number;
  procScopeCount: number;
  pickPhase: SpecItem[];
  pickSum: number;
  onClose: () => void;
  onOpen: (id: string) => void;
  onShowReplace: () => void;
}

export function ProcureModal({ stAwait, stOrder, stDeliv, stReplace, procScopeSum, procScopeCount, pickPhase, pickSum, onClose, onOpen, onShowReplace }: ProcureModalProps) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(27,26,23,.5)', zIndex: 70, overflowY: 'auto', padding: 'clamp(10px,4vh,40px) 14px' }}>
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" data-modal="procure" tabIndex={-1} style={{ maxWidth: 760, margin: '0 auto', background: '#f3efe7', borderRadius: 20, overflow: 'hidden', boxShadow: '0 30px 80px rgba(27,26,23,.34)', outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 24px', background: '#f3efe7', borderBottom: '1px solid #e2ddd1' }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a958a' }}>Закупка и поставка</span>
          <button onClick={onClose} type="button" aria-label="Закрыть" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#1b1a17', lineHeight: 1, padding: 4 }}>✕</button>
        </div>
        <div style={{ padding: 'clamp(20px,4vw,32px)', maxHeight: '78vh', overflowY: 'auto' }}>
          {/* Simplified procurement view */}
          <div style={{ textAlign: 'center', padding: '20px', color: '#9a958a' }}>
            <div style={{ fontSize: 19, fontWeight: 600, color: '#1b1a17' }}>Закупка и поставка</div>
            <div style={{ fontSize: 14, marginTop: 8 }}>Позиций в закупке: {procScopeCount}, сумма: {fmt(procScopeSum)} ₽</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SummaryModal ────────────────────────────────────────────────
interface SummaryModalProps {
  items: SpecItem[];
  onClose: () => void;
  onPrint: () => void;
  onExportCsv: () => void;
}

export function SummaryModal({ items, onClose, onPrint, onExportCsv }: SummaryModalProps) {
  const grandTotal = items.reduce((s: number, it: SpecItem) => s + it.qty * it.price, 0);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(27,26,23,.5)', zIndex: 70, overflowY: 'auto', padding: 'clamp(10px,4vh,40px) 14px' }}>
      <div id="spec-summary" onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" data-modal="summary" tabIndex={-1} style={{ maxWidth: 900, margin: '0 auto', background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px rgba(27,26,23,.34)', outline: 'none' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px clamp(18px,4vw,28px)', background: '#fff', borderBottom: '1px solid #e2ddd1' }}>
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
        </div>
      </div>
    </div>
  );
}