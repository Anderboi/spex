"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { type MaterialInput } from "@/lib/validations";
import { deleteMaterial, upsertMaterial } from "@/actions/materials";
import { MaterialDialog } from "./material-dialog";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialInput | null>(
    null,
  );
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (searchParams.get("action") === "create") {
      setEditingMaterial(null);
      setIsDialogOpen(true);
    }
  }, [searchParams]);

  const closeDialog = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingMaterial(null);
      if (searchParams.get("action")) {
        // Очищаем action из URL при закрытии
        const params = new URLSearchParams(searchParams.toString());
        params.delete("action");
        const qs = params.toString();
        startTransition(() => {
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        });
      }
    }
  };

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

  const handleEdit = (m: MaterialListItem) => {
    setEditingMaterial(toFormValues(m));
    setIsDialogOpen(true);
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
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
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
        onOpenChange={closeDialog}
        companies={companies}
        contacts={contacts}
        materialToEdit={editingMaterial}
        onSave={handleSave}
      />
    </article>
  );
}
