import { FILE_CATS, MAP_OPTIONS } from '@/lib/constants';
import { SpecItem, STATUS_FLOW, UNIT_OPTIONS } from '@/lib/types';
import { availMeta, brandSite, fmt, humanSize, plural, statusMeta } from '@/lib/utils';

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
    <div onClick={onClose} className="fixed inset-0 z-60 flex items-start justify-center overflow-y-auto" style={{ background: 'rgba(27,26,23,.42)', padding: 'clamp(12px,4vh,48px) 16px' }}>
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" data-modal="detail" tabIndex={-1} className="w-full max-w-140 max-h-[92vh] flex flex-col bg-bg rounded-[22px] overflow-hidden outline-none" style={{ boxShadow: '0 30px 80px rgba(27,26,23,.3)' }}>
        <div className="flex-none flex items-center gap-3 py-4 px-5 pb-4 pl-6 border-b border-border-subtle bg-bg">
          <span className="flex-none font-mono text-[13px] font-semibold bg-bg-accent text-bg py-[6px] px-3 rounded-[7px]">{item.code}</span>
          <div className="flex-1 min-w-0"><div className="text-[17px] font-bold tracking-[-.01em] truncate">{item.name || ('Марка ' + item.code)}</div><div className="font-mono text-[10px] tracking-[.1em] uppercase text-fg-muted mt-[1px]">{item.type}</div></div>
          <button onClick={onClose} type="button" aria-label="Закрыть" className="flex-none bg-none border-none cursor-pointer text-[20px] text-fg leading-none p-1">✕</button>
        </div>

        <div className="flex-none flex gap-[2px] px-4 border-b border-border-subtle bg-bg overflow-x-auto">
          {[
            { key: 'overview', label: 'Обзор', badge: '' },
            { key: 'files', label: 'Файлы', badge: totalCount ? String(totalCount) : '' },
            { key: 'supply', label: 'Поставка и помещения', badge: '' },
            { key: 'notes', label: 'Заметки', badge: (item.notes && item.notes.trim()) ? '•' : '' },
          ].map((t: any) => {
            const on = t.key === detailTab;
            return <button key={t.key} onClick={() => setDetailTab(t.key)} className="flex-none flex items-center gap-2 bg-transparent border-none py-[14px] px-3 pb-3 -mb-px font-sans text-[13.5px] font-semibold cursor-pointer whitespace-nowrap" style={{ color: on ? '#1b1a17' : '#9a958a', borderBottom: `2px solid ${on ? '#1b1a17' : 'transparent'}` }}>
              {t.label}{t.badge && <span className="font-mono text-[10px] min-w-4 h-4 px-1 rounded-full inline-flex items-center justify-center" style={{ background: on ? '#1b1a17' : '#ece6da', color: on ? '#f3efe7' : '#9a958a' }}>{t.badge}</span>}
            </button>;
          })}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto py-[22px] px-6">
          {detailTab === 'overview' && (
            <>
              <div className="w-full h-50 rounded-[16px] border border-border-placeholder flex items-end p-4 mb-[18px]" style={{ background: 'repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6 8px,#efe9df 8px,#efe9df 16px)' }}>
                <span className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-dim">фото · 1200×1200</span>
              </div>
              <div className="flex flex-wrap gap-[7px]">
                {STATUS_FLOW.map((s: string) => {
                  const on = s === item.status;
                  const m = statusMeta(s, accent);
                  return <span key={s} onClick={() => setStatus(s)} className="flex-[1_1_28%] flex items-center justify-center gap-[7px] text-center py-[11px] px-[6px] rounded-[11px] text-[13px] font-medium cursor-pointer" style={{ background: on ? m.bg : '#faf8f3', color: on ? m.fg : '#9a958a', border: `1px solid ${on ? m.bd : '#e6e1d5'}` }}>
                    <span className="w-[6px] h-[6px] rounded-full flex-none" style={{ background: m.dot, opacity: on ? 1 : 0 }}></span>{s}
                  </span>;
                })}
              </div>
              <div className="flex gap-[10px] mt-[14px] items-stretch">
                <div className="flex-1 bg-bg-card border border-border rounded-[12px] py-[13px] px-[14px]">
                  <div className="font-mono text-[9px] tracking-[.08em] uppercase text-fg-muted">Кол-во</div>
                  <div className="flex items-center gap-3 mt-[7px]">
                    <span onClick={onMinus} className="w-[26px] h-[26px] rounded-[7px] border border-border-muted flex items-center justify-center cursor-pointer text-[16px] select-none">−</span>
                    <span className="font-mono text-[18px] font-semibold">{item.qty}</span>
                    <span onClick={onPlus} className="w-[26px] h-[26px] rounded-[7px] border border-border-muted flex items-center justify-center cursor-pointer text-[16px] select-none">+</span>
                    <select value={item.unit} onChange={(e) => onUnit(e.target.value)} className="ml-auto h-[30px] px-2 border border-border-muted rounded-[7px] bg-bg-white font-mono text-[12px] text-fg-body cursor-pointer">
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex-1 bg-bg-card border border-border rounded-[12px] py-[13px] px-[14px]">
                  <div className="flex items-center justify-between"><span className="font-mono text-[9px] tracking-[.08em] uppercase text-fg-muted">Цена / шт, ₽</span><span className="text-[11px] text-fg-icon leading-none">✎</span></div>
                  <input value={item.price} onChange={(e) => onPrice(e.target.value)} aria-label="Цена за единицу" className="w-full border-none border-b-[1.5px] border-dashed border-border-dash-input bg-transparent font-mono text-[18px] font-semibold mt-[7px] pb-[3px] text-fg outline-none" />
                </div>
              </div>
              <div className="flex items-center justify-between bg-bg-accent text-bg rounded-[12px] py-4 px-[18px] mt-3">
                <span className="font-mono text-[10px] tracking-[.1em] uppercase text-[#8d887d]">Итого</span>
                <span className="text-[24px] font-bold tracking-[-.01em]">{fmt(item.qty * item.price)} ₽</span>
              </div>
              <div className="mt-[14px] border-t border-border-subtle">
                {[['Артикул', item.article], ['Формат', item.format], ['Поверхность', item.surface], ['Цвет', item.color]].map(([label, val]) => (
                  <div key={label as string} className="flex justify-between py-[11px] border-b border-border-subtle">
                    <span className="font-mono text-[11px] tracking-[.06em] uppercase text-fg-muted">{label}</span>
                    <span className="text-[14px] font-medium">{val || '—'}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-[9px] mt-[18px] flex-wrap">
                <a href={brandSite(item.brand)} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[130px] flex items-center justify-center gap-[7px] bg-transparent border border-border-muted text-fg-body rounded-[11px] py-3 px-[14px] font-sans text-[14px] font-semibold no-underline">Сайт <span className="text-[13px]">↗</span></a>
                <button onClick={onShare} className="flex-1 min-w-[130px] flex items-center justify-center gap-2 bg-transparent border border-border-muted text-fg-body rounded-[11px] py-3 px-[14px] font-sans text-[14px] font-semibold cursor-pointer">🔗 Поделиться</button>
              </div>
            </>
          )}

          {detailTab === 'files' && (
            <>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-[.1em] uppercase font-semibold">Файлы и текстуры</span>
                <span className="font-mono text-[11px] text-fg-muted">{totalCount ? totalCount + ' ' + plural(totalCount, 'файл', 'файла', 'файлов') : 'нет файлов'}</span>
              </div>
              <div className="flex gap-[7px] mt-[13px] overflow-x-auto pb-[2px]">
                {FILE_CATS.map((c: any) => {
                  const on = c.key === activeCat;
                  const cnt = (allFiles[c.key] || []).length;
                  return <button key={c.key} onClick={() => setFileTab(c.key)} className="flex-none flex items-center gap-[7px] py-[9px] px-[13px] rounded-[10px] font-sans text-[13px] font-semibold cursor-pointer whitespace-nowrap" style={{ background: on ? '#1b1a17' : '#faf8f3', color: on ? '#f3efe7' : '#4a463d', border: on ? '1px solid #1b1a17' : '1px solid #e6e1d5' }}>
                    {c.label}<span className="font-mono text-[10px] px-[6px] py-[1px] rounded-full" style={{ background: on ? 'rgba(243,239,231,.18)' : '#ece6da', color: on ? '#f3efe7' : '#9a958a' }}>{cnt}</span>
                  </button>;
                })}
              </div>
              <label className="flex items-center gap-[13px] mt-3 border-[1.5px] border-dashed border-border-dash-bg rounded-[13px] py-[15px] px-[17px] cursor-pointer bg-bg-card">
                <span className="flex-none w-[34px] h-[34px] rounded-[9px] bg-bg-clear flex items-center justify-center text-[19px] text-fg-body leading-none">↑</span>
                <span className="min-w-0"><span className="block text-[14px] font-semibold">{cfg.upTitle}</span><span className="block font-mono text-[10.5px] text-fg-muted mt-[2px]">{cfg.upHint}</span></span>
                <input type="file" multiple accept={cfg.accept} onChange={(e) => { onAddFiles(activeCat, e.target.files); e.target.value = ''; }} className="hidden" />
              </label>
              {cfg.kind === 'tex' && curList.length > 0 && (
                <div className="grid grid-cols-2 gap-[10px] mt-3">
                  {curList.map((t: any) => (
                    <div key={t.id} className="border border-border-subtle rounded-[13px] overflow-hidden bg-bg-card">
                      <div className="relative h-[108px] bg-cover bg-center" style={{ backgroundImage: t.url ? `url(${t.url})` : 'repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6 8px,#efe9df 8px,#efe9df 16px)', backgroundColor: '#e7e1d6' }}>
                        <span className="absolute top-2 left-2 font-mono text-[9px] tracking-[.05em] uppercase bg-[rgba(27,26,23,.78)] text-bg py-[3px] px-[7px] rounded-[6px]">{(t.map || 'Diffuse / Albedo').split(' ')[0]}</span>
                        <span onClick={() => onRemoveFile(activeCat, t.id)} className="absolute top-[7px] right-[7px] w-[23px] h-[23px] rounded-[7px] bg-[rgba(27,26,23,.78)] text-bg flex items-center justify-center text-[12px] cursor-pointer leading-none">✕</span>
                      </div>
                      <div className="py-[9px] px-[10px]">
                        <div className="text-[12.5px] font-semibold truncate">{t.name}</div>
                        <select value={t.map || 'Diffuse / Albedo'} onChange={(e) => onSetTextureMap(t.id, e.target.value)} className="w-full mt-[7px] h-[30px] px-[7px] border border-border-plain rounded-[7px] bg-bg-white font-mono text-[11px] text-fg-body cursor-pointer">
                          {MAP_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <div className="font-mono text-[9.5px] text-fg-muted mt-[6px]">{t.ext} · {humanSize(t.size)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {cfg.kind === 'doc' && curList.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {curList.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-3 border border-border-subtle rounded-[12px] py-[11px] px-[13px] bg-bg-card">
                      <span className="flex-none w-[38px] h-[38px] rounded-[9px] flex items-center justify-center font-mono text-[10px] font-semibold" style={{ background: d.ext === 'PDF' ? '#f1ddd6' : '#e7eef3', color: d.ext === 'PDF' ? '#a23b2e' : '#365a6b' }}>{d.ext}</span>
                      <div className="flex-1 min-w-0"><div className="text-[13.5px] font-semibold truncate">{d.name}</div><div className="font-mono text-[10px] text-fg-muted mt-[2px]">{d.ext} · {humanSize(d.size)}</div></div>
                      <span onClick={() => onRemoveFile(activeCat, d.id)} className="flex-none w-[30px] h-[30px] rounded-lg flex items-center justify-center text-fg-icon cursor-pointer text-[14px]">✕</span>
                    </div>
                  ))}
                </div>
              )}
              {curList.length === 0 && <div className="text-center py-[22px] px-3 pb-[6px] font-mono text-[11px] text-fg-dim">{cfg.empty}</div>}
            </>
          )}

          {detailTab === 'supply' && (
            <>
              <div className="flex gap-[10px] items-stretch">
                <div className="flex-1 min-w-0 bg-bg-card border border-border rounded-[12px] py-[13px] px-[14px]">
                  <div className="font-mono text-[9px] tracking-[.08em] uppercase text-fg-muted">Наличие</div>
                  <div className="flex items-center gap-[9px] mt-[9px]">
                    <span className="flex-none w-[9px] h-[9px] rounded-full" style={{ background: availMeta(item.avail || 'Уточняется') }}></span>
                    <select value={item.avail || 'Уточняется'} onChange={(e) => onAvail(e.target.value)} className="flex-1 min-w-0 h-8 px-2 border border-border-muted rounded-[7px] bg-bg-white font-sans text-[13.5px] font-semibold text-fg cursor-pointer">
                      {['В наличии', 'Под заказ', 'Нет в наличии', 'Уточняется'].map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex-1 min-w-0 bg-bg-card border border-border rounded-[12px] py-[13px] px-[14px]">
                  <div className="flex items-center justify-between"><span className="font-mono text-[9px] tracking-[.08em] uppercase text-fg-muted">Срок поставки</span><span className="text-[11px] text-fg-icon leading-none">✎</span></div>
                  <input value={item.leadTime || ''} onChange={(e) => onLead(e.target.value)} placeholder="напр. 4–6 недель" className="w-full border-none border-b-[1.5px] border-dashed border-border-dash-input bg-transparent font-sans text-[15px] font-semibold mt-[9px] pb-[3px] text-fg outline-none" />
                </div>
              </div>
              <div className="mt-[18px] bg-bg-card border border-border rounded-[14px] py-[15px] px-4">
                <div className="flex items-center justify-between"><span className="font-mono text-[9px] tracking-[.08em] uppercase text-fg-muted">Менеджер поставщика</span><span className="text-[11px] text-fg-icon leading-none">✎</span></div>
                <input value={(item.manager && item.manager.name) || ''} onChange={(e) => onMgrName(e.target.value)} placeholder="Имя · компания" className="w-full h-[42px] mt-[9px] px-[13px] border border-border-plain rounded-[9px] bg-bg-white font-sans text-[14px] text-fg outline-none" />
                <div className="flex gap-[9px] mt-[9px]">
                  <input value={(item.manager && item.manager.phone) || ''} onChange={(e) => onMgrPhone(e.target.value)} placeholder="Телефон" className="flex-1 min-w-0 h-[42px] px-[13px] border border-border-plain rounded-[9px] bg-bg-white font-mono text-[13px] text-fg outline-none" />
                  <input value={(item.manager && item.manager.email) || ''} onChange={(e) => onMgrEmail(e.target.value)} placeholder="E-mail" className="flex-1 min-w-0 h-[42px] px-[13px] border border-border-plain rounded-[9px] bg-bg-white font-mono text-[13px] text-fg outline-none" />
                </div>
                {(item.manager && (item.manager.phone || item.manager.email)) && (
                  <div className="flex gap-[9px] mt-[11px]">
                    {item.manager.phone && <a href={`tel:${item.manager.phone.replace(/[^+\d]/g, '')}`} className="flex-1 text-center bg-bg-accent text-bg rounded-[9px] py-[11px] font-sans text-[13.5px] font-semibold no-underline">Позвонить</a>}
                    {item.manager.email && <a href={`mailto:${item.manager.email}`} className="flex-1 text-center bg-transparent border border-border-muted text-fg-body rounded-[9px] py-[11px] font-sans text-[13.5px] font-semibold no-underline">Написать</a>}
                  </div>
                )}
              </div>
              <div className="mt-[22px]">
                <div className="flex items-center gap-[9px]">
                  <span className="font-mono text-[11px] tracking-[.1em] uppercase font-semibold">Помещения · {(item.rooms || []).length}</span>
                  <span className="font-mono text-[10px] text-fg-muted">опционально</span>
                </div>
                <div className="flex flex-wrap gap-[7px] mt-[11px]">
                  {(item.rooms || []).map((r: string) => (
                    <span key={r} className="flex items-center gap-2 bg-bg-clear text-fg-body rounded-[9px] py-2 pl-[13px] pr-[9px] text-[13px] font-medium">
                      {r}<span onClick={() => onRemoveRoom(r)} className="cursor-pointer text-fg-muted text-[12px] leading-none">✕</span>
                    </span>
                  ))}
                  <input list="room-suggest" onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); onAddRoom((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} placeholder="+ помещение" className="border border-dashed border-border-dash-bg bg-transparent rounded-[9px] py-2 px-[13px] text-[13px] text-fg-body min-w-[140px] outline-none" />
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-[.1em] uppercase font-semibold">Варианты · {(item.variants || []).length}</span>
                <button onClick={onAddVariant} type="button" className="flex items-center gap-[6px] bg-transparent border border-border-muted rounded-[9px] py-[7px] px-3 font-sans text-[13px] font-semibold text-fg-body cursor-pointer"><span className="text-[15px] leading-none -mt-px">+</span> Добавить</button>
              </div>
              {(item.variants || []).map((v: any, i: number) => (
                <div key={i} className="border rounded-[14px] p-[14px] mt-[10px]" style={{ borderColor: v.selected ? '#1b1a17' : '#e2ddd1', background: v.selected ? '#faf8f3' : 'transparent' }}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] flex items-center gap-[6px]" style={{ color: v.selected ? accent : '#9a958a' }}><span className="w-[6px] h-[6px] rounded-full" style={{ background: v.selected ? accent : '#9a958a' }}></span>{v.selected ? 'Выбран' : 'Альтернатива'}</span>
                    <span className="font-mono text-[10px] text-fg-muted">Вариант {i + 1}</span>
                  </div>
                  <div className="flex gap-[11px] mt-[11px] items-center">
                    <div className="w-[44px] h-[44px] rounded-lg border border-border-placeholder flex-none" style={{ background: 'repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6 5px,#efe9df 5px,#efe9df 10px)' }}></div>
                    <div className="min-w-0"><div className="text-[14px] font-semibold">{v.name}</div><div className="font-mono text-[10px] text-fg-muted mt-[2px]">{v.lead}</div></div>
                    <div className="ml-auto text-right"><div className="font-sans text-[16px] font-bold">{fmt(v.price)} ₽</div></div>
                  </div>
                </div>
              ))}
            </>
          )}

          {detailTab === 'notes' && (
            <>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-[.1em] uppercase font-semibold">Заметки</span>
                <span className="text-[11px] text-fg-icon leading-none">✎</span>
              </div>
              <textarea value={item.notes || ''} onChange={(e) => onNotes(e.target.value)} placeholder="Комментарии для закупки, монтажа, замечания по объекту…" className="w-full mt-[11px] min-h-[200px] py-[13px] px-[14px] border border-border rounded-[12px] bg-bg-card font-sans text-[14px] leading-relaxed text-fg resize-y outline-none" />
            </>
          )}
        </div>

        <div className="flex-none flex items-center gap-[10px] py-[14px] px-[18px] border-t border-border-subtle bg-bg">
          <div role="status" aria-live="polite" className="flex-1 min-w-0 flex items-center gap-[7px] font-mono text-[11px] tracking-[.02em] text-fg-secondary truncate">
            {saveStatus === 'saving' && <><span className="w-2 h-2 rounded-full flex-none bg-bg-amber"></span><span>Сохранение…</span></>}
            {saveStatus === 'saved' && <><span className="w-2 h-2 rounded-full flex-none bg-bg-green"></span><span>Сохранено</span></>}
          </div>
          <button onClick={onRemove} className="flex-none bg-transparent border border-border-red-light text-fg-red rounded-[12px] py-[13px] px-4 font-sans text-[14px] font-semibold cursor-pointer">Удалить</button>
          <button onClick={onClose} className="flex-none min-w-[130px] bg-bg-accent text-bg border-none rounded-[12px] py-[13px] px-[22px] font-sans text-[15px] font-semibold cursor-pointer">Готово</button>
        </div>
      </div>
    </div>
  );
}
