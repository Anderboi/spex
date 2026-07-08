'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { SpecItem, TYPE_ORDER, UNIT_OPTIONS } from '@/lib/types';
import { fmt, catKey } from "@/lib/utils";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const manualSchema = z.object({
  name: z.string().min(1, 'Required'),
  brand: z.string(),
  type: z.string().min(1),
  spec: z.string(),
  qty: z.coerce.number().int().min(1),
  unit: z.string().min(1),
  price: z.coerce.number().min(0),
});

type ManualFormValues = z.infer<typeof manualSchema>;

interface AddModalFormProps {
  editId: string | null;
  onClose: () => void;
  onSubmitManual: (data: ManualFormValues) => void;
  fillItem: SpecItem | null | undefined;
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
  catTypesPresent: string[];
  catSelectedList: any[];
  setCatSelected: (v: Record<string, boolean>) => void;
}

export default function AddModalForm({
  editId, onClose, onSubmitManual, fillItem,
  catQueryInput, setCatQueryInput, setCatQuery, catDebounce,
  catType, setCatType, catSort, setCatSort, catSortDir, setCatSortDir,
  catHideInSpec, setCatHideInSpec, catSelected, toggleCat, catSorted,
  catInSpec, catInSpecCount, catSelCount, catSelSumStr, addFromCatalog,
  catTypesPresent, catSelectedList, setCatSelected,
}: AddModalFormProps) {
  const [mode, setMode] = useState<'catalog' | 'manual'>('catalog');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<ManualFormValues>({
    resolver: zodResolver(manualSchema) as any,
    defaultValues: { name: '', brand: '', type: 'Отделка', spec: '', qty: 1, unit: 'шт', price: 0 },
    mode: 'onChange',
  });

  const nameVal = watch('name');
  const priceVal = watch('price');
  const isManualValid = nameVal.trim().length > 0 && Number(priceVal) > 0;

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-180! flex flex-col max-h-[90vh] overflow-hidden bg-bg rounded-[22px] p-0 gap-0 [&>button]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between py-5 px-6 pb-4 border-b border-border-subtle">
          <DialogTitle className="text-[19px] font-bold tracking-[-.01em] m-0">
            {editId ? 'Заполнить позицию' : 'Новый материал'}
          </DialogTitle>
          <Button variant="ghost" size="icon" onClick={onClose} className="size-8 text-fg text-[20px] hover:bg-transparent">
            ✕
          </Button>
        </DialogHeader>

        <div className="flex-none px-6 pt-3.5">
          <div className="flex gap-1 bg-bg-toggle rounded-xl p-1">
            <button onClick={() => setMode('catalog')} className="flex-1 py-2.5 border-none rounded-[9px] font-sans text-[14px] font-semibold cursor-pointer" style={{ background: mode === 'catalog' ? '#1b1a17' : 'transparent', color: mode === 'catalog' ? '#f3efe7' : '#46423a' }}>
              Из каталога
            </button>
            <button onClick={() => setMode('manual')} className="flex-1 py-2.5 border-none rounded-[9px] font-sans text-[14px] font-semibold cursor-pointer" style={{ background: mode === 'manual' ? '#1b1a17' : 'transparent', color: mode === 'manual' ? '#f3efe7' : '#46423a' }}>
              Вручную
            </button>
          </div>
        </div>

        {mode === 'manual' ? (
          <form onSubmit={handleSubmit(onSubmitManual)} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto py-5 px-6">
              <div className="space-y-4">
                <div>
                  <label className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">Наименование</label>
                  <Input {...register('name')} placeholder="Напр. Rome Vein" className="h-12 border-border bg-bg-card text-[15px] rounded-[11px] mt-[7px]" />
                  {errors.name && <p className="text-[11px] text-fg-red mt-1">{errors.name.message}</p>}
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">Бренд</label>
                    <Input {...register('brand')} placeholder="ABK" className="h-12 border-border bg-bg-card text-[15px] rounded-[11px] mt-[7px]" />
                  </div>
                  <div className="flex-1">
                    <label className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">Тип</label>
                    <Select onValueChange={(v) => setValue('type', v || 'Отделка')} defaultValue="Отделка">
                      <SelectTrigger className="h-12 border-border bg-bg-card text-[15px] rounded-[11px] mt-[7px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_ORDER.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">Спецификация</label>
                  <Input {...register('spec')} placeholder="Керамогранит, 120×278" className="h-[46px] border-border bg-bg-card text-[15px] rounded-[11px] mt-[7px]" />
                </div>

                <div className="flex gap-3">
                  <div className="w-[90px]">
                    <label className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">Кол-во</label>
                    <Input {...register('qty', { valueAsNumber: true })} type="number" min={1} className="h-[46px] border-border bg-bg-card text-[15px] font-mono rounded-[11px] [appearance:textfield] mt-[7px]" />
                    {errors.qty && <p className="text-[10px] text-fg-red mt-1">{errors.qty.message}</p>}
                  </div>
                  <div className="w-20">
                    <label className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">Ед.</label>
                    <Select onValueChange={(v) => setValue('unit', v || 'шт')} defaultValue="шт">
                      <SelectTrigger className="h-12 border-border bg-bg-card text-[15px] font-mono rounded-[11px] mt-[7px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIT_OPTIONS.map((u) => (<SelectItem key={u} value={u}>{u}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <label className="font-mono text-[10px] tracking-[.08em] uppercase text-fg-muted">Цена / шт, ₽</label>
                    <Input {...register('price', { valueAsNumber: true })} type="number" min={0} placeholder="6500" className="h-[46px] border-border bg-bg-card text-[15px] font-mono rounded-[11px] [appearance:textfield] mt-[7px]" />
                    {errors.price && <p className="text-[10px] text-fg-red mt-1">{errors.price.message}</p>}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-none flex gap-[10px] py-4 px-6 border-t border-border-subtle">
              <Button type="button" variant="outline" onClick={onClose} className="flex-none border-border-muted text-fg-body rounded-[12px] py-[14px] px-5 text-[14px] font-semibold h-auto">
                Отмена
              </Button>
              <Button type="submit" disabled={!isManualValid} className="flex-1 rounded-xl py-[14px] h-auto text-[15px] font-semibold border-none" style={{ background: isManualValid ? '#1b1a17' : '#bcb7ab', color: '#f3efe7' }}>
                {editId ? 'Сохранить позицию' : 'Добавить материал'}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex-none px-6 pt-[14px]">
              {editId && fillItem && (
                <div className="flex items-center gap-[10px] mb-3">
                  <span className="font-mono text-[12px] font-semibold bg-bg-accent text-bg py-[5px] px-[11px] rounded-[7px]">{fillItem.code}</span>
                  <span className="font-mono text-[11px] tracking-[.04em] text-fg-muted">Выберите материал для этой позиции</span>
                </div>
              )}
              <div className="flex items-center gap-3 bg-bg-card border border-border rounded-xl px-[14px] h-[46px]">
                <div className="size-3.5 border-[1.6px] border-fg-icon rounded-full relative flex-none">
                  <div className="absolute w-[6px] h-[1.6px] bg-fg-icon right-[-4px] bottom-0 rotate-45 origin-left"></div>
                </div>
                <Input value={catQueryInput} onChange={(e) => { const v = e.target.value; setCatQueryInput(v); clearTimeout(catDebounce.current); catDebounce.current = setTimeout(() => setCatQuery(v), 120); }} aria-label="Поиск по каталогу" placeholder="Название, бренд, артикул…" className="flex-1 border-none bg-transparent text-[15px] text-fg min-w-0 h-auto shadow-none outline-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0" />
                {catQueryInput.trim().length > 0 && <Button variant="ghost" size="icon" onClick={() => { setCatQueryInput(''); setCatQuery(''); }} className="size-6 rounded-[7px] bg-bg-clear text-fg-body cursor-pointer text-[13px] hover:bg-bg-clear">✕</Button>}
              </div>
              <div className="flex gap-[7px] mt-3 overflow-x-auto pb-[2px]">
                {catTypesPresent.map((t: string) => (
                  <button key={t} onClick={() => setCatType(t)} className="flex-none py-2 px-[14px] rounded-full font-sans text-[13px] font-semibold cursor-pointer whitespace-nowrap" style={{ background: catType === t ? '#1b1a17' : 'transparent', color: catType === t ? '#f3efe7' : '#46423a', border: catType === t ? '1px solid #1b1a17' : '1px solid #d9d3c6' }}>{t}</button>
                ))}
              </div>
              <div className="flex items-center gap-[9px] mt-[11px]">
                <span className="flex-none font-mono text-[10px] tracking-[.1em] uppercase text-fg-dim">Сорт.</span>
                <div className="flex gap-[7px] overflow-x-auto pb-[2px]">
                  {[{ key: 'default', label: 'По каталогу' }, { key: 'name', label: 'Название' }, { key: 'price', label: 'Цена' }, { key: 'brand', label: 'Производитель' }].map(def => {
                    const on = catSort === def.key;
                    return (
                      <button key={def.key} onClick={() => { if (def.key === 'default') setCatSort('default'); else if (catSort === def.key) setCatSortDir(catSortDir === 'asc' ? 'desc' : 'asc'); else { setCatSort(def.key); setCatSortDir('asc'); } }} className="flex-none flex items-center gap-[5px] py-[7px] px-3 rounded-full font-sans text-[12.5px] font-semibold cursor-pointer whitespace-nowrap" style={{ background: on ? '#1b1a17' : 'transparent', color: on ? '#f3efe7' : '#46423a', border: on ? '1px solid #1b1a17' : '1px solid #d9d3c6' }}>
                        {def.label}{on && def.key !== 'default' && <span className="font-mono text-[11px] leading-none">{catSortDir === 'desc' ? '↓' : '↑'}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              {(catInSpecCount > 0 || catHideInSpec) && (
                <div className="flex mt-[10px]">
                  <button onClick={() => setCatHideInSpec(!catHideInSpec)} className="inline-flex items-center gap-2 py-[7px] pl-[10px] pr-[13px] rounded-full cursor-pointer font-sans text-[12.5px] font-semibold whitespace-nowrap" style={{ background: catHideInSpec ? '#eef0e6' : 'transparent', color: '#1b1a17', border: catHideInSpec ? '1px solid #1b1a17' : '1px solid #d9d3c6' }}>
                    <span className="flex-none w-4 h-4 rounded-[5px] flex items-center justify-center text-[11px] leading-none" style={{ border: `1.6px solid ${catHideInSpec ? '#1b1a17' : '#c9c2b3'}`, background: catHideInSpec ? '#1b1a17' : 'transparent', color: '#f3efe7' }}>{catHideInSpec ? '✓' : ''}</span>
                    Скрыть добавленные · {catInSpecCount}
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-[14px] pb-2">
              {catSorted.length === 0 ? (
                <div className="text-center py-9 px-3 font-mono text-[12px] text-fg-dim">Ничего не найдено — измените запрос или фильтр</div>
              ) : (
                catSorted.map((c: any) => {
                  const key = catKey(c);
                  const on = !!catSelected[key];
                  return (
                    <button key={key} onClick={() => toggleCat(key)} className="w-full text-left flex flex-col gap-[9px] rounded-[14px] p-[13px] mb-[10px] cursor-pointer font-sans" style={{ border: `1px solid ${on ? '#1b1a17' : '#e6e1d5'}`, background: on ? '#eef0e6' : '#faf8f3' }}>
                      <div className="flex items-start gap-[11px]">
                        <span className="flex-none w-[52px] h-[52px] rounded-[9px] border border-border-placeholder bg-[repeating-linear-gradient(135deg,#e7e1d6,#e7e1d6_5px,#efe9df_5px,#efe9df_10px)]"></span>
                        <span className="flex-1 min-w-0 pr-[26px]">
                          <span className="block text-[14.5px] font-bold tracking-[-.01em] leading-[1.2]">{c.name}</span>
                          <span className="block font-mono text-[10px] tracking-[.06em] uppercase text-fg-muted mt-[3px]">{c.brand}</span>
                          {catInSpec(c) && <span className="inline-flex items-center gap-[5px] mt-[7px] font-mono text-[9px] tracking-[.06em] uppercase text-fg-green bg-bg-green-light border border-border-accent rounded-full py-[3px] px-2"><span className="w-[5px] h-[5px] rounded-full bg-bg-green"></span>в спецификации</span>}
                        </span>
                      </div>
                      <span className="block text-[12px] text-fg-secondary leading-[1.35]">{c.spec}</span>
                      <span className="flex items-baseline justify-between mt-[2px]">
                        <span className="font-mono text-[9px] tracking-[.06em] uppercase text-fg-dim">{c.type}</span>
                        <span className="font-sans text-[14px] font-bold">{fmt(c.price)} ₽<span className="text-[10px] font-medium text-fg-muted">/{c.unit}</span></span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex-none px-6 pb-[14px] pt-3 border-t border-border-subtle">
              {catSelCount > 0 && !editId && (
                <div className="flex gap-[7px] overflow-x-auto pb-[10px]">
                  {catSelectedList.map((c: any) => (
                    <span key={catKey(c)} className="flex-none inline-flex items-center gap-[7px] bg-bg-selected border border-border-chips rounded-full py-[6px] pl-3 pr-2 text-[12.5px] font-semibold text-fg whitespace-nowrap">
                      {c.name}<span onClick={(e) => { e.stopPropagation(); toggleCat(catKey(c)); }} className="cursor-pointer w-[17px] h-[17px] rounded-full bg-[#dfe3d3] text-fg-body inline-flex items-center justify-center text-[11px] leading-none">✕</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0 font-mono text-[11.5px] text-fg-secondary truncate">
                  {catSelCount > 0 && <span>{catSelCount} · {catSelSumStr} ₽ · <span onClick={() => setCatSelected({})} className="cursor-pointer underline">сбросить</span></span>}
                </div>
                <Button onClick={addFromCatalog} disabled={catSelCount === 0} className="flex-none rounded-[12px] py-[14px] px-[22px] h-auto text-[15px] font-semibold border-none" style={{ background: catSelCount > 0 ? '#1b1a17' : '#bcb7ab', color: '#f3efe7' }}>
                  {editId ? (catSelCount > 0 ? 'Заполнить позицию' : 'Выберите материал') : (catSelCount > 0 ? `Добавить выбранное · ${catSelCount}` : 'Выберите материалы')}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}