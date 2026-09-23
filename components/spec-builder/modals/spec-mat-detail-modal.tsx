"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Eraser,
  MoreVertical,
  Paperclip,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { InlineCode } from "../layout/inline-code";
import { StatusMenu } from "../layout/status-menu";
import { isLocked } from "@/lib/spec/status";
import { priceOf } from "@/lib/spec/pricing";
import { fmt, fmtQty, cn } from "@/lib/utils";
import { SpecStatus } from "@/lib/constants";
import { SpecItem, SpecItemPatch, SpecVariant } from "@/lib/types";
import { SupplierPicker } from "../layout/supplier-picker";
import { type CompanyOption } from "@/components/layout/company-picker";
import { RoomsEditor } from "../layout/rooms-editor";
import { ScrollArea } from "../../ui/scroll-area";
import { CompanyDialog } from "@/components/contacts/company-dialog";
import { VariantsTab } from "./variants-tab";
import ModalReviewTab from "./modal-review-tab";
import { SpecComponentsSection } from "./spec-components-section";
import { ServiceOperationDetailCards } from "../layout/service-operation-detail-cards";
import SaveIndicator from "../../layout/save-indicator";
import type { DetailPanelTab } from "@/hooks/use-spec-builder";
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
  onTabChange,
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
  initialTab?: DetailPanelTab;
  /** Смена вкладки: попадает в `?tab=` (переживает перезагрузку и «Назад»). */
  onTabChange?: (tab: DetailPanelTab) => void;
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
  /**
   * Куда вернуть результат создания: `onOpenCreate` из `CompanyPicker`.
   * Диалог живёт здесь (поверх модалки позиции), а назначение поставщика
   * остаётся делом `CompanyPicker` — поэтому сохранённую компанию отдаём ему
   * обратно, а не патчим позицию отсюда.
   */
  const [companyCreated, setCompanyCreated] = useState<{
    notify: (company: CompanyOption) => void;
  } | null>(null);

  /** Вкладка дублируется в `?tab=`: перезагрузка и «Назад» её сохраняют. */
  const changeTab = (value: string) => {
    setTab(value);
    onTabChange?.(value as DetailPanelTab);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 bg-bg p-0",
          "max-md:inset-0 max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-w-none",
          "max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:ring-0",
          "md:max-h-[90vh] sm:max-w-3xl",
        )}
      >
        <DialogHeader className="shrink-0 border-b p-4 max-md:py-2 max-md:pr-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                onClick={onClose}
                aria-label="Назад"
                className="-ml-2 size-11 shrink-0 md:hidden"
              >
                <ArrowLeft className="size-5" />
              </Button>
              <div className="shrink-0 rounded-sm bg-fg px-2 py-0.5 text-bg">
                <InlineCode
                  code={item.code}
                  locked={isLocked(item.status)}
                  onCommit={onCode}
                />
              </div>
              <DialogTitle className="min-w-0 truncate font-sans text-[16px] font-semibold leading-tight md:text-[18px]">
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
                className="hidden gap-2 text-fg-muted md:inline-flex"
              >
                <Share2 className="size-4" />
                {/* Поделиться */}
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <StatusMenu
                item={item}
                onChange={onStatus}
                className="max-md:hidden"
              />
              {/* Статус меняется точечным меню (подписи в 360px не хватает),
                  остальные действия уезжают в «⋮». */}
              <StatusMenu
                item={item}
                onChange={onStatus}
                variant="dot"
                className="size-11 md:hidden"
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Действия с позицией"
                  className="flex size-11 items-center justify-center rounded-lg text-fg-muted md:hidden"
                >
                  <MoreVertical className="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-bg-card">
                  <DropdownMenuItem
                    className="gap-2 text-[13px]"
                    onClick={onShare}
                  >
                    <Share2 className="size-4" /> Поделиться
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-[13px]"
                    onClick={onClear}
                  >
                    <Eraser className="size-4" /> Очистить
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-[13px] text-fg-red"
                    onClick={onDelete}
                  >
                    <Trash2 className="size-4" /> Удалить
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DialogClose
                render={
                  <Button variant="ghost" size="lg" className="max-md:hidden">
                    <X />
                  </Button>
                }
              />
            </div>
          </div>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={changeTab}
          className="mt-2 min-h-0 flex-1 gap-0 md:flex-none"
        >
          <TabsList className="w-full shrink-0 justify-start gap-2 overflow-x-auto bg-bg px-4 pb-2 //border-b">
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
            <TabsTrigger value="rooms">
              Помещения {item.rooms.length > 0 && `· ${item.rooms.length}`}
            </TabsTrigger>
            <TabsTrigger value="supplier">Поставщик</TabsTrigger>
            <TabsTrigger value="files">Файлы</TabsTrigger>
          </TabsList>
          {/* Высоту задаёт flex: на телефоне панель занимает весь экран, и
              жёсткие 66vh оставляли бы неиспользованную полосу снизу.
              `overscroll-contain` — чтобы прокрутка панели не тянула
              pull-to-refresh страницы под ней. */}
          <ScrollArea
            className="min-h-0 flex-1 md:h-[66vh] md:flex-none"
            viewportClassName="overscroll-contain"
          >
            {/* overview */}
            <TabsContent value="overview">
              <ModalReviewTab
                item={item}
                onPatch={onPatch}
                onPrice={onPrice}
                onQty={onQty}
                orgSlug={orgSlug}
                setTab={changeTab}
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
                onCompanyCreated={onCompanyCreated}
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
            {/* Характеристики редактируются внутри «Обзора» (ModalReviewTab):
                отдельная вкладка дублировала бы те же поля. */}
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
                orgSlug={orgSlug}
                companies={companies}
                contacts={contacts}
                companyId={item.companyId}
                contactId={item.contactId}
                snapshot={item.companyName}
                onChange={(companyId, contactId, companyName) =>
                  // companyName undefined — компания не найдена в локальном
                  // списке: снапшот не трогаем, id всё равно назначен.
                  onPatch(
                    companyName === undefined
                      ? { companyId, contactId }
                      : { companyId, contactId, companyName },
                  )
                }
                onCreateCompany={(name, onCreated) => {
                  setNewCompanyName(name);
                  setCompanyCreated({ notify: onCreated });
                  setShowAddCompany(true);
                }}
                onCompanyCreated={onCompanyCreated}
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

        <DialogFooter className="shrink-0 gap-2 border-t border-border-muted max-md:mb-0 max-md:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex min-w-0 items-center">
            <SaveIndicator status={saveStatus} error={saveError} />
          </div>

          {/* На телефоне «Очистить» и «Удалить» живут в меню «⋮» рядом с
              заголовком: в нижней строке 360px они конкурируют с индикатором
              сохранения, а деструктивное действие не должно стоять вплотную
              к основному. */}
          <Button
            variant="ghost"
            onClick={onClear}
            className="hidden gap-2 md:inline-flex"
          >
            <Eraser className="size-4" /> Очистить
          </Button>
          <Button
            variant="ghost"
            onClick={onDelete}
            className="ml-auto hidden gap-2 text-fg-red md:inline-flex"
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
            // Список компаний обновляет родитель панели, а назначение поставщика
            // делает `CompanyPicker`: он получает созданную запись через
            // `onCreated` и сам вызывает `pick` (`contactId` — null).
            onCompanyCreated(company);
            setShowAddCompany(false);
            companyCreated?.notify(company);
          }}
        />
      )}
    </Dialog>
  );
}
