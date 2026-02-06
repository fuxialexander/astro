/**
 * Base adapter interface for agent providers
 */

import type { Task, TaskResult, TaskStatus } from '../types.js';

export interface TaskOutputStream {
  stdout: (data: string) => void;
  stderr: (data: string) => void;
  status: (status: TaskStatus, progress?: number, message?: string) => void;
}

export interface ProviderAdapter {
  /**
   * Provider type identifier
   */
  readonly type: string;

  /**
   * Provider display name
   */
  readonly name: string;

  /**
   * Check if the provider is available and ready
   */
  isAvailable(): Promise<boolean>;

  /**
   * Execute a task using this provider
   */
  execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult>;

  /**
   * Get provider status/health
   */
  getStatus(): Promise<ProviderStatus>;
}

export interface ProviderStatus {
  available: boolean;
  version: string | null;
  activeTasks: number;
  maxTasks: number;
  lastError?: string;
}
