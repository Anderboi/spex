import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_SPEC_ITEM_FILE_BYTES,
  MAX_SPEC_ITEM_FILE_NAME_LENGTH,
  SPEC_ITEM_FILE_CATEGORIES,
  SPEC_ITEM_FILE_MIME_TYPES,
  buildSpecItemFilePath,
  checkDeclaredMimeMatchesContent,
  extensionForMime,
  extensionOfFileName,
  isAllowedSpecItemFileMime,
  isSpecItemFilePathExpected,
  isSpecItemFileCategory,
  normalizeFileName,
  normalizeMimeType,
  specItemFilePathPrefix,
} from "./file-content";

/**
 * Тесты правил файла: категории, MIME, сигнатура содержимого, имя и путь.
 *
 * Здесь нет ни БД, ни Storage — только чистые функции. Это позволяет проверить
 * ровно то, что нельзя доверять клиенту, без подставных клиентов.
 */

/* ------------------------------------------------------------------ */
/*  Синхронизация со схемой                                            */
/* ------------------------------------------------------------------ */

describe("константы синхронизированы с миграцией", () => {
  const migration = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../supabase/migrations/20260927_001_add_spec_item_files.sql",
    ),
    "utf8",
  );

  it("список категорий совпадает с CHECK-констрейнтом", () => {
    // Расхождение означало бы: код разрешает значение, которое БД отвергнет.
    for (const category of SPEC_ITEM_FILE_CATEGORIES) {
      expect(migration).toContain(`'${category}'`);
    }
    expect(migration).toContain("check (category in (");
  });

  it("bucket совпадает с именем в миграции", () => {
    expect(migration).toContain("'spec-item-files'");
  });

  it("лимит размера в миграции совпадает с кодом", () => {
    // 25 МиБ = 26214400
    expect(migration).toContain(String(MAX_SPEC_ITEM_FILE_BYTES));
  });

  it("каждый MIME из кода присутствует в allowed_mime_types bucket'а", () => {
    for (const mime of Object.keys(SPEC_ITEM_FILE_MIME_TYPES)) {
      expect(migration, mime).toContain(`'${mime}'`);
    }
  });

  it("SVG не разрешён — это XML со скриптами", () => {
    expect(isAllowedSpecItemFileMime("image/svg+xml")).toBe(false);
    expect(migration).not.toContain("'image/svg+xml'");
  });
});

/* ------------------------------------------------------------------ */
/*  Категории                                                          */
/* ------------------------------------------------------------------ */

describe("категории", () => {
  it("известные значения проходят", () => {
    for (const category of SPEC_ITEM_FILE_CATEGORIES) {
      expect(isSpecItemFileCategory(category)).toBe(true);
    }
  });

  it("legacy-категории FILE_CATS не принимаются", () => {
    // Старый набор («Схемы», «Текстуры», …) — ключи формы, а не значения схемы.
    for (const legacy of ["schemas", "textures", "care", "cad", "", "FILE"]) {
      expect(isSpecItemFileCategory(legacy)).toBe(false);
    }
    expect(isSpecItemFileCategory(null)).toBe(false);
    expect(isSpecItemFileCategory(42)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  MIME                                                               */
/* ------------------------------------------------------------------ */

describe("нормализация MIME", () => {
  it("регистр и параметры приводятся к каноническому виду", () => {
    expect(normalizeMimeType("Application/PDF")).toBe("application/pdf");
    expect(normalizeMimeType("text/plain; charset=utf-8")).toBe("text/plain");
    expect(normalizeMimeType("  image/PNG  ")).toBe("image/png");
  });

  it("пустое значение становится octet-stream", () => {
    expect(normalizeMimeType("")).toBe("application/octet-stream");
    expect(normalizeMimeType(null)).toBe("application/octet-stream");
    expect(normalizeMimeType(undefined)).toBe("application/octet-stream");
  });
});

describe("allow-list MIME", () => {
  it("документы и CAD разрешены", () => {
    for (const mime of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
      "image/vnd.dwg",
    ]) {
      expect(isAllowedSpecItemFileMime(mime)).toBe(true);
    }
  });

  it("исполняемые и разметочные типы запрещены", () => {
    for (const mime of [
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "application/javascript",
      "application/x-msdownload",
      "application/x-sh",
      "",
    ]) {
      expect(isAllowedSpecItemFileMime(mime), mime).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Сигнатура содержимого                                              */
/* ------------------------------------------------------------------ */

const encode = (value: string) => new TextEncoder().encode(value);

/** Байты, которых хватает на определение формата. */
const BYTES = {
  pdf: encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj"),
  png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  jpeg: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  zip: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00]),
  html: encode("<html><body>hi</body></html>"),
  svg: encode('<?xml version="1.0"?><svg onload="alert(1)"></svg>'),
  svgWithBom: Uint8Array.from([0xef, 0xbb, 0xbf, ...encode("<svg></svg>")]),
  /** Бинарь без известной сигнатуры — так приходит DWG/SKP/OBJ. */
  unknownBinary: Uint8Array.from([0x41, 0x43, 0x31, 0x30, 0x31, 0x35, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
};

describe("проверка содержимого", () => {
  it("PDF с объявленным application/pdf принимается", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "application/pdf",
        fileName: "schet.pdf",
        bytes: BYTES.pdf,
      }),
    ).toBeNull();
  });

  it("HTML под видом PDF отклоняется", () => {
    const reason = checkDeclaredMimeMatchesContent({
      declaredMime: "application/pdf",
      fileName: "schet.pdf",
      bytes: BYTES.html,
    });
    expect(reason).not.toBeNull();
  });

  it("исполняемый файл, переименованный в PDF, отклоняется", () => {
    // "MZ" — DOS/PE-заголовок: расширение .pdf ничего не доказывает.
    const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "application/pdf",
        fileName: "schet.pdf",
        bytes: exe,
      }),
    ).not.toBeNull();
  });

  it("SVG отклоняется даже с объявленным image/png", () => {
    const reason = checkDeclaredMimeMatchesContent({
      declaredMime: "image/png",
      fileName: "texture.png",
      bytes: BYTES.svg,
    });
    expect(reason).not.toBeNull();
  });

  it("SVG с BOM тоже отклоняется", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "image/png",
        fileName: "texture.png",
        bytes: BYTES.svgWithBom,
      }),
    ).not.toBeNull();
  });

  it("PNG с объявленным image/jpeg отклоняется", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "image/jpeg",
        fileName: "photo.jpg",
        bytes: BYTES.png,
      }),
    ).not.toBeNull();
  });

  it("JPEG с объявленным image/jpeg принимается", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "image/jpeg",
        fileName: "photo.jpg",
        bytes: BYTES.jpeg,
      }),
    ).toBeNull();
  });

  it("docx (zip-контейнер) принимается по семейству", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: "dogovor.docx",
        bytes: BYTES.zip,
      }),
    ).toBeNull();
  });

  it("xlsx (zip-контейнер) принимается по семейству", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileName: "smeta.xlsx",
        bytes: BYTES.zip,
      }),
    ).toBeNull();
  });

  it("zip под видом pdf отклоняется", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "application/pdf",
        fileName: "schet.pdf",
        bytes: BYTES.zip,
      }),
    ).not.toBeNull();
  });

  it("CAD без сигнатуры проходит, если расширение согласовано", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "image/vnd.dwg",
        fileName: "plan.dwg",
        bytes: BYTES.unknownBinary,
      }),
    ).toBeNull();
  });

  it("CAD без сигнатуры отклоняется, если расширение противоречит типу", () => {
    // Объявлен DWG, а имя — .pdf: расширение не доказывает тип, но обязано
    // хотя бы не противоречить ему.
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "image/vnd.dwg",
        fileName: "plan.pdf",
        bytes: BYTES.unknownBinary,
      }),
    ).not.toBeNull();
  });

  it("исполняемые файлы отклоняются по сигнатуре, а не по расширению", () => {
    const executable = (bytes: number[], fileName: string) =>
      checkDeclaredMimeMatchesContent({
        // Даже с честно объявленным octet-stream: решает содержимое.
        declaredMime: "application/octet-stream",
        fileName,
        bytes: Uint8Array.from([...bytes, ...new Array(16).fill(0)]),
      });

    // PE / DOS
    expect(executable([0x4d, 0x5a, 0x90, 0x00], "schet.pdf")).not.toBeNull();
    // ELF
    expect(executable([0x7f, 0x45, 0x4c, 0x46], "plan.dwg")).not.toBeNull();
    // Mach-O
    expect(executable([0xcf, 0xfa, 0xed, 0xfe], "model.bin")).not.toBeNull();
  });

  it("обычный бинарь CAD не считается исполняемым", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "image/vnd.dwg",
        fileName: "plan.dwg",
        bytes: BYTES.unknownBinary,
      }),
    ).toBeNull();
  });

  it("octet-stream без расширения проходит: это законный случай браузера", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "application/octet-stream",
        fileName: "model",
        bytes: BYTES.unknownBinary,
      }),
    ).toBeNull();
  });

  it("слишком короткий файл не опознаётся и не считается опасным", () => {
    expect(
      checkDeclaredMimeMatchesContent({
        declaredMime: "application/octet-stream",
        fileName: "x.bin",
        bytes: Uint8Array.from([0x01, 0x02]),
      }),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Имя файла                                                          */
/* ------------------------------------------------------------------ */

describe("нормализация оригинального имени", () => {
  it("обычное имя не меняется", () => {
    expect(normalizeFileName("Счёт №1.pdf")).toBe("Счёт №1.pdf");
  });

  it("Unicode не транслитерируется", () => {
    expect(normalizeFileName("КП_Tikkurila_2026.xlsx")).toBe(
      "КП_Tikkurila_2026.xlsx",
    );
    expect(normalizeFileName("файл-测试.pdf")).toBe("файл-测试.pdf");
  });

  it("путь Windows и POSIX отбрасывается", () => {
    expect(normalizeFileName("C:\\Users\\me\\schet.pdf")).toBe("schet.pdf");
    expect(normalizeFileName("../../etc/passwd")).toBe("passwd");
    expect(normalizeFileName("/tmp/a/b/plan.dwg")).toBe("plan.dwg");
  });

  it("управляющие символы и переводы строк удаляются", () => {
    expect(normalizeFileName("schet\r\n.pdf")).toBe("schet.pdf");
    expect(normalizeFileName("a\u0000b.pdf")).toBe("ab.pdf");
  });

  it("ведущие точки убираются", () => {
    expect(normalizeFileName("..hidden.pdf")).toBe("hidden.pdf");
    expect(normalizeFileName(".env")).toBe("env");
  });

  it("пустое и мусорное имя даёт пустую строку", () => {
    expect(normalizeFileName("")).toBe("");
    expect(normalizeFileName("   ")).toBe("");
    expect(normalizeFileName(null)).toBe("");
    expect(normalizeFileName(undefined)).toBe("");
    expect(normalizeFileName(42)).toBe("");
    expect(normalizeFileName("...")).toBe("");
  });

  it("длинное имя обрезается, расширение сохраняется", () => {
    const long = `${"a".repeat(400)}.pdf`;
    const result = normalizeFileName(long);

    expect(result.length).toBeLessThanOrEqual(MAX_SPEC_ITEM_FILE_NAME_LENGTH);
    expect(result.endsWith(".pdf")).toBe(true);
  });

  it("расширение читается безопасно", () => {
    expect(extensionOfFileName("plan.DWG")).toBe("dwg");
    expect(extensionOfFileName("archive.tar.gz")).toBe("gz");
    expect(extensionOfFileName("noext")).toBeNull();
    expect(extensionOfFileName("trailing.")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Путь объекта                                                       */
/* ------------------------------------------------------------------ */

describe("путь объекта", () => {
  const orgId = "4f2c1b7e-1111-4222-8333-444455556666";
  const itemId = "9a8b7c6d-0000-4111-8222-333344445555";
  const fileId = "11112222-3333-4444-8555-666677778888";

  it("путь собирается по конвенции проекта", () => {
    expect(
      buildSpecItemFilePath({
        orgId,
        specItemId: itemId,
        extension: "pdf",
        fileId,
      }),
    ).toBe(`${orgId}/spec-items/${itemId}/${fileId}.pdf`);
  });

  it("имя файла в путь не попадает — там только UUID", () => {
    const withName = buildSpecItemFilePath({
      orgId,
      specItemId: itemId,
      extension: "pdf",
      fileId,
    });
    expect(withName).not.toContain("Счёт");
    expect(withName).not.toContain(".pdf.pdf");
  });

  it("префикс позиции распознаёт свой путь", () => {
    const storagePath = `${orgId}/spec-items/${itemId}/${fileId}.pdf`;
    expect(specItemFilePathPrefix(orgId, itemId)).toBe(
      `${orgId}/spec-items/${itemId}/`,
    );
    expect(
      isSpecItemFilePathExpected({ storagePath, orgId, specItemId: itemId }),
    ).toBe(true);
  });

  it("путь другой позиции отвергается", () => {
    const otherItem = "aaaa1111-2222-4333-8444-555566667777";
    const storagePath = `${orgId}/spec-items/${otherItem}/${fileId}.pdf`;
    expect(
      isSpecItemFilePathExpected({ storagePath, orgId, specItemId: itemId }),
    ).toBe(false);
  });

  it("путь другой организации отвергается", () => {
    const otherOrg = "aaaa1111-2222-4333-8444-555566667777";
    const storagePath = `${otherOrg}/spec-items/${itemId}/${fileId}.pdf`;
    expect(
      isSpecItemFilePathExpected({ storagePath, orgId, specItemId: itemId }),
    ).toBe(false);
  });

  it("чужой bucket и вложенные сегменты не проходят", () => {
    for (const storagePath of [
      `${orgId}/material-images/${fileId}.pdf`,
      `${orgId}/spec-items/${itemId}/nested/${fileId}.pdf`,
      `${orgId}/spec-itemsx/${itemId}/${fileId}.pdf`,
      `x${orgId}/spec-items/${itemId}/${fileId}.pdf`,
      `${fileId}.pdf`,
      "",
    ]) {
      expect(
        isSpecItemFilePathExpected({ storagePath, orgId, specItemId: itemId }),
        storagePath,
      ).toBe(false);
    }
  });

  it("префикс без имени файла не проходит", () => {
    for (const storagePath of [
      `${orgId}/spec-items/${itemId}/`,
      `${orgId}/spec-items/${itemId}`,
    ]) {
      expect(
        isSpecItemFilePathExpected({ storagePath, orgId, specItemId: itemId }),
        storagePath,
      ).toBe(false);
    }
  });

  it("выход из папки и подстановки в имени файла не проходят", () => {
    for (const name of [
      "..",
      ".",
      "../../../etc/passwd",
      "%2e%2e%2fsecret.pdf",
      "a b.pdf",
      "файл.pdf",
      "evil.pdf?x=1",
      "evil.pdf#frag",
      "sub\\file.pdf",
    ]) {
      const storagePath = `${orgId}/spec-items/${itemId}/${name}`;
      expect(
        isSpecItemFilePathExpected({ storagePath, orgId, specItemId: itemId }),
        storagePath,
      ).toBe(false);
    }
  });

  it("нормальное имя объекта из UUID проходит", () => {
    for (const name of [`${fileId}.pdf`, `${fileId}.bin`, `${fileId}.xlsx`]) {
      expect(
        isSpecItemFilePathExpected({
          storagePath: `${orgId}/spec-items/${itemId}/${name}`,
          orgId,
          specItemId: itemId,
        }),
        name,
      ).toBe(true);
    }
  });

  it("расширение берётся из подтверждённого MIME, неизвестный — bin", () => {
    expect(extensionForMime("application/pdf")).toBe("pdf");
    expect(extensionForMime(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )).toBe("xlsx");
    expect(extensionForMime("application/octet-stream")).toBe("bin");
    expect(extensionForMime("что-то/неизвестное")).toBe("bin");
  });
});
