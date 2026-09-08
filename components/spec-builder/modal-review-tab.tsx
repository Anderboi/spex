"use client";

import { PriceField } from "./price-field";
import Field from "../layout/modal-field";
import { LEAD_TIME_OPTIONS, UNIT_OPTIONS } from "@/lib/constants";
import { Input } from "../ui/input";
import { Building2, CloudUpload, ExternalLink, Loader2 } from "lucide-react";
import Image from "next/image";
import { SpecItem, SpecItemPatch } from "@/lib/types";
import { ChangeEvent, useState } from "react";
import { priceOf } from "@/lib/spec/pricing";
import { toast } from "sonner";
import { uploadMaterialImage } from "@/actions/materials";
import { QtyStepper } from "./qty-stepper";
import { fmt } from "@/lib/utils";
import { Button } from "../ui/button";
import { AttrsEditor } from "./attrs-editor";
import { Separator } from "../ui/separator";

const ModalReviewTab = ({
  item,
  onPatch,
  orgSlug,
  onQty,
  onPrice,
  setTab,
}: {
  item: SpecItem;
  onPatch: (patch: SpecItemPatch) => void;
  onQty: (delta: number) => void;
  onPrice: (raw: string) => void;
  orgSlug: string;
  setTab: (tab: string) => void;
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const p = priceOf(item);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadMaterialImage(orgSlug, fd);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      onPatch({ imageUrl: res.url });
    } catch {
      toast.error("Не удалось загрузить изображение");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  return (
    <>
      {/* //? Images */}
      <section className="flex items-center justify-start gap-4 bg-bg-card border-t border-b border-border-muted py-4 pl-4 pr-6">
        {item.imageUrl && (
          <Image
            alt="product image"
            src={item.imageUrl}
            width={120}
            height={120}
            className="bg-bg-brand aspect-square object-cover rounded-lg border"
          />
        )}
        <label className="flex items-center cursor-pointer justify-center gap-2 border-2 border-border-muted bg-bg-card rounded-lg border-dashed p-4 h-30 flex-1">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
            disabled={isUploading}
          />
          <div className="flex flex-col items-center gap-2">
            {isUploading ? (
              <Loader2 className="size-6 animate-spin text-fg-muted" />
            ) : (
              <CloudUpload size={24} className="text-fg-muted" />
            )}
            <div className="flex flex-col items-center">
              <span>
                {item.imageUrl
                  ? "Заменить изображение"
                  : "Добавить изображение"}
              </span>
              <span className="text-xs text-fg-muted">JPG/PNG до 5 МБ</span>
            </div>
          </div>
        </label>
      </section>
      {/* //? Details */}
      <section className="flex flex-col gap-4 pl-4 pr-6 py-4">
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
            <Input
              defaultValue={item.product_type}
              onBlur={(e) => onPatch({ product_type: e.target.value.trim() })}
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
                  {u}
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
        <div
          key={`qp-${item.activeVariantId ?? "base"}`}
          className="flex flex-wrap items-center gap-2 rounded-lg border-border-muted"
        >
          <div className="bg-bg-card h-20 border rounded-lg p-3 flex-1">
            <Field label="Кол-во">
              <div className="flex items-center gap-2">
                <QtyStepper
                  editable
                  qty={item.qty}
                  unit={item.unit}
                  onChange={onQty}
                  showUnit={false}
                />
                <select
                  defaultValue={item.unit}
                  onChange={(e) => onPatch({ unit: e.target.value })}
                  className="h-6 w-full rounded-sm font-mono //border border-border-muted bg-bg-card px-3 text-sm"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          </div>
          <div className="bg-bg-card h-20 border  rounded-lg p-3 flex-1">
            <Field label="Цена за ед.">
              <PriceField
                readOnly={p.hasPriceMod}
                value={p.priceBase}
                onCommit={onPrice}
                className="text-[18px]! p-0! text-left! font-semibold tabular-nums"
              />
            </Field>
          </div>
          <div className="ml-auto h-20 text-left font-mono bg-fg rounded-lg p-3 text-bg flex-1">
            <Field label="Сумма">
              <div className="flex flex-col">
                <span className="text-[18px] font-semibold tabular-nums">
                  {fmt(p.total)} ₽
                </span>
                {(p.hasQtyMod || p.hasPriceMod) && (
                  <span className="font-mono text-[10.5px] text-bg/70 tabular-nums">
                    {p.hasQtyMod && `×${p.qtyFinal} ед.`}
                    {p.hasQtyMod && p.hasPriceMod && " · "}
                    {p.hasPriceMod && `−${item.clientDiscountPct}%`}
                  </span>
                )}
              </div>
            </Field>
          </div>
        </div>

        <Field label="Поставщик">
          <div className="flex items-center justify-between rounded-lg border border-border-muted bg-bg-card px-2 py-2.5">
            {item.companyName ? (
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="size-3.5 shrink-0 text-fg-muted" />
                <span className="truncate text-[13.5px] font-medium">
                  {item.companyName}
                </span>
                {item.contactName && (
                  <span className="text-[12px] text-fg-muted truncate">
                    · {item.contactName}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[13px] text-fg-muted">
                Поставщик не указан
              </span>
            )}
            <Button
              variant={"ghost"}
              onClick={() => setTab("supplier")}
              className="shrink-0 text-[12px] text-fg-brand hover:underline ml-3"
            >
              Изменить
            </Button>
          </div>
        </Field>
      </section>
      {/* //? Attributes  */}
      <Separator />
      <section className="flex flex-col gap-4 pl-4 pr-6 py-4">
        <AttrsEditor
          type={item.type}
          attrs={item.attrs}
          onChange={(attrs) => onPatch({ attrs })}
        />
      </section>
      <Separator />
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

export default ModalReviewTab;
