/**
 * Provider adapters index
 */

export type { ProviderAdapter, TaskOutputStream, ProviderStatus } from './base-adapter.js';
export { ClaudeCodeAdapter } from './claude-code-adapter.js';
export { ClaudeSdkAdapter } from './claude-sdk-adapter.js';
export { CodexAdapter } from './codex-adapter.js';
export { SlurmAdapter } from './slurm-adapter.js';

import type { ProviderType } from '../types.js';
import type { ProviderAdapter } from './base-adapter.js';
import { ClaudeCodeAdapter } from './claude-code-adapter.js';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { SlurmAdapter } from './slurm-adapter.js';

/** Extended provider types including SDK variant */
export type ExtendedProviderType = ProviderType | 'claude-sdk';

/**
 * Create a provider adapter by type
 */
export function createProviderAdapter(type: ProviderType | ExtendedProviderType): ProviderAdapter | null {
  switch (type) {
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'claude-sdk':
      return new ClaudeSdkAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'slurm':
      return new SlurmAdapter();
    case 'custom':
      // Custom providers would need additional configuration
      return null;
    default:
      return null;
  }
}

/**
 * Get all available provider adapters
 */
export async function getAvailableAdapters(): Promise<ProviderAdapter[]> {
  const adapters: ProviderAdapter[] = [
    new ClaudeSdkAdapter(), // Prefer SDK over CLI
    new ClaudeCodeAdapter(),
    new CodexAdapter(),
    new SlurmAdapter(),
  ];

  const available: ProviderAdapter[] = [];

  for (const adapter of adapters) {
    if (await adapter.isAvailable()) {
      available.push(adapter);
    }
  }

  return available;
}
