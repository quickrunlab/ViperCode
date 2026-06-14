import { getReconnectDelayMs, DEFAULT_RECONNECT_BACKOFF } from "../runtime/clientRuntimeImports.ts";
import { loadEnvironmentCredential, loadKnownEnvironments } from "../storage/environmentStore.ts";
import { MobileConnectionStore } from "./connectionStore.ts";
import { subscribeAppLifecycle } from "./appLifecycle.ts";
import { subscribeNetworkState } from "./networkMonitor.ts";

const MAX_RECONNECT_CONCURRENCY = 3;
const MAX_RENEWAL_ATTEMPTS = 2;

export interface ConnectionServiceOptions {
  readonly store: MobileConnectionStore;
  readonly connect: (environmentId: string, bearerToken: string) => Promise<void>;
  readonly disconnect: (environmentId: string) => Promise<void>;
  readonly reconnect: (environmentId: string) => Promise<void>;
  readonly renewCredential: (environmentId: string) => Promise<string | null>;
  readonly logWarning?: (message: string) => void;
}

export class MobileConnectionService {
  private readonly store: MobileConnectionStore;
  private readonly options: ConnectionServiceOptions;
  private retryCounters = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private renewalAttempts = new Map<string, number>();
  private lifecycleUnsubscribe: (() => void) | null = null;
  private netInfoUnsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(options: ConnectionServiceOptions) {
    this.store = options.store;
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.disposed) return;

    const records = await loadKnownEnvironments();
    for (const record of records) {
      this.store.upsert(record);
    }

    this.lifecycleUnsubscribe = subscribeAppLifecycle({
      onForeground: () => {
        void this.reconnectAll();
      },
      onBackground: () => {
        this.clearAllRetryTimers();
      },
    });

    this.netInfoUnsubscribe = subscribeNetworkState({
      onOnline: () => {
        void this.reconnectAll();
      },
      onOffline: () => {
        this.clearAllRetryTimers();
      },
    });
  }

  setNetworkSubscription(unsubscribe: () => void): void {
    if (this.disposed) {
      unsubscribe();
      return;
    }
    this.netInfoUnsubscribe?.();
    this.netInfoUnsubscribe = unsubscribe;
  }

  async connectEnvironment(environmentId: string): Promise<void> {
    if (this.disposed) return;

    const credential = await loadEnvironmentCredential(environmentId);
    if (!credential) {
      this.store.setState(environmentId, "requires-auth", "No saved credential.");
      return;
    }

    this.store.setState(environmentId, "connecting");
    this.retryCounters.set(environmentId, 0);

    try {
      await this.options.connect(environmentId, credential);
      this.store.setState(environmentId, "connected");
      this.retryCounters.set(environmentId, 0);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Connection failed.";
      this.store.setState(environmentId, "error", message);
      this.scheduleRetry(environmentId);
    }
  }

  async disconnectEnvironment(environmentId: string): Promise<void> {
    this.clearRetryTimer(environmentId);
    this.retryCounters.delete(environmentId);
    this.renewalAttempts.delete(environmentId);
    try {
      await this.options.disconnect(environmentId);
    } catch {
      // ignore disconnect errors
    }
    this.store.setState(environmentId, "idle");
  }

  async reconnectAll(): Promise<void> {
    if (this.disposed) return;

    const entries = this.store.getAll();
    const candidates = entries.filter(
      (e) =>
        e.state !== "connected" &&
        e.state !== "connecting" &&
        (e.state === "idle" || e.state === "error" || e.state === "reconnecting"),
    );

    for (let i = 0; i < candidates.length; i += MAX_RECONNECT_CONCURRENCY) {
      const batch = candidates.slice(i, i + MAX_RECONNECT_CONCURRENCY);
      await Promise.allSettled(
        batch.map((entry) => this.reconnectEnvironment(entry.environmentId)),
      );
    }
  }

  async reconnectEnvironment(environmentId: string): Promise<void> {
    if (this.disposed) return;

    const credential = await loadEnvironmentCredential(environmentId);
    if (!credential) {
      this.store.setState(environmentId, "requires-auth", "No saved credential.");
      return;
    }

    this.store.setState(environmentId, "reconnecting");

    try {
      await this.options.reconnect(environmentId);
      this.store.setState(environmentId, "connected");
      this.retryCounters.set(environmentId, 0);
      this.renewalAttempts.delete(environmentId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Reconnect failed.";

      if (this.isAuthError(message)) {
        const attempts = this.renewalAttempts.get(environmentId) ?? 0;
        if (attempts >= MAX_RENEWAL_ATTEMPTS) {
          this.renewalAttempts.delete(environmentId);
          this.store.setState(
            environmentId,
            "requires-auth",
            "Credential renewal failed after retries.",
          );
          return;
        }

        this.renewalAttempts.set(environmentId, attempts + 1);
        const renewed = await this.tryRenewCredential(environmentId);
        if (renewed) {
          this.renewalAttempts.delete(environmentId);
          void this.reconnectEnvironment(environmentId);
          return;
        }
        this.store.setState(environmentId, "requires-auth", "Credential expired.");
        return;
      }

      this.store.setState(environmentId, "error", message);
      this.scheduleRetry(environmentId);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearAllRetryTimers();
    this.lifecycleUnsubscribe?.();
    this.lifecycleUnsubscribe = null;
    this.netInfoUnsubscribe?.();
    this.netInfoUnsubscribe = null;
  }

  private scheduleRetry(environmentId: string): void {
    if (this.disposed) return;

    const retryIndex = this.retryCounters.get(environmentId) ?? 0;
    const delayMs = getReconnectDelayMs(retryIndex, DEFAULT_RECONNECT_BACKOFF);

    if (delayMs === null) {
      this.options.logWarning?.(`Max reconnect retries reached for ${environmentId}.`);
      return;
    }

    this.retryCounters.set(environmentId, retryIndex + 1);
    this.clearRetryTimer(environmentId);

    const timer = setTimeout(() => {
      this.retryTimers.delete(environmentId);
      void this.reconnectEnvironment(environmentId);
    }, delayMs);

    this.retryTimers.set(environmentId, timer);
  }

  private clearRetryTimer(environmentId: string): void {
    const timer = this.retryTimers.get(environmentId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(environmentId);
    }
  }

  private clearAllRetryTimers(): void {
    for (const [id, timer] of this.retryTimers) {
      clearTimeout(timer);
      this.retryTimers.delete(id);
    }
  }

  private isAuthError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("401") ||
      lower.includes("unauthorized") ||
      lower.includes("token expired") ||
      lower.includes("invalid token") ||
      lower.includes("requires-auth")
    );
  }

  private async tryRenewCredential(environmentId: string): Promise<boolean> {
    try {
      const renewed = await this.options.renewCredential(environmentId);
      return renewed !== null;
    } catch {
      return false;
    }
  }
}
