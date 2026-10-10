import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FilesTab from "./files-tab";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Тесты вкладки «Файлы»: чтение данных, состояния и гонки.
 *
 * ── Почему здесь так мало проверок разметки ────────────────────────────────
 *
 * Список документов (группы, фильтры, строки, загрузка, правка) — общий
 * компонент `DocumentList`, и его поведение проверяется в
 * `document-list.test.tsx` один раз. Здесь остаётся то, чего в списке нет:
 * откуда берутся данные, что показывается при отказе и что ответы прошлой
 * позиции не попадают в текущий список.
 *
 * Server actions подменяются модульными моками: настоящие требуют сессии
 * next-auth и живой БД.
 */

const listMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const urlMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/spec-item-files", () => ({
  listSpecItemFiles: listMock,
  uploadSpecItemFile: uploadMock,
  deleteSpecItemFile: deleteMock,
  updateSpecItemFile: updateMock,
  getSpecItemFileUrl: urlMock,
}));

/** Файл, который отдаёт список. */
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

const okList = (files: SpecItemFileEntry[]) => ({ success: true, data: files });

/** Выбор файла в скрытом input. */
function pickFile(input: HTMLElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

const picker = () =>
  screen.getByLabelText("Выбрать файлы для загрузки") as HTMLInputElement;

beforeEach(() => {
  listMock.mockReset();
  uploadMock.mockReset();
  deleteMock.mockReset();
  updateMock.mockReset();
  urlMock.mockReset();
  urlMock.mockResolvedValue({
    success: true,
    data: { url: "https://signed.test/file", expiresAt: "2026-10-06T12:05:00.000Z" },
  });
});

afterEach(cleanup);

describe("FilesTab: состояния", () => {
  it("показывает заготовки, пока список не пришёл", async () => {
    // Ответ не разрешаем: видно состояние загрузки.
    listMock.mockImplementation(() => new Promise(() => undefined));

    const { container } = render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("Файлов пока нет")).toBeNull();
  });

  it("пустой список даёт приглашение, а не заготовки", async () => {
    listMock.mockResolvedValue(okList([]));

    const { container } = render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(await screen.findByText("Файлов пока нет")).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    // Заголовок со счётчиком в пустом состоянии не показывается: число «0»
    // дублировало бы приглашение, которое и так говорит, что файлов нет.
    expect(screen.queryByText(/^Документов: /)).toBeNull();
  });

  it("после загрузки показывает документы и их число", async () => {
    listMock.mockResolvedValue(okList([entry(), entry({ id: "f-2", fileName: "Чек.pdf" })]));

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(await screen.findByText("Счёт №1.pdf")).toBeTruthy();
    expect(screen.getByText("Чек.pdf")).toBeTruthy();
    expect(screen.getByText("Документов: 2")).toBeTruthy();
  });

  it("отказ чтения показывает текст и «Повторить»", async () => {
    listMock.mockResolvedValue({ success: false, error: "Не удалось загрузить файлы" });

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(await screen.findByText("Не удалось загрузить файлы")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });

  it("«Повторить» перечитывает список и показывает файлы", async () => {
    listMock.mockResolvedValueOnce({ success: false, error: "Не удалось загрузить файлы" });
    listMock.mockResolvedValueOnce(okList([entry()]));

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Не удалось загрузить файлы");

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));

    expect(await screen.findByText("Счёт №1.pdf")).toBeTruthy();
    expect(screen.queryByText("Не удалось загрузить файлы")).toBeNull();
  });

  it("исключение из действия читается как отказ загрузки", async () => {
    listMock.mockRejectedValue(new Error("сеть"));

    render(<FilesTab orgSlug="andy" specItemId="item-1" />);

    expect(await screen.findByText("Не удалось загрузить файлы")).toBeTruthy();
  });
});

describe("FilesTab: смена позиции", () => {
  it("ответ прошлой позиции не попадает в список новой", async () => {
    /** Ответ первой позиции, который разрешим после смены позиции. */
    const first: { release: ((value: unknown) => void) | null } = { release: null };
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first.release = resolve as (value: unknown) => void;
        }),
    );
    listMock.mockResolvedValueOnce(okList([entry({ id: "f-2", fileName: "Второй.pdf" })]));

    const { rerender } = render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    rerender(<FilesTab orgSlug="andy" specItemId="item-2" />);

    expect(await screen.findByText("Второй.pdf")).toBeTruthy();

    // Поздний ответ первой позиции: он не должен перезаписать список второй.
    first.release?.({ success: true, data: [entry({ id: "f-1", fileName: "Первый.pdf" })] });

    await waitFor(() => {
      expect(screen.queryByText("Первый.pdf")).toBeNull();
    });
    expect(screen.getByText("Второй.pdf")).toBeTruthy();
  });

  it("при смене позиции остаётся заготовка, а не прошлый список", async () => {
    listMock.mockResolvedValueOnce(okList([entry({ fileName: "Первый.pdf" })]));
    const { rerender } = render(<FilesTab orgSlug="andy" specItemId="item-1" />);
    await screen.findByText("Первый.pdf");

    // Вторая позиция отвечает не сразу: показать прошлый список было бы ложью.
    listMock.mockImplementationOnce(() => new Promise(() => undefined));
    rerender(<FilesTab orgSlug="andy" specItemId="item-2" />);

    expect(screen.queryByText("Первый.pdf")).toBeNull();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});

describe("FilesTab: ответы операций над строкой", () => {
  it("загруженный файл встаёт в список ответом сервера", async () => {
    listMock.mockResolvedValue(okList([]));
    uploadMock.mockResolvedValue({
      success: true,
      data: entry({
        id: "u-1",
        fileName: "Новый.pdf",
        createdAt: "2026-10-06T12:00:00.000Z",
      }),
    });

    // Роль участника: без права записи кнопки загрузки нет вовсе (права не
    // описывают чтение, но описывают запись).
    render(<FilesTab orgSlug="andy" specItemId="item-1" role="member" />);
    await screen.findByText("Файлов пока нет");

    pickFile(picker(), new File(["счёт"], "Новый.pdf", { type: "application/pdf" }));

    expect(await screen.findByText("Новый.pdf")).toBeTruthy();
    // Форма несёт только файл и признак оплаты: вид документа определяет сервер.
    const form = uploadMock.mock.calls[0][2] as FormData;
    expect(form.get("category")).toBeNull();
    expect(form.get("payment_id")).toBe("");
  });

  it("ответы списка не зависят от роли: данные те же", async () => {
    listMock.mockResolvedValue(okList([entry()]));

    render(<FilesTab orgSlug="andy" specItemId="item-1" role="viewer" />);

    // Наблюдатель видит файлы, но меню действий у него нет — а вместе с ним нет
    // ни правки, ни удаления: они живут только внутри меню.
    expect(await screen.findByText("Счёт №1.pdf")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Добавить файл" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Действия с «/ })).toBeNull();
  });

  it("участник видит кнопки записи", async () => {
    listMock.mockResolvedValue(okList([entry()]));

    render(<FilesTab orgSlug="andy" specItemId="item-1" role="member" />);
    await screen.findByText("Счёт №1.pdf");

    expect(screen.getByRole("button", { name: "Добавить файл" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Действия с «/ }),
    ).toBeTruthy();
  });
});
