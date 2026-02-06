/**
 * Slurm Detection
 *
 * Detects Slurm installation and gathers cluster information.
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface SlurmInfo {
  available: boolean
  version?: string
  clusterName?: string
  partitions: string[]
  defaultPartition?: string
  accounts: string[]
  qosLevels: string[]
}

/**
 * Detect Slurm and gather cluster information
 */
export async function detectSlurm(): Promise<SlurmInfo> {
  const info: SlurmInfo = {
    available: false,
    partitions: [],
    accounts: [],
    qosLevels: [],
  }

  // Check if sinfo is available
  try {
    await execAsync('which sinfo')
    info.available = true
  } catch {
    return info
  }

  // Get Slurm version
  try {
    const { stdout } = await execAsync('sinfo --version')
    const match = stdout.match(/slurm\s+(\d+\.\d+\.\d+)/)
    if (match) {
      info.version = match[1]
    }
  } catch {
    // Version detection failed
  }

  // Get cluster name
  try {
    const { stdout } = await execAsync('scontrol show config 2>/dev/null | grep ClusterName')
    const match = stdout.match(/ClusterName\s*=\s*(\S+)/)
    if (match) {
      info.clusterName = match[1]
    }
  } catch {
    // Cluster name detection failed
  }

  // Get partitions
  try {
    const { stdout } = await execAsync('sinfo -h -o "%P"')
    info.partitions = stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(name => {
        const isDefault = name.endsWith('*')
        const partitionName = name.replace('*', '')
        if (isDefault) {
          info.defaultPartition = partitionName
        }
        return partitionName
      })
  } catch {
    // Partition detection failed
  }

  // Get user accounts
  try {
    const username = process.env.USER || process.env.LOGNAME
    if (username) {
      const { stdout } = await execAsync(
        `sacctmgr -p show assoc user=${username} format=Account --noheader 2>/dev/null`
      )
      info.accounts = [
        ...new Set(
          stdout
            .split('\n')
            .map(line => line.split('|')[0]?.trim())
            .filter((a): a is string => !!a && a.length > 0)
        ),
      ]
    }
  } catch {
    // Account detection failed
  }

  // Get QOS levels
  try {
    const username = process.env.USER || process.env.LOGNAME
    if (username) {
      const { stdout } = await execAsync(
        `sacctmgr -p show assoc user=${username} format=QOS --noheader 2>/dev/null`
      )
      const qosSet = new Set<string>()
      stdout.split('\n').forEach(line => {
        const qos = line.split('|')[0]?.trim()
        if (qos) {
          qos.split(',').forEach(q => {
            if (q.trim()) qosSet.add(q.trim())
          })
        }
      })
      info.qosLevels = [...qosSet]
    }
  } catch {
    // QOS detection failed
  }

  return info
}

/**
 * Get detailed partition info
 */
export async function getPartitionInfo(): Promise<
  Array<{
    name: string
    isDefault: boolean
    totalNodes: number
    availableNodes: number
    maxTime?: string
    features: string[]
  }>
> {
  try {
    const { stdout } = await execAsync(
      'sinfo --parsable2 --noheader -o "%P|%a|%l|%D|%T|%f"'
    )

    const partitionMap = new Map<
      string,
      {
        name: string
        isDefault: boolean
        totalNodes: number
        availableNodes: number
        maxTime?: string
        features: string[]
      }
    >()

    stdout.split('\n').forEach(line => {
      const parts = line.split('|')
      if (parts.length < 6) return

      const [partitionRaw, , maxTime, nodesCount, nodeState, features] = parts

      const isDefault = partitionRaw?.endsWith('*') || false
      const name = partitionRaw?.replace('*', '') || ''

      if (!name) return

      let partition = partitionMap.get(name)
      if (!partition) {
        partition = {
          name,
          isDefault,
          totalNodes: 0,
          availableNodes: 0,
          maxTime: maxTime !== '(null)' ? maxTime : undefined,
          features: features !== '(null)' ? features?.split(',') || [] : [],
        }
        partitionMap.set(name, partition)
      }

      const count = parseInt(nodesCount || '0') || 0
      partition.totalNodes += count

      if (nodeState === 'idle' || nodeState === 'mixed') {
        partition.availableNodes += count
      }
    })

    return Array.from(partitionMap.values())
  } catch {
    return []
  }
}
