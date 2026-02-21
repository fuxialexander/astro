/**
 * Machine Selection Policy
 *
 * Implements strategies for selecting which machine to use when
 * multiple machines are available (user machines + team machines).
 */

import type { MachineWithTeamInfo } from '../../types/device-auth.js'
import type { ProviderType, EnvironmentType } from '../../types/relay.js'

export type MachineSelectionPolicy = 'round-robin' | 'priority' | 'least-loaded' | 'manual'

/**
 * Machine selection context
 */
export interface MachineSelectionContext {
  /** Available machines (owned + team shared) */
  availableMachines: MachineWithTeamInfo[]
  /** Target environment type */
  targetEnvironment: EnvironmentType
  /** Preferred provider */
  preferredProvider?: ProviderType
  /** Explicitly requested machine ID */
  targetMachineId?: string
  /** User ID requesting the task */
  userId: string
  /** Project ID for the task */
  projectId: string
  /** Current machine usage statistics (for least-loaded) */
  machineLoad?: Map<string, number>
}

/**
 * Machine selection result
 */
export interface MachineSelectionResult {
  /** Selected machine (null if none available) */
  machine: MachineWithTeamInfo | null
  /** Reason for selection */
  reason: string
  /** Whether selection was successful */
  success: boolean
  /** Error message if selection failed */
  error?: string
}

/**
 * Round-robin selection state
 * Tracks the last machine used per environment
 */
const roundRobinState = new Map<string, number>()

/**
 * Select a machine using the specified policy
 */
export function selectMachine(
  context: MachineSelectionContext,
  policy: MachineSelectionPolicy = 'priority'
): MachineSelectionResult {
  // Manual selection: use specific machine if provided
  if (context.targetMachineId) {
    const machine = context.availableMachines.find(m => m.id === context.targetMachineId)
    if (machine) {
      return {
        machine,
        reason: 'Manual selection',
        success: true,
      }
    }
    return {
      machine: null,
      reason: 'Manual selection failed',
      success: false,
      error: `Machine ${context.targetMachineId} not found or not available`,
    }
  }

  // Filter machines by environment, provider, and connection status
  const candidates = context.availableMachines.filter(m => {
    // Must match environment
    if (m.environmentType !== context.targetEnvironment) return false
    // Must be connected
    if (!m.isConnected) return false
    // If provider specified, must support it
    if (context.preferredProvider && !m.providers.includes(context.preferredProvider)) return false
    return true
  })

  if (candidates.length === 0) {
    return {
      machine: null,
      reason: 'No suitable machines available',
      success: false,
      error: `No connected machines found for environment ${context.targetEnvironment}`,
    }
  }

  // Apply selection policy
  let selectedMachine: MachineWithTeamInfo
  let reason: string

  switch (policy) {
    case 'round-robin':
      ({ machine: selectedMachine, reason } = selectRoundRobin(candidates, context.targetEnvironment))
      break
    case 'priority':
      ({ machine: selectedMachine, reason } = selectPriority(candidates))
      break
    case 'least-loaded':
      ({ machine: selectedMachine, reason } = selectLeastLoaded(candidates, context.machineLoad))
      break
    default:
      selectedMachine = candidates[0]
      reason = 'Default selection (first available)'
  }

  return {
    machine: selectedMachine,
    reason,
    success: true,
  }
}

/**
 * Round-robin selection: rotate through available machines
 */
function selectRoundRobin(
  candidates: MachineWithTeamInfo[],
  environment: EnvironmentType
): { machine: MachineWithTeamInfo; reason: string } {
  const key = environment
  const lastIndex = roundRobinState.get(key) ?? -1
  const nextIndex = (lastIndex + 1) % candidates.length
  roundRobinState.set(key, nextIndex)

  return {
    machine: candidates[nextIndex],
    reason: `Round-robin (index ${nextIndex}/${candidates.length})`,
  }
}

/**
 * Priority selection: prefer user machines > team machines, connected > disconnected
 */
function selectPriority(
  candidates: MachineWithTeamInfo[]
): { machine: MachineWithTeamInfo; reason: string } {
  // Sort by priority:
  // 1. User's own machines first
  // 2. Connected machines first
  // 3. Alphabetically by name
  const sorted = candidates.slice().sort((a, b) => {
    // User machines before team machines
    if (a.isTeamMachine !== b.isTeamMachine) {
      return a.isTeamMachine ? 1 : -1
    }
    // Connected machines first
    if (a.isConnected !== b.isConnected) {
      return b.isConnected ? 1 : -1
    }
    // Alphabetical
    return a.name.localeCompare(b.name)
  })

  const machine = sorted[0]
  const reason = machine.isTeamMachine
    ? `Priority (team machine: ${machine.teamName})`
    : 'Priority (user machine)'

  return { machine, reason }
}

/**
 * Least-loaded selection: choose machine with fewest active tasks
 */
function selectLeastLoaded(
  candidates: MachineWithTeamInfo[],
  machineLoad?: Map<string, number>
): { machine: MachineWithTeamInfo; reason: string } {
  if (!machineLoad || machineLoad.size === 0) {
    // No load info, fall back to priority
    return selectPriority(candidates)
  }

  // Find machine with lowest load
  let lowestLoad = Infinity
  let selectedMachine = candidates[0]

  for (const machine of candidates) {
    const load = machineLoad.get(machine.id) ?? 0
    if (load < lowestLoad) {
      lowestLoad = load
      selectedMachine = machine
    }
  }

  return {
    machine: selectedMachine,
    reason: `Least-loaded (${lowestLoad} active tasks)`,
  }
}

/**
 * Reset round-robin state (for testing or manual reset)
 */
export function resetRoundRobin(): void {
  roundRobinState.clear()
}
