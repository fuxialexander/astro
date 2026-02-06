/**
 * Agent Runner
 *
 * Connects to the Nexus relay server via WebSocket and handles task execution.
 */

import WebSocket from 'ws'
import * as os from 'os'
import chalk from 'chalk'
import { generateMachineId } from './config.js'
import type { SlurmInfo } from './slurm-detect.js'
import { SlurmExecutor } from './slurm-executor.js'

export interface AgentRunnerOptions {
  relayUrl: string
  machineName?: string
  authToken?: string
  slurmInfo?: SlurmInfo
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
  environment: string
  preferredProvider?: string
  timeout?: number
  workingDirectory?: string
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
  private activeTasks = 0

  constructor(private options: AgentRunnerOptions) {
    this.machineId = generateMachineId()

    // Initialize Slurm executor if Slurm is available
    if (options.slurmInfo?.available) {
      this.slurmExecutor = new SlurmExecutor(options.slurmInfo)
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
          this.sessionId = message.sessionId
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
        this.handleTaskDispatch(message.task)
        break

      case 'task.cancel':
        this.handleTaskCancel(message.taskId, message.reason)
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

    if (task.preferredProvider === 'slurm' || task.environment === 'hpc') {
      if (!this.slurmExecutor) {
        this.sendTaskResult(task.taskId, {
          status: 'failed',
          error: 'Slurm not available on this machine',
        })
        return
      }

      this.activeTasks++
      this.updateStatus()

      try {
        // Execute via Slurm
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
      } catch (error) {
        this.sendTaskResult(task.taskId, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        this.activeTasks--
        this.updateStatus()
      }
    } else {
      // Non-Slurm task - not supported yet
      this.sendTaskResult(task.taskId, {
        status: 'failed',
        error: 'Only Slurm tasks are currently supported',
      })
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

    this.sendTaskResult(taskId, {
      status: 'cancelled',
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
