/**
 * Slurm Provider Adapter
 *
 * Implements the AgentProvider interface for Slurm HPC job execution.
 * This adapter translates Nexus task dispatches into Slurm job submissions.
 */

import type {
  AgentProvider,
  ProviderDetectionResult,
  ProviderCapabilities,
  TaskDispatch,
  TaskResult,
  StreamEvent,
  PreparedContext,
  TaskContext,
  TaskStatus,
} from '../types.js'
import { errorMessage } from '../../error-utils.js'
import {
  checkSlurmAvailable,
  getSlurmVersion,
  getClusterInfo,
  submitJob,
  cancelJob,
  JobWatcher,
  nexusSlurmJobRegistry,
} from '../../slurm/index.js'
import {
  taskToJobConfig,
} from '../../slurm/script-generator.js'
import type { SlurmClusterInfo, SlurmJobConfig } from '../../slurm/types.js'
import * as fs from 'fs/promises'
import * as path from 'path'

// Map of active task watchers for cancellation
const activeWatchers = new Map<string, JobWatcher>()

/**
 * Slurm provider adapter.
 * Submits jobs to Slurm and monitors their execution.
 */
export class SlurmProvider implements AgentProvider {
  readonly id = 'slurm'
  readonly name = 'Slurm HPC'

  private cachedDetection: ProviderDetectionResult | null = null
  private cachedClusterInfo: SlurmClusterInfo | null = null

  /**
   * Probe whether Slurm is available on this system.
   */
  async detect(): Promise<ProviderDetectionResult> {
    try {
      const available = await checkSlurmAvailable()

      if (!available) {
        this.cachedDetection = {
          installed: false,
          authStatus: 'unknown',
          message: 'Slurm commands not found. Ensure you are on an HPC login node.',
          detectedAt: new Date(),
        }
        return this.cachedDetection
      }

      const version = await getSlurmVersion()
      const clusterInfo = await getClusterInfo()
      this.cachedClusterInfo = clusterInfo || null

      this.cachedDetection = {
        installed: true,
        version,
        authStatus: 'authenticated', // If we can run sinfo, we're authenticated
        message: clusterInfo
          ? `Connected to ${clusterInfo.clusterName} (Slurm ${version})`
          : `Slurm ${version} available`,
        detectedAt: new Date(),
      }

      return this.cachedDetection
    } catch (error) {
      const message = errorMessage(error)

      this.cachedDetection = {
        installed: false,
        authStatus: 'unknown',
        message: `Slurm detection failed: ${message}`,
        detectedAt: new Date(),
      }

      return this.cachedDetection
    }
  }

  /**
   * Declare Slurm provider capabilities.
   */
  capabilities(): ProviderCapabilities {
    return {
      providerId: this.id,
      name: this.name,
      languages: ['*'], // Slurm can run any language
      taskTypes: [
        'code_generation',
        'code_analysis',
        'test_generation',
        'general',
      ],
      maxContextTokens: 0, // N/A for Slurm
      supportsStreaming: true,
      supportsCancellation: true,
      availableModels: [], // Slurm doesn't use models
      defaultModel: '',
      contextInjectionMethod: 'custom', // Slurm uses environment variables
      supportsSessionResume: false, // Jobs can't be resumed
      maxTurns: 1, // Single job execution
    }
  }

  /**
   * Execute a task by submitting it as a Slurm job.
   * This is the non-streaming execution path - waits for job completion.
   */
  async execute(task: TaskDispatch): Promise<TaskResult> {
    const startTime = Date.now()

    try {
      // Generate job config from task
      const jobConfig = this.taskToSlurmConfig(task)

      // Submit job
      const submitResult = await submitJob(jobConfig, task.context.workingDirectory)

      if (!submitResult.success || !submitResult.jobId) {
        return {
          taskId: task.taskId,
          status: 'error',
          errorMessage: submitResult.error || 'Job submission failed',
          metrics: { durationMs: Date.now() - startTime },
          providerId: this.id,
          completedAt: new Date(),
        }
      }

      const slurmJobId = submitResult.jobId

      // Register job in Nexus registry
      const outputPath = jobConfig.output || `nexus_${task.taskId}_${slurmJobId}.out`
      const errorPath = jobConfig.error || `nexus_${task.taskId}_${slurmJobId}.err`

      // Wait for job to complete
      const finalStatus = await this.waitForJobCompletion(slurmJobId, task.taskId, outputPath, errorPath)

      // Read output files
      let stdout = ''
      let stderr = ''
      try {
        stdout = await fs.readFile(outputPath, 'utf-8')
      } catch { /* File might not exist */ }
      try {
        stderr = await fs.readFile(errorPath, 'utf-8')
      } catch { /* File might not exist */ }

      const durationMs = Date.now() - startTime
      const taskStatus = this.mapSlurmStatusToTaskStatus(finalStatus?.state || 'UNKNOWN', finalStatus?.exitCode)

      return {
        taskId: task.taskId,
        status: taskStatus,
        stdout,
        stderr,
        metrics: {
          durationMs,
        },
        verification: {
          exitCode: finalStatus?.exitCode,
        },
        providerId: this.id,
        completedAt: new Date(),
      }
    } catch (error) {
      return {
        taskId: task.taskId,
        status: 'error',
        errorMessage: errorMessage(error),
        metrics: { durationMs: Date.now() - startTime },
        providerId: this.id,
        completedAt: new Date(),
      }
    }
  }

  /**
   * Execute a task with streaming output.
   * Yields events as job progresses.
   */
  async *stream(task: TaskDispatch): AsyncGenerator<StreamEvent, TaskResult, undefined> {
    const startTime = Date.now()

    try {
      // Emit init event
      yield {
        type: 'init',
        taskId: task.taskId,
        model: 'slurm',
        sessionId: `slurm-${Date.now()}`,
        timestamp: new Date(),
      }

      // Generate job config from task
      const jobConfig = this.taskToSlurmConfig(task)

      yield {
        type: 'progress',
        taskId: task.taskId,
        message: 'Generating Slurm batch script...',
        timestamp: new Date(),
      }

      // Submit job
      yield {
        type: 'progress',
        taskId: task.taskId,
        message: 'Submitting job to Slurm...',
        timestamp: new Date(),
      }

      const submitResult = await submitJob(jobConfig, task.context.workingDirectory)

      if (!submitResult.success || !submitResult.jobId) {
        yield {
          type: 'error',
          taskId: task.taskId,
          error: submitResult.error || 'Job submission failed',
          recoverable: false,
          timestamp: new Date(),
        }

        return {
          taskId: task.taskId,
          status: 'error',
          errorMessage: submitResult.error || 'Job submission failed',
          metrics: { durationMs: Date.now() - startTime },
          providerId: this.id,
          completedAt: new Date(),
        }
      }

      const slurmJobId = submitResult.jobId

      yield {
        type: 'text',
        taskId: task.taskId,
        text: `Job submitted: ${slurmJobId}\n`,
        timestamp: new Date(),
      }

      // Set up output paths
      const workdir = task.context.workingDirectory || process.cwd()
      const outputPath = path.join(workdir, jobConfig.output?.replace('%j', slurmJobId) || `nexus_${task.taskId}_${slurmJobId}.out`)
      const errorPath = path.join(workdir, jobConfig.error?.replace('%j', slurmJobId) || `nexus_${task.taskId}_${slurmJobId}.err`)

      // Create and start job watcher
      const watcher = new JobWatcher({
        jobId: slurmJobId,
        outputPath,
        errorPath,
        pollInterval: 2000,
      })

      activeWatchers.set(task.taskId, watcher)

      // Create a promise to track job completion
      let resolveCompletion: (status: import('../../slurm/types.js').SlurmJobInfo | undefined) => void
      const completionPromise = new Promise<import('../../slurm/types.js').SlurmJobInfo | undefined>(resolve => {
        resolveCompletion = resolve
      })

      // Buffer for collecting events
      const eventBuffer: StreamEvent[] = []
      let lastStatus: import('../../slurm/types.js').SlurmJobInfo | undefined

      // Set up event handlers
      watcher.on('status', (status: import('../../slurm/types.js').SlurmJobInfo) => {
        lastStatus = status
        eventBuffer.push({
          type: 'progress',
          taskId: task.taskId,
          message: `Job ${slurmJobId}: ${status.state}${status.stateReason ? ` (${status.stateReason})` : ''}`,
          timestamp: new Date(),
        })
      })

      watcher.on('started', (status: import('../../slurm/types.js').SlurmJobInfo) => {
        eventBuffer.push({
          type: 'text',
          taskId: task.taskId,
          text: `Job started on node: ${status.nodeList || 'unknown'}\n`,
          timestamp: new Date(),
        })
      })

      watcher.on('stdout', (data: string) => {
        eventBuffer.push({
          type: 'text',
          taskId: task.taskId,
          text: data,
          timestamp: new Date(),
        })
      })

      watcher.on('stderr', (data: string) => {
        eventBuffer.push({
          type: 'text',
          taskId: task.taskId,
          text: `[stderr] ${data}`,
          timestamp: new Date(),
        })
      })

      watcher.on('completed', (status: import('../../slurm/types.js').SlurmJobInfo) => {
        resolveCompletion(status)
      })

      watcher.on('error', (error: Error) => {
        eventBuffer.push({
          type: 'error',
          taskId: task.taskId,
          error: error.message,
          recoverable: true,
          timestamp: new Date(),
        })
      })

      // Start watching
      await watcher.start()

      // Yield events as they come in until job completes
      const checkInterval = 500 // ms

      while (true) {
        // Yield any buffered events
        while (eventBuffer.length > 0) {
          const event = eventBuffer.shift()
          if (event) yield event
        }

        // Check if job completed
        const completedStatus = await Promise.race([
          completionPromise,
          new Promise<null>(resolve => setTimeout(() => resolve(null), checkInterval)),
        ])

        if (completedStatus !== null) {
          lastStatus = completedStatus
          break
        }
      }

      // Clean up
      watcher.stop()
      activeWatchers.delete(task.taskId)

      // Read final output
      let stdout = ''
      let stderr = ''
      try {
        stdout = await fs.readFile(outputPath, 'utf-8')
      } catch { /* File might not exist */ }
      try {
        stderr = await fs.readFile(errorPath, 'utf-8')
      } catch { /* File might not exist */ }

      const durationMs = Date.now() - startTime
      const taskStatus = this.mapSlurmStatusToTaskStatus(lastStatus?.state || 'UNKNOWN', lastStatus?.exitCode)

      const result: TaskResult = {
        taskId: task.taskId,
        status: taskStatus,
        stdout,
        stderr,
        metrics: {
          durationMs,
        },
        verification: {
          exitCode: lastStatus?.exitCode,
        },
        providerId: this.id,
        completedAt: new Date(),
      }

      yield {
        type: 'result',
        taskId: task.taskId,
        result,
        timestamp: new Date(),
      }

      return result
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError'

      if (isAbort) {
        yield {
          type: 'aborted',
          taskId: task.taskId,
          reason: 'Job cancelled',
          timestamp: new Date(),
        }
      } else {
        yield {
          type: 'error',
          taskId: task.taskId,
          error: errorMessage(error),
          recoverable: false,
          timestamp: new Date(),
        }
      }

      const result: TaskResult = {
        taskId: task.taskId,
        status: isAbort ? 'cancelled' : 'error',
        errorMessage: errorMessage(error),
        metrics: { durationMs: Date.now() - startTime },
        providerId: this.id,
        completedAt: new Date(),
      }

      return result
    }
  }

  /**
   * Cancel a running Slurm job.
   */
  async cancel(taskId: string): Promise<boolean> {
    // Stop the watcher
    const watcher = activeWatchers.get(taskId)
    if (watcher) {
      watcher.stop()
      activeWatchers.delete(taskId)
    }

    // Get the Slurm job ID from registry
    const job = nexusSlurmJobRegistry.getByTaskId(taskId)
    if (job) {
      const result = await cancelJob(job.slurmJobId)
      nexusSlurmJobRegistry.remove(taskId)
      return result.success
    }

    return false
  }

  /**
   * Build context for Slurm execution.
   * For Slurm, context is injected via environment variables.
   */
  async prepareContext(context: TaskContext): Promise<PreparedContext> {
    const envVars: Record<string, string> = {}

    if (context.projectId) {
      envVars.NEXUS_PROJECT_ID = context.projectId
    }

    if (context.workingDirectory) {
      envVars.NEXUS_WORKDIR = context.workingDirectory
    }

    if (context.environment) {
      envVars.NEXUS_ENVIRONMENT = context.environment
    }

    return {
      method: 'custom',
      customData: { environment: envVars },
    }
  }

  /**
   * Convert a Nexus task dispatch to Slurm job config.
   */
  private taskToSlurmConfig(task: TaskDispatch): SlurmJobConfig {
    // Extract commands from task prompt
    // The prompt typically contains the script or commands to run
    const commands = this.extractCommands(task.prompt)

    // Get any Slurm-specific config from task metadata
    // The slurmConfig is passed via the extended SlurmTaskDispatch type
    interface SlurmConfig {
      partition?: string
      nodes?: number
      ntasks?: number
      cpusPerTask?: number
      mem?: string
      time?: string
      gpu?: { type?: string; count: number }
      qos?: string
      account?: string
      modules?: string[]
      workdir?: string
    }
    const slurmConfig = (task as TaskDispatch & { slurmConfig?: SlurmConfig }).slurmConfig

    // Build job config
    const config = taskToJobConfig({
      taskId: task.taskId,
      title: task.type || 'nexus_task',
      description: task.prompt,
      workingDirectory: slurmConfig?.workdir || task.context.workingDirectory,
      environment: task.context.environmentVariables,
      modules: slurmConfig?.modules,
      defaultAccount: slurmConfig?.account,
      defaultPartition: slurmConfig?.partition,
      commands,
    })

    // Override with explicit Slurm config if provided
    if (slurmConfig) {
      if (slurmConfig.nodes) config.resources.nodes = slurmConfig.nodes
      if (slurmConfig.ntasks) config.resources.ntasks = slurmConfig.ntasks
      if (slurmConfig.cpusPerTask) config.resources.cpusPerTask = slurmConfig.cpusPerTask
      if (slurmConfig.mem) config.resources.mem = slurmConfig.mem
      if (slurmConfig.time) config.resources.time = slurmConfig.time
      if (slurmConfig.qos) config.resources.qos = slurmConfig.qos
      if (slurmConfig.gpu) config.resources.gpu = slurmConfig.gpu
    }

    return config
  }

  /**
   * Extract commands from task prompt.
   * The prompt may contain:
   * - Direct shell commands
   * - Python/R script paths
   * - Code blocks with commands
   */
  private extractCommands(prompt: string): string[] {
    const commands: string[] = []

    // Look for code blocks first
    const codeBlockMatch = prompt.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/g)
    if (codeBlockMatch) {
      for (const block of codeBlockMatch) {
        const code = block.replace(/```(?:bash|sh|shell)?\n?/, '').replace(/```$/, '').trim()
        commands.push(code)
      }
      return commands
    }

    // Look for common command patterns
    const lines = prompt.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue

      // Look for command-like patterns
      if (
        trimmed.startsWith('python ') ||
        trimmed.startsWith('python3 ') ||
        trimmed.startsWith('Rscript ') ||
        trimmed.startsWith('bash ') ||
        trimmed.startsWith('./') ||
        trimmed.startsWith('make ') ||
        trimmed.startsWith('npm ') ||
        trimmed.startsWith('cargo ') ||
        trimmed.match(/^\w+\s+/) // Generic command pattern
      ) {
        commands.push(trimmed)
      }
    }

    // If no commands found, wrap the entire prompt as a comment + echo
    if (commands.length === 0) {
      commands.push(`# Task: ${prompt.substring(0, 200).replace(/\n/g, ' ')}`)
      commands.push('echo "No explicit commands found in task. Please specify commands to run."')
    }

    return commands
  }

  /**
   * Wait for a Slurm job to complete.
   */
  private async waitForJobCompletion(
    slurmJobId: string,
    taskId: string,
    outputPath: string,
    errorPath: string
  ): Promise<import('../../slurm/types.js').SlurmJobInfo | undefined> {
    return new Promise((resolve) => {
      const watcher = new JobWatcher({
        jobId: slurmJobId,
        outputPath,
        errorPath,
        pollInterval: 5000,
      })

      activeWatchers.set(taskId, watcher)

      watcher.on('completed', (status) => {
        watcher.stop()
        activeWatchers.delete(taskId)
        resolve(status)
      })

      watcher.start()
    })
  }

  /**
   * Map Slurm job status to Nexus task status.
   */
  private mapSlurmStatusToTaskStatus(state: string, exitCode?: number): TaskStatus {
    switch (state) {
      case 'COMPLETED':
        return exitCode === 0 ? 'success' : 'failure'
      case 'FAILED':
      case 'NODE_FAIL':
      case 'OUT_OF_MEMORY':
        return 'failure'
      case 'CANCELLED':
      case 'PREEMPTED':
        return 'cancelled'
      case 'TIMEOUT':
        return 'failure' // Treat timeout as failure
      default:
        return 'error'
    }
  }

  /**
   * Get cached cluster info.
   */
  getClusterInfo(): SlurmClusterInfo | null {
    return this.cachedClusterInfo
  }
}

// Export singleton instance
export const slurmProvider = new SlurmProvider()
