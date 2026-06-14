import { useAuth } from "@clerk/clerk-expo";
import { ManagedRelayClient } from "@vipercode/client-runtime";
import type { RelayClientEnvironmentRecord } from "@vipercode/contracts/relay";
import type { ManagedRelaySnapshotState } from "@vipercode/client-runtime";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useState } from "react";
import { mobileRuntime, hasRelayConfig } from "./mobileRuntime.ts";
import { resolveMobilePublicConfig } from "./resolveConfig.ts";

export function useRelayEnvironments(): ManagedRelaySnapshotState<
  ReadonlyArray<RelayClientEnvironmentRecord>
> & {
  readonly refresh: () => void;
} {
  const { getToken, isSignedIn } = useAuth();
  const [state, setState] = useState<
    ManagedRelaySnapshotState<ReadonlyArray<RelayClientEnvironmentRecord>>
  >({
    data: null,
    error: null,
    isPending: isSignedIn ?? false,
  });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!isSignedIn) {
      setState({ data: null, error: null, isPending: false });
      return;
    }

    if (!hasRelayConfig) {
      setState({ data: null, error: null, isPending: false });
      return;
    }

    setState((prev) => ({ ...prev, isPending: true }));

    let cancelled = false;

    void (async () => {
      try {
        const template = resolveMobilePublicConfig().clerkJwtTemplate ?? "viper-relay";
        const token = await getToken({ template });
        if (!token) {
          if (!cancelled)
            setState({ data: null, error: "Could not get auth token.", isPending: false });
          return;
        }
        const environments = await mobileRuntime.runPromise(
          ManagedRelayClient.pipe(
            Effect.flatMap((client) => client.listEnvironments({ clerkToken: token })),
          ),
        );
        if (!cancelled) setState({ data: environments, error: null, isPending: false });
      } catch (cause) {
        if (!cancelled)
          setState({
            data: null,
            error: cause instanceof Error ? cause.message : "Could not load environments.",
            isPending: false,
          });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken, isSignedIn, refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return {
    ...state,
    refresh,
  };
}
