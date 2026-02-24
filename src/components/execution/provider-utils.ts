import type { ProviderStatus } from "@/types"

/** Human-readable names for known provider types */
export const PROVIDER_NAMES: Record<string, string> = {
  'claude-sdk': 'Claude Agent SDK',
  'claude-code': 'Claude Code',
  'codex': 'OpenAI Codex',
}

export interface MachineProvider {
  type: string
  status: string
}

/**
 * Derive available providers from a machine's relay-reported provider list.
 * Falls back to the global providers list when no machine is selected or
 * the machine has no providers.
 */
export function deriveAvailableProviders(
  machineProviders: MachineProvider[] | undefined | null,
  globalProviders: ProviderStatus[],
): ProviderStatus[] {
  if (machineProviders?.length) {
    return machineProviders.map((mp) => ({
      id: mp.type,
      name: PROVIDER_NAMES[mp.type] || mp.type,
      available: mp.status === 'available',
      installed: true,
      authStatus: (mp.status === 'available' ? 'authenticated' : 'unknown') as ProviderStatus['authStatus'],
    }))
  }
  return globalProviders
}

/**
 * Check whether a given provider ID is still available in the provider list.
 * Returns true if the provider exists, false otherwise.
 * An empty providerId (the "Auto" option) is always considered valid.
 */
export function isProviderAvailable(
  providerId: string,
  availableProviders: ProviderStatus[],
): boolean {
  if (!providerId) return true // "Auto" is always valid
  return availableProviders.some((p) => p.id === providerId)
}
