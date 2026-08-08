"use client";

import { useTransition } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { companySchema, CompanyInput } from "@/lib/validations";
import { TYPE_ORDER } from "@/lib/types";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

interface CompanyDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CompanyDialog({
  open,
  onClose,
  onSuccess,
}: CompanyDialogProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<CompanyInput, any, CompanyInput>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      category: TYPE_ORDER[0],
      website: "",
      email: "",
      phone: "",
      address: "",
      note: "",
    },
  });

  const onSubmit: SubmitHandler<CompanyInput> = (values) => {
    startTransition(async () => {
      //TODO: Здесь вызываем Server Action вместо локального пропса
      // const res = await upsertCompany(values);
      form.reset();
      onClose();
      onSuccess?.();
    });
  };

  return (
    <Dialog
      open={open}
      // onClose={onClose}
      
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить компанию</DialogTitle>
          <DialogDescription>
            Поставщики, салоны и подрядчики для спецификаций.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Категория</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {TYPE_ORDER.map((c) => (
                          <option key={c} value={c}>
                            {c}
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
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Адрес / Город</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Москва, Центр дизайна ARTPLAY"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
