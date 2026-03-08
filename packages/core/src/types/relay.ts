/**
 * Relay protocol types (shared subset)
 *
 * Only the types needed by other core modules.
 * The full relay protocol types remain in server/types/relay.ts.
 */

/**
 * AI agent types available on a machine.
 *
 * "Provider" is legacy terminology — these represent the AI agents
 * (AI service providers) that can execute tasks.
 */
export type ProviderType = 'claude-sdk' | 'codex' | 'openclaw' | 'opencode' | 'custom';
