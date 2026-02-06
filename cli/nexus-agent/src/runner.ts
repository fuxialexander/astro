/**
 * Agent Runner
 *
 * Connects to the Nexus relay server via WebSocket and handles task execution.
 * Supports both Claude Code (local) and Slurm (HPC) execution.
 */

import WebSocket from 'ws'
import * as os from 'os'
import chalk from 'chalk'
import { generateMachineId } from './config.js'
import type { SlurmInfo } from './slurm-detect.js'
import { SlurmExecutor } from './slurm-executor.js'
import {
  ClaudeCodeExecutor,
  detectClaudeCode,
  type ClaudeCodeInfo,
  type TaskDispatch as ClaudeTaskDispatch,
} from './claude-code-executor.js'
import { createWorktree, type WorktreeSetup } from './worktree.js'

export interface AgentRunnerOptions {
  relayUrl: string
  machineName?: string
  authToken?: string
  slurmInfo?: SlurmInfo
  claudeCodeInfo?: ClaudeCodeInfo
  workingDirectory?: string
  /** Whether to use git worktrees for task isolation */
  useWorktree?: boolean
  /** Root directory for worktrees (defaults to temp dir) */
  worktreeRoot?: string
}

// Message types (matching server/types/relay.ts)
interface MachineRegisterMessage {
  type: 'machine.register'
  timestamp: Date
  machineId: string
  machineInfo: {
    name: string
    environmentType: 'local' | 'hpc' | 'cloud'
    hostname: string
    platform: string
    providers: Array<{
      type: string
      version?: string
      status: 'available' | 'busy' | 'unavailable' | 'error'
      maxConcurrentTasks: number
      currentTasks: number
      capabilities?: string[]
    }>
    resources: {
      cpuCores: number
      memoryMB: number
      gpuCount?: number
    }
    load: {
      cpuPercent: number
      memoryPercent: number
      activeTasks: number
      queuedTasks: number
    }
  }
}

interface TaskDispatch {
  taskId: string
  projectId: string
  nodeId: string
  title: string
  description: string
  visionDoc?: string
  environment: string
  preferredProvider?: string
  timeout?: number
  workingDirectory?: string
  dependencies?: string[]
  metadata?: Record<string, string>
}

export class AgentRunner {
  private ws: WebSocket | null = null
  private machineId: string
  private sessionId: string | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private heartbeatInterval: NodeJS.Timeout | null = null
  private slurmExecutor: SlurmExecutor | null = null
  private claudeCodeExecutor: ClaudeCodeExecutor | null = null
  private claudeCodeInfo: ClaudeCodeInfo | null = null
  private activeTasks = 0
  private workingDirectory: string
  private useWorktree: boolean
  private worktreeRoot?: string
  private activeWorktrees: Map<string, WorktreeSetup> = new Map()

  constructor(private options: AgentRunnerOptions) {
    this.machineId = generateMachineId()
    this.workingDirectory = options.workingDirectory || process.cwd()
    this.useWorktree = options.useWorktree ?? true
    this.worktreeRoot = options.worktreeRoot

    // Initialize Slurm executor if Slurm is available
    if (options.slurmInfo?.available) {
      this.slurmExecutor = new SlurmExecutor(options.slurmInfo)
    }

    // Initialize Claude Code executor if available
    if (options.claudeCodeInfo?.available) {
      this.claudeCodeInfo = options.claudeCodeInfo
      this.claudeCodeExecutor = new ClaudeCodeExecutor(options.claudeCodeInfo)
    }
  }

  /**
   * Initialize the agent runner and detect providers
   */
  static async create(options: Omit<AgentRunnerOptions, 'claudeCodeInfo'>): Promise<AgentRunner> {
    // Detect Claude Code availability
    const claudeCodeInfo = await detectClaudeCode()

    return new AgentRunner({
      ...options,
      claudeCodeInfo,
    })
  }

  /**
   * Connect to the relay server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.options.relayUrl

      // Add auth token to URL if provided
      const wsUrl = this.options.authToken
        ? `${url}?token=${this.options.authToken}`
        : url

      this.ws = new WebSocket(wsUrl)

      this.ws.on('open', () => {
        console.log(chalk.green('✓ Connected to relay server'))
        this.reconnectAttempts = 0
        this.register()
        this.startHeartbeat()
        resolve()
      })

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          this.handleMessage(message)
        } catch (error) {
          console.error(chalk.red('Failed to parse message:'), error)
        }
      })

      this.ws.on('close', (code, reason) => {
        console.log(chalk.yellow(`Disconnected (${code}): ${reason || 'Unknown'}`))
        this.stopHeartbeat()
        this.scheduleReconnect()
      })

      this.ws.on('error', (error) => {
        console.error(chalk.red('WebSocket error:'), error.message)
        if (this.reconnectAttempts === 0) {
          reject(error)
        }
      })
    })
  }

  /**
   * Disconnect from the relay server
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat()

    // Cancel any active tasks
    if (this.slurmExecutor) {
      await this.slurmExecutor.cancelAll()
    }
    if (this.claudeCodeExecutor) {
      await this.claudeCodeExecutor.cancelAll()
    }

    // Clean up any active worktrees
    for (const [taskId, worktree] of this.activeWorktrees) {
      try {
        await worktree.cleanup()
      } catch (err) {
        console.error(chalk.yellow(`Warning: Failed to clean up worktree for task ${taskId}: ${err}`))
      }
    }
    this.activeWorktrees.clear()

    if (this.ws) {
      // Send unregister message
      this.send({
        type: 'machine.unregister',
        timestamp: new Date(),
        machineId: this.machineId,
        reason: 'shutdown',
      })

      this.ws.close(1000, 'Shutting down')
      this.ws = null
    }
  }

  /**
   * Register with the relay server
   */
  private register(): void {
    const cpus = os.cpus()
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()

    const message: MachineRegisterMessage = {
      type: 'machine.register',
      timestamp: new Date(),
      machineId: this.machineId,
      machineInfo: {
        name: this.options.machineName || os.hostname(),
        environmentType: this.options.slurmInfo?.available ? 'hpc' : 'local',
        hostname: os.hostname(),
        platform: `${os.platform()} ${os.release()}`,
        providers: this.getProviders(),
        resources: {
          cpuCores: cpus.length,
          memoryMB: Math.round(totalMemory / 1024 / 1024),
        },
        load: {
          cpuPercent: this.getCpuUsage(),
          memoryPercent: Math.round(((totalMemory - freeMemory) / totalMemory) * 100),
          activeTasks: this.activeTasks,
          queuedTasks: 0,
        },
      },
    }

    this.send(message)
  }

  /**
   * Get available providers
   */
  private getProviders(): MachineRegisterMessage['machineInfo']['providers'] {
    const providers: MachineRegisterMessage['machineInfo']['providers'] = []

    // Add Claude Code provider if available
    if (this.claudeCodeInfo?.available) {
      providers.push({
        type: 'claude-code',
        version: this.claudeCodeInfo.version,
        status: this.claudeCodeInfo.authStatus === 'authenticated' ? 'available' : 'unavailable',
        maxConcurrentTasks: 4, // Configurable
        currentTasks: this.activeTasks,
        capabilities: [
          'streaming',
          'tools',
          'multi-turn',
          'file-editing',
          'code-generation',
        ],
      })
    }

    // Add Slurm provider if available
    if (this.options.slurmInfo?.available) {
      providers.push({
        type: 'slurm',
        version: this.options.slurmInfo.version,
        status: 'available',
        maxConcurrentTasks: 50, // Configurable
        currentTasks: this.activeTasks,
        capabilities: [
          'batch',
          'job-arrays',
          ...(this.options.slurmInfo.partitions.includes('gpu') ? ['gpu'] : []),
        ],
      })
    }

    return providers
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: Record<string, unknown>): void {
    switch (message.type) {
      case 'machine.register.ack':
        if (message.success) {
          this.sessionId = message.sessionId as string
          console.log(chalk.green(`✓ Registered (session: ${message.sessionId})`))
        } else {
          console.error(chalk.red(`Registration failed: ${message.error}`))
        }
        break

      case 'heartbeat.ping':
        this.send({
          type: 'heartbeat.pong',
          timestamp: new Date(),
          machineId: this.machineId,
        })
        break

      case 'task.dispatch':
        this.handleTaskDispatch(message.task as TaskDispatch)
        break

      case 'task.cancel':
        this.handleTaskCancel(message.taskId as string, message.reason as string | undefined)
        break

      case 'task.steer':
        this.handleTaskSteer(
          message.taskId as string,
          message.message as string,
          message.action as 'guidance' | 'redirect' | 'pause' | 'resume' | undefined
        )
        break

      case 'error':
        console.error(chalk.red(`Server error: ${message.message}`))
        break

      default:
        console.log(chalk.gray(`Unknown message type: ${message.type}`))
    }
  }

  /**
   * Handle task dispatch
   */
  private async handleTaskDispatch(task: TaskDispatch): Promise<void> {
    console.log(chalk.cyan(`\nReceived task: ${task.title}`))
    console.log(chalk.gray(`  ID: ${task.taskId}`))
    console.log(chalk.gray(`  Provider: ${task.preferredProvider || 'default'}`))

    // Send initial progress
    this.sendTaskProgress(task.taskId, 0, 'Task received, starting execution')

    // Determine which executor to use
    if (task.preferredProvider === 'slurm' || task.environment === 'hpc') {
      await this.executeSlurm(task)
    } else if (task.preferredProvider === 'claude-code' || task.environment === 'local') {
      await this.executeClaudeCode(task)
    } else if (this.claudeCodeExecutor) {
      // Default to Claude Code if available
      await this.executeClaudeCode(task)
    } else if (this.slurmExecutor) {
      // Fall back to Slurm if Claude Code not available
      await this.executeSlurm(task)
    } else {
      this.sendTaskResult(task.taskId, {
        status: 'failed',
        error: 'No execution provider available on this machine',
      })
    }
  }

  /**
   * Execute task via Claude Code
   */
  private async executeClaudeCode(task: TaskDispatch): Promise<void> {
    if (!this.claudeCodeExecutor) {
      this.sendTaskResult(task.taskId, {
        status: 'failed',
        error: 'Claude Code is not available on this machine',
      })
      return
    }

    this.activeTasks++
    this.updateStatus()

    let worktreeSetup: WorktreeSetup | null = null
    let effectiveWorkingDir = task.workingDirectory || this.workingDirectory

    try {
      console.log(chalk.blue(`  Executing with Claude Code...`))

      // Set up worktree for task isolation
      if (this.useWorktree) {
        this.sendTaskProgress(task.taskId, 5, 'Setting up isolated worktree...')
        worktreeSetup = await createWorktree({
          workingDirectory: effectiveWorkingDir,
          taskId: task.taskId,
          projectId: task.projectId,
          rootOverride: this.worktreeRoot,
          onOutput: (stream, data) => {
            this.send({
              type: 'task.stdout',
              timestamp: new Date(),
              output: {
                taskId: task.taskId,
                stream,
                data,
                timestamp: new Date(),
              },
            })
          },
        })

        if (worktreeSetup) {
          effectiveWorkingDir = worktreeSetup.workingDirectory
          this.activeWorktrees.set(task.taskId, worktreeSetup)
          console.log(chalk.gray(`  Worktree: ${effectiveWorkingDir}`))
          console.log(chalk.gray(`  Branch: ${worktreeSetup.branchName}`))
        }
      }

      const result = await this.claudeCodeExecutor.execute(
        {
          ...task,
          workingDirectory: effectiveWorkingDir,
        } as ClaudeTaskDispatch,
        {
          onOutput: (stream, data) => {
            this.send({
              type: 'task.stdout',
              timestamp: new Date(),
              output: {
                taskId: task.taskId,
                stream,
                data,
                timestamp: new Date(),
              },
            })
          },
          onProgress: (progress, message) => {
            // Adjust progress to account for worktree setup
            const adjustedProgress = this.useWorktree ? 5 + (progress * 0.95) : progress
            this.sendTaskProgress(task.taskId, Math.round(adjustedProgress), message)
          },
          onToolTrace: (toolName, toolInput, toolResult, success, duration) => {
            this.send({
              type: 'task.tool_trace',
              timestamp: new Date(),
              taskId: task.taskId,
              toolName,
              toolInput,
              toolResult,
              success,
              duration,
            })
          },
          onFileChange: (path, action, linesAdded, linesRemoved) => {
            this.send({
              type: 'task.file_change',
              timestamp: new Date(),
              taskId: task.taskId,
              path,
              action,
              linesAdded,
              linesRemoved,
            })
          },
        }
      )

      this.sendTaskResult(task.taskId, {
        status: result.status,
        output: result.output,
        error: result.error,
        exitCode: result.exitCode,
      })

      console.log(chalk.green(`  Task completed: ${result.status}`))
    } catch (error) {
      console.error(chalk.red(`  Task failed: ${error}`))
      this.sendTaskResult(task.taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      // Clean up worktree
      if (worktreeSetup) {
        try {
          await worktreeSetup.cleanup()
          this.activeWorktrees.delete(task.taskId)
        } catch (err) {
          console.error(chalk.yellow(`  Warning: Failed to clean up worktree: ${err}`))
        }
      }
      this.activeTasks--
      this.updateStatus()
    }
  }

  /**
   * Execute task via Slurm
   */
  private async executeSlurm(task: TaskDispatch): Promise<void> {
    if (!this.slurmExecutor) {
      this.sendTaskResult(task.taskId, {
        status: 'failed',
        error: 'Slurm is not available on this machine',
      })
      return
    }

    this.activeTasks++
    this.updateStatus()

    try {
      console.log(chalk.blue(`  Executing with Slurm...`))

      const result = await this.slurmExecutor.execute(task, {
        onStatus: (status) => {
          this.send({
            type: 'slurm.job.status',
            timestamp: new Date(),
            taskId: task.taskId,
            slurmJobId: status.jobId,
            jobInfo: status,
          })
        },
        onOutput: (stream, data) => {
          this.send({
            type: 'task.stdout',
            timestamp: new Date(),
            output: {
              taskId: task.taskId,
              stream,
              data,
              timestamp: new Date(),
            },
          })
        },
      })

      this.sendTaskResult(task.taskId, result)

      console.log(chalk.green(`  Task completed: ${result.status}`))
    } catch (error) {
      console.error(chalk.red(`  Task failed: ${error}`))
      this.sendTaskResult(task.taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      this.activeTasks--
      this.updateStatus()
    }
  }

  /**
   * Handle task cancellation
   */
  private async handleTaskCancel(taskId: string, reason?: string): Promise<void> {
    console.log(chalk.yellow(`\nCancelling task: ${taskId}`))
    if (reason) {
      console.log(chalk.gray(`  Reason: ${reason}`))
    }

    if (this.slurmExecutor) {
      await this.slurmExecutor.cancel(taskId)
    }
    if (this.claudeCodeExecutor) {
      await this.claudeCodeExecutor.cancel(taskId)
    }

    this.sendTaskResult(taskId, {
      status: 'cancelled',
    })
  }

  /**
   * Handle task steering (guidance injection)
   */
  private handleTaskSteer(
    taskId: string,
    message: string,
    action?: 'guidance' | 'redirect' | 'pause' | 'resume'
  ): void {
    console.log(chalk.yellow(`\nSteering task: ${taskId}`))
    console.log(chalk.gray(`  Action: ${action || 'guidance'}`))
    console.log(chalk.gray(`  Message: ${message}`))

    // Currently, we just acknowledge the steering message
    // Full steering support would require more complex interaction with Claude Code
    this.send({
      type: 'task.steer.ack',
      timestamp: new Date(),
      taskId,
      accepted: true,
      message: `Steering ${action || 'guidance'} acknowledged`,
    })
  }

  /**
   * Send task result
   */
  private sendTaskResult(
    taskId: string,
    result: { status: string; error?: string; output?: string; exitCode?: number }
  ): void {
    this.send({
      type: 'task.result',
      timestamp: new Date(),
      result: {
        taskId,
        status: result.status,
        error: result.error,
        output: result.output,
        exitCode: result.exitCode,
      },
    })
  }

  /**
   * Send task progress
   */
  private sendTaskProgress(taskId: string, progress: number, message?: string): void {
    this.send({
      type: 'task.progress',
      timestamp: new Date(),
      taskId,
      progress,
      message,
    })
  }

  /**
   * Update machine status
   */
  private updateStatus(): void {
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()

    this.send({
      type: 'machine.status',
      timestamp: new Date(),
      machineId: this.machineId,
      load: {
        cpuPercent: this.getCpuUsage(),
        memoryPercent: Math.round(((totalMemory - freeMemory) / totalMemory) * 100),
        activeTasks: this.activeTasks,
        queuedTasks: 0,
      },
      providers: this.getProviders(),
    })
  }

  /**
   * Get approximate CPU usage
   */
  private getCpuUsage(): number {
    const cpus = os.cpus()
    const loadAvg = os.loadavg()[0] // 1-minute load average
    return Math.min(100, Math.round((loadAvg / cpus.length) * 100))
  }

  /**
   * Send a message to the relay server
   */
  private send(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.updateStatus()
    }, 30000) // Every 30 seconds
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(chalk.red('Max reconnection attempts reached. Exiting.'))
      process.exit(1)
    }

    const delay = Math.min(30000, Math.pow(2, this.reconnectAttempts) * 1000)
    this.reconnectAttempts++

    console.log(chalk.gray(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`))

    setTimeout(() => {
      this.connect().catch(() => {
        // Error handled in connect()
      })
    }, delay)
  }
}
