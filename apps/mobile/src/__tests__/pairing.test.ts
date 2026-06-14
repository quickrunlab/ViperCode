import { describe, expect, it } from "vite-plus/test";
import { parsePairingUrl, parsePairingHostAndCode } from "../pairing/parsePairingInput.ts";

describe("parsePairingUrl", () => {
  it("parses a direct pairing URL with hash token", () => {
    const result = parsePairingUrl("https://desktop.local:44342/pair#token=abc123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.credential).toBe("abc123");
      expect(result.target.httpBaseUrl).toContain("desktop.local");
      expect(result.target.wsBaseUrl).toContain("desktop.local");
    }
  });

  it("parses a direct pairing URL with query token", () => {
    const result = parsePairingUrl("https://desktop.local:44342/pair?token=xyz789");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.credential).toBe("xyz789");
    }
  });

  it("parses a hosted pairing URL", () => {
    const result = parsePairingUrl(
      "https://app.vipercode.app/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net%3A44342#token=hosted-token",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.credential).toBe("hosted-token");
      expect(result.target.httpBaseUrl).toContain("desktop.tailnet.ts.net");
    }
  });

  it("returns error for empty input", () => {
    const result = parsePairingUrl("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Enter");
    }
  });

  it("returns error for invalid URL", () => {
    const result = parsePairingUrl("not-a-url");
    expect(result.ok).toBe(false);
  });

  it("returns error for URL missing token", () => {
    const result = parsePairingUrl("https://desktop.local:44342/pair");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("token");
    }
  });
});

describe("parsePairingHostAndCode", () => {
  it("parses host and code", () => {
    const result = parsePairingHostAndCode("desktop.local:44342", "my-code");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.credential).toBe("my-code");
      expect(result.target.httpBaseUrl).toContain("desktop.local");
    }
  });

  it("returns error for empty host", () => {
    const result = parsePairingHostAndCode("", "code");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("backend URL");
    }
  });

  it("returns error for empty code", () => {
    const result = parsePairingHostAndCode("desktop.local", "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("pairing code");
    }
  });
});
