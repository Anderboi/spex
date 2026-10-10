import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import PaymentForm, { type PaymentFormValues } from "./payment-form";
import type { PaymentEntry } from "@/lib/spec/payment-types";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";

/**
 * Тесты формы оплаты: вид записи (оплата или возврат).
 *
 * Проверяется поведение формы на её публичном контракте — `onSubmit` со
 * значениями полей. Внутреннее состояние не читается: тест не должен ломаться
 * от переименования переменной или перестановки полей.
 *
 * ── Почему вид записи проверяется здесь ────────────────────────────────────
 *
 * «Возврат — вид платежа, а не знак суммы» (решение O1) держится на том, что
 * пользователь осознанно выбирает вид, а положительная сумма уходит на сервер
 * как есть. Отсюда три обязательства формы: выбор есть при создании, выбор
 * ЗАБЛОКИРОВАН при правке (смена вида — не правка суммы, а другая проводка;
 * сервер это запрещает), и выбранный вид действительно доходит до `onSubmit`.
 * Ни одно из трёх не проверяется тестами ядра: ядро получает уже готовый `kind`.
 */

/** Строка графика для селекта привязки. */
function plan(over: Partial<PaymentPlanEntry> = {}): PaymentPlanEntry {
  return {
    id: "plan-1",
    orgId: "org-1",
    projectId: "project-1",
    specItemId: "item-1",
    title: "Аванс 50 %",
    amount: 5000,
    condition: "Предоплата",
    dueDate: null,
    position: 0,
    authorId: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

/** Существующая запись: используется в кейсах правки. */
function payment(over: Partial<PaymentEntry> = {}): PaymentEntry {
  return {
    id: "payment-1",
    orgId: "org-1",
    projectId: "project-1",
    specItemId: "item-1",
    kind: "payment",
    amount: 4000,
    paidAt: "2026-10-01",
    paymentPlanId: null,
    comment: null,
    authorId: "user-1",
    authorName: "Andy",
    codeSnapshot: null,
    nameSnapshot: null,
    projectTitleSnapshot: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

/** Рендер формы с подставленным `onSubmit`, разрешающимся успехом. */
function setup(over: {
  payment?: PaymentEntry | null;
  plans?: PaymentPlanEntry[];
  /** Стоимость позиции: база для процента. Ноль — процента не предлагаем. */
  itemCost?: number;
  /** Сколько осталось доплатить по позиции. */
  remaining?: number;
  onSubmit?: (values: PaymentFormValues) => Promise<string | null>;
} = {}) {
  const onSubmit = vi.fn<(values: PaymentFormValues) => Promise<string | null>>(
    over.onSubmit ?? (async () => null),
  );

  render(
    <PaymentForm
      open
      payment={over.payment ?? null}
      plans={over.plans ?? [plan()]}
      itemCost={over.itemCost ?? 0}
      remaining={over.remaining ?? 0}
      onClose={() => {}}
      onSubmit={onSubmit}
    />,
  );

  return { onSubmit };
}

/** Селект вида записи. Доступное имя задано явно (`aria-label`) и совпадает с
 * видимой подписью поля — тот же приём, что у селекта «Тип услуги». */
const kindSelect = () =>
  screen.getByRole("combobox", { name: "Вид записи" }) as HTMLSelectElement;

/** Поле суммы: своё доступное имя, потому что плейсхолдер «0» делит с полем
 * процента — по плейсхолдеру запрос стал бы неоднозначным. */
const amountInput = () =>
  screen.getByLabelText("Сумма, ₽") as HTMLInputElement;

/** Поле процента: своё доступное имя, потому что плейсхолдер у него свой. */
const percentInput = () =>
  screen.getByLabelText("Процент от стоимости") as HTMLInputElement;

afterEach(cleanup);

describe("PaymentForm · вид записи при создании", () => {
  it("по умолчанию выбран вид «оплата», а не «возврат»", () => {
    // Создать возврат можно только осознанным выбором: форма, открывшаяся на
    // «Возврате», записала бы возврат по невнимательности, а это движение денег
    // в обратную сторону.
    setup();

    expect(kindSelect().value).toBe("payment");
  });

  it("в списке видов есть ровно оплата и возврат", () => {
    setup();

    const options = [...kindSelect().options].map((option) => option.value);
    expect(options).toEqual(["payment", "refund"]);
  });

  it("вид записи меняется, и подпись кнопки следует за ним", async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.getByRole("button", { name: "Внести оплату" })).toBeDefined();

    await user.selectOptions(kindSelect(), "refund");

    // Кнопка называет то, что произойдёт: «Внести оплату» на форме возврата
    // обещало бы не то действие.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Внести возврат" })).toBeDefined();
    });
  });

  it("выбранный возврат уходит в onSubmit вместе с положительной суммой", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(amountInput(), "2500");
    await user.selectOptions(kindSelect(), "refund");
    await user.click(screen.getByRole("button", { name: "Внести возврат" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // Сумма положительна: вид выражает направление, а знак суммы — нет
    // (решение O1). `kind` доходит до сервера, а не подставляется там.
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      kind: "refund",
      amount: 2500,
    });
  });

  it("оплата уходит в onSubmit видом «payment»", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(amountInput(), "1000");
    await user.click(screen.getByRole("button", { name: "Внести оплату" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ kind: "payment", amount: 1000 });
  });
});

describe("PaymentForm · вид записи при правке", () => {
  it("вид существующей оплаты подставлен в селект", () => {
    setup({ payment: payment({ kind: "refund" }) });

    expect(kindSelect().value).toBe("refund");
  });

  it("вид при правке заблокирован: смена вида — другая проводка, а не правка", () => {
    // Отменить ошибочный возврат и внести верную оплату — правильный путь.
    // Разреши мы менять вид здесь, в журнале появилось бы «изменена оплата», под
    // которой лежит возврат, а ядро такой запрос всё равно отвергает.
    setup({ payment: payment() });

    expect(kindSelect().disabled).toBe(true);
  });

  it("заголовок правки называет вид записи, а не «оплату» по умолчанию", () => {
    // Правка возврата не должна выглядеть как правка оплаты: заголовок берётся
    // из вида записи.
    setup({ payment: payment({ kind: "refund" }) });

    expect(screen.getByRole("heading", { name: "Возврат" })).toBeDefined();
  });
});

describe("PaymentForm · сумма по-прежнему обязательна", () => {
  it("пустая сумма не отправляется и не теряет выбранный вид", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.selectOptions(kindSelect(), "refund");
    await user.click(screen.getByRole("button", { name: "Внести возврат" }));

    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    // Проверка формы не сбрасывает выбор: пользователь исправляет сумму, а не
    // заново выбирает вид записи.
    expect(kindSelect().value).toBe("refund");
  });
});

/**
 * Процент и остаток.
 *
 * Процент — удобство ввода, а не данные: он разово превращается в сумму, и в БД
 * уходит сумма (решение интервью 2026-10-10). Поэтому проверяется именно то, что
 * уходит в `onSubmit`: второго источника правды не заводится.
 *
 * Остаток — контекст текущей позиции: стоимость минус уже оплаченное. Он не
 * часть записи, а справка о том, сколько ещё осталось по позиции.
 */
describe("PaymentForm · процент от стоимости", () => {
  it("ввод процента считает сумму и уходит в onSubmit суммой", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ itemCost: 100000 });

    await user.type(percentInput(), "25");
    await user.click(screen.getByRole("button", { name: "Внести оплату" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount: 25000 });
    // Процента в отправляемых данных нет: он не хранится.
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("percent");
  });

  it("кнопка процента подставляет сумму в поле — видно, что уйдёт", async () => {
    const user = userEvent.setup();
    setup({ itemCost: 100000 });

    await user.click(screen.getByRole("button", { name: "50 %" }));

    expect(amountInput().value).toBe("50000");
  });

  it("процент округляется до копейки", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ itemCost: 33333 });

    await user.type(percentInput(), "10");
    await user.click(screen.getByRole("button", { name: "Внести оплату" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // 10 % от 33 333 — 3333.3, а не 3333.3000000000002.
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount: 3333.3 });
  });

  it("сумма, введённая руками, важнее процента", async () => {
    // Процент только заполняет поле. Если после него поправить сумму, уйдёт
    // сумма: пользователь видел её в поле и подтвердил именно её.
    const user = userEvent.setup();
    const { onSubmit } = setup({ itemCost: 100000 });

    await user.click(screen.getByRole("button", { name: "25 %" }));
    await user.clear(amountInput());
    await user.type(amountInput(), "40000");
    await user.click(screen.getByRole("button", { name: "Внести оплату" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount: 40000 });
  });

  it("без стоимости проценты не предлагаются: считать не от чего", () => {
    setup({ itemCost: 0 });

    expect(screen.queryByRole("button", { name: "25 %" })).toBeNull();
    expect(screen.queryByLabelText("Процент от стоимости")).toBeNull();
  });
});

describe("PaymentForm · сколько осталось доплатить", () => {
  it("показывает остаток по позиции", () => {
    setup({ remaining: 50000 });

    expect(screen.getByText(/Не оплачено/)).toBeDefined();
  });

  it("остаток подставляется в сумму одним нажатием", async () => {
    const user = userEvent.setup();
    setup({ remaining: 50000 });

    await user.click(
      screen.getByRole("button", { name: /Подставить остаток/ }),
    );

    expect(amountInput().value).toBe("50000");
  });

  it("подставленный остаток уходит в onSubmit", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ remaining: 50000 });

    await user.click(
      screen.getByRole("button", { name: /Подставить остаток/ }),
    );
    await user.click(screen.getByRole("button", { name: "Внести оплату" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount: 50000 });
  });

  it("доплачивать нечего — остатка и кнопки нет", () => {
    // Ноль в «осталось доплатить» читался бы как «осталось ноль»: верно, но
    // бесполезно — подставлять нечего и напоминать не о чем.
    setup({ remaining: 0 });

    expect(screen.queryByText(/Не оплачено/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Подставить остаток/ }),
    ).toBeNull();
  });

  it("в правке остаток виден, но не подставляется", () => {
    // Правка меняет уже существующую сумму; кнопка «подставить остаток» здесь
    // подменила бы её целиком, ничего не сообщив о том, что было.
    setup({ payment: payment(), remaining: 50000 });

    expect(screen.getByText(/Не оплачено/)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Подставить остаток/ }),
    ).toBeNull();
  });
});
