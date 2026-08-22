"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { type MaterialInput } from "@/lib/validations";
import {
  deleteMaterial,
  upsertMaterial,
} from "@/actions/materials";
import { MaterialDialog } from "./material-dialog";
import { usePathname, useRouter } from "next/navigation";
import MaterialCard from "./material-card";
import TypeChipsSection from "../spec-builder/TypeChipsSection";
import { MaterialListItem, SpecPickerCompany, SpecPickerContact } from '@/lib/queries';
import { toListItem, toFormValues } from '@/lib/spec/adapters';

interface MaterialsClientProps {
  orgSlug: string;
  initialMaterials: MaterialListItem[];
  companies: SpecPickerCompany[];
  contacts: SpecPickerContact[];
  searchParams: { q?: string; sort?: string; action?: string; id?: string };
}
type OptimisticAction =
  | { type: "save"; payload: MaterialInput }
  | { type: "delete"; payload: string };

export function MaterialsClient({
  initialMaterials,
  searchParams,
  companies,
  contacts,
  orgSlug,
}: MaterialsClientProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialInput | null>(
    null,
  );
  const [, startTransition] = useTransition();

  const [selectedCategory, setSelectedCategory] = useState("Все типы");

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

    if (selectedCategory !== "Все типы") {
      result = result.filter((m) => m.category === selectedCategory);
    }

    if (sort === "name_asc") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "price_asc") {
      result.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sort === "price_desc") {
      result.sort((a, b) => (b.price || 0) - (a.price || 0));
    }

    return result;
  }, [optimisticMaterials, q, sort, selectedCategory]);

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
      <TypeChipsSection
        activeType={selectedCategory}
        setActiveType={setSelectedCategory}
        className="mb-4"
      />
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
