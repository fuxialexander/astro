/**
 * Slurm Store
 *
 * Manages Slurm/HPC cluster state for the frontend.
 * Tracks connected clusters, job status, and queue information.
 */

import { create } from 'zustand'
import { apiUrl } from '@/lib/api-url'

// ============================================================================
// Types
// ============================================================================

export type SlurmJobState =
  | 'PENDING'
  | 'RUNNING'
  | 'SUSPENDED'
  | 'COMPLETING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'PREEMPTED'
  | 'NODE_FAIL'
  | 'OUT_OF_MEMORY'
  | 'UNKNOWN'

export interface SlurmPartition {
  name: string
  isDefault: boolean
  totalNodes: number
  availableNodes: number
  maxTime?: string
  features: string[]
  gpuInfo?: {
    totalGpus: number
    availableGpus: number
    gpuTypes: string[]
  }
}

export interface SlurmCluster {
  machineId: string
  name: string
  hostname?: string
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error'
  provider: {
    status: 'available' | 'busy' | 'unavailable' | 'error'
    version?: string
    maxConcurrentTasks: number
    currentTasks: number
    capabilities?: string[]
  }
  resources: {
    cpuCores: number
    memoryMB: number
    gpuCount?: number
    gpuMemoryMB?: number
  }
  load: {
    cpuPercent: number
    memoryPercent: number
    gpuPercent?: number
    activeTasks: number
    queuedTasks: number
  }
  lastHeartbeat: Date
  clusterInfo?: {
    clusterName: string
    slurmVersion: string
    partitions: SlurmPartition[]
    qosLevels: string[]
    accounts: string[]
    defaultPartition?: string
  }
}

export interface SlurmJob {
  taskId: string
  slurmJobId: string
  nodeId: string
  projectId: string
  name: string
  state: SlurmJobState
  stateReason?: string
  partition: string
  nodes: number
  cpus: number
  timeLimit?: string
  timeUsed?: string
  submitTime?: Date
  startTime?: Date
  endTime?: Date
  exitCode?: number
  nodeList?: string
  priority?: number
  queuePosition?: number
  clusterId: string
  clusterName: string
}

// ============================================================================
// Store State
// ============================================================================

interface SlurmState {
  clusters: SlurmCluster[]
  jobs: SlurmJob[]
  loading: boolean
  error: string | null
  lastFetched: Date | null

  // Actions
  fetchClusters: () => Promise<void>
  fetchJobs: () => Promise<void>
  addCluster: (cluster: SlurmCluster) => void
  updateCluster: (machineId: string, updates: Partial<SlurmCluster>) => void
  removeCluster: (machineId: string) => void
  addJob: (job: SlurmJob) => void
  updateJob: (taskId: string, updates: Partial<SlurmJob>) => void
  removeJob: (taskId: string) => void
  getClusterById: (machineId: string) => SlurmCluster | undefined
  getJobById: (taskId: string) => SlurmJob | undefined
  getJobsByCluster: (machineId: string) => SlurmJob[]
  getJobsByProject: (projectId: string) => SlurmJob[]
  getActiveJobs: () => SlurmJob[]
  getQueuedJobs: () => SlurmJob[]
  getCompletedJobs: () => SlurmJob[]
  getTotalGpuCount: () => number
  getAvailableGpuCount: () => number
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useSlurmStore = create<SlurmState>((set, get) => ({
  clusters: [],
  jobs: [],
  loading: false,
  error: null,
  lastFetched: null,

  fetchClusters: async () => {
    set({ loading: true, error: null })
    try {
      const response = await fetch(apiUrl('/api/relay/slurm/clusters'))
      if (!response.ok) {
        throw new Error(`Failed to fetch clusters: ${response.statusText}`)
      }
      const data = await response.json() as { clusters: Array<Omit<SlurmCluster, 'lastHeartbeat'> & { lastHeartbeat: string }> }
      const clusters = data.clusters.map((c) => ({
        ...c,
        lastHeartbeat: new Date(c.lastHeartbeat),
      }))
      set({
        clusters,
        loading: false,
        lastFetched: new Date(),
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  },

  fetchJobs: async () => {
    set({ loading: true, error: null })
    try {
      const response = await fetch(apiUrl('/api/relay/slurm/jobs'))
      if (!response.ok) {
        throw new Error(`Failed to fetch jobs: ${response.statusText}`)
      }
      const data = await response.json() as { jobs: Array<Omit<SlurmJob, 'submitTime' | 'startTime' | 'endTime'> & { submitTime?: string; startTime?: string; endTime?: string }> }
      const jobs = data.jobs.map((j) => ({
        ...j,
        submitTime: j.submitTime ? new Date(j.submitTime) : undefined,
        startTime: j.startTime ? new Date(j.startTime) : undefined,
        endTime: j.endTime ? new Date(j.endTime) : undefined,
      }))
      set({
        jobs,
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  },

  addCluster: (cluster) => {
    const next = [...get().clusters.filter(c => c.machineId !== cluster.machineId), cluster]
    set({ clusters: next })
  },

  updateCluster: (machineId, updates) => {
    const next = get().clusters.map(c =>
      c.machineId === machineId ? { ...c, ...updates } : c
    )
    set({ clusters: next })
  },

  removeCluster: (machineId) => {
    const next = get().clusters.filter(c => c.machineId !== machineId)
    set({ clusters: next })
  },

  addJob: (job) => {
    const next = [...get().jobs.filter(j => j.taskId !== job.taskId), job]
    set({ jobs: next })
  },

  updateJob: (taskId, updates) => {
    const next = get().jobs.map(j =>
      j.taskId === taskId ? { ...j, ...updates } : j
    )
    set({ jobs: next })
  },

  removeJob: (taskId) => {
    const next = get().jobs.filter(j => j.taskId !== taskId)
    set({ jobs: next })
  },

  getClusterById: (machineId) => {
    return get().clusters.find(c => c.machineId === machineId)
  },

  getJobById: (taskId) => {
    return get().jobs.find(j => j.taskId === taskId)
  },

  getJobsByCluster: (machineId) => {
    return get().jobs.filter(j => j.clusterId === machineId)
  },

  getJobsByProject: (projectId) => {
    return get().jobs.filter(j => j.projectId === projectId)
  },

  getActiveJobs: () => {
    return get().jobs.filter(j =>
      ['RUNNING', 'COMPLETING', 'SUSPENDED'].includes(j.state)
    )
  },

  getQueuedJobs: () => {
    return get().jobs.filter(j => j.state === 'PENDING')
  },

  getCompletedJobs: () => {
    return get().jobs.filter(j =>
      ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY'].includes(j.state)
    )
  },

  getTotalGpuCount: () => {
    return get().clusters.reduce((total, cluster) => {
      const gpuInfo = cluster.clusterInfo?.partitions.reduce((sum, p) => {
        return sum + (p.gpuInfo?.totalGpus || 0)
      }, 0)
      return total + (gpuInfo || cluster.resources.gpuCount || 0)
    }, 0)
  },

  getAvailableGpuCount: () => {
    return get().clusters.reduce((total, cluster) => {
      const gpuInfo = cluster.clusterInfo?.partitions.reduce((sum, p) => {
        return sum + (p.gpuInfo?.availableGpus || 0)
      }, 0)
      return total + (gpuInfo || 0)
    }, 0)
  },
}))

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Map Slurm job state to display color
 */
export function getJobStateColor(state: SlurmJobState): string {
  switch (state) {
    case 'PENDING':
      return 'text-yellow-600'
    case 'RUNNING':
    case 'COMPLETING':
      return 'text-blue-600'
    case 'COMPLETED':
      return 'text-green-600'
    case 'FAILED':
    case 'NODE_FAIL':
    case 'OUT_OF_MEMORY':
      return 'text-red-600'
    case 'CANCELLED':
    case 'PREEMPTED':
      return 'text-orange-600'
    case 'TIMEOUT':
      return 'text-purple-600'
    case 'SUSPENDED':
      return 'text-gray-600'
    default:
      return 'text-gray-500'
  }
}

/**
 * Get human-readable job state label
 */
export function getJobStateLabel(state: SlurmJobState): string {
  switch (state) {
    case 'PENDING':
      return 'Queued'
    case 'RUNNING':
      return 'Running'
    case 'COMPLETING':
      return 'Completing'
    case 'COMPLETED':
      return 'Completed'
    case 'FAILED':
      return 'Failed'
    case 'CANCELLED':
      return 'Cancelled'
    case 'TIMEOUT':
      return 'Timed Out'
    case 'PREEMPTED':
      return 'Preempted'
    case 'NODE_FAIL':
      return 'Node Failed'
    case 'OUT_OF_MEMORY':
      return 'Out of Memory'
    case 'SUSPENDED':
      return 'Suspended'
    default:
      return 'Unknown'
  }
}

/**
 * Format Slurm time string to human readable
 */
export function formatSlurmTime(time?: string): string {
  if (!time) return '-'
  // Slurm time format: D-HH:MM:SS or HH:MM:SS
  return time
}

/**
 * Parse Slurm memory string to MB
 */
export function parseSlurmMemory(mem?: string): number | undefined {
  if (!mem) return undefined
  const match = mem.match(/(\d+)([KMGT]?)/)
  if (!match) return undefined
  const value = parseInt(match[1])
  const unit = match[2]
  switch (unit) {
    case 'K':
      return value / 1024
    case 'G':
      return value * 1024
    case 'T':
      return value * 1024 * 1024
    default:
      return value
  }
}
