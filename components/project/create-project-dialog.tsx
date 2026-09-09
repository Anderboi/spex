"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useDialogUrl } from "@/hooks/use-dialog-url";
import { ProjectDialog } from "./project-dialog";

interface CreateProjectDialogProps {
  orgSlug: string;
}

export function CreateProjectDialog({ orgSlug }: CreateProjectDialogProps) {
  const router = useRouter();
  const { value: action, hrefFor, close: closeDialog } = useDialogUrl("action");

  // Диалог управляется URL: открытие — это переход на ?action=create
  // (кнопка — обычный <Link>, состояние не хранится в компоненте).
  const isOpen = action === "create";
  const createHref = hrefFor("create");

  return (
    <>
      <Button
        nativeButton={false}
        render={
          <Link
            className="flex h-10 items-center gap-2 bg-bg-accent text-bg border-none rounded-lg px-6 text-[15px] font-semibold cursor-pointer"
            href={createHref}
          />
        }
      >
        <Plus className="size-4 shrink-0" /> Новый проект
      </Button>

      <ProjectDialog
        orgSlug={orgSlug}
        open={isOpen}
        onClose={closeDialog}
        onSuccess={(projectId) => {
          // replace, а не push: запись ?action=create не должна оставаться
          // в истории — кнопка «Назад» из проекта вернёт на чистый список,
          // а не в уже созданный диалог.
          router.replace(`/${orgSlug}/projects/${projectId}`);
        }}
      />
    </>
  );
}
