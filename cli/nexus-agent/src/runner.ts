/**
 * Agent Runner
 *
 * Connects to the Nexus relay server via WebSocket and handles task execution.
 * Uses the Claude Agent SDK for task execution and git worktrees for isolation.
 */

import WebSocket from 'ws'
import * as os from 'os'
import chalk from 'chalk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { generateMachineId } from './config.js'
import type { SlurmInfo } from './slurm-detect.js'
import { SlurmExecutor } from './slurm-executor.js'

export interface AgentRunnerOptions {
  relayUrl: string
  machineName?: string
  authToken?: string
  slurmInfo?: SlurmInfo
  workingDirectory?: string
  /** Whether to use git worktrees for task isolation */
  useWorktree?: boolean
  /** Root directory for worktrees (defaults to temp dir) */
  worktreeRoot?: string
}

interface ClaudeInfo {
  available: boolean
  model?: string
  authenticated: boolean
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
  private claudeInfo: ClaudeInfo = { available: false, authenticated: false }
  private activeTasks = 0
  private workingDirectory: string
  private useWorktree: boolean
  private worktreeRoot?: string
  private activeAbortControllers: Map<string, AbortController> = new Map()

  constructor(private options: AgentRunnerOptions) {
    this.machineId = generateMachineId()
    this.workingDirectory = options.workingDirectory || process.cwd()
    this.useWorktree = options.useWorktree ?? true
    this.worktreeRoot = options.worktreeRoot

    // Initialize Slurm executor if Slurm is available
    if (options.slurmInfo?.available) {
      this.slurmExecutor = new SlurmExecutor(options.slurmInfo)
    }
  }

  /**
   * Initialize the agent runner and detect providers
   */
  static async create(options: AgentRunnerOptions): Promise<AgentRunner> {
    const runner = new AgentRunner(options)
    await runner.detectClaudeSdk()
    return runner
  }

  /**
   * Detect Claude Agent SDK availability
   */
  private async detectClaudeSdk(): Promise<void> {
    try {
      const abortController = new AbortController()

      // Minimal prompt to check authentication
      const gen = query({
        prompt: 'respond with ok',
        options: {
          abortController,
          maxTurns: 1,
          permissionMode: 'plan',
          tools: [],
          persistSession: false,
        },
      })

      for await (const msg of gen) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.claudeInfo = {
            available: true,
            model: msg.model,
            authenticated: true,
          }
          abortController.abort()
          break
        }
        if (msg.type === 'result') {
          this.claudeInfo = {
            available: true,
            authenticated: true,
          }
          break
        }
      }

      console.log(chalk.green(`✓ Claude Agent SDK detected (model: ${this.claudeInfo.model || 'default'})`))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      const isAuthError = message.includes('auth') || message.includes('login') || message.includes('API key')

      if (isAuthError) {
        console.log(chalk.yellow('⚠ Claude Agent SDK requires authentication. Run `claude login`.'))
      } else {
        console.log(chalk.gray(`  Claude Agent SDK not available: ${message}`))
      }

      this.claudeInfo = { available: false, authenticated: false }
    }
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
    for (const [taskId, controller] of this.activeAbortControllers) {
      controller.abort()
      console.log(chalk.yellow(`Cancelled task: ${taskId}`))
    }
    this.activeAbortControllers.clear()

    if (this.slurmExecutor) {
      await this.slurmExecutor.cancelAll()
    }

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

    // Add Claude SDK provider if available
    if (this.claudeInfo.available && this.claudeInfo.authenticated) {
      providers.push({
        type: 'claude-sdk',
        version: this.claudeInfo.model,
        status: 'available',
        maxConcurrentTasks: 4,
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
        maxConcurrentTasks: 50,
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
    } else if (this.claudeInfo.available && this.claudeInfo.authenticated) {
      await this.executeClaudeSdk(task)
    } else if (this.slurmExecutor) {
      await this.executeSlurm(task)
    } else {
      this.sendTaskResult(task.taskId, {
        status: 'failed',
        error: 'No execution provider available on this machine',
      })
    }
  }

  /**
   * Execute task via Claude Agent SDK
   */
  private async executeClaudeSdk(task: TaskDispatch): Promise<void> {
    this.activeTasks++
    this.updateStatus()

    const abortController = new AbortController()
    this.activeAbortControllers.set(task.taskId, abortController)

    const effectiveWorkingDir = task.workingDirectory || this.workingDirectory

    try {
      console.log(chalk.blue(`  Executing with Claude Agent SDK...`))

      // Build the full prompt with context
      const promptParts: string[] = []

      if (task.visionDoc) {
        promptParts.push(`## Project Vision\n\n${task.visionDoc}`)
      }

      if (task.dependencies && task.dependencies.length > 0) {
        promptParts.push(`## Previous Task Context\n\n${task.dependencies.join('\n\n---\n\n')}`)
      }

      promptParts.push(`## Current Task\n\n**${task.title}**\n\n${task.description}`)

      promptParts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient`)

      const prompt = promptParts.join('\n\n---\n\n')

      // Execute with Claude Agent SDK
      const gen = query({
        prompt,
        options: {
          abortController,
          maxTurns: 100,
          tools: [],
          persistSession: false,
          workingDirectory: effectiveWorkingDir,
        },
      })

      let output = ''
      let success = true
      let progress = 0

      for await (const msg of gen) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.sendTaskProgress(task.taskId, 5, `Model: ${msg.model}`)
        } else if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              output += block.text
              this.send({
                type: 'task.stdout',
                timestamp: new Date(),
                output: {
                  taskId: task.taskId,
                  stream: 'stdout',
                  data: block.text,
                  timestamp: new Date(),
                },
              })
            } else if (block.type === 'tool_use') {
              progress = Math.min(progress + 10, 90)
              this.sendTaskProgress(task.taskId, progress, `Using tool: ${block.name}`)

              // Send tool trace
              this.send({
                type: 'task.tool_trace',
                timestamp: new Date(),
                taskId: task.taskId,
                toolName: block.name,
                toolInput: block.input,
              })

              // Track file changes
              if (block.name === 'Write' || block.name === 'Edit') {
                const input = block.input as Record<string, unknown>
                if (input.file_path) {
                  this.send({
                    type: 'task.file_change',
                    timestamp: new Date(),
                    taskId: task.taskId,
                    path: String(input.file_path),
                    action: block.name === 'Write' ? 'created' : 'modified',
                  })
                }
              }
            }
          }
        } else if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            success = true
            this.sendTaskProgress(task.taskId, 100, 'Task completed')
          } else if (msg.subtype === 'error') {
            success = false
          }
          break
        }
      }

      this.sendTaskResult(task.taskId, {
        status: success ? 'completed' : 'failed',
        output,
        exitCode: success ? 0 : 1,
      })

      console.log(chalk.green(`  Task completed: ${success ? 'success' : 'failed'}`))
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const isAbort = error instanceof Error && error.name === 'AbortError'

      if (isAbort) {
        console.log(chalk.yellow(`  Task cancelled: ${task.taskId}`))
        this.sendTaskResult(task.taskId, {
          status: 'cancelled',
        })
      } else {
        console.error(chalk.red(`  Task failed: ${errorMsg}`))
        this.sendTaskResult(task.taskId, {
          status: 'failed',
          error: errorMsg,
        })
      }
    } finally {
      this.activeAbortControllers.delete(task.taskId)
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

    // Cancel Claude SDK task
    const controller = this.activeAbortControllers.get(taskId)
    if (controller) {
      controller.abort()
      this.activeAbortControllers.delete(taskId)
    }

    // Cancel Slurm task
    if (this.slurmExecutor) {
      await this.slurmExecutor.cancel(taskId)
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
    // Full steering support would require more complex interaction with Claude SDK
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
