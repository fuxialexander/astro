/**
 * Slurm HPC Integration Types
 *
 * Types for managing Slurm job submission, monitoring, and status tracking.
 */

// ============================================================================
// Slurm Job Configuration
// ============================================================================

/**
 * Slurm job state as returned by squeue/sacct
 */
export type SlurmJobState =
  | 'PENDING'      // Job is awaiting resource allocation
  | 'RUNNING'      // Job currently has an allocation
  | 'SUSPENDED'    // Job has an allocation, but execution has been suspended
  | 'COMPLETING'   // Job is in the process of completing
  | 'COMPLETED'    // Job terminated with exit code 0
  | 'FAILED'       // Job terminated with non-zero exit code
  | 'CANCELLED'    // Job was explicitly cancelled
  | 'TIMEOUT'      // Job terminated upon reaching its time limit
  | 'PREEMPTED'    // Job terminated due to preemption
  | 'NODE_FAIL'    // Job terminated due to node failure
  | 'OUT_OF_MEMORY'// Job was killed due to running out of memory
  | 'UNKNOWN'      // Unknown state

/**
 * Map Slurm job state to Nexus task status
 */
export function mapSlurmStateToTaskStatus(state: SlurmJobState): 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'timeout' {
  switch (state) {
    case 'PENDING':
      return 'queued'
    case 'RUNNING':
    case 'COMPLETING':
    case 'SUSPENDED':
      return 'in_progress'
    case 'COMPLETED':
      return 'completed'
    case 'FAILED':
    case 'NODE_FAIL':
    case 'OUT_OF_MEMORY':
      return 'failed'
    case 'CANCELLED':
    case 'PREEMPTED':
      return 'cancelled'
    case 'TIMEOUT':
      return 'timeout'
    default:
      return 'failed'
  }
}

/**
 * GPU specification for Slurm jobs
 */
export interface SlurmGpuSpec {
  /** GPU type (e.g., 'a100', 'v100', 'rtx3090') */
  type?: string
  /** Number of GPUs requested */
  count: number
}

/**
 * Slurm job resource requirements
 */
export interface SlurmResourceRequirements {
  /** Partition to submit to (e.g., 'gpu', 'cpu', 'interactive') */
  partition?: string
  /** Number of nodes */
  nodes?: number
  /** Number of tasks */
  ntasks?: number
  /** Number of tasks per node */
  ntasksPerNode?: number
  /** CPUs per task */
  cpusPerTask?: number
  /** Memory per node (e.g., '16G', '32000M') */
  mem?: string
  /** Memory per CPU (e.g., '4G') */
  memPerCpu?: string
  /** GPU specification */
  gpu?: SlurmGpuSpec
  /** Time limit (e.g., '1:00:00', '2-00:00:00') */
  time?: string
  /** Quality of Service */
  qos?: string
  /** Account to charge */
  account?: string
  /** Node constraint (e.g., 'gpu', 'haswell') */
  constraint?: string
  /** Exclude specific nodes */
  exclude?: string
  /** Request specific nodes */
  nodelist?: string
}

/**
 * Slurm job configuration
 */
export interface SlurmJobConfig {
  /** Job name */
  name: string
  /** Working directory */
  workdir?: string
  /** Output file path (supports %j for job ID) */
  output?: string
  /** Error file path (supports %j for job ID) */
  error?: string
  /** Email address for notifications */
  mailUser?: string
  /** Email notification types */
  mailType?: ('BEGIN' | 'END' | 'FAIL' | 'ALL' | 'NONE')[]
  /** Resource requirements */
  resources: SlurmResourceRequirements
  /** Environment variables to export */
  environment?: Record<string, string>
  /** Module to load (e.g., ['cuda/11.8', 'python/3.10']) */
  modules?: string[]
  /** Commands to execute */
  commands: string[]
  /** Job dependencies (job IDs that must complete first) */
  dependencies?: SlurmJobDependency[]
  /** Whether this is a job array */
  array?: SlurmArraySpec
}

/**
 * Slurm job array specification
 */
export interface SlurmArraySpec {
  /** Array range (e.g., '0-10', '1,2,5,9', '0-100%10') */
  range: string
  /** Maximum concurrent tasks (optional) */
  maxConcurrent?: number
}

/**
 * Slurm job dependency specification
 */
export interface SlurmJobDependency {
  /** Dependency type */
  type: 'after' | 'afterany' | 'afterok' | 'afternotok' | 'aftercorr' | 'singleton'
  /** Job ID(s) to depend on */
  jobIds: string[]
}

// ============================================================================
// Slurm Job Status & Tracking
// ============================================================================

/**
 * Slurm job info from squeue/sacct
 */
export interface SlurmJobInfo {
  /** Slurm job ID */
  jobId: string
  /** Array task ID (for job arrays) */
  arrayTaskId?: string
  /** Job name */
  name: string
  /** Job state */
  state: SlurmJobState
  /** State reason (e.g., 'Resources', 'Priority') */
  stateReason?: string
  /** User who submitted the job */
  user: string
  /** Partition */
  partition: string
  /** Number of nodes allocated */
  nodes: number
  /** Number of CPUs allocated */
  cpus: number
  /** Time limit */
  timeLimit?: string
  /** Time used */
  timeUsed?: string
  /** Submit time */
  submitTime?: Date
  /** Start time */
  startTime?: Date
  /** End time */
  endTime?: Date
  /** Exit code */
  exitCode?: number
  /** Node list */
  nodeList?: string
  /** Priority */
  priority?: number
  /** Expected start time (if pending) */
  startTimeEstimate?: Date
  /** Position in queue (if pending) */
  queuePosition?: number
}

/**
 * Slurm job submission result
 */
export interface SlurmSubmitResult {
  /** Whether submission was successful */
  success: boolean
  /** Slurm job ID (if successful) */
  jobId?: string
  /** Array job IDs (if job array) */
  arrayJobIds?: string[]
  /** Error message (if failed) */
  error?: string
  /** Batch script path */
  scriptPath?: string
}

/**
 * Slurm cluster info
 */
export interface SlurmClusterInfo {
  /** Cluster name */
  clusterName: string
  /** Slurm version */
  slurmVersion: string
  /** Available partitions */
  partitions: SlurmPartitionInfo[]
  /** Available QOS levels */
  qosLevels: string[]
  /** Available accounts for user */
  accounts: string[]
  /** Default partition */
  defaultPartition?: string
}

/**
 * Slurm partition info
 */
export interface SlurmPartitionInfo {
  /** Partition name */
  name: string
  /** Whether this is the default partition */
  isDefault: boolean
  /** Total nodes */
  totalNodes: number
  /** Available nodes */
  availableNodes: number
  /** Max time limit */
  maxTime?: string
  /** Default time limit */
  defaultTime?: string
  /** Max memory per node */
  maxMemPerNode?: string
  /** Available features (constraints) */
  features: string[]
  /** GPU info if available */
  gpuInfo?: {
    totalGpus: number
    availableGpus: number
    gpuTypes: string[]
  }
}

// ============================================================================
// Nexus-Slurm Integration
// ============================================================================

/**
 * Nexus task to Slurm job mapping
 */
export interface NexusSlurmJob {
  /** Nexus task ID */
  taskId: string
  /** Nexus project ID */
  projectId: string
  /** Nexus node ID */
  nodeId: string
  /** Slurm job ID */
  slurmJobId: string
  /** Array task IDs if job array */
  arrayTaskIds?: string[]
  /** Machine ID (relay connection) */
  machineId: string
  /** Batch script content */
  scriptContent: string
  /** Batch script path on cluster */
  scriptPath: string
  /** Output file path */
  outputPath: string
  /** Error file path */
  errorPath: string
  /** Job configuration used */
  config: SlurmJobConfig
  /** Current job status */
  status: SlurmJobInfo
  /** Submission time */
  submittedAt: Date
  /** Last status update */
  lastUpdatedAt: Date
  /** Accumulated stdout */
  stdout: string
  /** Accumulated stderr */
  stderr: string
}

/**
 * Slurm execution context for task dispatch
 */
export interface SlurmExecutionContext {
  /** Slurm cluster info */
  clusterInfo: SlurmClusterInfo
  /** Default resource requirements */
  defaultResources?: SlurmResourceRequirements
  /** Working directory on cluster */
  workingDirectory: string
  /** Scratch directory for job output */
  scratchDirectory?: string
  /** Module environment setup */
  moduleSetup?: string[]
  /** Environment variables */
  environment?: Record<string, string>
}

/**
 * Parse resource requirements from task description
 */
export interface SlurmResourceHints {
  /** Detected partition preference */
  partition?: string
  /** Detected GPU requirements */
  gpus?: number
  /** Detected GPU type preference */
  gpuType?: string
  /** Detected memory requirements (MB) */
  memoryMB?: number
  /** Detected time limit (minutes) */
  timeLimitMinutes?: number
  /** Detected CPU requirements */
  cpus?: number
  /** Detected node count */
  nodes?: number
  /** Additional SBATCH directives from task */
  sbatchDirectives?: string[]
}

// ============================================================================
// WebSocket Protocol Extensions for Slurm
// ============================================================================

/**
 * Slurm-specific machine info extension
 */
export interface SlurmMachineCapabilities {
  /** Whether Slurm is available */
  slurmAvailable: boolean
  /** Slurm version */
  slurmVersion?: string
  /** Cluster info */
  clusterInfo?: SlurmClusterInfo
  /** User's default account */
  defaultAccount?: string
  /** User's available QOS levels */
  availableQos?: string[]
}

/**
 * Slurm job status update message
 */
export interface SlurmJobStatusMessage {
  type: 'slurm.job.status'
  taskId: string
  jobInfo: SlurmJobInfo
  timestamp: Date
}

/**
 * Slurm job output message (tail -f from output file)
 */
export interface SlurmJobOutputMessage {
  type: 'slurm.job.output'
  taskId: string
  slurmJobId: string
  stream: 'stdout' | 'stderr'
  data: string
  timestamp: Date
}
