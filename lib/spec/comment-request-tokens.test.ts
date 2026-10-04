import { describe, expect, it } from "vitest";

import {
  beginCommentRequest,
  isCommentRequestCurrent,
  type CommentRequestToken,
  type CommentRequestTokens,
} from "./comment-request-tokens";

/**
 * Тесты concurrency-модели мутаций комментария.
 *
 * React-тестов в проекте нет, поэтому «какой ответ актуален» вынесено в чистые
 * функции: сценарии задаются порядком запусков и порядком ответов, а не
 * рендером. Проверяется главное свойство — операция по одному комментарию не
 * может быть погашена операцией по другому.
 */

/** Запуск запроса: возвращает токен и новую карту (как это делает хук). */
function start(
  tokens: CommentRequestTokens,
  commentId: string,
): { token: CommentRequestToken; tokens: CommentRequestTokens } {
  return beginCommentRequest(tokens, commentId);
}

describe("токен на commentId", () => {
  it("первый запрос комментария получает номер 1", () => {
    const { token } = start(new Map(), "cm-a");

    expect(token).toEqual({ commentId: "cm-a", requestId: 1 });
  });

  it("повторный запрос того же комментария получает следующий номер", () => {
    const first = start(new Map(), "cm-a");
    const second = start(first.tokens, "cm-a");

    expect(second.token.requestId).toBe(2);
    expect(second.token.commentId).toBe("cm-a");
  });

  it("у разных комментариев свои независимые нумерации", () => {
    const a = start(new Map(), "cm-a");
    const b = start(a.tokens, "cm-b");

    // Оба — первые запросы своих комментариев: общего счётчика нет.
    expect(a.token.requestId).toBe(1);
    expect(b.token.requestId).toBe(1);
    expect(isCommentRequestCurrent(b.tokens, a.token)).toBe(true);
    expect(isCommentRequestCurrent(b.tokens, b.token)).toBe(true);
  });

  it("запуск не мутирует переданную карту", () => {
    const before: CommentRequestTokens = new Map();
    const { tokens } = start(before, "cm-a");

    expect(before.size).toBe(0);
    expect(tokens.size).toBe(1);
  });
});

describe("разные комментарии: операции не влияют друг на друга", () => {
  it("A стартует, B стартует, B отвечает, A отвечает", () => {
    const a = start(new Map(), "cm-a");
    const b = start(a.tokens, "cm-b");

    // B ответил первым — на актуальность A это не влияет.
    expect(isCommentRequestCurrent(b.tokens, b.token)).toBe(true);
    // A ответил позже: его токен по-прежнему текущий для cm-a.
    expect(isCommentRequestCurrent(b.tokens, a.token)).toBe(true);
  });

  it("A стартует, B стартует, A отвечает, B отвечает", () => {
    const a = start(new Map(), "cm-a");
    const b = start(a.tokens, "cm-b");

    expect(isCommentRequestCurrent(b.tokens, a.token)).toBe(true);
    expect(isCommentRequestCurrent(b.tokens, b.token)).toBe(true);
  });

  it("ответ по неизвестному комментарию не актуален", () => {
    const { tokens } = start(new Map(), "cm-a");

    expect(
      isCommentRequestCurrent(tokens, { commentId: "cm-b", requestId: 1 }),
    ).toBe(false);
  });
});

describe("один комментарий: новая операция инвалидирует предыдущую", () => {
  it("старый ответ не затрагивает новую операцию", () => {
    const first = start(new Map(), "cm-a");
    const second = start(first.tokens, "cm-a");

    // Ответ на первый запрос пришёл после запуска второго.
    expect(isCommentRequestCurrent(second.tokens, first.token)).toBe(false);
    // Ответ на второй — актуален.
    expect(isCommentRequestCurrent(second.tokens, second.token)).toBe(true);
  });

  it("устаревшая ошибка первого запроса не применяется", () => {
    const first = start(new Map(), "cm-a");
    const second = start(first.tokens, "cm-a");

    // Ошибка — такой же ответ: применяется он или нет, решает тот же токен.
    const firstErrorApplies = isCommentRequestCurrent(second.tokens, first.token);
    expect(firstErrorApplies).toBe(false);
    // А ошибка актуального запроса применяется.
    expect(isCommentRequestCurrent(second.tokens, second.token)).toBe(true);
  });

  it("третий запрос инвалидирует и первый, и второй", () => {
    const first = start(new Map(), "cm-a");
    const second = start(first.tokens, "cm-a");
    const third = start(second.tokens, "cm-a");

    expect(isCommentRequestCurrent(third.tokens, first.token)).toBe(false);
    expect(isCommentRequestCurrent(third.tokens, second.token)).toBe(false);
    expect(isCommentRequestCurrent(third.tokens, third.token)).toBe(true);
  });
});

describe("комбинированный сценарий из требования", () => {
  it("A1 игнорируется, B1 применяется, A2 применяется", () => {
    // A request 1
    const a1 = start(new Map(), "cm-a");
    // B request 1
    const b1 = start(a1.tokens, "cm-b");
    // A request 2 — инвалидирует только A1
    const a2 = start(b1.tokens, "cm-a");

    // response A1
    expect(isCommentRequestCurrent(a2.tokens, a1.token)).toBe(false);
    // response B1
    expect(isCommentRequestCurrent(a2.tokens, b1.token)).toBe(true);
    // response A2
    expect(isCommentRequestCurrent(a2.tokens, a2.token)).toBe(true);
  });

  it("независимость сохраняется при любом порядке ответов", () => {
    const a1 = start(new Map(), "cm-a");
    const b1 = start(a1.tokens, "cm-b");
    const a2 = start(b1.tokens, "cm-a");

    const tokens = a2.tokens;
    const applies = (token: CommentRequestToken) =>
      isCommentRequestCurrent(tokens, token);

    // Все шесть порядков ответов дают один и тот же вердикт по каждому запросу.
    const orders: CommentRequestToken[][] = [
      [a1.token, b1.token, a2.token],
      [a1.token, a2.token, b1.token],
      [b1.token, a1.token, a2.token],
      [b1.token, a2.token, a1.token],
      [a2.token, a1.token, b1.token],
      [a2.token, b1.token, a1.token],
    ];

    for (const order of orders) {
      const verdicts = new Map(
        order.map((token) => [
          `${token.commentId}#${token.requestId}`,
          applies(token),
        ]),
      );
      expect(verdicts.get("cm-a#1"), JSON.stringify(order)).toBe(false);
      expect(verdicts.get("cm-b#1"), JSON.stringify(order)).toBe(true);
      expect(verdicts.get("cm-a#2"), JSON.stringify(order)).toBe(true);
    }
  });

  it("две операции по разным комментариям завершаются обе", () => {
    // Правка A и удаление B: именно этот случай ломался общим счётчиком —
    // ответ A признавался устаревшим и не снимал `pending`.
    const edit = start(new Map(), "cm-a");
    const remove = start(edit.tokens, "cm-b");

    const results = [
      { token: remove.token, current: isCommentRequestCurrent(remove.tokens, remove.token) },
      { token: edit.token, current: isCommentRequestCurrent(remove.tokens, edit.token) },
    ];

    // Оба ответа актуальны → оба снимут pending и применят свой результат.
    expect(results.map((result) => result.current)).toEqual([true, true]);
  });
});
