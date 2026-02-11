/**
 * Claude Agent SDK Adapter
 *
 * Executes tasks using the @anthropic-ai/claude-agent-sdk.
 * Uses StreamingPrompt for zero-serialization in-process execution
 * and supports mid-execution steering via message injection.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Task, TaskResult, TaskArtifact } from '../types.js';
import type { ProviderAdapter, TaskOutputStream, ProviderStatus } from './base-adapter.js';
import { StreamingPrompt } from '../lib/streaming-prompt.js';

export class ClaudeSdkAdapter implements ProviderAdapter {
  readonly type = 'claude-sdk';
  readonly name = 'Claude Agent SDK';

  private activeTasks = 0;
  private maxTasks = 4; // SDK supports concurrent tasks
  private lastError?: string;
  private isAuthenticated = false;
  private model = 'unknown';

  /** Active StreamingPrompt instances per task ID */
  private activePrompts = new Map<string, StreamingPrompt>();

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
      this.activePrompts.delete(task.id);
      this.activeTasks--;
    }
  }

  /**
   * Inject a steering message into a running task's session.
   * Returns true if the message was successfully queued.
   */
  injectMessage(taskId: string, content: string): boolean {
    const prompt = this.activePrompts.get(taskId);
    if (!prompt) return false;
    prompt.addMessage(content);
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
    // Create StreamingPrompt for this task
    const streamingPrompt = new StreamingPrompt(task.prompt);
    this.activePrompts.set(task.id, streamingPrompt);

    // Build options for the query
    const options: Parameters<typeof query>[0]['options'] = {
      abortController,
      maxTurns: 100, // Allow multi-turn for complex tasks
      tools: [], // Use default tools
      persistSession: false,
      cwd: task.workingDirectory,
    };

    // Add environment variables if provided
    if (task.environment) {
      (options as Record<string, unknown>).env = task.environment;
    }

    // Pass StreamingPrompt as the prompt — SDK accepts AsyncIterable<SDKUserMessage>
    const gen = query({
      prompt: streamingPrompt as unknown as string,
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
        const sid = (msg as unknown as Record<string, unknown>).session_id as string ?? '';
        streamingPrompt.updateSessionId(sid);
        stream.status('running', 5, `Model: ${msg.model}`);
        stream.sessionInit(sid, msg.model);
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
          }
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          success = true;
          stream.status('completed', 100, 'Task completed successfully');
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

    // Signal completion to the streaming prompt
    streamingPrompt.complete();

    return {
      success,
      output,
      error: errorMessage,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    };
  }
}
