import { describe, expect, it } from "vitest";
import {
  baseContentType,
  evaluateHostPolicy,
  formatIpv4,
  isBlockedIp,
  isExtractableContentType,
  parseImportUrl,
  parseIpLiteral,
} from "./guards";

describe("parseImportUrl", () => {
  it("принимает https и отдаёт канонический href", () => {
    const res = parseImportUrl("https://Example.COM/product/1?x=2");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.href).toBe("https://example.com/product/1?x=2");
    expect(res.hostname).toBe("example.com");
  });

  it("принимает http только по явному разрешению", () => {
    expect(parseImportUrl("http://example.com").ok).toBe(false);

    const allowed = parseImportUrl("http://example.com", { allowHttp: true });
    expect(allowed.ok).toBe(true);
  });

  it("отклоняет не-http схемы", () => {
    for (const raw of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://example.com/x",
      "data:text/html,<h1>hi</h1>",
      "gopher://example.com",
    ]) {
      const res = parseImportUrl(raw);
      expect(res.ok, raw).toBe(false);
      if (!res.ok) expect(res.code, raw).toBe("UNSUPPORTED_PROTOCOL");
    }
  });

  it("отклоняет мусор и пустой ввод", () => {
    for (const raw of ["", "   ", "not a url", "example.com", "//example.com"]) {
      const res = parseImportUrl(raw);
      expect(res.ok, JSON.stringify(raw)).toBe(false);
      if (!res.ok) expect(res.code).toBe("INVALID_URL");
    }
  });

  it("отклоняет слишком длинный URL", () => {
    const res = parseImportUrl(`https://example.com/${"a".repeat(4096)}`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_URL");
  });

  it("отклоняет localhost и его поддомены", () => {
    for (const raw of [
      "http://localhost",
      "https://localhost:3000/x",
      "https://foo.localhost",
    ]) {
      const res = parseImportUrl(raw, { allowHttp: true });
      expect(res.ok, raw).toBe(false);
      if (!res.ok) expect(res.code, raw).toBe("HOST_NOT_ALLOWED");
    }
  });

  it("отклоняет приватные, loopback и link-local адреса", () => {
    const blocked = [
      "https://127.0.0.1/",
      "https://127.1/",
      "https://10.0.0.5/",
      "https://172.16.5.4/",
      "https://172.31.255.1/",
      "https://192.168.1.1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://0.0.0.0/",
      "https://[::1]/",
      "https://[::]/",
      "https://[fe80::1]/",
      "https://[fd00::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:169.254.169.254]/",
    ];
    for (const raw of blocked) {
      const res = parseImportUrl(raw);
      expect(res.ok, raw).toBe(false);
      if (!res.ok) expect(res.code, raw).toBe("PRIVATE_ADDRESS");
    }
  });

  it("распознаёт IPv4-обфускацию через нормализацию URL", () => {
    // new URL() приводит decimal/octal/hex/short-формы к каноническому IPv4.
    for (const raw of [
      "https://0177.0.0.1/",
      "https://2130706433/",
      "https://0x7f.1/",
      "https://0x7f000001/",
    ]) {
      const res = parseImportUrl(raw);
      expect(res.ok, raw).toBe(false);
      if (!res.ok) expect(res.code, raw).toBe("PRIVATE_ADDRESS");
    }
  });

  it("разрешает публичные адреса и IPv6", () => {
    for (const raw of [
      "https://93.184.216.34/",
      "https://8.8.8.8/",
      "https://[2606:4700::1111]/",
    ]) {
      expect(parseImportUrl(raw).ok, raw).toBe(true);
    }
  });

  it("отклоняет учётные данные в URL", () => {
    const res = parseImportUrl("https://user:pass@example.com/p");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CREDENTIALS_NOT_ALLOWED");
  });

  it("отклоняет опасные порты", () => {
    for (const raw of ["https://example.com:6379/", "https://example.com:22/"]) {
      const res = parseImportUrl(raw);
      expect(res.ok, raw).toBe(false);
      if (!res.ok) expect(res.code, raw).toBe("UNSUPPORTED_PORT");
    }
  });

  it("разрешает нестандартный, но безобидный порт", () => {
    expect(parseImportUrl("https://example.com:8443/p").ok).toBe(true);
  });

  it("не обманывается путём, похожим на адрес", () => {
    // Хост здесь example.com, а 127.0.0.1 — часть пути.
    const res = parseImportUrl("https://example.com/@127.0.0.1");
    expect(res.ok).toBe(true);

    const tricky = parseImportUrl("https://example.com\\@127.0.0.1/");
    expect(tricky.ok).toBe(true);
    if (tricky.ok) expect(tricky.hostname).toBe("example.com");
  });
});

describe("evaluateHostPolicy", () => {
  it("пропускает публичный https", () => {
    expect(evaluateHostPolicy(new URL("https://example.com/x")).ok).toBe(true);
  });

  it("блокирует приватный адрес на редиректе", () => {
    const res = evaluateHostPolicy(new URL("http://169.254.169.254/"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PRIVATE_ADDRESS");
  });

  it("блокирует не-http схемы", () => {
    const res = evaluateHostPolicy(new URL("ftp://example.com/"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNSUPPORTED_PROTOCOL");
  });
});

describe("parseIpLiteral / isBlockedIp", () => {
  it("разбирает IPv4", () => {
    expect(parseIpLiteral("1.2.3.4")).toEqual({
      kind: "ipv4",
      bytes: [1, 2, 3, 4],
    });
    expect(parseIpLiteral("256.1.1.1")).toBeNull();
    expect(parseIpLiteral("1.2.3")).toBeNull();
  });

  it("разбирает IPv6, включая сжатую форму и зону", () => {
    expect(parseIpLiteral("::1")?.kind).toBe("ipv6");
    expect(parseIpLiteral("2001:db8::1")?.kind).toBe("ipv6");
    expect(parseIpLiteral("fe80::1%eth0")?.kind).toBe("ipv6");
    expect(parseIpLiteral("example.com")).toBeNull();
    expect(parseIpLiteral("2001:db8::1::2")).toBeNull();
  });

  it("классифицирует диапазоны", () => {
    const blocked = [
      "0.1.2.3",
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.0.1",
      "192.168.0.1",
      "198.51.100.5",
      "203.0.113.9",
      "224.0.0.1",
      "255.255.255.255",
    ];
    for (const raw of blocked) {
      const ip = parseIpLiteral(raw);
      expect(ip, raw).not.toBeNull();
      expect(isBlockedIp(ip!), raw).toBe(true);
    }

    const allowed = ["8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.0.1"];
    for (const raw of allowed) {
      const ip = parseIpLiteral(raw);
      expect(isBlockedIp(ip!), raw).toBe(false);
    }
  });

  it("форматирует IPv4", () => {
    expect(formatIpv4(new Uint8Array([93, 184, 216, 34]))).toBe(
      "93.184.216.34",
    );
  });
});

describe("content types", () => {
  it("отбрасывает параметры", () => {
    expect(baseContentType("text/html; charset=utf-8")).toBe("text/html");
    expect(baseContentType(null)).toBeNull();
  });

  it("разрешает html и отсутствующий заголовок", () => {
    expect(isExtractableContentType("text/html; charset=UTF-8")).toBe(true);
    expect(isExtractableContentType("application/xhtml+xml")).toBe(true);
    expect(isExtractableContentType(null)).toBe(true);
  });

  it("запрещает не-HTML", () => {
    for (const ct of [
      "application/json",
      "application/pdf",
      "image/png",
      "application/octet-stream",
      "text/plain",
    ]) {
      expect(isExtractableContentType(ct), ct).toBe(false);
    }
  });
});
