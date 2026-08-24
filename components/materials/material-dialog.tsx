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
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "@/lib/utils";
import { Building2, Check, ChevronsUpDown, CloudUpload, Loader2, User } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { TYPE_ORDER, UNIT_OPTIONS } from "@/lib/constants";
import { SpecPickerCompany, SpecPickerContact } from "@/lib/queries";
import { ScrollArea } from "../ui/scroll-area";
import Image from "next/image";
import { toast } from "sonner";
import { uploadMaterialImage } from "@/actions/materials";

interface MaterialDialogProps {
  open: boolean;
  orgSlug: string;
  companies?: SpecPickerCompany[];
  contacts?: SpecPickerContact[];
  onOpenChange: (open: boolean) => void;
  materialToEdit?: MaterialInput | null;
  onSave: (data: MaterialInput) => void;
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
}: MaterialDialogProps) {
  const [searchOpen, setSearchOpen] = useState(false);
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
    },
  });

  useEffect(() => {
    if (open) {
      if (materialToEdit) {
        form.reset({
          ...materialToEdit,
          brand: materialToEdit.brand ?? "",
          article: materialToEdit.article ?? "",
          company_id: materialToEdit.company_id ?? null,
          contact_id: materialToEdit.contact_id ?? null,
          image_url: materialToEdit.image_url ?? null,
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
        });
      }
    }
  }, [open, materialToEdit, form]);

  const currentCompanyId = form.watch("company_id");
  const currentContactId = form.watch("contact_id");
  const imageUrl = form.watch("image_url");

  const selectedCompany = companies.find((c) => c.id === currentCompanyId);
  const selectedContact = contacts.find((c) => c.id === currentContactId);

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    const payload: MaterialInput = {
      ...values,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                        <FormControl>
                          <Input
                            placeholder="Керамогранит"
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
                    name="brand"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Бренд</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Kerama Marazzi"
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

                <FormItem className="flex flex-col">
                  <FormLabel>Поставщик / Менеджер</FormLabel>
                  <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                    <PopoverTrigger
                      render={
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={searchOpen}
                            className={cn(
                              "w-full h-10 justify-between font-normal bg-bg-card",
                              !currentCompanyId &&
                                !currentContactId &&
                                "text-fg-muted",
                            )}
                          >
                            {currentContactId && selectedContact ? (
                              <div className="flex items-center gap-2 truncate">
                                <User className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate">
                                  {selectedContact.name}
                                  {selectedContact.name &&
                                    ` (${selectedContact.name})`}
                                </span>
                              </div>
                            ) : currentCompanyId && selectedCompany ? (
                              <div className="flex items-center gap-2 truncate">
                                <Building2 className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate">
                                  {selectedCompany.name}
                                </span>
                              </div>
                            ) : (
                              "Выберите компанию или контакт..."
                            )}
                            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      }
                    ></PopoverTrigger>
                    <PopoverContent
                      className="w-95 p-0 bg-bg-card"
                      align="start"
                    >
                      <Command>
                        <CommandInput placeholder="Поиск компании или менеджера..." />
                        <CommandList>
                          <CommandEmpty>Поставщик не найден.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="none"
                              onSelect={() => {
                                form.setValue("company_id", null);
                                form.setValue("contact_id", null);
                                setSearchOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  !currentCompanyId && !currentContactId
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <span className="text-muted-foreground">
                                Без поставщика
                              </span>
                            </CommandItem>
                          </CommandGroup>
                          {companies.length > 0 && (
                            <CommandGroup heading="Компании">
                              {companies.map((company) => {
                                const isSelected =
                                  currentCompanyId === company.id &&
                                  !currentContactId;
                                return (
                                  <CommandItem
                                    key={`company-${company.id}`}
                                    value={`company ${company.name}`}
                                    onSelect={() => {
                                      form.setValue("company_id", company.id);
                                      form.setValue("contact_id", null);
                                      setSearchOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        isSelected
                                          ? "opacity-100"
                                          : "opacity-0",
                                      )}
                                    />
                                    <Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium">
                                      {company.name}
                                    </span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          )}

                          {contacts.length > 0 && (
                            <CommandGroup heading="Контакты">
                              {contacts.map((contact) => {
                                const isSelected =
                                  currentContactId === contact.id;
                                return (
                                  <CommandItem
                                    key={`contact-${contact.id}`}
                                    value={`contact ${contact.name} ${contact.name || ""}`}
                                    onSelect={() => {
                                      form.setValue("contact_id", contact.id);
                                      form.setValue(
                                        "company_id",
                                        contact.company_id || null,
                                      );
                                      setSearchOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        isSelected
                                          ? "opacity-100"
                                          : "opacity-0",
                                      )}
                                    />
                                    <User className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <div className="flex flex-col">
                                      <span className="font-medium">
                                        {contact.name}
                                      </span>
                                      {contact.name && (
                                        <span className="text-xs text-muted-foreground">
                                          {contact.name}
                                        </span>
                                      )}
                                    </div>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
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
  );
}
