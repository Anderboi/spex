"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { TYPE_ORDER, UNIT_OPTIONS, STOCK_HINT_TYPES } from "@/lib/constants";
import { priceOf } from "@/lib/spec/pricing";
import type { SpecPickerCompany } from "@/lib/queries";
import { fmt, fmtQty, cn } from "@/lib/utils";
import { z } from "zod";
import { SpecItem } from "@/lib/types";
import { ManualSpecItemInput, manualSpecItemSchema } from "@/lib/validations";

export function ManualItemForm({
  companies,
  editing,
  onCancel,
  onSubmit,
}: {
  companies: SpecPickerCompany[];
  editing: SpecItem | null;
  onCancel: () => void;
  onSubmit: (input: ManualSpecItemInput) => void;
}) {
  const form = useForm<
    z.input<typeof manualSpecItemSchema>,
    any,
    z.output<typeof manualSpecItemSchema>
  >({
    resolver: zodResolver(manualSpecItemSchema),
    defaultValues: {
      name: editing?.name ?? "",
      brand: editing?.brand ?? "",
      type: editing?.type ?? "Отделка",
      spec: editing?.spec ?? "",
      article: editing?.article ?? "",
      qty: editing?.qty ?? 1,
      unit:
        (editing?.unit as (typeof UNIT_OPTIONS)[number] | undefined) ?? "шт",
      price: editing?.price ?? 0,
      stockPct: editing?.stockPct ?? 0,
      clientDiscountPct: editing?.clientDiscountPct ?? 0,
      supplierDiscountPct: editing?.supplierDiscountPct ?? 0,
      companyId: editing?.companyId ?? null,
      saveToLibrary: !editing,
      
    },
  });

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  const type = watch("type");
  const unit = watch("unit") ?? "шт";
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

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Наименование" error={errors.name?.message}>
          <Input
            {...register("name")}
            autoFocus
            placeholder="Керамогранит, 120×278"
            className="h-11 bg-bg-card"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Бренд">
            <Input
              {...register("brand")}
              placeholder="ABK"
              className="h-11 bg-bg-card"
            />
          </Field>
          <Field label="Тип">
            <select
              {...register("type")}
              className="h-11 w-full rounded-md border border-border bg-bg-card px-3 text-[15px]"
            >
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Коллекция">
            <Input
              {...register("spec")}
              placeholder="Rome Vein"
              className="h-11 bg-bg-card"
            />
          </Field>
          <Field label="Артикул">
            <Input
              {...register("article")}
              placeholder="PF60005804"
              className="h-11 bg-bg-card"
            />
          </Field>
        </div>

        {/* ── количество и цена ───────────────────────── */}
        <div className="flex gap-3">
          <Field label="Кол-во" error={errors.qty?.message} className="w-24">
            <Input
              {...register("qty")}
              type="number"
              step="0.01"
              min={0.01}
              className="h-11 bg-bg-card font-mono"
            />
          </Field>
          <Field label="Ед." className="w-24">
            <select
              {...register("unit")}
              className="h-11 w-full rounded-md border border-border bg-bg-card px-2 font-mono text-[15px]"
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
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
              className="h-11 bg-bg-card font-mono"
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
              className="h-11 bg-bg-card font-mono"
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
              className="h-11 bg-bg-card font-mono"
            />
          </Field>
        </div>

        <Field label="Поставщик">
          <select
            {...register("companyId", { setValueAs: (v) => v || null })}
            className="h-11 w-full rounded-md border border-border bg-bg-card px-3 text-[15px]"
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
            className="h-11 bg-bg-card font-mono"
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

      <div className="flex flex-none gap-3 border-t border-border-subtle p-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1">
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
