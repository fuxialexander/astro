/**
 * Relay protocol types (shared subset)
 *
 * Only the types needed by other core modules.
 * The full relay protocol types remain in server/types/relay.ts.
 */

/** Provider types available on a machine */
export type ProviderType = 'claude-code' | 'claude-sdk' | 'codex' | 'aws' | 'gcp' | 'custom';
