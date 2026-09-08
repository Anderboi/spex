"use client";

import { useState } from "react";
import { Share2, Trash2, Eraser, Paperclip, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
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
import { priceOf } from "@/lib/spec/pricing";
import { fmt, fmtQty } from "@/lib/utils";
import { SpecStatus } from "@/lib/constants";
import { SpecItem, SpecItemPatch, SpecVariant } from "@/lib/types";
import { SupplierPicker } from "./supplier-picker";
import { AttrsEditor } from "./attrs-editor";
import { RoomsEditor } from "./rooms-editor";
import { ScrollArea } from "../ui/scroll-area";
import { CompanyDialog } from "@/components/contacts/company-dialog";
import { VariantsTab } from "./variants-tab";
import ModalReviewTab from "./modal-review-tab";
import { SpecComponentsSection } from "./spec-components-section";
import { ServiceOperationDetailCards } from "./service-operation-detail-cards";
import SaveIndicator from "../layout/save-indicator";
import type { DetailTab } from "@/hooks/use-spec-builder";
import type { ServiceOperation } from "@/actions/service-operations";

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
  childrenItems,
  onOpenItem,
  onOpenRefItem,
  allItems,
  companies,
  contacts,
  orgSlug,
  projectId,
  initialTab,
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
  onCompanyCreated,
  onSwitchVariant,
  onAddVariant,
  onUpdateVariant,
  onDeleteVariant,
  onEditVariant,
  saveStatus,
  saveError,
  ops,
  onOpenOperation,
}: {
  item: SpecItem;
  /** Непосредственные дети текущей позиции (для секции «Субэлементы»). */
  childrenItems: SpecItem[];
  /** Открыть детализацию другой позиции (ребёнка) через существующий механизм. */
  onOpenItem: (id: string) => void;
  /**
   * Открыть исходный SpecItem для строки kind = 'spec_ref' из «Состава».
   * Если не передан — используется onOpenItem.
   */
  onOpenRefItem?: (id: string) => void;
  /** Все позиции проекта — для ссылок на существующий SpecItem в «Составе». */
  allItems: SpecItem[];
  companies: Company[];
  contacts: Contact[];
  orgSlug: string;
  projectId: string;
  /** Вкладка при открытии (например, «Состав» после возврата из ссылки). */
  initialTab?: DetailTab;
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
  /** Добавляет компанию в единый локальный список основной панели. */
  onCompanyCreated: (company: Company) => void;
  onSwitchVariant: (variantId: string) => void;
  onAddVariant: () => void;
  onUpdateVariant: (variantId: string, patch: Partial<SpecVariant>) => void;
  onDeleteVariant: (variantId: string) => void;
  onEditVariant: (variantId: string) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  /** Операции доп. расходов («Монтаж»/«Доставка»), привязанные к позиции. */
  ops: ServiceOperation[];
  /** Открыть операцию в модалке редактирования (с возвратом в детализацию). */
  onOpenOperation: (operationId: string) => void;
}) {
  const [tab, setTab] = useState<string>(initialTab ?? "overview");
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90vh] flex-col bg-bg sm:max-w-3xl p-0 gap-0"
      >
        <DialogHeader className="border-b p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-fg px-2 py-0.5 rounded-sm text-bg">
                <InlineCode
                  code={item.code}
                  locked={isLocked(item.status)}
                  onCommit={onCode}
                />
              </div>
              <DialogTitle className="truncate font-sans text-[18px] font-semibold leading-tight">
                {item.name || (
                  <span className="text-fg-muted font-normal">
                    Позиция не заполнена
                  </span>
                )}
              </DialogTitle>
              <Button
                variant="ghost"
                size="lg"
                onClick={onShare}
                className="gap-2 text-fg-muted"
              >
                <Share2 className="size-4" />
                {/* Поделиться */}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <StatusMenu item={item} onChange={onStatus} />
              <DialogClose
                render={
                  <Button variant="ghost" size="lg">
                    <X />
                  </Button>
                }
              />
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-2 gap-0">
          <TabsList className="w-full justify-start gap-2 overflow-x-auto bg-bg px-4 pb-2 //border-b">
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="components">Состав</TabsTrigger>
            <TabsTrigger value="variants">
              Варианты
              {(item.variants?.length ?? 0) > 1 && (
                <span className="ml-1.5 rounded-md bg-bg-select px-1.5 py-0.5 font-mono text-[10px]">
                  {item.variants?.length}
                </span>
              )}
            </TabsTrigger>
            {/* <TabsTrigger value="attrs">Характеристики</TabsTrigger> */}
            <TabsTrigger value="rooms">
              Помещения {item.rooms.length > 0 && `· ${item.rooms.length}`}
            </TabsTrigger>
            <TabsTrigger value="supplier">Поставщик</TabsTrigger>
            <TabsTrigger value="files">Файлы</TabsTrigger>
          </TabsList>
          <ScrollArea className="h-[66vh]">
            {/* overview */}
            <TabsContent value="overview">
              <ModalReviewTab
                item={item}
                onPatch={onPatch}
                onPrice={onPrice}
                onQty={onQty}
                orgSlug={orgSlug}
                setTab={setTab}
              />

              <ServiceOperationDetailCards
                ops={ops}
                onOpenOperation={onOpenOperation}
              />

              {childrenItems.length > 0 && (
                <section className="border-t border-border-muted px-4 py-4">
                  <h4 className="text-[14px] font-bold text-fg">
                    Субэлементы · {childrenItems.length}
                  </h4>
                  <div className="mt-2 divide-y divide-border-muted">
                    {childrenItems.map((child) => {
                      const cp = priceOf(child);
                      return (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => onOpenItem(child.id)}
                          title={`Открыть карточку ${child.code || child.name}`}
                          className="grid w-full grid-cols-[52px_minmax(0,1fr)_88px] items-center gap-3 py-2.5 text-left transition-colors hover:bg-bg-select sm:grid-cols-[56px_minmax(0,1.6fr)_100px_110px]"
                        >
                          <span className="truncate font-mono text-[12px] font-medium text-fg-secondary">
                            {child.code || "—"}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-semibold">
                              {child.name || "Позиция не заполнена"}
                            </span>
                            {child.brand && (
                              <span className="block truncate font-mono text-[10.5px] text-fg-dim">
                                {child.brand}
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-[12px] text-fg-secondary tabular-nums">
                            {fmtQty(cp.qtyFinal)} {child.unit}
                          </span>
                          <span className="hidden text-right font-mono text-[14px] font-bold tabular-nums sm:block">
                            {cp.total > 0 ? `${fmt(cp.total)} ₽` : "—"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </TabsContent>
            {/* components (состав: spec_item_components, не строки таблицы) */}
            <TabsContent value="components">
              <SpecComponentsSection
                orgSlug={orgSlug}
                projectId={projectId}
                specItemId={item.id}
                companies={companies}
                contacts={contacts}
                specItems={allItems}
                onOpenRefItem={onOpenRefItem ?? onOpenItem}
              />
            </TabsContent>
            {/* variants */}
            <TabsContent value="variants">
              <VariantsTab
                item={item}
                onSwitch={onSwitchVariant}
                onAdd={onAddVariant}
                onEdit={onEditVariant}
                onDelete={onDeleteVariant}
              />
            </TabsContent>
            {/* attrs */}
            {/* <TabsContent
              value="attrs"
              className="flex flex-col gap-4 py-4 pl-4 pr-6"
            >
              <AttrsEditor
                type={item.type}
                attrs={item.attrs}
                onChange={(attrs) => onPatch({ attrs })}
              />
            </TabsContent> */}
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
                companies={companies}
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
          <div className="flex min-w-0 items-center">
            <SaveIndicator status={saveStatus} error={saveError} />
          </div>

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
            onCompanyCreated(company);
            onPatch({
              companyId: company.id,
              companyName: company.name,
              contactId: null,
              contactName: "",
            });
            setShowAddCompany(false);
          }}
        />
      )}
    </Dialog>
  );
}
