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
import { useDialogUrl } from "./use-dialog-url";
import { useSearchParams } from "next/navigation";
import { fmt, plural, prefixFor } from "@/lib/utils";
import { SpecItem, SpecItemPatch, type SpecVariant } from "@/lib/types";
import {
  ALL_CATEGORIES,
  PICKING_FLOW,
  PROCUREMENT_FLOW,
  operationLabel,
  SpecStatus,
  SpecType,
  TYPE_ORDER,
  isSpecItemAllowedForOperation,
  specItemIdsInDeliveries,
  specItemIdsInInstallations,
  type ServiceOperationType,
} from "@/lib/constants";
import {
  createManualSpecItem,
  createSpecItems,
  deleteSpecItems,
  restoreSpecItems,
  setSpecItemCode,
  setSpecItemPrice,
  setSpecItemsStatus,
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
import { nextCodesFrom } from "@/lib/spec/codes";
import type {
  SpecItemCreateOrigin,
  SpecVariantUpdateOrigin,
} from "@/lib/spec/history";
import type { PendingPatchOptions } from "@/lib/spec/pending-patches";
import { applyActiveVariant } from "@/lib/spec/variants";
import { round2, sumItems } from "@/lib/spec/pricing";
import {
  calcProjectTotal,
  sumServiceOperationAmounts,
} from "@/lib/spec/project-budget";
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

/**
 * Вкладки панели позиции. Значения совпадают с `?tab=` в URL, поэтому список
 * используется ещё и как рантайм-проверка параметра из адресной строки.
 */
export const DETAIL_PANEL_TABS = [
  "overview",
  "parameters",
  "components",
  "variants",
  "rooms",
  "supplier",
  "files",
] as const;
export type DetailPanelTab = (typeof DETAIL_PANEL_TABS)[number];

/**
 * Вкладки, которых больше нет в интерфейсе. Значение остаётся в URL-контракте,
 * чтобы старые ссылки (`?tab=supplier`) не открывали пустую панель: поставщик,
 * менеджер и срок поставки переехали в раскрытый блок «Поставка» вкладки
 * «Обзор», поэтому такая ссылка ведёт на «Обзор».
 */
const RETIRED_DETAIL_PANEL_TABS: Record<string, DetailPanelTab> = {
  supplier: "overview",
};

function isDetailPanelTab(value: string | null): value is DetailPanelTab {
  return (
    value !== null && (DETAIL_PANEL_TABS as readonly string[]).includes(value)
  );
}

/** Значение `?tab=` с учётом переехавших вкладок; неизвестное значение — null. */
function resolveDetailPanelTab(value: string | null): DetailPanelTab | null {
  if (value !== null && value in RETIRED_DETAIL_PANEL_TABS) {
    return RETIRED_DETAIL_PANEL_TABS[value];
  }
  return isDetailPanelTab(value) ? value : null;
}

/** Возврат к открытой ранее детализации после закрытия позиции-ссылки. */
export type DetailReturnTo = { id: string; tab: DetailPanelTab };

/**
 * Панель позиции в `Modal` не участвует: она живёт в URL (`?item=`), а `Modal`
 * описывает только верхние слои, которые её перекрывают.
 */
export type Modal =
  | { kind: "none" }
  | { kind: "add"; editId: string | null; parentId: string | null }
  | { kind: "add-variant"; itemId: string }
  | { kind: "delete"; ids: string[] }
  | { kind: "procure" }
  | { kind: "summary" }
  /**
   * Создание операции. `preselectedItemIds` — создание из карточки позиции:
   * список позиций уже известен и не зависит от выделения в таблице.
   */
  | { kind: "operation"; type: ServiceOperationType; preselectedItemIds?: string[] }
  | { kind: "edit-operation"; operationId: string }
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

/**
 * Добавляет в локальный список снимок базового материала, если сервер создал
 * его вместе с новой заменой (`addVariant` возвращает его в `base`).
 * Снимок приходит активным, когда активного варианта не было, — то есть
 * отображаемый материал позиции не меняется.
 */
function withBaseVariant(
  variants: SpecVariant[],
  base: SpecVariant | null,
): SpecVariant[] {
  if (!base || variants.some((v) => v.id === base.id)) return variants;
  return [base, ...variants];
}

/**
 * Поля позиции, которые фактически принадлежат материалу: в варианте они —
 * источник истины, в spec_items остаются общей копией.
 */
const MATERIAL_FIELD_MAP: Record<string, keyof SpecVariant> = {
  name: "name",
  brand: "brand",
  article: "article",
  spec: "spec",
  price: "price",
  product_url: "productUrl",
  imageUrl: "imageUrl",
  leadTime: "leadTime",
  companyId: "companyId",
  contactId: "contactId",
  companyName: "companyName",
};

/**
 * Выделяет из патча позиции поля материала (null — таких полей нет).
 *
 * Копируются и «пустые» значения (null, ""): снятие поставщика — это
 * `companyId: null` вместе с пустым снапшотом имени, и если пропустить их,
 * активный вариант сохранит прежнюю компанию и вернёт её при следующей
 * загрузке проекта (applyActiveVariant перекрывает плоские поля позиции).
 */
function materialPatchOf(patch: SpecItemPatch): Partial<SpecVariant> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const field = MATERIAL_FIELD_MAP[key];
    if (field) out[field] = value;
  }
  return Object.keys(out).length > 0 ? (out as Partial<SpecVariant>) : null;
}

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

  /* ------------------------------------------------------------------ */
  /*  Открытая позиция живёт в URL: ?item=<id>&tab=<вкладка>             */
  /* ------------------------------------------------------------------ */

  const searchParams = useSearchParams();
  const urlItemId = searchParams.get("item");
  const urlTabValue = searchParams.get("tab");
  const urlTab = resolveDetailPanelTab(urlTabValue);
  const {
    open: openItemUrl,
    set: setItemUrl,
    close: closeItemUrl,
  } = useDialogUrl("item", ["tab"], { shallow: true });

  /**
   * Откуда пришли в текущую позицию. Нужно ровно для одного решения: «Назад»
   * шагает по истории (значит, запись в историю добавляли мы) или просто
   * закрывает панель (позиция открыта прямой ссылкой — шагать некуда, иначе
   * «Назад» выбросил бы из приложения).
   *
   * Значение намеренно не сбрасывается при возврате на предыдущую позицию:
   * важен сам факт «эту панель открывали мы», а не конкретный адрес возврата.
   */
  const [detailReturnTo, setDetailReturnTo] = useState<DetailReturnTo | null>(
    null,
  );

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
   * Оптимистично правит поля варианта; активный вариант пересчитывается
   * в плоские поля позиции.
   *
   * Объявлено до `updateItem` намеренно: правки полей материала из строки и
   * карточки (цена, название, поставщик) зеркалятся в активный вариант —
   * см. `updateItem`.
   *
   * `origin` едет до `updateVariant` без изменений: от него зависит, писать ли
   * событие `variant_updated`. Его называют все вызывающие явно — умолчания
   * нет, потому что одинаковый патч приходит и от правки варианта, и от
   * зеркалирования полей позиции, и решать за вызывающего здесь нельзя.
   */
  const updateVariantLocal = useCallback(
    (
      itemId: string,
      variantId: string,
      patch: Partial<SpecVariant>,
      origin: SpecVariantUpdateOrigin,
    ) => {
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
        const res = await updateVariant(
          orgSlug,
          itemId,
          variantId,
          dbPatch,
          origin,
        );
        if (!res.success) showToast(res.error);
      });
    },
    [orgSlug, showToast],
  );

  /**
   * Зеркалит поля материала в активный вариант.
   *
   * Материал позиции физически хранится в активном варианте, а плоские поля
   * spec_items — общая копия: `applyActiveVariant` перекрывает их при каждой
   * загрузке. Без зеркалирования правка цены/названия/поставщика в строке
   * терялась бы при следующем открытии проекта.
   *
   * Это не правка варианта пользователем, а побочный эффект правки позиции:
   * те же поля уже описаны её собственными событиями (`details_changed`,
   * `price_changed`, `supplier_changed`), поэтому `origin` — `mirror`.
   */
  const mirrorMaterialFields = useCallback(
    (id: string, patch: SpecItemPatch) => {
      const material = materialPatchOf(patch);
      if (!material) return;

      const active = itemsRef.current
        .find((i) => i.id === id)
        ?.variants.find((v) => v.isActive);
      if (active) updateVariantLocal(id, active.id, material, "mirror");
    },
    [updateVariantLocal],
  );

  /**
   * Единственный путь изменения позиции.
   * Патч вычисляется вне setItems — побочные эффекты в updater-функции
   * дублируются в StrictMode и при конкурентном рендере.
   *
   * `options.explicitQuantity` едет вместе с патчем до самого
   * `saveSpecItemPatch`: он отличает явную правку количества от составных
   * жестов (ручное заполнение заглушки), которые тоже пишут `qty`.
   */
  const updateItem = useCallback(
    (
      id: string,
      patch: SpecItemPatch | ((it: SpecItem) => SpecItemPatch),
      options: PendingPatchOptions = {},
    ) => {
      const current = itemsRef.current.find((i) => i.id === id);
      if (!current) return;

      const p = typeof patch === "function" ? patch(current) : patch;
      if (Object.keys(p).length === 0) return;

      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
      persist.push(id, p, options);
      mirrorMaterialFields(id, p);
    },
    [persist, mirrorMaterialFields],
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

  /**
   * Смена статуса одной позиции. Пишется отдельным действием, а не патчем
   * через очередь: событию истории нужен прежний статус ИЗ БД, а отложенный
   * патч мог бы уйти в одном запросе с правкой цены — тогда явную смену
   * статуса уже не отличить от побочной.
   */
  const setStatus = useCallback(
    (id: string, status: SpecStatus) => {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status } : i)),
      );

      startTransition(async () => {
        // Сначала долить очередь: иначе отложенный патч перезапишет статус,
        // а сервер прочитает уже неверный `from`.
        await persist.flush();
        const res = await setSpecItemsStatus(orgSlug, projectId, [id], status);
        if (!res.success) showToast(res.error);
      });
    },
    [orgSlug, projectId, persist, showToast],
  );

  const incQty = useCallback(
    (id: string, delta: number) => {
      updateItem(
        id,
        (it) => ({
          qty: Math.max(0.01, Math.round((it.qty + delta) * 100) / 100),
        }),
        // Серия быстрых «+/−» склеивается очередью и уходит одной mutation,
        // поэтому событие истории получает `from` из БД и итоговый `to`.
        { explicitQuantity: true },
      );
    },
    [updateItem],
  );

  const setQty = useCallback(
    (id: string, raw: string) => {
      const n = Number(raw.replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) return;
      updateItem(
        id,
        { qty: Math.round(n * 100) / 100 },
        { explicitQuantity: true },
      );
    },
    [updateItem],
  );

  /**
   * Явная правка цены. Пишется отдельным действием (см. пояснение у
   * `setStatus`): истории нужна прежняя цена ИЗ БД, а очередь может склеить
   * цену с заполнением заглушки или очисткой позиции — там цена меняется как
   * побочный эффект и событием не считается.
   *
   * Принимает «1 234,56» и «1234.5». parseInt здесь съедал бы копейки.
   */
  const setPrice = useCallback(
    (id: string, raw: string) => {
      const n = Number(raw.replace(/[^\d.,-]/g, "").replace(",", "."));
      const price = Number.isFinite(n)
        ? Math.max(0, Math.round(n * 100) / 100)
        : 0;

      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, price } : i)));
      // Цена — поле материала: без зеркала в активный вариант правка
      // потеряется при следующей загрузке проекта.
      mirrorMaterialFields(id, { price });

      startTransition(async () => {
        // Сначала долить очередь: иначе отложенный патч перезапишет цену,
        // а сервер прочитает уже неверный `from`.
        await persist.flush();
        const res = await setSpecItemPrice(orgSlug, projectId, id, price);
        if (!res.success) showToast(res.error);
      });
    },
    [orgSlug, projectId, persist, showToast, mirrorMaterialFields],
  );

  const setUnit = useCallback(
    (id: string, unit: string) => updateItem(id, { unit }),
    [updateItem],
  );
  const setNotes = useCallback(
    (id: string, notes: string) => updateItem(id, { notes }),
    [updateItem],
  );
  /**
   * Явная правка поставщика — единственный путь, помечающий домен для истории.
   * Компания и менеджер едут одним патчем, поэтому и событие будет одно, даже
   * если пользователь сменил обоих подряд: дебаунс склеит серию.
   *
   * `companyName` приходит из пикера как подсказка и может отсутствовать —
   * тогда имя разрешит сервер по справочнику.
   */
  const setSupplier = useCallback(
    (
      id: string,
      companyId: string | null,
      contactId: string | null,
      companyName?: string,
    ) =>
      updateItem(
        id,
        companyName === undefined
          ? { companyId, contactId }
          : { companyId, contactId, companyName },
        { explicitSupplier: true },
      ),
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

  /**
   * Форма варианта перекрывает панель позиции: `?item=` остаётся, поэтому
   * после сохранения или отмены пользователь возвращается в ту же позицию.
   */
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

        // сразу обновляем поля нового варианта данными материала.
        // `origin: "create"` — это вторая половина того же жеста, что и
        // `addVariant`: отдельного `variant_updated` у неё нет, иначе одно
        // действие пользователя выглядело бы как «создал пустой вариант,
        // потом его отредактировал».
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
        const upd = await updateVariant(
          orgSlug,
          itemId,
          res.data.id,
          patch,
          "create",
        );
        if (!upd.success) {
          showToast(upd.error);
          return;
        }

        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== itemId) return it;
            const variants = withBaseVariant(it.variants, res.data.base);
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
              position: variants.length,
            };
            return { ...it, variants: [...variants, newVariant] };
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

        // `origin: "create"` — заполнение только что созданного варианта:
        // вторая половина жеста «добавить вариант» (см. commitVariantFromLibrary).
        const patch = {
          name: input.name,
          brand: input.brand ?? "",
          article: input.article ?? "",
          spec: input.spec ?? "",
          price: input.price,
          product_url: input.productUrl ?? "",
          lead_time: input.leadTime ?? "",
          image_url: input.imageUrl ?? null,
          company_id: input.companyId ?? null,
          company_name_snapshot: companyName,
          label: input.name || "Альтернатива",
        };
        const upd = await updateVariant(
          orgSlug,
          itemId,
          res.data.id,
          patch,
          "create",
        );
        if (!upd.success) {
          showToast(upd.error);
          return;
        }

        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== itemId) return it;
            const variants = withBaseVariant(it.variants, res.data.base);
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
              position: variants.length,
            };
            return { ...it, variants: [...variants, newVariant] };
          }),
        );
        showToast(`Вариант добавлен · ${input.name}`);
        setModal({ kind: "none" });
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
   * Правило живёт в lib/spec/codes.ts — тот же генератор использует сервер,
   * когда материал из библиотеки добавляют в проект (actions/materials.ts).
   */
  const nextCodes = useCallback(
    (type: string, count: number): string[] =>
      nextCodesFrom(
        prefixFor(type),
        itemsRef.current.map((i) => i.code),
        count,
      ),
    [],
  );

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

  /**
   * Оптимистичная вставка с откатом при ошибке сервера.
   *
   * `origin` называет серверу, откуда пришла позиция: по самим данным это
   * неразличимо (дубликат переносит `materialId` источника и выглядит как
   * добавление из библиотеки), а событие истории должно знать источник.
   */
  const commitNew = useCallback(
    (
      created: SpecItem[],
      origin: SpecItemCreateOrigin,
      successMsg: string,
    ) => {
      if (created.length === 0) return;
      setItems((prev) => [...prev, ...created]);

      startTransition(async () => {
        const res = await createSpecItems(
          orgSlug,
          projectId,
          created,
          origin,
        );
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
        "placeholder",
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
              // Материал библиотеки — шаблон: тип, характеристики, ссылка и
              // изображение переносятся в позицию снимком на момент добавления.
              // Дальше позиция живёт своей жизнью и правки в библиотеке её не
              // трогают.
              product_type: m.product_type ?? "",
              product_url: m.product_url ?? "",
              attrs: m.attrs ?? {},
              imageUrl: m.imageUrl ?? null,
            }),
          );
        });
      }

      commitNew(
        created,
        "library",
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
        // см. addFromLibrary: переносим шаблон материала целиком
        product_type: m.product_type ?? "",
        product_url: m.product_url ?? "",
        attrs: m.attrs ?? {},
        imageUrl: m.imageUrl ?? null,
        // Составной жест: история получит одно `filled`, а не событие на каждое
        // изменившееся поле. Пометка ставится явно — по набору полей составной
        // жест не угадывается.
      }, { composite: true, fillOrigin: "placeholder" });
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
        // Снапшот имени: форма отдаёт его вместе с id, иначе только что
        // созданная компания показывалась бы как «поставщик не указан» до
        // перезагрузки страницы проекта.
        companyName: input.companyName,
        imageUrl: input.imageUrl,
        parentId,
        status: input.price > 0 ? "picked" : "draft",
        isPlaceholder: false,
        product_type: input.productType,
        product_url: input.productUrl,
        leadTime: input.leadTime,
        attrs: input.attrs,
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
        companyName: input.companyName,
        imageUrl: input.imageUrl,
        status: input.price > 0 ? "picked" : "draft",
        isPlaceholder: false,
        product_type: input.productType,
        product_url: input.productUrl,
        leadTime: input.leadTime,
        attrs: input.attrs,
        // Составной жест — см. fillPlaceholder: история получит `filled`.
      }, { composite: true, fillOrigin: "manual" });
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
        // Варианты — отдельные записи в БД, и копию позиции сервер их не
        // создаёт: если оставить здесь варианты источника, пилюля показывала
        // бы чужие варианты (переключение уходило бы в никуда).
        variants: [],
        activeVariantId: null,
      });
      commitNew([copy], "duplicate", `Создана копия · ${code}`);
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
      // Панель удалённой позиции закрываем: иначе в URL осталась бы ссылка
      // на несуществующую позицию (и перезагрузка открыла бы пустоту).
      if (urlItemId && ids.includes(urlItemId)) {
        setDetailReturnTo(null);
        closeItemUrl();
      }

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
    [orgSlug, projectId, persist, showToast, urlItemId, closeItemUrl],
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

      // Локально сразу — список не должен ждать сервер.
      const set = new Set(ids);
      setItems((prev) =>
        prev.map((i) => (set.has(i.id) ? { ...i, status } : i)),
      );

      startTransition(async () => {
        await persist.flush();
        const res = await setSpecItemsStatus(orgSlug, projectId, ids, status);
        if (!res.success) showToast(res.error);
      });

      showToast(
        `Статус «${SPEC_STATUS_CONFIG[status].label}» · позиций: ${ids.length}`,
      );
    },
    [selected, orgSlug, projectId, persist, showToast],
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
        // Составной жест: позиция очищена целиком — её история будет `cleared`,
        // а не набор полевых событий. Марку, количество, единицу измерения и
        // поставщика очистка не трогает.
      }, { composite: true, cleared: true });
      setModal({ kind: "none" });

      showToast(`${src.code} очищена · марка сохранена`, "Отменить", () => {
        // Отмена возвращает содержимое в опустевшую позицию — фактически это
        // заполнение, поэтому событие будет `filled` с origin `undo`. Если
        // очищали пустую заглушку, `before` вернёт `isPlaceholder: true`, и
        // события не будет: позиция так и осталась незаполненной.
        updateItem(id, before, { composite: true, fillOrigin: "undo" });
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
      if (filters.activeType !== ALL_CATEGORIES && it.type !== filters.activeType)
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

  /**
   * Закрытие верхнего слоя.
   *
   * Если что-то перекрывает панель (операция, вариант, удаление, добавление) —
   * закрываем именно его: панель вернётся сама, потому что её позиция всё ещё
   * в URL. Если перекрывать нечего — закрываем панель: снимаем `?item=`
   * заменой записи, а если открывали её мы сами — шагаем назад по истории,
   * чтобы вернуться туда, откуда пришли (родитель позиции, владелец состава,
   * список). Ту же логику получает системная кнопка «Назад»: она просто
   * убирает параметр из URL.
   */
  const closeModal = useCallback(() => {
    if (modal.kind !== "none") {
      setModal({ kind: "none" });
      return;
    }
    if (!urlItemId) return;
    if (detailReturnTo) {
      window.history.back();
      return;
    }
    closeItemUrl();
  }, [modal.kind, urlItemId, detailReturnTo, closeItemUrl]);

  /**
   * Закрыть только верхний слой, не трогая панель позиции. Нужно там, где
   * «закрыть текущую модалку» — служебная операция слоя (`?dialog=`), а не
   * намерение пользователя закрыть позицию.
   */
  const closeOverlay = useCallback(
    () => setModal((m) => (m.kind === "none" ? m : { kind: "none" })),
    [],
  );

  /**
   * Открыть детализацию позиции. Каждая позиция — отдельный шаг истории:
   * системная кнопка «Назад» и кнопка в шапке панели возвращают туда, откуда
   * пришли.
   */
  const openDetail = useCallback(
    (id: string, returnTo?: DetailReturnTo) => {
      const tab = returnTo?.tab ?? "overview";
      // Панель перекрывает любой верхний слой (например, список закупки,
      // из которого тоже можно открыть позицию).
      setModal((m) => (m.kind === "none" ? m : { kind: "none" }));
      if (id === urlItemId) {
        // Та же позиция (повторный клик, ссылка на себя): меняем только
        // вкладку и не плодим шаги истории — и не обещаем возврат туда, куда
        // записи в истории нет.
        setDetailReturnTo(null);
        setItemUrl(id, { tab });
        return;
      }
      setDetailReturnTo(returnTo ?? null);
      openItemUrl(id, { tab });
    },
    [urlItemId, openItemUrl, setItemUrl],
  );

  /**
   * Смена вкладки в панели: только URL, без нового шага истории. Вкладка
   * переживает перезагрузку и возврат по «Назад» к этой же позиции.
   */
  const setDetailTab = useCallback(
    (tab: DetailPanelTab) => {
      if (!urlItemId) return;
      setItemUrl(urlItemId, { tab });
    },
    [urlItemId, setItemUrl],
  );

  const openAdd = useCallback(
    (editId: string | null = null, parentId: string | null = null) =>
      setModal({ kind: "add", editId, parentId }),
    [],
  );
  /**
   * Слои, перекрывающие панель позиции. `?item=` не трогаем: закрыв слой,
   * пользователь возвращается в ту же позицию на той же вкладке.
   */
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
   * Открыть форму создания операции из выделения. Позиции, недоступные для
   * этого типа операции, исключаются: заглушки, материалы со статусом
   * «Доставлено»/«Заменить» для доставки и «Заменить» для монтажа, а также
   * материалы, уже включённые в другую операцию того же типа — в другую
   * доставку или в другой монтаж (независимо от их текущего статуса).
   * Доставка и монтаж независимы. Если после фильтрации не осталось позиций —
   * toast и модалку не открываем.
   */
  const openServiceOperation = useCallback(
    (type: ServiceOperationType) => {
      const hasReal = itemsRef.current.some(
        (i) => selected.has(i.id) && !i.isPlaceholder,
      );
      if (!hasReal) {
        showToast(
          "Выберите заполненные позиции — заглушки в операцию не включаются",
        );
        return;
      }

      // Один материал нельзя включить в две операции одного типа: для доставки
      // исключаем материалы из другой доставки, для монтажа — из другого
      // монтажа. Связи с операцией другого типа материал не блокируют.
      const inOtherDeliveries =
        type === "delivery" ? specItemIdsInDeliveries(operations) : null;
      const inOtherInstallations =
        type === "installation"
          ? specItemIdsInInstallations(operations)
          : null;
      const linkedToOther = (id: string) =>
        (inOtherDeliveries?.has(id) ?? false) ||
        (inOtherInstallations?.has(id) ?? false);

      const eligible = itemsRef.current.some(
        (i) =>
          selected.has(i.id) &&
          isSpecItemAllowedForOperation(i, type) &&
          !linkedToOther(i.id),
      );
      if (!eligible) {
        const onlyByStatus = itemsRef.current.some(
          (i) =>
            selected.has(i.id) && !isSpecItemAllowedForOperation(i, type),
        );
        const onlyByLinked = itemsRef.current.some(
          (i) =>
            selected.has(i.id) &&
            isSpecItemAllowedForOperation(i, type) &&
            linkedToOther(i.id),
        );
        if (type === "delivery") {
          if (onlyByLinked && !onlyByStatus) {
            showToast(
              "Нет позиций для доставки — выбранные материалы уже включены в другую доставку",
            );
          } else if (onlyByStatus && !onlyByLinked) {
            showToast(
              "Нет позиций для доставки — материалы со статусом «Доставлено»/«Заменить» в новую доставку не включаются",
            );
          } else {
            showToast(
              "Нет позиций для доставки — материалы уже входят в другую доставку или имеют статус «Доставлено»/«Заменить»",
            );
          }
        } else if (type === "installation") {
          if (onlyByLinked && !onlyByStatus) {
            showToast(
              "Нет позиций для монтажа — выбранные материалы уже включены в другой монтаж",
            );
          } else if (onlyByStatus && !onlyByLinked) {
            showToast(
              "Нет позиций для монтажа — материалы со статусом «Заменить» в монтаж не включаются",
            );
          } else {
            showToast(
              "Нет позиций для монтажа — материалы уже входят в другой монтаж или имеют статус «Заменить»",
            );
          }
        }
        return;
      }
      setModal({ kind: "operation", type });
    },
    [selected, showToast, operations],
  );

  /**
   * Открыть форму редактирования существующей операции (из бейджа в строке
   * или из детализации позиции). Отдельного «откуда пришли» не нужно: если
   * операцию открыли из панели, её `?item=` остался в URL, и после закрытия
   * панель вернётся сама.
   */
  const openServiceOperationEdit = useCallback(
    (operationId: string) => setModal({ kind: "edit-operation", operationId }),
    [],
  );

  /**
   * Создать свою услугу из карточки позиции («Подъём на этаж», «Хранение на
   * складе»). В отличие от доставки и монтажа, услуга не обязана быть привязана
   * к материалам, поэтому открываем форму даже без выделения: позиция, из
   * которой пришли, подставляется в список, и её можно снять.
   */
  const openServiceOperationCreate = useCallback(
    (preselectedItemIds: string[]) =>
      setModal({ kind: "operation", type: "service", preselectedItemIds }),
    [],
  );

  /**
   * Локально отмечает связанные позиции «Доставлено». Сервер уже записал
   * статус в рамках update/createServiceOperation — здесь только зеркалим
   * изменение в таблице, не добавляя патч в очередь сохранения.
   * Материалы со статусом «Заменить» пропускаем — авто-отметка не должна
   * сбрасывать осознанную замену позиции.
   */
  const markItemsDelivered = useCallback((ids: string[]) => {
    const set = new Set(ids);
    if (set.size === 0) return;
    setItems((prev) =>
      prev.map((i) =>
        set.has(i.id) && i.status !== "replace"
          ? { ...i, status: "delivered" }
          : i,
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
        `Добавлено · ${operationLabel(op)} · ${fmt(op.amount)} ₽`,
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
        `Сохранено · ${operationLabel(op)} · ${fmt(op.amount)} ₽`,
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
        `Удалено · ${operationLabel(op)} · ${fmt(op.amount)} ₽`,
      );
    },
    [closeModal, showToast],
  );

  // Escape закрывает верхний слой: сначала конфликт марки, потом модалку.
  // Панель позиции сюда не входит — её Dialog закрывает себя сам через
  // onOpenChange (`closeModal`), и повторный вызов задваивал бы «Назад».
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (codeConflict) {
        e.preventDefault();
        setCodeConflict(null);
        return;
      }
      if (modal.kind !== "none") {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [codeConflict, modal.kind, closeModal]);

  /**
   * Позиция панели. Отдельного состояния нет: пока `?item=` в URL, позиция
   * открыта — поэтому прямая ссылка, перезагрузка и браузерные «Назад»/
   * «Вперёд» работают без синхронизации состояния и URL.
   *
   * Верхний слой панель перекрывает: рисуем что-то одно.
   */
  const detailItem = urlItemId
    ? (items.find((i) => i.id === urlItemId) ?? null)
    : null;
  const current = modal.kind === "none" ? detailItem : null;
  /** Вкладка из URL — панель открывается на ней же после слоёв и перезагрузки. */
  const detailTab = urlTab ?? "overview";
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

  /** Дополнительные расходы проекта: итог по типам + общая сумма услуг.
   *  Операция учитывается один раз — см. lib/spec/project-budget.ts. */  const serviceTotals = useMemo(
    () => sumServiceOperationAmounts(operations),
    [operations],
  );
  const servicesTotal = serviceTotals.servicesTotal;

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
    serviceTotals,
    servicesTotal,
    projectTotal: calcProjectTotal(stats.totalSum, servicesTotal),
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
    setDetailTab,
    detailTab,
    openAdd,
    openDelete,
    openBulkDelete,
    openProcure,
    openSummary,
    openServiceOperation,
    openServiceOperationEdit,
    openServiceOperationCreate,
    onOperationCreated,
    onOperationUpdated,
    onOperationDeleted,
    closeModal,
    closeOverlay,

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
