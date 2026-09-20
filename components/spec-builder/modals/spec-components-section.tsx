"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/layout/modal-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fmt } from "@/lib/utils";
import type { SpecItem } from "@/lib/types";
import {
  createSpecItemComponent,
  createSpecItemComponentGroup,
  createSpecItemComponentRef,
  deleteSpecItemComponent,
  deleteSpecItemComponentGroup,
  deleteSpecItemComponentRef,
  listSpecItemComponents,
  moveSpecItemComponent,
  updateSpecItemComponent,
  updateSpecItemComponentGroup,
  updateSpecItemComponentRef,
  type SpecItemComponentRow,
} from "@/actions/spec-components";
import type {
  SpecItemComponentCreateInput,
  SpecItemComponentRefInput,
  SpecItemGroupInput,
} from "@/lib/validations";
import {
  SpecItemRefPicker,
  type SpecItemRefOption,
} from "../layout/spec-item-ref-picker";
import { CompanyPicker } from "@/components/layout/company-picker";

type CompanyOption = { id: string; name: string };
type ContactOption = { id: string; name: string; company_id: string | null };

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-border-muted bg-bg-card px-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/**
 * «Состав» позиции: строки spec_item_components — группы (kind = 'group'),
 * компоненты (kind = 'component') и ссылки на существующие позиции
 * спецификации (kind = 'spec_ref'). Они НЕ являются строками spec_items и
 * не попадают в основную таблицу.
 */
export function SpecComponentsSection({
  orgSlug,
  projectId,
  specItemId,
  companies,
  contacts,
  specItems,
  onOpenRefItem,
  onCompanyCreated,
}: {
  orgSlug: string;
  projectId: string;
  specItemId: string;
  companies: CompanyOption[];
  contacts: ContactOption[];
  /** Все позиции проекта — кандидаты для ссылки на существующий SpecItem. */
  specItems: SpecItem[];
  /** Открыть карточку позиции, на которую ссылается строка kind = 'spec_ref'. */
  onOpenRefItem: (id: string) => void;
  /** Компания, созданная из формы компонента: обновляет список поставщиков. */
  onCompanyCreated?: (company: CompanyOption) => void;
}) {
  const [rows, setRows] = useState<SpecItemComponentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Форма создания нового компонента. */
  const [adding, setAdding] = useState(false);
  /** id группы, в которую добавляется компонент (null — верхний уровень). */
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  /** Редактируемый компонент (форма открыта с заполненными значениями). */
  const [editing, setEditing] = useState<SpecItemComponentRow | null>(null);
  /** Компонент или группа, ожидающие подтверждения удаления. */
  const [deleting, setDeleting] = useState<SpecItemComponentRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  /** Форма создания новой группы. */
  const [groupAdding, setGroupAdding] = useState(false);
  /** Редактируемая группа (форма открыта с заполненным названием). */
  const [groupEditing, setGroupEditing] = useState<SpecItemComponentRow | null>(
    null,
  );
  const [groupName, setGroupName] = useState("");

  /** Форма добавления/редактирования ссылки на позицию спецификации. */
  const [refAdding, setRefAdding] = useState(false);
  /** Редактируемая ссылка (форма открыта с заполненными значениями). */
  const [refEditing, setRefEditing] = useState<SpecItemComponentRow | null>(
    null,
  );
  /** id группы, в которую добавляется ссылка (null — верхний уровень). */
  const [refCreateParentId, setRefCreateParentId] = useState<string | null>(
    null,
  );
  const [refSpecItemId, setRefSpecItemId] = useState("");
  const [refAdditionalCost, setRefAdditionalCost] = useState("");

  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [notes, setNotes] = useState("");

  const componentFormOpen = adding || editing !== null;
  const groupFormOpen = groupAdding || groupEditing !== null;
  const refFormOpen = refAdding || refEditing !== null;
  const formOpen = componentFormOpen || groupFormOpen || refFormOpen;

  /**
   * Кандидаты для ссылки: все позиции проекта, кроме текущей (владельца
   * состава) — на неё ссылаться запрещено на сервере.
   */
  const refCandidates = useMemo<SpecItemRefOption[]>(
    () =>
      specItems
        .filter((it) => it.id !== specItemId)
        .map((it) => ({
          id: it.id,
          code: it.code,
          name:
            it.name || (it.code ? `Марка ${it.code}` : "Позиция без названия"),
          type: it.type,
        })),
    [specItems, specItemId],
  );

  /**
   * Варианты для текущего контейнера (выбранной группы или верхнего уровня):
   * исключаем SpecItem, которые уже связаны с ЭТИМ контейнером через
   * spec_item_components.ref_spec_item_id. Ссылки из других групп/уровней
   * остаются доступными. При редактировании текущая ссылка не исключается.
   */
  const refPickerOptions = useMemo<SpecItemRefOption[]>(() => {
    if (!refFormOpen || !rows) return refCandidates;
    const containerId = refEditing
      ? refEditing.parent_component_id
      : refCreateParentId;
    const editingRowId = refEditing?.id ?? null;
    const used = new Set<string>();
    for (const r of rows) {
      if (
        r.kind !== "spec_ref" ||
        !r.ref_spec_item_id ||
        r.parent_component_id !== containerId ||
        r.id === editingRowId
      ) {
        continue;
      }
      used.add(r.ref_spec_item_id);
    }
    // При редактировании текущая цель должна оставаться видимой в списке.
    if (refEditing?.ref_spec_item_id) {
      used.delete(refEditing.ref_spec_item_id);
    }
    return refCandidates.filter((o) => !used.has(o.id));
  }, [refCandidates, rows, refFormOpen, refEditing, refCreateParentId]);

  /**
   * Итоговая стоимость состава. Считается по всем строкам списка:
   *  - component — берём cost (null = 0);
   *  - spec_ref — берём только additional_cost (null = 0): стоимость исходной
   *    позиции не участвует, она уже учтена в основной таблице;
   *  - group — сама группа ничего не стоит, но её дочерние строки лежат в том
   *    же списке отдельными записями и учитываются как component/spec_ref.
   */
  const componentsTotal = useMemo(() => {
    if (!rows) return 0;
    return rows.reduce((sum, r) => {
      if (r.kind === "group") return sum;
      const value = r.kind === "spec_ref" ? r.additional_cost : r.cost;
      return sum + (value ?? 0);
    }, 0);
  }, [rows]);

  const load = useCallback(async () => {
    setRows(null);
    setLoadError(null);
    const res = await listSpecItemComponents(orgSlug, projectId, specItemId);
    if (res.success) setRows(res.data);
    else setLoadError(res.error);
  }, [orgSlug, projectId, specItemId]);

  useEffect(() => {
    let cancelled = false;
    listSpecItemComponents(orgSlug, projectId, specItemId).then((res) => {
      if (cancelled) return;
      if (res.success) setRows(res.data);
      else setLoadError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, projectId, specItemId]);

  /** Контакты: при выбранной компании показываем её контакты и «свободные». */
  const availableContacts = contacts.filter(
    (c) => !companyId || c.company_id === companyId || c.company_id === null,
  );

  const resetForm = () => {
    setName("");
    setCost("");
    setCompanyId("");
    setContactId("");
    setNotes("");
    setCreateParentId(null);
    setFormError(null);
  };

  const openCreate = () => {
    resetForm();
    setEditing(null);
    setAdding(true);
  };

  /** Открыть форму компонента внутри указанной группы. */
  const openCreateInGroup = (g: SpecItemComponentRow) => {
    resetForm();
    setEditing(null);
    setAdding(true);
    setCreateParentId(g.id);
  };

  const openEdit = (c: SpecItemComponentRow) => {
    resetForm();
    setAdding(false);
    setEditing(c);
    setName(c.name);
    setCost(c.cost != null ? String(c.cost) : "");
    setCompanyId(c.company_id ?? "");
    setContactId(c.contact_id ?? "");
    setNotes(c.notes ?? "");
  };

  const closeForm = () => {
    resetForm();
    setAdding(false);
    setEditing(null);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("Укажите название");
      return;
    }

    let parsedCost: number | null = null;
    if (cost.trim() !== "") {
      parsedCost = Number(cost);
      if (!Number.isFinite(parsedCost) || parsedCost < 0) {
        setFormError("Некорректная стоимость");
        return;
      }
    }

    setFormError(null);
    const input: SpecItemComponentCreateInput = {
      name: trimmedName,
      cost: parsedCost,
      companyId: companyId || null,
      contactId: contactId || null,
      notes,
    };

    // Фиксируем цель ДО startTransition: внутри колбэка состояние уже
    // могло измениться, а TS не сужает значения из замыканий.
    const target = editing;
    const parentId = createParentId;

    startTransition(async () => {
      // ── режим редактирования ──
      if (target) {
        const res = await updateSpecItemComponent(
          orgSlug,
          projectId,
          target.id,
          input,
        );
        if (!res.success) {
          setFormError(res.error);
          return;
        }
        // Заменяем строку в локальном списке; позиция в списке не меняется.
        setRows((prev) =>
          prev ? prev.map((r) => (r.id === target.id ? res.data : r)) : prev,
        );
        closeForm();
        toast.success("Компонент обновлён");
        return;
      }

      // ── режим создания ──
      const res = await createSpecItemComponent(
        orgSlug,
        projectId,
        specItemId,
        input,
        parentId,
      );
      if (!res.success) {
        setFormError(res.error);
        return;
      }
      // Обновляем список локально; основной SpecItem и таблица не меняются.
      setRows((prev) => (prev ? [...prev, res.data] : [res.data]));
      closeForm();
      toast.success("Компонент добавлен в состав");
    });
  };

  /** Открыть форму создания группы. */
  const openGroupCreate = () => {
    setGroupName("");
    setGroupAdding(true);
    setGroupEditing(null);
    setFormError(null);
  };

  /** Открыть форму переименования группы. */
  const openGroupEdit = (g: SpecItemComponentRow) => {
    setGroupName(g.name);
    setGroupAdding(false);
    setGroupEditing(g);
    setFormError(null);
  };

  const closeGroupForm = () => {
    setGroupName("");
    setGroupAdding(false);
    setGroupEditing(null);
    setFormError(null);
  };

  /** Создание/переименование группы: отправляется только название. */
  const handleGroupSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      setFormError("Укажите название группы");
      return;
    }

    setFormError(null);
    const input: SpecItemGroupInput = { name: trimmedName };

    // Фиксируем цель ДО startTransition (см. handleSubmit выше).
    const target = groupEditing;

    startTransition(async () => {
      // ── режим редактирования ──
      if (target) {
        const res = await updateSpecItemComponentGroup(
          orgSlug,
          projectId,
          target.id,
          input,
        );
        if (!res.success) {
          setFormError(res.error);
          return;
        }
        // Заменяем строку в локальном списке; позиция не меняется.
        setRows((prev) =>
          prev ? prev.map((r) => (r.id === target.id ? res.data : r)) : prev,
        );
        closeGroupForm();
        toast.success("Группа обновлена");
        return;
      }

      // ── режим создания ──
      const res = await createSpecItemComponentGroup(
        orgSlug,
        projectId,
        specItemId,
        input,
      );
      if (!res.success) {
        setFormError(res.error);
        return;
      }
      // Новая строка встаёт в конец списка: position назначает сервер.
      setRows((prev) => (prev ? [...prev, res.data] : [res.data]));
      closeGroupForm();
      toast.success("Группа добавлена в состав");
    });
  };

  /** Сброс формы ссылки. */
  const resetRefForm = () => {
    setRefSpecItemId("");
    setRefAdditionalCost("");
    setRefCreateParentId(null);
    setFormError(null);
  };

  /** Открыть форму добавления ссылки на верхнем уровне. */
  const openRefCreate = () => {
    resetRefForm();
    setRefEditing(null);
    setRefAdding(true);
  };

  /** Открыть форму добавления ссылки внутри указанной группы. */
  const openRefCreateInGroup = (g: SpecItemComponentRow) => {
    resetRefForm();
    setRefEditing(null);
    setRefAdding(true);
    setRefCreateParentId(g.id);
  };

  /** Открыть форму изменения ссылки (заполнены целевая позиция и сумма). */
  const openRefEdit = (r: SpecItemComponentRow) => {
    resetRefForm();
    setRefAdding(false);
    setRefEditing(r);
    setRefSpecItemId(r.ref_spec_item_id ?? "");
    setRefAdditionalCost(
      r.additional_cost != null ? String(r.additional_cost) : "",
    );
  };

  const closeRefForm = () => {
    resetRefForm();
    setRefAdding(false);
    setRefEditing(null);
  };

  /** Создание/изменение ссылки: только refSpecItemId и additionalCost. */
  const handleRefSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const targetId = refSpecItemId.trim();
    if (!targetId) {
      setFormError("Выберите позицию спецификации");
      return;
    }

    let additionalCost: number | null = null;
    if (refAdditionalCost.trim() !== "") {
      additionalCost = Number(refAdditionalCost);
      if (!Number.isFinite(additionalCost) || additionalCost < 0) {
        setFormError("Некорректная дополнительная стоимость");
        return;
      }
    }

    setFormError(null);
    const input: SpecItemComponentRefInput = {
      refSpecItemId: targetId,
      additionalCost,
    };

    // Фиксируем цель ДО startTransition (см. handleSubmit выше).
    const target = refEditing;
    const parentId = refCreateParentId;

    startTransition(async () => {
      // ── режим редактирования ──
      if (target) {
        const res = await updateSpecItemComponentRef(
          orgSlug,
          projectId,
          target.id,
          input,
        );
        if (!res.success) {
          setFormError(res.error);
          return;
        }
        setRows((prev) =>
          prev ? prev.map((r) => (r.id === target.id ? res.data : r)) : prev,
        );
        closeRefForm();
        toast.success("Ссылка обновлена");
        return;
      }

      // ── режим создания ──
      const res = await createSpecItemComponentRef(
        orgSlug,
        projectId,
        specItemId,
        input,
        parentId,
      );
      if (!res.success) {
        setFormError(res.error);
        return;
      }
      setRows((prev) => (prev ? [...prev, res.data] : [res.data]));
      closeRefForm();
      toast.success("Ссылка добавлена в состав");
    });
  };

  const handleDelete = () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    startTransition(async () => {
      const res =
        target.kind === "group"
          ? await deleteSpecItemComponentGroup(orgSlug, projectId, target.id)
          : target.kind === "spec_ref"
            ? await deleteSpecItemComponentRef(orgSlug, projectId, target.id)
            : await deleteSpecItemComponent(orgSlug, projectId, target.id);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      // Убираем строку из локального списка.
      setRows((prev) => (prev ? prev.filter((r) => r.id !== target.id) : prev));
      toast.success(
        target.kind === "group"
          ? "Группа удалена из состава"
          : target.kind === "spec_ref"
            ? "Ссылка удалена из состава"
            : "Компонент удалён из состава",
      );
    });
  };

  /** Перемещение компонента на одну позицию внутри его группы. */
  const handleMove = (c: SpecItemComponentRow, direction: "up" | "down") => {
    startTransition(async () => {
      const res = await moveSpecItemComponent(
        orgSlug,
        projectId,
        c.id,
        direction,
      );
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      // Сервер возвращает свежий список состава; при отсутствии соседа
      // (граница группы) возвращается null и порядок не меняется.
      if (res.data) setRows(res.data);
    });
  };

  const companyOf = (id: string | null) =>
    companies.find((c) => c.id === id)?.name;
  const contactOf = (id: string | null) =>
    contacts.find((c) => c.id === id)?.name;

  /** Строка компонента: название, стоимость, поставщик, заметки и действия. */
  const componentRow = (c: SpecItemComponentRow) => {
    const supplier = [companyOf(c.company_id), contactOf(c.contact_id)]
      .filter(Boolean)
      .join(" · ");

    // «Вверх»/«Вниз» есть только у компонентов внутри группы. Соседями
    // считаются строки того же контейнера (parent_component_id) — компоненты
    // и ссылки, — отсортированные по position, как их показывает список.
    const inGroup = c.parent_component_id !== null;
    const groupItems = inGroup
      ? (rows ?? []).filter(
          (r) => r.parent_component_id === c.parent_component_id,
        )
      : [];
    const groupIndex = inGroup
      ? groupItems.findIndex((x) => x.id === c.id)
      : -1;
    const canMoveUp = groupIndex > 0;
    const canMoveDown = groupIndex >= 0 && groupIndex < groupItems.length - 1;
    const actionsDisabled = pending || formOpen;

    return (
      <>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-fg">
              {c.name}
            </span>
            {c.cost != null && (
              <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-fg">
                {fmt(c.cost)} ₽
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {inGroup && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1 px-2 text-[12.5px] font-medium text-fg-secondary hover:text-fg"
                  aria-label={`Переместить «${c.name}» вверх`}
                  title="Переместить вверх"
                  onClick={() => handleMove(c, "up")}
                  disabled={actionsDisabled || !canMoveUp}
                >
                  <ArrowUp className="size-3.5" />
                  {/* Вверх */}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1 px-2 text-[12.5px] font-medium text-fg-secondary hover:text-fg"
                  aria-label={`Переместить «${c.name}» вниз`}
                  title="Переместить вниз"
                  onClick={() => handleMove(c, "down")}
                  disabled={actionsDisabled || !canMoveDown}
                >
                  <ArrowDown className="size-3.5" />
                  {/* Вниз */}
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 px-2 text-[12.5px] font-medium text-fg-secondary hover:text-fg"
              aria-label={`Редактировать «${c.name}»`}
              title="Редактировать"
              onClick={() => openEdit(c)}
              disabled={pending || formOpen}
            >
              <Pencil className="size-3.5" />
              {/* Редактировать */}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 px-2 text-[12.5px] font-medium text-fg-muted hover:bg-bg-red hover:text-fg-red"
              aria-label={`Удалить «${c.name}»`}
              title="Удалить"
              onClick={() => setDeleting(c)}
              disabled={pending || formOpen}
            >
              <Trash2 className="size-3.5" />
              {/* Удалить */}
            </Button>
          </div>
        </div>
        {supplier && (
          <p className="mt-0.5 truncate text-[11.5px] text-fg-secondary">
            {supplier}
          </p>
        )}
        {c.notes && (
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-fg-muted">
            {c.notes}
          </p>
        )}
      </>
    );
  };

  /** Понятный заголовок строки для диалогов и подписей. */
  const rowLabel = (r: SpecItemComponentRow): string => {
    if (r.kind !== "spec_ref") return r.name;
    const ref = r.ref_spec_item;
    if (ref?.available) {
      const label = [ref.code, ref.name].filter(Boolean).join(" · ");
      return label || "Ссылка на позицию";
    }
    return "Ссылка на недоступную позицию";
  };

  /** Строка «ссылки на спецификацию» (kind = 'spec_ref'). */
  const refRow = (r: SpecItemComponentRow) => {
    const ref = r.ref_spec_item;
    return (
      <>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-muted px-1.5 py-0.5 text-[10px] font-medium text-fg-secondary">
              <Link2 className="size-3 text-fg-muted" />
              Ссылка
            </span>
            {ref?.available ? (
              <>
                {ref.code && (
                  <span className="shrink-0 font-mono text-[12px] font-medium text-fg-secondary">
                    {ref.code}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-fg">
                  {ref.name || "Позиция не заполнена"}
                </span>
              </>
            ) : (
              <span className="truncate text-[13.5px] font-medium text-fg-muted">
                Исходная позиция недоступна
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {ref?.available && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 px-2 text-[12.5px] font-medium text-fg-secondary hover:text-fg"
                aria-label={`Открыть исходную позицию ${rowLabel(r)}`}
                title="Открыть исходную позицию"
                onClick={() => onOpenRefItem(ref.id)}
                disabled={pending || formOpen}
              >
                <ExternalLink className="size-3.5" /> Открыть исходную позицию
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 px-2 text-[12.5px] font-medium text-fg-secondary hover:text-fg"
              aria-label={`Редактировать ${rowLabel(r)}`}
              title="Редактировать"
              onClick={() => openRefEdit(r)}
              disabled={pending || formOpen}
            >
              <Pencil className="size-3.5" />
              {/* Редактировать */}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 px-2 text-[12.5px] font-medium text-fg-muted hover:bg-bg-red hover:text-fg-red"
              aria-label={`Удалить ${rowLabel(r)}`}
              title="Удалить"
              onClick={() => setDeleting(r)}
              disabled={pending || formOpen}
            >
              <Trash2 className="size-3.5" />
              {/* Удалить */}
            </Button>
          </div>
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {ref?.available && ref.type && (
            <span className="truncate text-[11.5px] text-fg-secondary">
              {ref.type}
            </span>
          )}
          {r.additional_cost != null && (
            <span className="font-mono text-[12px] font-semibold tabular-nums text-fg">
              {fmt(r.additional_cost)} ₽ доп.
            </span>
          )}
        </div>
      </>
    );
  };

  /** Отрисовка строки списка по kind: компонент или ссылка. */
  const rowView = (r: SpecItemComponentRow) =>
    r.kind === "spec_ref" ? refRow(r) : componentRow(r);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-fg-muted">
          Дополнительные элементы позиции. Они не появляются отдельной строкой в
          основной таблице и не участвуют в закупке, сводках и экспорте.
        </p>
        {!formOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={openGroupCreate}
              disabled={rows === null || pending}
            >
              <FolderOpen className="size-4" /> Добавить группу
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={openCreate}
              disabled={rows === null || pending}
            >
              <Plus className="size-4" /> Добавить компонент
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={openRefCreate}
              disabled={rows === null || pending}
            >
              <Link2 className="size-4" /> Добавить ссылку на спецификацию
            </Button>
          </div>
        )}
      </div>

      {/* ── форма добавления / редактирования компонента ─── */}
      {componentFormOpen && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border-muted bg-bg-card2 p-3.5"
        >
          {(() => {
            // Показываем группу назначения: при добавлении — createParentId,
            // при редактировании — родитель, который сохраняется без изменений.
            const parentId = editing
              ? editing.parent_component_id
              : createParentId;
            const parentRow = parentId
              ? rows?.find((r) => r.id === parentId)
              : undefined;
            if (!parentRow) return null;
            return (
              <p className="mb-3 flex items-center gap-1.5 text-[12px] font-medium text-fg-secondary">
                <FolderOpen className="size-3.5 shrink-0 text-fg-muted" />
                {editing
                  ? `Компонент группы «${parentRow.name}» — группа сохранится`
                  : `Будет добавлен в группу «${parentRow.name}»`}
              </p>
            );
          })()}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Корпус, столешница…"
                maxLength={300}
                disabled={pending}
              />
            </Field>
            <Field label="Стоимость, ₽">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0"
                disabled={pending}
              />
            </Field>
            <Field label="Компания">
              {/* Поиск по справочнику с созданием новой компании на месте. */}
              <CompanyPicker
                orgSlug={orgSlug}
                companies={companies}
                contacts={contacts}
                value={companyId || null}
                contactValue={contactId || null}
                onChange={({ companyId: nextCompany, contactId: nextContact }) => {
                  // Поставщик строки состава: новая компания попадает и в
                  // локальный справочник (onCompanyCreated), поэтому имя в
                  // списке резолвится сразу.
                  setCompanyId(nextCompany ?? "");
                  setContactId(nextContact ?? "");
                }}
                onCompanyCreated={onCompanyCreated}
                disabled={pending}
                placeholder="Не указана"
                emptyText="Компания не найдена — создайте её."
                clearLabel="Не указана"
              />
            </Field>
            <Field label="Контакт">
              <select
                className={SELECT_CLASS}
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                disabled={pending}
              >
                <option value="">Не указан</option>
                {availableContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Заметки" className="mt-3">
            <Textarea
              className="bg-bg-card"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Комментарий к элементу состава…"
              disabled={pending}
            />
          </Field>

          {formError && (
            <p className="mt-2 text-[12px] font-medium text-fg-red">
              {formError}
            </p>
          )}

          <div className="mt-3 flex justify-end gap-2 border-t border-border-muted pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={closeForm}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {editing
                ? pending
                  ? "Сохранение…"
                  : "Сохранить"
                : pending
                  ? "Добавление…"
                  : "Добавить"}
            </Button>
          </div>
        </form>
      )}

      {/* ── форма группы (только название) ───────────────── */}
      {groupFormOpen && (
        <form
          onSubmit={handleGroupSubmit}
          className="rounded-xl border border-border-muted bg-bg-card2 p-3.5"
        >
          <Field label="Название группы">
            <Input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Например, «Техника»"
              maxLength={300}
              disabled={pending}
            />
          </Field>

          {formError && (
            <p className="mt-2 text-[12px] font-medium text-fg-red">
              {formError}
            </p>
          )}

          <div className="mt-3 flex justify-end gap-2 border-t border-border-muted pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={closeGroupForm}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={pending || !groupName.trim()}>
              {groupEditing
                ? pending
                  ? "Сохранение…"
                  : "Сохранить"
                : pending
                  ? "Создание…"
                  : "Создать"}
            </Button>
          </div>
        </form>
      )}

      {/* ── форма добавления / редактирования ссылки на спецификацию ── */}
      {refFormOpen && (
        <form
          onSubmit={handleRefSubmit}
          className="rounded-xl border border-border-muted bg-bg-card2 p-3.5"
        >
          {(() => {
            // Показываем группу назначения: при добавлении — refCreateParentId,
            // при редактировании — родитель, который сохраняется без изменений.
            const parentId = refEditing
              ? refEditing.parent_component_id
              : refCreateParentId;
            const parentRow = parentId
              ? rows?.find((r) => r.id === parentId)
              : undefined;
            if (!parentRow) return null;
            return (
              <p className="mb-3 flex items-center gap-1.5 text-[12px] font-medium text-fg-secondary">
                <FolderOpen className="size-3.5 shrink-0 text-fg-muted" />
                {refEditing
                  ? `Ссылка из группы «${parentRow.name}» — группа сохранится`
                  : `Будет добавлена в группу «${parentRow.name}»`}
              </p>
            );
          })()}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Позиция спецификации">
                <SpecItemRefPicker
                  options={refPickerOptions}
                  value={refSpecItemId}
                  onChange={setRefSpecItemId}
                  disabled={pending}
                />
                {refEditing === null && refPickerOptions.length === 0 && (
                  <p className="mt-1.5 text-[12px] font-medium text-fg-muted">
                    Все доступные позиции уже добавлены в эту группу
                  </p>
                )}
              </Field>
            </div>
            <Field label="Дополнительная стоимость, ₽">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={refAdditionalCost}
                onChange={(e) => setRefAdditionalCost(e.target.value)}
                placeholder="0 — необязательно"
                disabled={pending}
              />
            </Field>
          </div>

          <p className="mt-2 text-[11.5px] leading-relaxed text-fg-muted">
            Ссылка не создаёт строку в основной таблице: исходная позиция уже
            есть в спецификации вместе со своей стоимостью. В составе
            показываются код и название позиции из спецификации, а учитывается
            только дополнительная стоимость, если она указана.
          </p>

          {formError && (
            <p className="mt-2 text-[12px] font-medium text-fg-red">
              {formError}
            </p>
          )}

          <div className="mt-3 flex justify-end gap-2 border-t border-border-muted pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={closeRefForm}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={pending || !refSpecItemId.trim()}>
              {refEditing
                ? pending
                  ? "Сохранение…"
                  : "Сохранить"
                : pending
                  ? "Добавление…"
                  : "Добавить ссылку"}
            </Button>
          </div>
        </form>
      )}

      {/* ── список состава ───────────────────────────────── */}
      {rows === null && !loadError && (
        <p className="py-6 text-center text-[13px] text-fg-muted">
          Загрузка состава…
        </p>
      )}

      {rows === null && loadError && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-muted py-8 text-center">
          <p className="text-[13px] text-fg-muted">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
          >
            Повторить
          </Button>
        </div>
      )}

      {rows !== null && rows.length === 0 && !formOpen && (
        <p className="py-6 text-center text-[13px] text-fg-muted">
          Состава пока нет. Добавьте группу — например, «Техника», — первый
          компонент или ссылку на позицию спецификации.
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="divide-y divide-border-muted rounded-xl border border-border-muted">
          {rows
            .filter((r) => r.parent_component_id === null)
            .map((c) => {
              if (c.kind === "group") {
                const groupChildren = rows.filter(
                  (r) => r.parent_component_id === c.id,
                );
                return (
                  <div key={c.id} className="bg-bg-card2 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <FolderOpen className="size-4 shrink-0 text-fg-secondary" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-fg">
                        {c.name}
                      </span>
                      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1 px-2 text-[12.5px] font-medium text-fg-secondary hover:text-fg"
                          onClick={() => openCreateInGroup(c)}
                          disabled={pending || formOpen}
                        >
                          <Plus className="size-3.5" /> Добавить компонент
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1 px-2 text-[12.5px] font-medium text-fg-secondary hover:text-fg"
                          aria-label={`Добавить ссылку в группу «${c.name}»`}
                          title="Добавить ссылку на спецификацию"
                          onClick={() => openRefCreateInGroup(c)}
                          disabled={pending || formOpen}
                        >
                          <Link2 className="size-3.5" /> Добавить ссылку
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1 px-2 text-[12.5px] font-medium text-fg-secondary hover:text-fg"
                          aria-label={`Редактировать группу «${c.name}»`}
                          title="Редактировать"
                          onClick={() => openGroupEdit(c)}
                          disabled={pending || formOpen}
                        >
                          <Pencil className="size-3.5" />
                          {/* Редактировать */}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1 px-2 text-[12.5px] font-medium text-fg-muted hover:bg-bg-red hover:text-fg-red"
                          aria-label={`Удалить группу «${c.name}»`}
                          title="Удалить"
                          onClick={() => setDeleting(c)}
                          disabled={pending || formOpen}
                        >
                          <Trash2 className="size-3.5" />
                          {/* Удалить */}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-2 rounded-lg border border-border-muted bg-bg px-2.5 py-1.5">
                      {groupChildren.length > 0 ? (
                        <div className="divide-y divide-border-muted">
                          {groupChildren.map((child) => (
                            <div key={child.id} className="py-1.5">
                              {rowView(child)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="py-1 text-center text-[12px] text-fg-muted">
                          В группе пока нет элементов
                        </p>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div key={c.id} className="px-3 py-2.5">
                  {rowView(c)}
                </div>
              );
            })}
        </div>
      )}

      {/* ── подтверждение удаления ─────────────────────────── */}
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `Удалить «${rowLabel(deleting)}» из состава?` : ""}
        description={
          deleting?.kind === "group"
            ? "Группа будет удалена безвозвратно. Группу, внутри которой есть элементы, удалить нельзя."
            : deleting?.kind === "spec_ref"
              ? "Ссылка будет удалена из состава. Исходная позиция спецификации и основная таблица не изменятся."
              : "Компонент будет удалён безвозвратно. Позиция спецификации и основная таблица не изменятся."
        }
        confirmLabel="Удалить"
        destructive
        autoFocusCancel
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
