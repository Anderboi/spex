"use client";

import { useState } from "react";
import { Share2, Trash2, Eraser } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineCode } from "./inline-code";
import { StatusMenu } from "./status-menu";
import { QtyStepper } from "./qty-stepper";
import { PriceField } from "./price-field";
import { isLocked } from "@/lib/spec/status";
import { fmt } from "@/lib/utils";
import { SpecStatus, UNIT_OPTIONS } from "@/lib/constants";
import { SpecItem, SpecItemPatch } from '@/lib/types';
import { SupplierPicker } from './supplier-picker';
import { AttrsEditor } from './attrs-editor';
import { RoomsEditor } from './rooms-editor';

type Company = { id: string; name: string };
type Contact = {
  id: string;
  name: string;
  company_id: string | null;
  phone: string | null;
  email: string | null;
};

export function DetailModal({
  item,
  companies,
  contacts,
  onClose,
  onPatch,
  onCode,
  onQty,
  onPrice,
  onStatus,
  onClear,
  onDelete,
  onShare,
}: {
  item: SpecItem;
  companies: Company[];
  contacts: Contact[];
  onClose: () => void;
  onPatch: (patch: SpecItemPatch) => void;
  onCode: (code: string) => void;
  onQty: (delta: number) => void;
  onPrice: (raw: string) => void;
  onStatus: (s: SpecStatus) => void;
  onClear: () => void;
  onDelete: () => void;
  onShare: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const sum = item.qty * item.price;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-bg-card sm:max-w-170">
        <DialogHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <InlineCode
              code={item.code}
              locked={isLocked(item.status)}
              onCommit={onCode}
            />
            <StatusMenu item={item} onChange={onStatus} />
            <span className="ml-auto font-mono text-[15px] font-semibold tabular-nums">
              {sum > 0 ? `${fmt(sum)} ₽` : "—"}
            </span>
          </div>
          <DialogTitle className="text-pretty text-lg">
            {item.name || (
              <span className="text-fg-muted">Позиция не заполнена</span>
            )}
          </DialogTitle>
          {item.brand && (
            <p className="text-[13px] text-fg-muted">{item.brand}</p>
          )}
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-2">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="attrs">Характеристики</TabsTrigger>
            <TabsTrigger value="rooms">
              Помещения {item.rooms.length > 0 && `· ${item.rooms.length}`}
            </TabsTrigger>
            <TabsTrigger value="supplier">Поставщик</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Название">
                <Input
                  defaultValue={item.name}
                  onBlur={(e) => onPatch({ name: e.target.value.trim() })}
                />
              </Field>
              <Field label="Бренд">
                <Input
                  defaultValue={item.brand}
                  onBlur={(e) => onPatch({ brand: e.target.value.trim() })}
                />
              </Field>
              <Field label="Артикул">
                <Input
                  defaultValue={item.article}
                  onBlur={(e) => onPatch({ article: e.target.value.trim() })}
                />
              </Field>
              <Field label="Единица">
                <select
                  defaultValue={item.unit}
                  onChange={(e) => onPatch({ unit: e.target.value })}
                  className="h-9 w-full rounded-md border border-border-muted bg-bg px-3 text-sm"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Описание">
              <textarea
                defaultValue={item.spec}
                onBlur={(e) => onPatch({ spec: e.target.value.trim() })}
                className="min-h-16 w-full rounded-md border border-border-muted bg-bg p-2 text-sm"
              />
            </Field>

            <div className="flex flex-wrap items-end gap-6 rounded-lg border border-border-muted p-3">
              <Field label="Количество">
                <QtyStepper
                  editable={false}
                  qty={item.qty}
                  unit={item.unit}
                  onChange={onQty}
                />
              </Field>
              <Field label="Цена за ед.">
                <PriceField
                  readOnly={false} //TODO: fix
                  value={item.price}
                  onCommit={onPrice}
                />
              </Field>
              <div className="ml-auto text-right">
                <span className="block text-[11px] uppercase tracking-wider text-fg-muted">
                  Сумма
                </span>
                <span className="font-mono text-[17px] font-semibold tabular-nums">
                  {fmt(sum)} ₽
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Наличие">
                <Input
                  defaultValue={item.avail}
                  placeholder="В наличии / под заказ"
                  onBlur={(e) => onPatch({ avail: e.target.value.trim() })}
                />
              </Field>
              <Field label="Срок поставки">
                <Input
                  defaultValue={item.leadTime}
                  placeholder="4–6 недель"
                  onBlur={(e) => onPatch({ leadTime: e.target.value.trim() })}
                />
              </Field>
            </div>

            <Field label="Заметки">
              <textarea
                defaultValue={item.notes}
                onBlur={(e) => onPatch({ notes: e.target.value })}
                placeholder="Условия, скидки, договорённости"
                className="min-h-20 w-full rounded-md border border-border-muted bg-bg p-2 text-sm"
              />
            </Field>
          </TabsContent>

          <TabsContent value="attrs" className="pt-4">
            <AttrsEditor
              type={item.type}
              attrs={item.attrs}
              onChange={(attrs) => onPatch({ attrs })}
            />
          </TabsContent>

          <TabsContent value="rooms" className="pt-4">
            <RoomsEditor
              rooms={item.rooms}
              onChange={(rooms) => onPatch({ rooms })}
            />
          </TabsContent>

          <TabsContent value="supplier" className="pt-4">
            <SupplierPicker
              companies={companies}
              contacts={contacts}
              companyId={item.companyId}
              contactId={item.contactId}
              snapshot={item.companyName}
              onChange={(companyId, contactId) =>
                onPatch({ companyId, contactId })
              }
            />
          </TabsContent>
        </Tabs>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-muted pt-4">
          <Button variant="ghost" onClick={onShare} className="gap-2">
            <Share2 className="size-4" /> Поделиться
          </Button>
          <Button variant="ghost" onClick={onClear} className="gap-2">
            <Eraser className="size-4" /> Очистить
          </Button>
          <Button
            variant="ghost"
            onClick={onDelete}
            className="ml-auto gap-2 text-fg-red"
          >
            <Trash2 className="size-4" /> Удалить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </Label>
      {children}
    </div>
  );
}
