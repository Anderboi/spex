"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { variantSwitchDecision } from "@/lib/spec/status";
import type { SpecStatus } from "@/lib/constants";

/**
 * Смена варианта материала с оглядкой на статус позиции (ADR 0008).
 *
 * Согласованную позицию переключить можно, но не молча: согласовано было
 * прежнее исполнение, поэтому сначала спрашиваем, а статус возвращается в
 * «Подобрано». Заказанный и доставленный материал не меняют вовсе — там запрос
 * гасится, а не подтверждается.
 *
 * ── Почему диалог возвращается элементом, а не состоянием ──────────────────
 *
 * Три поверхности показывают смену варианта по-своему (пилюля в строке таблицы,
 * шторка в карточке, строки секции «Варианты»), но предупреждение у них одно.
 * Диалог при этом обязан жить ВНЕ `DropdownMenu` и `Drawer`: те закрываются по
 * клику и размонтируют своё содержимое, а вместе с ним и вопрос пользователю.
 *
 * Слова отказа и предупреждения берутся из правила (`variantSwitchDecision`), а
 * не пишутся здесь: теми же словами отвечает сервер, и вторая копия текста
 * разошлась бы с первой молча.
 */
export function useVariantSwitch({
  status,
  onSwitch,
}: {
  status: SpecStatus;
  onSwitch: (variantId: string) => void;
}) {
  const decision = variantSwitchDecision(status);
  const [pending, setPending] = useState<string | null>(null);

  // Зависимость — вид решения, а не объект: `variantSwitchDecision` отдаёт
  // новый объект на каждый рендер, и `request` пересобирался бы вместе с ним,
  // ломая мемоизацию строк списка.
  const { kind } = decision;

  const request = useCallback(
    (variantId: string) => {
      // Заблокированную смену гасим и здесь: строки выключены, но клик мог
      // прийти с клавиатуры или из разметки, собранной до смены статуса.
      if (kind === "forbid") return;

      if (kind === "confirm") {
        setPending(variantId);
        return;
      }

      onSwitch(variantId);
    },
    [kind, onSwitch],
  );

  const dialog =
    decision.kind === "confirm" ? (
      <ConfirmDialog
        open={pending !== null}
        title="Сменить вариант материала?"
        description={decision.warning}
        confirmLabel="Сменить вариант"
        onConfirm={() => {
          if (pending) onSwitch(pending);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    ) : null;

  return { decision, request, dialog };
}
