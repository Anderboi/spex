"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FolderPlus,
  Loader2,
  Lock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { STATUS_CONFIG } from "@/lib/constants";
import { cn, plural } from "@/lib/utils";
import { addMaterialToProject } from "@/actions/materials";
import type { MaterialListItem, MaterialProjectTarget } from "@/lib/queries";
import { toast } from "sonner";

interface AttachToProjectDialogProps {
  open: boolean;
  orgSlug: string;
  /** Материал, который прикрепляем; null — материал из ссылки больше не найден. */
  material: MaterialListItem | null;
  /** Проекты-цели; null — данные ещё не приехали с сервера (см. page.tsx). */
  targets: MaterialProjectTarget[] | null;
  onOpenChange: (open: boolean) => void;
}

/** Строка списка: данные проекта плюс состояние выбора в этом сеансе. */
type TargetRow = MaterialProjectTarget & { inSpec: boolean };

/** Пустое множество, чтобы не создавать новое на каждый рендер. */
const NO_PROJECTS: ReadonlySet<string> = new Set();

/**
 * Выбор проекта для кнопки «В проект» на карточке материала.
 *
 * Диалог открывается по URL (`?action=to-project&id=<materialId>`), поэтому
 * список проектов приходит готовым пропсом с сервера: в нём уже посчитано, где
 * материал уже стоит в спецификации, а где у пользователя нет прав.
 *
 * Уже добавленный материал — не ошибка, а состояние: такая строка заблокирована
 * и помечена, а серверный экшен (`addMaterialToProject`) повторяет проверку,
 * потому что список мог устареть, пока диалог был открыт.
 */
export function AttachToProjectDialog({
  open,
  orgSlug,
  material,
  targets,
  onOpenChange,
}: AttachToProjectDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  /**
   * Проекты, в которые материал добавлен в этом сеансе. Отметки привязаны к
   * материалу: сервер после ревалидации и так вернёт актуальные `hasMaterial`,
   * а локальные нужны только чтобы список не «ожил» между кликом и ответом.
   */
  const [added, setAdded] = useState<{
    materialId: string | null;
    ids: ReadonlySet<string>;
  }>({ materialId: null, ids: NO_PROJECTS });
  const [pendingId, setPendingId] = useState<string | null>(null);

  const materialId = material?.id ?? null;
  const addedIds = added.materialId === materialId ? added.ids : NO_PROJECTS;

  const markAdded = useCallback(
    (projectId: string) => {
      setAdded((prev) => {
        const ids = new Set(
          prev.materialId === materialId ? prev.ids : undefined,
        );
        ids.add(projectId);
        return { materialId, ids };
      });
    },
    [materialId],
  );

  const rows = useMemo<TargetRow[]>(() => {
    const withState = (targets ?? []).map((t) => ({
      ...t,
      inSpec: t.hasMaterial || addedIds.has(t.id),
    }));
    // Недоступные строки уводим вниз: выбор начинается с рабочих проектов.
    // Сортировка стабильная, поэтому внутри групп сохраняется порядок сервера
    // (по свежести правок).
    return withState.sort(
      (a, b) => Number(a.inSpec || !a.canEdit) - Number(b.inSpec || !b.canEdit),
    );
  }, [targets, addedIds]);

  const handleAttach = useCallback(
    (target: MaterialProjectTarget) => {
      // Строки для архивного материала заблокированы, но проверяем и здесь:
      // сервер откажет, а пользователь не должен ждать ответа зря.
      if (!material || material.deletedAt !== null) return;
      setPendingId(target.id);

      startTransition(async () => {
        const res = await addMaterialToProject(orgSlug, target.id, material.id);
        setPendingId(null);

        if (!res.success) {
          // «Уже в проекте» — состояние списка, а не ошибка ввода: помечаем
          // строку, чтобы повторный клик был невозможен.
          if (res.code === "ALREADY_IN_PROJECT") markAdded(target.id);
          toast.error(res.error);
          return;
        }

        const { code, projectId, projectTitle } = res.data;
        markAdded(target.id);
        toast.success(`Материал добавлен в «${projectTitle}»`, {
          description: `Марка ${code} · ${material.name}`,
          action: {
            label: "Открыть проект",
            onClick: () => router.push(`/${orgSlug}/projects/${projectId}`),
          },
        });
      });
    },
    [material, markAdded, orgSlug, router],
  );

  // Архивный материал сервер не примет — строки сразу недоступны, с причиной
  // в описании диалога.
  const archived = material !== null && material.deletedAt !== null;
  const busy = isPending || archived;

  const body = !material
    ? "Материал недоступен — обновите страницу библиотеки."
    : archived
      ? "Материал удалён из библиотеки: восстановите его, чтобы добавить в проект."
      : `Новая позиция «${material.name}» появится в спецификации выбранного проекта — с автоматической маркой и количеством 1.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden bg-bg p-0 sm:max-w-140">
        <DialogHeader className="gap-1 border-b border-border-subtle p-4 pr-12">
          <DialogTitle>Добавить в проект</DialogTitle>
          <DialogDescription className="text-xs">{body}</DialogDescription>
        </DialogHeader>

        <Command className="rounded-none! bg-transparent">
          {/* Поле поиска не блокируем, пока едет ответ: иначе диалог открывался
              бы с фокусом на кнопке закрытия, и после загрузки его пришлось бы
              переводить в поиск вручную. */}
          <CommandInput
            autoFocus
            placeholder="Поиск проекта: название, клиент, адрес…"
            aria-label="Поиск проекта"
          />

          {targets === null ? (
            /* Данные диалога приезжают тем же переходом, что и открытие:
               если ответ сервера ещё в пути, показываем скелет, а не пустой
               список — иначе «нет проектов» выглядело бы как ошибка. */
            <div className="space-y-2 px-3 pt-1 pb-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <CommandList className="max-h-[50svh] px-2 pb-2">
              <CommandEmpty>
                {!material
                  ? "Материал недоступен"
                  : archived
                    ? "Материал удалён из библиотеки"
                    : targets.length === 0
                      ? "Нет активных проектов — создайте проект в разделе «Проекты»"
                      : "Проекты не найдены"}
              </CommandEmpty>

              <CommandGroup
                heading={`Активные проекты · ${rows.length} ${plural(
                  rows.length,
                  "проект",
                  "проекта",
                  "проектов",
                )}`}
              >
                {rows.map((row) => (
                  <TargetItem
                    key={row.id}
                    row={row}
                    material={material}
                    pending={isPending && pendingId === row.id}
                    disabled={busy && pendingId !== row.id}
                    onSelect={() => handleAttach(row)}
                  />
                ))}
              </CommandGroup>
            </CommandList>
          )}
        </Command>

        <DialogFooter className="justify-start">
          <p className="text-[11.5px] leading-snug text-fg-muted">
            Показаны незавершённые проекты: черновики, в работе и на паузе.
            Материал, который уже стоит в спецификации, повторно не добавляется.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Один проект в списке: чем он занят (дубль, права) и что произойдёт по клику. */
function TargetItem({
  row,
  material,
  pending,
  disabled,
  onSelect,
}: {
  row: TargetRow;
  material: MaterialListItem | null;
  pending: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  // Статус приходит из БД текстом: неизвестное значение не должно ронять диалог.
  const status = STATUS_CONFIG[row.status];
  const blocked = row.inSpec || !row.canEdit;

  const subtitle =
    [row.clientName, row.address].filter(Boolean).join(" · ") ||
    "Клиент и адрес не указаны";

  return (
    <CommandItem
      value={`${row.title} ${row.clientName ?? ""} ${row.address ?? ""}`}
      disabled={blocked || disabled || !material}
      onSelect={onSelect}
      className="items-start gap-3 rounded-lg px-3 py-2.5"
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-sm font-semibold">
            {row.title}
          </span>
          {status && (
            <Badge variant="outline" className="gap-1.5 font-normal">
              <span className={cn("size-1.5 rounded-full", status.dot)} />
              {status.label}
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted">
          {subtitle}
        </span>
        {row.hasArticle && !row.inSpec && (
          <span className="mt-1 flex items-center gap-1 text-[11px] text-bg-amber">
            <AlertTriangle className="size-3" />
            В проекте уже есть позиция с артикулом
            {material?.article ? ` ${material.article}` : ""} — проверьте дубль
          </span>
        )}
      </span>

      {pending ? (
        <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-fg-muted" />
      ) : row.inSpec ? (
        <Badge
          variant="outline"
          className="mt-0.5 shrink-0 gap-1 border-fg-green/40 bg-bg-green-light font-normal text-fg-green"
        >
          <Check className="size-3" /> Уже в спецификации
        </Badge>
      ) : !row.canEdit ? (
        <Badge
          variant="outline"
          className="mt-0.5 shrink-0 gap-1 font-normal text-fg-muted"
          title="Проект создан другим участником — нужны права администратора"
        >
          <Lock className="size-3" /> Нет прав
        </Badge>
      ) : (
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-secondary">
          <FolderPlus className="size-4" />
          Добавить
          <ArrowRight className="size-3" />
        </span>
      )}
    </CommandItem>
  );
}
