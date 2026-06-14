import { useAuth } from "@clerk/clerk-expo";
import { createManagedRelaySession, setManagedRelaySession } from "@vipercode/client-runtime";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { resolveMobilePublicConfig } from "../runtime/resolveConfig.ts";
import { appAtomRegistry } from "../runtime/atomRegistry.ts";

let relayTokenProvider: (() => Promise<string | null>) | null = null;

export async function readManagedRelayClerkToken(): Promise<string | null> {
  return relayTokenProvider?.() ?? null;
}

export function ManagedRelayAuthProvider({ children }: { readonly children: ReactNode }) {
  const { getToken, isSignedIn, userId } = useAuth();

  useEffect(() => {
    const template = resolveMobilePublicConfig().clerkJwtTemplate;
    relayTokenProvider = isSignedIn && template ? () => getToken({ template }) : null;

    setManagedRelaySession(
      appAtomRegistry,
      isSignedIn && userId
        ? createManagedRelaySession({
            accountId: userId,
            readClerkToken: () => (template ? getToken({ template }) : Promise.resolve(null)),
          })
        : null,
    );

    return () => {
      relayTokenProvider = null;
      setManagedRelaySession(appAtomRegistry, null);
    };
  }, [getToken, isSignedIn, userId]);

  return children;
}
