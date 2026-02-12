/**
 * Slurm Job Manager
 *
 * Handles job submission, monitoring, cancellation, and output streaming.
 * This module is designed to run on the HPC login node via the agent runner.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import { EventEmitter } from 'events'
import type {
  SlurmJobConfig,
  SlurmJobInfo,
  SlurmSubmitResult,
  SlurmClusterInfo,
  NexusSlurmJob,
  SlurmMachineCapabilities,
} from './types.js'
import {
  parseSqueueOutput,
  parseSacctOutput,
  parseSinfoOutput,
  parseSbatchOutput,
  parseSlurmVersion,
  parseSacctmgrOutput,
  parseClusterName,
} from './parser.js'
import { errorMessage } from '../error-utils.js'
import { generateBatchScript } from './script-generator.js'

const execAsync = promisify(exec)

// ============================================================================
// Slurm Command Wrappers
// ============================================================================

/**
 * Check if Slurm is available on this system
 */
export async function checkSlurmAvailable(): Promise<boolean> {
  try {
    await execAsync('which sinfo')
    return true
  } catch {
    return false
  }
}

/**
 * Get Slurm version
 */
export async function getSlurmVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync('sinfo --version')
    return parseSlurmVersion(stdout)
  } catch {
    return undefined
  }
}

/**
 * Get cluster information
 */
export async function getClusterInfo(): Promise<SlurmClusterInfo | undefined> {
  try {
    // Get cluster name
    const { stdout: configOutput } = await execAsync('scontrol show config | grep ClusterName')
    const clusterName = parseClusterName(configOutput) || 'unknown'

    // Get Slurm version
    const slurmVersion = await getSlurmVersion() || 'unknown'

    // Get partition info (use -h instead of --parsable2 for compatibility)
    const { stdout: sinfoOutput } = await execAsync(
      'sinfo -h -o "%P|%a|%l|%D|%T|%c|%m|%f|%G"'
    )
    const partitions = parseSinfoOutput(sinfoOutput)

    // Get user's accounts and QOS
    const username = process.env.USER || process.env.LOGNAME || 'unknown'
    let accounts: string[] = []
    let qosLevels: string[] = []

    try {
      const { stdout: sacctmgrOutput } = await execAsync(
        `sacctmgr -p show assoc user=${username} format=Account,QOS --noheader`
      )
      const assocInfo = parseSacctmgrOutput(sacctmgrOutput)
      accounts = assocInfo.accounts
      qosLevels = assocInfo.qosLevels
    } catch {
      // sacctmgr might not be available or user might not have permissions
    }

    const defaultPartition = partitions.find(p => p.isDefault)?.name

    return {
      clusterName,
      slurmVersion,
      partitions,
      qosLevels,
      accounts,
      defaultPartition,
    }
  } catch (error) {
    console.error('Failed to get cluster info:', error)
    return undefined
  }
}

/**
 * Get machine capabilities for Slurm
 */
export async function getSlurmMachineCapabilities(): Promise<SlurmMachineCapabilities> {
  const slurmAvailable = await checkSlurmAvailable()

  if (!slurmAvailable) {
    return { slurmAvailable: false }
  }

  const slurmVersion = await getSlurmVersion()
  const clusterInfo = await getClusterInfo()

  return {
    slurmAvailable: true,
    slurmVersion,
    clusterInfo,
    defaultAccount: clusterInfo?.accounts[0],
    availableQos: clusterInfo?.qosLevels,
  }
}

// ============================================================================
// Job Submission
// ============================================================================

/**
 * Submit a Slurm job
 */
export async function submitJob(
  config: SlurmJobConfig,
  scriptDir?: string
): Promise<SlurmSubmitResult> {
  try {
    // Generate batch script
    const script = generateBatchScript(config)

    // Determine script path
    const dir = scriptDir || process.cwd()
    const scriptPath = path.join(dir, `${config.name}_${Date.now()}.sh`)

    // Write script to file
    await fs.writeFile(scriptPath, script, { mode: 0o755 })

    // Submit with sbatch
    const { stdout, stderr } = await execAsync(`sbatch ${scriptPath}`)

    const result = parseSbatchOutput(stdout, stderr)
    result.scriptPath = scriptPath

    return result
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
    }
  }
}

/**
 * Submit job from existing script file
 */
export async function submitScriptFile(scriptPath: string): Promise<SlurmSubmitResult> {
  try {
    const { stdout, stderr } = await execAsync(`sbatch ${scriptPath}`)
    const result = parseSbatchOutput(stdout, stderr)
    result.scriptPath = scriptPath
    return result
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
    }
  }
}

// ============================================================================
// Job Monitoring
// ============================================================================

/**
 * Get job status from squeue
 */
export async function getJobStatus(jobId: string): Promise<SlurmJobInfo | undefined> {
  try {
    const { stdout } = await execAsync(
      `squeue -j ${jobId} -h -o "%i|%j|%T|%r|%u|%P|%D|%C|%l|%M|%V|%S|%e|%N|%Q"`
    )

    const jobs = parseSqueueOutput(stdout)
    return jobs.find(j => j.jobId === jobId || j.jobId + '_' + j.arrayTaskId === jobId)
  } catch {
    // Job might not be in queue anymore, try sacct
    return getJobStatusFromSacct(jobId)
  }
}

/**
 * Get job status from sacct (for completed jobs)
 */
export async function getJobStatusFromSacct(jobId: string): Promise<SlurmJobInfo | undefined> {
  try {
    const { stdout } = await execAsync(
      `sacct -j ${jobId} --parsable2 --noheader -o JobID,JobName,State,ExitCode,Start,End,Elapsed,MaxRSS,NodeList`
    )

    const jobs = parseSacctOutput(stdout)
    return jobs.find(j => j.jobId === jobId)
  } catch {
    return undefined
  }
}

/**
 * Get all jobs for current user
 */
export async function getUserJobs(): Promise<SlurmJobInfo[]> {
  try {
    const { stdout } = await execAsync(
      `squeue -u $USER -h -o "%i|%j|%T|%r|%u|%P|%D|%C|%l|%M|%V|%S|%e|%N|%Q"`
    )
    return parseSqueueOutput(stdout)
  } catch {
    return []
  }
}

/**
 * Get pending jobs in queue (for queue position estimation)
 */
export async function getPendingJobs(partition?: string): Promise<SlurmJobInfo[]> {
  try {
    const partitionFilter = partition ? `-p ${partition}` : ''
    const { stdout } = await execAsync(
      `squeue -t PENDING ${partitionFilter} -h -o "%i|%j|%T|%r|%u|%P|%D|%C|%l|%M|%V|%S|%e|%N|%Q"`
    )
    return parseSqueueOutput(stdout)
  } catch {
    return []
  }
}

// ============================================================================
// Job Control
// ============================================================================

/**
 * Cancel a Slurm job
 */
export async function cancelJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execAsync(`scancel ${jobId}`)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
    }
  }
}

/**
 * Cancel all jobs matching a pattern
 */
export async function cancelJobsByName(namePattern: string): Promise<{ success: boolean; cancelled: number; error?: string }> {
  try {
    await execAsync(`scancel --name=${namePattern}`)
    // scancel doesn't report how many jobs were cancelled
    return { success: true, cancelled: -1 }
  } catch (error) {
    return {
      success: false,
      cancelled: 0,
      error: errorMessage(error),
    }
  }
}

// ============================================================================
// Output Streaming
// ============================================================================

/**
 * Job output streamer - watches job output files and emits data events
 */
export class JobOutputStreamer extends EventEmitter {
  private jobId: string
  private outputPath: string
  private errorPath: string
  private pollInterval: number
  private outputOffset = 0
  private errorOffset = 0
  private intervalId?: NodeJS.Timeout
  private isRunning = false

  constructor(options: {
    jobId: string
    outputPath: string
    errorPath: string
    pollInterval?: number
  }) {
    super()
    this.jobId = options.jobId
    this.outputPath = options.outputPath
    this.errorPath = options.errorPath
    this.pollInterval = options.pollInterval || 1000
  }

  /**
   * Start streaming output
   */
  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    // Initial read
    await this.readNewOutput()

    // Start polling
    this.intervalId = setInterval(async () => {
      try {
        await this.readNewOutput()
      } catch (error) {
        this.emit('error', error)
      }
    }, this.pollInterval)
  }

  /**
   * Stop streaming
   */
  stop(): void {
    this.isRunning = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
  }

  /**
   * Read new output from files
   */
  private async readNewOutput(): Promise<void> {
    // Read stdout
    try {
      const stats = await fs.stat(this.outputPath)
      if (stats.size > this.outputOffset) {
        const fd = await fs.open(this.outputPath, 'r')
        const buffer = Buffer.alloc(stats.size - this.outputOffset)
        await fd.read(buffer, 0, buffer.length, this.outputOffset)
        await fd.close()

        this.outputOffset = stats.size
        const data = buffer.toString('utf-8')
        if (data) {
          this.emit('stdout', data)
        }
      }
    } catch (error) {
      // File might not exist yet
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.emit('error', error)
      }
    }

    // Read stderr
    try {
      const stats = await fs.stat(this.errorPath)
      if (stats.size > this.errorOffset) {
        const fd = await fs.open(this.errorPath, 'r')
        const buffer = Buffer.alloc(stats.size - this.errorOffset)
        await fd.read(buffer, 0, buffer.length, this.errorOffset)
        await fd.close()

        this.errorOffset = stats.size
        const data = buffer.toString('utf-8')
        if (data) {
          this.emit('stderr', data)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.emit('error', error)
      }
    }
  }
}

// ============================================================================
// Job Watcher
// ============================================================================

/**
 * Watch a Slurm job until completion
 */
export class JobWatcher extends EventEmitter {
  private jobId: string
  private pollInterval: number
  private intervalId?: NodeJS.Timeout
  private outputStreamer?: JobOutputStreamer
  private lastState?: string
  private isRunning = false

  constructor(options: {
    jobId: string
    outputPath?: string
    errorPath?: string
    pollInterval?: number
  }) {
    super()
    this.jobId = options.jobId
    this.pollInterval = options.pollInterval || 5000

    if (options.outputPath && options.errorPath) {
      this.outputStreamer = new JobOutputStreamer({
        jobId: options.jobId,
        outputPath: options.outputPath,
        errorPath: options.errorPath,
        pollInterval: 1000,
      })

      this.outputStreamer.on('stdout', data => this.emit('stdout', data))
      this.outputStreamer.on('stderr', data => this.emit('stderr', data))
    }
  }

  /**
   * Start watching the job
   */
  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    // Start output streaming if configured
    if (this.outputStreamer) {
      await this.outputStreamer.start()
    }

    // Initial status check
    await this.checkStatus()

    // Start polling for status
    this.intervalId = setInterval(async () => {
      try {
        await this.checkStatus()
      } catch (error) {
        this.emit('error', error)
      }
    }, this.pollInterval)
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.isRunning = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
    if (this.outputStreamer) {
      this.outputStreamer.stop()
    }
  }

  /**
   * Check job status
   */
  private async checkStatus(): Promise<void> {
    const status = await getJobStatus(this.jobId)

    if (!status) {
      // Job not found in squeue, check sacct
      const completedStatus = await getJobStatusFromSacct(this.jobId)
      if (completedStatus) {
        this.emit('status', completedStatus)

        // Check if job is done
        if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY'].includes(completedStatus.state)) {
          this.emit('completed', completedStatus)
          this.stop()
        }
      }
      return
    }

    // Emit status update if state changed
    if (status.state !== this.lastState) {
      this.lastState = status.state
      this.emit('status', status)

      // Check if job started running
      if (status.state === 'RUNNING' && this.lastState === 'PENDING') {
        this.emit('started', status)
      }
    }

    // Check for terminal states
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY'].includes(status.state)) {
      this.emit('completed', status)
      this.stop()
    }
  }
}

// ============================================================================
// Nexus Job Registry
// ============================================================================

/**
 * In-memory registry of Nexus-to-Slurm job mappings
 */
export class NexusSlurmJobRegistry {
  private jobs = new Map<string, NexusSlurmJob>()
  private watchers = new Map<string, JobWatcher>()

  /**
   * Register a new job
   */
  register(job: NexusSlurmJob): void {
    this.jobs.set(job.taskId, job)
  }

  /**
   * Get job by Nexus task ID
   */
  getByTaskId(taskId: string): NexusSlurmJob | undefined {
    return this.jobs.get(taskId)
  }

  /**
   * Get job by Slurm job ID
   */
  getBySlurmJobId(slurmJobId: string): NexusSlurmJob | undefined {
    return Array.from(this.jobs.values()).find(j => j.slurmJobId === slurmJobId)
  }

  /**
   * Update job status
   */
  updateStatus(taskId: string, status: SlurmJobInfo): void {
    const job = this.jobs.get(taskId)
    if (job) {
      job.status = status
      job.lastUpdatedAt = new Date()
    }
  }

  /**
   * Append output
   */
  appendOutput(taskId: string, stream: 'stdout' | 'stderr', data: string): void {
    const job = this.jobs.get(taskId)
    if (job) {
      if (stream === 'stdout') {
        job.stdout += data
      } else {
        job.stderr += data
      }
    }
  }

  /**
   * Remove job from registry
   */
  remove(taskId: string): void {
    this.jobs.delete(taskId)
    const watcher = this.watchers.get(taskId)
    if (watcher) {
      watcher.stop()
      this.watchers.delete(taskId)
    }
  }

  /**
   * Get all jobs
   */
  getAll(): NexusSlurmJob[] {
    return Array.from(this.jobs.values())
  }

  /**
   * Start watching a job
   */
  startWatching(taskId: string): JobWatcher | undefined {
    const job = this.jobs.get(taskId)
    if (!job) return undefined

    const watcher = new JobWatcher({
      jobId: job.slurmJobId,
      outputPath: job.outputPath,
      errorPath: job.errorPath,
    })

    watcher.on('status', status => {
      this.updateStatus(taskId, status)
    })

    watcher.on('stdout', data => {
      this.appendOutput(taskId, 'stdout', data)
    })

    watcher.on('stderr', data => {
      this.appendOutput(taskId, 'stderr', data)
    })

    this.watchers.set(taskId, watcher)
    watcher.start()

    return watcher
  }

  /**
   * Stop watching a job
   */
  stopWatching(taskId: string): void {
    const watcher = this.watchers.get(taskId)
    if (watcher) {
      watcher.stop()
      this.watchers.delete(taskId)
    }
  }
}

// Export singleton registry
export const nexusSlurmJobRegistry = new NexusSlurmJobRegistry()
