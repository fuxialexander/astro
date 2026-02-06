/**
 * Task executor with multiplexing support
 *
 * Handles concurrent task execution, routing to providers,
 * and streaming output back over WebSocket
 */

import type { Task, TaskStatus, ProviderType } from '../types.js';
import type { WebSocketClient } from './websocket-client.js';
import { createProviderAdapter, type ProviderAdapter } from '../providers/index.js';

interface RunningTask {
  task: Task;
  abortController: AbortController;
  adapter: ProviderAdapter;
  outputSequence: { stdout: number; stderr: number };
}

export interface TaskExecutorOptions {
  wsClient: WebSocketClient;
  maxConcurrentTasks?: number;
  defaultTimeout?: number;
}

export class TaskExecutor {
  private wsClient: WebSocketClient;
  private runningTasks: Map<string, RunningTask> = new Map();
  private taskQueue: Task[] = [];
  private maxConcurrentTasks: number;
  private defaultTimeout: number;
  private adapters: Map<ProviderType, ProviderAdapter> = new Map();

  constructor(options: TaskExecutorOptions) {
    this.wsClient = options.wsClient;
    this.maxConcurrentTasks = options.maxConcurrentTasks ?? 4;
    this.defaultTimeout = options.defaultTimeout ?? 3600000; // 1 hour
  }

  /**
   * Submit a task for execution
   */
  async submitTask(task: Task): Promise<void> {
    // Check if we can run immediately
    if (this.runningTasks.size < this.maxConcurrentTasks) {
      await this.executeTask(task);
    } else {
      // Queue the task
      this.taskQueue.push(task);
      this.wsClient.sendTaskStatus(task.id, 'queued', 0, 'Waiting for available slot');
    }
  }

  /**
   * Cancel a running or queued task
   */
  cancelTask(taskId: string): boolean {
    // Check running tasks
    const running = this.runningTasks.get(taskId);
    if (running) {
      running.abortController.abort();
      return true;
    }

    // Check queue
    const queueIndex = this.taskQueue.findIndex((t) => t.id === taskId);
    if (queueIndex >= 0) {
      this.taskQueue.splice(queueIndex, 1);
      this.wsClient.sendTaskResult({
        taskId,
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
      return true;
    }

    return false;
  }

  /**
   * Get current task counts
   */
  getTaskCounts(): { running: number; queued: number } {
    return {
      running: this.runningTasks.size,
      queued: this.taskQueue.length,
    };
  }

  /**
   * Cancel all tasks and clear queue
   */
  cancelAll(): void {
    // Cancel all running tasks
    for (const [taskId, running] of this.runningTasks) {
      running.abortController.abort();
      this.wsClient.sendTaskResult({
        taskId,
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
    }
    this.runningTasks.clear();

    // Clear queue
    for (const task of this.taskQueue) {
      this.wsClient.sendTaskResult({
        taskId: task.id,
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
    }
    this.taskQueue = [];
  }

  /**
   * Update max concurrent tasks
   */
  setMaxConcurrentTasks(max: number): void {
    this.maxConcurrentTasks = max;
    // Process queue in case we can now run more tasks
    this.processQueue();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async executeTask(task: Task): Promise<void> {
    // Get or create adapter for this provider
    const adapter = await this.getAdapter(task.provider);
    if (!adapter) {
      this.wsClient.sendTaskResult({
        taskId: task.id,
        status: 'failed',
        error: `Provider ${task.provider} not available`,
        completedAt: new Date().toISOString(),
      });
      this.processQueue();
      return;
    }

    const abortController = new AbortController();
    const outputSequence = { stdout: 0, stderr: 0 };

    const runningTask: RunningTask = {
      task,
      abortController,
      adapter,
      outputSequence,
    };

    this.runningTasks.set(task.id, runningTask);
    this.wsClient.addActiveTask(task.id);

    // Create stream handlers that send output over WebSocket
    const stream = {
      stdout: (data: string) => {
        this.wsClient.sendTaskOutput(task.id, 'stdout', data, outputSequence.stdout++);
      },
      stderr: (data: string) => {
        this.wsClient.sendTaskOutput(task.id, 'stderr', data, outputSequence.stderr++);
      },
      status: (status: TaskStatus, progress?: number, message?: string) => {
        this.wsClient.sendTaskStatus(task.id, status, progress, message);
      },
    };

    // Execute with timeout
    const timeout = task.timeout ?? this.defaultTimeout;
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);

    try {
      // Notify task started
      this.wsClient.sendTaskStatus(task.id, 'running', 0, 'Starting');

      // Execute the task
      const result = await adapter.execute(task, stream, abortController.signal);

      // Send final result
      this.wsClient.sendTaskResult(result);
    } catch (error) {
      // Unexpected error during execution
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.wsClient.sendTaskResult({
        taskId: task.id,
        status: 'failed',
        error: errorMsg,
        completedAt: new Date().toISOString(),
      });
    } finally {
      clearTimeout(timeoutId);
      this.runningTasks.delete(task.id);
      this.wsClient.removeActiveTask(task.id);
      this.processQueue();
    }
  }

  private async getAdapter(type: ProviderType): Promise<ProviderAdapter | null> {
    // Check cache
    const cached = this.adapters.get(type);
    if (cached) {
      return cached;
    }

    // Create new adapter
    const adapter = createProviderAdapter(type);
    if (!adapter) {
      return null;
    }

    // Check availability
    const available = await adapter.isAvailable();
    if (!available) {
      return null;
    }

    // Cache and return
    this.adapters.set(type, adapter);
    return adapter;
  }

  private processQueue(): void {
    while (this.runningTasks.size < this.maxConcurrentTasks && this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (task) {
        this.executeTask(task).catch(() => {
          // Error already handled in executeTask
        });
      }
    }
  }
}
