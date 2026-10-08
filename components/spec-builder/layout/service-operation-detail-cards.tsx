"use client";

import { Building2, Clock } from "lucide-react";
import {
  operationLabel,
  type ServiceOperationType,
} from "@/lib/constants";
import { fmt, plural } from "@/lib/utils";
import { serviceOperationDeadline } from "@/lib/spec/service-operation-deadline";
import {
  describeLinkedItems,
  linkedItemIndex,
  type LinkedItemRef,
  type ServiceTargetItem,
} from "@/lib/spec/service-catalog";
import type { ServiceOperation } from "@/actions/service-operations";
import ModalBlockLabel from "@/components/layout/modal-block-label";
import { AddServiceCombobox } from "./add-service-combobox";
import { SERVICE_OPERATION_ICON } from "./service-operation-icons";

/**
 * Строка услуги в блоке «Обзор». Высота фиксирована (h-11), поэтому список
 * читается как таблица и не «прыгает» при появлении срока или подрядчика.
 * Операция всегда открывается целиком в своей модалке: здесь только состояние.
 */
function ServiceRow({
  op,
  itemIndex,
  onOpen,
}: {
  op: ServiceOperation;
  /** Позиции проекта по id — для подсказки «к каким материалам относится». */
  itemIndex: Map<string, LinkedItemRef>;
  onOpen: (operationId: string) => void;
}) {
  const Icon = SERVICE_OPERATION_ICON[op.type];
  const label = operationLabel(op);
  /**
   * Сколько ЕЩЁ материалов покрывает операция. Сумма у операции одна на все её
   * позиции, поэтому рядом с ней стоит число соседей: иначе 40 000 ₽ выглядели
   * бы расходом этой позиции.
   */
  const otherItems = op.spec_item_ids.length - 1;
  /**
   * Срок — «сегодня», «просрочено N дн.» или «через N дн.». У исполненной
   * операции состояния нет: плановая дата перестала быть дедлайном.
   */
  const deadline = serviceOperationDeadline(op);
  /**
   * В подсказке — полный список позиций операции: сумма общая на все её
   * позиции, и видно, на какие именно.
   */
  const linked = describeLinkedItems(
    op.spec_item_ids,
    itemIndex,
    Number.MAX_SAFE_INTEGER,
  );
  const title = linked.full
    ? `Открыть «${label}»\nПозиции операции:\n${linked.full}`
    : `Открыть «${label}»`;

  return (
    <button
      type="button"
      onClick={() => onOpen(op.id)}
      title={title}
      className="flex h-11 w-full items-center gap-2.5 px-2 text-left transition-colors hover:bg-bg-card2"
    >
      <Icon className="size-3.5 shrink-0 text-fg-muted" />

      <span className="min-w-0 truncate text-[13px] font-medium text-fg">
        {label}
      </span>

      {/* «Исполнено» есть у всех типов: закрыть работу можно и у монтажа, и у
          своей услуги. У доставки отметка вдобавок переводит связанные
          материалы в «Доставлено». */}
      <span
        className={
          "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] " +
          (op.completed
            ? "bg-bg-green-light text-fg-green"
            : "bg-bg-card2 text-fg-dim")
        }
      >
        {op.completed ? "исполнена" : "не исполнена"}
      </span>

      {/* Срок и подрядчик — только когда они есть: пустые подписи в строке
          не нужны, а отсутствие даты и так видно по модалке. */}
      {deadline && (
        <span
          className={
            "hidden shrink-0 items-center gap-1 font-mono text-[11.5px] sm:flex " +
            (deadline.overdue ? "text-fg-red" : "text-fg-muted")
          }
        >
          <Clock className="size-3" />
          {deadline.text}
        </span>
      )}
      {op.contractor_name && (
        <span className="hidden min-w-0 max-w-[38%] shrink-0 items-center gap-1 text-[11.5px] text-fg-muted sm:flex">
          <Building2 className="size-3 shrink-0" />
          <span className="truncate">{op.contractor_name}</span>
        </span>
      )}

      {/* Пометка общности есть и на узком экране — коротким «ещё 19»: именно
          там сумма операции и читается как расход этой позиции. */}
      {otherItems > 0 && (
        <>
          <span className="shrink-0 text-[11px] text-fg-dim sm:hidden">
            ещё {otherItems}
          </span>
          <span className="hidden shrink-0 text-[11px] text-fg-dim sm:inline">
            ещё {otherItems}{" "}
            {plural(otherItems, "материал", "материала", "материалов")}
          </span>
        </>
      )}

      <span className="ml-auto shrink-0 font-mono text-[13px] font-semibold tabular-nums text-fg">
        {fmt(op.amount)} ₽
      </span>
    </button>
  );
}

/**
 * Услуги позиции: «Доставка», «Монтаж» и свои услуги. Строки компактные —
 * состояние читается в одну строку, а вся правка живёт в модалке операции.
 *
 * Добавление услуги идёт через Createable Combobox (`AddServiceCombobox`):
 * существующие услуги проекта выбираются из списка, новые создаются из того же
 * списка. Рядом с ним — кнопки быстрого добавления «Доставка» и «Монтаж»: это
 * самые частые услуги, и ради них не нужно открывать список. Кнопки живут в
 * самом combobox, потому что им нужны его состояние и данные каталога.
 */
export function ServiceOperationDetailCards({
  item,
  allItems,
  ops,
  onOpenOperation,
  serviceCatalog,
  onAddExistingService,
  onCreateService,
  onRetryServiceCatalog,
  serviceCatalogError,
  serviceCatalogLoading,
}: {
  /**
   * Позиция карточки: подпись для строки списка и правила статуса для кнопок
   * быстрого добавления.
   */
  item: ServiceTargetItem;
  /** Все позиции проекта: по ним видно, какие материалы уже в каждой услуге. */
  allItems: readonly LinkedItemRef[];
  /** Операции, привязанные к текущей позиции. */
  ops: ServiceOperation[];
  /** Открыть операцию в существующей модалке редактирования. */
  onOpenOperation: (operationId: string) => void;
  /** Все услуги проекта — источник списка combobox. */
  serviceCatalog: ServiceOperation[];
  /** Привязать существующую услугу к позиции (`false` — ошибка уже показана). */
  onAddExistingService: (operation: ServiceOperation) => Promise<boolean>;
  /**
   * Создать новую услугу: тип приходит из команды списка («Создать доставку»,
   * «Создать монтаж», «Создать «…»») или от кнопки быстрого добавления,
   * название — из набранного текста. Форму открывает вызывающий, операция
   * появляется по её сохранению.
   */
  onCreateService: (type: ServiceOperationType, name: string | null) => void;
  /** Повторить загрузку списка услуг после ошибки. */
  onRetryServiceCatalog: () => void;
  /** Список услуг проекта не загрузился. */
  serviceCatalogError: string | null;
  /** Список услуг проекта ещё грузится. */
  serviceCatalogLoading: boolean;
}) {
  const byType = (type: ServiceOperationType) =>
    ops.find((o) => o.type === type);
  // Своих услуг может быть несколько — показываем все.
  const own = ops.filter((o) => o.type === "service");
  const fixed = [byType("delivery"), byType("installation")].filter(
    (o): o is ServiceOperation => o !== undefined,
  );
  /** Позиции по id: строки услуг называют свои позиции в подсказке. */
  const itemIndex = linkedItemIndex(allItems);

  return (
    <section className="border-t border-border-muted pt-4">
      {/* Итога услуг здесь нет намеренно: сумма операции общая на все её
          позиции, и в карточке одного материала она читалась бы как его
          расход. Смета услуг живёт в «Расходах проекта» и в сводке. */}
      <ModalBlockLabel>Услуги</ModalBlockLabel>

      {ops.length === 0 && (
        <p className="mt-2 rounded-xl border border-dashed border-border-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-muted">
          Услуг по позиции нет. Доставка и монтаж добавляются одной кнопкой —
          материал войдёт в услугу проекта; свои услуги выбираются из списка или
          создаются в нём.
        </p>
      )}

      {ops.length > 0 && (
        <div className="mt-2 divide-y divide-border-muted overflow-hidden rounded-xl border border-border-muted bg-bg-card">
          {fixed.map((op) => (
            <ServiceRow
              key={op.id}
              op={op}
              itemIndex={itemIndex}
              onOpen={onOpenOperation}
            />
          ))}
          {own.map((op) => (
            <ServiceRow
              key={op.id}
              op={op}
              itemIndex={itemIndex}
              onOpen={onOpenOperation}
            />
          ))}
        </div>
      )}

      <AddServiceCombobox
        item={item}
        items={allItems}
        catalog={serviceCatalog}
        onAddExistingService={onAddExistingService}
        onCreateService={onCreateService}
        onRetryCatalog={onRetryServiceCatalog}
        catalogError={serviceCatalogError}
        loading={serviceCatalogLoading}
      />
    </section>
  );
}
