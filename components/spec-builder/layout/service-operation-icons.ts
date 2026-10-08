import {
  ConciergeBell,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ServiceOperationType } from "@/lib/constants";

/**
 * Иконка типа операции. Список выбора, блок «Услуги» в карточке и бейджи в
 * строке таблицы показывают один и тот же набор — карта одна, чтобы иконки
 * типов не расходились между экранами.
 */
export const SERVICE_OPERATION_ICON: Record<ServiceOperationType, LucideIcon> = {
  delivery: Truck,
  installation: Wrench,
  service: ConciergeBell,
};
