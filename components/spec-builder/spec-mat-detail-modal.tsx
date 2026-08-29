"use client";

import { useState } from "react";
import {
  Share2,
  Trash2,
  Eraser,
  Paperclip,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { InlineCode } from "./inline-code";
import { StatusMenu } from "./status-menu";
import { isLocked } from "@/lib/spec/status";
import {  SpecStatus } from "@/lib/constants";
import { SpecItem, SpecItemPatch, SpecVariant } from "@/lib/types";
import { SupplierPicker } from "./supplier-picker";
import { AttrsEditor } from "./attrs-editor";
import { RoomsEditor } from "./rooms-editor";
import { ScrollArea } from "../ui/scroll-area";
import { CompanyDialog } from "@/components/contacts/company-dialog";
import { VariantsTab } from "./variants-tab";
import ModalReviewTab from "./modal-review-tab";

type Company = {
  id: string;
  name: string;
  email?: string | null;
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
  onSwitchVariant,
  onAddVariant,
  onUpdateVariant,
  onDeleteVariant,
  onEditVariant,
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
  onSwitchVariant: (variantId: string) => void;
  onAddVariant: () => void;
  onUpdateVariant: (variantId: string, patch: Partial<SpecVariant>) => void;
  onDeleteVariant: (variantId: string) => void;
  onEditVariant: (variantId: string) => void;
}) {
  const [tab, setTab] = useState("overview");
  const [localCompanies, setLocalCompanies] = useState<Company[]>(companies);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] flex-col bg-bg sm:max-w-170 p-0 gap-0">

        <DialogHeader className="sticky top-0 gap-2 border-b p-4">
          <DialogTitle className="truncate font-serif text-[16px] font-semibold leading-tight">
            {item.name || (
              <span className="text-fg-muted font-normal">
                Позиция не заполнена
              </span>
            )}
          </DialogTitle>

          {/* Строка 2: код, тип, статус */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-fg px-2 py-0.5 rounded-sm text-bg">
              <InlineCode
                code={item.code}
                locked={isLocked(item.status)}
                onCommit={onCode}
              />
            </div>
            <span className="font-mono uppercase text-fg-muted text-[11px]">
              {item.type}
              {item.product_type ? ` / ${item.product_type}` : ""}
            </span>
            <div className="ml-auto">
              <StatusMenu item={item} onChange={onStatus} />
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-2 gap-0">
          <TabsList className="w-full justify-start gap-2 overflow-x-auto bg-bg px-4">
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="variants">
              Варианты
              {(item.variants?.length ?? 0) > 1 && (
                <span className="ml-1.5 rounded-md bg-bg-select px-1.5 py-0.5 font-mono text-[10px]">
                  {item.variants?.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="attrs">Характеристики</TabsTrigger>
            <TabsTrigger value="rooms">
              Помещения {item.rooms.length > 0 && `· ${item.rooms.length}`}
            </TabsTrigger>
            <TabsTrigger value="supplier">Поставщик</TabsTrigger>
            <TabsTrigger value="files">Файлы</TabsTrigger>
          </TabsList>
          <ScrollArea className="h-[60vh]">
            {/* overview */}
            <TabsContent
              value="overview"
            >
              <ModalReviewTab
                item={item}
                onPatch={onPatch}
                onPrice={onPrice}
                onQty={onQty}
                orgSlug={orgSlug}
                setTab={setTab}
              />
            </TabsContent>
            {/* variants */}
            <TabsContent
              value="variants"
            >
              <VariantsTab
                item={item}
                onSwitch={onSwitchVariant}
                onAdd={onAddVariant}
                onEdit={onEditVariant}
                onDelete={onDeleteVariant}
              />
            </TabsContent>
            {/* attrs */}
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
            {/* rooms */}
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
            {/* supplier */}
            <TabsContent
              value="supplier"
              // className="flex flex-col gap-4 py-4 pl-4 pr-6"
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
            {/* files */}
            <TabsContent
              value="files"
              className="flex flex-col gap-4 py-4 pl-4 pr-6"
            >
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-muted py-12 text-center">
                <Paperclip className="size-8 text-fg-muted" />
                <p className="text-[14px] font-medium text-fg">
                  Файлы и документы
                </p>
                <p className="max-w-xs text-[12.5px] text-fg-muted">
                  Здесь будут счета, спецификации поставщика и другие вложения.
                  Функция в разработке.
                </p>
              </div>
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
