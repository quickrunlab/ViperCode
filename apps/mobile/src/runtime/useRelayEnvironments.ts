import { useAuth } from "@clerk/clerk-expo";
import { ManagedRelayClient } from "@vipercode/client-runtime";
import type { RelayClientEnvironmentRecord } from "@vipercode/contracts/relay";
import type { ManagedRelaySnapshotState } from "@vipercode/client-runtime";
import * as Effect from "effect/Effect";
import { useEffect, useState } from "react";
import { mobileRuntime } from "./mobileRuntime.ts";

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

  useEffect(() => {
    if (!isSignedIn) {
      setState({ data: null, error: null, isPending: false });
      return;
    }

    setState((prev) => ({ ...prev, isPending: true }));

    let cancelled = false;

    void (async () => {
      try {
        const token = await getToken({ template: "viper-connect" });
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
  }, [getToken, isSignedIn]);

  return {
    ...state,
    refresh: () => {},
  };
}
