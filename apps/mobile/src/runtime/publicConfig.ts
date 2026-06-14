export interface MobilePublicConfig {
  readonly clerkPublishableKey: string | undefined;
  readonly clerkJwtTemplate: string | undefined;
  readonly relayUrl: string | undefined;
}

export function hasMobilePublicConfig(config: MobilePublicConfig): boolean {
  return Boolean(config.clerkPublishableKey && config.clerkJwtTemplate);
}
