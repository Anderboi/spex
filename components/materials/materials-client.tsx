"use client";

import { useOptimistic, useTransition } from "react";
import { type MaterialInput } from "@/lib/validations";
import { deleteMaterial, upsertMaterial } from "@/actions/materials";
import { MaterialDialog } from "./material-dialog";
import { useSearchParams } from "next/navigation";
import { useDialogUrl } from "@/hooks/use-dialog-url";
import MaterialCard from "./material-card";
import type {
  MaterialListItem,
  SpecPickerCompany,
  SpecPickerContact,
} from "@/lib/queries";
import { toListItem, toFormValues } from "@/lib/spec/adapters";

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
  const {
    value: action,
    open: openDialog,
    close: closeDialog,
  } = useDialogUrl("action");
  const [, startTransition] = useTransition();

  const [optimisticMaterials, setOptimisticMaterials] = useOptimistic(
    initialMaterials,
    (
      state: MaterialListItem[],
      action: OptimisticAction,
    ): MaterialListItem[] => {
      if (action.type === "delete") {
        return state.filter((m) => m.id !== action.payload);
      }
      const input = action.payload;
      const prev = state.find((m) => m.id === input.id);
      if (prev) {
        return state.map((m) => (m.id === input.id ? toListItem(input, m) : m));
      }
      return [toListItem(input), ...state];
    },
  );

  // Диалог управляется URL: ?action=create / ?action=edit&id=<materialId>.
  // Никакого useState — состояние берётся напрямую из search params.
  const editId = searchParams.get("id");
  const editingItem =
    action === "edit" && editId
      ? optimisticMaterials.find((m) => m.id === editId)
      : undefined;
  const isDialogOpen = action === "create" || Boolean(editingItem);
  const materialToEdit = editingItem ? toFormValues(editingItem) : null;

  const handleEdit = (m: MaterialListItem) => {
    openDialog("edit", { id: m.id });
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) closeDialog();
  };

  const handleDelete = (id?: string) => {
    if (!id) return;
    if (!confirm("Вы уверены, что хотите удалить этот материал?")) return;

    startTransition(async () => {
      setOptimisticMaterials({ type: "delete", payload: id });
      const res = await deleteMaterial(orgSlug, id);
      if (!res.success) {
        alert(res.error || "Ошибка при удалении");
      }
    });
  };

  const handleSave = (data: MaterialInput) => {
    startTransition(async () => {
      setOptimisticMaterials({ type: "save", payload: data });
      const res = await upsertMaterial(orgSlug, data);
      if (!res.success) {
        alert(res.error || "Ошибка сохранения");
      }
    });
  };

  return (
    <article>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {optimisticMaterials.map((mat) => (
          <MaterialCard
            key={mat.id}
            mat={mat}
            handleEdit={handleEdit}
            handleDelete={handleDelete}
          />
        ))}
      </div>

      {optimisticMaterials.length === 0 && (
        <p className="py-14 text-center text-sm text-fg-muted">
          Ничего не найдено — измените фильтры или запрос.
        </p>
      )}

      <MaterialDialog
        open={isDialogOpen}
        orgSlug={orgSlug}
        onOpenChange={handleDialogOpenChange}
        companies={companies}
        contacts={contacts}
        materialToEdit={materialToEdit}
        onSave={handleSave}
      />
    </article>
  );
}
