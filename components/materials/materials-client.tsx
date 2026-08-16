"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { CompanyInput, ContactInput, MaterialInput } from "@/lib/validations";
import {
  deleteMaterial,
  upsertMaterial,
} from "@/app/(protected)/materials/actions";
import { MaterialDialog } from "./material-dialog";
import { usePathname, useRouter } from "next/navigation";
import MaterialCard from "./material-card";

interface MaterialsClientProps {
  initialMaterials: MaterialInput[];
  companies: CompanyInput[];
  contacts: ContactInput[];
  searchParams?: { q?: string; sort?: string; action?: string };
}
type OptimisticAction =
  | { type: "save"; payload: MaterialInput }
  | { type: "delete"; payload: string };

export function MaterialsClient({
  initialMaterials,
  searchParams,
  companies,
  contacts,
}: MaterialsClientProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialInput | null>(
    null,
  );
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (searchParams?.action === "create") {
      setEditingMaterial(null);
      setIsDialogOpen(true);
    }
  }, [searchParams?.action]);

  const closeDialog = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingMaterial(null);
      if (searchParams?.action) {
        // Очищаем action из URL при закрытии
        const params = new URLSearchParams(window.location.search);
        params.delete("action");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    }
  };

  const [optimisticMaterials, setOptimisticMaterials] = useOptimistic(
    initialMaterials,
    (state, action: OptimisticAction) => {
      if (action.type === "delete") {
        return state.filter((m) => m.id !== action.payload);
      }
      if (action.type === "save") {
        const item = action.payload;
        const exists = state.some((m) => m.id === item.id);
        if (exists) {
          return state.map((m) => (m.id === item.id ? { ...m, ...item } : m));
        }
        return [{ ...item, id: item.id || `temp-${Date.now()}` }, ...state];
      }
      return state;
    },
  );

  const q = searchParams?.q?.toLowerCase() || "";
  const sort = searchParams?.sort || "";

  const filteredAndSortedMaterials = useMemo(() => {
    let result = [...optimisticMaterials];

    if (q) {
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.article?.toLowerCase().includes(q) ||
          m.brand?.toLowerCase().includes(q),
      );
    }

    if (sort === "name_asc") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "price_asc") {
      result.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sort === "price_desc") {
      result.sort((a, b) => (b.price || 0) - (a.price || 0));
    }

    return result;
  }, [optimisticMaterials, q, sort]);

  const handleEdit = (mat: MaterialInput) => {
    setEditingMaterial(mat);
    setIsDialogOpen(true);
  };

  const handleDelete = (id?: string) => {
    if (!id) return;
    if (!confirm("Вы уверены, что хотите удалить этот материал?")) return;

    startTransition(async () => {
      setOptimisticMaterials({ type: "delete", payload: id });
      const res = await deleteMaterial(id);
      if (!res.success) {
        alert(res.error || "Ошибка при удалении");
      }
    });
  };

  const handleSave = (data: MaterialInput) => {
    startTransition(async () => {
      setOptimisticMaterials({ type: "save", payload: data });
      const res = await upsertMaterial(data);
      if (!res.success) {
        alert(res.error || "Ошибка сохранения");
      }
    });
  };

  return (
    <article>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedMaterials.map((mat) => (
          <MaterialCard
            key={mat.id}
            mat={mat}
            handleEdit={handleEdit}
            handleDelete={handleDelete}
          />
        ))}
      </div>

      <MaterialDialog
        open={isDialogOpen}
        onOpenChange={closeDialog}
        companies={companies}
        contacts={contacts}
        materialToEdit={editingMaterial}
        onSave={handleSave}
      />
    </article>
  );
}
