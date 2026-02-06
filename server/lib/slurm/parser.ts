/**
 * Slurm Command Output Parsers
 *
 * Utilities for parsing output from Slurm commands like squeue, sacct, sinfo, etc.
 */

import type {
  SlurmJobInfo,
  SlurmJobState,
  SlurmPartitionInfo,
  SlurmSubmitResult,
} from './types.js'

// ============================================================================
// squeue Parser
// ============================================================================

/**
 * Parse squeue output in parseable format
 * Expected format: squeue -h -o "%i|%j|%T|%r|%u|%P|%D|%C|%l|%M|%V|%S|%e|%N|%Q"
 */
export function parseSqueueOutput(output: string): SlurmJobInfo[] {
  const jobs: SlurmJobInfo[] = []
  const lines = output.trim().split('\n').filter(line => line.trim())

  for (const line of lines) {
    const parts = line.split('|')
    if (parts.length < 10) continue

    const [
      jobIdRaw,      // %i - Job ID (may include array task ID)
      name,          // %j - Job name
      state,         // %T - Job state
      stateReason,   // %r - State reason
      user,          // %u - User
      partition,     // %P - Partition
      nodes,         // %D - Number of nodes
      cpus,          // %C - Number of CPUs
      timeLimit,     // %l - Time limit
      timeUsed,      // %M - Time used
      submitTime,    // %V - Submit time
      startTime,     // %S - Start time (or estimated)
      endTime,       // %e - End time
      nodeList,      // %N - Node list
      priority,      // %Q - Priority
    ] = parts

    // Parse job ID and array task ID
    let jobId = jobIdRaw
    let arrayTaskId: string | undefined
    if (jobIdRaw.includes('_')) {
      const [jid, atid] = jobIdRaw.split('_')
      jobId = jid
      arrayTaskId = atid
    }

    jobs.push({
      jobId,
      arrayTaskId,
      name: name || '',
      state: (state as SlurmJobState) || 'UNKNOWN',
      stateReason: stateReason !== '(null)' ? stateReason : undefined,
      user: user || '',
      partition: partition || '',
      nodes: parseInt(nodes) || 1,
      cpus: parseInt(cpus) || 1,
      timeLimit: timeLimit !== '(null)' ? timeLimit : undefined,
      timeUsed: timeUsed !== '(null)' ? timeUsed : undefined,
      submitTime: submitTime && submitTime !== 'N/A' ? new Date(submitTime) : undefined,
      startTime: startTime && startTime !== 'N/A' ? new Date(startTime) : undefined,
      endTime: endTime && endTime !== 'N/A' ? new Date(endTime) : undefined,
      nodeList: nodeList !== '(null)' ? nodeList : undefined,
      priority: priority ? parseInt(priority) : undefined,
    })
  }

  return jobs
}

// ============================================================================
// sacct Parser
// ============================================================================

/**
 * Parse sacct output for job accounting info
 * Expected format: sacct -j <jobid> --parsable2 --noheader -o JobID,JobName,State,ExitCode,Start,End,Elapsed,MaxRSS,NodeList
 */
export function parseSacctOutput(output: string): SlurmJobInfo[] {
  const jobs: SlurmJobInfo[] = []
  const lines = output.trim().split('\n').filter(line => line.trim())

  for (const line of lines) {
    const parts = line.split('|')
    if (parts.length < 8) continue

    const [
      jobIdRaw,      // JobID (may include step info like .0, .batch)
      name,          // JobName
      state,         // State
      exitCodeRaw,   // ExitCode (format: "0:0" for exit:signal)
      startTime,     // Start
      endTime,       // End
      elapsed,       // Elapsed
      ,              // MaxRSS (unused)
      nodeList,      // NodeList
    ] = parts

    // Skip sub-steps (batch, extern, etc.)
    if (jobIdRaw.includes('.')) continue

    // Parse job ID and array task ID
    let jobId = jobIdRaw
    let arrayTaskId: string | undefined
    if (jobIdRaw.includes('_')) {
      const [jid, atid] = jobIdRaw.split('_')
      jobId = jid
      arrayTaskId = atid
    }

    // Parse exit code
    let exitCode: number | undefined
    if (exitCodeRaw && exitCodeRaw.includes(':')) {
      exitCode = parseInt(exitCodeRaw.split(':')[0])
    }

    // Map sacct states (can be different from squeue states)
    const normalizedState = normalizeSacctState(state)

    jobs.push({
      jobId,
      arrayTaskId,
      name: name || '',
      state: normalizedState,
      user: '', // Not in sacct output
      partition: '', // Not in default sacct output
      nodes: 0, // Not in default sacct output
      cpus: 0, // Not in default sacct output
      timeUsed: elapsed !== '(null)' ? elapsed : undefined,
      startTime: startTime && startTime !== 'Unknown' ? new Date(startTime) : undefined,
      endTime: endTime && endTime !== 'Unknown' ? new Date(endTime) : undefined,
      exitCode,
      nodeList: nodeList !== '' ? nodeList : undefined,
    })
  }

  return jobs
}

/**
 * Normalize sacct state strings to standard SlurmJobState
 */
function normalizeSacctState(state: string): SlurmJobState {
  // sacct may return states with modifiers like "CANCELLED by <uid>"
  const baseState = state.split(' ')[0].toUpperCase()

  const stateMap: Record<string, SlurmJobState> = {
    'PENDING': 'PENDING',
    'RUNNING': 'RUNNING',
    'SUSPENDED': 'SUSPENDED',
    'COMPLETED': 'COMPLETED',
    'CANCELLED': 'CANCELLED',
    'FAILED': 'FAILED',
    'TIMEOUT': 'TIMEOUT',
    'NODE_FAIL': 'NODE_FAIL',
    'PREEMPTED': 'PREEMPTED',
    'BOOT_FAIL': 'FAILED',
    'DEADLINE': 'TIMEOUT',
    'OUT_OF_MEMORY': 'OUT_OF_MEMORY',
    'COMPLETING': 'COMPLETING',
    'REQUEUED': 'PENDING',
    'RESIZING': 'RUNNING',
    'REVOKED': 'CANCELLED',
    'SIGNALING': 'RUNNING',
    'SPECIAL_EXIT': 'FAILED',
    'STAGE_OUT': 'COMPLETING',
    'STOPPED': 'SUSPENDED',
  }

  return stateMap[baseState] || 'UNKNOWN'
}

// ============================================================================
// sinfo Parser
// ============================================================================

/**
 * Parse sinfo output for partition info
 * Expected format: sinfo --parsable2 --noheader -o "%P|%a|%l|%D|%T|%c|%m|%f|%G"
 */
export function parseSinfoOutput(output: string): SlurmPartitionInfo[] {
  const partitionMap = new Map<string, SlurmPartitionInfo>()

  const lines = output.trim().split('\n').filter(line => line.trim())

  for (const line of lines) {
    const parts = line.split('|')
    if (parts.length < 8) continue

    const [
      partitionRaw, // %P - Partition (with * for default)
      ,             // %a - Availability (unused)
      maxTime,      // %l - Time limit
      nodesCount,   // %D - Number of nodes
      nodeState,    // %T - Node state
      ,             // %c - CPUs per node (unused)
      memory,       // %m - Memory per node
      features,     // %f - Features
      gres,         // %G - Generic resources (GPUs)
    ] = parts

    const isDefault = partitionRaw.endsWith('*')
    const partitionName = partitionRaw.replace('*', '')

    // Get or create partition entry
    let partition = partitionMap.get(partitionName)
    if (!partition) {
      partition = {
        name: partitionName,
        isDefault,
        totalNodes: 0,
        availableNodes: 0,
        maxTime: maxTime !== '(null)' ? maxTime : undefined,
        maxMemPerNode: memory !== '(null)' ? `${memory}M` : undefined,
        features: features !== '(null)' ? features.split(',') : [],
      }
      partitionMap.set(partitionName, partition)
    }

    // Count nodes by state
    const nodeCount = parseInt(nodesCount) || 0
    partition.totalNodes += nodeCount

    // Nodes are available if state is 'idle' or 'mixed'
    if (nodeState === 'idle' || nodeState === 'mixed') {
      partition.availableNodes += nodeCount
    }

    // Parse GPU info from GRES
    if (gres && gres !== '(null)' && gres.includes('gpu')) {
      if (!partition.gpuInfo) {
        partition.gpuInfo = {
          totalGpus: 0,
          availableGpus: 0,
          gpuTypes: [],
        }
      }

      // Parse GRES format: "gpu:a100:4" or "gpu:4"
      const gresMatch = gres.match(/gpu(?::([^:]+))?:(\d+)/)
      if (gresMatch) {
        const gpuType = gresMatch[1]
        const gpuCount = parseInt(gresMatch[2]) * nodeCount
        partition.gpuInfo.totalGpus += gpuCount

        if (gpuType && !partition.gpuInfo.gpuTypes.includes(gpuType)) {
          partition.gpuInfo.gpuTypes.push(gpuType)
        }

        if (nodeState === 'idle' || nodeState === 'mixed') {
          partition.gpuInfo.availableGpus += gpuCount
        }
      }
    }
  }

  return Array.from(partitionMap.values())
}

// ============================================================================
// sbatch Output Parser
// ============================================================================

/**
 * Parse sbatch submission output
 * Expected format: "Submitted batch job <jobid>" or error message
 */
export function parseSbatchOutput(stdout: string, stderr: string): SlurmSubmitResult {
  // Check for job ID in stdout
  const jobIdMatch = stdout.match(/Submitted batch job (\d+)/)
  if (jobIdMatch) {
    return {
      success: true,
      jobId: jobIdMatch[1],
    }
  }

  // Check for array job IDs
  const arrayMatch = stdout.match(/Submitted batch job (\d+)_\[([^\]]+)\]/)
  if (arrayMatch) {
    const baseJobId = arrayMatch[1]
    const arrayRange = arrayMatch[2]
    return {
      success: true,
      jobId: baseJobId,
      arrayJobIds: parseArrayRange(arrayRange).map(i => `${baseJobId}_${i}`),
    }
  }

  // Failed submission
  return {
    success: false,
    error: stderr.trim() || stdout.trim() || 'Unknown submission error',
  }
}

/**
 * Parse array range specification
 * Examples: "0-10", "1,2,5,9", "0-100%10"
 */
function parseArrayRange(range: string): number[] {
  // Remove throttle specification
  const cleanRange = range.split('%')[0]

  const indices: number[] = []

  for (const part of cleanRange.split(',')) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number)
      for (let i = start; i <= end; i++) {
        indices.push(i)
      }
    } else {
      indices.push(parseInt(part))
    }
  }

  return indices
}

// ============================================================================
// Slurm Version Parser
// ============================================================================

/**
 * Parse Slurm version from `sinfo --version` output
 * Expected format: "slurm 23.02.7" or similar
 */
export function parseSlurmVersion(output: string): string | undefined {
  const match = output.match(/slurm\s+(\d+\.\d+\.\d+)/)
  return match ? match[1] : undefined
}

// ============================================================================
// sacctmgr Parser (for accounts and QOS)
// ============================================================================

/**
 * Parse user associations from sacctmgr
 * Expected format: sacctmgr -p show assoc user=$USER format=Account,QOS
 */
export function parseSacctmgrOutput(output: string): { accounts: string[]; qosLevels: string[] } {
  const accounts = new Set<string>()
  const qosLevels = new Set<string>()

  const lines = output.trim().split('\n').filter(line => line.trim() && !line.includes('Account'))

  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim())
    if (parts.length >= 2) {
      if (parts[0]) accounts.add(parts[0])
      if (parts[1]) {
        // QOS can be comma-separated
        parts[1].split(',').forEach(q => {
          if (q.trim()) qosLevels.add(q.trim())
        })
      }
    }
  }

  return {
    accounts: Array.from(accounts),
    qosLevels: Array.from(qosLevels),
  }
}

// ============================================================================
// Cluster Name Parser
// ============================================================================

/**
 * Parse cluster name from scontrol show config
 */
export function parseClusterName(output: string): string | undefined {
  const match = output.match(/ClusterName\s*=\s*(\S+)/)
  return match ? match[1] : undefined
}

// ============================================================================
// Queue Position Estimator
// ============================================================================

/**
 * Estimate queue position and start time for pending jobs
 * This is a heuristic based on priority and resource availability
 */
export function estimateQueuePosition(
  pendingJobs: SlurmJobInfo[],
  targetJobId: string
): { position: number; estimatedStart?: Date } | undefined {
  // Sort by priority (higher = earlier)
  const sorted = [...pendingJobs]
    .filter(j => j.state === 'PENDING')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))

  const position = sorted.findIndex(j => j.jobId === targetJobId) + 1
  if (position === 0) return undefined

  // Use Slurm's estimated start time if available
  const targetJob = sorted.find(j => j.jobId === targetJobId)
  const estimatedStart = targetJob?.startTimeEstimate

  return { position, estimatedStart }
}
