"use client";

import Field from "../../../layout/modal-field";
import { LEAD_TIME_OPTIONS } from "@/lib/constants";
import { Input } from "../../../ui/input";
import { ExternalLink } from "lucide-react";
import { SpecItem, SpecItemPatch } from "@/lib/types";
import { AttrsEditor } from "@/components/layout/attrs-editor";
import { MaterialTypePicker } from "@/components/layout/material-type-picker";
import ModalSection from "../../layout/modal-section";
import SpecParameterInlineEdit from "../../../layout/inline-parameter";
import { useState } from "react";
import { parseCommittedNumber, shortUrl } from "@/lib/utils";

const EDITABLE_FIELD_CLASS =
  "w-full border-0 border-b border-transparent bg-transparent font-semibold " +
  "hover:border-border-muted focus:border-transparent focus:bg-bg-card " +
  "group-hover/param:border-border-muted group-hover/param:bg-bg-card";

function commitKeysHandler(defaultValue: string | number | undefined) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.value = String(defaultValue ?? "");
      e.currentTarget.blur();
    }
  };
}

const ModalDetailsTab = ({
  item,
  onPatch,
}: {
  item: SpecItem;
  onPatch: (patch: SpecItemPatch) => void;
}) => {
  const [urlEditing, setUrlEditing] = useState(false);

  const filledAttrsCount = Object.values(item.attrs ?? {}).filter(
    (v) => String(v ?? "").trim() !== "",
  ).length;
  const hasNotes = Boolean(
    (item.spec ?? "").trim() || (item.notes ?? "").trim(),
  );

  return (
    <div
      key={item.activeVariantId ?? "base"}
      className="flex flex-col gap-2 py-4"
    >
      {/* //? Details */}
      <ModalSection title="Описание продукта" defaultOpen emphasized>
        <div className="grid grid-cols-1 divide-y divide-border-muted/60 md:py-2">
          <SpecParameterInlineEdit label="Наименование" htmlFor="Наименование">
            <Input
              className={EDITABLE_FIELD_CLASS}
              defaultValue={item.name}
              id="Наименование"
              autoFocus
              onBlur={(e) => onPatch({ name: e.target.value.trim() })}
              onFocus={(e) => e.target.select()}
              onKeyDown={commitKeysHandler(item.name)}
            />
          </SpecParameterInlineEdit>
          <SpecParameterInlineEdit
            label="Производитель"
            htmlFor="Производитель"
          >
            <Input
              id="Производитель"
              className={EDITABLE_FIELD_CLASS}
              defaultValue={item.brand}
              onBlur={(e) => onPatch({ brand: e.target.value.trim() })}
              onFocus={(e) => e.target.select()}
              onKeyDown={commitKeysHandler(item.brand)}
            />
          </SpecParameterInlineEdit>
          <SpecParameterInlineEdit label="Тип" htmlFor="Тип">
            <MaterialTypePicker
              id="Тип"
              category={item.type}
              value={item.product_type}
              onChange={(v) => onPatch({ product_type: v ?? "" })}
              className={
                "w-full appearance-none border-0 border-b border-border-muted bg-transparent pr-8 font-semibold " +
                "hover:bg-bg-card focus:bg-bg-card"
              }
            />
          </SpecParameterInlineEdit>
          <SpecParameterInlineEdit label="Артикул" htmlFor="Артикул">
            <Input
              id="Артикул"
              className={EDITABLE_FIELD_CLASS}
              defaultValue={item.article}
              onBlur={(e) => onPatch({ article: e.target.value.trim() })}
              onFocus={(e) => e.target.select()}
              onKeyDown={commitKeysHandler(item.article)}
            />
          </SpecParameterInlineEdit>
          <SpecParameterInlineEdit
            label="Срок поставки"
            htmlFor="Срок поставки"
          >
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
          <SpecParameterInlineEdit label="Ссылка" htmlFor="Ссылка">
            {urlEditing || !item.product_url ? (
              <Input
                id="Ссылка"
                className={EDITABLE_FIELD_CLASS}
                defaultValue={item.product_url}
                autoFocus={urlEditing}
                placeholder="https://…"
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  onPatch({ product_url: e.target.value.trim() });
                  setUrlEditing(false);
                }}
                onKeyDown={commitKeysHandler(item.product_url)}
              />
            ) : (
              <button
                type="button"
                id="Ссылка"
                title={item.product_url}
                onClick={() => setUrlEditing(true)}
                className="w-full h-10 rounded-lg truncate border-0 border-b border-transparent bg-transparent px-2 text-left font-mono text-[13px] font-semibold hover:border-border-muted hover:bg-bg-card group-hover/param:border-border-muted group-hover/param:bg-bg-card"
              >
                {shortUrl(item.product_url)}
              </button>
            )}
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

          <div
            className="flex gap-2"
            key={`${item.id}-${item.activeVariantId ?? "base"}`}
          >
            <SpecParameterInlineEdit label="Запас" htmlFor="Запас" hint="%">
              <Input
                id="Запас"
                type="number"
                className={EDITABLE_FIELD_CLASS}
                defaultValue={item.stockPct}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  const parsed = parseCommittedNumber(e.target.value);
                  if (parsed === null) {
                    // Невалидный ввод — откатываем визуал, ничего не патчим.
                    e.target.value = String(item.stockPct);
                    return;
                  }
                  onPatch({ stockPct: parsed });
                }}
                onKeyDown={commitKeysHandler(item.stockPct)}
              />
            </SpecParameterInlineEdit>
            <SpecParameterInlineEdit label="Скидка" htmlFor="Скидка" hint="%">
              <Input
                id="Скидка"
                type="number"
                className={EDITABLE_FIELD_CLASS}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  const parsed = parseCommittedNumber(e.target.value);
                  if (parsed === null) {
                    e.target.value = String(item.clientDiscountPct);
                    return;
                  }
                  onPatch({ clientDiscountPct: parsed });
                }}
                onKeyDown={commitKeysHandler(item.clientDiscountPct)}
              />
            </SpecParameterInlineEdit>
          </div>
        </div>
      </ModalSection>

      {/* //? Attributes */}
      <ModalSection
        title="Характеристики"
        badge={filledAttrsCount > 0 ? filledAttrsCount : "пусто"}
      >
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
      <ModalSection title="Заметки" badge={hasNotes ? undefined : "пусто"}>
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
