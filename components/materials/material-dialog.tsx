"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MaterialInput,
  materialSchema,
} from "@/lib/validations";
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
import { Building2, Check, ChevronsUpDown, User } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { TYPE_ORDER, UNIT_OPTIONS } from '@/lib/constants';
import { SpecPickerCompany, SpecPickerContact } from '@/lib/queries';

interface MaterialDialogProps {
  open: boolean;
  companies?: SpecPickerCompany[];
  contacts?: SpecPickerContact[];
  onOpenChange: (open: boolean) => void;
  materialToEdit?: MaterialInput | null;
  onSave: (data: MaterialInput) => void;
}

type FormValues = z.infer<typeof materialSchema>;

export function MaterialDialog({
  open,
  companies = [],
  contacts = [],
  onOpenChange,
  materialToEdit,
  onSave,
}: MaterialDialogProps) {
  const [searchOpen, setSearchOpen] = useState(false);

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
        });
      }
    }
  }, [open, materialToEdit, form]);

  const currentCompanyId = form.watch("company_id");
  const currentContactId = form.watch("contact_id");

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125 bg-bg-card">
        <DialogHeader>
          <DialogTitle>
            {materialToEdit
              ? "Редактировать материал"
              : "Добавить в библиотеку"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Наименование *</FormLabel>
                  <FormControl>
                    <Input placeholder="Керамогранит Calacatta..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Категория *</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className="w-full h-8 px-3 rounded-md border border-input bg-bg-card text-sm"
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
            <div className="grid grid-cols-2 gap-3">
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
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
                          "w-full justify-between font-normal bg-bg-card",
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
                <PopoverContent className="w-95 p-0 bg-bg-card" align="start">
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
                                    isSelected ? "opacity-100" : "opacity-0",
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
                            const isSelected = currentContactId === contact.id;
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
                                    isSelected ? "opacity-100" : "opacity-0",
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

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">Сохранить</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
