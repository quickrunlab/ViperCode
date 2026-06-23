import { describe, expect, it } from "vite-plus/test";

import {
  ANTIGRAVITY_BRIDGE_PROTOCOL_VERSION,
  encodeBridgeRequestLine,
  parseBridgeEventLine,
  redactBridgePayload,
  type BridgeRequest,
} from "./antigravityBridgeProtocol.ts";

describe("antigravity bridge framing", () => {
  it("encodes a request as a single newline-terminated JSON line", () => {
    const request: BridgeRequest = {
      id: "req-1",
      type: "start_session",
      sessionId: "s1",
      cwd: "/work",
    };
    const line = encodeBridgeRequestLine(request);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.includes("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);
    expect(JSON.parse(line)).toEqual(request);
  });

  it("escapes embedded newlines so NDJSON stays one-object-per-line", () => {
    const request: BridgeRequest = {
      id: "req-2",
      type: "send_turn",
      sessionId: "s1",
      turnId: "t1",
      text: "line one\nline two\nline three",
    };
    const line = encodeBridgeRequestLine(request);
    // Exactly one physical newline: the frame terminator.
    expect(line.split("\n").length).toBe(2);
    expect(JSON.parse(line).text).toBe("line one\nline two\nline three");
  });

  it("round-trips a valid event line into a typed event", () => {
    const line = JSON.stringify({
      type: "text_delta",
      sessionId: "s1",
      turnId: "t1",
      text: "hello",
    });
    const parsed = parseBridgeEventLine(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.event.type === "text_delta") {
      expect(parsed.event.text).toBe("hello");
      expect(parsed.event.sessionId).toBe("s1");
    }
  });

  it("decodes a response event with an error payload", () => {
    const line = JSON.stringify({
      type: "response",
      id: "req-9",
      ok: false,
      error: { message: "missing package", code: "not_installed" },
    });
    const parsed = parseBridgeEventLine(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.event.type === "response") {
      expect(parsed.event.ok).toBe(false);
      expect(parsed.event.error?.code).toBe("not_installed");
    }
  });

  it("decodes user-input resolution events emitted by the bridge", () => {
    const line = JSON.stringify({
      type: "user_input_resolved",
      sessionId: "s1",
      requestId: "input-1",
      answers: { q1: "yes" },
    });
    const parsed = parseBridgeEventLine(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.event.type === "user_input_resolved") {
      expect(parsed.event.answers).toEqual({ q1: "yes" });
    }
  });

  it("rejects blank, malformed, and schema-invalid lines without throwing", () => {
    expect(parseBridgeEventLine("").ok).toBe(false);
    expect(parseBridgeEventLine("   ").ok).toBe(false);
    expect(parseBridgeEventLine("{not json").ok).toBe(false);
    // Unknown event type fails the union.
    expect(parseBridgeEventLine(JSON.stringify({ type: "nope" })).ok).toBe(false);
    // Missing required field.
    expect(parseBridgeEventLine(JSON.stringify({ type: "text_delta", sessionId: "s1" })).ok).toBe(
      false,
    );
  });

  it("exposes a stable protocol version", () => {
    expect(ANTIGRAVITY_BRIDGE_PROTOCOL_VERSION).toBe(1);
  });
});

describe("redactBridgePayload", () => {
  it("redacts sensitive keys while preserving structure", () => {
    const redacted = redactBridgePayload({
      sessionId: "s1",
      auth: { email: "user@example.com", token: "secret-token", status: "ok" },
      usage: { inputTokens: 12, outputTokens: 34 },
      nested: [{ password: "hunter2", note: "keep" }],
    }) as Record<string, any>;

    expect(redacted.sessionId).toBe("s1"); // correlation handle, not a secret
    expect(redacted.auth.email).toBe("[redacted]");
    expect(redacted.auth.token).toBe("[redacted]");
    expect(redacted.auth.status).toBe("ok"); // not credential-bearing
    expect(redacted.usage.inputTokens).toBe(12);
    expect(redacted.nested[0].password).toBe("[redacted]");
    expect(redacted.nested[0].note).toBe("keep");
  });

  it("passes primitives and arrays through untouched", () => {
    expect(redactBridgePayload(42)).toBe(42);
    expect(redactBridgePayload("plain")).toBe("plain");
    expect(redactBridgePayload([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
