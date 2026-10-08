import { afterEach, describe, expect, it } from "vitest";

import {
  FILE_CATEGORY_OPTIONS,
  compareFileEntries,
  fileAuthorLabel,
  fileCategoryLabel,
  fileExtension,
  fileKindOf,
  fileMetaLine,
  formatFileDate,
  formatFileSize,
  isLeavingDropZone,
  placeFileEntry,
} from "./file-view";
import { SPEC_ITEM_FILE_CATEGORIES } from "./file-content";
import type { SpecItemFileEntry } from "./spec-item-files";

/**
 * Тесты отображения файла: размер, вид (иконка), дата, подпись строки.
 *
 * Проверяется только нетривиальная логика — то, где легко ошибиться: границы
 * единиц измерения, CAD против картинок (`image/vnd.dwg` формально `image/*`)
 * и запасное определение по расширению, когда MIME обобщённый.
 */

/* ------------------------------------------------------------------ */
/*  Размер                                                             */
/* ------------------------------------------------------------------ */

describe("formatFileSize", () => {
  it("байты", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1)).toBe("1 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("килобайты с одним знаком после точки", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10 * 1024)).toBe("10 KB");
    // 1023.9 KB округляется до 1024 KB и остаётся в KB: единица меняется
    // только на своей границе, а не «когда покажется большим».
    expect(formatFileSize(1048575)).toBe("1024 KB");
  });

  it("мегабайты с одним знаком после точки", () => {
    expect(formatFileSize(1048576)).toBe("1 MB");
    expect(formatFileSize(1.2 * 1048576)).toBe("1.2 MB");
    expect(formatFileSize(25 * 1048576)).toBe("25 MB");
  });

  it("не ломается на мусоре", () => {
    expect(formatFileSize(Number.NaN)).toBe("—");
    expect(formatFileSize(-5)).toBe("—");
  });
});

/* ------------------------------------------------------------------ */
/*  Расширение                                                         */
/* ------------------------------------------------------------------ */

describe("fileExtension", () => {
  it("берёт хвост имени в нижнем регистре", () => {
    expect(fileExtension("Счёт №1.PDF")).toBe("pdf");
    expect(fileExtension("plan.DWG")).toBe("dwg");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
    expect(fileExtension("noext")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
    expect(fileExtension("")).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  Вид файла (иконка)                                                 */
/* ------------------------------------------------------------------ */

describe("fileKindOf", () => {
  it("PDF", () => {
    expect(fileKindOf({ mimeType: "application/pdf", fileName: "счёт.pdf" })).toBe(
      "pdf",
    );
  });

  it("изображения", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "image/avif"]) {
      expect(fileKindOf({ mimeType: mime, fileName: "x" }), mime).toBe("image");
    }
  });

  it("архивы", () => {
    for (const mime of ["application/zip", "application/gzip", "application/x-7z-compressed"]) {
      expect(fileKindOf({ mimeType: mime, fileName: "x" }), mime).toBe("archive");
    }
  });

  it("CAD определяется раньше картинок: image/vnd.dwg — это чертёж", () => {
    expect(fileKindOf({ mimeType: "image/vnd.dwg", fileName: "plan.dwg" })).toBe(
      "cad",
    );
    expect(fileKindOf({ mimeType: "image/vnd.dxf", fileName: "plan.dxf" })).toBe(
      "cad",
    );
    expect(fileKindOf({ mimeType: "model/gltf-binary", fileName: "m.glb" })).toBe(
      "cad",
    );
  });

  it("обобщённый MIME доводится расширением", () => {
    // Браузеры отдают octet-stream для DWG, OBJ, SKP — иначе все они были бы
    // «прочими».
    expect(
      fileKindOf({ mimeType: "application/octet-stream", fileName: "plan.dwg" }),
    ).toBe("cad");
    expect(
      fileKindOf({ mimeType: "application/octet-stream", fileName: "model.obj" }),
    ).toBe("cad");
    expect(
      fileKindOf({ mimeType: "application/octet-stream", fileName: "архив.zip" }),
    ).toBe("archive");
    expect(
      fileKindOf({ mimeType: "application/octet-stream", fileName: "фото.JPG" }),
    ).toBe("image");
    expect(
      fileKindOf({ mimeType: "application/octet-stream", fileName: "счёт.pdf" }),
    ).toBe("pdf");
  });

  it("MIME с параметрами разбирается", () => {
    expect(
      fileKindOf({ mimeType: "application/pdf; charset=binary", fileName: "x" }),
    ).toBe("pdf");
  });

  it("прочее — generic", () => {
    expect(fileKindOf({ mimeType: "text/plain", fileName: "заметки.txt" })).toBe(
      "file",
    );
    expect(fileKindOf({ mimeType: "", fileName: "файл" })).toBe("file");
    expect(
      fileKindOf({
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileName: "смета.xlsx",
      }),
    ).toBe("file");
  });

  it("MIME против расширения: приоритет у типа содержимого", () => {
    // Файл переименован, но тип объявлен честно — верим MIME.
    expect(fileKindOf({ mimeType: "application/pdf", fileName: "photo.png" })).toBe(
      "pdf",
    );
    expect(fileKindOf({ mimeType: "image/png", fileName: "скан.pdf" })).toBe(
      "image",
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Дата                                                               */
/* ------------------------------------------------------------------ */

describe("formatFileDate", () => {
  it("форматирует дату в формате проекта", () => {
    // 6 октября 2026 — формат `fmtDate` («день месяц год», ru-RU).
    const formatted = formatFileDate("2026-10-06T09:30:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/октябр/);
  });

  it("мусорная дата даёт пустую строку, а не Invalid Date", () => {
    expect(formatFileDate("")).toBe("");
    expect(formatFileDate("не дата")).toBe("");
    expect(formatFileDate("2026-13-45T00:00:00Z")).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  Подпись строки                                                     */
/* ------------------------------------------------------------------ */

describe("fileMetaLine", () => {
  it("размер и дата", () => {
    const line = fileMetaLine({
      sizeBytes: 1.2 * 1048576,
      createdAt: "2026-10-06T09:30:00.000Z",
    });

    expect(line).toMatch(/^1\.2 MB · /);
    expect(line).toContain("2026");
    // Автора нет — лишних разделителей не появляется.
    expect(line).not.toContain("· ·");
  });

  it("автор встаёт между размером и датой", () => {
    const line = fileMetaLine({
      sizeBytes: 1024,
      createdAt: "2026-10-06T09:30:00.000Z",
      author: "Андрей",
    });

    expect(line).toMatch(/^1 KB · Андрей · /);
  });

  it("пустая дата не оставляет висящий разделитель", () => {
    const line = fileMetaLine({ sizeBytes: 512, createdAt: "мусор" });
    expect(line).toBe("512 B");
  });
});

/* ------------------------------------------------------------------ */
/*  Автор                                                              */
/* ------------------------------------------------------------------ */

describe("fileAuthorLabel", () => {
  const entry = (uploadedBy: string | null): SpecItemFileEntry => ({
    id: "1",
    fileName: "файл.pdf",
    mimeType: "application/pdf",
    sizeBytes: 10,
    category: "document",
    uploadedBy,
    createdAt: "2026-10-06T09:30:00.000Z",
  });

  it("uuid в подпись не попадает", () => {
    // Пока в модели только uuid, показывать его нельзя: подпись пустая.
    expect(
      fileAuthorLabel(entry("a0a3fc2f-4bc6-4088-ab7c-68b70acb1e3c")),
    ).toBeNull();
    expect(fileAuthorLabel(entry(null))).toBeNull();
  });

  it("модель с uuid не даёт имени автора", () => {
    // Инвариант на будущее: если поле имени появится в `fileMetaLine`, тест
    // `fileAuthorLabel` должен измениться вместе с моделью.
    expect(Object.keys(entry("x"))).not.toContain("uploadedByName");
  });
});

/* ------------------------------------------------------------------ */
/*  Область приёма файлов                                              */
/* ------------------------------------------------------------------ */

describe("isLeavingDropZone", () => {
  /** Настоящее дерево: зона → строка → имя файла. */
  const buildZone = () => {
    const zone = document.createElement("div");
    const row = document.createElement("div");
    const title = document.createElement("span");
    row.appendChild(title);
    zone.appendChild(row);
    document.body.appendChild(zone);
    return { zone, row, title };
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("уход на дочерний элемент — это не выход из зоны", () => {
    const { zone, row, title } = buildZone();

    expect(isLeavingDropZone(zone, row)).toBe(false);
    expect(isLeavingDropZone(zone, title)).toBe(false);
  });

  it("уход наружу — выход из зоны", () => {
    const { zone } = buildZone();
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    expect(isLeavingDropZone(zone, outside)).toBe(true);
    expect(isLeavingDropZone(zone, document.body)).toBe(true);
  });

  it("без relatedTarget считаем, что курсор ушёл", () => {
    // Иначе подсветка могла бы остаться навсегда: браузер не всегда сообщает,
    // куда именно ушёл курсор.
    const { zone } = buildZone();

    expect(isLeavingDropZone(zone, null)).toBe(true);
  });

  it("без зоны считаем, что курсор ушёл", () => {
    expect(isLeavingDropZone(null, document.body)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Категория                                                          */
/* ------------------------------------------------------------------ */

describe("fileCategoryLabel", () => {
  it("значения backend переводятся в подписи", () => {
    expect(fileCategoryLabel("document")).toBe("Документ");
    expect(fileCategoryLabel("texture")).toBe("Текстура");
    expect(fileCategoryLabel("other")).toBe("Другое");
  });

  it("таблица подписей покрывает все категории из кода", () => {
    // Расхождение означало бы категорию без подписи в UI.
    for (const category of SPEC_ITEM_FILE_CATEGORIES) {
      expect(fileCategoryLabel(category)).toBeTruthy();
    }
    expect(FILE_CATEGORY_OPTIONS.map((option) => option.value)).toEqual([
      ...SPEC_ITEM_FILE_CATEGORIES,
    ]);
  });

  it("значение вне списка не даёт пустой подписи", () => {
    // Так выглядела бы строка, записанная в БД в обход кода.
    expect(fileCategoryLabel("drawing" as never)).toBe("Другое");
  });
});

/* ------------------------------------------------------------------ */
/*  Порядок и вставка записи                                           */
/* ------------------------------------------------------------------ */

describe("placeFileEntry", () => {
  const file = (
    id: string,
    createdAt: string,
    fileName = `${id}.pdf`,
  ): SpecItemFileEntry => ({
    id,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: 10,
    category: "document",
    uploadedBy: null,
    createdAt,
  });

  it("новая запись встаёт по created_at DESC, а не в конец", () => {
    const list = [
      file("b", "2026-10-06T09:30:00.000Z"),
      file("c", "2026-01-01T09:30:00.000Z"),
    ];

    const placed = placeFileEntry(list, file("a", "2026-10-06T12:00:00.000Z"));

    expect(placed.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("при равном created_at порядок задаёт id DESC", () => {
    const same = "2026-10-06T09:30:00.000Z";
    const placed = placeFileEntry(
      [file("b", same), file("c", same)],
      file("a", same),
    );

    expect(placed.map((f) => f.id)).toEqual(["c", "b", "a"]);
  });

  it("повторная вставка той же записи не создаёт дубликат", () => {
    const list = [file("a", "2026-10-06T09:30:00.000Z")];

    const placed = placeFileEntry(list, file("a", "2026-10-06T09:30:00.000Z"));

    expect(placed).toHaveLength(1);
  });

  it("исходный массив не мутируется", () => {
    const list = [file("b", "2026-10-06T09:30:00.000Z")];
    const snapshot = [...list];

    placeFileEntry(list, file("a", "2026-10-06T12:00:00.000Z"));

    expect(list).toEqual(snapshot);
  });

  it("пустой список принимает запись", () => {
    const placed = placeFileEntry([], file("a", "2026-10-06T09:30:00.000Z"));
    expect(placed.map((f) => f.id)).toEqual(["a"]);
  });

  it("сравнение совпадает с серверным порядком", () => {
    // Тот же порядок, что отдаёт `listSpecItemFiles` (`created_at DESC, id DESC`).
    const list = [
      file("a", "2026-10-06T12:00:00.000Z"),
      file("b", "2026-10-06T09:30:00.000Z"),
      file("c", "2026-01-01T09:30:00.000Z"),
    ];

    expect([...list].sort(compareFileEntries).map((f) => f.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
