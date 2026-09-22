import { describe, expect, it } from "vitest";
import { describeImportFailure } from "./failure-messages";
import type { FetchFailureCode } from "./fetch";
import { parseImportUrl } from "./guards";

const ALL_CODES: FetchFailureCode[] = [
  "INVALID_URL",
  "UNSUPPORTED_PROTOCOL",
  "UNSUPPORTED_PORT",
  "CREDENTIALS_NOT_ALLOWED",
  "HOST_NOT_ALLOWED",
  "PRIVATE_ADDRESS",
  "DNS_RESOLUTION_FAILED",
  "NETWORK_ERROR",
  "FETCH_TIMEOUT",
  "TOO_MANY_REDIRECTS",
  "REDIRECT_WITHOUT_LOCATION",
  "HTTP_ERROR",
  "UNSUPPORTED_CONTENT_TYPE",
  "EMPTY_RESPONSE",
];

describe("describeImportFailure", () => {
  it("объясняет каждый код отказа", () => {
    for (const code of ALL_CODES) {
      const described = describeImportFailure(code);
      expect(described.message.length, code).toBeGreaterThan(10);
      expect(described.hint.length, code).toBeGreaterThan(10);
    }
  });

  it("не показывает пользователю технические коды", () => {
    for (const code of ALL_CODES) {
      const described = describeImportFailure(code);
      const text = `${described.message} ${described.hint}`;
      expect(text, code).not.toContain(code);
      expect(text, code).not.toMatch(/[a-z_]+-[a-z_]+-\d/);
    }
  });

  it("уточняет подсказку по HTTP-статусу", () => {
    expect(describeImportFailure("HTTP_ERROR", 404).hint).toContain("снят с продажи");
    expect(describeImportFailure("HTTP_ERROR", 403).hint).toContain("запретил");
    expect(describeImportFailure("HTTP_ERROR", 429).hint).toContain("частоту");
    expect(describeImportFailure("HTTP_ERROR", 503).hint).toContain("временно");
  });

  it("возвращает общую подсказку для неизвестного статуса", () => {
    const described = describeImportFailure("HTTP_ERROR", 418);
    expect(described.message).toContain("недоступна");
    expect(described.hint).toContain("Проверьте ссылку");
  });

  it("не подменяет подсказку для кодов, кроме HTTP_ERROR", () => {
    // Статус есть, но код другой — уточнение по статусу применяться не должно.
    const described = describeImportFailure("FETCH_TIMEOUT", 404);
    expect(described.hint).toContain("Попробуйте ещё раз");
  });

  it("предлагает ручной ввод, когда автоматика бессильна", () => {
    expect(describeImportFailure("FETCH_TIMEOUT").hint).toContain("вручную");
    expect(describeImportFailure("EMPTY_RESPONSE").hint).toContain("ссылку");
  });

  /**
   * `RESPONSE_TOO_LARGE` больше не код отказа: слишком большая страница
   * разбирается по первым байтам, а не отбрасывается. Проверяем, что
   * пользовательского текста про «слишком большая» в отказах не осталось.
   */
  it("не обещает пользователю отказа из-за размера страницы", () => {
    for (const code of ALL_CODES) {
      const text = `${describeImportFailure(code).message} ${describeImportFailure(code).hint}`;
      expect(text, code).not.toContain("слишком большая");
      expect(text, code).not.toContain("RESPONSE_TOO_LARGE");
    }
  });
});

describe("согласованность кодов и сообщений", () => {
  it("каждый код отказа из guards имеет текст", () => {
    // Коды, которые может вернуть политика адресов, обязаны быть покрыты.
    const fromGuards = [
      parseImportUrl(""),
      parseImportUrl("ftp://example.com"),
      parseImportUrl("https://user:pass@example.com"),
      parseImportUrl("https://127.0.0.1"),
      parseImportUrl("https://localhost"),
      parseImportUrl("https://example.com:6379"),
    ];

    for (const result of fromGuards) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      const described = describeImportFailure(result.code);
      expect(described.message.length, result.code).toBeGreaterThan(10);
      expect(ALL_CODES, result.code).toContain(result.code);
    }
  });
});
