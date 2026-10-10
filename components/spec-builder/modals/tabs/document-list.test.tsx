import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DocumentList from "./document-list";
import { useStoredFileList } from "./use-file-list";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Тесты списка документов: группы, фильтры, строка, загрузка и действия.
 *
 * Server actions подменяются модульными моками — настоящие требуют сессии
 * next-auth и живой БД. Проверяется поведение списка, а не разметка: строки
 * ищутся по ролям и доступным именам, а не по классам (классы — не контракт).
 *
 * ── Почему список тестируется отдельно от вкладки ──────────────────────────
 *
 * Тот же компонент монтируется и во вкладке «Файлы», и в карточке оплаты.
 * Поведение списка (группы, фильтр, загрузка, правка) проверяется ЗДЕСЬ один
 * раз, а тесты вкладок остаются про своё: откуда взялись данные и что уходит
 * на сервер при загрузке.
 */

const listMock = vi.hoisted(() => vi.fn());
const urlMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/spec-item-files", () => ({
  listSpecItemFiles: listMock,
  getSpecItemFileUrl: urlMock,
  uploadSpecItemFile: uploadMock,
  deleteSpecItemFile: deleteMock,
  updateSpecItemFile: updateMock,
}));

/* ------------------------------------------------------------------ */
/*  Данные                                                             */
/* ------------------------------------------------------------------ */

function entry(overrides: Partial<SpecItemFileEntry> = {}): SpecItemFileEntry {
  return {
    id: "file-1",
    fileName: "Счёт №1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    category: "document",
    uploadedBy: null,
    uploadedByName: null,
    createdAt: "2026-10-06T09:30:00.000Z",
    paymentId: null,
    payment: null,
    ...overrides,
  };
}

/** По одной строке каждой группы: закупка, документация, визуальные, другое. */
const mixed = [
  entry({ id: "f-invoice", fileName: "Счёт №124.pdf", category: "invoice" }),
  entry({ id: "f-tz", fileName: "ТЗ.pdf", category: "specification" }),
  entry({ id: "f-photo", fileName: "Фото.jpg", category: "texture", mimeType: "image/jpeg" }),
  entry({ id: "f-other", fileName: "Прочее.bin", category: "other" }),
];

/**
 * Обёртка с состоянием: список ведёт НАСТОЯЩИЙ хук `use-file-list`.
 *
 * Так тест проверяет не подделку, а то же правило, что работает в приложении:
 * оптимистичную правку, её откат на отказе сервера и применение ответа. Своя
 * реализация «на три строки» разошлась бы с хуком и подтверждала бы саму себя.
 */
function Harness(overrides: {
  files?: SpecItemFileEntry[];
  canWrite?: boolean;
  paymentId?: string | null;
  loading?: boolean;
} = {}) {
  const { files, apply, mutate } = useStoredFileList(overrides.files ?? mixed);

  return (
    <DocumentList
      orgSlug="andy"
      specItemId="item-1"
      files={files}
      loading={overrides.loading ?? false}
      paymentId={overrides.paymentId ?? null}
      canWrite={overrides.canWrite ?? true}
      onUploaded={(created) => apply({ type: "uploaded", entry: created })}
      onChanged={(changed) => apply({ type: "changed", entry: changed })}
      onDeleted={(fileId) => apply({ type: "deleted", fileId })}
      mutate={mutate}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Помощники                                                          */
/* ------------------------------------------------------------------ */

const picker = () =>
  screen.getByLabelText("Выбрать файлы для загрузки") as HTMLInputElement;

const addFileButton = () => screen.getByRole("button", { name: "Добавить файл" });

const dropZone = () => document.querySelector("[data-drag-active]") as HTMLElement;

const isDragActive = () => dropZone().getAttribute("data-drag-active") === "true";

/** Заголовок группы: кнопка сворачивания со счётчиком внутри. */
const groupHeader = (label: string) =>
  screen.getByRole("button", { name: new RegExp(`группу «${label}»`) });

/** Чип фильтра: подпись группы и счётчик. */
const chip = (label: string) =>
  screen.getByRole("button", { name: new RegExp(`^${label}\\s*\\d+$`) });

const textOf = (node: HTMLElement) => node.textContent?.replace(/\s+/g, " ").trim() ?? "";

const rowOf = (fileName: string) =>
  screen
    .getByRole("button", { name: new RegExp(`Открыть «${fileName}»`) })
    .closest('[data-slot="attachment"]') as HTMLElement;

/**
 * Пункт меню действий: сперва открыть меню строки, потом нажать пункт.
 *
 * Правка вида, переименование и удаление живут в меню (`⋯`), а не отдельными
 * кнопками строки: удаление рядом с открытием нажимается случайно. Поэтому
 * каждый такой тест начинается с открытия меню — это часть пути пользователя, а
 * не деталь разметки.
 */
async function clickRowAction(
  user: ReturnType<typeof userEvent.setup>,
  fileName: string,
  action: string,
) {
  await user.click(screen.getByRole("button", { name: `Действия с «${fileName}»` }));
  await user.click(await screen.findByRole("menuitem", { name: `${action} «${fileName}»` }));
}

/** Перенос файлов: `types` содержит `Files`, иначе зона не обязана реагировать. */
function dragEvent(files: File[]) {
  return { dataTransfer: { files, types: files.length > 0 ? ["Files"] : [] } };
}

const pdf = (name = "Счёт.pdf") => new File(["счёт"], name, { type: "application/pdf" });

function pickFiles(input: HTMLElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

/** Тело `FormData`, которое получил action на попытке `call`. */
const formDataOf = (call: number) => uploadMock.mock.calls[call][2] as FormData;

const pdfEntry = (id: string, fileName = "Загруженный.pdf") =>
  entry({ id, fileName, createdAt: "2026-10-06T12:00:00.000Z" });

/**
 * Обещание, которым тест управляет сам.
 *
 * Нужно, чтобы увидеть состояние ДО ответа сервера: пока запрос не завершён,
 * на экране ровно то, что нарисовал оптимистичный показ. Без этого проверить
 * «строка исчезла сразу» невозможно — ответ приходит в тот же тик.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  urlMock.mockReset();
  uploadMock.mockReset();
  deleteMock.mockReset();
  updateMock.mockReset();
  urlMock.mockResolvedValue({
    success: true,
    data: { url: "https://signed.test/file", expiresAt: "2026-10-06T12:05:00.000Z" },
  });
});

afterEach(cleanup);

/* ------------------------------------------------------------------ */
/*  Группы и фильтры                                                   */
/* ------------------------------------------------------------------ */

describe("DocumentList: группы и фильтры", () => {
  it("раскладывает документы по группам «зачем нужен файл»", () => {
    render(<Harness />);

    // Четыре группы, по одному файлу в каждой: счёт — закупка, ТЗ —
    // документация, картинка — визуальные, «другое» — как есть.
    expect(groupHeader("Закупка")).toBeTruthy();
    expect(groupHeader("Документация")).toBeTruthy();
    expect(groupHeader("Визуальные")).toBeTruthy();
    expect(groupHeader("Другое")).toBeTruthy();

    expect(
      within(groupHeader("Закупка").closest("div") as HTMLElement).getByText(
        "Счёт №124.pdf",
      ),
    ).toBeTruthy();
  });

  it("счётчики на чипах совпадают с числом файлов группы", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        files={[
          entry({ id: "a", fileName: "Счёт.pdf", category: "invoice" }),
          entry({ id: "b", fileName: "Чек.pdf", category: "receipt" }),
          entry({ id: "c", fileName: "ТЗ.pdf", category: "specification" }),
        ]}
      />,
    );

    // «Все» — общее число, дальше по группам: закупка 2, документация 1.
    expect(screen.getByRole("button", { name: /^Все\s*3$/ })).toBeTruthy();
    expect(textOf(chip("Закупка"))).toContain("2");
    expect(textOf(chip("Документация"))).toContain("1");

    // Фильтр по группе оставляет только её файлы.
    await user.click(chip("Закупка"));
    expect(screen.getByText("Счёт.pdf")).toBeTruthy();
    expect(screen.getByText("Чек.pdf")).toBeTruthy();
    expect(screen.queryByText("ТЗ.pdf")).toBeNull();
    // Группа без совпадений не показывается вовсе, а не пустой секцией — но её
    // ЧИП остаётся: иначе после выбора фильтра некуда было бы нажать, чтобы
    // переключиться на другую группу или вернуться ко всем файлам.
    expect(
      screen.queryByRole("button", { name: /группу «Документация»/ }),
    ).toBeNull();
    expect(chip("Документация")).toBeTruthy();
  });

  it("чип «Все» остаётся даже при одной группе: им снимается фильтр", () => {
    render(
      <Harness
        files={[
          entry({ id: "a", fileName: "Счёт.pdf", category: "invoice" }),
          entry({ id: "b", fileName: "Чек.pdf", category: "receipt" }),
        ]}
      />,
    );

    // Чип группы один, и фильтровать вроде нечего — но «Все 2» нужен: выбрав
    // единственную группу, вернуться ко всему списку было бы нечем.
    expect(screen.getByRole("button", { name: /^Все\s*2$/ })).toBeTruthy();
    expect(chip("Закупка")).toBeTruthy();
    expect(groupHeader("Закупка")).toBeTruthy();
  });

  it("маленький список: группы раскрыты, клик сворачивает", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText("Счёт №124.pdf")).toBeTruthy();
    expect(groupHeader("Закупка").getAttribute("aria-expanded")).toBe("true");

    await user.click(groupHeader("Закупка"));

    expect(groupHeader("Закупка").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Счёт №124.pdf")).toBeNull();
    // Остальные группы не тронуты.
    expect(screen.getByText("ТЗ.pdf")).toBeTruthy();
  });

  it("большой список: группы свёрнуты, клик раскрывает", async () => {
    const user = userEvent.setup();
    // Девять файлов — порог, после которого список прячется в группы: иначе
    // длинная простыня не даёт увидеть состав целиком.
    const many = Array.from({ length: 9 }, (_, index) =>
      entry({ id: `f-${index}`, fileName: `Файл ${index}.pdf`, category: "document" }),
    );
    render(<Harness files={many} />);

    expect(groupHeader("Документация").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Файл 0.pdf")).toBeNull();

    await user.click(groupHeader("Документация"));

    expect(screen.getByText("Файл 0.pdf")).toBeTruthy();
  });

  it("выбранный фильтр раскрывает группу принудительно", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 9 }, (_, index) =>
      entry({ id: `f-${index}`, fileName: `Файл ${index}.pdf`, category: "invoice" }),
    );
    many.push(entry({ id: "f-tz", fileName: "ТЗ.pdf", category: "specification" }));
    render(<Harness files={many} />);

    // Список большой, группы свёрнуты — но клик по чипу обязан показать файлы:
    // иначе фильтр приводил бы к пустому экрану.
    await user.click(chip("Закупка"));

    expect(screen.getByText("Файл 0.pdf")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Строка                                                             */
/* ------------------------------------------------------------------ */

describe("DocumentList: строка документа", () => {
  it("показывает вид документа, размер и дату", () => {
    render(<Harness files={[entry({ category: "receipt", fileName: "Чек.pdf" })]} />);

    const row = rowOf("Чек.pdf");
    expect(within(row).getByText("Чек")).toBeTruthy();
    expect(within(row).getByText(/1 KB/)).toBeTruthy();
    expect(within(row).getByText(/6 октября 2026/)).toBeTruthy();
  });

  it("имя выводится целиком, а не обрезается многоточием базового заголовка", () => {
    // `AttachmentTitle` несёт `truncate`; двухстрочное имя живёт во вложенном
    // элементе, поэтому проверяется не класс, а два свойства, которые видит
    // пользователь: имя в заголовке целое и подсказка даёт прочитать его
    // полностью, если две строки не вместили.
    const long = "Техническое задание — Развитие территории Угличского района.pdf";
    render(<Harness files={[entry({ fileName: long })]} />);

    const title = rowOf(long).querySelector('[data-slot="attachment-title"]');
    expect(title?.textContent).toBe(long);
    expect(
      title?.querySelector("[title]")?.getAttribute("title"),
    ).toBe(long);
  });

  it("документ к отменённой оплате помечен, обычный — нет", () => {
    render(
      <Harness
        files={[
          entry({
            id: "a",
            fileName: "Чек к отменённой.pdf",
            paymentId: "p-1",
            payment: { kind: "payment", paidAt: null, cancelled: true },
          }),
          entry({ id: "b", fileName: "Обычный.pdf" }),
        ]}
      />,
    );

    expect(screen.getByText(/К отменённой оплате/)).toBeTruthy();
    expect(
      within(rowOf("Обычный.pdf")).queryByText(/оплате/),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Загрузка                                                           */
/* ------------------------------------------------------------------ */

describe("DocumentList: загрузка", () => {
  it("принимает несколько файлов сразу и не спрашивает вид документа", async () => {
    uploadMock
      .mockResolvedValueOnce({ success: true, data: pdfEntry("u-1", "Первый.pdf") })
      .mockResolvedValueOnce({ success: true, data: pdfEntry("u-2", "Второй.pdf") });

    render(<Harness files={[]} />);

    pickFiles(picker(), [pdf("Первый.pdf"), pdf("Второй.pdf")]);

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));

    // Один и тот же вызов на каждый файл: организация, позиция, форма.
    expect(uploadMock.mock.calls[0][0]).toBe("andy");
    expect(uploadMock.mock.calls[0][1]).toBe("item-1");

    // Форма несёт файл и признак оплаты — и НЕ несёт вид документа: его
    // определяет сервер, поэтому клиенту нечего здесь решать.
    const form = formDataOf(0);
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.get("payment_id")).toBe("");
    expect(form.get("category")).toBeNull();

    // Оба файла появились в списке ответами сервера.
    await waitFor(() => {
      expect(screen.getByText("Первый.pdf")).toBeTruthy();
      expect(screen.getByText("Второй.pdf")).toBeTruthy();
    });
  });

  it("файл виден строкой «Загружается», пока идёт отправка", async () => {
    /** Ответ, который разрешим вручную: так видно состояние загрузки. */
    const pending: { release: ((value: unknown) => void) | null } = {
      release: null,
    };
    uploadMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          // Через объект, а не через переменную: обещание разрешается позже,
          // и вывод типов об этом не знает.
          pending.release = resolve as (value: unknown) => void;
        }),
    );

    render(<Harness files={[]} />);

    pickFiles(picker(), [pdf("Долгий.pdf")]);

    expect(await screen.findByText("Долгий.pdf")).toBeTruthy();
    expect(screen.getByText(/Загружается/)).toBeTruthy();

    pending.release?.({ success: true, data: pdfEntry("u-1", "Долгий.pdf") });

    await waitFor(() => {
      expect(screen.queryByText(/Загружается/)).toBeNull();
    });
  });

  it("файл больше лимита не отправляется вообще", () => {
    render(<Harness files={[]} />);

    const huge = new File([new Uint8Array(1)], "Огромный.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(huge, "size", { value: 26 * 1024 * 1024 });

    pickFiles(picker(), [huge]);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(textOf(screen.getByRole("alert"))).toContain("больше 25 МБ");
  });

  it("drag & drop принимает файлы и подсвечивает всю зону", async () => {
    uploadMock.mockResolvedValue({ success: true, data: pdfEntry("u-1") });
    render(<Harness files={[]} />);

    fireEvent.dragEnter(dropZone(), dragEvent([pdf()]));
    expect(isDragActive()).toBe(true);
    expect(screen.getByText(/Отпустите, чтобы добавить файлы/)).toBeTruthy();

    fireEvent.drop(dropZone(), dragEvent([pdf("Брошенный.pdf")]));

    expect(isDragActive()).toBe(false);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect((formDataOf(0).get("file") as File).name).toBe("Брошенный.pdf");
  });

  it("перетаскивание текста зону не активирует", () => {
    render(<Harness files={[]} />);

    fireEvent.dragEnter(dropZone(), {
      dataTransfer: { files: [], types: ["text/plain"] },
    });

    expect(isDragActive()).toBe(false);
  });

  it("привязка к оплате уходит вместе с файлом", async () => {
    uploadMock.mockResolvedValue({
      success: true,
      data: entry({
        id: "u-1",
        fileName: "Чек.pdf",
        paymentId: "payment-1",
        payment: { kind: "payment", paidAt: "2026-10-01", cancelled: false },
      }),
    });

    render(<Harness files={[]} paymentId="payment-1" />);

    pickFiles(picker(), [pdf("Чек.pdf")]);

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(formDataOf(0).get("payment_id")).toBe("payment-1");
  });

  it("viewer не может ни загрузить, ни править, ни удалить", () => {
    render(<Harness files={mixed} canWrite={false} />);

    expect(screen.queryByRole("button", { name: "Добавить файл" })).toBeNull();
    // Меню действий у наблюдателя нет вовсе — и вместе с ним нет ни правки, ни
    // удаления: они живут только внутри меню.
    expect(
      screen.queryByRole("button", { name: /^Действия с «/ }),
    ).toBeNull();
    // Чтение правами не описывается: строки видны, и их можно открыть.
    expect(screen.getByText("Счёт №124.pdf")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Открыть «Счёт №124\.pdf»/ }),
    ).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Правка вида документа                                              */
/* ------------------------------------------------------------------ */

describe("DocumentList: вид документа", () => {
  it("вид меняется из строки и обновляется записью сервера", async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValue({
      success: true,
      data: {
        file: entry({ id: "f-invoice", fileName: "Счёт №124.pdf", category: "receipt" }),
        changed: true,
      },
    });

    render(<Harness files={[entry({ id: "f-invoice", fileName: "Счёт №124.pdf", category: "invoice" })]} />);

    await user.click(screen.getByRole("button", { name: /^Вид документа «/ }));
    // Список видов сгруппирован: «Чек» стоит в группе «Закупка», рядом с текущим.
    await user.click(await screen.findByRole("button", { name: "Чек" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));

    expect(updateMock.mock.calls[0][0]).toBe("andy");
    expect(updateMock.mock.calls[0][1]).toBe("item-1");
    expect(updateMock.mock.calls[0][2]).toBe("f-invoice");
    const form = updateMock.mock.calls[0][3] as FormData;
    expect(form.get("category")).toBe("receipt");

    // В строке — ответ сервера, а не локальное значение.
    await waitFor(() => {
      expect(within(rowOf("Счёт №124.pdf")).getByText("Чек")).toBeTruthy();
    });
  });

  it("вид можно сменить и действием строки: это тот же селект", async () => {
    // Второй путь к тому же селекту — чтобы не искать триггер по разметке, оба
    // пути ведут в одно состояние; тест следит, что они не разошлись.
    const user = userEvent.setup();
    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf", category: "invoice" })]} />);

    await clickRowAction(user, "Счёт.pdf", "Сменить вид");

    expect(await screen.findByRole("button", { name: "Договор" })).toBeTruthy();
  });

  it("отказ правки показывается у строки и не меняет вид", async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValue({
      success: false,
      error: "Недостаточно прав для правки файлов",
    });

    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf", category: "invoice" })]} />);

    await user.click(screen.getByRole("button", { name: /^Вид документа «/ }));
    await user.click(await screen.findByRole("button", { name: "Чек" }));

    await waitFor(() => {
      expect(textOf(screen.getByRole("alert"))).toContain("Недостаточно прав");
    });
    expect(within(rowOf("Счёт.pdf")).getByText("Счёт")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Переименование, скачивание, удаление                                */
/* ------------------------------------------------------------------ */

describe("DocumentList: действия со строкой", () => {
  it("меню строки держит правку, смену вида и удаление", async () => {
    const user = userEvent.setup();
    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf" })]} />);

    await user.click(screen.getByRole("button", { name: "Действия с «Счёт.pdf»" }));

    // Состав меню — контракт: удаление живёт здесь, а не кнопкой рядом с
    // открытием, потому что рядом нажимается случайно.
    expect(
      await screen.findByRole("menuitem", { name: "Переименовать «Счёт.pdf»" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Сменить вид «Счёт.pdf»" }),
    ).toBeTruthy();
    const remove = screen.getByRole("menuitem", { name: "Удалить «Счёт.pdf»" });
    expect(remove).toBeTruthy();
    // Удаление помечено опасным: подпись и цвет отличают его от правки.
    expect(remove.getAttribute("data-variant")).toBe("destructive");
  });

  it("переименование отправляет новое имя и обновляет строку", async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValue({
      success: true,
      data: { file: entry({ id: "f-1", fileName: "Новое имя.pdf" }), changed: true },
    });

    render(<Harness files={[entry({ id: "f-1", fileName: "Старое.pdf" })]} />);

    await clickRowAction(user, "Старое.pdf", "Переименовать");

    const input = await screen.findByLabelText("Имя файла");
    await user.clear(input);
    await user.type(input, "Новое имя.pdf");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const form = updateMock.mock.calls[0][3] as FormData;
    expect(form.get("file_name")).toBe("Новое имя.pdf");

    await waitFor(() => expect(screen.getByText("Новое имя.pdf")).toBeTruthy());
  });

  it("пустое имя не отправляется: отказ виден в диалоге", async () => {
    const user = userEvent.setup();
    render(<Harness files={[entry({ id: "f-1", fileName: "Старое.pdf" })]} />);

    await clickRowAction(user, "Старое.pdf", "Переименовать");
    const input = await screen.findByLabelText("Имя файла");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(updateMock).not.toHaveBeenCalled();
    expect(textOf(screen.getByRole("alert"))).toContain("Укажите имя");
  });

  it("скачивание запрашивает ссылку с флагом download", async () => {
    const user = userEvent.setup();
    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf" })]} />);

    await user.click(screen.getByRole("button", { name: "Скачать «Счёт.pdf»" }));

    await waitFor(() => expect(urlMock).toHaveBeenCalledTimes(1));
    // Четвёртый аргумент — намерение скачать, а не открыть.
    expect(urlMock.mock.calls[0][3]).toBe(true);
  });

  it("открытие запрашивает ссылку без флага скачивания", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf" })]} />);

    await user.click(screen.getByRole("button", { name: /Открыть «Счёт\.pdf»/ }));

    await waitFor(() => expect(urlMock).toHaveBeenCalledTimes(1));
    expect(urlMock.mock.calls[0][3]).toBe(false);
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://signed.test/file",
        "_blank",
        "noopener,noreferrer",
      ),
    );

    open.mockRestore();
  });

  it("удаление требует подтверждения и убирает строку после успеха", async () => {
    const user = userEvent.setup();
    deleteMock.mockResolvedValue({ success: true, data: { deleted: true } });

    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf" })]} />);

    await clickRowAction(user, "Счёт.pdf", "Удалить");

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/исчезнет из позиции/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("andy", "item-1", "f-1"));
    await waitFor(() => expect(screen.queryByText("Счёт.pdf")).toBeNull());
  });

  it("отказ удаления оставляет документ в списке", async () => {
    const user = userEvent.setup();
    deleteMock.mockResolvedValue({
      success: false,
      error: "Не удалось удалить файл",
    });

    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf" })]} />);

    await clickRowAction(user, "Счёт.pdf", "Удалить");
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Удалить",
      }),
    );

    await waitFor(() =>
      expect(textOf(screen.getByRole("alert"))).toContain("Не удалось удалить"),
    );
    expect(screen.getByText("Счёт.pdf")).toBeTruthy();
  });
});

describe("DocumentList: мгновенный показ правок", () => {
  it("удалённая строка исчезает до ответа сервера", async () => {
    const user = userEvent.setup();
    const answer = deferred<{ success: true; data: { deleted: boolean } }>();
    deleteMock.mockReturnValue(answer.promise);

    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf" })]} />);

    await clickRowAction(user, "Счёт.pdf", "Удалить");
    // Подтверждение: строка уже удалена пользователем, но сервер ещё молчит.
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Удалить",
      }),
    );

    // Пока запрос в пути, строка уже исчезла: ждать ответа, глядя на то, что
    // сам же удалил, незачем.
    await waitFor(() => expect(screen.queryByText("Счёт.pdf")).toBeNull());

    answer.resolve({ success: true, data: { deleted: true } });

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Счёт.pdf")).toBeNull();
  });

  it("отказ удаления возвращает строку на место и показывает текст сервера", async () => {
    const user = userEvent.setup();
    const answer = deferred<{ success: false; error: string }>();
    deleteMock.mockReturnValue(answer.promise);

    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf" })]} />);

    await clickRowAction(user, "Счёт.pdf", "Удалить");
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Удалить",
      }),
    );
    await waitFor(() => expect(screen.queryByText("Счёт.pdf")).toBeNull());

    answer.resolve({ success: false, error: "Не удалось удалить файл" });

    // Откат делает React: строка возвращается к тому, что лежит в БД, а отказ
    // виден у неё самой — пользователь не остаётся с исчезнувшим файлом.
    await waitFor(() => expect(screen.getByText("Счёт.pdf")).toBeTruthy());
    expect(textOf(screen.getByRole("alert"))).toContain("Не удалось удалить");
  });

  it("смена вида видна сразу, ответ сервера её подтверждает", async () => {
    const user = userEvent.setup();
    const answer = deferred<{
      success: true;
      data: { file: SpecItemFileEntry; changed: boolean };
    }>();
    updateMock.mockReturnValue(answer.promise);

    render(
      <Harness
        files={[entry({ id: "f-1", fileName: "Счёт.pdf", category: "invoice" })]}
      />,
    );

    await clickRowAction(user, "Счёт.pdf", "Сменить вид");
    await user.click(await screen.findByRole("button", { name: "Чек" }));

    // Признак оптимистичного показа: вид уже «Чек», хотя сервер ещё молчит.
    await waitFor(() =>
      expect(within(rowOf("Счёт.pdf")).getByText("Чек")).toBeTruthy(),
    );

    answer.resolve({
      success: true,
      data: {
        file: entry({ id: "f-1", fileName: "Счёт.pdf", category: "receipt" }),
        changed: true,
      },
    });

    await waitFor(() =>
      expect(within(rowOf("Счёт.pdf")).getByText("Чек")).toBeTruthy(),
    );
  });

  it("переименование видно сразу и откатывается на отказе", async () => {
    const user = userEvent.setup();
    const answer = deferred<{ success: false; error: string }>();
    updateMock.mockReturnValue(answer.promise);

    render(<Harness files={[entry({ id: "f-1", fileName: "Старое.pdf" })]} />);

    await clickRowAction(user, "Старое.pdf", "Переименовать");
    const input = await screen.findByLabelText("Имя файла");
    await user.clear(input);
    await user.type(input, "Новое.pdf");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    // Имя новое, сервер ещё не ответил.
    await waitFor(() => expect(screen.getByText("Новое.pdf")).toBeTruthy());

    answer.resolve({ success: false, error: "Не удалось переименовать файл" });

    // Отказ: имя вернулось к тому, что в БД, и текст отказа виден в диалоге.
    await waitFor(() => expect(screen.getByText("Старое.pdf")).toBeTruthy());
    expect(screen.queryByText("Новое.pdf")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Миниатюры                                                          */
/* ------------------------------------------------------------------ */

describe("DocumentList: миниатюры", () => {
  it("подписывает изображения и рисует превью", async () => {
    urlMock.mockResolvedValue({
      success: true,
      data: { url: "https://signed.test/thumb", expiresAt: "2026-10-06T12:05:00.000Z" },
    });

    render(
      <Harness
        files={[
          entry({
            id: "f-photo",
            fileName: "Фото.jpg",
            category: "texture",
            mimeType: "image/jpeg",
          }),
        ]}
      />,
    );

    await waitFor(() => expect(urlMock).toHaveBeenCalledTimes(1));

    const row = rowOf("Фото.jpg");
    const image = row.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://signed.test/thumb");
    // Подпись для превью не нужна: имя файла стоит рядом текстом.
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("для не-изображений ссылка заранее не запрашивается", () => {
    render(<Harness files={[entry({ id: "f-1", fileName: "Счёт.pdf" })]} />);

    // Ссылка запрашивается только по клику: заранее подписывать список нельзя.
    expect(urlMock).not.toHaveBeenCalled();
  });

  it("отказ подписи не ломает строку: остаётся иконка", async () => {
    urlMock.mockResolvedValue({ success: false, error: "Не удалось открыть файл" });

    render(
      <Harness
        files={[
          entry({
            id: "f-photo",
            fileName: "Фото.jpg",
            category: "texture",
            mimeType: "image/jpeg",
          }),
        ]}
      />,
    );

    await waitFor(() => expect(urlMock).toHaveBeenCalledTimes(1));

    const row = rowOf("Фото.jpg");
    expect(row.querySelector("img")).toBeNull();
    expect(within(row).getByText("Фото.jpg")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Состояния                                                          */
/* ------------------------------------------------------------------ */

describe("DocumentList: состояния", () => {
  it("пустой список приглашает и даёт обе точки входа", () => {
    const { container } = render(<Harness files={[]} />);

    expect(screen.getByText("Файлов пока нет")).toBeTruthy();
    // Кнопка в пустом состоянии и скрытый input — один и тот же путь загрузки.
    expect(addFileButton()).toBeTruthy();
    expect(picker().multiple).toBe(true);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  it("во время загрузки показываются заготовки, а не пустое состояние", () => {
    render(<Harness files={[]} loading />);

    expect(screen.queryByText("Файлов пока нет")).toBeNull();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
