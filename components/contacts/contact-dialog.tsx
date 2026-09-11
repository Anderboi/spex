"use client";

import {
  useCallback,
  useTransition,
  useEffect,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CloudUpload, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

import { contactSchema, ContactInput, CompanyInput } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { upsertContact, uploadContactImage } from "@/actions/contacts"; // Импорт вашей Server Action
import z from "zod";
import { CategoryMultiSelect } from "../layout/category-multiselect";
import { TYPE_ORDER } from "@/lib/constants";
import { useDialogDismissGuard } from "@/components/ui/use-dialog-dismiss-guard";

interface ContactDialogProps {
  orgSlug: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  companies?: CompanyInput[];
  /** Принудительная привязка к конкретной компании */
  fixedCompanyId?: string;
  /** Режим "независимый специалист" (без привязки к компании) */
  independentOnly?: boolean;
  /** Передан — карточка открыта для существующего контакта (редактирование). */
  contact?: {
    id: string;
    name: string;
    phone?: string | null;
    title?: string | null;
    email?: string | null;
    category?: string[] | null;
    note?: string | null;
    company_id?: string | null;
    avatar_url?: string | null;
  } | null;
}

export function ContactDialog({
  orgSlug,
  open,
  onClose,
  onSuccess,
  companies = [],
  fixedCompanyId,
  independentOnly = false,
  contact,
}: ContactDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const isEdit = !!contact;

  const defaultCompanyId = independentOnly ? null : (fixedCompanyId ?? null);

  /** Значения формы: редактирование существующего контакта либо создание. */
  const formValues = useCallback(
    (): z.input<typeof contactSchema> => ({
      id: contact?.id,
      name: contact?.name ?? "",
      phone: contact?.phone ?? "",
      title: contact?.title ?? "",
      email: contact?.email ?? "",
      note: contact?.note ?? "",
      company_id: contact ? (contact.company_id ?? null) : defaultCompanyId,
      category: contact?.category ?? [],
      avatar_url: contact?.avatar_url ?? null,
    }),
    [contact, defaultCompanyId],
  );

  const form = useForm<
    z.input<typeof contactSchema>,
    any,
    z.output<typeof contactSchema>
  >({
    resolver: zodResolver(contactSchema),
    defaultValues: formValues(),
  });

  // Сброс формы и установка начальных значений при изменении пропсов или открытии
  useEffect(() => {
    if (open) {
      form.reset(formValues());
    }
  }, [open, formValues, form]);

  const categories = form.watch("category") || [];

  // Защита от случайного закрытия: клик мимо диалога / Escape при заполненной
  // форме не закрывают окно, а показывают предупреждение.
  // ВАЖНО: isDirty читаем именно во время рендера — иначе RHF не подпишется
  // на него и вернёт устаревшее false.
  const isDirty = form.formState.isDirty;
  const { handleOpenChange } = useDialogDismissGuard({
    onClose,
    hasChanges: isDirty,
  });

  const toggleCategory = (type: string) => {
    const current = Array.isArray(categories) ? categories : [];
    if (categories.includes(type)) {
      // Удаляем категорию из массива
      form.setValue(
        "category",
        categories.filter((c: string) => c !== type),
        { shouldValidate: true, shouldDirty: true },
      );
    } else {
      // Добавляем категорию в массив
      form.setValue("category", [...current, type], {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
  };

  const onSubmit: SubmitHandler<ContactInput> = (values) => {
    startTransition(async () => {
      // Принудительно очищаем company_id для независимого специалиста
      const finalCompanyId = independentOnly
        ? null
        : (fixedCompanyId ?? values.company_id ?? null);

      const res = await upsertContact(orgSlug, {
        ...values,
        company_id: finalCompanyId,
      });

      if (!res.success) {
        form.setError("root", {
          message: res.error || "Ошибка при сохранении контакта",
        });
        return;
      }

      form.reset();
      onClose();
      onSuccess?.();
    });
  };

  const showCompanySelect = !fixedCompanyId && !independentOnly;

  const avatarUrl = form.watch("avatar_url");

  /** Общая загрузка: используется и file picker'ом, и вставкой из буфера. */
  const uploadImageFile = useCallback(
    async (file: File) => {
      setIsUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await uploadContactImage(
          orgSlug,
          fd,
          "contact",
          form.getValues("avatar_url") ?? null,
        );
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        form.setValue("avatar_url", res.url, { shouldDirty: true });
      } catch {
        toast.error("Не удалось загрузить изображение");
      } finally {
        setIsUploading(false);
      }
    },
    [orgSlug, form],
  );

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadImageFile(file);
  };

  /** Ctrl+V / Cmd+V: перехватываем только картинки, обычный текст не трогаем. */
  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void uploadImageFile(file);
          return;
        }
      }
    }
  };

  const handleRemoveImage = () => {
    form.setValue("avatar_url", null, { shouldDirty: true });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-125" onPaste={handlePaste}>
        <DialogHeader className="border-b border-border-subtle py-2">
          <DialogTitle>
            {isEdit
              ? "Карточка контакта"
              : independentOnly
                ? "Добавить специалиста"
                : "Добавить контакт"}
          </DialogTitle>
          <DialogDescription>
            {independentOnly
              ? "Фрилансеры, подрядчики и специалисты без привязки к компании."
              : "Представитель, менеджер или координатор."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            {/* Фото специалиста: file picker, Ctrl+V, замена, удаление */}
            <section className="flex items-center gap-4">
              <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-bg-card2">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt="Фото контакта"
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                ) : (
                  <span className="text-xs text-fg-muted">Нет фото</span>
                )}
                {isUploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-bg-card/60">
                    <Loader2 className="size-5 animate-spin text-fg-muted" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-bg-card2 px-3 py-1.5 text-sm hover:bg-bg-card">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFile}
                    disabled={isUploading}
                  />
                  <CloudUpload className="size-4 text-fg-muted" />
                  {avatarUrl ? "Заменить фото" : "Загрузить фото"}
                </label>
                <span className="text-xs text-fg-muted">
                  JPG/PNG до 5 МБ или Ctrl+V
                </span>
                {avatarUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveImage}
                    disabled={isUploading}
                    className="w-fit cursor-pointer text-fg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4 shrink-0" /> Удалить фото
                  </Button>
                )}
              </div>
            </section>

            {/* Вывод ошибки от сервера */}
            {form.formState.errors.root && (
              <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                {form.formState.errors.root.message}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ФИО / Имя *</FormLabel>
                    <FormControl>
                      <Input placeholder="Иван Иванов" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Должность / Роль</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Аккаунт-менеджер"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Категории компании</FormLabel>
                  <FormControl>
                    <CategoryMultiSelect
                      options={TYPE_ORDER}
                      selected={field.value || []}
                      onChange={(newCategories) => {
                        field.onChange(newCategories);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Выбор компании (скрыт, если зафиксирована компания или режим независимого специалиста) */}
            {showCompanySelect && (
              <FormField
                control={form.control}
                name="company_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Компания (необязательно)</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        value={field.value || ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Независимый специалист</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Эл. почта</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="manager@example.com"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Телефон</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="+7 999 999 99 99"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Заметки</FormLabel>
                  <FormControl>
                    <textarea
                      className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="Предпочитаемые способы связи, график работы..."
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <p className="text-sm font-medium text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={isPending}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Сохранить
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
