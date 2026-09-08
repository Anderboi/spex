"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useSpecPersistence } from "./use-spec-persistence";
import { useSpecFilters } from "./use-spec-filters";
import { fmt, plural, prefixFor } from "@/lib/utils";
import { SpecItem, SpecItemPatch, type SpecVariant } from "@/lib/types";
import {
  PICKING_FLOW,
  PROCUREMENT_FLOW,
  SERVICE_OPERATION_CONFIG,
  SpecStatus,
  SpecType,
  TYPE_ORDER,
  type ServiceOperationType,
} from "@/lib/constants";
import {
  createManualSpecItem,
  createSpecItems,
  deleteSpecItems,
  restoreSpecItems,
  setSpecItemCode,
} from "@/actions/specifications";
import {
  listProjectServiceOperations,
  type ServiceOperation,
} from "@/actions/service-operations";
import {
  addVariant,
  deleteVariant,
  switchVariant,
  updateVariant,
} from "@/actions/spec-variants";
import { SPEC_STATUS_CONFIG } from "@/lib/spec/status";
import { applyActiveVariant } from "@/lib/spec/variants";
import { round2, sumItems } from "@/lib/spec/pricing";
import { setSpecItemParent } from "@/lib/spec/tree";
import type { MaterialListItem, SpecPickerCompany } from "@/lib/queries";
import type { ManualSpecItemInput } from "@/lib/validations";

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

export type Toast = {
  id: number;
  msg: string;
  actionLabel?: string;
  action?: () => void;
};

export type DetailTab = "overview" | "components";

/** Возврат к открытой ранее детализации после закрытия позиции-ссылки. */
export type DetailReturnTo = { id: string; tab: DetailTab };

export type Modal =
  | { kind: "none" }
  | {
      kind: "detail";
      id: string;
      /** Вкладка, на которой открыть детализацию (например, после возврата из ссылки). */
      tab?: DetailTab;
      /** Открытая из «Состава» ссылка: после закрытия вернуться к владельцу. */
      returnTo?: DetailReturnTo;
    }
  | { kind: "add"; editId: string | null; parentId: string | null }
  | { kind: "add-variant"; itemId: string }
  | { kind: "delete"; ids: string[] }
  | { kind: "procure" }
  | { kind: "summary" }
  | { kind: "operation"; type: ServiceOperationType }
  | {
      kind: "edit-operation";
      operationId: string;
      /** Откуда открыли редактирование — вернуться туда после закрытия. */
      from?: { kind: "detail"; id: string };
    }
  | { kind: "edit-variant"; itemId: string; variantId: string };

export type CodeConflict = {
  itemId: string;
  code: string;
  occupantName: string;
};

type StatusBucket = { items: SpecItem[]; count: number; sum: number };

export type UseSpecBuilderArgs = {
  orgSlug: string;
  projectId: string;
  initialItems: SpecItem[];
};

/* ------------------------------------------------------------------ */

export function useSpecBuilder({
  orgSlug,
  projectId,
  initialItems,
}: UseSpecBuilderArgs) {
  const [items, setItems] = useState<SpecItem[]>(initialItems);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [modal, setModal] = useState<Modal>({ kind: "none" });
  const [toast, setToast] = useState<Toast | null>(null);
  const [codeConflict, setCodeConflict] = useState<CodeConflict | null>(null);
  const [replaceHidden, setReplaceHidden] = useState(false);
  const [isPending, startTransition] = useTransition();

  const filters = useSpecFilters();
  const persist = useSpecPersistence(orgSlug, projectId);

  /** Операции дополнительных расходов проекта («Монтаж»/«Доставка»). */
  const [operations, setOperations] = useState<ServiceOperation[]>([]);

  /**
   * Первичная загрузка операций проекта. Таблица позиций не блокируется;
   * после успешного сохранения список обновляется локально (см. onOperationCreated).
   */
  useEffect(() => {
    let cancelled = false;
    listProjectServiceOperations(orgSlug, projectId).then((res) => {
      if (!cancelled && res.success) setOperations(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, projectId]);

  /** Актуальный список без ожидания ре-рендера — нужен для вычисления патчей. */
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastSeq = useRef(0);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback(
    (msg: string, actionLabel?: string, action?: () => void) => {
      clearTimeout(toastTimer.current);
      setToast({ id: ++toastSeq.current, msg, actionLabel, action });
      toastTimer.current = setTimeout(
        () => setToast(null),
        actionLabel ? 7000 : 2600,
      );
    },
    [],
  );

  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Запись: локально + очередь на сервер                             */
  /* ---------------------------------------------------------------- */

  /**
   * Единственный путь изменения позиции.
   * Патч вычисляется вне setItems — побочные эффекты в updater-функции
   * дублируются в StrictMode и при конкурентном рендере.
   */
  const updateItem = useCallback(
    (id: string, patch: SpecItemPatch | ((it: SpecItem) => SpecItemPatch)) => {
      const current = itemsRef.current.find((i) => i.id === id);
      if (!current) return;

      const p = typeof patch === "function" ? patch(current) : patch;
      if (Object.keys(p).length === 0) return;

      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
      persist.push(id, p);
    },
    [persist],
  );

  /** Несколько позиций разом (групповые операции). */
  const updateMany = useCallback(
    (ids: string[], patch: SpecItemPatch) => {
      if (ids.length === 0 || Object.keys(patch).length === 0) return;
      const set = new Set(ids);
      setItems((prev) =>
        prev.map((i) => (set.has(i.id) ? { ...i, ...patch } : i)),
      );
      ids.forEach((id) => persist.push(id, patch));
    },
    [persist],
  );

  /**
   * Назначить/снять родителя позиции (parentId) — без UI.
   * Валидация (нет позиции, самоссылка, отсутствующий родитель, цикл)
   * выполняется в setSpecItemParent и здесь не дублируется: невалидная
   * операция возвращает исходный массив — состояние и очередь не меняются,
   * пользователю показывается toast. Возвращает true при успешном изменении.
   */
  const setItemParent = useCallback(
    (itemId: string, parentId: string | null): boolean => {
      const unchanged =
        setSpecItemParent(itemsRef.current, itemId, parentId) ===
        itemsRef.current;

      if (unchanged) {
        // no-op: родитель уже такой, как просят — это не ошибка
        const target = itemsRef.current.find((i) => i.id === itemId);
        if (target?.parentId === parentId) return true;
        showToast(
          "Нельзя назначить родителя: позиция не найдена, самоссылка или цикл",
        );
        return false;
      }

      // единственный путь записи: локально + патч в очередь persistence
      updateItem(itemId, { parentId });
      return true;
    },
    [updateItem, showToast],
  );

  const setStatus = useCallback(
    (id: string, status: SpecStatus) => {
      updateItem(id, { status });
      void persist.flush(); // статус — сразу, пользователь может закрыть вкладку
    },
    [updateItem, persist],
  );

  const incQty = useCallback(
    (id: string, delta: number) => {
      updateItem(id, (it) => ({
        qty: Math.max(0.01, Math.round((it.qty + delta) * 100) / 100),
      }));
    },
    [updateItem],
  );

  const setQty = useCallback(
    (id: string, raw: string) => {
      const n = Number(raw.replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) return;
      updateItem(id, { qty: Math.round(n * 100) / 100 });
    },
    [updateItem],
  );

  /** Принимает «1 234,56» и «1234.5». parseInt здесь съедал бы копейки. */
  const setPrice = useCallback(
    (id: string, raw: string) => {
      const n = Number(raw.replace(/[^\d.,-]/g, "").replace(",", "."));
      updateItem(id, {
        price: Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0,
      });
    },
    [updateItem],
  );

  const setUnit = useCallback(
    (id: string, unit: string) => updateItem(id, { unit }),
    [updateItem],
  );
  const setNotes = useCallback(
    (id: string, notes: string) => updateItem(id, { notes }),
    [updateItem],
  );
  const setSupplier = useCallback(
    (id: string, companyId: string | null, contactId: string | null) =>
      updateItem(id, { companyId, contactId }),
    [updateItem],
  );

  const setAttr = useCallback(
    (id: string, key: string, value: string) => {
      updateItem(id, (it) => {
        const attrs = { ...it.attrs };
        if (value.trim()) attrs[key] = value;
        else delete attrs[key];
        return { attrs };
      });
    },
    [updateItem],
  );

  const addRoom = useCallback(
    (id: string, room: string) => {
      const r = room.trim();
      if (!r) return;
      updateItem(id, (it) =>
        it.rooms.includes(r) ? {} : { rooms: [...it.rooms, r] },
      );
    },
    [updateItem],
  );

  const removeRoom = useCallback(
    (id: string, room: string) => {
      updateItem(id, (it) => ({ rooms: it.rooms.filter((x) => x !== room) }));
    },
    [updateItem],
  );

  /* ---------------------------------------------------------------- */
  /*  Варианты замены материала                                        */
  /* ---------------------------------------------------------------- */

  /** Мгновенно помечает выбранный вариант активным и пересчитывает плоские поля. */
  const switchVariantLocal = useCallback(
    (itemId: string, variantId: string) => {
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== itemId) return it;
          const variants = it.variants.map((v) => ({
            ...v,
            isActive: v.id === variantId,
          }));
          return applyActiveVariant({ ...it, variants });
        }),
      );
      startTransition(async () => {
        const res = await switchVariant(orgSlug, itemId, variantId);
        if (!res.success) showToast(res.error);
      });
    },
    [orgSlug, showToast],
  );

  const openEditVariant = useCallback(
    (itemId: string, variantId: string) =>
      setModal({ kind: "edit-variant", itemId, variantId }),
    [],
  );

  const openAddVariant = useCallback(
    (itemId: string) => setModal({ kind: "add-variant", itemId }),
    [],
  );

  const addVariantLocal = useCallback(
    (itemId: string) => openAddVariant(itemId),
    [openAddVariant],
  );

  /** Создаёт вариант из материала библиотеки и записывает его локально. */
  const commitVariantFromLibrary = useCallback(
    (itemId: string, m: MaterialListItem, companies: SpecPickerCompany[]) => {
      startTransition(async () => {
        const res = await addVariant(orgSlug, itemId, m.name);
        if (!res.success) {
          showToast(res.error);
          return;
        }

        const companyName =
          companies.find((c) => c.id === m.companyId)?.name ?? "";

        // сразу обновляем поля нового варианта данными материала
        const patch = {
          name: m.name,
          brand: m.brand ?? "",
          article: m.article ?? "",
          price: Number(m.price ?? 0),
          product_url: m.product_url ?? "",
        
          image_url: m.imageUrl ?? null,
          company_id: m.companyId ?? null,
          company_name_snapshot: companyName,
          contact_id: m.contactId ?? null,
          label: m.name,
        };
        const upd = await updateVariant(orgSlug, itemId, res.data.id, patch);
        if (!upd.success) {
          showToast(upd.error);
          return;
        }

        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== itemId) return it;
            const newVariant: SpecVariant = {
              id: res.data.id,
              specItemId: it.id,
              name: m.name,
              brand: m.brand ?? "",
              article: m.article ?? "",
              spec: "",
              price: Number(m.price ?? 0),
              productUrl: m.product_url ?? "",
              imageUrl: m.imageUrl ?? null,
              leadTime: "",
              companyId: m.companyId ?? null,
              contactId: m.contactId ?? null,
              companyName,
              label: m.name,
              isActive: false,
              position: it.variants.length,
            };
            return { ...it, variants: [...it.variants, newVariant] };
          }),
        );
        showToast(`Вариант добавлен · ${m.name}`);
        setModal({ kind: "none" });
      });
    },
    [orgSlug, showToast],
  );

  /** Создаёт вариант из ручного ввода. */
  const commitVariantManual = useCallback(
    (
      itemId: string,
      input: ManualSpecItemInput,
      companies: SpecPickerCompany[],
    ) => {
      startTransition(async () => {
        const res = await addVariant(
          orgSlug,
          itemId,
          input.name || "Альтернатива",
        );
        if (!res.success) {
          showToast(res.error);
          return;
        }

        const companyName =
          companies.find((c) => c.id === input.companyId)?.name ?? "";

        const patch = {
          name: input.name,
          brand: input.brand ?? "",
          article: input.article ?? "",
          spec: input.spec ?? "",
          price: input.price,
          product_url: "",
          image_url: input.imageUrl ?? null,
          company_id: input.companyId ?? null,
          company_name_snapshot: companyName,
          label: input.name || "Альтернатива",
        };
        const upd = await updateVariant(orgSlug, itemId, res.data.id, patch);
        if (!upd.success) {
          showToast(upd.error);
          return;
        }

        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== itemId) return it;
            const newVariant: SpecVariant = {
              id: res.data.id,
              specItemId: it.id,
              name: input.name,
              brand: input.brand ?? "",
              article: input.article ?? "",
              spec: input.spec ?? "",
              price: input.price,
              productUrl: input.productUrl ?? "",
              imageUrl: input.imageUrl ?? null,
              leadTime: input.leadTime ?? "",
              companyId: input.companyId ?? null,
              contactId: null,
              companyName,
              label: input.name || "Альтернатива",
              isActive: false,
              position: it.variants.length,
            };
            return { ...it, variants: [...it.variants, newVariant] };
          }),
        );
        showToast(`Вариант добавлен · ${input.name}`);
        setModal({ kind: "none" });
      });
    },
    [orgSlug, showToast],
  );

  /** Оптимистично правит поля варианта; активный пересчитывается в плоские. */
  const updateVariantLocal = useCallback(
    (itemId: string, variantId: string, patch: Partial<SpecVariant>) => {
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== itemId) return it;
          const variants = it.variants.map((v) =>
            v.id === variantId ? { ...v, ...patch } : v,
          );
          return applyActiveVariant({ ...it, variants });
        }),
      );

      // camelCase (UI) → snake_case (БД)
      const dbPatch: Record<string, unknown> = {};
      const map: Record<string, string> = {
        productUrl: "product_url",
        imageUrl: "image_url",
        leadTime: "lead_time",
        companyId: "company_id",
        contactId: "contact_id",
        companyName: "company_name_snapshot",
      };
      for (const [k, val] of Object.entries(patch)) {
        dbPatch[map[k] ?? k] = val;
      }

      startTransition(async () => {
        const res = await updateVariant(orgSlug, itemId, variantId, dbPatch);
        if (!res.success) showToast(res.error);
      });
    },
    [orgSlug, showToast],
  );

  /** Оптимистично удаляет вариант; последний вариант не удаляется. */
  const deleteVariantLocal = useCallback(
    (itemId: string, variantId: string) => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (!item || item.variants.length <= 1) return; // последний не удаляем
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== itemId) return it;
          const removed = it.variants.find((v) => v.id === variantId);
          let variants = it.variants.filter((v) => v.id !== variantId);
          if (removed?.isActive && variants.length > 0) {
            variants = variants.map((v, i) => ({ ...v, isActive: i === 0 }));
          }
          return applyActiveVariant({ ...it, variants });
        }),
      );
      startTransition(async () => {
        const res = await deleteVariant(orgSlug, itemId, variantId);
        if (!res.success) showToast(res.error);
      });
    },
    [orgSlug, showToast],
  );

  /* ---------------------------------------------------------------- */
  /*  Марка                                                            */
  /* ---------------------------------------------------------------- */

  const applyCode = useCallback(
    async (itemId: string, code: string, allowSwap: boolean) => {
      // сначала долить очередь: иначе отложенный патч перезапишет результат обмена
      await persist.flush();

      const res = await setSpecItemCode(
        orgSlug,
        projectId,
        itemId,
        code,
        allowSwap,
      );

      if (!res.success) {
        if (res.error.startsWith("CODE_TAKEN:")) {
          setCodeConflict({
            itemId,
            code,
            occupantName:
              res.error.slice("CODE_TAKEN:".length) || "другой позицией",
          });
          return;
        }
        showToast(res.error);
        return;
      }

      setCodeConflict(null);

      if (res.data.result === "swapped") {
        setItems((prev) => {
          const mine = prev.find((i) => i.id === itemId);
          const theirs = prev.find((i) => i.code === code && i.id !== itemId);
          if (!mine || !theirs) return prev;
          const oldCode = mine.code;
          return prev.map((i) =>
            i.id === mine.id
              ? { ...i, code }
              : i.id === theirs.id
                ? { ...i, code: oldCode }
                : i,
          );
        });
        showToast(`Марки обменены с «${res.data.swappedName}»`);
      } else if (res.data.result === "ok") {
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, code } : i)),
        );
        showToast(`Марка изменена на ${code}`);
      }
    },
    [orgSlug, projectId, persist, showToast],
  );

  /** Вызывается из таблицы и карточки. Конфликт → codeConflict → диалог обмена. */
  const setItemCode = useCallback(
    (itemId: string, code: string) => {
      const next = code.trim().toUpperCase();
      if (!next) return;
      startTransition(() => {
        void applyCode(itemId, next, false);
      });
    },
    [applyCode],
  );

  const confirmCodeSwap = useCallback(() => {
    if (!codeConflict) return;
    const { itemId, code } = codeConflict;
    setCodeConflict(null);
    startTransition(() => {
      void applyCode(itemId, code, true);
    });
  }, [codeConflict, applyCode]);

  const dismissCodeConflict = useCallback(() => setCodeConflict(null), []);

  /* ---------------------------------------------------------------- */
  /*  Создание                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Следующие свободные номера для типа.
   * Дыры не заполняются: нумерация монотонна, марка из чертежа не переиспользуется.
   */
  const nextCodes = useCallback((type: string, count: number): string[] => {
    const p = prefixFor(type).toUpperCase();
    const max = itemsRef.current
      .filter((i) => i.code.startsWith(`${p}-`))
      .reduce(
        (m, i) => Math.max(m, parseInt(i.code.slice(p.length + 1), 10) || 0),
        0,
      );
    return Array.from(
      { length: count },
      (_, k) => `${p}-${String(max + 1 + k).padStart(2, "0")}`,
    );
  }, []);

  const blank = useCallback(
    (type: SpecType, code: string, over: Partial<SpecItem> = {}): SpecItem => ({
      id: crypto.randomUUID(),
      projectId,
      materialId: null,
      companyId: null,
      contactId: null,
      companyName: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      imageUrl: null,
      code,
      type,
      name: "",
      brand: "",
      spec: "",
      article: "",
      qty: 1,
      unit: "шт",
      price: 0,
      status: "draft",
      isPlaceholder: true,
      position: itemsRef.current.length,
      rooms: [],
      notes: "",
      leadTime: "",
      avail: "",
      attrs: {},
      updatedAt: new Date().toISOString(),
      stockPct: 0,
      clientDiscountPct: 0,
      supplierDiscountPct: 0,
      product_url: "",
      product_type: "",
      activeVariantId: null,
      variants: [],
      parentId: null,
      ...over,
    }),
    [projectId],
  );

  /** Оптимистичная вставка с откатом при ошибке сервера. */
  const commitNew = useCallback(
    (created: SpecItem[], successMsg: string) => {
      if (created.length === 0) return;
      setItems((prev) => [...prev, ...created]);

      startTransition(async () => {
        const res = await createSpecItems(orgSlug, projectId, created);
        if (!res.success) {
          const ids = new Set(created.map((c) => c.id));
          setItems((prev) => prev.filter((i) => !ids.has(i.id)));
          showToast(res.error);
          return;
        }
        showToast(successMsg);
      });
    },
    [orgSlug, projectId, showToast],
  );

  const addPlaceholder = useCallback(
    (type: SpecType, parentId: string | null = null) => {
      const [code] = nextCodes(type, 1);
      commitNew(
        [blank(type, code, { parentId })],
        `Добавлена пустая позиция · ${code}`,
      );
    },
    [nextCodes, blank, commitNew],
  );

  /** Добавление из библиотеки материалов. Снапшоты поставщика/контакта проставит сервер. */
  const addFromLibrary = useCallback(
    (materials: MaterialListItem[], parentId: string | null = null) => {
      if (materials.length === 0) return;

      const byType = new Map<SpecType, MaterialListItem[]>();
      for (const m of materials) {
        const t: SpecType = TYPE_ORDER.includes(m.category as SpecType)
          ? (m.category as SpecType)
          : "Прочее";
        byType.set(t, [...(byType.get(t) ?? []), m]);
      }

      const created: SpecItem[] = [];
      for (const [type, list] of byType) {
        const codes = nextCodes(type, list.length);
        list.forEach((m, i) => {
          created.push(
            blank(type, codes[i], {
              materialId: m.id,
              name: m.name,
              brand: m.brand ?? "",
              spec: "",
              article: m.article ?? "",
              unit: m.unit ?? "шт",
              price: Number(m.price ?? 0),
              companyId: m.companyId ?? null,
              contactId: m.contactId ?? null,
              parentId,
              status: "picked",
              isPlaceholder: false,
            }),
          );
        });
      }

      commitNew(
        created,
        `Добавлено · ${created.length} ${plural(created.length, "позиция", "позиции", "позиций")}`,
      );
    },
    [nextCodes, blank, commitNew],
  );

  /** Заполнение существующей заглушки материалом из библиотеки. */
  const fillPlaceholder = useCallback(
    (id: string, m: MaterialListItem) => {
      updateItem(id, {
        materialId: m.id,
        name: m.name,
        brand: m.brand ?? "",
        spec: "",
        article: m.article ?? "",
        unit: m.unit ?? "шт",
        price: Number(m.price ?? 0),
        companyId: m.companyId ?? null,
        contactId: m.contactId ?? null,
        status: "picked",
        isPlaceholder: false,
      });
      void persist.flush();
      setModal({ kind: "none" });
      showToast(`Позиция заполнена · ${m.name}`);
    },
    [updateItem, persist, showToast],
  );

  /** Ручное создание позиции (с опциональным сохранением материала в библиотеку). */
  const addManual = useCallback(
    (input: ManualSpecItemInput, parentId: string | null = null) => {
      const [code] = nextCodes(input.type, 1);
      const itemId = crypto.randomUUID();
      const materialId = input.saveToLibrary ? crypto.randomUUID() : null;

      const created = blank(input.type as SpecType, code, {
        id: itemId,
        materialId,
        name: input.name,
        brand: input.brand,
        spec: input.spec,
        article: input.article,
        qty: input.qty,
        unit: input.unit,
        price: input.price,
        stockPct: input.stockPct,
        clientDiscountPct: input.clientDiscountPct,
        supplierDiscountPct: input.supplierDiscountPct,
        companyId: input.companyId,
        imageUrl: input.imageUrl,
        parentId,
        status: input.price > 0 ? "picked" : "draft",
        isPlaceholder: false,
      });

      setItems((prev) => [...prev, created]);

      startTransition(async () => {
        const res = await createManualSpecItem(orgSlug, projectId, {
          ...input,
          itemId,
          materialId,
          code,
          parentId,
        });
        if (!res.success) {
          setItems((prev) => prev.filter((i) => i.id !== itemId));
          showToast(res.error);
          return;
        }
        showToast(`Добавлена позиция · ${code}`);
      });
    },
    [nextCodes, blank, orgSlug, projectId, showToast],
  );

  /** Заполнение существующей заглушки вручную (без сохранения в библиотеку). */
  const fillManual = useCallback(
    (id: string, input: ManualSpecItemInput) => {
      updateItem(id, {
        name: input.name,
        brand: input.brand,
        spec: input.spec,
        article: input.article,
        qty: input.qty,
        unit: input.unit,
        price: input.price,
        stockPct: input.stockPct,
        clientDiscountPct: input.clientDiscountPct,
        supplierDiscountPct: input.supplierDiscountPct,
        companyId: input.companyId,
        imageUrl: input.imageUrl,
        status: input.price > 0 ? "picked" : "draft",
        isPlaceholder: false,
      });
      void persist.flush();
      setModal({ kind: "none" });
      showToast(`Позиция заполнена · ${input.name}`);
    },
    [updateItem, persist, showToast],
  );

  const duplicateItem = useCallback(
    (id: string) => {
      const src = itemsRef.current.find((i) => i.id === id);
      if (!src) return;
      const [code] = nextCodes(src.type, 1);
      const copy = blank(src.type, code, {
        ...src,
        id: crypto.randomUUID(),
        code,
        rooms: [], // назначения не копируем: это разные места
        status: src.isPlaceholder ? "draft" : "picked",
      });
      commitNew([copy], `Создана копия · ${code}`);
    },
    [nextCodes, blank, commitNew],
  );

  /* ---------------------------------------------------------------- */
  /*  Удаление с отменой                                               */
  /* ---------------------------------------------------------------- */

  const removeItems = useCallback(
    (ids: string[], label: string) => {
      if (ids.length === 0) return;
      const removed = itemsRef.current.filter((i) => ids.includes(i.id));
      if (removed.length === 0) return;

      setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      setSelected(new Set());
      setModal({ kind: "none" });

      startTransition(async () => {
        await persist.flush();
        const res = await deleteSpecItems(orgSlug, projectId, ids);

        if (!res.success) {
          setItems((prev) =>
            [...prev, ...removed].sort((a, b) => a.position - b.position),
          );
          showToast(res.error);
          return;
        }

        showToast(label, "Отменить", () => {
          startTransition(async () => {
            const r = await restoreSpecItems(orgSlug, projectId, ids);
            if (!r.success) {
              showToast(r.error);
              return;
            }
            setItems((prev) =>
              [...prev, ...removed].sort((a, b) => a.position - b.position),
            );
            showToast("Действие отменено");
          });
        });
      });
    },
    [orgSlug, projectId, persist, showToast],
  );

  const deleteItem = useCallback(
    (id: string) => {
      const it = itemsRef.current.find((i) => i.id === id);
      // марки не пересчитываем — они стоят в чертежах и ведомостях
      removeItems([id], it ? `Марка ${it.code} удалена` : "Позиция удалена");
    },
    [removeItems],
  );

  const bulkDelete = useCallback(() => {
    const ids = [...selected];
    removeItems(ids, `Удалено позиций: ${ids.length}`);
  }, [selected, removeItems]);

  const bulkStatus = useCallback(
    (status: SpecStatus) => {
      const ids = [...selected].filter(
        (id) => !itemsRef.current.find((i) => i.id === id)?.isPlaceholder,
      );
      if (ids.length === 0) {
        showToast("Заглушкам статус не назначается");
        return;
      }
      updateMany(ids, { status });
      void persist.flush();
      showToast(
        `Статус «${SPEC_STATUS_CONFIG[status].label}» · позиций: ${ids.length}`,
      );
    },
    [selected, updateMany, persist, showToast],
  );

  /** Очистить содержимое, оставив марку — «место занято, материал переподбирается». */
  const clearContent = useCallback(
    (id: string) => {
      const src = itemsRef.current.find((i) => i.id === id);
      if (!src) return;

      const before: SpecItemPatch = {
        name: src.name,
        brand: src.brand,
        spec: src.spec,
        article: src.article,
        price: src.price,
        status: src.status,
        isPlaceholder: src.isPlaceholder,
        materialId: src.materialId,
        attrs: src.attrs,
      };

      updateItem(id, {
        name: "",
        brand: "",
        spec: "",
        article: "",
        price: 0,
        status: "draft",
        isPlaceholder: true,
        materialId: null,
        attrs: {},
      });
      setModal({ kind: "none" });

      showToast(`${src.code} очищена · марка сохранена`, "Отменить", () => {
        updateItem(id, before);
        showToast("Действие отменено");
      });
    },
    [updateItem, showToast],
  );

  /** Перенести назначения на другую марку и удалить исходную. */
  const mergeInto = useCallback(
    (sourceId: string, targetId: string) => {
      const src = itemsRef.current.find((i) => i.id === sourceId);
      const tgt = itemsRef.current.find((i) => i.id === targetId);
      if (!src || !tgt) return;

      if (src.rooms.length > 0) {
        updateItem(targetId, {
          rooms: [...new Set([...tgt.rooms, ...src.rooms])],
        });
      }
      removeItems(
        [sourceId],
        src.rooms.length > 0
          ? `Назначения (${src.rooms.length}) перенесены на ${tgt.code}`
          : `${src.code} удалена`,
      );
    },
    [updateItem, removeItems],
  );

  const shareItem = useCallback(
    (item: SpecItem) => {
      const url = `${location.origin}${location.pathname}#item=${item.id}`;
      if (navigator.share) {
        void navigator
          .share({ title: `${item.name} · ${item.code}`, text: item.spec, url })
          .catch(() => {});
        return;
      }
      void navigator.clipboard
        .writeText(url)
        .then(() => showToast("Ссылка на позицию скопирована"))
        .catch(() => showToast("Не удалось скопировать"));
    },
    [showToast],
  );

  /* ---------------------------------------------------------------- */
  /*  Выборка и агрегаты                                               */
  /* ---------------------------------------------------------------- */

  const list = useMemo(() => {
    const q = filters.query.trim().toLowerCase();

    const filtered = items.filter((it) => {
      if (filters.activeType !== "Все типы" && it.type !== filters.activeType)
        return false;
      if (filters.statusFilter && it.status !== filters.statusFilter)
        return false;
      if (q) {
        const hay =
          `${it.name} ${it.brand} ${it.code} ${it.spec} ${it.article}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...filtered];
    if (filters.sort === "az") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    } else if (filters.sort === "sum") {
      sorted.sort((a, b) => b.qty * b.price - a.qty * a.price);
    } else {
      sorted.sort((a, b) =>
        a.code.localeCompare(b.code, "ru", { numeric: true }),
      );
    }

    // В основной таблице показываем все SpecItem, в том числе дочерние:
    // parentId — обычная связь SpecItem → SpecItem, а не принадлежность
    // «составу» (для него есть отдельная таблица spec_item_components,
    // строки которой не попадают в ctx.items и в эту таблицу).
    return sorted;
  }, [
    items,
    filters.query,
    filters.activeType,
    filters.statusFilter,
    filters.sort,
  ]);

  const groups = useMemo(
    () =>
      TYPE_ORDER.map((type) => {
        const items = list.filter((i) => i.type === type);
        return { type, items: items, sum: sumItems(items).total };
      }).filter((g) => g.items.length > 0),
    [list],
  );

  /** Производное значение, не мутация ref внутри рендера. */
  const visibleIds = useMemo(
    () => groups.flatMap((g) => g.items.map((i) => i.id)),
    [groups],
  );

  const stats = useMemo(() => {
    const real = items.filter((i) => !i.isPlaceholder);
    const money = sumItems(items);
    // const replaceItems = items.filter((i) => i.status === "replace");

    const bucket = (s: SpecStatus): StatusBucket => {
      const its = real.filter((i) => i.status === s);
      return { items: its, count: its.length, sum: sumItems(its).total }; // ← было qty*price
    };

    const procurement = Object.fromEntries(
      PROCUREMENT_FLOW.map((s) => [s, bucket(s)]),
    ) as Record<SpecStatus, StatusBucket>;

    const scopeSum = PROCUREMENT_FLOW.reduce(
      (a, s) => a + procurement[s].sum,
      0,
    );
    const scopeCount = PROCUREMENT_FLOW.reduce(
      (a, s) => a + procurement[s].count,
      0,
    );
    const picking = PICKING_FLOW.flatMap((s) => bucket(s).items);
    const replace = bucket("replace");

    return {
      totalCount: items.length,
      totalSum: money.total,
      discountSum: money.discount,
      purchaseSum: money.purchase,
      margin: round2(money.total - money.purchase),
      placeholders: items.length - real.length,

      replace: replace,
      procurement,
      scopeSum,
      scopeCount,
      scopeSumStr: fmt(scopeSum),
      picking,
      pickingCount: picking.length,
      pickingSum: sumItems(picking).total, // ← было qty*price
      deliveredCount: procurement.delivered.count,
      deliveredPct: scopeSum
        ? Math.round((procurement.delivered.sum / scopeSum) * 100)
        : 0,
    };
  }, [items]);

  /** Баннер «требуют замены» показываем заново, когда появились новые. */
  const replaceCount = stats.replace.count;
  const prevReplaceCount = useRef(replaceCount);
  useEffect(() => {
    if (replaceCount > prevReplaceCount.current) setReplaceHidden(false);
    prevReplaceCount.current = replaceCount;
  }, [replaceCount]);

  /* ---------------------------------------------------------------- */
  /*  Выделение, свёртка, модалки                                      */
  /* ---------------------------------------------------------------- */

  const toggleSel = useCallback((id: string) => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  /** Выделить/снять выделение со всех позиций группы (например, типа «Плитка»). */
  const toggleSelGroup = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setSelected((prev) => {
      const allSel = ids.every((id) => prev.has(id));
      const s = new Set(prev);
      if (allSel) ids.forEach((id) => s.delete(id));
      else ids.forEach((id) => s.add(id));
      return s;
    });
  }, []);

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const toggleSelectAll = useCallback(() => {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleIds));
  }, [allVisibleSelected, visibleIds]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const toggleCollapsed = useCallback((type: string) => {
    setCollapsed((prev) => {
      const s = new Set(prev);
      if (s.has(type)) s.delete(type);
      else s.add(type);
      return s;
    });
  }, []);

  const closeModal = useCallback(
    () =>
      setModal((m) => {
        // Ссылка на позицию открыта из «Состава» другой позиции: закрывая её,
        // возвращаемся к владельцу состава на ту же вкладку.
        if (m.kind === "detail" && m.returnTo)
          return { kind: "detail", id: m.returnTo.id, tab: m.returnTo.tab };
        // Редактирование операции открыто из детализации позиции: закрывая
        // модалку операции, возвращаемся к той же детализации.
        if (m.kind === "edit-operation" && m.from)
          return { kind: "detail", id: m.from.id };
        return { kind: "none" };
      }),
    [],
  );
  const openDetail = useCallback(
    (id: string, returnTo?: DetailReturnTo) =>
      setModal(
        returnTo
          ? { kind: "detail", id, returnTo }
          : { kind: "detail", id },
      ),
    [],
  );
  const openAdd = useCallback(
    (editId: string | null = null, parentId: string | null = null) =>
      setModal({ kind: "add", editId, parentId }),
    [],
  );
  const openDelete = useCallback(
    (id: string) => setModal({ kind: "delete", ids: [id] }),
    [],
  );
  const openBulkDelete = useCallback(
    () => setModal({ kind: "delete", ids: [...selected] }),
    [selected],
  );
  const openProcure = useCallback(() => setModal({ kind: "procure" }), []);
  const openSummary = useCallback(() => setModal({ kind: "summary" }), []);

  /**
   * Открыть форму создания операции из выделения. Заглушки в операцию
   * не включаются: если после фильтрации позиций не осталось — toast.
   */
  const openServiceOperation = useCallback(
    (type: ServiceOperationType) => {
      const eligible = itemsRef.current.some(
        (i) => selected.has(i.id) && !i.isPlaceholder,
      );
      if (!eligible) {
        showToast(
          "Выберите заполненные позиции — заглушки в операцию не включаются",
        );
        return;
      }
      setModal({ kind: "operation", type });
    },
    [selected, showToast],
  );

  /**
   * Открыть форму редактирования существующей операции (из бейджа в строке
   * или из детализации позиции). При переходе из детализации передаётся
   * from — после закрытия модалки операции туда возвращаемся.
   */
  const openServiceOperationEdit = useCallback(
    (operationId: string, from?: { kind: "detail"; id: string }) =>
      setModal({ kind: "edit-operation", operationId, from }),
    [],
  );

  /**
   * Локально отмечает связанные позиции «Доставлено». Сервер уже записал
   * статус в рамках update/createServiceOperation — здесь только зеркалим
   * изменение в таблице, не добавляя патч в очередь сохранения.
   */
  const markItemsDelivered = useCallback((ids: string[]) => {
    const set = new Set(ids);
    if (set.size === 0) return;
    setItems((prev) =>
      prev.map((i) =>
        set.has(i.id) ? { ...i, status: "delivered" } : i,
      ),
    );
  }, []);

  /**
   * После успешного создания: добавляем операцию в локальный список,
   * снимаем выделение и закрываем модалку — без полного перезапуска.
   */
  const onOperationCreated = useCallback(
    (op: ServiceOperation) => {
      setOperations((prev) => [op, ...prev]);
      setSelected(new Set());
      setModal({ kind: "none" });
      if (op.type === "delivery" && op.completed)
        markItemsDelivered(op.spec_item_ids);
      showToast(
        `Добавлено · ${SERVICE_OPERATION_CONFIG[op.type].label} · ${fmt(op.amount)} ₽`,
      );
    },
    [showToast, markItemsDelivered],
  );

  /** После успешного сохранения: заменяем операцию в локальном списке. */
  const onOperationUpdated = useCallback(
    (op: ServiceOperation) => {
      setOperations((prev) => prev.map((x) => (x.id === op.id ? op : x)));
      if (op.type === "delivery" && op.completed)
        markItemsDelivered(op.spec_item_ids);
      closeModal();
      showToast(
        `Сохранено · ${SERVICE_OPERATION_CONFIG[op.type].label} · ${fmt(op.amount)} ₽`,
      );
    },
    [closeModal, showToast, markItemsDelivered],
  );

  /** После успешного удаления: убираем операцию из списка (бейджи обновятся сами). */
  const onOperationDeleted = useCallback(
    (op: ServiceOperation) => {
      setOperations((prev) => prev.filter((x) => x.id !== op.id));
      closeModal();
      showToast(
        `Удалено · ${SERVICE_OPERATION_CONFIG[op.type].label} · ${fmt(op.amount)} ₽`,
      );
    },
    [closeModal, showToast],
  );

  // Escape закрывает верхний слой: сначала конфликт марки, потом модалку
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (codeConflict) {
        e.preventDefault();
        setCodeConflict(null);
        return;
      }
      // Escape: сначала конфликт марки, потом верхнюю модалку. DetailModal
      // (и вложенные диалоги) закрывает сам Dialog через onOpenChange —
      // не обрабатываем его здесь повторно, чтобы не задваивать «возврат»
      // к владельцу состава после закрытия позиции-ссылки.
      if (modal.kind !== "none" && modal.kind !== "detail") {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [codeConflict, modal.kind, closeModal]);

  const current =
    modal.kind === "detail"
      ? (items.find((i) => i.id === modal.id) ?? null)
      : null;
  const editing =
    modal.kind === "add" && modal.editId
      ? (items.find((i) => i.id === modal.editId) ?? null)
      : null;
  const deleting =
    modal.kind === "delete"
      ? items.filter((i) => modal.ids.includes(i.id))
      : [];

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.id)),
    [items, selected],
  );

  /** Операции, привязанные к каждой позиции (для бейджей в строке/карточке). */
  const opsByItem = useMemo(() => {
    const map: Record<string, ServiceOperation[]> = {};
    for (const op of operations) {
      for (const id of op.spec_item_ids) {
        const list = map[id];
        if (list) list.push(op);
        else map[id] = [op];
      }
    }
    return map;
  }, [operations]);

  /** Сумма дополнительных расходов проекта — отдельный агрегат. */
  const opsTotal = useMemo(
    () => operations.reduce((s, op) => s + op.amount, 0),
    [operations],
  );

  /* ---------------------------------------------------------------- */

  return {
    orgSlug,
    projectId,
    // данные
    items,
    list,
    groups,
    visibleIds,
    stats,
    operations,
    opsByItem,
    opsTotal,
    filters,
    isPending,

    // запись
    updateItem,
    updateMany,
    setItemParent,
    setStatus,
    incQty,
    setQty,
    setPrice,
    setUnit,
    setNotes,
    setSupplier,
    setAttr,
    addRoom,
    removeRoom,

    // варианты замены
    switchVariantLocal,
    addVariantLocal,
    updateVariantLocal,
    deleteVariantLocal,
    commitVariantManual,
    commitVariantFromLibrary,
    openEditVariant,

    // создание
    addPlaceholder,
    addFromLibrary,
    fillPlaceholder,
    addManual,
    fillManual,
    duplicateItem,

    // удаление
    deleteItem,
    bulkDelete,
    bulkStatus,
    clearContent,
    mergeInto,
    shareItem,

    // марка
    setItemCode,
    codeConflict,
    confirmCodeSwap,
    dismissCodeConflict,

    // выделение
    selected,
    selectedItems,
    toggleSel,
    toggleSelGroup,
    toggleSelectAll,
    allVisibleSelected,
    clearSelection,
    selectionActive: selected.size > 0,

    // свёртка групп
    collapsed,
    toggleCollapsed,

    // модалки
    modal,
    current,
    editing,
    deleting,
    openDetail,
    openAdd,
    openDelete,
    openBulkDelete,
    openProcure,
    openSummary,
    openServiceOperation,
    openServiceOperationEdit,
    onOperationCreated,
    onOperationUpdated,
    onOperationDeleted,
    closeModal,

    // прочее
    toast,
    showToast,
    dismissToast,
    replaceHidden,
    setReplaceHidden,
    saveStatus: persist.status,
    saveError: persist.error,
    flush: persist.flush,
  };
}

export type SpecBuilderContext = ReturnType<typeof useSpecBuilder>;
