import {
  resolveRemotePairingTarget,
  type ResolvedRemotePairingTarget,
} from "@vipercode/shared/remote";

export interface PairingParseResult {
  readonly ok: true;
  readonly target: ResolvedRemotePairingTarget;
}

export interface PairingParseError {
  readonly ok: false;
  readonly message: string;
}

export type PairingParseOutcome = PairingParseResult | PairingParseError;

export function parsePairingUrl(raw: string): PairingParseOutcome {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter a pairing URL or code." };
  }
  try {
    const target = resolveRemotePairingTarget({ pairingUrl: trimmed });
    return { ok: true, target };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Invalid pairing URL.",
    };
  }
}

export function parsePairingHostAndCode(host: string, code: string): PairingParseOutcome {
  const trimmedHost = host.trim();
  const trimmedCode = code.trim();
  if (!trimmedHost) {
    return { ok: false, message: "Enter a backend URL." };
  }
  if (!trimmedCode) {
    return { ok: false, message: "Enter a pairing code." };
  }
  try {
    const target = resolveRemotePairingTarget({ host: trimmedHost, pairingCode: trimmedCode });
    return { ok: true, target };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Invalid host or pairing code.",
    };
  }
}
