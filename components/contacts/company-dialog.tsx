"use client";

import { useCallback, useEffect, useTransition } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { companySchema, CompanyInput } from "@/lib/validations";
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
import { upsertCompany } from "@/actions/contacts";
import z from "zod";
import { CategoryMultiSelect } from "../layout/category-multiselect";
import { TYPE_ORDER } from "@/lib/constants";
import { useDialogDismissGuard } from "@/components/ui/use-dialog-dismiss-guard";
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

interface CompanyDialogProps {
  orgSlug: string;
  open: boolean;
  onClose: () => void;
  initialName?: string;
  /** Передана — карточка открыта для существующей компании (редактирование). */
  company?: {
    id: string;
    name: string;
    category?: string[] | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: string | null;
    note?: string | null;
  } | null;
  onSuccess?: (company: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: string | null;
    note?: string | null;
  }) => void;
}

export function CompanyDialog({
  orgSlug,
  open,
  onClose,
  initialName,
  company,
  onSuccess,
}: CompanyDialogProps) {
  const [isPending, startTransition] = useTransition();
  const isEdit = !!company;

  /** Значения формы: редактирование существующей компании либо создание. */
  const formValues = useCallback(
    (): z.input<typeof companySchema> => ({
      id: company?.id,
      name: company?.name ?? initialName ?? "",
      category: company?.category ?? [],
      website: company?.website ?? "",
      email: company?.email ?? "",
      phone: company?.phone ?? "",
      address: company?.address ?? "",
      note: company?.note ?? "",
    }),
    [company, initialName],
  );

  const form = useForm<
    z.input<typeof companySchema>,
    unknown,
    z.output<typeof companySchema>
  >({
    resolver: zodResolver(companySchema),
    defaultValues: formValues(),
  });

  useEffect(() => {
    if (open) {
      form.reset(formValues());
    }
  }, [open, formValues, form]);

  const onSubmit: SubmitHandler<CompanyInput> = (values) => {
    startTransition(async () => {
      const res = await upsertCompany(orgSlug, values);

      if (!res.success) {
        form.setError("root", { message: res.error });
        return;
      }

      form.reset();
      onClose();
      onSuccess?.(res.data);
    });
  };

 const isDirty = form.formState.isDirty;

const { handleOpenChange, showConfirm, confirmDiscard, cancelDiscard  } =
  useDialogDismissGuard({
    onClose,
    hasChanges: isDirty,
  });

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-125 bg-bg-card">
          <DialogHeader className="border-b border-border-subtle py-2">
            <DialogTitle>
              {isEdit ? "Карточка компании" : "Добавить компанию"}
            </DialogTitle>
            <DialogDescription>
              Поставщики, салоны и подрядчики для спецификаций.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, (errors) => {
                console.log("Ошибки валидации Zod:", errors);
              })}
              className="flex flex-col gap-4"
            >
              {/* Название компании */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Название компании *</FormLabel>
                    <FormControl>
                      <Input placeholder="Kerama Marazzi" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Выбор нескольких категорий (Мультиселект-чипсы) */}
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

              {/* Сайт и Email */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Сайт</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://example.com"
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Эл. почта</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="info@example.com"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Телефон и Адрес */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Адрес / Город</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Москва, ARTPLAY"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Заметки */}
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Заметки</FormLabel>
                    <FormControl>
                      <textarea
                        className="w-full min-h-16 border border-input bg-bg-card rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-border"
                        placeholder="Особые условия, персональные скидки..."
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Ошибки сервера */}
              {form.formState.errors.root && (
                <p className="text-sm font-medium text-destructive">
                  {form.formState.errors.root.message}
                </p>
              )}

              {/* Кнопки действия */}
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
                  {isPending && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Сохранить
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Диалог подтверждения выхода */}
      <AlertDialog
        open={showConfirm}
        onOpenChange={(v) => !v && cancelDiscard()}
      >
        <AlertDialogContent className="w-fit min-w-120">
          <AlertDialogHeader>
            <AlertDialogTitle>Несохранённые изменения</AlertDialogTitle>
            <AlertDialogDescription>
              Вы заполнили поля формы. Вы действительно хотите закрыть окно? Все
              введённые данные будут потеряны.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg" onClick={cancelDiscard}>
              Продолжить редактирование
            </AlertDialogCancel>
            <AlertDialogAction
              size="lg"
              onClick={confirmDiscard}
              variant="destructive"
            >
              Сбросить и закрыть
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
