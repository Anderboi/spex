"use client";

import { memo } from "react";
import { Copy, Eraser, MoreHorizontal, Plus, Share2, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineCode } from "./inline-code";
import { StatusMenu } from "./status-menu";
import { isLocked } from "@/lib/spec/status";
import { fmt, fmtQty } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { SpecStatus } from "@/lib/constants";
import { SpecItem } from "@/lib/types";
import { PriceField } from "./price-field";
import { QtyStepper } from "./qty-stepper";
import { priceOf } from "@/lib/spec/pricing";
import Image from "next/image";
import { VariantSwitcher } from './variant-switcher';
import { ParentSubMenu } from './parent-submenu';
import { DraftNameField } from '../layout/draft-name-field';
import { ServiceOperationBadges } from './service-operation-badges';
import type { ServiceOperation } from "@/actions/service-operations";

export type SpecRowHandlers = {
  onOpen: (id: string) => void;
  onCode: (id: string, code: string) => void;
  onQty: (id: string, delta: number) => void;
  onPrice: (id: string, value: string) => void;
  onStatus: (id: string, s: SpecStatus) => void;
  onToggleSel: (id: string) => void;
  onToggleSelGroup: (ids: string[]) => void;
  onDuplicate: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onClear: (id: string) => void;
  onDelete: (id: string) => void;
  onShare: (item: SpecItem) => void;
  onSetParent: (id: string, parentId: string | null) => void;
  onFill: (id: string) => void;
  onSwitchVariant: (id: string, variantId: string) => void;
  onAddVariant: (id: string) => void;
  onDraftName: (id: string, name: string) => void;
  onEditOperation: (operationId: string) => void;
};

export const SpecRow = memo(function SpecRow({
  item,
  allItems,
  selected,
  ops,
  h,
}: {
  item: SpecItem;
  allItems: SpecItem[];
  selected: boolean;
  /** Операции доп. расходов, связанные с этой позицией. */
  ops?: ServiceOperation[];
  h: SpecRowHandlers;
}) {
  const p = priceOf(item);

  return (
    <tr
      className={cn(
        "group h-16 border-b border-border-muted last:border-0 transition-colors hover:bg-bg-card/60",
        selected && "bg-bg-brand/40",
        item.isPlaceholder &&
          "bg-[repeating-linear-gradient(45deg,transparent,transparent_7px,var(--color-bg-card)_7px,var(--color-bg-card)_14px)]",
      )}
    >
      <td className="align-middle">
        <Checkbox
          className="border-border border-2"
          checked={selected}
          onCheckedChange={() => h.onToggleSel(item.id)}
          aria-label={`Выбрать ${item.code}`}
        />
      </td>
      <td className="p-2 align-middle">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            height={64}
            width={64}
            className="size-16 object-cover border rounded-lg"
          />
        ) : (
          <div className="size-16 bg-bg-brand2/50 border rounded-lg"></div>
        )}
      </td>
      <td className="px-2 align-middle">
        <InlineCode
          code={item.code}
          locked={isLocked(item.status)}
          onCommit={(c) => h.onCode(item.id, c)}
        />
      </td>
      <td className="min-w-0 px-2 align-middle">
        <div className="flex min-h-9 flex-col justify-center gap-0.5">
          {item.isPlaceholder ? (
            <>
              <DraftNameField
                value={item.name}
                onCommit={(name) => h.onDraftName(item.id, name)}
              />
              <button
                type="button"
                onClick={() => h.onFill(item.id)}
                className="text-left text-[12.5px] cursor-pointer text-fg-muted hover:text-fg-brand hover:underline"
              >
                Выбрать материал из библиотеки
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => h.onOpen(item.id)}
              className="block max-w-full text-left cursor-pointer"
            >
              <span className="block truncate text-[14px] font-medium text-fg hover:underline">
                {item.name}
              </span>
              <span className="block truncate text-[12.5px] text-fg-muted">
                {[item.brand, item.spec].filter(Boolean).join(" · ") || "—"}
              </span>
            </button>
          )}
          {!item.isPlaceholder && (item.variants?.length ?? 0) > 1 && (
            <VariantSwitcher
              item={item}
              onSwitch={(vid) => h.onSwitchVariant(item.id, vid)}
              onAdd={() => h.onAddVariant(item.id)}
              onOpenVariants={() => h.onOpen(item.id)}
            />
          )}
        </div>
      </td>
      <td className="px-2 text-left align-middle">
        <div className="flex min-h-9 flex-col justify-center gap-1">
          {ops && ops.length > 0 ? (
            <ServiceOperationBadges ops={ops} onOpen={h.onEditOperation} />
          ) : (
            <span className="text-[13px] text-fg-muted">—</span>
          )}
        </div>
      </td>
      <td className="px-2 text-right align-middle">
        <div className="flex min-h-9 flex-col items-end justify-center leading-tight">
          <QtyStepper
            qty={item.qty}
            unit={item.unit}
            editable
            onChange={(d) => h.onQty(item.id, d)}
          />
          {p.hasQtyMod && (
            <span
              className="mt-0.5 font-mono text-[10.5px] text-fg-dim"
              title={`По плану ${fmtQty(p.qtyBase)} ${item.unit}, запас ${item.stockPct}% (+${fmtQty(p.stockQty)})`}
            >
              {fmtQty(p.qtyBase)} +{item.stockPct}%
            </span>
          )}
        </div>
      </td>
      <td className="px-2 text-left align-middle">
        <div className="flex min-h-9 flex-col items-start justify-center leading-tight">
          {/* Редактируется и показывается базовая цена; со скидкой
              справа-под ней — итоговая цена за единицу из priceOf(). */}
          <PriceField
            value={p.priceBase}
            readOnly={p.hasPriceMod}
            onCommit={(v) => h.onPrice(item.id, v)}
          />
          {p.hasPriceMod && (
            <span
              className="mt-0.5 font-mono text-[10.5px] text-fg-dim"
              title={`Базовая ${fmt(p.priceBase)} ₽, скидка ${item.clientDiscountPct}% (−${fmt(p.discountAmount)} ₽)`}
            >
              {fmt(p.priceFinal)} ₽ (−{item.clientDiscountPct}%)
            </span>
          )}
        </div>
      </td>
      <td className="px-2 text-right align-middle">
        <span className="font-mono text-[14px] font-semibold tabular-nums">
          {p.total > 0 ? `${fmt(p.total)} ₽` : "—"}
        </span>
      </td>

      <td className="px-2 align-middle">
        <StatusMenu className='w-full justify-between' item={item} onChange={(s) => h.onStatus(item.id, s)} />
      </td>
      <td className="px-2 align-middle">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Действия для ${item.code}`}
            className="flex size-8 items-center justify-center rounded-md text-fg-muted opacity-0 transition-opacity hover:bg-bg-select group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 bg-bg-card">
            <DropdownMenuItem
              onClick={() => h.onOpen(item.id)}
              className="text-[13px]"
            >
              Открыть карточку
            </DropdownMenuItem>
            <ParentSubMenu
              item={item}
              allItems={allItems}
              onSetParent={(parentId) => h.onSetParent(item.id, parentId)}
            />
            <DropdownMenuItem
              onClick={() => h.onAddChild(item.id)}
              className="gap-2 text-[13px]"
            >
              <Plus className="size-3.5" /> Добавить субэлемент
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => h.onDuplicate(item.id)}
              className="gap-2 text-[13px]"
            >
              <Copy className="size-3.5" /> Дублировать
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => h.onShare(item)}
              className="gap-2 text-[13px]"
            >
              <Share2 className="size-3.5" /> Поделиться
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => h.onClear(item.id)}
              className="gap-2 text-[13px]"
            >
              <Eraser className="size-3.5" /> Очистить, оставив марку
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => h.onDelete(item.id)}
              className="gap-2 text-[13px] text-fg-red"
            >
              <Trash2 className="size-3.5" /> Удалить позицию
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
});
