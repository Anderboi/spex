"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { type MaterialInput } from "@/lib/validations";
import {
  deleteMaterial,
  listMaterialProjectTargets,
  upsertMaterial,
} from "@/actions/materials";
import { MaterialDialog } from "./material-dialog";
import { AttachToProjectDialog } from "./attach-to-project-dialog";
import { useSearchParams } from "next/navigation";
import { useDialogUrl } from "@/hooks/use-dialog-url";
import { useMaterialsUrl } from "@/hooks/use-materials-url";
import MaterialCard from "./material-card";
import type { CompanyOption } from "@/components/layout/company-picker";
import type {
  MaterialListItem,
  MaterialProjectTarget,
  SpecPickerCompany,
  SpecPickerContact,
} from "@/lib/queries";
import { toListItem, toFormValues } from "@/lib/spec/adapters";
import { Button } from "@/components/ui/button";
import { PackageOpen, Plus, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";

interface MaterialsClientProps {
  orgSlug: string;
  initialMaterials: MaterialListItem[];
  companies: SpecPickerCompany[];
  contacts: SpecPickerContact[];
}
type OptimisticAction =
  | { type: "save"; payload: MaterialInput }
  | { type: "delete"; payload: string };

export function MaterialsClient({
  initialMaterials,
  companies,
  contacts,
  orgSlug,
}: MaterialsClientProps) {
  const searchParams = useSearchParams();
  const { update, isPending } = useMaterialsUrl();
  /**
   * Диалоги открываются «shallow»: URL меняется через History API, но страница
   * не перерисовывается на сервере. Иначе каждое открытие окна материала ждало
   * бы полный серверный рендер библиотеки — выборку материалов, компаний и
   * контактов — хотя всё это уже есть на клиенте.
   */
  const {
    value: action,
    linkProps,
    open: openDialog,
    close: closeDialog,
  } = useDialogUrl("action", [], { shallow: true });
  const [, startTransition] = useTransition();

  /**
   * Компании, созданные из диалога материала через CompanyPicker. Живут здесь,
   * а не внутри диалога: имя нужно ещё и оптимистичной карточке, иначе сразу
   * после сохранения она показала бы пустого поставщика до прихода
   * `revalidatePath`. Свежие пропсы побеждают — сервер авторитетнее.
   */
  const [createdCompanies, setCreatedCompanies] = useState<CompanyOption[]>([]);
  const companyOptions = useMemo(() => {
    if (createdCompanies.length === 0) return companies;
    const byId = new Map(createdCompanies.map((c) => [c.id, c]));
    for (const c of companies) byId.set(c.id, c);
    return [...byId.values()];
  }, [companies, createdCompanies]);

  /**
   * Имена поставщика и менеджера для оптимистичной записи: форма отдаёт только
   * id, а `revalidatePath` приедет позже. Справочник уже загружен в пропсы,
   * поэтому имя резолвится на клиенте и карточка не мигает пустым поставщиком.
   */
  const companyNames = useMemo(
    () => new Map(companyOptions.map((c) => [c.id, c.name])),
    [companyOptions],
  );
  const contactNames = useMemo(
    () => new Map(contacts.map((c) => [c.id, c.name])),
    [contacts],
  );

  const [optimisticMaterials, setOptimisticMaterials] = useOptimistic(
    initialMaterials,
    (
      state: MaterialListItem[],
      action: OptimisticAction,
    ): MaterialListItem[] => {
      if (action.type === "delete") {
        return state.filter((m) => m.id !== action.payload);
      }

      const withSupplier = (item: MaterialListItem): MaterialListItem => ({
        ...item,
        companyName:
          item.companyName || companyNames.get(item.companyId ?? "") || "",
        contactName:
          item.contactName || contactNames.get(item.contactId ?? "") || "",
      });

      const input = action.payload;
      const prev = state.find((m) => m.id === input.id);
      if (prev) {
        return state.map((m) =>
          m.id === input.id ? withSupplier(toListItem(input, m)) : m,
        );
      }
      return [withSupplier(toListItem(input)), ...state];
    },
  );

  // Диалог управляется URL: ?action=create / ?action=edit&id=<materialId> /
  // ?action=to-project&id=<materialId>. Никакого useState для «открыт/закрыт» —
  // состояние берётся из search params, которые обновляются мгновенно (shallow,
  // см. `useDialogUrl`), поэтому окно появляется без ожидания сервера.
  const dialogId = searchParams.get("id");
  const editingItem =
    action === "edit" && dialogId
      ? optimisticMaterials.find((m) => m.id === dialogId)
      : undefined;
  const isDialogOpen = action === "create" || Boolean(editingItem);
  const materialToEdit = editingItem ? toFormValues(editingItem) : null;

  // Цели для «В проект» — единственные данные диалога, которых нет на клиенте,
  // поэтому их запрашивает сам диалог (см. эффект ниже), а не серверный рендер
  // страницы. `null` в состоянии = «ещё не приехали» → в диалоге скелет.
  const attachingMaterial =
    action === "to-project" && dialogId
      ? (optimisticMaterials.find((m) => m.id === dialogId) ?? null)
      : null;

  const [targets, setTargets] = useState<{
    materialId: string;
    rows: MaterialProjectTarget[];
  } | null>(null);

  useEffect(() => {
    if (action !== "to-project" || !dialogId) return;

    let cancelled = false;
    listMaterialProjectTargets(orgSlug, dialogId)
      .then((rows) => {
        if (!cancelled) setTargets({ materialId: dialogId, rows });
      })
      .catch((error) => {
        // Список проектов — не то место, где стоит держать вечный скелет:
        // показываем пустое состояние (его же увидит и «проектов нет»).
        console.error("[materials] не удалось загрузить проекты", error);
        if (!cancelled) setTargets({ materialId: dialogId, rows: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [action, dialogId, orgSlug]);

  const handleEdit = useCallback(
    (id: string) => {
      openDialog("edit", { id });
    },
    [openDialog],
  );

  const handleAttach = useCallback(
    (id: string) => {
      openDialog("to-project", { id });
    },
    [openDialog],
  );

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeDialog();
    },
    [closeDialog],
  );

  const handleDelete = useCallback(
    (id: string) => {
      startTransition(async () => {
        setOptimisticMaterials({ type: "delete", payload: id });
        const res = await deleteMaterial(orgSlug, id);
        if (!res.success) {
          toast.error("Не удалось удалить материал", {
            description: res.error,
          });
          return;
        }
        toast.success("Материал удалён");
      });
    },
    [orgSlug, setOptimisticMaterials],
  );

  const handleSave = useCallback(
    (data: MaterialInput) => {
      startTransition(async () => {
        setOptimisticMaterials({ type: "save", payload: data });
        const res = await upsertMaterial(orgSlug, data);
        if (!res.success) {
          toast.error("Не удалось сохранить материал", {
            description: res.error,
          });
          return;
        }
        toast.success(
          data.id ? "Изменения сохранены" : "Материал добавлен в библиотеку",
        );
      });
    },
    [orgSlug, setOptimisticMaterials],
  );

  const query = searchParams.get("query") ?? "";
  const isFiltered = Boolean(
    query ||
      searchParams.get("category") ||
      searchParams.get("manufacturer") ||
      searchParams.get("status"),
  );

  /** Выход из пустого результата: снимаем все фильтры, страница сбрасывается
      вместе с ними (см. RESET_PAGE_KEYS в lib/materials/filters.ts). */
  const handleResetFilters = useCallback(() => {
    update({ query: "", category: null, manufacturer: null, status: null });
  }, [update]);

  return (
    <article>
      <div
        className={`grid grid-cols-1 gap-3 transition-opacity md:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4 ${
          isPending ? "opacity-60" : ""
        }`}
      >
        {optimisticMaterials.map((mat) => (
          <MaterialCard
            key={mat.id}
            mat={mat}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onAttach={handleAttach}
          />
        ))}
      </div>

      {optimisticMaterials.length === 0 &&
        (isFiltered ? (
          <EmptyState
            icon={<Search className="size-6" />}
            title="Ничего не найдено"
            body="Попробуйте изменить запрос, категорию или производителя."
            action={
              <Button variant="outline" onClick={handleResetFilters}>
                <RotateCcw className="mr-2 size-4" /> Сбросить фильтры
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<PackageOpen className="size-6" />}
            title="Библиотека пуста"
            body="Добавьте первый материал — он станет доступен при сборке спецификаций."
            action={
              <Button
                nativeButton={false}
                render={<a {...linkProps("create")} />}
              >
                <Plus className="mr-2 size-4" /> Добавить материал
              </Button>
            }
          />
        ))}

      <MaterialDialog
        open={isDialogOpen}
        orgSlug={orgSlug}
        onOpenChange={handleDialogOpenChange}
        companies={companyOptions}
        contacts={contacts}
        materialToEdit={materialToEdit}
        onCompanyCreated={(company) =>
          setCreatedCompanies((prev) =>
            prev.some((c) => c.id === company.id) ? prev : [...prev, company],
          )
        }
        onSave={handleSave}
      />

      <AttachToProjectDialog
        open={action === "to-project"}
        orgSlug={orgSlug}
        material={attachingMaterial}
        // Строки показываем только для того материала, который открыт: при
        // повторном открытии старый список виден сразу, а свежий подменит его.
        targets={targets && targets.materialId === dialogId ? targets.rows : null}
        onOpenChange={handleDialogOpenChange}
      />
    </article>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        {icon}
      </div>
      <h3 className="mt-4 font-serif text-lg text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
