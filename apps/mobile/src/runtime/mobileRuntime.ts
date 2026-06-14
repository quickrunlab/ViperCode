import { managedRelayClientLayer, remoteHttpClientLayer } from "@vipercode/client-runtime";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { resolveMobilePublicConfig } from "./resolveConfig.ts";
import { mobileDpopSignerLayer } from "./dpop.ts";

const config = resolveMobilePublicConfig();

const mobileHttpClientLayer = remoteHttpClientLayer(globalThis.fetch);

export const hasRelayConfig = Boolean(config.relayUrl);

const mobileRelayClientLayer = managedRelayClientLayer({
  relayUrl: config.relayUrl ?? "https://relay.invalid",
  clientId: "viper-mobile",
}).pipe(Layer.provideMerge(mobileDpopSignerLayer), Layer.provide(mobileHttpClientLayer));

export const mobileRuntimeLayer = Layer.mergeAll(mobileHttpClientLayer, mobileRelayClientLayer);

export const mobileRuntime = ManagedRuntime.make(mobileRuntimeLayer);
