import { useMachinesStore } from '@/stores/machines-store'
import type { Project } from '@/types'

/**
 * Resolve the effective machine ID for a project.
 * Uses project.defaultMachineId if set, otherwise falls back to the only connected machine.
 */
export function useProjectMachineId(project: Project | undefined): string | undefined {
  const machines = useMachinesStore((s) => s.machines)
  if (project?.defaultMachineId) return project.defaultMachineId
  const connected = machines.filter((m) => m.isConnected && !m.isRevoked)
  if (connected.length === 1) return connected[0].id
  return undefined
}
