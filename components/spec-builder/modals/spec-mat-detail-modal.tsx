"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { SpecStatus } from "@/lib/constants";
import { SpecItem, SpecItemPatch, SpecVariant } from "@/lib/types";
import { type CompanyOption } from "@/components/layout/company-picker";
import { ScrollArea } from "../../ui/scroll-area";
import { CompanyDialog } from "@/components/contacts/company-dialog";
import { SpecComponentsSection } from "./spec-components-section";
import type { DetailPanelTab } from "@/hooks/use-spec-builder";
import type { ServiceOperation } from "@/actions/service-operations";
import ModalDetailsTab from "./tabs/modal-details-tab";
import OverviewTab from "./tabs/overview-tab";
import CommentsTab from "./tabs/comments-tab";
import DetailsHeader from "./details-header";
import FilesTab from "./tabs/files-tab";

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

/**
 * Вкладка с собственным вертикальным скроллом: `TabsContent` растягивается на
 * высоту контентной области, `ScrollArea` забирает остаток. Общего `ScrollArea`
 * вокруг всех вкладок больше нет — «Комментарии» получают собственный
 * скролл-контейнер.
 */
function ScrollableTab({
  value,
  className,
  onViewportScroll,
  children,
}: {
  value: string;
  className?: string;
  /** Прокрутка именно этой вкладки управляет сворачиванием `DetailsHeader`. */
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <TabsContent
      value={value}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <ScrollArea
        className={cn("h-full min-h-0 px-4", className)}
        viewportClassName="overscroll-contain"
        onViewportScroll={onViewportScroll}
      >
        {children}
      </ScrollArea>
    </TabsContent>
  );
}

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
  onSupplierChange,
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
  onAddService,
  onContactSaved,
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
  /**
   * Смена поставщика (компания + менеджер) — один домен: событие истории у
   * него одно, поэтому канал отдельный от `onPatch`.
   */
  onSupplierChange: (
    companyId: string | null,
    contactId: string | null,
    companyName?: string,
  ) => void;
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
  /**
   * Операции доп. расходов, привязанные к позиции: «Доставка», «Монтаж» и свои
   * услуги.
   */
  ops: ServiceOperation[];
  /** Открыть операцию в модалке редактирования (с возвратом в детализацию). */
  onOpenOperation: (operationId: string) => void;
  /** Создать свою услугу («Подъём на этаж») из блока услуг «Обзора». */
  onAddService?: () => void;
  /** Менеджер создан или изменён — родитель обновляет список контактов. */
  onContactSaved?: (contact: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    company_id?: string | null;
  }) => void;
}) {
  const [tab, setTab] = useState<string>(initialTab ?? "overview");
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);

  const [companyCreated, setCompanyCreated] = useState<{
    notify: (company: CompanyOption) => void;
  } | null>(null);

  const changeTab = (value: string) => {
    setTab(value);
    onTabChange?.(value as DetailPanelTab);
  };

  const handleContentScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const collapsed = event.currentTarget.scrollTop > 32;

    setIsHeaderCollapsed((current) =>
      current === collapsed ? current : collapsed,
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 bg-bg p-0",
          // Высота попапа фиксирована по высоте экрана: без этого она следовала
          // за контентом активной вкладки и скакала при переключении. `h-dvh` на
          // мобильном, `h-[90vh]` на десктопе — потолок `max-h` из базы.
          "max-md:inset-0 max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-w-none",
          "max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:ring-0",
          "md:h-[90vh] md:max-h-[90vh] sm:max-w-3xl",
        )}
      >
        <DetailsHeader
          item={item}
          onPatch={onPatch}
          onCode={onCode}
          orgSlug={orgSlug}
          onStatus={onStatus}
          onDelete={onDelete}
          onClear={onClear}
          onShare={onShare}
          saveStatus={saveStatus}
          saveError={saveError}
          isCollapsed={isHeaderCollapsed}
        />

        {/* Контентная область получает определённую высоту от попапа: растёт как
            `flex-1`, но и сжимается (`min-h-0`) — иначе вкладка выше доступного
            места растягивала бы `Tabs` и обрезалась бы без возможности
            прокрутки. Сам скролл живёт во вкладках, `Tabs` только клипает. */}
        <Tabs
          value={tab}
          onValueChange={changeTab}
          className="h-full min-h-0 flex-1 gap-0 overflow-hidden"
        >
          <TabsList
            variant="line"
            className="w-full shrink-0 justify-start overflow-x-auto border-b border-border-muted"
          >
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="parameters">Параметры</TabsTrigger>
            <TabsTrigger value="components">Состав</TabsTrigger>
            <TabsTrigger value="files">Файлы</TabsTrigger>
            <TabsTrigger value="comments">Комментарии</TabsTrigger>
          </TabsList>
          {/* У каждой вкладки собственный скролл: `comments` не вложена в общий
              `ScrollArea`, чтобы внутри неё встал `MessageScroller`. */}
          <ScrollableTab
            value="overview"
            className="md:h-[70svh] md:flex-none"
            onViewportScroll={handleContentScroll}
          >
            <OverviewTab
              item={item}
              onQty={onQty}
              onPrice={onPrice}
              onPatch={onPatch}
              onOpenItem={onOpenItem}
              childrenItems={childrenItems}
              onOpenOperation={onOpenOperation}
              ops={ops}
              onAddService={onAddService}
              // «Открыть» у блоков обзора ведёт на вкладку: состояние живёт
              // там же, где правка, а `?tab=` переживает перезагрузку.
              onTabChange={changeTab}
              orgSlug={orgSlug}
              projectId={projectId}
              companies={companies}
              contacts={contacts}
              projectRooms={projectRooms}
              onSupplierChange={onSupplierChange}
              onSwitchVariant={onSwitchVariant}
              onAddVariant={onAddVariant}
              // Компанию создаёт родитель модалки: он же держит единый список
              // компаний, поэтому новая запись сразу видна в подписи блока.
              onCreateCompany={(name, onCreated) => {
                setNewCompanyName(name);
                setCompanyCreated({ notify: onCreated });
                setShowAddCompany(true);
              }}
              onCompanyCreated={onCompanyCreated}
              onContactSaved={onContactSaved}
            />
          </ScrollableTab>
          {/* parameters */}
          <ScrollableTab
            value="parameters"
            onViewportScroll={handleContentScroll}
          >
            <ModalDetailsTab item={item} onPatch={onPatch} />
          </ScrollableTab>
          {/* components (состав: spec_item_components, не строки таблицы) */}
          <ScrollableTab
            value="components"
            onViewportScroll={handleContentScroll}
          >
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
          </ScrollableTab>
          {/* comments: flex-контейнер под будущий MessageScroller, своего
              `ScrollArea` здесь быть не должно */}
          <TabsContent
            value="comments"
            className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden"
          >
            <CommentsTab />
          </TabsContent>
          {/* supplier — вкладки нет: поставщик, менеджер и срок поставки
              правятся прямо в раскрытом блоке «Поставка» вкладки «Обзор». */}
          {/* files */}
          <ScrollableTab value="files" onViewportScroll={handleContentScroll}>
            <FilesTab />
          </ScrollableTab>
        </Tabs>
      </DialogContent>
      {showAddCompany && (
        <CompanyDialog
          orgSlug={orgSlug}
          open={showAddCompany}
          initialName={newCompanyName}
          onClose={() => setShowAddCompany(false)}
          onSuccess={(company) => {
            onCompanyCreated(company);
            setShowAddCompany(false);
            companyCreated?.notify(company);
          }}
        />
      )}
    </Dialog>
  );
}
