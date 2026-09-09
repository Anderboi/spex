"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import type { ProjectInput, ProjectStatus } from "@/lib/validations";
import { useDialogUrl } from "@/hooks/use-dialog-url";
import { ProjectDialog } from "./project-dialog";

/**
 * Поля проекта, которые редактируются на странице спецификации.
 * По составу совпадают с выборкой getProjectById (lib/queries).
 */
export interface EditableProject {
  id: string;
  title: string;
  client_name: string | null;
  accent_color: string | null;
  cover_url: string | null;
  address: string | null;
  budget: number | null;
  status: string;
  type: string | null;
  rooms: string[];
}

function toProjectInput(p: EditableProject): ProjectInput {
  return {
    id: p.id,
    title: p.title,
    client_name: p.client_name ?? "",
    accent_color: p.accent_color ?? "#000000",
    cover_url: p.cover_url ?? null,
    address: p.address ?? "",
    budget: p.budget ?? 0,
    status: (p.status || "draft") as ProjectStatus,
    type: (p.type || "Интерьер") as ProjectInput["type"],
    rooms: p.rooms ?? [],
  };
}

interface EditProjectDialogProps {
  orgSlug: string;
  project: EditableProject;
}

/**
 * Модалка «Редактировать проект» на странице спецификации.
 * Управляется URL: ?action=edit — по этой ссылке ведёт кнопка-карандаш
 * в шапке страницы. Сама форма переиспользует общий ProjectDialog.
 */
export function EditProjectDialog({
  orgSlug,
  project,
}: EditProjectDialogProps) {
  const router = useRouter();
  const { value: action, close: closeDialog } = useDialogUrl("action");
  const isOpen = action === "edit";

  // Стабильная ссылка: пересоздаётся только при реальном обновлении данных
  // проекта (router.refresh после сохранения), а не на каждом ре-рендере.
  const initialData = useMemo(() => toProjectInput(project), [project]);

  const handleSuccess = () => {
    closeDialog();
    // Перерисовываем серверную часть страницы, чтобы заголовок в PageHeader
    // и остальные данные проекта обновились без полной перезагрузки.
    router.refresh();
  };

  return (
    <ProjectDialog
      orgSlug={orgSlug}
      open={isOpen}
      onClose={closeDialog}
      initialData={initialData}
      onSuccess={handleSuccess}
    />
  );
}
