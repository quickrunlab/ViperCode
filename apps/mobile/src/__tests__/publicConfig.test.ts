import { describe, expect, it } from "vite-plus/test";
import { hasMobilePublicConfig, type MobilePublicConfig } from "../runtime/publicConfig.ts";

describe("resolveMobilePublicConfig", () => {
  it("detects complete config", () => {
    const config: MobilePublicConfig = {
      clerkPublishableKey: "pk_test_abc",
      clerkJwtTemplate: "relay",
      relayUrl: "https://relay.example.com",
    };
    expect(hasMobilePublicConfig(config)).toBe(true);
  });

  it("detects missing clerk key", () => {
    const config: MobilePublicConfig = {
      clerkPublishableKey: undefined,
      clerkJwtTemplate: "relay",
      relayUrl: "https://relay.example.com",
    };
    expect(hasMobilePublicConfig(config)).toBe(false);
  });

  it("allows missing relay url", () => {
    const config: MobilePublicConfig = {
      clerkPublishableKey: "pk_test_abc",
      clerkJwtTemplate: "relay",
      relayUrl: undefined,
    };
    expect(hasMobilePublicConfig(config)).toBe(true);
  });

  it("detects missing jwt template", () => {
    const config: MobilePublicConfig = {
      clerkPublishableKey: "pk_test_abc",
      clerkJwtTemplate: undefined,
      relayUrl: "https://relay.example.com",
    };
    expect(hasMobilePublicConfig(config)).toBe(false);
  });

  it("detects empty config", () => {
    const config: MobilePublicConfig = {
      clerkPublishableKey: undefined,
      clerkJwtTemplate: undefined,
      relayUrl: undefined,
    };
    expect(hasMobilePublicConfig(config)).toBe(false);
  });
});
