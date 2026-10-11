import { describe, expect, it } from "vitest";

import { PROCUREMENT_FLOW, isInProcurementScope } from "@/lib/constants";
import { allowedStatuses } from "./status";

/**
 * Инвариант, на котором держится правило области воронки.
 *
 * Правило записано в проекте ДВАЖДЫ, и это сделано осознанно:
 *
 *   * `isInProcurementScope` (`lib/constants.ts`) — «воронка = не заглушка и
 *     статус из `PROCUREMENT_FLOW`»; по нему строка оплат в модалке закупки
 *     считает оплачено и остаток от стоимости (тикет 09);
 *   * `hooks/use-spec-builder.ts` — `items.filter((i) => !i.isPlaceholder)`,
 *     после чего стадии выбираются по статусу. Применить там правило целиком
 *     нельзя: этот же список идёт в `picking` и `replace`, а заглушка в
 *     `replace` обязана остаться в «Требуют замены».
 *
 * Две записи дают один и тот же набор для воронки ровно потому, что заглушку
 * НЕЛЬЗЯ перевести в `approved`/`ordered`/`delivered`. Это предположение нигде не
 * проверялось, и если оно когда-нибудь сломается (например, стадию воронки
 * добавят в `allowedStatuses` для заглушек), то «Сумма в закупке» и «Оплачено в
 * закупке» начнут считать РАЗНЫЕ позиции — молча, потому что оба числа
 * выглядят правдоподобно.
 *
 * Тест закрепляет это предположение там, где оно живёт: рядом со статусной
 * моделью.
 */
describe("заглушка и воронка закупки", () => {
  it("ни один статус воронки не разрешён заглушке", () => {
    const placeholderStatuses = allowedStatuses({ isPlaceholder: true });

    for (const status of PROCUREMENT_FLOW) {
      expect(placeholderStatuses).not.toContain(status);
    }
  });

  it("позицию без заглушки воронка принимает: правило не пустое", () => {
    // Обратная сторона: проверка выше прошла бы и на пустом списке статусов,
    // поэтому отдельно закрепляется, что воронка для обычной позиции достижима.
    const itemStatuses = allowedStatuses({ isPlaceholder: false });

    for (const status of PROCUREMENT_FLOW) {
      expect(itemStatuses).toContain(status);
      expect(
        isInProcurementScope({ isPlaceholder: false, status }),
      ).toBe(true);
    }
  });

  it("заглушка вне воронки даже с подходящим статусом", () => {
    // Вторая половина того же правила: дело не только в том, какие статусы
    // разрешены, но и в том, что заглушка исключена сама по себе.
    expect(
      isInProcurementScope({ isPlaceholder: true, status: "approved" }),
    ).toBe(false);
  });
});
