import { describe, expect, it } from "vite-plus/test";

import {
  clerkFrontendApiHostnameFromPublishableKey,
  isAllowedClerkFrontendApiHostname,
} from "./relayAuth.ts";

const clerkPublishableKey = (hostname: string): string => `pk_test_${btoa(`${hostname}$`)}`;

describe("Clerk relay auth", () => {
  it("derives a custom Frontend API hostname from a Clerk publishable key", () => {
    expect(
      clerkFrontendApiHostnameFromPublishableKey(clerkPublishableKey("clerk.vipercode.app")),
    ).toBe("clerk.vipercode.app");
  });

  it("allows standard Clerk hosts and an exact configured custom hostname", () => {
    expect(isAllowedClerkFrontendApiHostname("example.clerk.accounts.dev", null)).toBe(true);
    expect(isAllowedClerkFrontendApiHostname("example.clerk.accounts.com", null)).toBe(true);
    expect(isAllowedClerkFrontendApiHostname("clerk.vipercode.app", "clerk.vipercode.app")).toBe(
      true,
    );
    expect(isAllowedClerkFrontendApiHostname("attacker.example", "clerk.vipercode.app")).toBe(
      false,
    );
    expect(
      isAllowedClerkFrontendApiHostname("nested.clerk.vipercode.app", "clerk.vipercode.app"),
    ).toBe(false);
  });
});
