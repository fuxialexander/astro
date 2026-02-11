/**
 * Claude Code provider adapter
 *
 * Executes tasks using the Claude Code CLI (claude command)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Task, TaskResult, TaskArtifact } from '../types.js';
import type { ProviderAdapter, TaskOutputStream, ProviderStatus } from './base-adapter.js';
import { getProvider } from '../lib/providers.js';

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly type = 'claude-code';
  readonly name = 'Claude Code';

  private activeTasks = 0;
  private maxTasks = 1; // Claude Code runs one task at a time
  private lastError?: string;
  private claudePath: string | null = null;

  async isAvailable(): Promise<boolean> {
    const provider = await getProvider('claude-code');
    if (provider?.available) {
      this.claudePath = provider.path;
      return true;
    }
    return false;
  }

  async execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult> {
    if (!this.claudePath) {
      const available = await this.isAvailable();
      if (!available) {
        return {
          taskId: task.id,
          status: 'failed',
          error: 'Claude Code not available',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      }
    }

    this.activeTasks++;
    const startedAt = new Date().toISOString();

    try {
      stream.status('running', 0, 'Starting Claude Code');

      const result = await this.runClaude(task, stream, signal);

      return {
        taskId: task.id,
        status: result.exitCode === 0 ? 'completed' : 'failed',
        exitCode: result.exitCode,
        output: result.output,
        error: result.error,
        startedAt,
        completedAt: new Date().toISOString(),
        artifacts: result.artifacts,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.lastError = errorMsg;

      if (signal.aborted) {
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
      this.activeTasks--;
    }
  }

  async getStatus(): Promise<ProviderStatus> {
    const available = await this.isAvailable();
    const provider = await getProvider('claude-code');

    return {
      available,
      version: provider?.version ?? null,
      activeTasks: this.activeTasks,
      maxTasks: this.maxTasks,
      lastError: this.lastError,
    };
  }

  private runClaude(
    task: Task,
    stream: TaskOutputStream,
    signal: AbortSignal
  ): Promise<{ exitCode: number; output: string; error?: string; artifacts?: TaskArtifact[] }> {
    return new Promise((resolve, reject) => {
      // Build claude command arguments
      const args = [
        '--print', // Non-interactive mode, print output
        '--output-format', 'stream-json', // JSON streaming output for structured parsing
      ];

      // Claude Code expects the prompt as the last argument or via stdin
      // We'll pass it as an argument for simplicity
      args.push(task.prompt);

      const env = {
        ...process.env,
        ...task.environment,
      };

      let proc: ChildProcess;

      console.log(`[claude-code] Spawning: ${this.claudePath} --print --output-format stream-json <prompt>`);
      console.log(`[claude-code] cwd: ${task.workingDirectory}`);
      console.log(`[claude-code] prompt length: ${task.prompt.length} chars`);

      try {
        proc = spawn(this.claudePath!, args, {
          cwd: task.workingDirectory,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        console.error(`[claude-code] Spawn failed:`, error);
        reject(error);
        return;
      }

      // Close stdin immediately - we pass the prompt as an argument, not via stdin
      proc.stdin?.end();

      console.log(`[claude-code] Process spawned, pid=${proc.pid}`);

      let stdout = '';
      let stderr = '';
      const artifacts: TaskArtifact[] = [];

      // Handle abort signal
      const abortHandler = () => {
        proc.kill('SIGTERM');
        // Give it a moment, then force kill
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 5000);
      };

      signal.addEventListener('abort', abortHandler);

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        stream.stdout(text);

        // Try to parse JSON streaming output for progress/artifacts
        this.parseStreamOutput(text, stream, artifacts);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        console.log(`[claude-code] stderr: ${text.slice(0, 200)}`);
        stderr += text;
        stream.stderr(text);
      });

      proc.on('error', (error) => {
        console.error(`[claude-code] Process error:`, error);
        signal.removeEventListener('abort', abortHandler);
        reject(error);
      });

      proc.on('close', (code) => {
        console.log(`[claude-code] Process exited with code ${code}, stdout=${stdout.length} chars, stderr=${stderr.length} chars`);
        signal.removeEventListener('abort', abortHandler);

        resolve({
          exitCode: code ?? 1,
          output: stdout,
          error: stderr || undefined,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
        });
      });

      // Set up timeout if specified
      if (task.timeout) {
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGTERM');
            setTimeout(() => {
              if (!proc.killed) {
                proc.kill('SIGKILL');
              }
            }, 5000);
          }
        }, task.timeout);
      }
    });
  }

  private parseStreamOutput(
    text: string,
    stream: TaskOutputStream,
    artifacts: TaskArtifact[]
  ): void {
    // Claude Code with --output-format stream-json outputs JSON lines
    // Each line is a JSON object with type and content
    const lines = text.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as StreamEvent;

        switch (event.type) {
          case 'assistant':
            // Assistant response text, already streamed via stdout
            break;
          case 'result':
            // Final result with potential artifacts
            if (event.result?.files_created) {
              for (const file of event.result.files_created) {
                artifacts.push({
                  type: 'file',
                  name: file.path,
                  path: file.path,
                  metadata: { created: true },
                });
              }
            }
            if (event.result?.files_modified) {
              for (const file of event.result.files_modified) {
                artifacts.push({
                  type: 'file',
                  name: file.path,
                  path: file.path,
                  metadata: { modified: true },
                });
              }
            }
            stream.status('running', 100, 'Completed');
            break;
          case 'progress':
            // Progress update
            if (event.progress !== undefined) {
              stream.status('running', event.progress, event.message);
            }
            break;
          case 'error':
            stream.status('running', undefined, `Error: ${event.message}`);
            break;
        }
      } catch {
        // Not valid JSON, just raw text output - already handled
      }
    }
  }
}

interface StreamEvent {
  type: 'assistant' | 'result' | 'progress' | 'error' | 'tool_use' | 'tool_result';
  content?: string;
  message?: string;
  progress?: number;
  result?: {
    files_created?: Array<{ path: string }>;
    files_modified?: Array<{ path: string }>;
  };
}
