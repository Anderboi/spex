import { SpecStatus } from '../constants';

export const SPEC_STATUS_CONFIG: Record<
  SpecStatus,
  {
    label: string;
    dot: string;
    chip: string;
    bar: string;
  }
> = {
  draft: {
    label: "Не выбрано",
    dot: "bg-fg-muted",
    chip: "bg-bg-select text-fg-secondary",
    bar: "#9b968c",
  },
  picked: {
    label: "Подобрано",
    dot: "bg-blue-500",
    chip: "bg-blue-500/12 text-blue-600",
    bar: "#3b82f6",
  },
  approved: {
    label: "Согласовано",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/12 text-emerald-600",
    bar: "#10b981",
  },
  ordered: {
    label: "Приобретено",
    dot: "bg-amber-500",
    chip: "bg-amber-500/12 text-amber-600",
    bar: "#f59e0b",
  },
  delivered: {
    label: "Доставлено",
    dot: "bg-emerald-700",
    chip: "bg-emerald-700/12 text-emerald-700",
    bar: "#047857",
  },
  replace: {
    label: "Заменить",
    dot: "bg-bg-red",
    chip: "bg-bg-red/12 text-fg-red",
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
