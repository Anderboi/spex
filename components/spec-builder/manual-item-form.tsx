"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CloudUpload, Loader2 } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { TYPE_ORDER, UNIT_OPTIONS, STOCK_HINT_TYPES, LEAD_TIME_OPTIONS, type SpecType } from "@/lib/constants";
import { priceOf } from "@/lib/spec/pricing";
import type { SpecPickerCompany } from "@/lib/queries";
import { fmt, fmtQty, cn } from "@/lib/utils";
import { z } from "zod";
import { SpecItem } from "@/lib/types";
import { ManualSpecItemInput, manualSpecItemSchema } from "@/lib/validations";
import { uploadMaterialImage } from "@/actions/materials";
import { MaterialTypePicker } from "@/components/layout/material-type-picker";
import { AttrsEditor } from "@/components/layout/attrs-editor";

export function ManualItemForm({
  companies,
  orgSlug,
  editing,
  onCancel,
  onSubmit,
  variantMode = false,
  variantFor = null,
  defaultType,
  onDirtyChange,
}: {
  companies: SpecPickerCompany[];
  orgSlug: string;
  editing: SpecItem | null;
  onCancel: () => void;
  onSubmit: (input: ManualSpecItemInput) => void;
  variantMode: boolean;
  variantFor?: SpecItem | null;
  /** Тип по умолчанию для новой позиции (например, тип родителя). */
  defaultType?: SpecType;
  /** Сообщает родителю о наличии изменений в форме (для guard закрытия диалога). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const form = useForm<
    z.input<typeof manualSpecItemSchema>,
    any,
    z.output<typeof manualSpecItemSchema>
  >({
    resolver: zodResolver(manualSpecItemSchema),
    defaultValues: {
      name: variantMode && variantFor ? variantFor.name : (editing?.name ?? ""),
      brand: editing?.brand ?? "",
      type: (variantMode && variantFor
        ? variantFor.type
        : editing?.type ?? defaultType ?? "Отделка") as (typeof TYPE_ORDER)[number],
      productType: editing?.product_type ?? "",
      spec: editing?.spec ?? "",
      article: editing?.article ?? "",
      qty: ( editing?.qty ?? 1),
      unit:
        (editing?.unit as (typeof UNIT_OPTIONS)[number] | undefined) ?? "шт",
      price: editing?.price ?? 0,
      stockPct: editing?.stockPct ?? 0,
      clientDiscountPct: editing?.clientDiscountPct ?? 0,
      supplierDiscountPct: editing?.supplierDiscountPct ?? 0,
      companyId: editing?.companyId ?? null,
      imageUrl: editing?.imageUrl ?? null,
      productUrl: editing?.product_url ?? "",
      attrs: editing?.attrs ?? {},
      leadTime: editing?.leadTime ?? "",
      saveToLibrary: !editing,
    },
  });

  const [isUploading, setIsUploading] = useState(false);

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  // Прокидываем «есть ли незаполненные/изменённые поля» родительскому диалогу.
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const type = watch("type");
  const productType = watch("productType");
  const unit = watch("unit") ?? "шт";
  const imageUrl = watch("imageUrl");
  const preview = priceOf({
    qty: Number(watch("qty")) || 0,
    unit,
    price: Number(watch("price")) || 0,
    stockPct: Number(watch("stockPct")) || 0,
    clientDiscountPct: Number(watch("clientDiscountPct")) || 0,
    supplierDiscountPct: Number(watch("supplierDiscountPct")) || 0,
  });

  const showPreview =
    preview.total > 0 && (preview.hasQtyMod || preview.hasPriceMod);

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
      form.setValue("imageUrl", res.url, { shouldDirty: true });
    } catch {
      toast.error("Не удалось загрузить изображение");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="flex items-start gap-4">
          {imageUrl ? (
            <div className="relative size-24 shrink-0 overflow-hidden rounded-lg border border-border">
              <Image
                src={imageUrl}
                alt="Изображение позиции"
                fill
                sizes="96px"
                className="object-cover"
              />
            </div>
          ) : null}
          <label className="flex h-24 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-muted bg-bg-card2 p-4">
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
                  {imageUrl ? "Заменить изображение" : "Добавить изображение"}
                </span>
                <span className="text-xs text-fg-muted">JPG/PNG до 5 МБ</span>
              </div>
            </div>
          </label>
        </section>

        <Field label="Наименование" error={errors.name?.message}>
          <Input
            {...register("name")}
            autoFocus
            placeholder="Вид материала/изделия"
            className="h-10 bg-bg-card"
          />
        </Field>

        {/* Категория — раздел спецификации; тип — что это за материал внутри
            раздела. Раньше здесь было одно поле «Тип» со словарём категорий,
            из-за чего тип материала (керамогранит, ламинат) ввести было негде. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Категория">
            <select
              {...register("type")}
              disabled={variantMode}
              className={cn(
                "h-10 w-full rounded-md border border-border bg-bg-card px-3 text-[15px]",
                variantMode && "opacity-50 cursor-not-allowed",
              )}
            >
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Тип">
            <Controller
              control={form.control}
              name="productType"
              render={({ field }) => (
                <MaterialTypePicker
                  category={type}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Керамогранит…"
                />
              )}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Бренд">
            <Input
              {...register("brand")}
              placeholder="ABK"
              className="h-10 bg-bg-card"
            />
          </Field>
          <Field label="Артикул">
            <Input
              {...register("article")}
              placeholder="PF60005804"
              className="h-10 bg-bg-card"
            />
          </Field>
        </div>

        <Field label="Описание">
          <Input
            {...register("spec")}
            placeholder="Rome Vein"
            className="h-10 bg-bg-card"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Ссылка на сайт">
            <Input
              {...register("productUrl")}
              placeholder="https://example.com"
              className="h-10 bg-bg-card"
            />
          </Field>
          <Field label="Срок поставки">
            <select
              {...register("leadTime")}
              className="h-10 w-full rounded-md border border-border bg-bg-card px-3 font-mono text-[13px]"
            >
              {LEAD_TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Характеристики. Пресеты ключей зависят от категории и типа:
            у керамогранита — формат и морозостойкость, у обоев — раппорт. */}
        <section className="rounded-lg border border-border-muted p-3">
          <Controller
            control={form.control}
            name="attrs"
            render={({ field }) => (
              <AttrsEditor
                category={type}
                materialType={productType}
                attrs={(field.value ?? {}) as Record<string, string>}
                onChange={field.onChange}
              />
            )}
          />
        </section>

        {/* ── количество и цена ───────────────────────── */}
        <div className="flex gap-3">
          {!variantMode && (
            <>
              <Field
                label="Кол-во"
                error={errors.qty?.message}
                className="w-24"
              >
                <Input
                  {...register("qty")}
                  type="number"
                  step="0.01"
                  min={0.01}
                  className="h-10 bg-bg-card font-mono"
                />
              </Field>
              <Field label="Ед." className="w-24">
                <select
                  {...register("unit")}
                  className="h-10 w-full rounded-md border border-border bg-bg-card px-2 font-mono text-[15px]"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field
            label="Цена за ед., ₽"
            error={errors.price?.message}
            className="flex-1"
          >
            <Input
              {...register("price")}
              type="number"
              step="0.01"
              min={0}
              placeholder="6500"
              className="h-10 bg-bg-card font-mono"
            />
          </Field>
        </div>

        {/* ── модификаторы ────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Запас, %"
            error={errors.stockPct?.message}
            hint={
              STOCK_HINT_TYPES.has(type)
                ? "Обычно 5–10 % на подрезку и бой"
                : undefined
            }
          >
            <Input
              {...register("stockPct")}
              type="number"
              step="1"
              min={0}
              max={100}
              placeholder="0"
              className="h-10 bg-bg-card font-mono"
            />
          </Field>

          <Field
            label="Скидка заказчику, %"
            error={errors.clientDiscountPct?.message}
          >
            <Input
              {...register("clientDiscountPct")}
              type="number"
              step="0.5"
              min={0}
              max={100}
              placeholder="0"
              className="h-10 bg-bg-card font-mono"
            />
          </Field>
        </div>

        <Field label="Поставщик">
          <select
            {...register("companyId", { setValueAs: (v) => v || null })}
            className="h-10 w-full rounded-md border border-border bg-bg-card px-3 text-[15px]"
          >
            <option value="">Не указан</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        {/* внутреннее: в смету не попадает */}
        <Field
          label="Скидка студии у поставщика, %"
          error={errors.supplierDiscountPct?.message}
          hint="Внутреннее поле — в спецификации и экспорте не показывается"
        >
          <Input
            {...register("supplierDiscountPct")}
            type="number"
            step="0.5"
            min={0}
            max={100}
            placeholder="0"
            className="h-10 bg-bg-card font-mono"
          />
        </Field>

        {/* ── предпросмотр ────────────────────────────── */}
        {showPreview && (
          <div className="rounded-lg bg-bg-select px-3 py-2.5 font-mono text-[12px] text-fg-secondary">
            <Row
              label="Закупаем"
              value={`${fmtQty(preview.qtyFinal)} ${unit}${preview.hasQtyMod ? ` (план ${fmtQty(preview.qtyBase)})` : ""}`}
            />
            <Row
              label="Цена за единицу"
              value={`${fmt(preview.priceFinal)} ₽${preview.hasPriceMod ? ` (было ${fmt(preview.priceBase)})` : ""}`}
            />
            <div className="mt-1.5 flex justify-between border-t border-border-muted pt-1.5 text-[13px] font-semibold text-fg">
              <span>Итого</span>
              <span className="tabular-nums">{fmt(preview.total)} ₽</span>
            </div>
          </div>
        )}

        {!editing && (
          <label className="flex items-start gap-2.5 rounded-lg border border-border-muted p-3">
            <Controller
              control={form.control}
              name="saveToLibrary"
              render={({ field }) => (
                <input
                  type="checkbox"
                  checked={!!field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  className="mt-0.5 size-4"
                />
              )}
            />
            <span>
              <span className="block text-[13.5px] font-medium">
                Сохранить в библиотеку материалов
              </span>
              <span className="block text-[12px] text-fg-muted">
                Материал станет доступен в других проектах. Снимите галочку для
                разовых позиций.
              </span>
            </span>
          </label>
        )}
      </div>

      <div className="flex justify-end flex-none gap-3 border-t border-border-subtle p-4">
        <Button type="button" size="lg" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button
          type="submit"
          size="lg"
          disabled={isSubmitting}
          
        >
          {editing ? "Заполнить позицию" : "Добавить позицию"}
        </Button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- */

function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label className="font-mono text-[10px] uppercase tracking-[.08em] text-fg-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-fg-red">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex justify-between first:mt-0">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
