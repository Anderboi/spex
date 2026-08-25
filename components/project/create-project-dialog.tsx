"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Loader2, CloudUpload, X } from "lucide-react";

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
import { upsertProject, uploadProjectImage } from "@/actions/projects";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { RoomsEditor } from "@/components/spec-builder/rooms-editor";

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
  const [isUploading, setIsUploading] = useState(false);
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
      rooms: [],
    },
  });

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadProjectImage(orgSlug, fd);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      form.setValue("cover_url", res.url, { shouldValidate: true });
    } catch {
      toast.error("Не удалось загрузить изображение");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

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

            {/* Обложка */}
            <FormField
              control={form.control}
              name="cover_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Обложка
                  </FormLabel>
                  <FormControl>
                    <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-dashed border-border-muted bg-bg p-3">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFile}
                        disabled={isUploading}
                      />
                      {field.value ? (
                        <Image
                          alt="Обложка проекта"
                          src={field.value}
                          width={64}
                          height={64}
                          className="size-16 rounded-[10px] object-cover"
                        />
                      ) : (
                        <div className="flex size-16 items-center justify-center rounded-[10px] bg-bg-select text-fg-muted">
                          {isUploading ? (
                            <Loader2 className="size-5 animate-spin" />
                          ) : (
                            <CloudUpload className="size-5" />
                          )}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-fg">
                          {isUploading
                            ? "Загрузка…"
                            : field.value
                              ? "Заменить обложку"
                              : "Загрузить изображение"}
                        </p>
                        <p className="text-[11.5px] text-fg-muted">
                          JPG, PNG · до 5 МБ
                        </p>
                      </div>
                      {field.value && (
                        <button
                          type="button"
                          onClick={() => field.onChange(null)}
                          aria-label="Убрать обложку"
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-bg-select"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </label>
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

            {/* Состав помещений */}
            <FormField
              control={form.control}
              name="rooms"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Состав помещений{" "}
                    <span className="font-normal normal-case text-fg-muted/70">
                      · опционально
                    </span>
                  </FormLabel>
                  <RoomsEditor
                    rooms={field.value ?? []}
                    onChange={(rooms) => field.onChange(rooms)}
                  />
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
