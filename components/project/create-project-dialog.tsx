"use client";

import { useState, useTransition } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Loader2 } from "lucide-react";

import { projectSchema, ProjectInput } from "@/lib/validations";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { upsertProject } from "@/actions/projects";
import { useRouter } from "next/navigation";

interface CreateProjectDialogProps {
  orgSlug: string;
  trigger?: React.ReactNode;
}

const ACCENT_COLORS = [
  "#000000",
  "#2563EB",
  "#059669",
  "#D97706",
  "#DC2626",
  "#7C3AED",
];

export function CreateProjectDialog({
  orgSlug,
  trigger,
}: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Явно указываем типы в useForm<FormInput, Context, FormOutput>
  const form = useForm({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      title: "",
      client_name: "",
      accent_color: "#000000",
      status: "draft",
      cover_url: null,
      address: "",
      budget: 0,
      type: "Интерьер",
    },
  });

  const onSubmit: SubmitHandler<ProjectInput> = (values) => {
    startTransition(async () => {
      const res = await upsertProject(orgSlug, values);

      if (!res.success) {
        form.setError("root", {
          message: res.error || "Не удалось создать проект",
        });
        return;
      }

      form.reset();
      setOpen(false);
      router.push(`/${orgSlug}/projects/${res.data.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="flex h-10 items-center gap-2 bg-bg-accent text-bg border-none rounded-lg px-6 text-[15px] font-semibold cursor-pointer" />
        }
      >
        <Plus className="size-4 shrink-0" /> Новый проект
      </DialogTrigger>

      <DialogContent className="sm:max-w-120 bg-bg-card border-border-muted rounded-[20px] p-6 text-fg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight">
            Новый проект
          </DialogTitle>
          <DialogDescription className="text-sm text-fg-muted mt-1">
            Создайте рабочий профиль объекта для управления материалами и
            спецификацией.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5 mt-4"
          >
            {form.formState.errors.root && (
              <div className="p-3 text-xs font-medium bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg">
                {form.formState.errors.root.message}
              </div>
            )}

            {/* Название проекта */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Название объекта / проекта *
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Например: Апартаменты в ЖК Prime"
                      className="bg-bg border-border-muted rounded-[12px] h-11 text-fg placeholder:text-fg-muted focus:border-border-dash-input"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs text-red-500" />
                </FormItem>
              )}
            />

            {/* Заказчик / Клиент */}
            <FormField
              control={form.control}
              name="client_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Заказчик
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Имя или фамилия клиента"
                      className="bg-bg border-border-muted rounded-[12px] h-11 text-fg placeholder:text-fg-muted focus:border-border-dash-input"
                      value={field.value || ""}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage className="text-xs text-red-500" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Адрес
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Адрес объекта"
                      className="bg-bg border-border-muted rounded-[12px] h-11 text-fg placeholder:text-fg-muted focus:border-border-dash-input"
                      value={field.value || ""}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage className="text-xs text-red-500" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="budget"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Ориентировочный бюджет
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="10 000 000 ₽"
                      className="bg-bg border-border-muted rounded-[12px] h-11 text-fg placeholder:text-fg-muted focus:border-border-dash-input"
                      value={field.value ?? 0}
                      onChange={(e) => {
                        const val = e.target.value;
                        field.onChange(val === "" ? 0 : Number(val));
                      }}
                    />
                  </FormControl>
                  <FormMessage className="text-xs text-red-500" />
                </FormItem>
              )}
            />

            {/* Акцентный цвет */}
            <FormField
              control={form.control}
              name="accent_color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Акцентный цвет карточки
                  </FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2.5 pt-1">
                      {ACCENT_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => field.onChange(color)}
                          className={`size-8 rounded-full transition-all border-2 ${
                            field.value === color
                              ? "border-fg scale-110 shadow-sm"
                              : "border-transparent opacity-80 hover:opacity-100"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage className="text-xs text-red-500" />
                </FormItem>
              )}
            />

            {/* Кнопки действий */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-muted">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded-[11px] h-11 border-border-muted text-fg hover:bg-bg-select"
              >
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="bg-bg-accent text-bg hover:bg-bg-accent/90 rounded-[11px] h-11 font-medium px-6"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Создание...
                  </>
                ) : (
                  "Создать проект"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
