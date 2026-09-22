import { describe, expect, it } from "vitest";
import { isProbablyImportUrl } from "./url-input";

describe("isProbablyImportUrl", () => {
  it("принимает https-адрес страницы", () => {
    expect(isProbablyImportUrl("https://shop.example.com/product/1")).toBe(true);
  });

  it("принимает http: решение о нём остаётся за сервером", () => {
    expect(isProbablyImportUrl("http://shop.example.com/product/1")).toBe(true);
  });

  it("обрезает пробелы вокруг адреса", () => {
    expect(isProbablyImportUrl("  https://shop.example.com/p/1  ")).toBe(true);
  });

  it("отклоняет пустую строку и пробелы", () => {
    expect(isProbablyImportUrl("")).toBe(false);
    expect(isProbablyImportUrl("   ")).toBe(false);
  });

  it("отклоняет текст, который не является адресом", () => {
    expect(isProbablyImportUrl("керамогранит 1200х600")).toBe(false);
    expect(isProbablyImportUrl("shop.example.com/product/1")).toBe(false);
  });

  it("отклоняет не-веб схемы", () => {
    expect(isProbablyImportUrl("javascript:alert(1)")).toBe(false);
    expect(isProbablyImportUrl("file:///etc/passwd")).toBe(false);
    expect(isProbablyImportUrl("ftp://shop.example.com/p/1")).toBe(false);
  });
});
