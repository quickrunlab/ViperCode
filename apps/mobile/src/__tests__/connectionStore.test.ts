import { describe, expect, it } from "vite-plus/test";
import { MobileConnectionStore } from "../connections/connectionStore.ts";
import type { MobileKnownEnvironmentRecord } from "../runtime/clientRuntimeImports.ts";

function makeRecord(id: string, label: string): MobileKnownEnvironmentRecord {
  return {
    version: 1,
    environmentId: id as MobileKnownEnvironmentRecord["environmentId"],
    label,
    httpBaseUrl: `https://${id}.local`,
    wsBaseUrl: `wss://${id}.local`,
    createdAt: "2026-06-14T00:00:00Z",
    lastConnectedAt: null,
  };
}

describe("MobileConnectionStore", () => {
  it("starts empty", () => {
    const store = new MobileConnectionStore();
    expect(store.getAll()).toHaveLength(0);
    expect(store.getState("env-1")).toBe("idle");
  });

  it("upserts entries", () => {
    const store = new MobileConnectionStore();
    store.upsert(makeRecord("env-1", "My PC"));
    expect(store.getAll()).toHaveLength(1);
    expect(store.get("env-1")?.record.label).toBe("My PC");
    expect(store.getState("env-1")).toBe("idle");
  });

  it("updates state", () => {
    const store = new MobileConnectionStore();
    store.upsert(makeRecord("env-1", "My PC"));
    store.setState("env-1", "connecting");
    expect(store.getState("env-1")).toBe("connecting");
  });

  it("sets error on state change", () => {
    const store = new MobileConnectionStore();
    store.upsert(makeRecord("env-1", "My PC"));
    store.setState("env-1", "error", "Network unreachable");
    const entry = store.get("env-1");
    expect(entry?.state).toBe("error");
    expect(entry?.error).toBe("Network unreachable");
  });

  it("records lastConnectedAt on connected state", () => {
    const store = new MobileConnectionStore();
    store.upsert(makeRecord("env-1", "My PC"));
    store.setState("env-1", "connected");
    const entry = store.get("env-1");
    expect(entry?.lastConnectedAt).not.toBeNull();
  });

  it("removes entries", () => {
    const store = new MobileConnectionStore();
    store.upsert(makeRecord("env-1", "My PC"));
    store.upsert(makeRecord("env-2", "Server"));
    store.remove("env-1");
    expect(store.getAll()).toHaveLength(1);
    expect(store.get("env-1")).toBeUndefined();
  });

  it("notifies subscribers on changes", () => {
    const store = new MobileConnectionStore();
    let callCount = 0;
    const unsubscribe = store.subscribe(() => {
      callCount++;
    });

    store.upsert(makeRecord("env-1", "My PC"));
    expect(callCount).toBe(1);

    store.setState("env-1", "connecting");
    expect(callCount).toBe(2);

    store.remove("env-1");
    expect(callCount).toBe(3);

    unsubscribe();
    store.upsert(makeRecord("env-2", "Server"));
    expect(callCount).toBe(3);
  });

  it("preserves state on upsert of existing entry", () => {
    const store = new MobileConnectionStore();
    store.upsert(makeRecord("env-1", "My PC"));
    store.setState("env-1", "connected");

    store.upsert({
      ...makeRecord("env-1", "My PC (Updated)"),
      label: "My PC (Updated)",
    });
    const entry = store.get("env-1");
    expect(entry?.state).toBe("connected");
    expect(entry?.record.label).toBe("My PC (Updated)");
  });
});
