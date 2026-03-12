import { useMemo } from 'react'
import { useProjectStore } from '@/stores/project-store'
import { useMachinesStore } from '@/stores/machines-store'

export interface RecentWorkdir {
  machineId: string
  machineName: string
  workingDirectory: string
  lastUsedAt: string
  useCount: number
}

/**
 * Format a machine ID and working directory into canonical `machineName:workdir` format.
 */
export function formatMachineWorkdir(
  machineName: string,
  workdir: string
): string {
  return `${machineName}:${workdir}`
}

/**
 * Parse a `machine:path` string into its components.
 * Splits on the first colon only, so paths containing colons are preserved.
 * Returns null if the input doesn't contain a colon.
 */
export function parseMachineWorkdir(
  input: string
): { machine: string; path: string } | null {
  const idx = input.indexOf(':')
  if (idx === -1) return null
  return {
    machine: input.slice(0, idx),
    path: input.slice(idx + 1),
  }
}

/**
 * Hook that derives recently used machine:workdir combinations
 * from playground session history.
 *
 * @param machineId - Optional filter to show only workdirs for a specific machine
 * @returns Array of RecentWorkdir entries sorted by recency (most recent first), max 20
 */
export function useRecentWorkdirs(machineId?: string): RecentWorkdir[] {
  const projects = useProjectStore((s) => s.projects)
  const machines = useMachinesStore((s) => s.machines)

  return useMemo(() => {
    // Build machine name lookup
    const machineNames = new Map<string, string>()
    for (const m of machines) {
      machineNames.set(m.id, m.name)
    }

    // Accumulator keyed by "machineId|workingDirectory"
    const acc = new Map<
      string,
      {
        machineId: string
        workingDirectory: string
        lastUsedAt: Date
        useCount: number
      }
    >()

    for (const project of projects) {
      if (project.projectType !== 'playground') continue
      if (!project.defaultMachineId || !project.workingDirectory) continue
      if (machineId && project.defaultMachineId !== machineId) continue

      const key = `${project.defaultMachineId}|${project.workingDirectory}`
      const updatedAt = new Date(project.updatedAt)
      const existing = acc.get(key)

      if (existing) {
        existing.useCount++
        if (updatedAt > existing.lastUsedAt) {
          existing.lastUsedAt = updatedAt
        }
      } else {
        acc.set(key, {
          machineId: project.defaultMachineId,
          workingDirectory: project.workingDirectory,
          lastUsedAt: updatedAt,
          useCount: 1,
        })
      }
    }

    // Convert to output format, sort by recency, limit to 20
    return Array.from(acc.values())
      .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
      .slice(0, 20)
      .map((entry) => ({
        machineId: entry.machineId,
        machineName:
          machineNames.get(entry.machineId) ?? entry.machineId,
        workingDirectory: entry.workingDirectory,
        lastUsedAt: entry.lastUsedAt.toISOString(),
        useCount: entry.useCount,
      }))
  }, [projects, machines, machineId])
}
