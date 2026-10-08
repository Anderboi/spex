import {
  SERVICE_OPERATION_CONFIG,
  type ServiceOperationType,
} from "@/lib/constants";

/**
 * Тип услуги: «Доставка», «Монтаж» и своя услуга.
 *
 * Тип приходит в форму предвыбранным — из команды списка в карточке материала
 * или из кнопки нижней панели — и остаётся обычным полем формы, которое можно
 * сменить. Поэтому «что значит этот тип» описано здесь, а не в разметке:
 * диалог и combobox карточки спрашивают одно и то же, и второй копии
 * формулировок не появляется.
 */

/** Поле выбора типа в форме: «Доставка», «Монтаж» или своя услуга. */
export type ServiceTypePick =
  | { kind: "fixed"; type: "delivery" | "installation" }
  | { kind: "custom"; name: string | null };

/** Подпись типа в форме: у своих услуг вместо типа — название. */
export function serviceTypeLabel(type: ServiceOperationType): string {
  return type === "service" ? "Своя услуга" : SERVICE_OPERATION_CONFIG[type].label;
}

/**
 * Подпись действия «создать услугу этого типа».
 *
 * Винительный падеж задан явно, а не собран из подписи типа: «Создать
 * доставка» — не по-русски, а склонять названия по общим правилам здесь нечем.
 * Одна таблица на все места, где услуга создаётся: команда в списке карточки и
 * кнопка сохранения формы называют одно и то же одинаково.
 */
export function serviceTypeCreateLabel(type: ServiceOperationType): string {
  if (type === "delivery") return "Создать доставку";
  if (type === "installation") return "Создать монтаж";
  return "Создать услугу";
}
