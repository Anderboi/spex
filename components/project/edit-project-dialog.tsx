"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  toProjectInput,
  type EditableProject,
} from "@/lib/projects/project-input";
import { useDialogUrl } from "@/hooks/use-dialog-url";
import { ProjectDialog } from "./project-dialog";

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
