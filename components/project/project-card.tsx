"use client";

import { COVER_PALETTE, STATUS_CONFIG, TYPE_COLORS } from "@/lib/constants";
import { cn, fmtCompact, fmtDate, plural } from "@/lib/utils";
import type { ProjectListItem } from "@/lib/queries";
import { ProjectStatus } from "@/lib/validations";
import Link from "next/link";
import Image from "next/image";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import {
  MouseEvent,
  useCallback,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import {
  archiveProject,
  deleteProject,
  restoreProject,
} from "@/actions/projects";
import { useDialogUrl } from "@/hooks/use-dialog-url";
import { toProjectInput } from "@/lib/projects/project-input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import IconButtonBlock from "../layout/icon-button-block";
import { ProjectDialog } from "./project-dialog";

export function ProjectCard({
  orgSlug,
  project,
  index,
  canDeleteForever,
}: {
  orgSlug: string;
  project: ProjectListItem;
  index: number;
  /** Архив: окончательное удаление доступно только владельцу и администратору. */
  canDeleteForever: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  /**
   * Правка открывается по URL (`?action=edit&id=<id>`) «shallow»-переходом:
   * все поля проекта уже пришли в списке, поэтому страница не перерисовывается
   * на сервере и окно появляется мгновенно. Тот же search param читают все
   * карточки сетки, и «свою» правку карточка узнаёт по `id`.
   */
  const {
    value: action,
    open: openEditDialog,
    close: closeEditDialog,
  } = useDialogUrl("action", [], { shallow: true });

  /** Проект в архиве (мягко удалён) — набор действий у карточки другой. */
  const isArchived = project.deletedAt !== null;
  // Архивный проект сначала возвращают: правка в архиве не предлагается.
  const isEditing =
    !isArchived && action === "edit" && searchParams.get("id") === project.id;

  /**
   * Подтверждение окончательного удаления — состояние самой карточки: это не
   * адресуемое окно с данными, а короткий вопрос про одно действие.
   */
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isPending, startAction] = useTransition();

  const coverBg = COVER_PALETTE[index % COVER_PALETTE.length];
  const currentStatus: ProjectStatus = project.status ?? "active";
  const st = STATUS_CONFIG[currentStatus] ??
    STATUS_CONFIG.active ?? {
      label: currentStatus,
      dot: "bg-bg-green",
    };

  // Стабильная ссылка: пересоздаётся только при реальном обновлении данных
  // проекта (router.refresh после сохранения), а не на каждом ре-рендере.
  const initialData = useMemo(() => toProjectInput(project), [project]);

  /**
   * Возврат из архива. Вынесен отдельно, потому что им же отменяется архивация
   * из тоста: к тому моменту карточка уже ушла из рабочего списка, и найти её
   * в архиве руками — лишний квест.
   */
  const restoreFromArchive = useCallback(() => {
    startAction(async () => {
      const res = await restoreProject(orgSlug, project.id);
      if (!res.success) {
        toast.error("Не удалось вернуть проект", { description: res.error });
        return;
      }
      toast.success("Проект возвращён из архива");
      router.refresh();
    });
  }, [orgSlug, project.id, router]);

  /** В архив — обратимое действие, поэтому без подтверждения: промах лечится «Вернуть». */
  const archive = () => {
    startAction(async () => {
      const res = await archiveProject(orgSlug, project.id);
      if (!res.success) {
        toast.error("Не удалось убрать проект в архив", {
          description: res.error,
        });
        return;
      }
      toast.success("Проект убран в архив", {
        // Окно отмены длиннее обычного тоста: «Вернуть» здесь — единственный
        // способ исправить промах, не заходя в архив.
        duration: 6000,
        action: { label: "Вернуть", onClick: restoreFromArchive },
      });
      // Карточку убирает серверный список после refresh: он же отвечает за
      // пагинацию и фильтры, с которыми локальное удаление бы разошлось.
      router.refresh();
    });
  };

  const handlePrimaryAction = (e: MouseEvent) => {
    // Кнопки лежат внутри ссылки карточки (у рабочего проекта): без
    // preventDefault клик открыл бы ещё и страницу проекта.
    e.preventDefault();
    e.stopPropagation();
    if (isArchived) restoreFromArchive();
    else openEditDialog("edit", { id: project.id });
  };

  const handleDestructiveAction = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isArchived) setIsDeleteConfirmOpen(true);
    else archive();
  };

  const handleEditSuccess = () => {
    closeEditDialog();
    // Карточка показывает данные серверной выборки: без refresh в ней остались
    // бы старые название, бюджет и обложка.
    router.refresh();
  };

  const handleConfirmDelete = () => {
    setIsDeleteConfirmOpen(false);
    startAction(async () => {
      const res = await deleteProject(orgSlug, project.id);
      if (!res.success) {
        toast.error("Не удалось удалить проект", { description: res.error });
        return;
      }
      toast.success("Проект удалён");
      router.refresh();
    });
  };

  const cardClassName = cn(
    "group block bg-bg-card border border-border-muted rounded-xl overflow-hidden transition-shadow duration-200 hover:shadow-[0_8px_32px_rgba(27,26,23,.08)]",
    isPending
      ? "pointer-events-none opacity-60"
      : isArchived && "opacity-80 hover:opacity-100",
  );

  /** Обложка и данные — общие для рабочего проекта и для архивного. */
  const cardContent = (
    <>
      {/* Cover */}
      <div
        className={`relative h-60 ${coverBg} flex items-end p-5 overflow-hidden group`}
      >
        <IconButtonBlock
          onClick={handlePrimaryAction}
          // Без обработчика кнопка не рендерится: «Удалить навсегда» в архиве
          // доступно не всем ролям, а сервер это лишь подтверждает.
          onDelete={
            isArchived && !canDeleteForever ? undefined : handleDestructiveAction
          }
          icon={isArchived ? <RotateCcw className="size-3.5" /> : undefined}
          label={isArchived ? "Вернуть из архива" : undefined}
          deleteIcon={
            isArchived ? (
              <Trash2 className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )
          }
          deleteLabel={isArchived ? "Удалить навсегда" : "Убрать в архив"}
        />
        {project.cover_url ? (
          <Image
            loading="lazy"
            src={project.cover_url}
            alt={project.title || "Обложка проекта"}
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover"
          />
        ) : (
          <svg
            className="absolute -top-6 -right-6 size-48 text-bg-white opacity-[.14] pointer-events-none"
            viewBox="0 0 200 200"
            fill="none"
          >
            <circle
              cx="100"
              cy="100"
              r="96"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle
              cx="100"
              cy="100"
              r="68"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle
              cx="100"
              cy="100"
              r="40"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="100"
              y1="0"
              x2="100"
              y2="200"
              stroke="currentColor"
              strokeWidth="1"
            />
            <line
              x1="0"
              y1="100"
              x2="200"
              y2="100"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
        <span
          className={`relative z-1 inline-flex items-center rounded-[10px] py-1.5 px-3.5 font-mono text-[11px] font-semibold tracking-[.04em] uppercase ${
            TYPE_COLORS[project.type] ?? "bg-bg-accent text-bg"
          }`}
        >
          {project.type || "Интерьер"}
        </span>
        {/* Архивный проект выглядит как обычный, поэтому помечаем его прямо
            на обложке: в списке архива иначе не отличить. */}
        {isArchived && (
          <span className="relative z-1 ml-auto inline-flex items-center gap-1.5 rounded-[10px] bg-bg/85 px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[.04em] text-fg-body uppercase backdrop-blur-sm">
            <Archive className="size-3.5" /> Архив
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-5 pt-4">
        <h3 className="text-[19px] font-bold text-fg tracking-[-.01em] leading-[1.15] mb-3">
          {project.title || "Новый проект"}
        </h3>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {/* <div> //TODO: add items
            <div className="font-mono text-[17px] font-semibold text-fg leading-none">
              {project.items ?? 0}
            </div>
            <div className="text-[11.5px] text-fg-muted mt-1 leading-tight">
              {plural(project.items ?? 0, "позиция", "позиции", "позиций")}
            </div>
          </div> */}
          <div>
            <div className="font-mono text-[17px] font-semibold text-fg leading-none truncate">
              {project.rooms.length}
            </div>
            <div className="text-[11px] font-mono capitalize text-fg-muted mt-1 leading-tight">
              {plural(
                project.rooms.length,
                "помещение",
                "помещения",
                "помещений",
              )}
            </div>
          </div>
          <div>
            <div className="font-mono text-[17px] font-semibold text-fg leading-none truncate">
              {fmtCompact(project.budget) + " ₽"}
            </div>
            <div className="text-[11px] font-mono capitalize text-fg-muted mt-1 leading-tight">
              Бюджет
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full flex-none ${st.dot}`} />
            <span className="text-[13px] text-fg-secondary font-medium">
              {st.label}
            </span>
          </div>
          {/* //TODO: add date */}
          <span className="font-mono text-[11px] text-fg-muted tracking-[.02em]">
            {project.updated_at ? fmtDate(project.updated_at) : "—"}
          </span>
        </div>

        {/* Hover actions — заменены теги <button> на роли role="button" в <div> */}
        {/* <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <div
            role="button"
            tabIndex={0}
            onClick={handlePrimaryAction}
            className="flex-1 flex items-center justify-center gap-1.5 bg-bg-toggle text-fg border-none rounded-[10px] py-2.5 px-3 font-sans text-[13px] font-semibold cursor-pointer hover:bg-bg-select transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 10.5V12h1.5l7.37-7.37-1.5-1.5L2 10.5zM12.71 4.04a.5.5 0 000-.71l-.79-.79a.5.5 0 00-.71 0l-.73.73 1.5 1.5.73-.73z"
                fill="currentColor"
              />
            </svg>
            Ред.
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-label="Удалить"
            onClick={handleDestructiveAction}
            className="flex items-center justify-center w-9 h-9 rounded-[10px] border-none bg-bg-toggle text-fg-secondary cursor-pointer hover:bg-bg-red-light hover:text-fg-red transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M4.5 1.5h5M1.5 3.5h11M5.5 5.5v6M8.5 5.5v6M3.5 3.5l.5 9h6l.5-9"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div> */}
      </div>
    </>
  );

  return (
    <>
      {isArchived ? (
        // У архивного проекта страницы нет (`getProjectById` не отдаёт его, пока
        // `deleted_at` не снят), поэтому карточка — не ссылка: иначе она вела бы
        // в 404, выглядя живой. Действия у неё свои: «Вернуть» и «Удалить навсегда».
        <div className={cardClassName}>{cardContent}</div>
      ) : (
        <Link
          href={`/${orgSlug}/projects/${project.id}`}
          className={cardClassName}
        >
          {cardContent}
        </Link>
      )}

      {/*
        Окно правки — только для рабочего проекта: архивный сначала возвращают.
      */}
      <ProjectDialog
        orgSlug={orgSlug}
        open={isEditing}
        onClose={closeEditDialog}
        initialData={initialData}
        onSuccess={handleEditSuccess}
      />

      {/*
        Подтверждение есть только у необратимого шага: «в архив» отменяется
        тостом, а стирание — нет.
      */}
      {isArchived && (
        <AlertDialog
          open={isDeleteConfirmOpen}
          onOpenChange={setIsDeleteConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Удалить «{project.title || "Новый проект"}» навсегда?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Проект и его спецификация исчезнут без возможности
                восстановления. Если по проекту есть платежи или график
                платежей, удалить его не получится: финансовая история не
                удаляется.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                disabled={isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Удалить навсегда
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
