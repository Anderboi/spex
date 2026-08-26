"use client";

import { useState, type ChangeEvent } from "react";
import { Share2, Trash2, Eraser, CloudUpload, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
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
import { cn, fmt } from "@/lib/utils";
import { LEAD_TIME_OPTIONS, SpecStatus, UNIT_OPTIONS } from "@/lib/constants";
import { SpecItem, SpecItemPatch } from "@/lib/types";
import { SupplierPicker } from "./supplier-picker";
import { AttrsEditor } from "./attrs-editor";
import { RoomsEditor } from "./rooms-editor";
import { ScrollArea } from "../ui/scroll-area";
import Image from "next/image";
import { CompanyDialog } from "@/components/contacts/company-dialog";
import CopyButton from "../layout/copy-button";
import { toast } from "sonner";
import { uploadMaterialImage } from "@/actions/materials";

type Company = {
  id: string;
  name: string;
  email?: string| null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  note?: string | null;
};
type Contact = {
  id: string;
  name: string;
  company_id: string | null;
  phone?: string | null;
  email?: string | null;
};

export function DetailModal({
  item,
  companies,
  contacts,
  orgSlug,
  onClose,
  onPatch,
  onCode,
  onQty,
  onPrice,
  onStatus,
  onClear,
  onDelete,
  onShare,
  projectRooms,
}: {
  item: SpecItem;
  companies: Company[];
  contacts: Contact[];
  orgSlug: string;
  onClose: () => void;
  onPatch: (patch: SpecItemPatch) => void;
  onCode: (code: string) => void;
  onQty: (delta: number) => void;
  onPrice: (raw: string) => void;
  onStatus: (s: SpecStatus) => void;
  onClear: () => void;
  onDelete: () => void;
  onShare: () => void;
  projectRooms: string[];
}) {
  const [tab, setTab] = useState("overview");
  const [localCompanies, setLocalCompanies] = useState<Company[]>(companies);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const sum = item.qty * item.price;

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadMaterialImage(orgSlug, fd);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      onPatch({ imageUrl: res.url });
    } catch {
      toast.error("Не удалось загрузить изображение");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] flex-col bg-bg sm:max-w-170 p-0 gap-0">
        <DialogHeader className="sticky top-0 gap-2 border-b p-4">
          <div className="flex flex-row gap-8">
            <div className="flex flex-wrap items-center gap-3">
              <div className="bg-fg px-2 py-1 rounded-sm text-bg">
                <InlineCode
                  code={item.code}
                  locked={isLocked(item.status)}
                  onCommit={onCode}
                />
              </div>
              <span className="font-mono uppercase text-fg-muted text-xs">
                {item.type} / {item.product_type}
              </span>
            </div>
            <StatusMenu item={item} onChange={onStatus} />
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-2 gap-0">
          <TabsList className="w-full justify-start gap-2 overflow-x-auto bg-bg //border px-4">
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="attrs">Характеристики</TabsTrigger>
            <TabsTrigger value="rooms">
              Помещения {item.rooms.length > 0 && `· ${item.rooms.length}`}
            </TabsTrigger>
            <TabsTrigger value="supplier">Поставщик</TabsTrigger>
            <TabsTrigger value="files">Файлы</TabsTrigger>
          </TabsList>
          <ScrollArea className="h-[60vh]">
            <TabsContent
              value="overview"
              className="flex flex-col gap-4 pt-2 pb-4"
            >
              {/* <DialogTitle className="text-pretty text-xl">
                {item.name || (
                  <span className="text-fg-muted">Позиция не заполнена</span>
                )}
              </DialogTitle>
              {item.brand && (
                <p className="text-[13px] text-fg-muted">{item.brand}</p>
              )} */}
              {/* //? Images */}
              <section className="flex items-center justify-start gap-4 bg-bg-card border-t border-b border-border-muted py-4 pl-4 pr-6">
                {item.imageUrl && (
                  <Image
                    alt="product image"
                    src={item.imageUrl}
                    width={120}
                    height={120}
                    className="bg-bg-brand rounded-lg border"
                  />
                )}
                <label className="flex items-center cursor-pointer justify-center gap-2 border-2 border-border-muted bg-bg-card rounded-lg border-dashed p-4 h-30 flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFile}
                    disabled={isUploading}
                  />
                  <div className="flex flex-col items-center gap-2">
                    {isUploading ? (
                      <Loader2 className="size-6 animate-spin text-fg-muted" />
                    ) : (
                      <CloudUpload size={24} className="text-fg-muted" />
                    )}
                    <div className="flex flex-col items-center">
                      <span>
                        {item.imageUrl
                          ? "Заменить изображение"
                          : "Добавить изображение"}
                      </span>
                      <span className="text-xs text-fg-muted">
                        JPG/PNG до 5 МБ
                      </span>
                    </div>
                  </div>
                </label>
              </section>

              <section className="grid grid-cols-2 gap-4 pl-4 pr-6">
                <Field label="Наименование" className="col-span-2">
                  <Input
                    defaultValue={item.name}
                    onBlur={(e) => onPatch({ name: e.target.value.trim() })}
                  />
                </Field>
                <Field label="Производитель">
                  <Input
                    defaultValue={item.brand}
                    onBlur={(e) => onPatch({ brand: e.target.value.trim() })}
                  />
                </Field>

                {/* <Field label="Единица">
                  <select
                    defaultValue={item.unit}
                    onChange={(e) => onPatch({ unit: e.target.value })}
                    className="h-10 w-full rounded-md border border-border-muted bg-bg-card px-3 text-sm"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </Field> */}
                <Field label="Тип">
                  <Input
                    defaultValue={item.product_type}
                    onBlur={(e) =>
                      onPatch({ product_type: e.target.value.trim() })
                    }
                  />
                </Field>
                <Field label="Артикул">
                  <Input
                    defaultValue={item.article}
                    onBlur={(e) => onPatch({ article: e.target.value.trim() })}
                  />
                </Field>
                <Field label="Срок поставки">
                  <select
                    defaultValue={item.leadTime}
                    onChange={(e) => onPatch({ leadTime: e.target.value })}
                    className="h-10 w-full rounded-lg font-mono border border-border-muted bg-bg-card px-3 text-sm"
                  >
                    {LEAD_TIME_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  {/* <Input
                    defaultValue={item.leadTime}
                    placeholder="4–6 недель"
                    onBlur={(e) => onPatch({ leadTime: e.target.value.trim() })}
                  /> */}
                </Field>
              </section>

              <Field label="Ссылка" className="pl-4 pr-6">
                <div className="flex flex-row gap-2 items-center">
                  <Input
                    defaultValue={item.product_url}
                    onBlur={(e) =>
                      onPatch({ product_url: e.target.value.trim() })
                    }
                  />
                  {item.product_url && (
                    <CopyButton textToCopy={item.product_url} />
                  )}
                </div>
              </Field>

              {/* //? Quantity & Price */}
              <section className="flex flex-wrap items-center gap-2 rounded-lg pl-4 pr-6 border-border-muted">
                <div className="bg-bg-card h-19 border rounded-lg p-3 flex-1">
                  <Field label="Кол-во">
                    <div className="flex items-center gap-2">
                      <QtyStepper
                        editable={false}
                        qty={item.qty}
                        unit={item.unit}
                        onChange={onQty}
                        showUnit={false}
                      />
                      <select
                        defaultValue={item.unit}
                        onChange={(e) => onPatch({ unit: e.target.value })}
                        className="h-6 w-full rounded-sm font-mono //border border-border-muted bg-bg-card px-3 text-sm"
                      >
                        {UNIT_OPTIONS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                  </Field>
                </div>
                <div className="bg-bg-card h-19 border  rounded-lg p-3 flex-1">
                  <Field label="Цена за ед.">
                    <PriceField
                      readOnly={false} //TODO: fix
                      value={item.price}
                      onCommit={onPrice}
                      className="text-[18px]! p-0! text-left! font-semibold tabular-nums"
                    />
                  </Field>
                </div>
                <div className="ml-auto h-19 text-left font-mono bg-fg rounded-lg p-3 text-bg flex-1">
                  <Field label="Сумма">
                    <span className="text-[18px] font-semibold tabular-nums">
                      {fmt(sum)} ₽
                    </span>
                  </Field>
                </div>
              </section>
              <Field label="Описание" className="pl-4 pr-6">
                <textarea
                  defaultValue={item.spec}
                  onBlur={(e) => onPatch({ spec: e.target.value.trim() })}
                  className="min-h-16 w-full rounded-lg border border-border-muted bg-bg-card p-2 text-sm"
                />
              </Field>
              <Field label="Заметки" className="pl-4 pr-6">
                <textarea
                  defaultValue={item.notes}
                  onBlur={(e) => onPatch({ notes: e.target.value })}
                  placeholder="Условия, скидки, договорённости"
                  className="min-h-20 w-full rounded-lg border border-border-muted bg-bg-card p-2 text-sm"
                />
              </Field>
            </TabsContent>

            <TabsContent
              value="attrs"
              className="flex flex-col gap-4 py-4 pl-4 pr-6"
            >
              <AttrsEditor
                type={item.type}
                attrs={item.attrs}
                onChange={(attrs) => onPatch({ attrs })}
              />
            </TabsContent>

            <TabsContent
              value="rooms"
              className="flex flex-col gap-4 py-4 pl-4 pr-6"
            >
              <RoomsEditor
                rooms={item.rooms}
                onChange={(rooms) => onPatch({ rooms })}
                suggestions={projectRooms}
              />
            </TabsContent>

            <TabsContent
              value="supplier"
              className="flex flex-col gap-4 py-4 pl-4 pr-6"
            >
              <SupplierPicker
                companies={localCompanies}
                contacts={contacts}
                companyId={item.companyId}
                contactId={item.contactId}
                snapshot={item.companyName}
                onChange={(companyId, contactId) =>
                  onPatch({ companyId, contactId })
                }
                onCreateCompany={(name) => {
                  setNewCompanyName(name);
                  setShowAddCompany(true);
                }}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="gap-2 border-t border-border-muted">
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
        </DialogFooter>
      </DialogContent>
      {showAddCompany && (
        <CompanyDialog
          orgSlug={orgSlug}
          open={showAddCompany}
          initialName={newCompanyName}
          onClose={() => setShowAddCompany(false)}
          onSuccess={(company) => {
            setLocalCompanies((prev) => [...prev, company]);
            onPatch({ companyId: company.id, contactId: null });
            setShowAddCompany(false);
          }}
        />
      )}
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label className="text-[11px] font-mono uppercase tracking-wider w-full text-fg-muted">
        {label}
      </Label>
      {children}
    </div>
  );
}
