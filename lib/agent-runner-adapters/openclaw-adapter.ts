/**
 * OpenClaw provider adapter
 *
 * Executes tasks using OpenClaw's ACP (Agent Client Protocol) mode.
 *
 * CLI invocation:
 *   openclaw acp --session <session-key>
 *
 * Communication: ACP protocol over stdio (JSON-RPC 2.0 nd-JSON)
 *
 * ACP Runtime Event types (from OpenClaw src/acp/runtime/types.ts):
 *   - text_delta: { text, stream?: "output" | "thought", tag? }
 *   - status: { text, tag?, used?, size? }
 *   - tool_call: { text, tag?, toolCallId?, status?, title? }
 *   - done: { stopReason? }
 *   - error: { message, code?, retryable? }
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants } from 'node:fs/promises';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type ProviderType = 'claude-code' | 'claude-sdk' | 'codex' | 'openclaw' | 'opencode' | 'slurm' | 'custom';

export interface Task {
  id: string;
  projectId: string;
  planNodeId: string;
  provider: ProviderType;
  prompt: string;
  workingDirectory: string;
  environment?: Record<string, string>;
  timeout?: number;
  systemPrompt?: string;
  model?: string;
  createdAt: string;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  exitCode?: number;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  artifacts?: TaskArtifact[];
  metrics?: {
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalCost?: number;
    model?: string;
    numTurns?: number;
  };
}

export interface TaskArtifact {
  type: 'file' | 'log' | 'metric';
  name: string;
  path?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskOutputStream {
  stdout: (data: string) => void;
  stderr: (data: string) => void;
  status: (status: TaskStatus, progress?: number, message?: string) => void;
  text: (data: string) => void;
  toolUse: (toolName: string, toolInput: unknown) => void;
  toolResult: (toolName: string, result: unknown, success: boolean) => void;
  fileChange: (path: string, action: 'created' | 'modified' | 'deleted', linesAdded?: number, linesRemoved?: number, diff?: string) => void;
  sessionInit: (sessionId: string, model?: string) => void;
}

export interface ProviderStatus {
  available: boolean;
  version: string | null;
  activeTasks: number;
  maxTasks: number;
  lastError?: string;
}

export interface ProviderAdapter {
  readonly type: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult>;
  getStatus(): Promise<ProviderStatus>;
}

// ============================================================================
// ACP Event Types
// ============================================================================

/**
 * ACP Runtime Event types (mirrors OpenClaw's AcpRuntimeEvent)
 */
type AcpTextDeltaEvent = {
  type: 'text_delta';
  text: string;
  stream?: 'output' | 'thought';
  tag?: string;
};

type AcpStatusEvent = {
  type: 'status';
  text: string;
  tag?: string;
  used?: number;
  size?: number;
};

type AcpToolCallEvent = {
  type: 'tool_call';
  text: string;
  tag?: string;
  toolCallId?: string;
  status?: string;
  title?: string;
};

type AcpDoneEvent = {
  type: 'done';
  stopReason?: string;
};

type AcpErrorEvent = {
  type: 'error';
  message: string;
  code?: string;
  retryable?: boolean;
};

type AcpRuntimeEvent =
  | AcpTextDeltaEvent
  | AcpStatusEvent
  | AcpToolCallEvent
  | AcpDoneEvent
  | AcpErrorEvent;

/**
 * ACP JSON-RPC message types
 */
type AcpJsonRpcRequest = {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type AcpJsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
};

type AcpJsonRpcResponse = {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

// ============================================================================
// Provider Detection
// ============================================================================

interface ProviderInfo {
  type: string;
  name: string;
  version: string | null;
  path: string;
  available: boolean;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    const platform = process.platform;
    const checkCommand = platform === 'win32' ? `where ${command}` : `which ${command}`;
    await execAsync(checkCommand, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function fileExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function getCommandVersion(command: string, versionArg = '--version'): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${command} ${versionArg}`, { timeout: 5000 });
    const versionMatch = stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
    return versionMatch?.[1] ?? stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

async function getCommandPath(command: string): Promise<string | null> {
  try {
    const platform = process.platform;
    const whichCommand = platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execAsync(`${whichCommand} ${command}`, { timeout: 5000 });
    return stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

function getOpenClawPaths(): string[] {
  const home = homedir();
  const platform = process.platform;

  const paths: string[] = [];

  paths.push(join(home, '.npm', 'bin', 'openclaw'));
  paths.push(join(home, '.npm-global', 'bin', 'openclaw'));
  paths.push(join(home, '.local', 'bin', 'openclaw'));
  paths.push(join(home, '.yarn', 'bin', 'openclaw'));
  paths.push(join(home, '.pnpm-global', 'bin', 'openclaw'));

  if (platform === 'darwin') {
    paths.push('/usr/local/bin/openclaw');
    paths.push('/opt/homebrew/bin/openclaw');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    paths.push(join(appData, 'npm', 'openclaw.cmd'));
    paths.push(join(appData, 'npm', 'openclaw'));
  } else {
    paths.push('/usr/local/bin/openclaw');
    paths.push('/usr/bin/openclaw');
  }

  return paths;
}

async function detectOpenClaw(): Promise<ProviderInfo | null> {
  const exists = await commandExists('openclaw');
  if (exists) {
    const path = await getCommandPath('openclaw');
    const version = await getCommandVersion('openclaw', '--version');

    return {
      type: 'openclaw',
      name: 'OpenClaw',
      version,
      path: path ?? 'openclaw',
      available: true,
    };
  }

  const commonPaths = getOpenClawPaths();
  for (const clawPath of commonPaths) {
    const isExecutable = await fileExecutable(clawPath);
    if (isExecutable) {
      const version = await getCommandVersion(clawPath, '--version');
      return {
        type: 'openclaw',
        name: 'OpenClaw',
        version,
        path: clawPath,
        available: true,
      };
    }
  }

  return null;
}

async function getProvider(type: string): Promise<ProviderInfo | null> {
  if (type === 'openclaw') {
    return detectOpenClaw();
  }
  return null;
}

// ============================================================================
// OpenClaw Adapter
// ============================================================================

export class OpenClawAdapter implements ProviderAdapter {
  readonly type = 'openclaw';
  readonly name = 'OpenClaw';

  private activeTasks = 0;
  private maxTasks = 1;
  private lastError?: string;
  private openclawPath: string | null = null;
  private configModel: string | null = null;

  async isAvailable(): Promise<boolean> {
    const provider = await getProvider('openclaw');
    if (provider?.available) {
      this.openclawPath = provider.path;
      this.configModel = this.readConfigModel();
      return true;
    }
    return false;
  }

  /**
   * Read the default model from ~/.openclaw/config.json
   */
  private readConfigModel(): string | null {
    try {
      const configPath = join(homedir(), '.openclaw', 'config.json');
      if (!existsSync(configPath)) return null;
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content) as { model?: string };
      return config.model ?? null;
    } catch {
      return null;
    }
  }

  async execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult> {
    if (!this.openclawPath) {
      const available = await this.isAvailable();
      if (!available) {
        return {
          taskId: task.id,
          status: 'failed',
          error: 'OpenClaw not available',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      }
    }

    this.activeTasks++;
    const startedAt = new Date().toISOString();

    try {
      stream.status('running', 0, 'Starting OpenClaw ACP');

      const result = await this.runOpenClaw(task, stream, signal);

      return {
        taskId: task.id,
        status: result.exitCode === 0 ? 'completed' : 'failed',
        exitCode: result.exitCode,
        output: result.output,
        error: result.error,
        startedAt,
        completedAt: new Date().toISOString(),
        artifacts: result.artifacts,
        metrics: result.metrics,
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
    const provider = await getProvider('openclaw');

    return {
      available,
      version: provider?.version ?? null,
      activeTasks: this.activeTasks,
      maxTasks: this.maxTasks,
      lastError: this.lastError,
    };
  }

  private runOpenClaw(
    task: Task,
    stream: TaskOutputStream,
    signal: AbortSignal
  ): Promise<{
    exitCode: number;
    output: string;
    error?: string;
    artifacts?: TaskArtifact[];
    metrics?: TaskResult['metrics'];
  }> {
    return new Promise((resolve, reject) => {
      // Generate a unique session key for this task
      const sessionKey = `astro:task:${task.id}`;

      // OpenClaw ACP mode: speaks ACP protocol over stdio
      const args = ['acp', '--session', sessionKey];

      const env = {
        ...process.env,
        ...task.environment,
      };

      // Validate working directory exists before spawning
      if (task.workingDirectory && !existsSync(task.workingDirectory)) {
        reject(new Error(
          `Working directory does not exist: ${task.workingDirectory}. ` +
          `Ensure the directory exists on this machine before dispatching.`
        ));
        return;
      }

      let proc: ChildProcess;

      try {
        proc = spawn(this.openclawPath!, args, {
          cwd: task.workingDirectory || undefined,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(error);
        return;
      }

      let stdout = '';
      let stderr = '';
      let lastMetrics: TaskResult['metrics'] | undefined;
      const artifacts: TaskArtifact[] = [];

      // Track active tool calls for proper toolUse/toolResult pairing
      const activeToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>();

      // ACP protocol state
      let messageId = 1;
      let sessionId: string | null = null;
      let promptSent = false;
      const startTime = Date.now();

      const abortHandler = () => {
        // Send ACP cancel notification before killing
        if (sessionId && proc.stdin?.writable) {
          const cancelNotification: AcpJsonRpcNotification = {
            jsonrpc: '2.0',
            method: 'notifications/cancel',
            params: { sessionId },
          };
          proc.stdin.write(JSON.stringify(cancelNotification) + '\n');
        }
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 5000);
      };

      signal.addEventListener('abort', abortHandler);

      // Helper to send ACP JSON-RPC request
      const sendRequest = (method: string, params?: Record<string, unknown>): void => {
        const id = messageId++;
        const request: AcpJsonRpcRequest = {
          jsonrpc: '2.0',
          id,
          method,
          params,
        };
        if (proc.stdin?.writable) {
          proc.stdin.write(JSON.stringify(request) + '\n');
        }
      };

      // Line buffer for incomplete nd-JSON lines
      let lineBuf = '';

      // Callbacks for ACP event handling
      const eventCallbacks = {
        onInitialized: (sid: string) => {
          sessionId = sid;
          stream.sessionInit(sid, this.configModel ?? undefined);

          // Now send the prompt
          if (!promptSent) {
            promptSent = true;
            const effectivePrompt = task.systemPrompt
              ? `${task.systemPrompt}\n\n---\n\n${task.prompt}`
              : task.prompt;

            sendRequest('prompt', {
              sessionId: sid,
              prompt: [{ type: 'text', text: effectivePrompt }],
            });
          }
        },
        onDone: (stopReason?: string) => {
          // Calculate metrics on done
          const durationMs = Date.now() - startTime;
          lastMetrics = {
            durationMs,
            model: this.configModel ?? undefined,
          };
          stream.status('running', 100, `Completed (${stopReason || 'success'})`);
        },
        onError: (message: string, code?: string) => {
          stream.stderr(`ACP Error [${code || 'unknown'}]: ${message}\n`);
        },
      };

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;

        lineBuf += text;
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            this.handleAcpLine(line, stream, artifacts, activeToolCalls, eventCallbacks);
          }
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        stream.stderr(text);
      });

      proc.on('error', (error) => {
        signal.removeEventListener('abort', abortHandler);
        reject(error);
      });

      proc.on('close', (code) => {
        // Flush remaining buffer
        if (lineBuf.trim()) {
          this.handleAcpLine(lineBuf, stream, artifacts, activeToolCalls, eventCallbacks);
        }

        signal.removeEventListener('abort', abortHandler);

        // Set final duration if not already set
        if (!lastMetrics) {
          lastMetrics = {
            durationMs: Date.now() - startTime,
            model: this.configModel ?? undefined,
          };
        }

        resolve({
          exitCode: code ?? 1,
          output: stdout,
          error: stderr || undefined,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          metrics: lastMetrics,
        });
      });

      // Start ACP protocol: send initialize request
      sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        clientCapabilities: {
          promptCapabilities: {
            image: false,
            audio: false,
            embeddedContext: false,
          },
          mcpCapabilities: {
            http: false,
            sse: false,
          },
        },
        clientInfo: {
          name: 'astro-agent-runner',
          version: '1.0.0',
        },
      });

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

  /**
   * Handle a single nd-JSON line from OpenClaw ACP.
   *
   * ACP messages can be:
   * - JSON-RPC responses: { jsonrpc: "2.0", id: ..., result/error: ... }
   * - Notifications: { jsonrpc: "2.0", method: "...", params: ... }
   * - Session updates with streaming events
   */
  private handleAcpLine(
    line: string,
    stream: TaskOutputStream,
    artifacts: TaskArtifact[],
    activeToolCalls: Map<string, { name: string; input: Record<string, unknown> }>,
    callbacks: {
      onInitialized: (sessionId: string) => void;
      onDone: (stopReason?: string) => void;
      onError: (message: string, code?: string) => void;
    }
  ): void {
    try {
      const message = JSON.parse(line) as Record<string, unknown>;

      // Handle JSON-RPC response
      if ('id' in message && message.jsonrpc === '2.0') {
        const response = message as AcpJsonRpcResponse;

        if (response.error) {
          callbacks.onError(response.error.message, String(response.error.code));
          return;
        }

        // Check if this is an initialize response or newSession response
        if (response.result && typeof response.result === 'object') {
          const result = response.result as Record<string, unknown>;

          // Check if this is a newSession response
          if ('sessionId' in result && typeof result.sessionId === 'string') {
            callbacks.onInitialized(result.sessionId);
            return;
          }
        }

        return;
      }

      // Handle notifications (session updates, streaming events)
      if ('method' in message && message.jsonrpc === '2.0') {
        const notification = message as { method: string; params?: Record<string, unknown> };

        if (notification.method === 'notifications/sessionUpdate' && notification.params) {
          this.handleSessionUpdate(notification.params, stream, activeToolCalls, callbacks);
          return;
        }

        return;
      }

      // Handle direct ACP runtime events (text_delta, tool_call, status, done, error)
      if ('type' in message) {
        this.handleAcpRuntimeEvent(message as AcpRuntimeEvent, stream, activeToolCalls, callbacks);
        return;
      }

    } catch {
      // Not valid JSON — could be raw output, ignore
    }
  }

  /**
   * Handle ACP session update notification
   */
  private handleSessionUpdate(
    params: Record<string, unknown>,
    stream: TaskOutputStream,
    activeToolCalls: Map<string, { name: string; input: Record<string, unknown> }>,
    callbacks: {
      onInitialized: (sessionId: string) => void;
      onDone: (stopReason?: string) => void;
      onError: (message: string, code?: string) => void;
    }
  ): void {
    const update = params.update as Record<string, unknown> | undefined;
    if (!update) return;

    const sessionUpdate = update.sessionUpdate as string | undefined;

    switch (sessionUpdate) {
      case 'agent_message_chunk': {
        // Text content from the agent
        const content = update.content as { type: string; text?: string } | undefined;
        if (content?.text) {
          stream.text(content.text);
        }
        break;
      }

      case 'agent_thought_chunk': {
        // Thought/reasoning content (typically displayed differently)
        const content = update.content as { type: string; text?: string } | undefined;
        if (content?.text) {
          // Output thought content as text (could be handled differently)
          stream.text(content.text);
        }
        break;
      }

      case 'tool_call': {
        // Tool use started
        const toolCallId = update.toolCallId as string | undefined;
        const title = update.title as string | undefined;
        const rawInput = update.rawInput as Record<string, unknown> | undefined;

        // Extract tool name from title (format: "toolName: arg1: value1, arg2: value2")
        const toolName = title?.split(':')[0]?.trim() || 'unknown';

        if (toolCallId) {
          activeToolCalls.set(toolCallId, { name: toolName, input: rawInput || {} });
        }

        stream.toolUse(toolName, rawInput || {});
        break;
      }

      case 'tool_call_update': {
        // Tool result received
        const toolCallId = update.toolCallId as string | undefined;
        const status = update.status as string | undefined;
        const rawOutput = update.rawOutput;

        const toolInfo = toolCallId ? activeToolCalls.get(toolCallId) : undefined;
        const toolName = toolInfo?.name || 'unknown';

        const success = status !== 'failed';
        stream.toolResult(toolName, rawOutput, success);

        if (toolCallId) {
          activeToolCalls.delete(toolCallId);
        }
        break;
      }

      case 'done': {
        // Session completed
        const stopReason = update.stopReason as string | undefined;
        callbacks.onDone(stopReason);
        break;
      }

      default:
        // Unknown session update type - ignore
        break;
    }
  }

  /**
   * Handle direct ACP runtime events (when not wrapped in session update)
   *
   * Maps AcpRuntimeEvent types to TaskOutputStream methods:
   *   - text_delta -> stream.text()
   *   - tool_call -> stream.toolUse() / stream.toolResult()
   *   - status -> stream.status()
   *   - done -> completion metrics
   *   - error -> error handling
   */
  private handleAcpRuntimeEvent(
    event: AcpRuntimeEvent,
    stream: TaskOutputStream,
    activeToolCalls: Map<string, { name: string; input: Record<string, unknown> }>,
    callbacks: {
      onInitialized: (sessionId: string) => void;
      onDone: (stopReason?: string) => void;
      onError: (message: string, code?: string) => void;
    }
  ): void {
    switch (event.type) {
      case 'text_delta': {
        // Text output from the agent
        // stream: "output" = main response, "thought" = reasoning/thinking
        stream.text(event.text);
        break;
      }

      case 'status': {
        // Status update (e.g., token usage, progress)
        let progress: number | undefined;
        if (event.used !== undefined && event.size !== undefined && event.size > 0) {
          progress = Math.round((event.used / event.size) * 100);
        }
        stream.status('running', progress, event.text);
        break;
      }

      case 'tool_call': {
        // Tool invocation
        // Tag indicates the phase: "tool_call" = start, "tool_call_update" = result
        const toolCallId = event.toolCallId;
        const status = event.status;
        const title = event.title || event.text;

        // Extract tool name from title
        const toolName = title?.split(':')[0]?.trim() || 'unknown';

        if (status === 'in_progress' || !status) {
          // Tool use started
          if (toolCallId) {
            activeToolCalls.set(toolCallId, { name: toolName, input: {} });
          }
          stream.toolUse(toolName, {});
        } else if (status === 'completed' || status === 'failed') {
          // Tool result received
          const toolInfo = toolCallId ? activeToolCalls.get(toolCallId) : undefined;
          const resolvedName = toolInfo?.name || toolName;
          const success = status !== 'failed';

          // The event.text often contains the result summary
          stream.toolResult(resolvedName, event.text, success);

          if (toolCallId) {
            activeToolCalls.delete(toolCallId);
          }
        }
        break;
      }

      case 'done': {
        // Execution completed
        callbacks.onDone(event.stopReason);
        break;
      }

      case 'error': {
        // Error occurred
        callbacks.onError(event.message, event.code);
        break;
      }

      default:
        // Unknown event type - ignore
        break;
    }
  }
}
