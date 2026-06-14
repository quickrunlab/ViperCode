import type { MobileKnownEnvironmentRecord } from "../runtime/clientRuntimeImports.ts";
import { readPublicJson, writePublicJson } from "./publicStorage.ts";
import { readSecure, writeSecure, removeSecure } from "./secureStorage.ts";

const KNOWN_ENVIRONMENTS_KEY = "vipercode:known-environments";
const ENVIRONMENT_CREDENTIAL_PREFIX = "vipercode:env-credential:";

export async function loadKnownEnvironments(): Promise<
  ReadonlyArray<MobileKnownEnvironmentRecord>
> {
  const list =
    await readPublicJson<ReadonlyArray<MobileKnownEnvironmentRecord>>(KNOWN_ENVIRONMENTS_KEY);
  return list ?? [];
}

export async function saveKnownEnvironment(record: MobileKnownEnvironmentRecord): Promise<void> {
  const existing = await loadKnownEnvironments();
  const filtered = existing.filter((e) => e.environmentId !== record.environmentId);
  await writePublicJson(KNOWN_ENVIRONMENTS_KEY, [record, ...filtered]);
}

export async function removeKnownEnvironment(environmentId: string): Promise<void> {
  const existing = await loadKnownEnvironments();
  const filtered = existing.filter((e) => e.environmentId !== environmentId);
  await writePublicJson(KNOWN_ENVIRONMENTS_KEY, filtered);
  await removeSecure(`${ENVIRONMENT_CREDENTIAL_PREFIX}${environmentId}`);
}

export async function saveEnvironmentCredential(
  environmentId: string,
  bearerToken: string,
): Promise<void> {
  await writeSecure(`${ENVIRONMENT_CREDENTIAL_PREFIX}${environmentId}`, bearerToken);
}

export async function loadEnvironmentCredential(environmentId: string): Promise<string | null> {
  return readSecure(`${ENVIRONMENT_CREDENTIAL_PREFIX}${environmentId}`);
}

export async function removeEnvironmentCredential(environmentId: string): Promise<void> {
  await removeSecure(`${ENVIRONMENT_CREDENTIAL_PREFIX}${environmentId}`);
}
