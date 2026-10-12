import { describe, expect, it } from "vitest";

import { PROCUREMENT_FLOW, isInProcurementScope } from "@/lib/constants";
import {
  allowedStatuses,
  statusAfterPayment,
  statusAfterVariantSwitch,
  variantSwitchDecision,
} from "./status";

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

/**
 * Правило оплаты: согласованная позиция становится заказанной (ADR 0007).
 *
 * Проверяются все шесть статусов, а не только «Согласовано»: список короткий, и
 * именно на нём видно, что функция не «двигает статус вперёд», а переводит ровно
 * один переход — остальные оставляет человеку.
 */
describe("statusAfterPayment", () => {
  it("согласованную позицию оплата заказывает", () => {
    expect(statusAfterPayment("approved")).toBe("ordered");
  });

  it("пройденные статусы не откатывает", () => {
    expect(statusAfterPayment("ordered")).toBe("ordered");
    expect(statusAfterPayment("delivered")).toBe("delivered");
  });

  it("«Заменить» и статусы до согласования не трогает", () => {
    // Из «Не выбрано» и «Подобрано» оплатить нельзя вовсе (ворота стоят до
    // записи), а «Заменить» — решение человека о браке, а не следствие денег.
    expect(statusAfterPayment("draft")).toBe("draft");
    expect(statusAfterPayment("picked")).toBe("picked");
    expect(statusAfterPayment("replace")).toBe("replace");
  });
});

/**
 * Смена варианта материала и статус позиции (ADR 0008).
 *
 * Правило проверяется по всем шести статусам: список короткий, и именно на нём
 * видно, что запретов ровно два (`ordered`, `delivered`), подтверждение ровно
 * одно (`approved`), а остальные статусы смена варианта не трогает.
 */
describe("variantSwitchDecision", () => {
  it("согласованную позицию переключают только с подтверждением", () => {
    const decision = variantSwitchDecision("approved");

    expect(decision.kind).toBe("confirm");
    // Текст — часть решения, а не разметки: им же предупреждает сервер, и
    // подмена его на «Вы уверены?» оставила бы пользователя без причины.
    expect(decision.kind === "confirm" && decision.warning).toContain(
      "«Подобрано»",
    );
  });

  it("заказанный и доставленный материал не меняют", () => {
    for (const status of ["ordered", "delivered"] as const) {
      const decision = variantSwitchDecision(status);

      expect(decision.kind, status).toBe("forbid");
      expect(decision.kind === "forbid" && decision.reason).toBeTruthy();
    }
  });

  it("до согласования, «Заменить» и «Не выбрано» — смена без вопросов", () => {
    // «Заменить» — решение человека о браке: позицию как раз и пересматривают,
    // поэтому запирать смену варианта здесь значило бы запретить её смысл.
    for (const status of ["draft", "picked", "replace"] as const) {
      expect(variantSwitchDecision(status), status).toEqual({ kind: "allow" });
    }
  });

  it("ни один запрет не пуст: отказ объясняется словами", () => {
    const statuses = [
      "draft",
      "picked",
      "approved",
      "ordered",
      "delivered",
      "replace",
    ] as const;

    for (const status of statuses) {
      const decision = variantSwitchDecision(status);

      if (decision.kind === "forbid") expect(decision.reason.trim()).toBeTruthy();
      if (decision.kind === "confirm")
        expect(decision.warning.trim()).toBeTruthy();
    }
  });
});

describe("statusAfterVariantSwitch", () => {
  it("согласование снимается: материал стал другим", () => {
    expect(statusAfterVariantSwitch("approved")).toBe("picked");
  });

  it("остальные статусы смена варианта не двигает", () => {
    // Заказанное и доставленное сюда не заходят: их смена варианта запрещена
    // целиком, поэтому перехода из них быть не может, а «оставить как есть» —
    // честный ответ для функции, которая не знает про запрет.
    expect(statusAfterVariantSwitch("draft")).toBe("draft");
    expect(statusAfterVariantSwitch("picked")).toBe("picked");
    expect(statusAfterVariantSwitch("ordered")).toBe("ordered");
    expect(statusAfterVariantSwitch("delivered")).toBe("delivered");
    expect(statusAfterVariantSwitch("replace")).toBe("replace");
  });
});
