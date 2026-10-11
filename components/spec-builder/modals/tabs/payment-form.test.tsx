import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import PaymentForm, {
  type PaymentEntryLike,
  type PaymentFormResult,
  type PaymentFormUpload,
} from "./payment-form";
import type { PaymentFormValues, PaymentPlanFormValues } from "@/lib/spec/payment-form-types";
import { todayIso } from "@/lib/spec/payment-date";
import type { PaymentPlanEntry } from "@/lib/spec/payment-plan-types";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Тесты формы записи о деньгах: переключатель «Запланировано / Оплачено сейчас»,
 * отметка «Оплачено» по строке графика, закреплённый возврат и документы.
 *
 * ── Почему проверяется именно это ──────────────────────────────────────────
 *
 * «Возврат — вид платежа, а не знак суммы» держится на том, что пользователь
 * осознанно выбирает вид, а положительная сумма уходит на сервер как есть.
 * «Отметка „Оплачено“ переносит сумму как есть» (ADR 0006) держится на том, что
 * форма отдаёт сумму ПЛАНА, а не пересчитывает её, и подставляет дату из срока.
 * Ни то, ни другое ядро не проверит: оно получает уже готовые значения.
 *
 * Проверяется публичный контракт — `onSubmit` с тем, что ввёл пользователь.
 * Внутреннее состояние не читается: тест не должен ломаться от переименования
 * переменной или перестановки полей.
 */

/** Строка графика для привязки факта. */
function plan(over: Partial<PaymentPlanEntry> = {}): PaymentPlanEntry {
  return {
    id: "plan-1",
    orgId: "org-1",
    projectId: "project-1",
    specItemId: "item-1",
    title: "Аванс 50 %",
    amount: 5000,
    condition: "Предоплата",
    dueDate: "2026-11-01",
    position: 0,
    authorId: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

/** Существующий факт: используется в кейсах правки. */
function payment(over: Partial<PaymentEntryLike> = {}): PaymentEntryLike {
  return {
    id: "payment-1",
    kind: "payment",
    amount: 4000,
    paidAt: "2026-10-01",
    paymentPlanId: null,
    comment: null,
    ...over,
  };
}

/** Приложенный документ: показывается и (по праву) удаляется формой. */
function attachedFile(over: Partial<SpecItemFileEntry> = {}): SpecItemFileEntry {
  return {
    id: "file-1",
    fileName: "Счёт №1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    category: "invoice",
    uploadedBy: "user-1",
    uploadedByName: "Анна",
    createdAt: "2026-10-01T10:00:00.000Z",
    paymentId: "payment-1",
    payment: null,
    paymentPlanId: null,
    paymentPlan: null,
    ...over,
  };
}

/** Рендер формы с подставленным `onSubmit`, разрешающимся успехом. */
function setup(over: {
  payment?: PaymentEntryLike | null;
  plan?: PaymentPlanEntry | null;
  plans?: PaymentPlanEntry[];
  markPaid?: boolean;
  fixedKind?: "payment" | "refund" | null;
  /** Полная стоимость позиции — база для доли и остатка. */
  itemCost?: number;
  /** Сколько осталось доплатить по позиции. */
  remaining?: number;
  attached?: SpecItemFileEntry[];
  deletable?: boolean;
  onDeleteAttachment?: (file: SpecItemFileEntry) => Promise<string | null>;
  onSubmit?: (input: {
    payment: PaymentFormValues | null;
    plan: PaymentPlanFormValues | null;
    uploads: PaymentFormUpload[];
  }) => Promise<PaymentFormResult>;
} = {}) {
  const onSubmit = vi.fn(over.onSubmit ?? (async () => ({})));

  render(
    <PaymentForm
      open
      payment={over.payment ?? null}
      plan={over.plan ?? null}
      markPaid={over.markPaid ?? false}
      fixedKind={over.fixedKind ?? null}
      itemCost={over.itemCost ?? 0}
      remaining={over.remaining ?? 0}
      attached={over.attached ?? []}
      deletable={over.deletable ?? false}
      onDeleteAttachment={over.onDeleteAttachment}
      onClose={() => {}}
      onSubmit={onSubmit}
    />,
  );

  return { onSubmit };
}

/** Поле суммы: своё доступное имя, потому что плейсхолдер «0» слишком общий. */
const amountInput = () =>
  screen.getByLabelText("Сумма, ₽") as HTMLInputElement;

const dateInput = (name: "Дата оплаты" | "Срок оплаты") =>
  screen.getByLabelText(name) as HTMLInputElement;

/** Поле доли: своё доступное имя, потому что плейсхолдер у него свой. */
const percentInput = () =>
  screen.getByLabelText("Процент от стоимости") as HTMLInputElement;

/** Выбор файлов: `fireEvent.change` с подставленным `files` — как в списке. */
function pickDocuments(input: HTMLElement, chosen: File[]) {
  Object.defineProperty(input, "files", { value: chosen, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const picker = () =>
  screen.getByLabelText("Выбрать документы к оплате") as HTMLInputElement;

/**
 * Что форма отдала наверх.
 *
 * Отдельная функция, а не `onSubmit.mock.calls[0][0]` в каждом тесте:
 * `calls[0]` в типах vitest необязателен (вызова могло и не быть), и без этой
 * обёртки каждый тест обрастал бы `!`, объясняющим одно и то же.
 */
function submitted(
  mock: { mock: { calls: unknown[][] } },
): {
  mode: "planned" | "paid";
  payment: PaymentFormValues | null;
  plan: PaymentPlanFormValues | null;
  uploads: PaymentFormUpload[];
} {
  return mock.mock.calls[0][0] as never;
}

afterEach(cleanup);

/* ------------------------------------------------------------------ */
/*  Что за платёж: карточка обязательства                              */
/* ------------------------------------------------------------------ */

describe("PaymentForm · внесение платежа заводит карточку", () => {
  it("спрашивает «Аванс» или «Оплата», и подставляет ответ в название", async () => {
    const user = userEvent.setup();
    setup();

    const group = screen.getByRole("group", { name: "Что за платёж" });
    expect(
      within(group).getByRole("button", { name: "Оплата" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe(
      "Оплата",
    );

    await user.click(within(group).getByRole("button", { name: "Аванс" }));

    // «Аванс» — не вид записи, а название платежа: отдельного признака у него
    // нет, он отличается суммой и сроком (решения Q10, Q11).
    await waitFor(() => {
      expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe(
        "Аванс",
      );
    });
  });

  it("карточка заводится обязательством: полей факта в форме нет", () => {
    setup();

    // Ни даты оплаты, ни комментария: оплата отмечается кнопкой на самой
    // карточке, и вносить её здесь значило бы иметь два способа сделать одно.
    expect(screen.getByLabelText("Название")).toBeDefined();
    expect(screen.getByLabelText("Срок оплаты")).toBeDefined();
    expect(screen.getByLabelText("Условие оплаты")).toBeDefined();
    expect(screen.queryByLabelText("Дата оплаты")).toBeNull();
    expect(screen.queryByLabelText("Комментарий")).toBeNull();
  });

  it("карточка уходит в onSubmit планом, а факт не отправляется", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(amountInput(), "3000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const input = submitted(onSubmit);
    // Название подставил выбор операции: по умолчанию это «Оплата».
    expect(input.plan).toMatchObject({ title: "Оплата", amount: 3000 });
    // Слать оба значило бы записать дважды.
    expect(input.payment).toBeNull();
  });

  it("название правится и переживает смену выбора", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    const title = screen.getByLabelText("Название");
    await user.clear(title);
    await user.type(title, "Поставка вторая");
    await user.click(
      within(screen.getByRole("group", { name: "Что за платёж" })).getByRole(
        "button",
        { name: "Аванс" },
      ),
    );

    // Выбор не затирает то, что человек уже написал.
    expect((title as HTMLInputElement).value).toBe("Поставка вторая");

    await user.type(amountInput(), "3000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted(onSubmit).plan).toMatchObject({ title: "Поставка вторая" });
  });

  it("пустое название не отправляется", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.clear(screen.getByLabelText("Название"));
    await user.type(amountInput(), "3000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("название");
  });

  it("у заведённой карточки выбор не показывается: её название уже записано", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({
      plan: plan({ title: "Аванс", amount: 7000, dueDate: "2026-12-01" }),
    });

    expect(screen.queryByRole("group", { name: "Что за платёж" })).toBeNull();
    // Вида записи у карточки нет вовсе: плановая таблица знает только «мы должны».
    expect(screen.queryByRole("combobox", { name: "Вид записи" })).toBeNull();
    expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe(
      "Аванс",
    );

    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted(onSubmit).plan).toMatchObject({
      title: "Аванс",
      amount: 7000,
      dueDate: "2026-12-01",
    });
    expect(submitted(onSubmit).payment).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Отметка «Оплачено»                                                 */
/* ------------------------------------------------------------------ */

describe("PaymentForm · отметка «Оплачено» у строки графика", () => {
  it("сумма плана переносится как есть, без пересчёта и подтверждения", () => {
    setup({ plan: plan({ amount: 12345.67 }), markPaid: true });

    expect(amountInput().value).toBe("12345.67");
  });

  it("сумму перенесённого обязательства переписать нечем", async () => {
    /*
      ADR 0006: «сумма переносится как есть». Свободное поле сделало бы это
      обещанием формы, а не свойством отметки: остаток считается от стоимости
      позиции, а не от обязательства, и подстановка молча записала бы другую
      сумму.
    */
    const user = userEvent.setup();
    setup({ plan: plan({ amount: 12345.67 }), markPaid: true });

    expect(amountInput().disabled).toBe(true);
    expect(
      screen.queryByRole("button", { name: /Подставить остаток/ }),
    ).toBeNull();

    // Попытка набрать своё суммы не меняет.
    await user.type(amountInput(), "777");
    expect(amountInput().value).toBe("12345.67");
  });

  it("дата оплаты по умолчанию — срок плана, а не сегодня", () => {
    // ADR 0006: деньги обещаны к сроку и в большинстве случаев приходят в него.
    setup({ plan: plan({ dueDate: "2026-11-01" }), markPaid: true });

    expect(dateInput("Дата оплаты").value).toBe("2026-11-01");
  });

  it("план без срока даёт сегодняшнюю дату, а не пустое поле", () => {
    setup({ plan: plan({ dueDate: null }), markPaid: true });

    expect(dateInput("Дата оплаты").value).toBe(todayIso());
  });

  it("дату оплаты можно выбрать вручную: оплатили в другой день", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ plan: plan({ dueDate: "2026-11-01" }), markPaid: true });

    const input = dateInput("Дата оплаты");
    await user.clear(input);
    await user.type(input, "2026-11-07");
    await user.click(screen.getByRole("button", { name: "Отметить оплаченным" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted(onSubmit).payment).toMatchObject({
      paidAt: "2026-11-07",
      amount: 5000,
      paymentPlanId: "plan-1",
    });
  });

  it("срок плана показан справкой и не подменяется датой оплаты", () => {
    // Срок — данные строки графика: править его из карточки факта значило бы
    // править график из оплаты.
    setup({ plan: plan({ dueDate: "2026-11-01" }), markPaid: true });

    expect(screen.getByText(/Срок платежа/)).toBeDefined();
    expect(screen.getByText(/1 ноября 2026/)).toBeDefined();
    // Селекта строки графика нет: привязка задана той строкой, из которой
    // открыли форму.
    expect(screen.queryByLabelText("Строка графика")).toBeNull();
  });

  it("«Оплачено» по строке графика план в onSubmit не отправляет", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ plan: plan(), markPaid: true });

    await user.click(screen.getByRole("button", { name: "Отметить оплаченным" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted(onSubmit).plan).toBeNull();
    expect(submitted(onSubmit).payment?.paymentPlanId).toBe("plan-1");
  });
});

/* ------------------------------------------------------------------ */
/*  Возврат                                                            */
/* ------------------------------------------------------------------ */

describe("PaymentForm · возврат отдельным входом", () => {
  it("с закреплённым видом селекта вида нет, а вид уходит возвратом", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ fixedKind: "refund" });

    // Выбирать нечего: вход уже назвал вид записи.
    expect(screen.queryByRole("combobox", { name: "Вид записи" })).toBeNull();
    // И уйти из возврата в план нечем: плановая таблица видов не знает
    // (решение Q33), поэтому переключателя «Запланировано» здесь нет.
    expect(screen.queryByRole("button", { name: "Запланировано" })).toBeNull();

    await user.type(amountInput(), "2500");
    await user.click(screen.getByRole("button", { name: "Внести возврат" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted(onSubmit).payment).toMatchObject({
      kind: "refund",
      amount: 2500,
    });
    expect(submitted(onSubmit).plan).toBeNull();
  });

  it("у правки вид не спрашивается: смена вида — другая проводка", () => {
    /*
      Вид существующей записи не меняется: «оплата» и «возврат» — разные
      документы, и правка одного в другой оставила бы в журнале «изменена
      оплата», под которой лежит возврат. Поэтому у правки селекта нет вовсе —
      вид называет заголовок, а правильный путь описан в тексте отказа ядра:
      отменить ошибочную запись и внести верную.
    */
    setup({ payment: payment({ kind: "refund" }) });

    expect(screen.queryByRole("combobox", { name: "Вид записи" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Возврат" })).toBeDefined();
  });

  it("заголовок правки называет вид записи, а не «оплату» по умолчанию", () => {
    setup({ payment: payment({ kind: "refund" }) });

    expect(screen.getByRole("heading", { name: "Возврат" })).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Сумма                                                              */
/* ------------------------------------------------------------------ */

describe("PaymentForm · сумма по-прежнему обязательна", () => {
  it("пустая сумма не отправляется и не теряет выбранный вид", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ fixedKind: "refund" });

    await user.click(screen.getByRole("button", { name: "Внести возврат" }));

    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
  });

  it("процента у отметки «Оплачено» нет: сумма переносится как есть", () => {
    /*
      Он подменил бы перенесённую сумму: процент считается от стоимости позиции,
      а не от обязательства. Сумма отметки — свойство ADR 0006, а не предмет
      выбора.
    */
    setup({
      plan: plan({ amount: 10000 }),
      markPaid: true,
      itemCost: 40000,
      remaining: 30000,
    });

    expect(screen.queryByLabelText("Процент от стоимости")).toBeNull();
    expect(screen.queryByRole("button", { name: "25 %" })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Стоимость позиции, доля и остаток                                  */
/* ------------------------------------------------------------------ */

describe("PaymentForm · стоимость позиции, доля и остаток", () => {
  it("показывает полную стоимость позиции", () => {
    // Долю выбирают от целого: «25 %» без базы — число, про которое нечего
    // сказать.
    setup({ itemCost: 40000 });

    const cost = screen.getByTestId("form-item-cost");
    expect((cost.textContent ?? "").replace(/\s/g, " ")).toContain(
      "Стоимость позиции",
    );
    expect((cost.textContent ?? "").replace(/\s/g, " ")).toContain("40 000 ₽");
  });

  it("позиция без цены — стоимости в диалоге нет", () => {
    setup({ itemCost: 0 });

    expect(screen.queryByTestId("form-item-cost")).toBeNull();
  });

  it("ввод доли считает сумму и уходит в onSubmit суммой", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ itemCost: 100000 });

    await user.type(percentInput(), "25");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // Доля — способ ВВОДА: в запись уходит посчитанная сумма, а не процент.
    expect(submitted(onSubmit).plan).toMatchObject({ amount: 25000 });
    expect(submitted(onSubmit).plan).not.toHaveProperty("percent");
  });

  it("кнопка доли подставляет сумму в поле — видно, что уйдёт", async () => {
    const user = userEvent.setup();
    setup({ itemCost: 100000 });

    await user.click(screen.getByRole("button", { name: "50 %" }));

    expect(amountInput().value).toBe("50000");
  });

  it("доля округляется до копейки", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ itemCost: 33333 });

    await user.type(percentInput(), "10");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // 10 % от 33 333 — 3333.3, а не 3333.3000000000002.
    expect(submitted(onSubmit).plan).toMatchObject({ amount: 3333.3 });
  });

  it("сумма, введённая руками, важнее доли", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ itemCost: 100000 });

    await user.click(screen.getByRole("button", { name: "25 %" }));
    await user.clear(amountInput());
    await user.type(amountInput(), "40000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted(onSubmit).plan).toMatchObject({ amount: 40000 });
  });

  it("без стоимости доли не предлагаются: считать не от чего", () => {
    setup({ itemCost: 0 });

    expect(screen.queryByLabelText("Процент от стоимости")).toBeNull();
    expect(screen.queryByRole("button", { name: "25 %" })).toBeNull();
  });

  it("показывает остаток по позиции", () => {
    setup({ itemCost: 100000, remaining: 50000 });

    expect(screen.getByText(/Не оплачено/)).toBeDefined();
  });

  it("остаток подставляется в сумму одним нажатием", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ itemCost: 100000, remaining: 50000 });

    await user.click(screen.getByRole("button", { name: /Подставить остаток/ }));
    expect(amountInput().value).toBe("50000");

    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    // Уходит сумма, а не ссылка на остаток: записанное число от цены позиции не
    // зависит (ADR 0003).
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted(onSubmit).plan).toMatchObject({ amount: 50000 });
  });

  it("доплачивать нечего — остатка и кнопки нет", () => {
    setup({ itemCost: 100000, remaining: 0 });

    expect(screen.queryByText(/Не оплачено/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Подставить остаток/ }),
    ).toBeNull();
  });

  it("в правке остаток виден, но не подставляется", () => {
    // Кнопка подменила бы уже записанную сумму целиком, ничего не сказав о том,
    // что было.
    setup({
      plan: plan({ title: "Аванс", amount: 7000 }),
      itemCost: 100000,
      remaining: 50000,
    });

    expect(screen.getByText(/Не оплачено/)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Подставить остаток/ }),
    ).toBeNull();
  });
  it("стоимость позиции и остаток видны и в отметке «Оплачено»", () => {
    /*
      Справки о позиции полезны и там: по ним видно, какую долю составляет
      перенесённая сумма. А вот подставить остаток нечем — сумма отметки
      переносится из обязательства как есть (ADR 0006), а остаток считается от
      стоимости позиции, то есть это другая величина.
    */
    setup({
      plan: plan({ amount: 10000 }),
      markPaid: true,
      itemCost: 40000,
      remaining: 30000,
    });

    const text = (screen.getByTestId("form-item-cost").textContent ?? "").replace(
      /\s/g,
      " ",
    );
    expect(text).toContain("40 000 ₽");
    expect(screen.getByText(/Не оплачено/)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Подставить остаток/ }),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Документы                                                          */
/* ------------------------------------------------------------------ */

describe("PaymentForm · документы к оплате", () => {
  it("выбранный документ получает роль по умолчанию из списка ролей, а не догадку формата", async () => {
    /*
      Догадка сервера отвечает на вопрос «что это за файл» и для PDF говорит
      «документ» — значения, которого в списке РОЛЕЙ нет. Селект показался бы
      пустым, а нетронутый уходил бы на сервер как «документ»: роль терялась бы
      молча, ровно то, от чего ADR 0005 и защищает.
    */
    const user = userEvent.setup();
    const { onSubmit } = setup();

    pickDocuments(picker(), [
      new File(["чек"], "Скан.pdf", { type: "application/pdf" }),
    ]);

    const roleSelect = screen.getByRole("combobox", {
      name: /Роль документа/,
    }) as HTMLSelectElement;
    expect([...roleSelect.options].map((option) => option.value)).toEqual([
      "invoice",
      "receipt",
    ]);
    // Выбранное значение обязано существовать среди вариантов.
    expect([...roleSelect.options].map((option) => option.value)).toContain(
      roleSelect.value,
    );

    await user.type(amountInput(), "1000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const uploads = submitted(onSubmit).uploads;
    expect(uploads).toHaveLength(1);
    expect(uploads[0].category).not.toBe("document");
  });

  it("роль документа перебивается селектом у каждого файла отдельно", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    pickDocuments(picker(), [
      new File(["счёт"], "Счёт №7.pdf", { type: "application/pdf" }),
      new File(["чек"], "Чек №7.pdf", { type: "application/pdf" }),
    ]);

    const [first, second] = screen.getAllByRole("combobox", {
      name: /Роль документа/,
    }) as HTMLSelectElement[];
    await user.selectOptions(first, "invoice");
    await user.selectOptions(second, "receipt");
    await user.type(amountInput(), "1000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // У основания и подтверждения роли разные, и один ответ на пачку потерял бы
    // одну из них (ADR 0005).
    const uploads = submitted(onSubmit).uploads;
    expect(uploads.map((upload) => upload.category)).toEqual([
      "invoice",
      "receipt",
    ]);
  });

  it("файл убирается из очереди до отправки", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    pickDocuments(picker(), [
      new File(["чек"], "Чек.pdf", { type: "application/pdf" }),
    ]);
    await user.click(screen.getByRole("button", { name: /Убрать «Чек.pdf»/ }));

    await user.type(amountInput(), "1000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submitted(onSubmit).uploads).toEqual([]);
  });

  it("слишком большой файл не берётся в очередь", async () => {
    setup();

    const big = new File(["x"], "Огромный.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 30 * 1024 * 1024 });
    pickDocuments(picker(), [big]);

    expect(screen.getByRole("alert").textContent).toContain("больше");
    expect(screen.queryByRole("combobox", { name: /Роль документа/ })).toBeNull();
  });

  it("приложенные документы видны с возможностью удалить", async () => {
    const user = userEvent.setup();
    const onDeleteAttachment = vi.fn(async () => null);
    setup({
      payment: payment(),
      attached: [attachedFile()],
      deletable: true,
      onDeleteAttachment,
    });

    expect(screen.getByText("Счёт №1.pdf")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Удалить «Счёт №1.pdf»/ }));

    await waitFor(() => expect(onDeleteAttachment).toHaveBeenCalledTimes(1));
    // Строка исчезает только после успеха сервера.
    await waitFor(() => expect(screen.queryByText("Счёт №1.pdf")).toBeNull());
  });

  it("отказ удаления оставляет документ на месте и показывает текст", async () => {
    const user = userEvent.setup();
    setup({
      payment: payment(),
      attached: [attachedFile()],
      deletable: true,
      onDeleteAttachment: async () => "Не удалось удалить файл",
    });

    await user.click(screen.getByRole("button", { name: /Удалить «Счёт №1.pdf»/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Не удалось удалить файл",
      );
    });
    expect(screen.getByText("Счёт №1.pdf")).toBeDefined();
  });

  it("удалять документы вправе не каждый: без права кнопки нет", () => {
    setup({ payment: payment(), attached: [attachedFile()], deletable: false });

    expect(screen.getByText("Счёт №1.pdf")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Удалить «/ })).toBeNull();
  });

  it("предупреждение об отказе загрузки показывается, а форма не выдаёт его за ошибку", async () => {
    // Решение тикета: оплата остаётся, предупреждение показывается, файл можно
    // приложить позже. Поэтому у предупреждения своя роль, а кнопка закрытия
    // называется «Закрыть»: записи нет только у отказа.
    const user = userEvent.setup();
    const { onSubmit } = setup({
      onSubmit: async () => ({
        warning: "Оплата записана, но документ приложить не удалось",
      }),
    });

    await user.type(amountInput(), "1000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "Оплата записана",
      );
    });
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("отказ записи показывается как отказ, а не как предупреждение", async () => {
    const user = userEvent.setup();
    setup({ onSubmit: async () => ({ error: "Недостаточно прав" }) });

    await user.type(amountInput(), "1000");
    await user.click(screen.getByRole("button", { name: "Добавить в график" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Недостаточно прав");
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeDefined();
  });
});
