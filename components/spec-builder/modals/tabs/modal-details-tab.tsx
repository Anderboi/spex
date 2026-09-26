"use client";

import Field from "../../../layout/modal-field";
import { LEAD_TIME_OPTIONS } from "@/lib/constants";
import { Input } from "../../../ui/input";
import { ExternalLink } from "lucide-react";
import { SpecItem, SpecItemPatch } from "@/lib/types";
import { AttrsEditor } from "@/components/layout/attrs-editor";
import { MaterialTypePicker } from "@/components/layout/material-type-picker";
import { Separator } from "../../../ui/separator";
import ModalSection from "../../layout/modal-section";
import SpecParameterInlineEdit from "../../../layout/inline-parameter";

const ModalDetailsTab = ({
  item,
  onPatch,
}: {
  item: SpecItem;
  onPatch: (patch: SpecItemPatch) => void;
}) => {
  return (
    // `key` — на всей вкладке: при смене варианта перемонтируются поля (чтобы
    // `defaultValue` перечитал данные), но состояние сворачивания блоков,
    // которое живёт в `ModalSection`, сохраняется.
    <div
      key={item.activeVariantId ?? "base"}
      className="flex flex-col gap-2 py-4"
    >
      {/* //? Details */}
      <ModalSection title="Описание продукта" defaultOpen>
        <div className="grid grid-cols-1 md:py-2">
          <SpecParameterInlineEdit label="Наименование">
            <Input
              className="w-full border-0 bg-transparent font-semibold focus:bg-bg-card group-hover/param:bg-bg-card"
              defaultValue={item.name}
              id="Наименование"
              autoFocus
              onBlur={(e) => onPatch({ name: e.target.value.trim() })}
              onFocus={(e) => e.target.select()}
            />
          </SpecParameterInlineEdit>
          <Separator />
          <SpecParameterInlineEdit label="Производитель">
            <Input
              id="Производитель"
              className="w-full border-0 bg-transparent font-semibold focus:bg-bg-card group-hover/param:bg-bg-card"
              defaultValue={item.brand}
              onBlur={(e) => onPatch({ brand: e.target.value.trim() })}
              onFocus={(e) => e.target.select()}
            />
          </SpecParameterInlineEdit>
          <Separator />
          <SpecParameterInlineEdit label="Тип">
            <MaterialTypePicker
              id="Тип"
              category={item.type}
              value={item.product_type}
              onChange={(v) => onPatch({ product_type: v ?? "" })}
            />
          </SpecParameterInlineEdit>
          <Separator />
          <SpecParameterInlineEdit label="Артикул">
            <Input
              id="Артикул"
              className="w-full border-0 bg-transparent font-semibold focus:bg-bg-card group-hover/param:bg-bg-card"
              defaultValue={item.article}
              onBlur={(e) => onPatch({ article: e.target.value.trim() })}
              onFocus={(e) => e.target.select()}
            />
          </SpecParameterInlineEdit>
          <Separator />
          <SpecParameterInlineEdit label="Срок поставки">
            <select
              id="Срок поставки"
              defaultValue={item.leadTime}
              onChange={(e) => onPatch({ leadTime: e.target.value })}
              className="h-10 w-full rounded-lg font-mono hover:bg-bg-card px-2 font-semibold //text-sm"
            >
              {LEAD_TIME_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u === "-" ? "Не указан" : u}
                </option>
              ))}
            </select>
          </SpecParameterInlineEdit>
          
          <Separator />
          <SpecParameterInlineEdit label="Ссылка">
            <Input
              id="Ссылка"
              className="w-full border-0 bg-transparent font-semibold focus:bg-bg-card group-hover/param:bg-bg-card"
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
                className="shrink-0 text-fg-muted hover:text-fg pr-3"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </SpecParameterInlineEdit>
          <Separator />
          <div className="flex gap-2">
            <SpecParameterInlineEdit label="Запас">
              <Input
                id="Запас"
                onFocus={(e) => e.target.select()}
                className="w-full border-0 bg-transparent font-semibold focus:bg-bg-card group-hover/param:bg-bg-card"
                onBlur={(e) => onPatch({ stockPct: +e.target.value })}
                defaultValue={item.stockPct}
                type="number"
              />
            </SpecParameterInlineEdit>
            <Separator orientation="vertical" />
            <SpecParameterInlineEdit label="Скидка %">
              <Input
                id="Скидка %"
                defaultValue={item.clientDiscountPct}
                onFocus={(e) => e.target.select()}
                className="w-full border-0 bg-transparent font-semibold focus:bg-bg-card group-hover/param:bg-bg-card"
                onBlur={(e) => onPatch({ clientDiscountPct: +e.target.value })}
                type="number"
              />
            </SpecParameterInlineEdit>
          </div>
        </div>
      </ModalSection>

      {/* //? Attributes */}
      <ModalSection title="Характеристики">
        <AttrsEditor
          variant="inline"
          header={false}
          category={item.type}
          materialType={item.product_type}
          attrs={item.attrs}
          onChange={(attrs) => onPatch({ attrs })}
        />
      </ModalSection>

      {/* //? Notes */}
      <ModalSection title="Заметки">
        <div className="flex flex-col gap-4">
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
        </div>
      </ModalSection>
    </div>
  );
};

export default ModalDetailsTab;
