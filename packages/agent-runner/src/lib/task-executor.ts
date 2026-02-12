/**
 * Task executor with multiplexing support
 *
 * Handles concurrent task execution, routing to providers,
 * and streaming output back over WebSocket
 */

import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Task, TaskStatus, ProviderType } from '../types.js';
import type { WebSocketClient } from './websocket-client.js';
import { createProviderAdapter, type ProviderAdapter } from '../providers/index.js';
import { ClaudeSdkAdapter } from '../providers/claude-sdk-adapter.js';
import { SlurmJobMonitor } from './slurm-job-monitor.js';
import { createWorktree } from './worktree.js';
import { pushAndCreatePR } from './git-pr.js';

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
  useWorktree?: boolean;
  worktreeRoot?: string;
}

export class TaskExecutor {
  private wsClient: WebSocketClient;
  private runningTasks: Map<string, RunningTask> = new Map();
  private taskQueue: Task[] = [];
  private maxConcurrentTasks: number;
  private defaultTimeout: number;
  private adapters: Map<ProviderType, ProviderAdapter> = new Map();
  private useWorktree: boolean;
  private worktreeRoot?: string;
  private jobMonitor: SlurmJobMonitor;

  constructor(options: TaskExecutorOptions) {
    this.wsClient = options.wsClient;
    this.maxConcurrentTasks = options.maxConcurrentTasks ?? 4;
    this.defaultTimeout = options.defaultTimeout ?? 3600000; // 1 hour
    this.useWorktree = options.useWorktree ?? true;
    this.worktreeRoot = options.worktreeRoot;
    this.jobMonitor = new SlurmJobMonitor(options.wsClient);
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

    // Stop job monitor
    this.jobMonitor.stop();
  }

  /**
   * Update max concurrent tasks
   */
  setMaxConcurrentTasks(max: number): void {
    this.maxConcurrentTasks = max;
    // Process queue in case we can now run more tasks
    this.processQueue();
  }

  /**
   * Steer a running task by injecting a message into the agent session
   */
  steerTask(taskId: string, message: string): { accepted: boolean; reason?: string } {
    const running = this.runningTasks.get(taskId);
    if (!running) {
      return { accepted: false, reason: 'Task not found or not running' };
    }

    // Check if the adapter supports message injection
    if (running.adapter instanceof ClaudeSdkAdapter && typeof running.adapter.injectMessage === 'function') {
      const injected = running.adapter.injectMessage(taskId, message);
      if (injected) {
        return { accepted: true };
      }
      return { accepted: false, reason: 'Failed to inject message into running session' };
    }

    return { accepted: false, reason: 'Provider does not support mid-execution steering' };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async executeTask(task: Task): Promise<void> {
    // Resolve workingDirectory: git URL → local clone, empty → cwd
    const normalizedTask = {
      ...task,
      workingDirectory: resolveWorkingDirectory(task.workingDirectory, task.projectId),
    };
    console.log(`[executor] Task ${task.id}: workingDirectory resolved to ${normalizedTask.workingDirectory}`);

    // Get or create adapter for this provider
    const adapter = await this.getAdapter(normalizedTask.provider);
    if (!adapter) {
      console.error(`[executor] Task ${task.id}: provider ${normalizedTask.provider} not available`);
      this.wsClient.sendTaskResult({
        taskId: normalizedTask.id,
        status: 'failed',
        error: `Provider ${normalizedTask.provider} not available`,
        completedAt: new Date().toISOString(),
      });
      this.processQueue();
      return;
    }
    console.log(`[executor] Task ${task.id}: adapter ${adapter.name} (${adapter.type}) ready`);

    const abortController = new AbortController();
    const outputSequence = { stdout: 0, stderr: 0 };

    // Create stream handlers before workspace prep so setup output is captured
    let textSequence = 0;
    const stream = {
      stdout: (data: string) => {
        this.wsClient.sendTaskOutput(normalizedTask.id, 'stdout', data, outputSequence.stdout++);
      },
      stderr: (data: string) => {
        this.wsClient.sendTaskOutput(normalizedTask.id, 'stderr', data, outputSequence.stderr++);
      },
      status: (status: TaskStatus, progress?: number, message?: string) => {
        this.wsClient.sendTaskStatus(normalizedTask.id, status, progress, message);
      },
      toolTrace: (toolName: string, toolInput?: unknown, toolResult?: unknown, success?: boolean) => {
        this.wsClient.sendToolTrace(normalizedTask.id, toolName, toolInput, toolResult, success);
      },
      text: (data: string) => {
        this.wsClient.sendTaskText(normalizedTask.id, data, textSequence++);
      },
      toolUse: (toolName: string, toolInput: unknown) => {
        this.wsClient.sendTaskToolUse(normalizedTask.id, toolName, toolInput);
      },
      toolResult: (toolName: string, result: unknown, success: boolean) => {
        this.wsClient.sendTaskToolResult(normalizedTask.id, toolName, result, success);
      },
      fileChange: (path: string, action: 'created' | 'modified' | 'deleted', linesAdded?: number, linesRemoved?: number, diff?: string) => {
        this.wsClient.sendTaskFileChange(normalizedTask.id, path, action, linesAdded, linesRemoved, diff);
      },
      sessionInit: (sessionId: string, model?: string) => {
        this.wsClient.sendTaskSessionInit(normalizedTask.id, sessionId, model);
      },
    };

    const runningTask: RunningTask = {
      task: normalizedTask,
      abortController,
      adapter,
      outputSequence,
    };

    this.runningTasks.set(normalizedTask.id, runningTask);
    this.wsClient.addActiveTask(normalizedTask.id);

    const prepared = await this.prepareTaskWorkspace(normalizedTask, stream);
    const taskWithWorkspace = { ...normalizedTask, workingDirectory: prepared.workingDirectory };
    runningTask.task = taskWithWorkspace;
    console.log(`[executor] Task ${task.id}: workspace prepared, cwd=${prepared.workingDirectory}`);

    // Execute with timeout
    const timeout = task.timeout ?? this.defaultTimeout;
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);

    let keepBranch = false;
    try {
      // Notify task started
      this.wsClient.sendTaskStatus(task.id, 'running', 0, 'Starting');
      console.log(`[executor] Task ${task.id}: executing with ${adapter.name}...`);

      // Execute the task
      const result = await adapter.execute(taskWithWorkspace, stream, abortController.signal);

      // Attempt PR creation if worktree was used and execution succeeded
      if (prepared.branchName && (result.status === 'completed' || !result.error)) {
        try {
          console.log(`[executor] Task ${task.id}: attempting PR creation for branch ${prepared.branchName}`);
          const prResult = await pushAndCreatePR(prepared.workingDirectory, {
            branchName: prepared.branchName,
            taskTitle: task.prompt.slice(0, 100),
            taskDescription: task.prompt.slice(0, 500),
          });
          result.branchName = prResult.branchName;
          if (prResult.prUrl) {
            result.prUrl = prResult.prUrl;
            result.prNumber = prResult.prNumber;
            keepBranch = true;
            console.log(`[executor] Task ${task.id}: PR created at ${prResult.prUrl}`);
          } else if (prResult.branchName) {
            // Branch was pushed but no PR created (gh not available or no remote)
            keepBranch = true;
            console.log(`[executor] Task ${task.id}: branch pushed, no PR created`);
          }
        } catch (prError) {
          const prMsg = prError instanceof Error ? prError.message : String(prError);
          console.warn(`[executor] Task ${task.id}: PR creation failed: ${prMsg}`);
          // Non-fatal: still report the task result without PR info
        }
      }

      console.log(`[executor] Task ${task.id}: completed with status=${result.status}${result.error ? ` error=${result.error}` : ''}`);

      // Check if there are tracked Slurm jobs still running for this task.
      // If so, don't send the final result yet — let the job monitor handle it.
      const pendingJobs = this.jobMonitor.getJobsForExecution(task.id);
      if (pendingJobs.length > 0) {
        console.log(`[executor] Task ${task.id}: ${pendingJobs.length} Slurm job(s) still tracked, deferring completion`);
        this.wsClient.sendTaskStatus(task.id, 'running', 80, `Waiting for ${pendingJobs.length} Slurm job(s): ${pendingJobs.join(', ')}`);
        // Don't send final result — the SlurmJobMonitor will send it when jobs finish
      } else {
        // Send final result
        this.wsClient.sendTaskResult(result);
      }
    } catch (error) {
      // Unexpected error during execution
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[executor] Task ${task.id}: execution error: ${errorMsg}`);
      this.wsClient.sendTaskResult({
        taskId: task.id,
        status: 'failed',
        error: errorMsg,
        completedAt: new Date().toISOString(),
      });
    } finally {
      clearTimeout(timeoutId);
      await prepared.cleanup({ keepBranch });
      this.runningTasks.delete(task.id);
      this.wsClient.removeActiveTask(task.id);
      this.processQueue();
    }
  }

  private async prepareTaskWorkspace(
    task: Task,
    stream: { stdout: (data: string) => void; stderr: (data: string) => void },
  ): Promise<{
    workingDirectory: string;
    branchName?: string;
    cleanup: (options?: { keepBranch?: boolean }) => Promise<void>;
  }> {
    if (!this.useWorktree) {
      return { workingDirectory: task.workingDirectory, cleanup: async () => {} };
    }

    try {
      const worktree = await createWorktree({
        workingDirectory: task.workingDirectory,
        taskId: task.id,
        rootOverride: this.worktreeRoot,
        projectId: task.projectId,
        nodeId: task.planNodeId,
        stdout: stream.stdout,
        stderr: stream.stderr,
      });
      if (!worktree) {
        return { workingDirectory: task.workingDirectory, cleanup: async () => {} };
      }
      return worktree;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.wsClient.sendTaskStatus(task.id, 'running', 0, `Worktree setup failed: ${errorMsg}`);
      return { workingDirectory: task.workingDirectory, cleanup: async () => {} };
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

    // Wire up job monitor for HPC-aware adapters
    if (adapter instanceof ClaudeSdkAdapter) {
      adapter.setJobMonitor(this.jobMonitor);
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

/**
 * Resolve a working directory value.
 * - Git URL (http/https/git@) → clone to ~/.nexus/repos/{projectId}/ and return local path
 * - Empty/missing → process.cwd()
 * - Otherwise → return as-is
 */
function resolveWorkingDirectory(value: string | undefined, projectId: string): string {
  if (!value) return process.cwd();

  const isGitUrl = value.startsWith('http://') || value.startsWith('https://') || value.startsWith('git@');
  if (!isGitUrl) return value;

  const repoDir = join(homedir(), '.nexus', 'repos', projectId);
  const execOpts: ExecFileSyncOptions = { stdio: 'ignore', timeout: 120_000 };

  if (existsSync(join(repoDir, '.git'))) {
    // Already cloned — fetch latest (non-fatal)
    try {
      execFileSync('git', ['fetch', '--all'], { ...execOpts, cwd: repoDir });
    } catch {
      // Proceed with stale clone
    }
  } else {
    // Clone the repo
    execFileSync('git', ['clone', value, repoDir], execOpts);
  }

  return repoDir;
}
