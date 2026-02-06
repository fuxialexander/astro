/**
 * Claude Agent SDK Adapter
 *
 * Executes tasks using the @anthropic-ai/claude-agent-sdk.
 * This provides programmatic access to Claude Code with full streaming support.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Task, TaskResult, TaskArtifact } from '../types.js';
import type { ProviderAdapter, TaskOutputStream, ProviderStatus } from './base-adapter.js';

export class ClaudeSdkAdapter implements ProviderAdapter {
  readonly type = 'claude-sdk';
  readonly name = 'Claude Agent SDK';

  private activeTasks = 0;
  private maxTasks = 4; // SDK supports concurrent tasks
  private lastError?: string;
  private isAuthenticated = false;
  private model = 'unknown';

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
      this.activeTasks--;
    }
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
    // Build options for the query
    const options: Parameters<typeof query>[0]['options'] = {
      abortController,
      maxTurns: 100, // Allow multi-turn for complex tasks
      tools: [], // Use default tools
      persistSession: false,
      workingDirectory: task.workingDirectory,
    };

    // Add environment variables if provided
    if (task.environment) {
      (options as Record<string, unknown>).env = task.environment;
    }

    const gen = query({
      prompt: task.prompt,
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
        stream.status('running', 5, `Model: ${msg.model}`);
      } else if (msg.type === 'assistant') {
        // Stream assistant text
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            output += block.text;
            stream.stdout(block.text);
          } else if (block.type === 'tool_use') {
            // Track tool usage
            progress = Math.min(progress + 10, 90);
            stream.status('running', progress, `Using tool: ${block.name}`);

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
              }
            }
          }
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          success = true;
          stream.status('completed', 100, 'Task completed successfully');
        } else if (msg.subtype === 'error') {
          success = false;
          errorMessage = 'Task failed';
          stream.status('failed', progress, 'Task failed');
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
