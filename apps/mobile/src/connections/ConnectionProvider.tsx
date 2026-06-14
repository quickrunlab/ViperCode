import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { MobileConnectionStore } from "../connections/connectionStore.ts";
import { MobileConnectionService } from "../connections/connectionService.ts";
import {
  connectEnvironmentClient,
  disconnectEnvironmentClient,
  getEnvironmentClient,
} from "../connections/environmentClient.ts";
import { createKnownEnvironment, type KnownEnvironment } from "@vipercode/client-runtime";
import { EnvironmentId } from "@vipercode/contracts";
import {
  loadEnvironmentCredential,
  loadKnownEnvironments,
  saveEnvironmentCredential,
} from "../storage/environmentStore.ts";
import { mobileRuntime } from "../runtime/mobileRuntime.ts";
import { ManagedRelayClient } from "@vipercode/client-runtime";
import * as Effect from "effect/Effect";
import { RelayEnvironmentConnectScope } from "@vipercode/contracts/relay";

interface ConnectionContextValue {
  readonly store: MobileConnectionStore;
  readonly service: MobileConnectionService;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function useConnectionStore(): MobileConnectionStore {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error("MobileConnectionProvider not found.");
  return ctx.store;
}

export function useConnectionService(): MobileConnectionService {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error("MobileConnectionProvider not found.");
  return ctx.service;
}

export function MobileConnectionProvider({ children }: { readonly children: React.ReactNode }) {
  const store = useMemo(() => new MobileConnectionStore(), []);

  const connect = useCallback(async (environmentId: string, bearerToken: string) => {
    const records = await loadKnownEnvironments();
    const record = records.find((r) => r.environmentId === environmentId);
    if (!record) throw new Error("Environment record not found.");

    const knownEnv: KnownEnvironment = createKnownEnvironment({
      label: record.label,
      target: {
        httpBaseUrl: record.httpBaseUrl,
        wsBaseUrl: record.wsBaseUrl,
      },
    });

    await connectEnvironmentClient(EnvironmentId.make(environmentId), knownEnv, bearerToken);
  }, []);

  const disconnect = useCallback(async (environmentId: string) => {
    await disconnectEnvironmentClient(EnvironmentId.make(environmentId));
  }, []);

  const reconnect = useCallback(async (environmentId: string) => {
    const eid = EnvironmentId.make(environmentId);
    const client = getEnvironmentClient(eid);
    if (client) {
      await client.reconnect();
    } else {
      const bearerToken = await loadEnvironmentCredential(environmentId);
      if (bearerToken) {
        const records = await loadKnownEnvironments();
        const record = records.find((r) => r.environmentId === environmentId);
        if (record) {
          const knownEnv: KnownEnvironment = createKnownEnvironment({
            label: record.label,
            target: {
              httpBaseUrl: record.httpBaseUrl,
              wsBaseUrl: record.wsBaseUrl,
            },
          });
          await connectEnvironmentClient(eid, knownEnv, bearerToken);
        }
      }
    }
  }, []);

  const renewCredential = useCallback(async (environmentId: string): Promise<string | null> => {
    const record = (await loadKnownEnvironments()).find((r) => r.environmentId === environmentId);
    if (!record?.relayManaged) return null;

    try {
      const result = await mobileRuntime.runPromise(
        ManagedRelayClient.pipe(
          Effect.flatMap((relay) =>
            relay.connectEnvironment({
              environmentId: EnvironmentId.make(environmentId),
              clerkToken: "",
              scopes: [RelayEnvironmentConnectScope],
            }),
          ),
        ),
      );
      const newToken = result.credential;
      await saveEnvironmentCredential(environmentId, newToken);
      return newToken;
    } catch {
      return null;
    }
  }, []);

  const service = useMemo(
    () =>
      new MobileConnectionService({
        store,
        connect,
        disconnect,
        reconnect,
        renewCredential,
        logWarning: (msg) => console.warn("[ConnectionService]", msg),
      }),
    [store, connect, disconnect, reconnect, renewCredential],
  );

  useEffect(() => {
    void service.start();
    return () => service.dispose();
  }, [service]);

  const value = useMemo(() => ({ store, service }), [store, service]);

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
