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
import { CloudUpload, Loader2, TriangleAlert } from "lucide-react";
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
import type { CompanyOption } from "@/components/layout/company-picker";
import { MaterialSuppliersField } from "./material-suppliers-field";
import {
  normalizeMaterialSuppliers,
  primaryMaterialSupplier,
  type MaterialSupplierDraft,
} from "@/lib/materials/suppliers";
import { SpecPickerCompany, SpecPickerContact } from "@/lib/queries";
import { ScrollArea } from "../ui/scroll-area";
import Image from "next/image";
import { toast } from "sonner";
import { uploadMaterialImage } from "@/actions/materials";
import { useDialogDismissGuard } from "@/components/ui/use-dialog-dismiss-guard";
import {
  resolveDialogPrefill,
  resolveResetKey,
} from "@/lib/material-import/dialog-prefill";
import type { MaterialImportDraft } from "@/lib/material-import/draft";
import type { ImportNotice } from "@/lib/material-import/notices";
import ModalSection from "../spec-builder/layout/modal-section";

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
  /**
   * Устойчивый ключ импортированного черновика (например, канонический URL
   * страницы). Меняется только при НОВОМ импорте — именно это, а не ссылка на
   * объект, заставляет форму переинициализироваться ровно один раз.
   *
   * Пока `materialToEdit` не задан, смена ключа применяет `draft`.
   */
  draftKey?: string | null;
  /** Черновик импорта, показываемый при создании. */
  draft?: MaterialImportDraft | null;
  /**
   * Замечания к импортированному черновику: спорные значения, предупреждения
   * конвейера, не перенесённое изображение. Показываются над формой и НЕ
   * блокируют сохранение: это сигнал проверить данные, а не запрет.
   */
  importNotices?: ImportNotice[];
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
  draftKey = null,
  draft = null,
  importNotices,
}: MaterialDialogProps) {
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<
    z.input<typeof materialSchema>,
    // Контекст формы не используется: третий параметр — тип значений ПОСЛЕ
    // резолвера, а `any` здесь был просто заглушкой и глушил проверку типов.
    unknown,
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
   * Ключ переинициализации формы.
   *
   * Приоритет у редактирования: если открыт существующий материал, его `id`
   * однозначно определяет содержимое формы.
   *
   * Для создания ключом служит `draftKey` — устойчивый идентификатор импорта
   * (например, канонический URL страницы), а НЕ ссылка на объект черновика.
   * Родитель пересоздаёт объект на каждом рендере, поэтому идентичность объекта
   * здесь непригодна: эффект срабатывал бы на любое обновление родителя и стирал
   * введённое пользователем (см. историю ниже). Строковый ключ меняется только
   * тогда, когда приходит НОВЫЙ импорт.
   */
  const resetKey = resolveResetKey({ materialToEdit, draftKey });

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
   * Поэтому смотрим на `open` и `resetKey` — оба примитивы и не меняются от
   * ре-рендеров.
   */
  /**
   * Поставщики материала — отдельным состоянием, а не полями формы.
   *
   * Строк может быть несколько, и порядок в них задаёт пользователь (первая —
   * основной поставщик), поэтому список живёт здесь, а форма лишь зеркалит его
   * для dirty-state. Причина та же, что была у одиночного `supplier`: форму
   * переинициализирует эффект ниже, и выбранный в `CompanyPicker` поставщик мог
   * «слетать» — в поле он виден, а в payload остаётся `null`.
   */
  const [suppliers, setSuppliers] = useState<MaterialSupplierDraft[]>([]);

  /**
   * Переинициализация формы — только при открытии диалога или смене ключа.
   *
   * Зависимость от самого `materialToEdit` здесь опасна: родитель создаёт его
   * как `toFormValues(editingItem)`, то есть **новый объект на каждый рендер**.
   * С ней эффект срабатывал на любое обновление родителя — например, когда
   * `CompanyPicker` после создания компании сообщал имя наверх и родитель
   * обновлял список (`setCreatedCompanies`). Форма сбрасывалась на «как в БД»,
   * и уже выбранный поставщик пропадал: поле оставалось пустым.
   *
   * Поэтому зависимость — `open` и `resetKey`, оба примитивы. Для импорта
   * ключом служит `draftKey` (устойчивый идентификатор импорта), а не объект
   * черновика: тот же приём защищает уже начатые пользователем правки.
   *
   * Само решение «что подставить» вынесено в чистую
   * `resolveDialogPrefill` — её поведение покрыто unit-тестами, тогда как сам
   * эффект требует React и DOM.
   */
  useEffect(() => {
    if (!open) return;

    const prefill = resolveDialogPrefill({
      materialToEdit: materialToEdit ?? null,
      draft,
    });
    form.reset(prefill.values);
    setSuppliers(prefill.suppliers);
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
    /**
     * Список чистится здесь, а не в поле: пустая строка (компанию ещё не выбрали)
     * не должна мешать сохранению, а повтор компании не должен доехать до
     * уникального индекса в БД.
     */
    const rows = normalizeMaterialSuppliers(suppliers);
    const primary = primaryMaterialSupplier(rows);

    const payload: MaterialInput = {
      ...values,
      // Компания позиции — основной поставщик. Материал без поставщиков
      // сохраняет собственные цену и ссылку: они у него свои, а не чьи-то.
      company_id: primary?.company_id ?? null,
      contact_id: primary?.contact_id ?? null,
      price: primary ? primary.price : (values.price ?? 0),
      product_url: primary ? primary.product_url : (values.product_url ?? null),
      suppliers: rows.map((row) => ({
        id: row.id,
        company_id: row.company_id,
        contact_id: row.contact_id,
        price: row.price,
        product_url: row.product_url,
        position: row.position,
      })),
      id: materialToEdit?.id,
    };

    onSave(payload);
    onOpenChange(false);
  };

  /**
   * Правка списка поставщиков.
   *
   * Состояние — источник payload'а, форма получает копию ради dirty-state:
   * иначе удаление последнего поставщика или смена основного не считались бы
   * изменением, и окно закрывалось бы молча (см. `useDialogDismissGuard`).
   */
  const handleSuppliersChange = (next: MaterialSupplierDraft[]) => {
    setSuppliers(next);
    form.setValue("suppliers", next, { shouldDirty: true });
    form.setValue("company_id", next[0]?.company_id ?? null, {
      shouldDirty: true,
    });
    form.setValue("contact_id", next[0]?.contact_id ?? null, {
      shouldDirty: true,
    });
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
        <DialogContent className="sm:max-w-170 max-h-[88vh] bg-bg gap-0">
          <DialogHeader className="gap-3 border-b py-3">
            <DialogTitle>
              {materialToEdit
                ? "Редактировать материал"
                : "Добавить в библиотеку"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <ScrollArea className="h-[66svh] pr-4">
                <section className="flex flex-col gap-4 py-4">
                  {/* Замечания импорта — над формой, чтобы пользователь увидел
                      их до того, как начнёт править поля. Сохранение не
                      блокируют. */}
                  {importNotices && importNotices.length > 0 && (
                    <ImportNotices notices={importNotices} />
                  )}

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
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="h-10! w-full bg-bg-card border border-border-muted">
                                <SelectValue placeholder="выберите ед." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent
                              side="bottom"
                              alignItemWithTrigger={false}
                              className="max-h-50 overflow-y-auto bg-bg-card"
                            >
                              {TYPE_ORDER.map((cat) => (
                                <SelectItem key={cat} value={cat}>
                                  {cat}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                            triggerClassName="bg-bg-card! border border-border-muted"
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

                  <div className="grid grid-cols-2 gap-3">
                    {/* Цена материала показывается, только пока поставщиков нет.
                        Как только компания выбрана, цена у неё своя и живёт в её
                        строке — иначе в карточке было бы две цены на один
                        материал, и непонятно, какая уйдёт в позицию. */}
                    {suppliers.length === 0 && (
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
                    )}

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
                            <SelectContent
                              alignItemWithTrigger={false}
                              className="max-h-50 overflow-y-auto bg-bg-card"
                            >
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

                  {/* Ссылка материала — тоже только без поставщиков: у каждой
                      компании своя страница товара. */}
                  {suppliers.length === 0 && (
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
                  )}

                  {/* Поставщики: компаний может быть несколько — материал бывает
                      у разных поставщиков, и цена у каждой своя. Компанию можно
                      не только найти, но и завести прямо из строки. */}
                  <div className="flex flex-col">
                    <MaterialSuppliersField
                      orgSlug={orgSlug}
                      companies={companies}
                      contacts={contacts}
                      value={suppliers}
                      onChange={handleSuppliersChange}
                      onCompanyCreated={onCompanyCreated}
                      defaults={{
                        price: Number(form.watch("price")) || 0,
                        productUrl: form.watch("product_url") ?? null,
                      }}
                    />
                  </div>

                  {/* Характеристики материала — шаблон: при добавлении материала
                      в спецификацию значения переносятся в новую позицию. */}
                  <FormField
                    control={form.control}
                    name="attrs"
                    render={({ field }) => (
                      <FormItem className="border p-4 rounded-lg border-border-muted">
                        <ModalSection
                          title="Характеристики"
                          defaultOpen
                          emphasized
                        >
                          <AttrsEditor
                            category={category}
                            materialType={productType}
                            attrs={
                              (field.value ?? {}) as Record<string, string>
                            }
                            onChange={field.onChange}
                          />
                        </ModalSection>
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

/**
 * Блок замечаний к импортированному черновику.
 *
 * Показывает то, что человек должен проверить: спорные характеристики,
 * предупреждения разбора и не перенесённое изображение. Намеренно без
 * внутренних кодов и без кнопок — это подсказка, а не шаг процесса.
 */
function ImportNotices({ notices }: { notices: ImportNotice[] }) {
  return (
    <section
      className="rounded-lg border border-border-gold bg-bg-gold p-3"
      aria-label="Замечания к импорту"
    >
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0 text-fg-gold" />
        <span className="text-[13px] font-semibold text-fg-gold-text">
          Проверьте данные перед сохранением
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {notices.map((notice, index) => (
          <li
            key={`${notice.message}-${index}`}
            className="text-[12.5px] leading-snug"
          >
            <span className="text-fg-body">{notice.message}</span>
            {notice.hint && (
              <span className="text-fg-muted"> {notice.hint}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
