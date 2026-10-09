import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProcureModal } from "./procure-modal";
import type { SpecBuilderContext } from "@/hooks/use-spec-builder";
import type { ProjectPaymentsSummary } from "@/actions/project-payments";

/**
 * Тесты строки оплат в модалке закупки: цифры доходят до экрана.
 *
 * ── Что здесь проверяется, а что нет ───────────────────────────────────────
 *
 * Арифметика живёт в `lib/spec/payment-schedule` и покрыта там; выбор позиций
 * области — в `actions/project-payments`, и он покрыт там же. Здесь проверяется
 * ровно последняя миля: что модалка догружает цифры при открытии, показывает
 * план · оплачено · остаток · переплату и НЕ складывает молча оплаты мимо
 * области. Пересчитывать формулу в этом тесте значило бы подтверждать сам себя.
 *
 * Действие подменяется модульным моком: настоящее требует сессии и БД.
 */

const summaryMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/project-payments", () => ({
  getProjectPaymentsSummary: summaryMock,
}));

import type { PaymentScheduleSummary } from "@/lib/spec/payment-schedule";

/** Сводка с заданными числами; остальное — нули. */
function schedule(
  over: Partial<PaymentScheduleSummary> = {},
): PaymentScheduleSummary {
  return {
    planned: 0,
    paid: 0,
    paidGross: 0,
    refunded: 0,
    remaining: 0,
    overpaid: 0,
    unplanned: 0,
    refundsExceedPayments: false,
    hasPlan: false,
    ...over,
  };
}

/** Ответ действия с заданной областью воронки. */
function response(
  scope: Partial<PaymentScheduleSummary> = {},
  over: Partial<ProjectPaymentsSummary> = {},
): { success: true; data: ProjectPaymentsSummary } {
  return {
    success: true,
    data: { scope: schedule(scope), outOfScopeCount: 0, outOfScopeNet: 0, ...over },
  };
}

/**
 * Минимальный контекст конструктора: модалка читает из него только `stats`,
 * `orgSlug`, `projectId` и обработчики навигации. Остальное в этом тесте не
 * участвует, поэтому не выдумывается.
 */
function context(): SpecBuilderContext {
  const bucket = () => ({ items: [], count: 0, sum: 0 });

  return {
    orgSlug: "org-1",
    projectId: "project-1",
    stats: {
      scopeSum: 100000,
      scopeCount: 2,
      scopeSumStr: "100 000",
      deliveredCount: 1,
      deliveredPct: 50,
      procurement: {
        approved: bucket(),
        ordered: bucket(),
        delivered: bucket(),
      },
      picking: [],
      pickingCount: 0,
      pickingSum: 0,
      replace: bucket(),
    },
    openDetail: () => {},
    filters: { setStatusFilter: () => {} },
  } as unknown as SpecBuilderContext;
}

function setup() {
  render(<ProcureModal ctx={context()} onClose={() => {}} />);
}

/** Строка оплат: карточка, по которой тест находит цифры. */
const paymentsCard = () => screen.getByTestId("procure-payments");

/**
 * Любые пробелы — в обычный.
 *
 * `fmt` печатает `numeric` через `toLocaleString("ru-RU")`, то есть разделяет
 * разряды НЕРАЗРЫВНЫМ пробелом, и перед «₽» стоит такой же. Сравнивать такие
 * строки с собранными в тесте литералами нельзя: снаружи они выглядят
 * одинаково, а побайтово различаются. Нормализация убирает предмет спора —
 * проверяется «видно ли эту сумму», а не какой именно пробел её разделяет.
 */
const spaces = (value: string) => value.replace(/\s/g, " ");

/** Текст карточки одной строкой, с нормализованными пробелами. */
const cardText = () => spaces(paymentsCard().textContent ?? "");

/**
 * Сумма как её печатает `fmt`, с пробелами, приведёнными к обычным.
 *
 * Сравнивать иначе нельзя: `fmt` разделяет разряды неразрывным пробелом, а
 * ожидание, собранное в тесте литералом, содержит обычный — снаружи строки
 * выглядят одинаково, побайтово различаются.
 */
const money = (value: number) => spaces(Math.abs(value).toLocaleString("ru-RU"));

/**
 * Сумма со знаком — для сальдо, которое может быть отрицательным.
 *
 * Отдельно от `money`, потому что `money` снимает знак: для плана, оплаченного и
 * остатка это верно (они неотрицательны по построению), а для сальдо мимо
 * области — нет, и именно знак там проверяется.
 */
const signedMoney = (value: number) =>
  spaces(value.toLocaleString("ru-RU"));

/** Карточка показывает эту сумму. */
const showsMoney = (value: number) => cardText().includes(money(value));

beforeEach(() => {
  summaryMock.mockReset();
  summaryMock.mockResolvedValue(
    response({ planned: 150000, paid: 40000, remaining: 110000 }),
  );
});

afterEach(cleanup);

describe("ProcureModal · строка оплат", () => {
  it("догружает цифры при открытии", async () => {
    setup();

    // Модалка монтируется на каждое открытие, поэтому запрос идёт из эффекта —
    // это и есть «цифры всегда свежие, синхронизировать нечего».
    await waitFor(() => {
      expect(summaryMock).toHaveBeenCalledWith("org-1", "project-1");
    });
  });

  it("показывает план, оплачено, остаток и переплату", async () => {
    summaryMock.mockResolvedValue(
      response({
        planned: 150000,
        paid: 160000,
        remaining: 0,
        overpaid: 10000,
      }),
    );

    setup();

    await waitFor(() => {
      expect(showsMoney(160000)).toBe(true);
    });

    expect(showsMoney(150000)).toBe(true);
    expect(showsMoney(10000)).toBe(true);
    // Подписи лежат в одном `span` с суммой, поэтому «ровно этот текст» не
    // находится ни у одного элемента: проверяется текст карточки целиком.
    expect(cardText()).toContain("переплата");
  });

  it("показывает остаток, когда оплачено меньше плана", async () => {
    setup();

    await waitFor(() => {
      expect(showsMoney(110000)).toBe(true);
    });

    expect(cardText()).toContain("остаток");
    // Переплаты нет — подписи тоже быть не должно: ноль в ней читался бы как
    // «переплатили ноль».
    expect(cardText()).not.toContain("переплата");
  });

  it("оплаты мимо области воронки отмечены отдельно, а не сложены в итог", async () => {
    summaryMock.mockResolvedValue(
      response(
        { planned: 10000, paid: 4000, remaining: 6000 },
        { outOfScopeCount: 2, outOfScopeNet: 3500 },
      ),
    );

    setup();

    await waitFor(() => {
      expect(cardText()).toContain("Мимо области воронки");
    });

    // Пометка называет и количество позиций, и сумму: пользователь должен
    // понять, что эти деньги не входят в строку выше.
    expect(cardText()).toContain("2 позиции");
    expect(showsMoney(3500)).toBe(true);
  });

  it("отрицательное сальдо мимо области показывается со знаком", async () => {
    // Возвратов вне воронки больше, чем оплат: сальдо отрицательное. Знак
    // обязан дойти до экрана — «с графиком или оплатами 3 500 ₽» там, где на
    // самом деле вернули 3 500 ₽, читается как противоположное утверждение.
    summaryMock.mockResolvedValue(
      response(
        { planned: 10000, paid: 4000, remaining: 6000 },
        { outOfScopeCount: 1, outOfScopeNet: -3500 },
      ),
    );

    setup();

    await waitFor(() => {
      expect(cardText()).toContain("Мимо области воронки");
    });

    expect(cardText()).toContain(signedMoney(-3500));
  });

  it("пометки нет, когда все оплаты внутри области", async () => {
    setup();

    await waitFor(() => {
      expect(cardText()).toContain("Оплачено по позициям закупки");
    });

    expect(cardText()).not.toContain("Мимо области воронки");
  });

  it("пустой график и отсутствие оплат — нули, а не прочерки", async () => {
    // Требование тикета: «поведение при пустом графике и при отсутствии оплат».
    // Ноль — это ответ («оплат нет»), и он обязан быть показан.
    summaryMock.mockResolvedValue(response());

    setup();

    await waitFor(() => {
      expect(cardText()).toContain("Оплачено по позициям закупки");
    });

    expect(showsMoney(0)).toBe(true);
    expect(cardText()).not.toContain("Загружаем");
  });

  it("ошибка чтения не прячется и не показывается нулями", async () => {
    // Нули выглядели бы как «оплат нет». Отказ обязан быть виден, иначе
    // пользователь примет недоступность данных за отсутствие денег.
    summaryMock.mockResolvedValue({
      success: false,
      error: "Не удалось получить оплаты проекта",
    });

    setup();

    await waitFor(() => {
      expect(
        screen.getByText("Не удалось получить оплаты проекта"),
      ).toBeDefined();
    });
  });

  it("пока загрузка — видно «Загружаем», а не нули", async () => {
    // Пока ответ не пришёл, нулей показывать нельзя: они читались бы как
    // «оплат нет» — то есть как ответ, которым ещё не являются.
    //
    // Промис НЕ разрешается намеренно. С разрешённым промисом это состояние
    // неуловимо: `waitFor` опрашивает DOM, пока условие не выполнится, и
    // «Загружаем» исчезает раньше, чем до него дойдёт проверка. Гонку убирает
    // вечно ожидающий ответ — тогда состояние загрузки детерминировано.
    summaryMock.mockReturnValue(new Promise(() => {}));

    setup();

    // Синхронная проверка после рендера: ответа ещё нет по построению.
    expect(cardText()).toContain("Загружаем");
    expect(showsMoney(123456)).toBe(false);
  });

  it("в модалке нет ни ввода, ни правки платежей", async () => {
    // Решение Q5: ведение — во вкладке карточки. Здесь только чтение.
    setup();

    await waitFor(() => {
      expect(cardText()).toContain("Оплачено по позициям закупки");
    });

    const labels = [
      /внести/i,
      /добавить платёж/i,
      /изменить/i,
      /отменить/i,
      /сохранить/i,
    ];
    for (const label of labels) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
