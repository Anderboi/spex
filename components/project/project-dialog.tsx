"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, CloudUpload, X } from "lucide-react";

import { projectSchema, ProjectInput } from "@/lib/validations";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { upsertProject, uploadProjectImage } from "@/actions/projects";
import Image from "next/image";
import { toast } from "sonner";
import { RoomsEditor } from "@/components/spec-builder/rooms-editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDialogDismissGuard } from "@/components/ui/use-dialog-dismiss-guard";

interface ProjectDialogProps {
  orgSlug: string;
  /** Управляется снаружи (URL-параметр или локальное состояние). */
  open: boolean;
  /** Запрос на закрытие. Гвард несохранённых изменений применяется внутри. */
  onClose: () => void;
  /** Данные для предзаполнения; заданы → режим редактирования. */
  initialData?: ProjectInput | null;
  /** Вызывается после успешного сохранения (создания или обновления). */
  onSuccess?: (projectId: string) => void;
}

const ACCENT_COLORS = [
  "#000000",
  "#2563EB",
  "#059669",
  "#D97706",
  "#DC2626",
  "#7C3AED",
];

function emptyProjectValues(): ProjectInput {
  return {
    title: "",
    client_name: "",
    accent_color: "#000000",
    status: "draft",
    cover_url: null,
    address: "",
    budget: 0,
    type: "Интерьер",
    rooms: [],
  };
}

export function ProjectDialog({
  orgSlug,
  open,
  onClose,
  initialData = null,
  onSuccess,
}: ProjectDialogProps) {
  const isEditing = Boolean(initialData);
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);

  // Начальные значения — только на первом рендере: повторные ре-рендеры
  // (пока диалог открыт) не должны сбрасывать введённое пользователем.
  const [bootValues] = useState(() => initialData ?? emptyProjectValues());

  const form = useForm({
    resolver: zodResolver(projectSchema),
    defaultValues: bootValues,
  });

  const prevOpenRef = useRef(false);
  useEffect(() => {
    // Сброс только в момент открытия (false→true): свежий initialData
    // (например после router.refresh) попадает в поля до начала правок.
    if (open && !prevOpenRef.current) {
      form.reset(initialData ?? emptyProjectValues());
    }
    prevOpenRef.current = open;
  }, [open, initialData, form]);

  const isDirty = form.formState.isDirty;
  const { handleOpenChange, showConfirm, confirmDiscard, cancelDiscard } =
    useDialogDismissGuard({
      onClose,
      hasChanges: isDirty,
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
      form.setValue("cover_url", res.url, {
        shouldValidate: true,
        shouldDirty: true,
      });
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
          message:
            res.error ||
            (isEditing
              ? "Не удалось сохранить проект"
              : "Не удалось создать проект"),
        });
        return;
      }

      form.reset();
      onSuccess?.(res.data.id);
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-170 max-h-[88vh] flex-col bg-bg border-border-muted p-0 gap-0">
          <DialogHeader className="sticky top-0 gap-2 border-b p-4">
            <DialogTitle className="text-xl font-bold tracking-tight">
              {isEditing ? "Редактировать проект" : "Новый проект"}
            </DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <ScrollArea className="h-[66svh] p-4">
                <article className=" flex flex-col gap-4">
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
                            className=" placeholder:text-fg-muted focus:border-border-dash-input"
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
                            className="text-fg placeholder:text-fg-muted focus:border-border-dash-input"
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
                            className=" text-fg placeholder:text-fg-muted focus:border-border-dash-input"
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
                            className=" text-fg placeholder:text-fg-muted focus:border-border-dash-input"
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
                </article>
              </ScrollArea>
              {/* Кнопки действий */}
              <DialogFooter className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
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
                      {isEditing ? "Сохранение..." : "Создание..."}
                    </>
                  ) : isEditing ? (
                    "Сохранить"
                  ) : (
                    "Создать проект"
                  )}
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
              {isEditing
                ? "Вы изменили данные проекта. При закрытии несохранённые параметры будут сброшены."
                : "Вы начали заполнение данных проекта. При закрытии несохранённые параметры будут сброшены."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg" onClick={cancelDiscard}>
              Продолжить заполнение
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


