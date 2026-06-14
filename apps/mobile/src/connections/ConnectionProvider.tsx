import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { MobileConnectionStore } from "../connections/connectionStore.ts";
import { MobileConnectionService } from "../connections/connectionService.ts";

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

  const connect = useCallback(async (_environmentId: string, _bearerToken: string) => {
    // Establish WebSocket connection – wired in later phases
  }, []);

  const disconnect = useCallback(async (_environmentId: string) => {
    // Clean up WebSocket connection – wired in later phases
  }, []);

  const reconnect = useCallback(async (_environmentId: string) => undefined, []);
  const renewCredential = useCallback(
    async (_environmentId: string): Promise<string | null> => null,
    [],
  );

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
