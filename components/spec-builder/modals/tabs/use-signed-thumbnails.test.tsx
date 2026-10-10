import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSignedThumbnails } from "./use-signed-thumbnails";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Тесты подписи миниатюр: пачка, гонка и повтор.
 *
 * ── Что здесь проверяется ──────────────────────────────────────────────────
 *
 * Ровно те правила, ради которых подпись вынесена из списка в отдельный модуль:
 * картинки списка подписываются ОДНИМ вызовом (а не по вызову на строку),
 * не-картинки не подписываются вовсе, ответ прошлой позиции не попадает в
 * состояние, и на каждый файл даётся ровно один повтор.
 *
 * Важность пачки — не в «меньше запросов» как таковой: клиентский диспетчер
 * Next.js отправляет server actions ПО ОДНОМУ, поэтому «запрос на картинку» —
 * это последовательные запросы, и их число и есть задержка.
 *
 * Server action подменяется модульным моком: настоящий требует сессии next-auth
 * и живой БД.
 */

const urlsMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/spec-item-files", () => ({
  getSpecItemFileUrls: urlsMock,
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

/** Картинка: вид файла считается по MIME, а не по виду документа. */
const photo = (id: string) =>
  entry({ id, fileName: `${id}.jpg`, category: "texture", mimeType: "image/jpeg" });

const signed = (fileId: string, url: string) => ({
  fileId,
  url,
  expiresAt: "2026-10-06T12:05:00.000Z",
});

/* ------------------------------------------------------------------ */
/*  Обёртка                                                            */
/* ------------------------------------------------------------------ */

/**
 * Что видно снаружи хука: подписанные ссылки и выход для «не отрисовалось».
 *
 * Ссылки печатаются отсортированными парами, а не объектом: сравнение строки
 * не зависит от порядка ответа сервера, и тест не ломается от перестановки.
 */
function Probe({
  files,
  enabled = true,
}: {
  files: SpecItemFileEntry[];
  enabled?: boolean;
}) {
  const { urls, onFailed } = useSignedThumbnails("andy", "item-1", files, enabled);

  return (
    <div>
      <output data-testid="urls">
        {Object.entries(urls)
          .map(([fileId, url]) => `${fileId}=${url}`)
          .sort()
          .join("|")}
      </output>
      {files.map((file) => (
        <button key={file.id} type="button" onClick={() => onFailed(file.id)}>
          {`миниатюра не отрисовалась: ${file.id}`}
        </button>
      ))}
    </div>
  );
}

const shown = () => screen.getByTestId("urls").textContent;
const failThumb = (fileId: string) =>
  fireEvent.click(
    screen.getByRole("button", { name: `миниатюра не отрисовалась: ${fileId}` }),
  );

/** Дать эффекту и его промисам улечься, не выходя из `act`. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  urlsMock.mockReset();
  urlsMock.mockResolvedValue({ success: true, data: [] });
});

afterEach(cleanup);

/* ------------------------------------------------------------------ */
/*  Пачка                                                              */
/* ------------------------------------------------------------------ */

describe("useSignedThumbnails: пачка", () => {
  it("подписывает все картинки списка ОДНИМ вызовом", async () => {
    urlsMock.mockResolvedValue({
      success: true,
      data: [signed("f-a", "https://signed.test/a"), signed("f-b", "https://signed.test/b")],
    });

    render(<Probe files={[photo("f-a"), photo("f-b"), entry({ id: "f-c" })]} />);

    await waitFor(() => expect(urlsMock).toHaveBeenCalledTimes(1));
    // Не-картинка в пачку не попадает: превью ей не нужно.
    expect(urlsMock).toHaveBeenCalledWith("andy", "item-1", ["f-a", "f-b"]);
    await waitFor(() =>
      expect(shown()).toBe("f-a=https://signed.test/a|f-b=https://signed.test/b"),
    );
  });

  it("не-картинки не подписываются вовсе", async () => {
    render(<Probe files={[entry({ id: "f-pdf" })]} />);

    await waitFor(() => expect(shown()).toBe(""));
    expect(urlsMock).not.toHaveBeenCalled();
  });

  it("пока список не прочитан, подписи не запрашиваются", async () => {
    render(<Probe files={[photo("f-a")]} enabled={false} />);

    await waitFor(() => expect(shown()).toBe(""));
    expect(urlsMock).not.toHaveBeenCalled();
  });

  it("повторный рендер с теми же файлами не подписывает их дважды", async () => {
    const files = [photo("f-a")];
    urlsMock.mockResolvedValue({ success: true, data: [signed("f-a", "https://signed.test/a")] });

    const { rerender } = render(<Probe files={files} />);
    await waitFor(() => expect(urlsMock).toHaveBeenCalledTimes(1));

    // Новый массив с теми же файлами: список меняет идентичность на каждую
    // оптимистичную правку, и это не повод подписывать заново.
    rerender(<Probe files={[...files]} />);
    await settle();

    expect(urlsMock).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Повтор                                                             */
/* ------------------------------------------------------------------ */

describe("useSignedThumbnails: повтор", () => {
  it("отказ подписи повторяется ровно один раз", async () => {
    urlsMock.mockResolvedValue({ success: false, error: "Не удалось подписать файлы" });

    render(<Probe files={[photo("f-a")]} />);

    await waitFor(() => expect(urlsMock).toHaveBeenCalledTimes(2));
    // Второй отказ повтора не порождает: цикл обрывается сам.
    await settle();
    expect(urlsMock).toHaveBeenCalledTimes(2);
    expect(shown()).toBe("");
  });

  it("протухшая миниатюра переподписывается один раз, потом остаётся иконкой", async () => {
    urlsMock
      .mockResolvedValueOnce({ success: true, data: [signed("f-a", "https://signed.test/1")] })
      .mockResolvedValue({ success: true, data: [signed("f-a", "https://signed.test/2")] });

    render(<Probe files={[photo("f-a")]} />);
    await waitFor(() => expect(shown()).toBe("f-a=https://signed.test/1"));

    // Ссылка протухла за время открытой модалки: одна повторная подпись.
    failThumb("f-a");
    await waitFor(() => expect(shown()).toBe("f-a=https://signed.test/2"));
    expect(urlsMock).toHaveBeenCalledTimes(2);

    // Вторая неудача — уже не повод: строка остаётся с иконкой вида.
    failThumb("f-a");
    await waitFor(() => expect(shown()).toBe(""));
    await settle();
    expect(urlsMock).toHaveBeenCalledTimes(2);
  });
});
