/**
 * WebSocket client with automatic reconnection and heartbeat
 */

import WebSocket from 'ws';
import type {
  WSMessage,
  RegisterMessage,
  HeartbeatMessage,
  TaskStatusMessage,
  TaskOutputMessage,
  TaskResultMessage,
  ResourceUpdateMessage,
  RegisteredMessage,
  HeartbeatAckMessage,
  TaskDispatchMessage,
  TaskCancelMessage,
  ConfigUpdateMessage,
  ErrorMessage,
  ProviderInfo,
  RunnerConfig,
  RunnerEvent,
  RunnerEventHandler,
  TaskResult,
  Task,
} from '../types.js';
import { getMachineResources } from './resources.js';

const DEFAULT_CONFIG: RunnerConfig = {
  relayUrl: 'wss://relay.nexus.dev',
  maxConcurrentTasks: 4,
  heartbeatInterval: 30000, // 30 seconds
  reconnectMaxRetries: -1, // Infinite retries
  reconnectBaseDelay: 1000, // 1 second
  reconnectMaxDelay: 60000, // 1 minute
  taskTimeout: 3600000, // 1 hour
  logLevel: 'info',
};

export interface WebSocketClientOptions {
  runnerId: string;
  machineId: string;
  environmentType?: string;
  providers: ProviderInfo[];
  config?: Partial<RunnerConfig>;
  onEvent?: RunnerEventHandler;
  onTaskDispatch?: (task: Task) => void;
  onTaskCancel?: (taskId: string) => void;
  version?: string;
  wsToken?: string;
}

type IncomingMessage =
  | RegisteredMessage
  | HeartbeatAckMessage
  | TaskDispatchMessage
  | TaskCancelMessage
  | ConfigUpdateMessage
  | ErrorMessage;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: RunnerConfig;
  private runnerId: string;
  private machineId: string;
  private providers: ProviderInfo[];
  private version: string;
  private environmentType?: string;
  private wsToken?: string;

  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private activeTasks: Set<string> = new Set();

  private onEvent?: RunnerEventHandler;
  private onTaskDispatch?: (task: Task) => void;
  private onTaskCancel?: (taskId: string) => void;

  constructor(options: WebSocketClientOptions) {
    this.runnerId = options.runnerId;
    this.machineId = options.machineId;
    this.providers = options.providers;
    this.version = options.version ?? '0.1.0';
    this.environmentType = options.environmentType;
    this.wsToken = options.wsToken;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.onEvent = options.onEvent;
    this.onTaskDispatch = options.onTaskDispatch;
    this.onTaskCancel = options.onTaskCancel;
  }

  /**
   * Connect to the relay server
   */
  async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        const headers: Record<string, string> = {
          'X-Runner-Id': this.runnerId,
          'X-Machine-Id': this.machineId,
        };
        if (this.wsToken) {
          headers['Authorization'] = `Bearer ${this.wsToken}`;
        }
        this.ws = new WebSocket(this.config.relayUrl, { headers });

        this.ws.on('open', async () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          await this.handleOpen();
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        const thisSocket = this.ws;
        this.ws.on('close', (code, reason) => {
          // Only handle close if this is still the active socket.
          // When the server closes a stale connection after re-registration,
          // the old socket's close handler fires — ignore it to prevent a reconnect loop.
          if (this.ws !== thisSocket) {
            return;
          }
          this.handleClose(code, reason.toString());
        });

        this.ws.on('error', (error) => {
          this.isConnecting = false;
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
          this.emitEvent({ type: 'error', error: error as Error });
        });

        this.ws.on('pong', () => {
          // Server responded to ping, connection is alive
        });
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the relay server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.cleanup();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /**
   * Send a task status update
   */
  sendTaskStatus(
    taskId: string,
    status: TaskStatusMessage['payload']['status'],
    progress?: number,
    message?: string
  ): void {
    const msg: TaskStatusMessage = {
      type: 'task_status',
      timestamp: new Date().toISOString(),
      payload: { taskId, status, progress, message },
    };
    this.send(msg);
  }

  /**
   * Send task output (stdout/stderr)
   */
  sendTaskOutput(taskId: string, stream: 'stdout' | 'stderr', data: string, sequence: number): void {
    const msg: TaskOutputMessage = {
      type: 'task_output',
      timestamp: new Date().toISOString(),
      payload: { taskId, stream, data, sequence },
    };
    this.send(msg);
  }

  /**
   * Send task result
   */
  sendTaskResult(result: TaskResult): void {
    const msg: TaskResultMessage = {
      type: 'task_result',
      timestamp: new Date().toISOString(),
      payload: result,
    };
    this.send(msg);

    // Remove from active tasks
    this.activeTasks.delete(result.taskId);
  }

  /**
   * Send resource update
   */
  async sendResourceUpdate(): Promise<void> {
    const resources = await getMachineResources();
    const msg: ResourceUpdateMessage = {
      type: 'resource_update',
      timestamp: new Date().toISOString(),
      payload: { runnerId: this.runnerId, resources },
    };
    this.send(msg);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get current configuration
   */
  getConfig(): RunnerConfig {
    return { ...this.config };
  }

  /**
   * Get active task count
   */
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Add task to active set
   */
  addActiveTask(taskId: string): void {
    this.activeTasks.add(taskId);
  }

  /**
   * Remove task from active set
   */
  removeActiveTask(taskId: string): void {
    this.activeTasks.delete(taskId);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async handleOpen(): Promise<void> {
    // Send registration message
    const resources = await getMachineResources();
    const registerMsg: RegisterMessage = {
      type: 'register',
      timestamp: new Date().toISOString(),
      payload: {
        runnerId: this.runnerId,
        machineId: this.machineId,
        environmentType: this.environmentType,
        providers: this.providers,
        resources,
        version: this.version,
      },
    };
    this.send(registerMsg);

    // Start heartbeat
    this.startHeartbeat();

    this.emitEvent({ type: 'connected' });
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      const message = JSON.parse(data.toString()) as IncomingMessage;
      this.routeMessage(message);
    } catch (error) {
      this.emitEvent({ type: 'error', error: error as Error });
    }
  }

  private routeMessage(message: IncomingMessage): void {
    switch (message.type) {
      case 'registered':
        this.handleRegistered(message);
        break;
      case 'heartbeat_ack':
        // Heartbeat acknowledged, nothing to do
        break;
      case 'task_dispatch':
        this.handleTaskDispatch(message);
        break;
      case 'task_cancel':
        this.handleTaskCancel(message);
        break;
      case 'config_update':
        this.handleConfigUpdate(message);
        break;
      case 'error':
        this.handleError(message);
        break;
    }
  }

  private handleRegistered(message: RegisteredMessage): void {
    // Apply server-provided configuration
    if (message.payload.config) {
      this.config = { ...this.config, ...message.payload.config };
    }
  }

  private handleTaskDispatch(message: TaskDispatchMessage): void {
    const task = message.payload;

    // Check if we can accept more tasks
    if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
      this.sendTaskStatus(task.id, 'queued', 0, 'Waiting for available slot');
      return;
    }

    this.activeTasks.add(task.id);
    this.emitEvent({ type: 'task_received', task });
    this.onTaskDispatch?.(task);
  }

  private handleTaskCancel(message: TaskCancelMessage): void {
    const { taskId } = message.payload;
    this.activeTasks.delete(taskId);
    this.emitEvent({ type: 'task_cancelled', taskId });
    this.onTaskCancel?.(taskId);
  }

  private handleConfigUpdate(message: ConfigUpdateMessage): void {
    this.config = { ...this.config, ...message.payload };

    // Restart heartbeat with new interval if changed
    if (message.payload.heartbeatInterval) {
      this.stopHeartbeat();
      this.startHeartbeat();
    }
  }

  private handleError(message: ErrorMessage): void {
    const error = new Error(`${message.payload.code}: ${message.payload.message}`);
    this.emitEvent({ type: 'error', error });
  }

  private handleClose(code: number, reason: string): void {
    this.cleanup();
    this.emitEvent({ type: 'disconnected', reason: `${code}: ${reason}` });

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  private send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send application-level heartbeat
        const resources = await getMachineResources();
        const heartbeat: HeartbeatMessage = {
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
          payload: {
            runnerId: this.runnerId,
            activeTasks: Array.from(this.activeTasks),
            resources,
          },
        };
        this.send(heartbeat);

        // Also send WebSocket ping for connection health
        this.ws.ping();
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    const maxRetries = this.config.reconnectMaxRetries;
    if (maxRetries >= 0 && this.reconnectAttempts >= maxRetries) {
      return;
    }

    this.reconnectAttempts++;

    // Exponential backoff with jitter
    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1) +
        Math.random() * 1000,
      this.config.reconnectMaxDelay
    );

    this.emitEvent({ type: 'reconnecting', attempt: this.reconnectAttempts });

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch(() => {
        // Error already handled in connect()
      });
    }, delay);
  }

  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private emitEvent(event: RunnerEvent): void {
    this.onEvent?.(event);
  }
}
