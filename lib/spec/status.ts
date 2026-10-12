import { SpecStatus } from '../constants';

export const SPEC_STATUS_CONFIG: Record<
  SpecStatus,
  {
    label: string;
    sub?: string;
    dot: string;
    chip: string;
    bar: string;
  }
> = {
  draft: {
    label: "Не выбрано",
    dot: "bg-fg-muted",
    chip: "hover:bg-bg-select text-fg-secondary",
    bar: "#9b968c",
  },
  picked: {
    label: "Подобрано",
    sub: "готово к согласованию",
    dot: "bg-blue-500",
    chip: "hover:bg-blue-500/12 text-blue-600",
    bar: "#3b82f6",
  },
  approved: {
    label: "Согласовано",
    sub: "ожидает заказа",
    dot: "bg-emerald-500",
    chip: "hover:bg-emerald-500/12 text-emerald-600",
    bar: "#10b981",
  },
  ordered: {
    label: "Заказано",
    sub: "в производстве или пути",
    dot: "bg-amber-500",
    chip: "hover:bg-amber-500/12 text-amber-600",
    bar: "#f59e0b",
  },
  delivered: {
    label: "Доставлено",
    sub: "на объекте",
    dot: "bg-emerald-700",
    chip: "hover:bg-emerald-700/12 text-emerald-700",
    bar: "#047857",
  },
  replace: {
    label: "Заменить",
    sub: "брак или пересмотр",
    dot: "bg-bg-red",
    chip: "hover:bg-bg-red/12 text-fg-red",
    bar: "#dc2626",
  },
};

/** С этих статусов позиция считается зафиксированной: марка в чертежах, деньги потрачены. */
export const LOCKED_STATUSES: SpecStatus[] = [
  "approved",
  "ordered",
  "delivered",
];
export const isLocked = (s: SpecStatus) => LOCKED_STATUSES.includes(s);

/** Заглушку нельзя двигать дальше «подобрано» — согласовывать нечего. */
export function allowedStatuses(item: {
  isPlaceholder: boolean;
}): SpecStatus[] {
  return item.isPlaceholder
    ? ["draft", "picked", "replace"]
    : ["draft", "picked", "approved", "ordered", "delivered", "replace"];
}

/** Текст предупреждения при откате назад. null — предупреждать не о чем. */
export function statusWarning(from: SpecStatus, to: SpecStatus): string | null {
  const order: SpecStatus[] = [
    "draft",
    "picked",
    "approved",
    "ordered",
    "delivered",
  ];
  const a = order.indexOf(from),
    b = order.indexOf(to);
  if (to === "replace" && isLocked(from))
    return "Позиция уже в закупке — отметка «Заменить» затронет заказ.";
  if (a > -1 && b > -1 && b < a && isLocked(from))
    return "Откат статуса назад после закупки. Убедитесь, что это не ошибка.";
  return null;
}

/**
 * Что смена варианта материала означает для позиции в этом статусе.
 *
 * ── Почему правило живёт здесь, а не в разметке ────────────────────────────
 *
 * Смену варианта показывают три поверхности (`variant-switcher.tsx` в строке
 * таблицы, `variant-switcher-mobile.tsx` в карточке и секция «Варианты» в
 * `overview-tab.tsx`), и каждая обязана спросить одно и то же. Слова отказа и
 * предупреждения тоже одни на всех: вторая копия текста разошлась бы с первой
 * молча, а сервер (`switchVariant`, `actions/spec-variants.ts`) отвечает теми же
 * словами, что показывает интерфейс.
 *
 *   * `allow` — обычная смена: статус не при чём;
 *   * `confirm` — согласованную позицию переключить можно, но не молча:
 *     согласование относилось к прежнему материалу;
 *   * `forbid` — заказанный и доставленный материал не меняют: он уже в
 *     производстве или на объекте, и «сменить вариант» означало бы подменить
 *     то, за что заплачено.
 */
export type VariantSwitchDecision =
  | { kind: "allow" }
  | { kind: "confirm"; warning: string }
  | { kind: "forbid"; reason: string };

export function variantSwitchDecision(
  status: SpecStatus,
): VariantSwitchDecision {
  if (status === "approved")
    return {
      kind: "confirm",
      warning:
        "Согласование относилось к прежнему материалу. После смены варианта статус станет «Подобрано» — позицию нужно согласовать заново.",
    };

  if (status === "ordered" || status === "delivered")
    return {
      kind: "forbid",
      reason: `Смена варианта недоступна: материал уже ${
        status === "ordered" ? "заказан" : "доставлен"
      }.`,
    };

  return { kind: "allow" };
}

/**
 * Статус позиции после смены варианта: согласование снимается, остальное не
 * трогается.
 *
 * Согласие относилось к конкретному материалу, а не к позиции вообще: подменив
 * материал, мы потеряли то, о чём договаривались, и статус обязан вернуться к
 * «Подобрано». Заказанное и доставленное сюда не заходят — их смена варианта
 * запрещена целиком (`variantSwitchDecision`), поэтому перехода из них не
 * бывает.
 *
 * Функция чистая и живёт здесь по той же причине, что и `statusAfterPayment`:
 * этим правилом клиент ДОГОНЯЕТ локальное состояние после ответа сервера —
 * список, воронка и бейдж статуса не должны показывать прежнее «Согласовано».
 */
export function statusAfterVariantSwitch(status: SpecStatus): SpecStatus {
  return status === "approved" ? "picked" : status;
}

/**
 * Статус позиции после ФАКТИЧЕСКОЙ оплаты: согласованная становится заказанной.
 *
 * Оплата — это заказ (ADR [0007](../../docs/adr/0007-oplata-zakazyvaet-poziciyu.md)):
 * деньги ушли поставщику, и позиция перестаёт «ожидать заказа». Другие статусы
 * функция не двигает, и это не недосмотр:
 *
 *   * «Заказано» и «Доставлено» уже пройдены — оплата их не откатывает;
 *   * «Заменить» — решение человека о браке, а не следствие денег;
 *   * «Не выбрано» и «Подобрано» оплатить нельзя вовсе (ворота стоят до записи),
 *     поэтому перехода из них не бывает.
 *
 * Возврат сюда не заходит: он исправляет уже записанные деньги, а не заказывает
 * позицию. Вид записи знает вызывающий и зовёт функцию только для оплаты.
 *
 * Функция чистая и живёт здесь, а не в разметке: этим же правилом клиент
 * ДОГОНЯЕТ локальное состояние после ответа сервера — список и воронка не должны
 * показывать прежний статус. Вторая копия правила разошлась бы с первой молча.
 */
export function statusAfterPayment(status: SpecStatus): SpecStatus {
  return status === "approved" ? "ordered" : status;
}
