import { Platform } from "react-native";
import {
  bootstrapRemoteBearerSession,
  fetchRemoteEnvironmentDescriptor,
  type RemoteEnvironmentAuthError,
} from "@vipercode/client-runtime";
import type { ResolvedRemotePairingTarget } from "@vipercode/shared/remote";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/unstable/http/HttpClient";

export interface PairingExchangeResult {
  readonly bearerToken: string;
  readonly environmentLabel: string;
  readonly environmentId: string;
}

export const exchangePairingCredential = (
  target: ResolvedRemotePairingTarget,
): Effect.Effect<PairingExchangeResult, RemoteEnvironmentAuthError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const descriptor = yield* fetchRemoteEnvironmentDescriptor({
      httpBaseUrl: target.httpBaseUrl,
    });
    const session = yield* bootstrapRemoteBearerSession({
      httpBaseUrl: target.httpBaseUrl,
      credential: target.credential,
      clientMetadata: {
        label: "Viper Code Mobile",
        deviceType: "mobile",
        os: Platform.OS,
      },
    });
    return {
      bearerToken: session.access_token,
      environmentLabel: descriptor.label,
      environmentId: descriptor.environmentId,
    };
  });
