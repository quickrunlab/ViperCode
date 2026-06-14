import type {
  MobileConnectionState,
  MobileKnownEnvironmentRecord,
} from "../runtime/clientRuntimeImports.ts";

export interface ConnectionEntry {
  readonly environmentId: string;
  readonly record: MobileKnownEnvironmentRecord;
  readonly state: MobileConnectionState;
  readonly error: string | null;
  readonly lastConnectedAt: string | null;
}

export type ConnectionStoreListener = () => void;

export class MobileConnectionStore {
  private entries = new Map<string, ConnectionEntry>();
  private listeners = new Set<ConnectionStoreListener>();

  get(environmentId: string): ConnectionEntry | undefined {
    return this.entries.get(environmentId);
  }

  getAll(): ReadonlyArray<ConnectionEntry> {
    return Array.from(this.entries.values());
  }

  getState(environmentId: string): MobileConnectionState {
    return this.entries.get(environmentId)?.state ?? "idle";
  }

  setState(environmentId: string, state: MobileConnectionState, error?: string | null): void {
    const existing = this.entries.get(environmentId);
    if (!existing) return;
    this.entries.set(environmentId, {
      ...existing,
      state,
      error: error ?? null,
      lastConnectedAt: state === "connected" ? new Date().toISOString() : existing.lastConnectedAt,
    });
    this.notify();
  }

  upsert(record: MobileKnownEnvironmentRecord): void {
    const existing = this.entries.get(record.environmentId);
    this.entries.set(record.environmentId, {
      environmentId: record.environmentId,
      record,
      state: existing?.state ?? "idle",
      error: existing?.error ?? null,
      lastConnectedAt: existing?.lastConnectedAt ?? record.lastConnectedAt,
    });
    this.notify();
  }

  remove(environmentId: string): void {
    this.entries.delete(environmentId);
    this.notify();
  }

  subscribe(listener: ConnectionStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }
}
