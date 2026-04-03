/**
 * Transport-agnostic environment/machine commands.
 */

import type {
  CommandClient,
  MachineData,
  MachineListResult,
  MachineDetailResult,
  ProviderListResult,
  RelayStatusResult,
  ClusterListResult,
} from './types.js'

/**
 * Resolve a partial machine ID to a full machine.
 * Searches all machines by prefix match. Throws if 0 or >1 matches.
 */
export async function resolveMachine(
  client: CommandClient,
  partialId: string,
): Promise<MachineData> {
  const machines = await client.listMachines()

  // Exact match first
  const exact = machines.find((m) => m.id === partialId)
  if (exact) return exact

  // Prefix match
  const matches = machines.filter((m) => m.id.startsWith(partialId))
  if (matches.length === 0) {
    throw new Error(`No machine found matching "${partialId}"`)
  }
  if (matches.length > 1) {
    const ids = matches.map((m) => `  ${m.id.slice(0, 8)}  ${m.name}`).join('\n')
    throw new Error(
      `Ambiguous machine ID "${partialId}" matches ${matches.length} machines:\n${ids}`,
    )
  }
  return matches[0]
}

/** List all active (non-revoked) machines. */
export async function listMachines(
  client: CommandClient,
): Promise<MachineListResult> {
  const machines = await client.listMachines()
  const active = machines.filter((m) => !m.isRevoked)

  return {
    machines: active.map((m) => ({
      id: m.id,
      name: m.name,
      hostname: m.hostname,
      platform: m.platform,
      environmentType: m.environmentType,
      providers: m.providers,
      isConnected: m.isConnected,
      lastSeenAt: m.lastSeenAt,
    })),
  }
}

/** Get detailed info for a single machine (supports partial ID). */
export async function getMachine(
  client: CommandClient,
  partialId: string,
): Promise<MachineDetailResult> {
  const machine = await resolveMachine(client, partialId)
  return { machine }
}

/** Revoke/remove a machine (supports partial ID). */
export async function removeMachine(
  client: CommandClient,
  partialId: string,
): Promise<{ machineId: string; name: string }> {
  const machine = await resolveMachine(client, partialId)
  await client.revokeMachine(machine.id)
  return { machineId: machine.id, name: machine.name }
}

/** List all providers across active machines. */
export async function listProviders(
  client: CommandClient,
): Promise<ProviderListResult> {
  const machines = await client.listMachines()
  const active = machines.filter((m) => !m.isRevoked)

  const providers: ProviderListResult['providers'] = []

  for (const m of active) {
    if (m.providerConfigs && Array.isArray(m.providerConfigs)) {
      for (const cfg of m.providerConfigs) {
        providers.push({
          machine: m.name,
          machineId: m.id.slice(0, 8),
          provider: cfg.provider,
          enabled: cfg.enabled,
          model: cfg.defaultModel ?? '\u2014',
          connected: m.isConnected,
        })
      }
    } else if (m.providers && Array.isArray(m.providers)) {
      for (const p of m.providers) {
        providers.push({
          machine: m.name,
          machineId: m.id.slice(0, 8),
          provider: p,
          enabled: true,
          model: '\u2014',
          connected: m.isConnected,
        })
      }
    }
  }

  return { providers }
}

/** Get relay server status. */
export async function getRelayStatus(
  client: CommandClient,
): Promise<RelayStatusResult> {
  const status = await client.getRelayStatus()
  return { status }
}

/** List HPC/SLURM clusters. */
export async function listClusters(
  client: CommandClient,
): Promise<ClusterListResult> {
  const clusters = await client.getSlurmClusters()
  return { clusters }
}
