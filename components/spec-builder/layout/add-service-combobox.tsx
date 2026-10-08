"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  ConciergeBell,
  Loader2,
  Plus,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { fmt } from "@/lib/utils";
import {
  SERVICE_OPERATION_BLOCKED_STATUSES,
  SERVICE_OPERATION_CONFIG,
  type FixedServiceOperationType,
  type ServiceOperationType,
} from "@/lib/constants";
import {
  serviceTypeCreateLabel,
  serviceTypeLabel,
  type ServiceTypePick,
} from "@/lib/spec/service-type";
import type { ServiceOperation } from "@/actions/service-operations";
import {
  describeLinkedItems,
  hasServiceNamed,
  isReservedServiceName,
  isServiceLinkedToItem,
  linkedItemIndex,
  matchesServiceLabel,
  matchesServiceQuery,
  normalizeServiceName,
  serviceCatalog,
  type LinkedItemRef,
  type ServiceCatalogEntry,
  type ServiceTargetItem,
} from "@/lib/spec/service-catalog";
import { SERVICE_OPERATION_ICON } from "./service-operation-icons";

/** Понятное название списка услуг: cmdk кладёт его в `aria-label` listbox'а. */
const LIST_LABEL = "Услуги проекта";

/**
 * Доступное имя триггера. Совпадает с видимым текстом, но задано явно: `render`
 * у `PopoverTrigger` передаёт разметку кнопки, и её содержимое не становится
 * доступным именем — без этого combobox не находится ни скринридером, ни
 * тестами по роли.
 */
const TRIGGER_LABEL = "Добавить услугу";

/** Доступное имя поля поиска — оно же его placeholder. */
const SEARCH_LABEL = "Найти или создать услугу";

/** Фиксированные типы в порядке кнопок быстрого добавления. */
const QUICK_TYPES: readonly FixedServiceOperationType[] = [
  "delivery",
  "installation",
];

/**
 * Createable Combobox «Добавить услугу» в карточке материала: найти
 * существующую услугу проекта или создать новую.
 *
 * ── Почему список — это операции проекта ──────────────────────────────────
 *
 * Отдельного справочника услуг в проекте нет: «Доставка», «Монтаж» и свои
 * услуги живут как `service_operations` проекта. Combobox не заводит вторую
 * модель и не придумывает hardcoded-кнопки под «Доставку» и «Монтаж» — они
 * попадают в список как обычные услуги (см. `lib/spec/service-catalog.ts`).
 *
 * ── Две группы списка ────────────────────────────────────────────────────
 *
 * «Услуги проекта» — то, что можно привязать к этой позиции; «Создать» —
 * команды на новый тип. Тип в команде, а не в тексте: «Доставка» и «Монтаж»
 * зарезервированы за фиксированными типами, и набранное название фиксированный
 * тип означать не может. Команды «Создать доставку» и «Создать монтаж»
 * показываются только тогда, когда у позиции их ещё нет: правило «одна доставка
 * и один монтаж на материал» видно заранее, а не падает при сохранении.
 *
 * ── Где создаётся услуга ─────────────────────────────────────────────────
 *
 * Здесь форма не дублируется: выбор команды открывает существующую модалку
 * услуги (`ServiceOperationModal`) с предвыбранным типом и названием и с этой
 * позицией в списке. Привязка существующей услуги идёт через существующий
 * `updateServiceOperation` (см. `onAddExistingService`).
 */
/* ------------------------------------------------------------------ */

export function AddServiceCombobox({
  item,
  items,
  catalog: operations,
  onAddExistingService,
  onCreateService,
  onRetryCatalog,
  catalogError = null,
  loading = false,
  disabled = false,
}: {
  /**
   * Позиция, к которой добавляется услуга: id, подпись для строки списка и
   * правила статуса для кнопок быстрого добавления.
   */
  item: ServiceTargetItem;
  /** Позиции проекта: по ним видно, какие материалы уже в каждой услуге. */
  items: readonly LinkedItemRef[];
  /** Все услуги проекта — источник списка и поиска. */
  catalog: ServiceOperation[];
  /**
   * Привязать существующую услугу к материалу. `false` — не получилось: ошибку
   * показывает вызывающий (тост), а combobox остаётся открытым для повтора.
   */
  onAddExistingService: (operation: ServiceOperation) => Promise<boolean>;
  /**
   * Создать новую услугу. Тип приходит из команды списка или от кнопки быстрого
   * добавления, название — из набранного текста; саму форму открывает
   * вызывающий, а операция появляется по её сохранению.
   */
  onCreateService: (type: ServiceOperationType, name: string | null) => void;
  /** Повторить загрузку списка услуг после ошибки. */
  onRetryCatalog?: () => void;
  /** Список услуг не загрузился: показать ошибку и повтор вместо пустого списка. */
  catalogError?: string | null;
  /** Список услуг ещё грузится. */
  loading?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Какая услуга сейчас привязывается — для понятного состояния загрузки. */
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  /** Защита от повторного клика: состояние не успевает перерисоваться. */
  const picking = useRef(false);

  const itemId = item.id;
  /** Подпись материала карточки: к какому именно материалу привяжется услуга. */
  const materialLabel = [item.code, item.name].filter(Boolean).join(" · ");
  /** Позиции по id: нужны, чтобы назвать связи операции, а не только их число. */
  const itemIndex = useMemo(() => linkedItemIndex(items), [items]);

  const entries = serviceCatalog(operations);
  const visible = entries.filter((e) => matchesServiceQuery(e, query));

  /** Своя услуга с таким названием уже есть — создавать её заново нельзя. */
  const typed = query.trim();
  const duplicate = !catalogError && hasServiceNamed(entries, typed);
  /** «Доставка» и «Монтаж» — имена фиксированных типов, а не свои услуги. */
  const reserved = isReservedServiceName(typed);
  const canCreate = typed.length > 0 && !duplicate && !reserved;

  /**
   * Услуга фиксированного типа, в которой материал карточки уже состоит. Такая
   * ровно одна: правило «одна доставка и один монтаж на материал» живёт на
   * сервере, а здесь видно заранее — и командой создания, и недоступной строкой
   * чужой операции.
   */
  const fixedLinked = (type: ServiceOperationType) =>
    entries.find((e) => e.type === type && e.linkedItemIds.includes(itemId));

  /**
   * Строку нельзя выбрать: материал уже в ДРУГОЙ операции этого типа. Сервер
   * такую привязку отклонит, поэтому выбирать нечего — остаётся объяснить.
   */
  const blockedByOther = (entry: ServiceCatalogEntry) =>
    entry.type !== "service" &&
    !isServiceLinkedToItem(entry, itemId) &&
    fixedLinked(entry.type) !== undefined;

  // «Уже добавлена» читается из данных каталога: у операции есть список
  // связанных позиций. Отдельного состояния «только что добавили» не нужно —
  // после привязки обновлённая операция возвращается действием и попадает в
  // каталог, поэтому отметка появляется без перезагрузки.
  const linkedToItem = (entry: ServiceCatalogEntry) =>
    isServiceLinkedToItem(entry, itemId);

  /**
   * Что стоит второй строкой под названием услуги: к каким позициям она уже
   * относится. «В проекте · 20 материалов» — число без адресата, поэтому рядом
   * идут коды позиций.
   */
  const entryHint = (entry: ServiceCatalogEntry): string => {
    if (blockedByOther(entry)) {
      return entry.type === "delivery"
        ? "уже в другой доставке"
        : "уже в другом монтаже";
    }
    const linked = describeLinkedItems(entry.linkedItemIds, itemIndex);
    const list = linked.short + (linked.rest > 0 ? ` +${linked.rest}` : "");
    if (linkedToItem(entry)) {
      return list ? `уже в этом материале · ${list}` : "уже в этом материале";
    }
    if (linked.total === 0) return "ни к одной позиции не привязана";
    return list || `позиций: ${linked.total}`;
  };

  /** Подсказка строки: сумма операции и полный список её позиций. */
  const entryTitle = (entry: ServiceCatalogEntry): string => {
    const linked = describeLinkedItems(
      entry.linkedItemIds,
      itemIndex,
      Number.MAX_SAFE_INTEGER,
    );
    const parts = [`${entry.label} · ${fmt(entry.operation.amount)} ₽`];
    parts.push(
      linked.full
        ? `Позиции операции:\n${linked.full}`
        : "Позиции операции: пока ни одной",
    );
    if (entry.operation.completed) parts.push("исполнена");
    if (entry.operation.deadline) {
      const date = new Date(
        `${entry.operation.deadline}T00:00:00`,
      ).toLocaleDateString("ru-RU");
      parts.push(`срок: ${date}`);
    }
    if (entry.operation.contractor_name) {
      parts.push(`подрядчик: ${entry.operation.contractor_name}`);
    }
    return parts.join("\n");
  };

  /**
   * Быстрое добавление «Доставки» или «Монтажа»: открывается обычная форма
   * услуги с предзаполненным типом и этой позицией — операция появится по её
   * сохранению.
   *
   * Существующая услуга проекта не подхватывается. Молча присоединить материал к
   * чужой доставке — значит сложить две стоимости в одну и не сказать об этом:
   * во втором материале пользователь вводит свою стоимость, а она уходит в общую
   * операцию. Объединить материалы в одну услугу можно осознанно — выбрать её
   * строку в списке «Добавить услугу».
   *
   * Операция не создаётся заранее: закрытая форма не должна оставлять в проекте
   * доставку за 0 ₽.
   */
  const quickAddFixed = (type: FixedServiceOperationType) => {
    if (busy || picking.current || quickAddBlocked(type) !== null) return;
    onCreateService(type, null);
  };

  /**
   * Почему кнопку быстрого добавления нажать нельзя.
   *
   * Пока список услуг не загружен, кнопка молчит: по пустому каталогу нельзя
   * решить, есть ли уже доставка в проекте, — а решение «ни одной» создаёт
   * новую услугу, то есть дубль. Дальше идут те же правила, что проверяет
   * сервер: заглушка и запрещённые для этого типа статусы.
   */
  const quickAddBlocked = (type: FixedServiceOperationType): string | null => {
    if (catalogError) {
      return "Список услуг проекта не загрузился — повторите загрузку";
    }
    if (loading) return "Загружаем услуги проекта…";
    if (item.isPlaceholder) {
      return "Заглушку нельзя включить в услугу — сначала заполните позицию";
    }
    if (SERVICE_OPERATION_BLOCKED_STATUSES[type].includes(item.status)) {
      return type === "delivery"
        ? "Материал со статусом «Доставлено» или «Заменить» в доставку не включается"
        : "Материал со статусом «Заменить» в монтаж не включается";
    }
    return null;
  };

  const close = () => {
    setOpen(false);
    setQuery("");
    setError(null);
  };

  /** Привязать существующую услугу к материалу. */
  const pickExisting = async (entry: ServiceCatalogEntry) => {
    // Повторный Enter/клик, пока запрос в пути, не должен создать вторую услугу.
    if (picking.current) return;
    picking.current = true;
    setError(null);
    setBusy(true);
    setBusyLabel(entry.label);

    const added = await onAddExistingService(entry.operation);

    picking.current = false;
    setBusy(false);
    setBusyLabel(null);
    if (!added) {
      // Ошибку показал вызывающий (тост); здесь она остаётся рядом со списком,
      // чтобы выбор можно было повторить, не открывая combobox заново.
      setError("Не удалось добавить услугу к материалу");
      return;
    }
    close();
  };

  /** Выбрать создание: форма открывается вызывающим, а не здесь. */
  const pickCreate = (type: ServiceOperationType, name: string | null) => {
    if (picking.current) return;
    picking.current = true;
    close();
    // Диалог открывается следующим кадром: поповер к этому моменту закрыт, и
    // два слоя не спорят за фокус (так же открываются карточки в
    // существующих пикерах — см. `supplier-picker`).
    requestAnimationFrame(() => {
      picking.current = false;
      onCreateService(type, name);
    });
  };

  /**
   * Команды создания. Порядок фиксирован: сначала фиксированные типы, потом
   * своя услуга — как и в списке выше, где «Доставка» и «Монтаж» идут первыми.
   *
   * Команды фильтруются ТЕМ ЖЕ поиском, что и список услуг. Без этого набранное
   * название не создать с клавиатуры: активной строкой осталась бы «Создать
   * доставку», и Enter создавал бы доставку вместо услуги с введённым именем.
   *
   * Своей услуги в списке нет, пока не набрано свободное название: имя своей
   * услуги — это и есть то, что вводят в поиск. Дубликат по названию и
   * зарезервированное имя команду не создают.
   */
  const createCommands: Array<{
    key: string;
    type: ServiceOperationType;
    label: string;
    name: string | null;
  }> = [];
  const createLabels = {
    delivery: serviceTypeCreateLabel("delivery"),
    installation: serviceTypeCreateLabel("installation"),
  };
  if (
    !fixedLinked("delivery") &&
    matchesServiceLabel(createLabels.delivery, query)
  ) {
    createCommands.push({
      key: "create:delivery",
      type: "delivery",
      label: createLabels.delivery,
      name: null,
    });
  }
  if (
    !fixedLinked("installation") &&
    matchesServiceLabel(createLabels.installation, query)
  ) {
    createCommands.push({
      key: "create:installation",
      type: "installation",
      label: createLabels.installation,
      name: null,
    });
  }
  if (canCreate) {
    createCommands.push({
      key: `create:${typed}`,
      type: "service",
      label: `Создать «${typed}»`,
      name: typed,
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Пока идёт привязка, закрывать нельзя: результат ещё не получен.
        if (busy) return;
        if (next) setError(null);
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      {/*
        Триггер списка и кнопки быстрого добавления стоят рядом: «Доставка» и
        «Монтаж» — самые частые услуги, и ради них не нужно открывать список и
        искать строку. Кнопка заводит СВОЮ услугу этому материалу и не трогает
        уже существующие в проекте.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-label={TRIGGER_LABEL}
              disabled={disabled}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              Добавить услугу
              <ChevronsUpDown className="size-3.5 opacity-50" />
            </Button>
          }
        />

        {QUICK_TYPES.map((type) => {
          // Услуга уже назначена этому материалу — кнопки нет: правило «одна
          // доставка и один монтаж на материал» не даёт добавить вторую.
          if (fixedLinked(type)) return null;
          const reason = quickAddBlocked(type);
          const Icon = SERVICE_OPERATION_ICON[type];
          return (
            <Button
              key={type}
              type="button"
              variant="outline"
              disabled={disabled || busy || reason !== null}
              title={
                reason ??
                `Отдельная «${SERVICE_OPERATION_CONFIG[type].label}» для этого материала`
              }
              onClick={() => quickAddFixed(type)}
              className="gap-1.5"
            >
              <Icon className="size-3.5" />
              {SERVICE_OPERATION_CONFIG[type].label}
            </Button>
          );
        })}
      </div>

      <PopoverContent
        className="//w-(--anchor-width) min-w-72 w-full bg-bg-card p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          {/*
            Поле поиска подписано своим placeholder'ом: `CommandInput` отдаёт его
            в доступное имя (см. `components/ui/command.tsx` — там же объяснено,
            почему подпись ставится после монтирования).
          */}
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            disabled={busy}
            placeholder={SEARCH_LABEL}
          />

          {/*
            Список услуг и команды создания живут в одном `CommandList`: cmdk
            хранит активную строку в контексте, и разнесение их по двум спискам
            сломало бы навигацию стрелками. Пока список грузится или не
            загрузился, выбирать нечего — там отдельный список без подписи,
            чтобы `aria-label` не оставался на пустом состоянии.
          */}
          {loading ? (
            <CommandList>
              <p className="flex items-center gap-2 px-2 py-3 text-[12.5px] text-fg-muted">
                <Loader2 className="size-3.5 animate-spin" />
                Загружаем услуги…
              </p>
            </CommandList>
          ) : catalogError ? (
            <CommandList>
              <div className="flex flex-col gap-2 px-2 py-3">
                <p
                  role="alert"
                  className="flex items-start gap-2 text-[12.5px] leading-relaxed text-fg-red"
                >
                  <AlertCircle className="mt-px size-3.5 shrink-0" />
                  {catalogError}
                </p>
                {onRetryCatalog && (
                  <Button
                    type="button"
                    variant="outline"
                    // size="sm"
                    onClick={onRetryCatalog}
                    className="self-start"
                  >
                    Повторить
                  </Button>
                )}
              </div>
            </CommandList>
          ) : (
            <CommandList label={LIST_LABEL}>
              {/*
                Контекст материала. Выбор существующей услуги меняет не
                «справочник», а конкретную карточку, и без этой строки
                непонятно, к какому материалу услуга привяжется.
              */}
              {materialLabel && (
                <p className="px-2 pt-2 pb-1 text-[11.5px] leading-relaxed text-fg-muted">
                  Материал карточки: <span className="text-fg-secondary">{materialLabel}</span>
                </p>
              )}

              {entries.length === 0 && (
                <p className="px-2 py-3 text-[12.5px] leading-relaxed text-fg-muted">
                  Услуг пока нет
                </p>
              )}

              {entries.length > 0 && visible.length === 0 && (
                <p className="px-2 py-3 text-[12.5px] leading-relaxed text-fg-muted">
                  Ничего не найдено
                </p>
              )}

              {visible.length > 0 && (
                <CommandGroup heading="Услуги проекта">
                  {visible.map((entry) => {
                    const Icon = SERVICE_OPERATION_ICON[entry.type];
                    const linked = linkedToItem(entry);
                    const blocked = blockedByOther(entry);
                    return (
                      <CommandItem
                        key={entry.key}
                        // Уже добавленная услуга остаётся в списке, но выбрать
                        // её нельзя: материал в ней уже есть. Так же недоступна
                        // чужая доставка (или монтаж), если материал уже в
                        // другой операции того же типа. cmdk при навигации
                        // стрелками перешагивает отключённые строки.
                        value={entry.key}
                        disabled={linked || blocked || busy}
                        keywords={[entry.label]}
                        title={entryTitle(entry)}
                        onSelect={() => void pickExisting(entry)}
                      >
                        <Icon className="mr-1 size-4 text-fg-muted" />
                        {/* Вторая строка отвечает на вопрос, к каким позициям
                            относится услуга: без неё в строке только название и
                            сумма, и непонятно, к кому материал присоединится. */}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{entry.label}</span>
                          <span className="truncate text-[11px] leading-tight text-fg-dim">
                            {entryHint(entry)}
                          </span>
                        </span>
                        {entry.operation.amount > 0 && (
                          <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-fg-muted">
                            {fmt(entry.operation.amount)} ₽
                          </span>
                        )}
                        {linked && <Check className="ml-1 size-4 text-fg-green" />}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {busy && (
                <p
                  role="status"
                  className="flex items-center gap-2 px-2 py-2 text-[12.5px] text-fg-muted"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                  Добавляем «{busyLabel}»…
                </p>
              )}

              {!busy && createCommands.length > 0 && (
                <CommandGroup heading="Создать">
                  {createCommands.map((cmd) => {
                    const Icon = SERVICE_OPERATION_ICON[cmd.type];
                    return (
                      <CommandItem
                        key={cmd.key}
                        value={cmd.key}
                        keywords={[cmd.label]}
                        onSelect={() => pickCreate(cmd.type, cmd.name)}
                      >
                        <Icon className="mr-1 size-4 text-fg-brand" />
                        <span className="min-w-0 truncate">{cmd.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {error && (
                <p
                  role="alert"
                  className="mx-1 mb-1 rounded-md border border-border-red bg-bg-red-light px-2 py-1.5 text-[12.5px] leading-relaxed text-fg-red"
                >
                  {error}
                </p>
              )}
            </CommandList>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/*  Тип услуги в форме создания                                       */
/* ------------------------------------------------------------------ */

/**
 * Createable Combobox «Тип услуги» для формы услуги: «Доставка», «Монтаж» или
 * своя услуга с названием.
 *
 * Тип приходит в форму предвыбранным — из команды списка в карточке материала
 * или из кнопки нижней панели — и остаётся обычным полем, которое можно
 * сменить. Своя услуга создаётся вводом названия: введённое и есть её имя,
 * поэтому отдельного пункта «Своя услуга» не нужно — без ввода строка
 * называется «Создать услугу». Имена «Доставка» и «Монтаж» зарезервированы за
 * фиксированными типами: занять их своей услугой нельзя (см.
 * `isReservedServiceName`).
 */
export function ServiceTypeCombobox({
  type,
  onChange,
  usedCustomNames = [],
  disabled = false,
  label = "Тип услуги",
}: {
  /** Текущий тип: доставка, монтаж или своя услуга. */
  type: ServiceOperationType;
  onChange: (next: ServiceTypePick) => void;
  /** Названия своих услуг, уже созданных в проекте: подсказки для ввода. */
  usedCustomNames?: string[];
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const typed = query.trim();
  const current = serviceTypeLabel(type);
  /** Совпадение с уже существующей услугой проекта — создавать нечего. */
  const duplicate = usedCustomNames.some(
    (n) => normalizeServiceName(n) === normalizeServiceName(typed),
  );
  /** «Доставка» и «Монтаж» — имена фиксированных типов, а не свои услуги. */
  const reserved = isReservedServiceName(typed);
  const canCreate = typed.length > 0 && !duplicate && !reserved;

  const commit = (pick: ServiceTypePick) => {
    setOpen(false);
    setQuery("");
    onChange(pick);
  };

  const rows: Array<{
    key: string;
    label: string;
    icon: LucideIcon;
    pick: ServiceTypePick;
  }> = [
    {
      key: "delivery",
      label: SERVICE_OPERATION_CONFIG.delivery.label,
      icon: Truck,
      pick: { kind: "fixed", type: "delivery" },
    },
    {
      key: "installation",
      label: SERVICE_OPERATION_CONFIG.installation.label,
      icon: Wrench,
      pick: { kind: "fixed", type: "installation" },
    },
  ];

  // Поиск по тем же правилам, что и в списке услуг карточки: фильтр один на
  // проект, второй копии сравнения строк не появляется.
  const needle = normalizeServiceName(query);
  const visible = rows.filter(
    (row) => !needle || row.label.toLowerCase().includes(needle),
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Закрытие без выбора не должно оставлять прежний запрос: иначе список
        // окажется отфильтрованным «навсегда».
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={label}
            disabled={disabled}
            className="h-10 w-full justify-between border-0 bg-bg-card font-semibold hover:bg-bg-card"
          >
            <span className="truncate">{current}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />

      <PopoverContent
        className="w-(--anchor-width) min-w-64 bg-bg-card p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Найти или создать тип…"
          />
          <CommandList label="Типы услуг">
            <CommandGroup heading="Типы">
              {visible.map((row) => (
                <CommandItem
                  key={row.key}
                  value={row.key}
                  keywords={[row.label]}
                  onSelect={() => commit(row.pick)}
                >
                  <row.icon className="mr-1 size-4 text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.pick.kind === "fixed" &&
                    type === row.pick.type && (
                      <Check className="ml-1 size-4 text-fg-green" />
                    )}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Своя услуга">
              <CommandItem
                value={`create:${typed}`}
                // Пустое поле строку не блокирует: это «создать свою услугу»,
                // название которой вводится в самой форме. Дубликат по
                // названию, наоборот, заблокирован.
                disabled={!canCreate && typed.length > 0}
                keywords={[`Создать ${typed}`]}
                onSelect={() => commit({ kind: "custom", name: typed || null })}
              >
                <ConciergeBell className="mr-1 size-4 text-fg-brand" />
                <span className="min-w-0 flex-1 truncate">
                  {canCreate
                    ? `Создать «${typed}»`
                    : reserved
                      ? `«${typed}» — имя фиксированного типа`
                      : duplicate
                        ? `«${typed}» уже есть в услугах`
                        : "Создать услугу"}
                </span>
                {type === "service" && (
                  <Check className="ml-1 size-4 text-fg-green" />
                )}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

