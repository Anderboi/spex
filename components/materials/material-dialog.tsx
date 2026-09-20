"use client";

import { useState, useEffect, type ChangeEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MaterialInput, materialSchema } from "@/lib/validations";
import { SubmitHandler, useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { CloudUpload, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TYPE_ORDER, UNIT_OPTIONS } from "@/lib/constants";
import { MaterialTypePicker } from "@/components/layout/material-type-picker";
import { AttrsEditor } from "@/components/layout/attrs-editor";
import {
  CompanyPicker,
  type CompanyOption,
} from "@/components/layout/company-picker";
import { SpecPickerCompany, SpecPickerContact } from "@/lib/queries";
import { ScrollArea } from "../ui/scroll-area";
import Image from "next/image";
import { toast } from "sonner";
import { uploadMaterialImage } from "@/actions/materials";
import { useDialogDismissGuard } from "@/components/ui/use-dialog-dismiss-guard";

interface MaterialDialogProps {
  open: boolean;
  orgSlug: string;
  companies?: SpecPickerCompany[];
  contacts?: SpecPickerContact[];
  onOpenChange: (open: boolean) => void;
  materialToEdit?: MaterialInput | null;
  onSave: (data: MaterialInput) => void;
  /**
   * Компания, созданная из формы. Сообщаем наверх: имя нужно оптимистичной
   * карточке материала, пока не пришёл `revalidatePath`.
   */
  onCompanyCreated?: (company: CompanyOption) => void;
}

type FormValues = z.infer<typeof materialSchema>;

export function MaterialDialog({
  open,
  orgSlug,
  companies = [],
  contacts = [],
  onOpenChange,
  materialToEdit,
  onSave,
  onCompanyCreated,
}: MaterialDialogProps) {
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<
    z.input<typeof materialSchema>,
    any,
    z.output<typeof materialSchema>
  >({
    resolver: zodResolver(materialSchema),
    defaultValues: {
      id: undefined,
      name: "",
      category: TYPE_ORDER[0] || "Отделка",
      brand: "",
      article: "",
      price: 0,
      unit: "шт",
      company_id: null,
      contact_id: null,
      image_url: null,
      product_url: null,
      product_type: null,
      attrs: {},
    },
  });

  /**
   * Переинициализация формы — только при открытии карточки или смене материала.
   *
   * Зависимость от самого `materialToEdit` здесь опасна: родитель создаёт его
   * как `toFormValues(editingItem)`, то есть **новый объект на каждый рендер**.
   * С ней эффект срабатывал на любое обновление родителя — например, когда
   * `CompanyPicker` после создания компании сообщал имя наверх и родитель
   * обновлял список (`setCreatedCompanies`). Форма сбрасывалась на «как в БД»,
   * и уже выбранный поставщик пропадал: поле оставалось пустым.
   *
   * Поэтому смотрим на `open` и `id` — оба примитивы и не меняются от
   * ре-рендеров.
   */
  const resetKey = materialToEdit?.id ?? null;
  /**
   * Выбранный поставщик — отдельным состоянием, а не только в форме.
   *
   * Форму диалога переинициализирует эффект ниже (и `form.reset` из формы
   * материала течёт сюда же), из-за чего выбранный в `CompanyPicker` поставщик
   * мог «слетать»: в поле он виден, а в состоянии формы и в payload остаётся
   * `null`. Держим выбор рядом с формой и собираем payload из него — тогда
   * никакая переинициализация не может потерять поставщика.
   */
  const [supplier, setSupplier] = useState<{
    companyId: string | null;
    contactId: string | null;
  }>({ companyId: null, contactId: null });
  useEffect(() => {
    setSupplier({
      companyId: materialToEdit?.company_id ?? null,
      contactId: materialToEdit?.contact_id ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetKey]);

  useEffect(() => {
    if (!open) return;

    if (materialToEdit) {
      form.reset({
        ...materialToEdit,
        brand: materialToEdit.brand ?? "",
        article: materialToEdit.article ?? "",
        company_id: materialToEdit.company_id ?? null,
        contact_id: materialToEdit.contact_id ?? null,
        image_url: materialToEdit.image_url ?? null,
        product_url: materialToEdit.product_url ?? null,
        product_type: materialToEdit.product_type ?? null,
        attrs: materialToEdit.attrs ?? {},
      });
    } else {
      form.reset({
        name: "",
        category: TYPE_ORDER[0] || "Отделка",
        brand: "",
        article: "",
        price: 0,
        unit: "шт",
        company_id: null,
        contact_id: null,
        image_url: null,
        product_url: null,
        product_type: null,
        attrs: {},
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetKey]);

  const imageUrl = form.watch("image_url");
  const category = form.watch("category");
  const productType = form.watch("product_type");

  const isDirty = form.formState.isDirty;
  const { handleOpenChange, showConfirm, confirmDiscard, cancelDiscard } =
    useDialogDismissGuard({
      onClose: () => onOpenChange(false),
      hasChanges: isDirty,
    });

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    const payload: MaterialInput = {
      ...values,
      // Поставщика берём из состояния (см. `supplier`), а не из значений формы:
      // повторная переинициализация формы успевала обнулить `company_id`.
      company_id: supplier.companyId,
      contact_id: supplier.contactId,
      id: materialToEdit?.id,
    };

    onSave(payload);
    onOpenChange(false);
  };

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
      form.setValue("image_url", res.url, { shouldDirty: true });
    } catch {
      toast.error("Не удалось загрузить изображение");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-170 max-h-[88vh] flex-col bg-bg p-0 gap-0">
          <DialogHeader className="sticky top-0 gap-2 border-b p-4">
            <DialogTitle>
              {materialToEdit
                ? "Редактировать материал"
                : "Добавить в библиотеку"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <ScrollArea className="h-[66svh] pr-4 p-4">
                <section className="flex flex-col gap-4">
                  {/* Image section */}
                  <section className="flex items-start gap-4">
                    {imageUrl ? (
                      <div className="relative size-24 shrink-0 overflow-hidden rounded-lg border border-border">
                        <Image
                          src={imageUrl}
                          alt="Изображение материала"
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
                            {imageUrl
                              ? "Заменить изображение"
                              : "Добавить изображение"}
                          </span>
                          <span className="text-xs text-fg-muted">
                            JPG/PNG до 5 МБ
                          </span>
                        </div>
                      </div>
                    </label>
                  </section>
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Наименование *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Керамогранит Calacatta..."
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Категория *</FormLabel>
                          <FormControl>
                            <select
                              {...field}
                              className="w-full h-10 px-3 rounded-md border border-input bg-bg-card text-sm"
                            >
                              {TYPE_ORDER.map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="product_type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Тип</FormLabel>
                          {/* Пресеты типов зависят от категории, но значение
                              можно ввести своё — справочник не закрытый. */}
                          <MaterialTypePicker
                            category={category}
                            value={field.value ?? null}
                            onChange={field.onChange}
                            placeholder="Керамогранит…"
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="brand"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Бренд</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Brand"
                              value={field.value ?? ""}
                              onChange={field.onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="article"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Артикул</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="KM-1024"
                              value={field.value ?? ""}
                              onChange={field.onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Характеристики материала — шаблон: при добавлении материала
                      в спецификацию значения переносятся в новую позицию. */}
                  <FormField
                    control={form.control}
                    name="attrs"
                    render={({ field }) => (
                      <FormItem className="border-t border-border-muted pt-4">
                        <AttrsEditor
                          category={category}
                          materialType={productType}
                          attrs={(field.value ?? {}) as Record<string, string>}
                          onChange={field.onChange}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Цена (₽)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="0"
                              {...field}
                              onChange={(e) =>
                                field.onChange(e.target.valueAsNumber || 0)
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="unit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Ед. измерения</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="h-10! w-full bg-bg-card border border-border-muted">
                                <SelectValue placeholder="выберите ед." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {UNIT_OPTIONS.map((unit) => (
                                <SelectItem key={unit} value={unit}>
                                  {unit}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="product_url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ссылка на сайт</FormLabel>
                        <FormControl>
                          <Input
                            type="text"
                            placeholder="https://example.com"
                            {...field}
                            value={field.value ?? ""}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Поставщик: компанию можно не только найти, но и завести
                      прямо здесь — CompanyPicker откроет карточку компании с
                      уже введённым названием. */}
                  <FormField
                    control={form.control}
                    name="company_id"
                    render={() => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Поставщик / Менеджер</FormLabel>
                        <FormControl>
                          <CompanyPicker
                            orgSlug={orgSlug}
                            companies={companies}
                            contacts={contacts}
                            // Значение берём из состояния, а не из формы: форму
                            // переинициализирует эффект, и выбранный поставщик
                            // мог «слетать» (см. `supplier`).
                            value={supplier.companyId}
                            contactValue={supplier.contactId}
                            placeholder="Выберите компанию или контакт..."
                            searchPlaceholder="Поиск компании или менеджера..."
                            emptyText="Ничего не найдено — можно создать компанию."
                            onChange={({ companyId, contactId }) => {
                              // Держим выбор и в состоянии (источник payload'а),
                              // и в форме — чтобы работали валидация и dirty-state.
                              setSupplier({ companyId, contactId });
                              form.setValue("company_id", companyId, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                              form.setValue("contact_id", contactId, {
                                shouldDirty: true,
                              });
                            }}
                            onCompanyCreated={onCompanyCreated}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </section>
              </ScrollArea>
              <DialogFooter className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => onOpenChange(false)}
                >
                  Отмена
                </Button>
                <Button type="submit" size="lg">
                  Сохранить
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={showConfirm}
        onOpenChange={(v) => !v && cancelDiscard()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Несохранённые изменения</AlertDialogTitle>
            <AlertDialogDescription>
              Вы заполнили поля формы материала. Если закрыть окно, изменения
              будут утеряны.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg" onClick={cancelDiscard}>
              Вернуться к редактированию
            </AlertDialogCancel>
            <AlertDialogAction
              size="lg"
              onClick={confirmDiscard}
              variant="destructive"
            >
              Закрыть без сохранения
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
