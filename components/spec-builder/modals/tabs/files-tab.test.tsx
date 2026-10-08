import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FilesTab from "./files-tab";
import { MAX_SPEC_ITEM_FILE_BYTES } from "@/lib/spec/file-content";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Тесты вкладки «Файлы»: состояния и защита от гонки.
 *
 * Server actions подменяются модульным моком — реальный action требует сессии
 * next-auth и БД. Проверяется поведение вкладки: что показывается на каждом
 * состоянии, что список не сортируется на клиенте, что ссылка запрашивается
 * только по клику и только для одного файла, и что устаревший ответ не попадает
 * в состояние.
 *
 * ── Почему проверки идут по ролям, а не по классам ─────────────────────────
 *
 * Разметку строки теперь даёт shadcn Base `Attachment`, и её внутренние классы —
 * не контракт: они меняются вместе с компонентом. Контракт, на который опираются
 * тесты, — поведение и доступность: единственная кнопка строки — триггер с
 * понятным `aria-label`, состояние строки видно по `data-state` самого
 * `Attachment`. Проверок вида «у элемента такой-то класс» здесь нет намеренно.
 */

const listMock = vi.hoisted(() => vi.fn());
const urlMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/spec-item-files", () => ({
  listSpecItemFiles: listMock,
  getSpecItemFileUrl: urlMock,
  uploadSpecItemFile: uploadMock,
  deleteSpecItemFile: deleteMock,
}));

/* ------------------------------------------------------------------ */
/*  Данные                                                             */
/* ------------------------------------------------------------------ */

function entry(overrides: Partial<SpecItemFileEntry> = {}): SpecItemFileEntry {
  return {
    id: "file-1",
    fileName: "Счёт №1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1.2 * 1048576,
    category: "document",
    uploadedBy: null,
    createdAt: "2026-10-06T09:30:00.000Z",
    ...overrides,
  };
}

/** Ответ сервера: порядок приходит с сервера и клиентом не меняется. */
const serverOrder = [
  entry({ id: "file-new", fileName: "Новый.pdf", createdAt: "2026-10-06T09:30:00.000Z" }),
  entry({ id: "file-old", fileName: "Старый.pdf", createdAt: "2026-01-01T09:30:00.000Z" }),
];

/**
 * Запись, которую возвращает `uploadSpecItemFile`: сервер выдаёт `id`, `url`
 * файла нет — список обновляется именно этим объектом.
 */
const uploadedEntry = entry({
  id: "file-uploaded",
  fileName: "Загруженный.pdf",
  createdAt: "2026-10-06T12:00:00.000Z",
});

/**
 * Выбор файла в скрытом input.
 *
 * `fireEvent.change` с подставленным `files`, а не `userEvent.upload`: проверка
 * размера должна достаться нашему обработчику, а не отфильтроваться внутри
 * `userEvent`, который уважает ограничения input'а. Так тестируется РЕАЛЬНАЯ
 * реакция вкладки на слишком большой файл.
 */
function pickFile(input: HTMLElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

const pickerInput = () =>
  screen.getByLabelText("Выбрать файл для загрузки") as HTMLInputElement;

/** Кнопки удаления: по одной на строку, с доступным именем файла. */
const deleteButtons = () =>
  screen.queryAllByRole("button", { name: /^Удалить «/ });

const deleteButtonFor = (fileName: string) =>
  screen.getByRole("button", { name: `Удалить «${fileName}»` });

/**
 * Элемент, на котором включён приём файлов.
 *
 * Ищем по атрибуту состояния, а не по классам: классы — не контракт, а
 * `data-drag-active` показывает, активна ли зона прямо сейчас.
 */
const dropZone = () => document.querySelector("[data-drag-active]") as HTMLElement;

const isDragActive = () => dropZone().getAttribute("data-drag-active") === "true";

/** Перенос файлов: `types` содержит `Files`, иначе зона не обязана реагировать. */
function dragEvent(files: File[]) {
  return { dataTransfer: { files, types: files.length > 0 ? ["Files"] : [] } };
}

/** Перенос, в котором файлов нет (например, перетаскивают текст). */
const textDragEvent = { dataTransfer: { files: [], types: ["text/plain"] } };

const pdfFile = (name = "Счёт.pdf") =>
  new File(["счёт"], name, { type: "application/pdf" });

/**
 * Кнопка «Добавить файл».
 *
 * Она существует только в empty state (отдельной кнопки над списком нет),
 * поэтому в тестах со списком её быть не должно.
 */
const addFileButton = () =>
  screen.getByRole("button", { name: "Добавить файл" });

/** Тело `FormData`, которое получил server action на попытке `call`. */
function formDataOf(call: number): FormData {
  return uploadMock.mock.calls[call][2] as FormData;
}

const SIGNED_URL = "https://signed.test/file";
const OPEN_BUTTON = /^Открыть «.+» в новой вкладке$/;

/** Все строки файлов: `Attachment` помечает себя `data-slot`. */
const rows = () => document.querySelectorAll('[data-slot="attachment"]');

/** Триггеры строк — единственные доступные кнопки файлов. */
const openButtons = () => screen.queryAllByRole("button", { name: OPEN_BUTTON });

beforeEach(() => {
  listMock.mockReset();
  urlMock.mockReset();
  uploadMock.mockReset();
  deleteMock.mockReset();
  listMock.mockResolvedValue({ success: true, data: serverOrder });
  urlMock.mockResolvedValue({
    success: true,
    data: { url: SIGNED_URL, expiresAt: "2026-10-06T09:35:00.000Z" },
  });
  uploadMock.mockResolvedValue({ success: true, data: uploadedEntry });
  deleteMock.mockResolvedValue({ success: true, data: { deleted: true } });
});

/**
 * Размонтирование между тестами обязательно.
 *
 * Автоочистка Testing Library включается только при включённых `globals` в
 * конфиге Vitest (она регистрирует свой `afterEach` глобально), а глобусы в
 * проекте выключены — без этого разметка тестов накапливалась бы в `document`,
 * и `getByText` находил бы по нескольку совпадений.
 */
afterEach(() => {
  cleanup();
});

/* ------------------------------------------------------------------ */
/*  Состояния                                                          */
/* ------------------------------------------------------------------ */

describe("FilesTab: состояния", () => {
  it("показывает skeleton, пока список не пришёл", () => {
    // Ответ не разрешаем: интересно именно состояние загрузки.
    listMock.mockReturnValue(new Promise(() => {}));

    const { container } = render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    // Строки-заготовки той же геометрии, что настоящая строка Attachment.
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThanOrEqual(4);
    expect(rows()).toHaveLength(0);
    expect(openButtons()).toHaveLength(0);
    expect(screen.queryByText("Файлов пока нет")).toBeNull();
  });

  it("пустой список: empty state вместо скелетонов", async () => {
    listMock.mockResolvedValue({ success: true, data: [] });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(await screen.findByText("Файлов пока нет")).toBeTruthy();
    expect(rows()).toHaveLength(0);
    // Признак загрузки пропал: skeleton'ов больше нет.
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  it("ошибка: сообщение и кнопка «Повторить»", async () => {
    listMock.mockResolvedValue({ success: false, error: "Нет доступа" });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Нет доступа")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });

  it("падение server action тоже даёт ошибку, а не пустой экран", async () => {
    listMock.mockRejectedValue(new Error("сеть"));

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(await screen.findByText("Не удалось загрузить файлы")).toBeTruthy();
  });

  it("«Повторить» перезапрашивает список и показывает его", async () => {
    listMock.mockResolvedValueOnce({ success: false, error: "Нет доступа" });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    const retry = await screen.findByRole("button", { name: "Повторить" });

    await userEvent.click(retry);

    // Успешный повтор: ошибки больше нет, файлы видны.
    expect(await screen.findByText("Новый.pdf")).toBeTruthy();
    expect(screen.queryByText("Нет доступа")).toBeNull();
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("список: имя, размер, дата; технических полей нет", async () => {
    // Один файл с известным именем: проверяем ровно отрисовку строки.
    listMock.mockResolvedValue({ success: true, data: [entry()] });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(await screen.findByText("Счёт №1.pdf")).toBeTruthy();
    // Размер и дата в подписи строки — размер берётся из `sizeBytes`.
    expect(screen.getByText(/1\.2 MB/)).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();
    // Ни uuid, ни пути в разметке нет.
    const html = document.body.innerHTML;
    expect(html).not.toContain("storage_path");
    expect(html).not.toContain("file-1");
  });

  it("порядок сервера сохраняется: клиент не сортирует", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    const names = openButtons().map((node) => node.getAttribute("aria-label"));

    // Первым идёт тот, кого сервер прислал первым, хотя по дате он «новее».
    expect(names[0]).toContain("Новый.pdf");
    expect(names[1]).toContain("Старый.pdf");
  });
});

/* ------------------------------------------------------------------ */
/*  Открытие файла                                                     */
/* ------------------------------------------------------------------ */

describe("FilesTab: открытие файла", () => {
  it("ссылка не запрашивается до клика", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    expect(urlMock).not.toHaveBeenCalled();
  });

  it("по клику запрашивается ссылка только для этого файла и открывается вкладка", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await userEvent.click(
      screen.getByRole("button", { name: /Открыть «Новый\.pdf»/ }),
    );

    await waitFor(() => expect(urlMock).toHaveBeenCalledTimes(1));
    expect(urlMock).toHaveBeenCalledWith("andy", "item-1", "file-new");
    expect(openSpy).toHaveBeenCalledWith(
      SIGNED_URL,
      "_blank",
      "noopener,noreferrer",
    );
    // Второй файл ссылку не получал.
    expect(urlMock).not.toHaveBeenCalledWith("andy", "item-1", "file-old");

    openSpy.mockRestore();
  });

  it("во время получения ссылки disabled только выбранный файл", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    // Первый запрос не разрешаем: строка остаётся в состоянии открытия.
    let release: (value: unknown) => void = () => {};
    urlMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    const chosen = screen.getByRole("button", { name: /Открыть «Новый\.pdf»/ });
    const other = screen.getByRole("button", { name: /Открыть «Старый\.pdf»/ });

    await userEvent.click(chosen);

    // Выбранная строка заблокирована, остальные файлы остаются рабочими.
    await waitFor(() => expect(chosen.hasAttribute("disabled")).toBe(true));
    expect(other.hasAttribute("disabled")).toBe(false);

    // Другой файл по-прежнему открывается.
    await userEvent.click(other);
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));

    release({
      success: true,
      data: { url: SIGNED_URL, expiresAt: "2026-10-06T09:35:00.000Z" },
    });
    openSpy.mockRestore();
  });

  it("ошибка получения ссылки показывается у своей строки и не ломает список", async () => {
    urlMock.mockResolvedValue({ success: false, error: "Файл не найден" });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await userEvent.click(
      screen.getByRole("button", { name: /Открыть «Новый\.pdf»/ }),
    );

    // Отказ показан в подписи выбранной строки и переводит её в state="error".
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Файл не найден");
    const errorRow = alert.closest('[data-slot="attachment"]');
    expect(errorRow?.getAttribute("data-state")).toBe("error");

    // Список работоспособен: вторая строка не в ошибке.
    const healthy = screen
      .getByRole("button", { name: /Открыть «Старый\.pdf»/ })
      .closest('[data-slot="attachment"]');
    expect(healthy?.getAttribute("data-state")).toBe("done");
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("устаревшая ссылка не открывается: клик по одному файлу, затем по другому", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    // Первый запрос (по «Новому») отвечает ПОСЛЕ второго.
    let releaseFirst: (value: unknown) => void = () => {};
    urlMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        success: true,
        data: { url: "https://signed.test/old", expiresAt: "2026-10-06T09:35:00.000Z" },
      });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await userEvent.click(
      screen.getByRole("button", { name: /Открыть «Новый\.pdf»/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Открыть «Старый\.pdf»/ }),
    );

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        "https://signed.test/old",
        "_blank",
        "noopener,noreferrer",
      ),
    );

    // Теперь «доезжает» первый (устаревший) ответ: он не должен открыть ничего.
    releaseFirst({
      success: true,
      data: { url: "https://signed.test/new", expiresAt: "2026-10-06T09:35:00.000Z" },
    });

    await waitFor(() => expect(urlMock).toHaveBeenCalledTimes(2));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalledWith(
      "https://signed.test/new",
      "_blank",
      "noopener,noreferrer",
    );

    openSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  Смена позиции                                                      */
/* ------------------------------------------------------------------ */

describe("FilesTab: смена позиции", () => {
  it("список перезагружается и устаревший ответ не перезаписывает новый", async () => {
    const first = [entry({ id: "a-1", fileName: "Первый.pdf" })];
    const second = [entry({ id: "b-1", fileName: "Второй.pdf" })];

    let releaseFirst: (value: unknown) => void = () => {};
    listMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ success: true, data: second });

    const { rerender } = render(
      <FilesTab orgSlug="andy" specItemId="item-1" />,
    );

    // Пока первый запрос висит, позиция меняется.
    rerender(<FilesTab orgSlug="andy" specItemId="item-2" />);

    expect(await screen.findByText("Второй.pdf")).toBeTruthy();
    expect(listMock).toHaveBeenLastCalledWith("andy", "item-2");

    // Поздний ответ по старой позиции приходит после нового: он игнорируется.
    releaseFirst({ success: true, data: first });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Первый.pdf")).toBeNull();
    expect(screen.getByText("Второй.pdf")).toBeTruthy();
  });

  it("при смене позиции показывается skeleton, а не список прошлой", async () => {
    const first = [entry({ id: "a-1", fileName: "Первый.pdf" })];

    listMock.mockResolvedValueOnce({ success: true, data: first });
    const { rerender, container } = render(
      <FilesTab orgSlug="andy" specItemId="item-1" />,
    );
    await screen.findByText("Первый.pdf");

    // Новый запрос не разрешается: видно состояние загрузки.
    listMock.mockReturnValue(new Promise(() => {}));
    rerender(<FilesTab orgSlug="andy" specItemId="item-2" />);

    expect(screen.queryByText("Первый.pdf")).toBeNull();
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThanOrEqual(4);
  });
});

/* ------------------------------------------------------------------ */
/*  Разметка Attachment                                                */
/* ------------------------------------------------------------------ */

describe("FilesTab: разметка строки", () => {
  it("строка собрана из слотов Attachment; кнопок ровно две — открыть и удалить", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    const row = rows()[0];
    // Все части строки — на своих слотах компонента.
    for (const slot of [
      "attachment-media",
      "attachment-content",
      "attachment-title",
      "attachment-description",
      "attachment-actions",
      "attachment-trigger",
    ]) {
      expect(
        row.querySelector(`[data-slot="${slot}"]`),
        slot,
      ).not.toBeNull();
    }

    // Имя — в заголовке, размер с датой — в подписи.
    const title = row.querySelector('[data-slot="attachment-title"]');
    const description = row.querySelector('[data-slot="attachment-description"]');
    expect(title?.textContent).toBe("Новый.pdf");
    expect(description?.textContent).toMatch(/1\.2 MB · /);

    // Две доступные кнопки: триггер открытия (вся строка) и удаление в слоте
    // действий. Вложенных `button` в `button` нет: это соседи, а не родитель
    // и ребёнок.
    const buttons = within(row as HTMLElement).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(
      buttons.map((button) => button.getAttribute("data-slot")).sort(),
    ).toEqual(["attachment-action", "attachment-trigger"]);
    expect(buttons.some((b) => b.contains(buttons[0]) && b !== buttons[0])).toBe(
      false,
    );
  });

  it("строка не превращена в ссылку: открытие остаётся обработчиком", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    // Ни одного <a> в списке: signed URL не может «утечь» в href.
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Picker                                                             */
/* ------------------------------------------------------------------ */

describe("FilesTab: picker", () => {
  it("скрытый input есть, multiple отсутствует", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    const input = pickerInput();
    expect(input.type).toBe("file");
    // Один файл за раз: атрибута `multiple` быть не должно.
    expect(input.hasAttribute("multiple")).toBe(false);
  });

  it("выбор файла открывает сценарий выбора категории, но не отправляет его", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    pickFile(pickerInput(), new File(["счёт"], "Счёт.pdf", { type: "application/pdf" }));

    // Диалог: имя файла, варианты категории, кнопки подтверждения.
    expect(await screen.findByText("Счёт.pdf")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Документ" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Текстура" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Другое" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Загрузить" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeTruthy();

    // До подтверждения на сервер не уходит ничего.
    expect(uploadMock).not.toHaveBeenCalled();
    // И в подтверждённый список файл тоже не попадает — optimistic-записи нет.
    expect(screen.queryByText("Загруженный.pdf")).toBeNull();
  });

  it("слишком большой файл не отправляется и объясняет причину", async () => {
    // Ошибка выбора показывается в empty state рядом с кнопкой: список пуст.
    listMock.mockResolvedValue({ success: true, data: [] });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Файлов пока нет");

    const huge = new File(["x"], "огромный.pdf", { type: "application/pdf" });
    Object.defineProperty(huge, "size", { value: MAX_SPEC_ITEM_FILE_BYTES + 1 });

    pickFile(pickerInput(), huge);

    expect(
      await screen.findByText(
        "Файл слишком большой. Максимальный размер — 25 МБ.",
      ),
    ).toBeTruthy();
    // Ни диалога, ни запроса: до сервера дело не дошло.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
    // Empty state остался на месте — ошибка не превращает его в список.
    expect(document.querySelector('[data-slot="empty"]')).not.toBeNull();
  });

  it("ввод сбрасывается после выбора: тот же файл можно выбрать повторно", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    const input = pickerInput();
    pickFile(input, new File(["a"], "Первый.pdf", { type: "application/pdf" }));

    // После обработки значение пустое — иначе браузер не вызовет `change` для
    // того же файла во второй раз (например, после ошибки загрузки).
    expect(input.value).toBe("");
  });

  it("«Отмена» до загрузки закрывает выбор без запроса", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ success: true, data: [] });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Файлов пока нет");

    pickFile(pickerInput(), new File(["a"], "Счёт.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Отмена" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(uploadMock).not.toHaveBeenCalled();
    // Кнопка снова доступна: можно выбрать другой файл.
    expect(
      addFileButton().hasAttribute("disabled"),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

describe("FilesTab: empty state", () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ success: true, data: [] });
  });

  it("при отсутствии файлов показан Empty: заголовок и описание", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(await screen.findByText("Файлов пока нет")).toBeTruthy();
    expect(
      screen.getByText(/Перетащите файл сюда или добавьте его кнопкой/),
    ).toBeTruthy();
    // Структура `Empty` — по слотам компонента.
    expect(document.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="empty-header"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="empty-icon"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="empty-title"]')).not.toBeNull();
    expect(
      document.querySelector('[data-slot="empty-description"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-slot="empty-content"]')).not.toBeNull();
    // Строк списка нет.
    expect(rows()).toHaveLength(0);
  });

  it("кнопка «Добавить файл» есть ровно одна и она внутри Empty", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Файлов пока нет");

    const buttons = screen.getAllByRole("button", { name: "Добавить файл" });
    // Отдельной верхней кнопки над списком больше нет: кнопка одна.
    expect(buttons).toHaveLength(1);
    // И она внутри `EmptyContent`, а не рядом с ним.
    expect(
      buttons[0].closest('[data-slot="empty-content"]'),
    ).not.toBeNull();
    expect(buttons[0].closest('[data-slot="empty"]')).not.toBeNull();
  });

  it("кнопка в Empty запускает существующий picker", async () => {
    const user = userEvent.setup();
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Файлов пока нет");

    const input = pickerInput();
    const clickSpy = vi.spyOn(input, "click");

    await user.click(addFileButton());

    // Тот же самый скрытый input, а не второй: `click()` вызван у него.
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("путь от кнопки в Empty до диалога загрузки работает целиком", async () => {
    const user = userEvent.setup();
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Файлов пока нет");

    pickFile(pickerInput(), new File(["a"], "Счёт.pdf", { type: "application/pdf" }));

    // Диалог выбора категории открылся — сценарий остался прежним.
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Загрузить" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Загрузить" }));

    // После успеха Empty сменяется списком с серверной записью.
    expect(await screen.findByText("Загруженный.pdf")).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelector('[data-slot="empty"]')).toBeNull(),
    );
    expect(rows()).toHaveLength(1);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("при наличии файлов Empty отсутствует", async () => {
    listMock.mockResolvedValue({ success: true, data: serverOrder });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    expect(document.querySelector('[data-slot="empty"]')).toBeNull();
    expect(screen.queryByText("Файлов пока нет")).toBeNull();
    // Кнопка добавления есть, но НЕ в `Empty`: она стоит отдельно над списком.
    const buttons = screen.getAllByRole("button", { name: "Добавить файл" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('[data-slot="empty"]')).toBeNull();
    expect(buttons[0].closest('[data-slot="empty-content"]')).toBeNull();
  });

  it("при загрузке списка Empty не показывается", async () => {
    listMock.mockReturnValue(new Promise(() => {}));

    const { container } = render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(screen.queryByText("Файлов пока нет")).toBeNull();
    expect(document.querySelector('[data-slot="empty"]')).toBeNull();
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("при ошибке списка Empty не показывается", async () => {
    listMock.mockResolvedValue({ success: false, error: "Нет доступа" });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByRole("alert");

    expect(document.querySelector('[data-slot="empty"]')).toBeNull();
    expect(screen.queryByText("Файлов пока нет")).toBeNull();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Upload                                                             */
/* ------------------------------------------------------------------ */

describe("FilesTab: upload", () => {
  it("отправляет ровно file и category, без внутренних идентификаторов", async () => {
    const user = userEvent.setup();
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    pickFile(pickerInput(), new File(["счёт"], "Счёт.pdf", { type: "application/pdf" }));
    // Вариант категории — это `<label>` с radio внутри, а не кнопка: клик по
    // подписи выбирает значение.
    await user.click(await screen.findByText("Текстура"));
    await user.click(screen.getByRole("button", { name: "Загрузить" }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));

    // Аргументы action: слаг организации, позиция, форма.
    expect(uploadMock.mock.calls[0][0]).toBe("andy");
    expect(uploadMock.mock.calls[0][1]).toBe("item-1");

    const formData = formDataOf(0);
    expect(formData.get("file")).toBeInstanceOf(File);
    expect((formData.get("file") as File).name).toBe("Счёт.pdf");
    // Выбранная категория уходит как есть.
    expect(formData.get("category")).toBe("texture");

    // Клиент не передаёт ничего, что определяет сервер.
    for (const forbidden of [
      "orgId",
      "org_id",
      "projectId",
      "project_id",
      "specItemId",
      "spec_item_id",
      "uploadedBy",
      "uploaded_by",
      "storagePath",
      "storage_path",
      "createdAt",
      "created_at",
    ]) {
      expect(formData.get(forbidden), forbidden).toBeNull();
    }
    // Список полей формы исчерпывается двумя ключами.
    expect([...formData.keys()].sort()).toEqual(["category", "file"]);
  });

  it("во время загрузки строка в состоянии uploading, повторный выбор закрыт", async () => {
    const user = userEvent.setup();
    // Список пуст: кнопка добавления видна в empty state и её `disabled` можно
    // проверить. Сам факт недоступности фона под модалкой — поведение base-ui,
    // и оно проверяется в тесте empty state.
    listMock.mockResolvedValue({ success: true, data: [] });
    // Ответ не разрешаем: видно состояние загрузки.
    let release: (value: unknown) => void = () => {};
    uploadMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Файлов пока нет");

    pickFile(pickerInput(), new File(["a"], "Счёт.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Загрузить" }));

    // `Attachment` в диалоге переведён в состояние загрузки. Ищем строго внутри
    // диалога: `data-slot="attachment"` есть и у строк списка.
    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(
        dialog.querySelector('[data-slot="attachment"][data-state="uploading"]'),
      ).not.toBeNull();
    });
    expect(within(dialog).getByText("Загрузка…")).toBeTruthy();

    // Повторный выбор файла заблокирован: кнопка добавления физически
    // `disabled`. Доступности она лишена и из-за модального диалога (фон
    // помечен `aria-hidden`), поэтому спрашиваем скрытую кнопку.
    const addButton = screen.getByRole("button", {
      name: "Добавить файл",
      hidden: true,
    });
    expect(addButton.hasAttribute("disabled")).toBe(true);

    // Отмена во время загрузки недоступна: server action не принимает
    // `AbortSignal`, и «отмена» не остановила бы ни запрос, ни запись в Storage.
    expect(
      screen.getByRole("button", { name: "Отмена" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Загрузить" }).hasAttribute("disabled")).toBe(true);

    release({ success: true, data: uploadedEntry });
  });

  it("после успеха в списке появляется запись сервера, preview исчезает", async () => {
    const user = userEvent.setup();
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    pickFile(pickerInput(), new File(["a"], "Локальное имя.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Загрузить" }));

    // В списке — именно серверная запись (её имя и id), а не локальное имя файла.
    expect(await screen.findByText("Загруженный.pdf")).toBeTruthy();
    expect(screen.queryByText("Локальное имя.pdf")).toBeNull();

    // Диалог закрыт, запись встала в список, а над списком — кнопка добавления.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelector('[data-slot="empty"]')).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Добавить файл" }),
    ).toHaveLength(1);

    // Повторный список не запрашивался: хватило возвращённой записи.
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("новая запись встаёт на своё место по серверному порядку", async () => {
    const user = userEvent.setup();
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    pickFile(pickerInput(), new File(["a"], "Счёт.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Загрузить" }));
    await screen.findByText("Загруженный.pdf");

    const names = openButtons().map((node) => node.getAttribute("aria-label"));

    // Порядок `created_at DESC`: 12:00 (загруженный) → 09:30 → 01-01.
    expect(names[0]).toContain("Загруженный.pdf");
    expect(names[1]).toContain("Новый.pdf");
    expect(names[2]).toContain("Старый.pdf");
  });
});

/* ------------------------------------------------------------------ */
/*  Upload: ошибка и retry                                              */
/* ------------------------------------------------------------------ */

describe("FilesTab: ошибка загрузки", () => {
  it("серверная ошибка показывается, строка переходит в error, список жив", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValueOnce({
      success: false,
      error: "Тип файла «application/x-msdownload» не поддерживается",
    });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    pickFile(pickerInput(), new File(["x"], "evil.exe", { type: "application/x-msdownload" }));
    await user.click(await screen.findByRole("button", { name: "Загрузить" }));

    // Текст серверной ошибки — как есть, без переписывания на клиенте.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("не поддерживается");

    // Строка выбранного файла — в состоянии error.
    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="attachment"][data-state="error"]'),
      ).not.toBeNull();
    });

    // В подтверждённый список ничего не добавилось, и список по-прежнему рабочий.
    // Текстовые запросы не смотрят на `aria-hidden` фона, поэтому имя
    // загруженного файла можно проверить и при открытом диалоге.
    expect(screen.queryByText("Загруженный.pdf")).toBeNull();
    expect(screen.getByText("Новый.pdf")).toBeTruthy();
    // Строки списка под модалкой помечены `aria-hidden`, поэтому спрашиваем
    // скрытые элементы: после закрытия диалога они снова доступны.
    expect(
      screen.getAllByRole("button", { name: OPEN_BUTTON, hidden: true }),
    ).toHaveLength(2);
    // Диалог остался открыт: ошибку видно, её не сбрасывают мгновенно.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("retry повторно вызывает upload с тем же файлом, автоматического retry нет", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValueOnce({ success: false, error: "Не удалось загрузить файл" });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    pickFile(pickerInput(), new File(["a"], "Счёт.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Загрузить" }));
    await screen.findByRole("alert");

    // Один клик — один вызов: сам по себе отказ повторов не порождает.
    expect(uploadMock).toHaveBeenCalledTimes(1);

    // Автоматического retry нет: ждём и убеждаемся, что счётчик не вырос.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(uploadMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Повторить" }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    // Повтор идёт с тем же файлом и выбранной категорией.
    const retryForm = formDataOf(1);
    expect((retryForm.get("file") as File).name).toBe("Счёт.pdf");
    expect(retryForm.get("category")).toBe("document");

    // Вторая попытка успешна — запись сервера в списке.
    expect(await screen.findByText("Загруженный.pdf")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Upload: гонки                                                      */
/* ------------------------------------------------------------------ */

describe("FilesTab: гонки загрузки", () => {
  it("устаревший ответ после смены позиции не меняет текущий список", async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    uploadMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    listMock.mockResolvedValue({ success: true, data: [entry({ id: "b-1", fileName: "Второй.pdf" })] });

    const { rerender } = render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Второй.pdf");

    pickFile(pickerInput(), new File(["a"], "Счёт.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Загрузить" }));

    // Пока загрузка идёт, позиция меняется.
    rerender(<FilesTab orgSlug="andy" specItemId="item-2" />);
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith("andy", "item-2"));

    // Поздний ответ по прошлой позиции приходит уже после смены.
    release({ success: true, data: uploadedEntry });

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    // В список ТЕКУЩЕЙ позиции запись не попала.
    expect(screen.queryByText("Загруженный.pdf")).toBeNull();
    expect(screen.getByText("Второй.pdf")).toBeTruthy();
  });

  it("ответ не заменяет актуальную запись списка без причины", async () => {
    const user = userEvent.setup();
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    pickFile(pickerInput(), new File(["a"], "Счёт.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Загрузить" }));
    await screen.findByText("Загруженный.pdf");

    // Уже загруженные записи остались на месте и не задвоились.
    const names = openButtons().map((node) => node.getAttribute("aria-label"));
    expect(names).toHaveLength(3);
    expect(names.filter((name) => name?.includes("Загруженный.pdf"))).toHaveLength(1);
    expect(names.filter((name) => name?.includes("Новый.pdf"))).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Категория и добавление при непустом списке                         */
/* ------------------------------------------------------------------ */

describe("FilesTab: категория файла", () => {
  /** Строка списка по имени файла. */
  const rowOf = (fileName: string) =>
    screen
      .getByRole("button", { name: new RegExp(`Открыть «${fileName}»`) })
      .closest('[data-slot="attachment"]') as HTMLElement;

  it("категории показаны подписями backend-значений", async () => {
    listMock.mockResolvedValue({
      success: true,
      data: [
        entry({ id: "f-doc", fileName: "Счёт.pdf", category: "document" }),
        entry({ id: "f-tex", fileName: "Текстура.jpg", category: "texture" }),
        entry({ id: "f-other", fileName: "Прочее.bin", category: "other" }),
      ],
    });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Счёт.pdf");

    expect(within(rowOf("Счёт.pdf")).getByText("Документ")).toBeTruthy();
    expect(within(rowOf("Текстура.jpg")).getByText("Текстура")).toBeTruthy();
    expect(within(rowOf("Прочее.bin")).getByText("Другое")).toBeTruthy();
  });

  it("категория берётся из `category`, а не угадывается по MIME", async () => {
    // Картинка с MIME `image/png`, но пользователь сохранил её как документ:
    // показывать надо выбор пользователя, а не догадку по типу содержимого.
    listMock.mockResolvedValue({
      success: true,
      data: [
        entry({
          id: "f-1",
          fileName: "скан.png",
          mimeType: "image/png",
          category: "document",
        }),
      ],
    });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("скан.png");

    const row = rowOf("скан.png");
    expect(within(row).getByText("Документ")).toBeTruthy();
    // Иконка при этом определяется типом содержимого — она не про категорию.
    expect(within(row).queryByText("Текстура")).toBeNull();
  });

  it("бейдж категории стоит перед именем файла", async () => {
    listMock.mockResolvedValue({
      success: true,
      data: [entry({ id: "f-1", fileName: "Счёт.pdf", category: "document" })],
    });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Счёт.pdf");

    const contact = within(rowOf("Счёт.pdf")).getByText("Документ");
    const title = rowOf("Счёт.pdf").querySelector('[data-slot="attachment-title"]');

    // Бейдж — в том же контейнере, что заголовок, и идёт раньше него.
    expect(title?.parentElement?.contains(contact)).toBe(true);
    const order = Array.from(title!.parentElement!.children);
    expect(order.indexOf(contact)).toBeLessThan(order.indexOf(title!));
  });
});

describe("FilesTab: добавление при непустом списке", () => {
  it("кнопка «Добавить файл» есть над списком и запускает тот же picker", async () => {
    const user = userEvent.setup();

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    const button = screen.getByRole("button", { name: "Добавить файл" });
    // Кнопка стоит вне `Empty` — оно в непустом состоянии не рендерится.
    expect(document.querySelector('[data-slot="empty"]')).toBeNull();
    expect(button.closest('[data-slot="empty"]')).toBeNull();

    const input = pickerInput();
    const clickSpy = vi.spyOn(input, "click");
    await user.click(button);

    // Тот же самый скрытый input: второй picker не появился.
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
  });

  it("из непустого состояния проходит весь существующий путь загрузки", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ success: true, data: [serverOrder[1]] });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Старый.pdf");

    pickFile(pickerInput(), new File(["a"], "Счёт.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Загрузить" }));

    // Новая запись появилась в существующем списке, вместе со своей категорией.
    expect(await screen.findByText("Загруженный.pdf")).toBeTruthy();
    expect(screen.getAllByText("Документ")).toHaveLength(2);
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Drag & drop                                                        */
/* ------------------------------------------------------------------ */

describe("FilesTab: drag & drop", () => {
  it("перетаскивание файла над списком включает состояние drop-зоны", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    expect(isDragActive()).toBe(false);

    fireEvent.dragEnter(dropZone(), dragEvent([pdfFile()]));
    expect(isDragActive()).toBe(true);

    // Повторный dragover состояние не сбрасывает.
    fireEvent.dragOver(dropZone(), dragEvent([pdfFile()]));
    expect(isDragActive()).toBe(true);

    // Ничего не отправлено: перенос ещё не завершён.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("уход курсора снимает состояние", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    fireEvent.dragEnter(dropZone(), dragEvent([pdfFile()]));
    fireEvent.dragOver(dropZone(), dragEvent([pdfFile()]));
    expect(isDragActive()).toBe(true);

    // Курсор ушёл с вкладки целиком.
    fireEvent.dragLeave(dropZone(), { relatedTarget: document.body });
    expect(isDragActive()).toBe(false);
  });

  it("уход на дочерний элемент подсветку не гасит", async () => {
    // Разделение «ушли на строку» и «ушли совсем» живёт в чистой функции
    // `isLeavingDropZone` (у неё свой тест): синтетические события библиотеки
    // не проставляют `relatedTarget`, поэтому через них это правило не проверить.
    // Здесь проверяется другое: пока идут `dragover`, подсветка активна.
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    for (let i = 0; i < 3; i += 1) {
      fireEvent.dragOver(dropZone(), dragEvent([pdfFile()]));
    }

    expect(isDragActive()).toBe(true);
  });

  it("drop открывает тот же диалог и не грузит файл в обход", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    fireEvent.dragEnter(dropZone(), dragEvent([pdfFile()]));
    expect(isDragActive()).toBe(true);

    fireEvent.drop(dropZone(), dragEvent([pdfFile("Счёт из drop.pdf")]));

    // Визуальное состояние сбрасывается сразу после drop.
    expect(isDragActive()).toBe(false);

    // Открылся существующий диалог загрузки — с выбором категории.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Счёт из drop.pdf")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Документ" })).toBeTruthy();

    // В обход диалога ничего не ушло.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Загруженный.pdf")).toBeNull();
  });

  it("из drop проходит весь существующий путь загрузки до списка", async () => {
    const user = userEvent.setup();
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    fireEvent.drop(dropZone(), dragEvent([pdfFile()]));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Текстура"));
    await user.click(screen.getByRole("button", { name: "Загрузить" }));

    // В списке — серверная запись, а категория ушла выбранная в диалоге.
    expect(await screen.findByText("Загруженный.pdf")).toBeTruthy();
    expect(formDataOf(0).get("category")).toBe("texture");

    // Список обновлён локально, повторного запроса не было.
    expect(listMock).toHaveBeenCalledTimes(1);
    // И появилась верхняя кнопка добавления — список стал непустым.
    expect(
      screen.getByRole("button", { name: "Добавить файл" }),
    ).toBeTruthy();
  });

  it("из нескольких файлов берётся первый: массовой загрузки нет", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    fireEvent.drop(
      dropZone(),
      dragEvent([pdfFile("Первый.pdf"), pdfFile("Второй.pdf"), pdfFile("Третий.pdf")]),
    );

    const dialog = await screen.findByRole("dialog");
    // В диалоге ровно один файл — первый.
    expect(within(dialog).getByText("Первый.pdf")).toBeTruthy();
    expect(screen.queryByText("Второй.pdf")).toBeNull();
    expect(screen.queryByText("Третий.pdf")).toBeNull();

    // Загружается тоже один файл и только после подтверждения.
    expect(uploadMock).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Загрузить" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect((formDataOf(0).get("file") as File).name).toBe("Первый.pdf");
  });

  it("слишком большой файл из drop не открывает диалог", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    const huge = new File(["x"], "огромный.pdf", { type: "application/pdf" });
    Object.defineProperty(huge, "size", { value: MAX_SPEC_ITEM_FILE_BYTES + 1 });

    fireEvent.drop(dropZone(), dragEvent([huge]));

    expect(
      await screen.findByText("Файл слишком большой. Максимальный размер — 25 МБ."),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
    // Визуальное состояние сброшено, несмотря на отказ.
    expect(isDragActive()).toBe(false);
  });

  it("при drag-over подсветка и текст приглашают отпустить файл", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    // До переноса — ненавязчивая подсказка о том, что сюда можно перетащить.
    expect(screen.getByText("Перетащите файл сюда")).toBeTruthy();

    fireEvent.dragEnter(dropZone(), dragEvent([pdfFile()]));

    // Активное состояние: и подсветка зоны, и текст.
    expect(isDragActive()).toBe(true);
    expect(screen.getByText("Отпустите файл для загрузки")).toBeTruthy();
    expect(screen.queryByText("Перетащите файл сюда")).toBeNull();

    // После drop состояние сбрасывается сразу.
    fireEvent.drop(dropZone(), dragEvent([pdfFile()]));
    expect(isDragActive()).toBe(false);
    expect(screen.getByText("Перетащите файл сюда")).toBeTruthy();
  });

  it("перенос без файлов зону не активирует и диалог не открывает", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    fireEvent.dragEnter(dropZone(), textDragEvent);
    expect(isDragActive()).toBe(false);

    fireEvent.drop(dropZone(), textDragEvent);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("drop в пустом состоянии работает: Empty — тоже drop target", async () => {
    listMock.mockResolvedValue({ success: true, data: [] });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Файлов пока нет");

    fireEvent.dragEnter(dropZone(), dragEvent([pdfFile()]));
    expect(isDragActive()).toBe(true);

    fireEvent.drop(dropZone(), dragEvent([pdfFile("Счёт из drop.pdf")]));

    expect(isDragActive()).toBe(false);
    // Открылся тот же диалог загрузки: путь один и тот же.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Счёт из drop.pdf")).toBeTruthy();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("в пустом состоянии описание подсказывает и перетаскивание, и кнопку", async () => {
    listMock.mockResolvedValue({ success: true, data: [] });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Файлов пока нет");

    expect(
      screen.getByText(/Перетащите файл сюда или добавьте его кнопкой/),
    ).toBeTruthy();
    // Кнопка и иконка остались на месте.
    expect(screen.getByRole("button", { name: "Добавить файл" })).toBeTruthy();
    expect(document.querySelector('[data-slot="empty-icon"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Удаление файла                                                     */
/* ------------------------------------------------------------------ */

describe("FilesTab: удаление файла", () => {
  it("у каждого файла есть доступная кнопка удаления в слоте действий", async () => {
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    const buttons = deleteButtons();
    expect(buttons).toHaveLength(2);
    // Кнопки находятся в слоте действий строки и не скрыты от скринридера.
    for (const button of buttons) {
      expect(button.closest('[data-slot="attachment-actions"]')).not.toBeNull();
      expect(button.getAttribute("aria-hidden")).toBeNull();
    }
    // Имя файла в доступном имени — понятно, что именно удаляется.
    expect(deleteButtonFor("Новый.pdf")).toBeTruthy();
    expect(deleteButtonFor("Старый.pdf")).toBeTruthy();
  });

  it("клик по удалению не открывает файл, а открывает подтверждение", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await user.click(deleteButtonFor("Новый.pdf"));

    // Подтверждение с именем файла.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Удалить файл?")).toBeTruthy();
    expect(
      within(dialog).getByText("Файл «Новый.pdf» будет удалён."),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Удалить" })).toBeTruthy();

    // Файл НЕ открылся: ни запроса ссылки, ни новой вкладки.
    expect(urlMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    // И удаление не началось само по себе.
    expect(deleteMock).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("«Отмена» закрывает подтверждение и ничего не удаляет", async () => {
    const user = userEvent.setup();

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await user.click(deleteButtonFor("Новый.pdf"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByText("Новый.pdf")).toBeTruthy();
  });

  it("подтверждение вызывает deleteSpecItemFile с нужными аргументами", async () => {
    const user = userEvent.setup();

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await user.click(deleteButtonFor("Новый.pdf"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    // Слаг организации, позиция и id именно выбранного файла.
    expect(deleteMock).toHaveBeenCalledWith("andy", "item-1", "file-new");
  });

  it("после успешного удаления файл исчезает из списка", async () => {
    const user = userEvent.setup();

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await user.click(deleteButtonFor("Новый.pdf"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Удалить",
      }),
    );

    await waitFor(() => expect(screen.queryByText("Новый.pdf")).toBeNull());
    // Диалог закрылся, вторая строка не тронута.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("Старый.pdf")).toBeTruthy();
    expect(deleteButtons()).toHaveLength(1);
    // Список обновлён локально: повторного запроса не было.
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("после удаления последнего файла показывается Empty", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ success: true, data: [serverOrder[0]] });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await user.click(deleteButtonFor("Новый.pdf"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Удалить",
      }),
    );

    // Пустое состояние вернулось само — с кнопкой добавления.
    expect(await screen.findByText("Файлов пока нет")).toBeTruthy();
    expect(document.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Добавить файл" })).toHaveLength(1);
    expect(deleteButtons()).toHaveLength(0);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("ошибка удаления оставляет файл в списке и показывает причину", async () => {
    const user = userEvent.setup();
    deleteMock.mockResolvedValue({ success: false, error: "Нет доступа" });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await user.click(deleteButtonFor("Новый.pdf"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Удалить",
      }),
    );

    // Файл на месте, текст серверной ошибки виден у его строки. Текст в подписи
    // склеен с размером и датой, поэтому ищем по вхождению.
    expect(await screen.findByText(/Нет доступа/)).toBeTruthy();
    expect(screen.getByText("Новый.pdf")).toBeTruthy();
    expect(deleteButtons()).toHaveLength(2);
  });

  it("во время удаления повторный запрос не отправляется", async () => {
    const user = userEvent.setup();

    // Ответ не разрешаем: удаление «идёт».
    let release: (value: unknown) => void = () => {};
    deleteMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    await user.click(deleteButtonFor("Новый.pdf"));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Удалить" });

    await user.click(confirm);
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));

    // Кнопка подтверждения выключена, строка в состоянии удаления. Выключенную
    // кнопку библиотека не считает доступной, поэтому спрашиваем скрытые.
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(true));
    expect(
      screen
        .getByRole("button", { name: "Удалить «Новый.pdf»", hidden: true })
        .hasAttribute("disabled"),
    ).toBe(true);

    // Повторный клик по подтверждению второго запроса не создаёт.
    await user.click(confirm);
    expect(deleteMock).toHaveBeenCalledTimes(1);

    release({ success: true, data: { deleted: true } });
  });
});

/* ------------------------------------------------------------------ */
/*  Security / rendering                                               */
/* ------------------------------------------------------------------ */

describe("FilesTab: что не должно попадать в UI", () => {
  it("после загрузки в разметке нет uuid и storage_path", async () => {
    const user = userEvent.setup();
    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Новый.pdf");

    pickFile(pickerInput(), new File(["a"], "Счёт.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Загрузить" }));
    await screen.findByText("Загруженный.pdf");

    const html = document.body.innerHTML;
    expect(html).not.toContain("storage_path");
    expect(html).not.toContain("file-uploaded");
    expect(html).not.toContain("file-new");
  });
});
