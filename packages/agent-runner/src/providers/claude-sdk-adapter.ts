/**
 * Claude Agent SDK Adapter
 *
 * Executes tasks using the @anthropic-ai/claude-agent-sdk.
 * Runs in-process with zero serialization overhead.
 * Supports mid-execution steering via Query.streamInput().
 */

import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Task, TaskResult, TaskArtifact } from '../types.js';
import type { ProviderAdapter, TaskOutputStream, ProviderStatus } from './base-adapter.js';
import { buildHpcContext, type HpcContext } from '../lib/hpc-context.js';
import type { SlurmJobMonitor } from '../lib/slurm-job-monitor.js';

/** Active query state for a running task */
interface ActiveQuery {
  query: Query;
  sessionId: string;
}

export class ClaudeSdkAdapter implements ProviderAdapter {
  readonly type = 'claude-sdk';
  readonly name = 'Claude Agent SDK';

  private activeTasks = 0;
  private maxTasks = 4; // SDK supports concurrent tasks
  private lastError?: string;
  private isAuthenticated = false;
  private model = 'unknown';

  /** Active Query instances per task ID for steering */
  private activeQueries = new Map<string, ActiveQuery>();

  /** Lazily-initialized HPC context (undefined = not checked, null = not available) */
  private hpcContext: HpcContext | null | undefined = undefined;

  /** Optional Slurm job monitor for tracking sbatch submissions */
  private jobMonitor?: SlurmJobMonitor;

  /**
   * Set a SlurmJobMonitor for tracking batch job submissions.
   * Call this before executing tasks if HPC support is desired.
   */
  setJobMonitor(monitor: SlurmJobMonitor): void {
    this.jobMonitor = monitor;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const abortController = new AbortController();

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
      });

      for await (const msg of gen) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.model = msg.model;
          this.isAuthenticated = true;
          abortController.abort();
          break;
        }
        if (msg.type === 'result') {
          this.isAuthenticated = true;
          break;
        }
      }

      return this.isAuthenticated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.lastError = message;
      return false;
    }
  }

  async execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult> {
    this.activeTasks++;
    const startedAt = new Date().toISOString();

    // Create an abort controller that respects the signal
    const abortController = new AbortController();
    const abortHandler = () => abortController.abort();
    signal.addEventListener('abort', abortHandler);

    try {
      stream.status('running', 0, 'Starting Claude Agent SDK');

      const result = await this.runQuery(task, stream, abortController);

      return {
        taskId: task.id,
        status: result.success ? 'completed' : 'failed',
        exitCode: result.success ? 0 : 1,
        output: result.output,
        error: result.error,
        startedAt,
        completedAt: new Date().toISOString(),
        artifacts: result.artifacts,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.lastError = errorMsg;

      const isAbort = error instanceof Error && error.name === 'AbortError';

      if (signal.aborted || isAbort) {
        return {
          taskId: task.id,
          status: 'cancelled',
          error: 'Task cancelled',
          startedAt,
          completedAt: new Date().toISOString(),
        };
      }

      return {
        taskId: task.id,
        status: 'failed',
        error: errorMsg,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } finally {
      signal.removeEventListener('abort', abortHandler);
      this.activeQueries.delete(task.id);
      this.activeTasks--;
    }
  }

  /**
   * Inject a steering message into a running task's session.
   * Uses Query.streamInput() to feed a new user message into the running query.
   * When interrupt=true, calls Query.interrupt() first to stop the current turn.
   * Returns true if the message was successfully injected.
   */
  async injectMessage(taskId: string, content: string, interrupt = false): Promise<boolean> {
    const active = this.activeQueries.get(taskId);
    if (!active) return false;

    if (interrupt) {
      // Fire interrupt without awaiting — interrupt() may block until the
      // current turn finishes, which can take a long time.  We don't need
      // to wait for it; the SDK will process the interrupt and streamInput
      // in order internally.
      active.query.interrupt().catch(() => {
        /* agent may be idle between turns */
      });

      // Small delay to let the interrupt signal propagate before injecting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Create a single-message async iterable with proper SDKUserMessage shape
    const message = {
      type: 'user' as const,
      message: {
        role: 'user' as const,
        content,
      },
      parent_tool_use_id: null,
      session_id: active.sessionId,
    };

    // Single-shot async iterable
    const iterable = {
      async *[Symbol.asyncIterator]() {
        yield message;
      },
    };

    // streamInput returns a Promise — fire and forget
    active.query.streamInput(iterable).catch((err: Error) => {
      console.error(`[claude-sdk] Failed to inject steer message for task ${taskId}:`, err.message);
    });

    return true;
  }

  async getStatus(): Promise<ProviderStatus> {
    const available = this.isAuthenticated || (await this.isAvailable());

    return {
      available,
      version: this.model,
      activeTasks: this.activeTasks,
      maxTasks: this.maxTasks,
      lastError: this.lastError,
    };
  }

  private async runQuery(
    task: Task,
    stream: TaskOutputStream,
    abortController: AbortController
  ): Promise<{
    success: boolean;
    output: string;
    error?: string;
    artifacts?: TaskArtifact[];
  }> {
    // Ensure CLAUDE_CONFIG_DIR points to a user-writable location.
    // The SDK derives internal storage paths from cwd, and /tmp/claude/ may be
    // owned by another user on shared machines, causing EACCES errors.
    if (!process.env.CLAUDE_CONFIG_DIR) {
      process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.claude');
    }

    // Build options for the query
    const options: Parameters<typeof query>[0]['options'] = {
      abortController,
      maxTurns: task.maxTurns ?? 100, // Use dispatch-specified limit, or 100 for complex tasks
      permissionMode: 'bypassPermissions', // Auto-accept all tool calls
      sandbox: { enabled: false }, // Run on host machine, not in Docker container
      settingSources: ['project'], // Load CLAUDE.md, skills, and slash commands from cwd
      persistSession: false,
      cwd: task.workingDirectory,
    };

    // Add environment variables if provided
    if (task.environment) {
      (options as Record<string, unknown>).env = task.environment;
    }

    // Lazily initialize HPC context on first query
    if (this.hpcContext === undefined) {
      try {
        this.hpcContext = await buildHpcContext();
        if (this.hpcContext.available) {
          console.log(`[claude-sdk] HPC context loaded (cluster: ${this.hpcContext.slurmInfo?.clusterName ?? 'unknown'})`);
        }
      } catch {
        this.hpcContext = null;
      }
    }

    // Prepend HPC context to prompt if available
    let effectivePrompt = task.prompt;
    if (this.hpcContext?.available) {
      effectivePrompt = this.hpcContext.contextString + '\n\n---\n\n' + task.prompt;
    }

    // Add structured output format if requested (e.g., plan generation)
    if (task.outputFormat) {
      (options as Record<string, unknown>).outputFormat = task.outputFormat;
    }

    // Use plain string prompt — simple and reliable
    const gen = query({
      prompt: effectivePrompt,
      options,
    });

    let output = '';
    let success = true;
    let errorMessage: string | undefined;
    const artifacts: TaskArtifact[] = [];
    let progress = 0;

    for await (const msg of gen) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        this.model = msg.model;
        const sessionId = (msg as unknown as Record<string, unknown>).session_id as string ?? '';
        stream.status('running', 5, `Model: ${msg.model}`);
        stream.sessionInit(sessionId, msg.model);

        // Store the query instance for steering
        this.activeQueries.set(task.id, { query: gen, sessionId });
      } else if (msg.type === 'assistant') {
        // Stream assistant content blocks
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            output += block.text;
            stream.text(block.text);
          } else if (block.type === 'tool_use') {
            // Emit structured tool use
            progress = Math.min(progress + 10, 90);
            stream.status('running', progress, `Using tool: ${block.name}`);
            stream.toolUse(block.name, block.input);

            // Record file operations as artifacts
            if (block.name === 'Write' || block.name === 'Edit') {
              const input = block.input as Record<string, unknown>;
              if (input.file_path) {
                artifacts.push({
                  type: 'file',
                  name: String(input.file_path),
                  path: String(input.file_path),
                  metadata: { tool: block.name },
                });
                // Emit file change event
                const action = block.name === 'Write' ? 'created' : 'modified';
                stream.fileChange(String(input.file_path), action as 'created' | 'modified' | 'deleted');
              }
            }
          }
        }
      } else if (msg.type === 'user') {
        // Tool results from the SDK
        for (const block of msg.message.content) {
          if (block.type === 'tool_result') {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
            const isError = block.is_error ?? false;
            stream.toolResult(
              block.tool_use_id ?? 'unknown',
              resultContent,
              !isError,
            );

            // Detect sbatch submissions for job tracking
            if (this.jobMonitor && typeof resultContent === 'string') {
              const sbatchMatch = resultContent.match(/Submitted batch job (\d+)/);
              if (sbatchMatch) {
                const jobId = sbatchMatch[1];
                // Try to extract output path from sbatch script (common pattern: --output=...)
                const outputMatch = resultContent.match(/--output[= ](\S+)/);
                const outputPath = outputMatch?.[1]?.replace('%j', jobId);
                this.jobMonitor.trackJob(jobId, task.id, task.planNodeId, outputPath);
                console.log(`[claude-sdk] Detected sbatch submission: job ${jobId}`);
              }
            }
          }
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          success = true;
          stream.status('completed', 100, 'Task completed successfully');

          // Capture structured output (produced when outputFormat is set)
          const msgAny = msg as Record<string, unknown>;
          if (msgAny.structured_output) {
            const jsonStr = JSON.stringify(msgAny.structured_output);
            output += jsonStr;
            stream.text(jsonStr);
          } else if (msgAny.result && !output) {
            // Fallback: capture result text if no output was accumulated
            const resultStr = typeof msgAny.result === 'string'
              ? msgAny.result
              : JSON.stringify(msgAny.result);
            output += resultStr;
            stream.text(resultStr);
          }
        } else if (
          msg.subtype === 'error_during_execution' ||
          msg.subtype === 'error_max_turns' ||
          msg.subtype === 'error_max_budget_usd' ||
          msg.subtype === 'error_max_structured_output_retries'
        ) {
          success = false;
          errorMessage = `Task failed: ${msg.subtype}`;
          stream.status('failed', progress, errorMessage);
        }
        break;
      }
    }

    return {
      success,
      output,
      error: errorMessage,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    };
  }
}
