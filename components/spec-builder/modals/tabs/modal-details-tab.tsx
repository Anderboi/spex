"use client";

import Field from "../../../layout/modal-field";
import { LEAD_TIME_OPTIONS } from "@/lib/constants";
import { Input } from "../../../ui/input";
import { ExternalLink } from "lucide-react";
import { SpecItem, SpecItemPatch } from "@/lib/types";
import { AttrsEditor } from "@/components/layout/attrs-editor";
import { MaterialTypePicker } from "@/components/layout/material-type-picker";
import { Separator } from "../../../ui/separator";

const ModalDetailsTab = ({
  item,
  onPatch,
}: {
  item: SpecItem;
  onPatch: (patch: SpecItemPatch) => void;
}) => {

  return (
    <>
     
      {/* //? Details */}
      <section className="flex flex-col gap-4">
        <span className="font-semibold text-[15px] font-mono">
          Описание продукта
        </span>
        <div
          key={item.activeVariantId ?? "base"}
          className="grid grid-cols-2 gap-4"
        >
          <Field label="Наименование" className="col-span-2">
            <Input
              defaultValue={item.name}
              autoFocus
              onBlur={(e) => onPatch({ name: e.target.value.trim() })}
            />
          </Field>
          <Field label="Производитель">
            <Input
              defaultValue={item.brand}
              onBlur={(e) => onPatch({ brand: e.target.value.trim() })}
            />
          </Field>
          <Field label="Тип">
            <MaterialTypePicker
              category={item.type}
              value={item.product_type}
              onChange={(v) => onPatch({ product_type: v ?? "" })}
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
                  {u === "-" ? "Не указан" : u}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field key={`url-${item.activeVariantId ?? "base"}`} label="Ссылка">
          <div className="flex flex-row gap-2 items-center">
            <Input
              defaultValue={item.product_url}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => onPatch({ product_url: e.target.value.trim() })}
            />
            {item.product_url && (
              <a
                href={item.product_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="Открыть на сайте"
                className="shrink-0 text-fg-muted hover:text-fg"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Запас">
            <Input
              onFocus={(e) => e.target.select()}
              onBlur={(e) => onPatch({ stockPct: +e.target.value })}
              defaultValue={item.stockPct}
              type="number"
            />
          </Field>
          <Field label="Скидка %">
            <Input
              defaultValue={item.clientDiscountPct}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => onPatch({ clientDiscountPct: +e.target.value })}
              type="number"
            />
          </Field>
        </div>

        {/* //? Quantity & Price */}
        <Separator />
        {/* <QtyPriceBlock
          item={item}
          onQty={onQty}
          onPrice={onPrice}
          onPatch={onPatch}
        /> */}

        {/* Поставщика здесь больше нет: компания, менеджер и срок поставки
            правятся в раскрытом блоке «Поставка» вкладки «Обзор», и второй
            вход в то же поле только путал бы. */}
      </section>
      {/* //? Attributes  */}
      <Separator />
      <section className="flex flex-col gap-4 pl-4 pr-6 py-4">
        <AttrsEditor
          category={item.type}
          materialType={item.product_type}
          attrs={item.attrs}
          onChange={(attrs) => onPatch({ attrs })}
        />
      </section>
      <Separator />
      {/* //? Notes */}
      <section className="flex flex-col gap-4 pl-4 pr-6 py-4">
        <Field label="Описание">
          <textarea
            defaultValue={item.spec}
            onBlur={(e) => onPatch({ spec: e.target.value.trim() })}
            className="min-h-16 w-full rounded-lg border border-border-muted bg-bg-card p-2 text-sm"
          />
        </Field>
        <Field label="Заметки">
          <textarea
            defaultValue={item.notes}
            onBlur={(e) => onPatch({ notes: e.target.value })}
            placeholder="Условия, скидки, договорённости"
            className="min-h-20 w-full rounded-lg border border-border-muted bg-bg-card p-2 text-sm"
          />
        </Field>
      </section>
    </>
  );
};

export default ModalDetailsTab;
