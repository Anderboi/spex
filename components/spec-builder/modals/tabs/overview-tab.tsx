"use client";

import { useMemo } from "react";
import { DoorOpen, Layers, Package, Plus, Truck } from "lucide-react";
import { fmt, fmtQty } from "@/lib/utils";
import QtyPriceBlock from "../../qty-price-block";
import { SpecItem, SpecItemPatch } from "@/lib/types";
import { priceOf } from "@/lib/spec/pricing";
import { ServiceOperationDetailCards } from "../../layout/service-operation-detail-cards";
import { ServiceOperation } from "@/actions/service-operations";
import { Button } from "@/components/ui/button";
import { OverviewSection } from "../../layout/overview-section";
import { ComponentsPreview } from "../../layout/components-preview";
import { RoomsEditor } from "../../layout/rooms-editor";
import { SupplierPicker } from "../../layout/supplier-picker";
import type { CompanyOption } from "@/components/layout/company-picker";
import type { DetailPanelTab } from "@/hooks/use-spec-builder";

interface Props {
  item: SpecItem;
  onQty: (delta: number) => void;
  onPrice: (raw: string) => void;
  onPatch: (patch: SpecItemPatch) => void;
  /**
   * Смена поставщика — отдельный канал, а не `onPatch`: блок «Поставка» меняет
   * компанию и менеджера одним доменом, и история должна записать одно событие
   * `supplier_changed`, а не по событию на поле.
   *
   * `companyName` — подсказка из пикера; `undefined` означает «имя неизвестно,
   * разреши на сервере».
   */
  onSupplierChange: (
    companyId: string | null,
    contactId: string | null,
    companyName?: string,
  ) => void;
  ops: ServiceOperation[];
  onOpenOperation: (operationId: string) => void;
  /** Создать свою услугу («Подъём на этаж», «Хранение на складе»). */
  onAddService?: () => void;
  childrenItems: SpecItem[];
  onOpenItem: (id: string) => void;
  /** Переход на вкладку модалки: «Открыть» у состава и вариантов. */
  onTabChange: (tab: DetailPanelTab) => void;
  orgSlug: string;
  projectId: string;
  /** Справочник поставщиков: блок «Поставка» ищет по нему компанию. */
  companies: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    address?: string | null;
    note?: string | null;
  }[];
  contacts: {
    id: string;
    name: string;
    company_id: string | null;
    phone?: string | null;
    email?: string | null;
  }[];
  projectRooms: string[];
  onSwitchVariant: (variantId: string) => void;
  onAddVariant: () => void;
  /** Открыть карточку создания компании (её рендерит родитель модалки). */
  onCreateCompany?: (
    name: string,
    onCreated: (company: CompanyOption) => void,
  ) => void;
  /** Компания создана — родитель кладёт её в свой список без перезагрузки. */
  onCompanyCreated?: (company: CompanyOption) => void;
  /** Менеджер создан или изменён — родитель обновляет список контактов. */
  onContactSaved?: (contact: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    company_id?: string | null;
  }) => void;
}

/**
 * Средний срок поставки в неделях. «В наличии» — 0, прочерк и пустое значение
 * — срок неизвестен, поэтому такие варианты в сравнении не участвуют.
 */
function leadWeeks(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  if (!t || t === "-") return null;
  if (t.includes("наличи")) return 0;
  const nums = [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) =>
    Number(m[0].replace(",", ".")),
  );
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const pluralRu = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/** Только число недель: для узких колонок сравнения сроков. */
const weekLabel = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");

/** «0,5 недели» / «2 недели» / «5 недель» — подпись срока целиком. */
const weekWord = (n: number) =>
  `${weekLabel(n)} ${pluralRu(Math.round(n), "неделя", "недели", "недель")}`;

const OverviewTab = ({
  item,
  onQty,
  onPrice,
  onPatch,
  onSupplierChange,
  ops,
  onOpenOperation,
  onAddService,
  childrenItems,
  onOpenItem,
  onTabChange,
  orgSlug,
  projectId,
  companies,
  contacts,
  projectRooms,
  onSwitchVariant,
  onAddVariant,
  onCreateCompany,
  onCompanyCreated,
  onContactSaved,
}: Props) => {
  const supplier = companies.find((c) => c.id === item.companyId) ?? null;
  /**
   * Подпись поставщика в сводке: имя компании из справочника, а если её там
   * нет — снапшот позиции (так было и на вкладке «Поставка»).
   */
  const supplierName = item.companyName || supplier?.name || "";

  const variants = useMemo(
    () => [...(item.variants ?? [])].sort((a, b) => a.position - b.position),
    [item.variants],
  );
  const activeVariant = variants.find((v) => v.isActive) ?? null;

  /** Самый короткий срок и самая низкая цена — базы для сравнения. */
  const minLead = useMemo(() => {
    const known = variants
      .map((v) => leadWeeks(v.leadTime || item.leadTime))
      .filter((w): w is number => w !== null);
    return known.length > 0 ? Math.min(...known) : null;
  }, [variants, item.leadTime]);

  const minPrice = useMemo(
    () =>
      variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : null,
    [variants],
  );

  /**
   * Цена, с которой сравниваем стоимость вариантов: у активного варианта
   * базовая цена позиции уже подменена его ценой, поэтому активный вариант и
   * есть точка отсчёта — как в списке вариантов на отдельной вкладке.
   */
  const priceBase = activeVariant?.price ?? item.price;

  const rooms = item.rooms ?? [];
  /**
   * Срок поставки показываем по активному варианту — он и уезжает в
   * спецификацию, — а в блоке поставки правим срок самой позиции: у варианта
   * он свой и меняется в его карточке.
   */
  const rawLead = (activeVariant?.leadTime || item.leadTime || "").trim();
  const leadTime = rawLead === "-" ? "" : rawLead;
  const itemLeadTime = (item.leadTime || "").trim() || "-";

  /** Действие блока: переход на соответствующую вкладку модалки. */
  const openTab = (tab: DetailPanelTab, label = "Открыть") => (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onTabChange(tab)}
      className="shrink-0 gap-1 px-2 text-[12.5px] font-medium text-fg-brand hover:underline"
    >
      {label}
    </Button>
  );

  /** Срок варианта с подстановкой срока позиции и прочерком вместо пустоты. */
  const variantLead = (v: (typeof variants)[number]) => {
    const raw = (v.leadTime || item.leadTime || "").trim();
    return raw && raw !== "-" ? raw : "срок не указан";
  };

  return (
    <section className="flex flex-col gap-3 py-2">
      <QtyPriceBlock
        item={item}
        onQty={onQty}
        onPrice={onPrice}
        onPatch={onPatch}
      />

      {/* ── Поставка: поставщик, менеджер и срок — всё правится здесь же.
             Отдельной вкладки «Поставка» нет: блок уже раскрывается, а переход
             на другую вкладку ради двух полей — лишний шаг. ── */}
      <OverviewSection
        icon={Truck}
        title="Поставка"
        summary={
          supplierName || item.contactName || leadTime ? (
            <>
              {supplierName && (
                <span className="font-semibold text-fg-secondary">
                  {supplierName}
                </span>
              )}
              {item.contactName && ` · ${item.contactName}`}
              {supplierName && leadTime && " · "}
              {leadTime && <span className="font-mono">{leadTime}</span>}
            </>
          ) : (
            <span className="text-fg-dim">
              Поставщик не указан — выберите его здесь
            </span>
          )
        }
      >
        <SupplierPicker
          orgSlug={orgSlug}
          companies={companies}
          contacts={contacts}
          companyId={item.companyId}
          contactId={item.contactId}
          snapshot={item.companyName}
          leadTime={itemLeadTime}
          onChange={(companyId, contactId, companyName) =>
            // companyName undefined — компания не найдена в локальном списке:
            // снапшот не трогаем, id всё равно назначен.
            onSupplierChange(companyId, contactId, companyName)
          }
          onChangeLeadTime={(next) => onPatch({ leadTime: next })}
          onCreateCompany={onCreateCompany}
          onCompanyCreated={onCompanyCreated}
          onContactSaved={onContactSaved}
        />
      </OverviewSection>

      {/* ── Помещения: список и добавление прямо в обзоре ────────────── */}
      <OverviewSection
        icon={DoorOpen}
        title="Помещения"
        summary={
          rooms.length > 0 ? (
            <>
              <span className="font-semibold text-fg-secondary">
                {rooms.length}
              </span>
              {` · ${rooms.join(", ")}`}
            </>
          ) : (
            <span className="text-fg-dim">
              Помещения не указаны — без них материал не посчитать по комнатам
            </span>
          )
        }
      >
        <RoomsEditor
          rooms={rooms}
          onChange={(next) => onPatch({ rooms: next })}
          suggestions={projectRooms}
        />
      </OverviewSection>

      {/* ── Варианты замены: сравнение цены и срока ─────────────────── */}
      {variants.length > 0 && (
        <OverviewSection
          icon={Layers}
          title="Варианты"
          summary={
            <>
              <span className="font-semibold text-fg-secondary">
                {variants.length}
              </span>
              {` ${pluralRu(variants.length, "вариант", "варианта", "вариантов")}`}
              {activeVariant && ` · активен «${activeVariant.name}»`}
              {minPrice !== null && ` · от ${fmt(minPrice)} ₽`}
              {minLead !== null && ` · от ${weekWord(minLead)}`}
            </>
          }
          // action={openTab("variants")}
        >
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-fg-muted">
              Клик по строке делает вариант активным — он попадает в
              спецификацию и экспорты.
            </p>

            <div className="divide-y divide-border-muted">
              {variants.map((v) => {
                const weeks = leadWeeks(v.leadTime || item.leadTime);
                const fastest = weeks !== null && weeks === minLead;
                const leadDelta =
                  weeks !== null && minLead !== null ? weeks - minLead : null;
                const cheapest = minPrice !== null && v.price === minPrice;
                const priceDelta = Math.round(v.price - priceBase);

                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => !v.isActive && onSwitchVariant(v.id)}
                    aria-pressed={v.isActive}
                    className={
                      "flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors " +
                      (v.isActive
                        ? "rounded-lg bg-bg-selected"
                        : "cursor-pointer hover:bg-bg-select")
                    }
                  >
                    <span
                      aria-hidden
                      className={
                        "size-2 shrink-0 rounded-full " +
                        (v.isActive ? "bg-fg-green" : "bg-border-dash-dots")
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-fg">
                        {v.name || "Вариант без названия"}
                      </span>
                      {v.brand && (
                        <span className="block truncate font-mono text-[11px] text-fg-dim">
                          {v.brand}
                        </span>
                      )}
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-[13.5px] font-semibold tabular-nums text-fg">
                        {fmt(v.price)} ₽
                      </span>
                      <span className="block whitespace-nowrap font-mono text-[11px] tabular-nums text-fg-muted">
                        {variantLead(v)}
                      </span>
                    </span>

                    {/* Сравнение ведём от активного варианта: он и есть то,
                        что сейчас стоит в спецификации. По цене активному
                        строку не подписываем — там база, сравнивать не с чем. */}
                    <span className="flex w-24 shrink-0 flex-col items-end gap-0.5 font-mono text-[11px] tabular-nums">
                      {v.isActive ? (
                        <span className="text-fg-dim">активный</span>
                      ) : priceDelta === 0 ? (
                        <span className="text-fg-dim">та же цена</span>
                      ) : (
                        <span
                          className={
                            priceDelta < 0 ? "text-fg-green" : "text-fg-red"
                          }
                        >
                          {priceDelta < 0 ? "−" : "+"}
                          {fmt(Math.abs(priceDelta))} ₽
                        </span>
                      )}

                      {leadDelta !== null && (
                        <span
                          className={
                            fastest ? "text-fg-green" : "text-fg-muted"
                          }
                        >
                          {fastest
                            ? "быстрее"
                            : `+${weekLabel(leadDelta)} нед.`}
                        </span>
                      )}
                      {leadDelta === null && cheapest && (
                        <span className="text-fg-green">дешевле всех</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeVariant && variants.length > 1 && (
              <p className="text-[11.5px] text-fg-muted">
                Сравнение — с активным вариантом
                {minPrice !== null && (
                  <>
                    {" · "}
                    <span className="font-mono tabular-nums">
                      дешевле всех {fmt(minPrice)} ₽
                    </span>
                  </>
                )}
                {minLead !== null && (
                  <>
                    {" · "}
                    <span className="font-mono">
                      быстрее всех {weekWord(minLead)}
                    </span>
                  </>
                )}
              </p>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={onAddVariant}
              className="mt-1 gap-1.5 self-start"
            >
              <Plus className="size-3.5" /> Добавить вариант
            </Button>
          </div>
        </OverviewSection>
      )}

      {/* ── Состав: только чтение, правка — на вкладке «Состав» ─────── */}
      <OverviewSection
        icon={Package}
        title="Состав"
        summary="Компоненты, группы и ссылки на позиции"
        action={openTab("components")}
      >
        <ComponentsPreview
          orgSlug={orgSlug}
          projectId={projectId}
          specItemId={item.id}
        />
      </OverviewSection>

      {/* ── Услуги: доставка, монтаж и свои услуги. Строки компактные, а
             «Добавить услугу» создаёт свою и сразу привязывает её к позиции ── */}
      <ServiceOperationDetailCards
        ops={ops}
        onOpenOperation={onOpenOperation}
        onAddService={onAddService}
      />

      {/* ── Субэлементы остаются в конце: это переходы по дереву ───── */}
      {childrenItems.length > 0 && (
        <article className="border-t border-border-muted py-4">
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
        </article>
      )}
    </section>
  );
};

export default OverviewTab;
