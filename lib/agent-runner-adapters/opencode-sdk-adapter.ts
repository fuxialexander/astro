/**
 * OpenCode SDK Adapter
 *
 * Adapter for the OpenCode AI agent using the @opencode-ai/sdk package (v1.2.15+).
 * This adapter bridges OpenCode's SDK API to Astro's TaskOutputStream interface,
 * enabling OpenCode as a first-class provider in the dispatch system.
 *
 * SDK API notes (differs from design doc assumptions):
 *   - Client: `new Opencode({ baseURL })` not `createClient()`
 *   - Chat: `client.session.chat(sessionId, { message })` not `session.prompt()`
 *   - Sessions: `client.session.create()`, `client.session.get(id)`
 *   - Events: `client.event.list({ sessionID })` for polling
 *
 * The adapter maps OpenCode's event model to Astro's streaming events:
 *   - assistant text parts  → stream.text()
 *   - tool_use parts        → stream.toolUse()
 *   - tool_result parts     → stream.toolResult()
 *   - file_change parts     → stream.fileChange()
 *   - session metadata       → stream.sessionInit()
 *
 * Error handling follows Astro guidelines: fail fast with descriptive errors,
 * never silently degrade.
 */

// ============================================================================
// Types (local definitions to avoid hard dependency on @opencode-ai/sdk)
// ============================================================================

/** Minimal Opencode client interface (matches @opencode-ai/sdk v1.2.15) */
interface OpencodeSdkClient {
  session: {
    create: () => Promise<{ id: string; model?: string }>;
    get: (id: string) => Promise<{ id: string; model?: string }>;
    chat: (sessionId: string, options: { message: string }) => Promise<OpencodeSdkMessage>;
  };
  event: {
    list: (options: { sessionID: string }) => Promise<{ data: OpencodeSdkEvent[] }>;
  };
}

/** Message returned from session.chat() */
interface OpencodeSdkMessage {
  id: string;
  role: 'assistant' | 'user';
  parts: OpencodeSdkPart[];
  metadata?: {
    model?: string;
    cost?: number;
    inputTokens?: number;
    outputTokens?: number;
    turns?: number;
  };
}

/** A single part in a message */
type OpencodeSdkPart =
  | { type: 'text'; text: string }
  | { type: 'tool-invocation'; toolInvocationId: string; toolName: string; args: unknown; state: 'call' | 'partial-call' | 'result' | 'error'; result?: unknown; error?: string }
  | { type: 'file'; path: string; action?: 'created' | 'modified' | 'deleted'; diff?: string; linesAdded?: number; linesRemoved?: number }
  | { type: 'step-start'; stepId: string; title?: string }
  | { type: 'step-finish'; stepId: string; status?: string }
  | { type: 'snapshot'; data?: unknown };

/** Event from event.list() */
interface OpencodeSdkEvent {
  id: string;
  type: string;
  sessionId: string;
  properties: Record<string, unknown>;
  createdAt?: string;
}

// ============================================================================
// TaskOutputStream interface (matches Astro's stream callback pattern)
// ============================================================================

export interface TaskOutputStream {
  sessionInit: (sessionId: string, model?: string) => void;
  text: (text: string) => void;
  toolUse: (toolName: string, input: unknown) => void;
  toolResult: (toolName: string, result: unknown, success?: boolean) => void;
  fileChange: (path: string, action: 'created' | 'modified' | 'deleted', diff?: string, linesAdded?: number, linesRemoved?: number) => void;
  progress: (value: number, message?: string) => void;
}

export interface TaskResult {
  taskId: string;
  status: 'success' | 'failure' | 'cancelled';
  stdout?: string;
  stderr?: string;
  errorMessage?: string;
  sessionId?: string;
  metrics?: {
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalCost?: number;
    model?: string;
    numTurns?: number;
  };
}

export interface TaskDispatch {
  taskId: string;
  projectId: string;
  nodeId: string;
  title: string;
  description: string;
  prompt?: string;
  model?: string;
  workingDirectory?: string;
  maxTurns?: number;
  timeout?: number;
}

// ============================================================================
// OpenCode SDK Adapter
// ============================================================================

export interface OpenCodeSdkAdapterConfig {
  /** Base URL for the OpenCode API (default: http://localhost:3456) */
  baseURL?: string;
  /** API key for authentication (optional for local) */
  apiKey?: string;
  /** Maximum concurrent tasks (default: 1) */
  maxConcurrentTasks?: number;
  /** Default timeout in ms (default: 300000 = 5 min) */
  defaultTimeout?: number;
}

/**
 * OpenCode SDK Adapter
 *
 * Executes tasks via the OpenCode SDK client. Translates OpenCode's
 * session/chat/event model to Astro's streaming TaskOutputStream.
 *
 * Capabilities:
 *   - Session creation and chat
 *   - Text, tool_use, tool_result, file_change event streaming
 *   - Abort/cancel via AbortSignal
 *   - Metric extraction (cost, tokens, model, turns)
 *
 * Limitations (vs Claude SDK adapter):
 *   - No approval flow (approvalRequest not supported)
 *   - No MCP integration
 *   - No session steering/resume
 *   - Single concurrent task
 */
export class OpenCodeSdkAdapter {
  readonly type = 'opencode' as const;
  readonly name = 'OpenCode (SDK)';
  readonly maxConcurrentTasks: number;

  private readonly baseURL: string;
  private readonly apiKey?: string;
  private readonly defaultTimeout: number;
  private client: OpencodeSdkClient | null = null;
  private activeTasks = 0;

  constructor(config: OpenCodeSdkAdapterConfig = {}) {
    this.baseURL = config.baseURL ?? process.env.OPENCODE_API_URL ?? 'http://localhost:3456';
    this.apiKey = config.apiKey ?? process.env.OPENCODE_API_KEY;
    this.maxConcurrentTasks = config.maxConcurrentTasks ?? 1;
    this.defaultTimeout = config.defaultTimeout ?? 300_000;
  }

  /**
   * Lazy-initialize the SDK client.
   * Uses dynamic import so the adapter file can be loaded even when
   * @opencode-ai/sdk is not installed — the error surfaces at execute() time.
   */
  async getClient(): Promise<OpencodeSdkClient> {
    if (this.client) return this.client;

    try {
      // Dynamic import to avoid hard dependency
      const sdk = await import('@opencode-ai/sdk');
      const Opencode = sdk.default?.default ?? sdk.default ?? sdk.Opencode;

      if (!Opencode || typeof Opencode !== 'function') {
        throw new Error(
          '@opencode-ai/sdk loaded but Opencode constructor not found. ' +
          `Module exports: ${Object.keys(sdk).join(', ')}`
        );
      }

      const clientOpts: Record<string, unknown> = { baseURL: this.baseURL };
      if (this.apiKey) clientOpts.apiKey = this.apiKey;

      this.client = new Opencode(clientOpts) as unknown as OpencodeSdkClient;
      return this.client;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' ||
          (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        throw new Error(
          'OpenCode SDK (@opencode-ai/sdk) is not installed. ' +
          'Install it with: npm install @opencode-ai/sdk'
        );
      }
      throw error;
    }
  }

  /**
   * Allow injecting a mock client for testing.
   */
  setClient(client: OpencodeSdkClient): void {
    this.client = client;
  }

  /**
   * Execute a task via the OpenCode SDK.
   *
   * Flow:
   *   1. Create session
   *   2. Emit sessionInit
   *   3. Call session.chat() with the task prompt
   *   4. Process message parts → emit stream events
   *   5. Extract metrics and return TaskResult
   */
  async execute(
    task: TaskDispatch,
    stream: TaskOutputStream,
    signal: AbortSignal,
  ): Promise<TaskResult> {
    if (this.activeTasks >= this.maxConcurrentTasks) {
      return {
        taskId: task.taskId,
        status: 'failure',
        errorMessage: `OpenCode adapter at capacity (${this.activeTasks}/${this.maxConcurrentTasks} active tasks)`,
      };
    }

    this.activeTasks++;
    const startTime = Date.now();

    try {
      // 0. Check abort before starting
      if (signal.aborted) {
        return {
          taskId: task.taskId,
          status: 'cancelled',
          errorMessage: 'Task cancelled before execution',
        };
      }

      // 1. Get client
      let client;
      try {
        client = await this.getClient();
      } catch (clientError) {
        return {
          taskId: task.taskId,
          status: 'failure',
          errorMessage: (clientError as Error).message ?? String(clientError),
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      // 2. Create session
      let session;
      try {
        session = await client.session.create();
      } catch (sessionError) {
        return {
          taskId: task.taskId,
          status: 'failure',
          errorMessage: `Failed to create session: ${(sessionError as Error).message ?? String(sessionError)}`,
          metrics: { durationMs: Date.now() - startTime },
        };
      }
      const sessionId = session.id;

      // 3. Emit session init
      stream.sessionInit(sessionId, session.model ?? task.model);

      // 4. Build prompt from task
      const prompt = this.buildPrompt(task);

      // 5. Set up abort handling
      let aborted = false;
      const abortHandler = () => { aborted = true; };
      signal.addEventListener('abort', abortHandler);

      // 6. Set up timeout
      const timeout = task.timeout ?? this.defaultTimeout;
      let timedOut = false;
      const timeoutId = setTimeout(() => { timedOut = true; }, timeout);

      try {
        // 7. Call session.chat()
        if (aborted) {
          return {
            taskId: task.taskId,
            status: 'cancelled',
            errorMessage: 'Task cancelled before chat',
            sessionId,
          };
        }

        const message = await client.session.chat(sessionId, { message: prompt });

        // 8. Check post-chat abort/timeout
        if (aborted) {
          return {
            taskId: task.taskId,
            status: 'cancelled',
            errorMessage: 'Task cancelled during execution',
            sessionId,
            metrics: {
              durationMs: Date.now() - startTime,
            },
          };
        }

        if (timedOut) {
          return {
            taskId: task.taskId,
            status: 'failure',
            errorMessage: `Task timed out after ${timeout}ms`,
            sessionId,
            metrics: {
              durationMs: Date.now() - startTime,
            },
          };
        }

        // 9. Process message parts
        const textChunks: string[] = [];
        this.processMessageParts(message, stream, textChunks);

        // 10. Extract metrics
        const metrics = this.extractMetrics(message, startTime, task.model);

        return {
          taskId: task.taskId,
          status: 'success',
          stdout: textChunks.join(''),
          sessionId,
          metrics,
        };

      } catch (chatError) {
        // Handle specific error types
        const errorName = (chatError as Error).name ?? '';
        const errorMessage = (chatError as Error).message ?? String(chatError);

        if (aborted || errorName === 'AbortError' || errorName === 'MessageAbortedError') {
          return {
            taskId: task.taskId,
            status: 'cancelled',
            errorMessage: errorMessage || 'Task cancelled',
            sessionId,
            metrics: {
              durationMs: Date.now() - startTime,
            },
          };
        }

        if (timedOut) {
          return {
            taskId: task.taskId,
            status: 'failure',
            errorMessage: `Task timed out after ${timeout}ms`,
            sessionId,
            metrics: {
              durationMs: Date.now() - startTime,
            },
          };
        }

        // Categorize known error types
        const status = this.categorizeError(errorName);
        return {
          taskId: task.taskId,
          status,
          errorMessage: errorMessage,
          sessionId,
          metrics: {
            durationMs: Date.now() - startTime,
          },
        };

      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', abortHandler);
      }

    } finally {
      this.activeTasks--;
    }
  }

  /**
   * Build the prompt from task fields.
   * Uses pre-built prompt if available, otherwise combines title + description.
   */
  buildPrompt(task: TaskDispatch): string {
    if (task.prompt) return task.prompt;

    const parts: string[] = [];
    if (task.title) parts.push(`# ${task.title}`);
    if (task.description) parts.push(task.description);

    return parts.join('\n\n') || 'Execute task';
  }

  /**
   * Process message parts and emit corresponding stream events.
   */
  processMessageParts(
    message: OpencodeSdkMessage,
    stream: TaskOutputStream,
    textChunks: string[],
  ): void {
    if (!message.parts) return;

    for (const part of message.parts) {
      switch (part.type) {
        case 'text':
          stream.text(part.text);
          textChunks.push(part.text);
          break;

        case 'tool-invocation':
          if (part.state === 'call' || part.state === 'partial-call') {
            stream.toolUse(part.toolName, part.args);
          } else if (part.state === 'result') {
            stream.toolResult(part.toolName, part.result, true);
          } else if (part.state === 'error') {
            stream.toolResult(part.toolName, part.error ?? 'Tool error', false);
          }
          break;

        case 'file':
          stream.fileChange(
            part.path,
            part.action ?? 'modified',
            part.diff,
            part.linesAdded,
            part.linesRemoved,
          );
          break;

        case 'step-start':
          stream.progress(0, part.title ?? `Step ${part.stepId}`);
          break;

        case 'step-finish':
          stream.progress(100, `Step ${part.stepId} ${part.status ?? 'done'}`);
          break;

        case 'snapshot':
          // Snapshots are state checkpoints — not directly mapped to stream events
          break;

        default:
          // Unknown part type — skip silently (forward-compatible)
          break;
      }
    }
  }

  /**
   * Extract metrics from the SDK message response.
   * Handles multiple field name variants for cost, tokens, and turns.
   */
  extractMetrics(
    message: OpencodeSdkMessage,
    startTime: number,
    modelOverride?: string,
  ): TaskResult['metrics'] {
    const meta = message.metadata ?? {};
    const durationMs = Date.now() - startTime;

    return {
      durationMs,
      inputTokens: meta.inputTokens ?? undefined,
      outputTokens: meta.outputTokens ?? undefined,
      totalCost: meta.cost ?? undefined,
      model: meta.model ?? modelOverride ?? undefined,
      numTurns: meta.turns ?? undefined,
    };
  }

  /**
   * Categorize an error by name into a task status.
   */
  private categorizeError(errorName: string): 'failure' | 'cancelled' {
    const cancellationErrors = [
      'AbortError',
      'MessageAbortedError',
      'CancelledError',
      'TimeoutError',
    ];

    if (cancellationErrors.includes(errorName)) {
      return 'cancelled';
    }

    return 'failure';
  }
}

// ============================================================================
// OpenClaw CLI Adapter
// ============================================================================

/**
 * JSONL event types emitted by OpenClaw CLI.
 * Each line of stdout is a JSON object with a `type` field.
 */
export type OpenClawEventType =
  | 'session.start'
  | 'message.start'
  | 'content.text'
  | 'tool_use.start'
  | 'tool_use.end'
  | 'file.change'
  | 'message.end'
  | 'session.end';

export interface OpenClawEvent {
  type: OpenClawEventType;
  [key: string]: unknown;
}

export interface OpenClawAdapterConfig {
  /** Path to openclaw binary (default: auto-detect via PATH) */
  binaryPath?: string;
  /** Maximum concurrent tasks (default: 1) */
  maxConcurrentTasks?: number;
  /** Default timeout in ms (default: 300000 = 5 min) */
  defaultTimeout?: number;
}

/**
 * OpenClaw CLI Adapter
 *
 * Spawns `openclaw agent --mode rpc --json --prompt <prompt>` and
 * parses JSONL output into Astro streaming events.
 *
 * Event mapping:
 *   session.start  → stream.sessionInit(session_id, model)
 *   content.text   → stream.text(text)
 *   tool_use.start → stream.toolUse(tool_name, tool_input)
 *   tool_use.end   → stream.toolResult(tool_name, result, success)
 *   file.change    → stream.fileChange(path, action, ...)
 *   session.end    → Extract metrics for TaskResult
 */
export class OpenClawAdapter {
  readonly type = 'openclaw' as const;
  readonly name = 'OpenClaw (CLI)';
  readonly maxConcurrentTasks: number;

  private readonly defaultTimeout: number;
  private activeTasks = 0;
  private binaryPath: string;

  constructor(config: OpenClawAdapterConfig = {}) {
    this.binaryPath = config.binaryPath ?? 'openclaw';
    this.maxConcurrentTasks = config.maxConcurrentTasks ?? 1;
    this.defaultTimeout = config.defaultTimeout ?? 300_000;
  }

  /**
   * Check if the OpenClaw CLI is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = await import('child_process');
      execSync(`which ${this.binaryPath}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a task by spawning the OpenClaw CLI.
   */
  async execute(
    task: TaskDispatch,
    stream: TaskOutputStream,
    signal: AbortSignal,
  ): Promise<TaskResult> {
    if (this.activeTasks >= this.maxConcurrentTasks) {
      return {
        taskId: task.taskId,
        status: 'failure',
        errorMessage: `OpenClaw adapter at capacity (${this.activeTasks}/${this.maxConcurrentTasks} active tasks)`,
      };
    }

    this.activeTasks++;
    const startTime = Date.now();

    try {
      if (signal.aborted) {
        return {
          taskId: task.taskId,
          status: 'cancelled',
          errorMessage: 'Task cancelled before execution',
        };
      }

      const { spawn } = await import('child_process');
      const prompt = this.buildPrompt(task);

      // Build CLI arguments
      const args = ['agent', '--mode', 'rpc', '--json', '--prompt', prompt];
      if (task.model) args.push('--model', task.model);
      if (task.workingDirectory) args.push('--working-dir', task.workingDirectory);

      return await new Promise<TaskResult>((resolve) => {
        const child = spawn(this.binaryPath, args, {
          cwd: task.workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        let buffer = '';
        let sessionId: string | undefined;
        const textChunks: string[] = [];
        const metrics: TaskResult['metrics'] = {};
        let resolved = false;

        const finish = (result: TaskResult) => {
          if (!resolved) {
            resolved = true;
            resolve(result);
          }
        };

        // Handle abort
        const abortHandler = () => {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 5000);
        };
        signal.addEventListener('abort', abortHandler);

        // Timeout
        const timeout = task.timeout ?? this.defaultTimeout;
        const timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 5000);
          finish({
            taskId: task.taskId,
            status: 'failure',
            errorMessage: `Task timed out after ${timeout}ms`,
            sessionId,
            metrics: { ...metrics, durationMs: Date.now() - startTime },
          });
        }, timeout);

        // Parse JSONL from stdout
        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const event = JSON.parse(trimmed) as OpenClawEvent;
              this.processOpenClawEvent(event, stream, textChunks, metrics);

              if (event.type === 'session.start') {
                sessionId = event.session_id as string;
              }
            } catch {
              // Malformed JSON line — skip
            }
          }
        });

        // Capture stderr
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        // Process exit
        child.on('close', (code) => {
          clearTimeout(timeoutId);
          signal.removeEventListener('abort', abortHandler);

          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer.trim()) as OpenClawEvent;
              this.processOpenClawEvent(event, stream, textChunks, metrics);
            } catch {
              // Ignore malformed final line
            }
          }

          metrics.durationMs = Date.now() - startTime;

          if (signal.aborted) {
            finish({
              taskId: task.taskId,
              status: 'cancelled',
              errorMessage: 'Task cancelled',
              sessionId,
              metrics,
            });
          } else if (code !== 0 && code !== null) {
            finish({
              taskId: task.taskId,
              status: 'failure',
              errorMessage: stderr.trim() || `Process exited with code ${code}`,
              sessionId,
              stderr: stderr || undefined,
              metrics,
            });
          } else {
            finish({
              taskId: task.taskId,
              status: 'success',
              stdout: textChunks.join(''),
              sessionId,
              metrics,
            });
          }
        });

        // Process error (spawn failure)
        child.on('error', (error) => {
          clearTimeout(timeoutId);
          signal.removeEventListener('abort', abortHandler);
          finish({
            taskId: task.taskId,
            status: 'failure',
            errorMessage: `Failed to spawn openclaw: ${error.message}`,
            metrics: { durationMs: Date.now() - startTime },
          });
        });
      });

    } finally {
      this.activeTasks--;
    }
  }

  /**
   * Process a single OpenClaw JSONL event and emit stream events.
   */
  processOpenClawEvent(
    event: OpenClawEvent,
    stream: TaskOutputStream,
    textChunks: string[],
    metrics: TaskResult['metrics'],
  ): void {
    switch (event.type) {
      case 'session.start':
        stream.sessionInit(
          event.session_id as string,
          event.model as string | undefined,
        );
        break;

      case 'content.text':
        stream.text(event.text as string);
        textChunks.push(event.text as string);
        break;

      case 'tool_use.start':
        stream.toolUse(
          event.tool_name as string,
          event.tool_input ?? event.input,
        );
        break;

      case 'tool_use.end':
        stream.toolResult(
          event.tool_name as string,
          event.result,
          event.success as boolean ?? true,
        );
        break;

      case 'file.change':
        stream.fileChange(
          event.path as string,
          (event.action as 'created' | 'modified' | 'deleted') ?? 'modified',
          event.diff as string | undefined,
          event.lines_added as number | undefined,
          event.lines_removed as number | undefined,
        );
        break;

      case 'session.end':
        // Extract metrics from session end event
        if (metrics) {
          metrics.totalCost = (event.cost as number) ?? metrics.totalCost;
          metrics.inputTokens = (event.input_tokens as number) ?? metrics.inputTokens;
          metrics.outputTokens = (event.output_tokens as number) ?? metrics.outputTokens;
          metrics.numTurns = (event.turns as number) ?? metrics.numTurns;
          metrics.model = (event.model as string) ?? metrics.model;
        }
        break;

      case 'message.start':
      case 'message.end':
        // These are structural events — no direct stream mapping needed
        break;

      default:
        // Unknown event type — skip (forward-compatible)
        break;
    }
  }

  /**
   * Build the prompt from task fields.
   */
  private buildPrompt(task: TaskDispatch): string {
    if (task.prompt) return task.prompt;

    const parts: string[] = [];
    if (task.title) parts.push(`# ${task.title}`);
    if (task.description) parts.push(task.description);

    return parts.join('\n\n') || 'Execute task';
  }
}

// ============================================================================
// OpenCode Legacy CLI Adapter (JSONL-based)
// ============================================================================

/**
 * JSONL event types emitted by OpenCode CLI.
 */
export type OpenCodeEventType =
  | 'system'
  | 'assistant'
  | 'tool_result'
  | 'result';

export interface OpenCodeCliEvent {
  type: OpenCodeEventType;
  [key: string]: unknown;
}

export interface OpenCodeCliAdapterConfig {
  /** Path to opencode binary (default: auto-detect via PATH) */
  binaryPath?: string;
  /** Maximum concurrent tasks (default: 1) */
  maxConcurrentTasks?: number;
  /** Default timeout in ms (default: 300000 = 5 min) */
  defaultTimeout?: number;
}

/**
 * OpenCode CLI Adapter (legacy JSONL-based)
 *
 * Spawns `opencode run --print --output-format json <prompt>` and
 * parses JSONL output into Astro streaming events.
 *
 * Event mapping:
 *   system             → stream.sessionInit(session_id, model)
 *   assistant[text]    → stream.text(text)
 *   assistant[tool_use] → stream.toolUse(name, input)
 *   tool_result        → stream.toolResult(tool_name, content, !is_error)
 *   result             → Extract metrics for TaskResult
 */
export class OpenCodeCliAdapter {
  readonly type = 'opencode' as const;
  readonly name = 'OpenCode (CLI)';
  readonly maxConcurrentTasks: number;

  private readonly defaultTimeout: number;
  private activeTasks = 0;
  private binaryPath: string;

  constructor(config: OpenCodeCliAdapterConfig = {}) {
    this.binaryPath = config.binaryPath ?? 'opencode';
    this.maxConcurrentTasks = config.maxConcurrentTasks ?? 1;
    this.defaultTimeout = config.defaultTimeout ?? 300_000;
  }

  /**
   * Check if the OpenCode CLI is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = await import('child_process');
      execSync(`which ${this.binaryPath}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a task by spawning the OpenCode CLI.
   */
  async execute(
    task: TaskDispatch,
    stream: TaskOutputStream,
    signal: AbortSignal,
  ): Promise<TaskResult> {
    if (this.activeTasks >= this.maxConcurrentTasks) {
      return {
        taskId: task.taskId,
        status: 'failure',
        errorMessage: `OpenCode CLI adapter at capacity (${this.activeTasks}/${this.maxConcurrentTasks} active tasks)`,
      };
    }

    this.activeTasks++;
    const startTime = Date.now();

    try {
      if (signal.aborted) {
        return {
          taskId: task.taskId,
          status: 'cancelled',
          errorMessage: 'Task cancelled before execution',
        };
      }

      const { spawn } = await import('child_process');
      const prompt = this.buildPrompt(task);

      // Build CLI arguments
      const args = ['run', '--print', '--output-format', 'json', prompt];
      if (task.model) args.push('--model', task.model);
      if (task.workingDirectory) args.push('--cwd', task.workingDirectory);

      return await new Promise<TaskResult>((resolve) => {
        const child = spawn(this.binaryPath, args, {
          cwd: task.workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        let buffer = '';
        let sessionId: string | undefined;
        const textChunks: string[] = [];
        const metrics: TaskResult['metrics'] = {};
        let resolved = false;

        const finish = (result: TaskResult) => {
          if (!resolved) {
            resolved = true;
            resolve(result);
          }
        };

        // Handle abort
        const abortHandler = () => {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 5000);
        };
        signal.addEventListener('abort', abortHandler);

        // Timeout
        const timeout = task.timeout ?? this.defaultTimeout;
        const timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 5000);
          finish({
            taskId: task.taskId,
            status: 'failure',
            errorMessage: `Task timed out after ${timeout}ms`,
            sessionId,
            metrics: { ...metrics, durationMs: Date.now() - startTime },
          });
        }, timeout);

        // Parse JSONL from stdout
        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          // Handle both \n and \r\n line endings
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const event = JSON.parse(trimmed) as OpenCodeCliEvent;
              this.processOpenCodeEvent(event, stream, textChunks, metrics);

              if (event.type === 'system') {
                sessionId = event.session_id as string;
              }
            } catch {
              // Malformed JSON line — skip
            }
          }
        });

        // Capture stderr
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        // Process exit
        child.on('close', (code) => {
          clearTimeout(timeoutId);
          signal.removeEventListener('abort', abortHandler);

          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer.trim()) as OpenCodeCliEvent;
              this.processOpenCodeEvent(event, stream, textChunks, metrics);
            } catch {
              // Ignore malformed final line
            }
          }

          metrics.durationMs = Date.now() - startTime;

          if (signal.aborted) {
            finish({
              taskId: task.taskId,
              status: 'cancelled',
              errorMessage: 'Task cancelled',
              sessionId,
              metrics,
            });
          } else if (code !== 0 && code !== null) {
            finish({
              taskId: task.taskId,
              status: 'failure',
              errorMessage: stderr.trim() || `Process exited with code ${code}`,
              sessionId,
              stderr: stderr || undefined,
              metrics,
            });
          } else {
            finish({
              taskId: task.taskId,
              status: 'success',
              stdout: textChunks.join(''),
              sessionId,
              metrics,
            });
          }
        });

        // Process error (spawn failure)
        child.on('error', (error) => {
          clearTimeout(timeoutId);
          signal.removeEventListener('abort', abortHandler);
          finish({
            taskId: task.taskId,
            status: 'failure',
            errorMessage: `Failed to spawn opencode: ${error.message}`,
            metrics: { durationMs: Date.now() - startTime },
          });
        });
      });

    } finally {
      this.activeTasks--;
    }
  }

  /**
   * Process a single OpenCode JSONL event and emit stream events.
   */
  processOpenCodeEvent(
    event: OpenCodeCliEvent,
    stream: TaskOutputStream,
    textChunks: string[],
    metrics: TaskResult['metrics'],
  ): void {
    switch (event.type) {
      case 'system':
        stream.sessionInit(
          event.session_id as string,
          event.model as string | undefined,
        );
        break;

      case 'assistant': {
        // OpenCode assistant messages have a `content` array of parts
        const content = event.content as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part.type === 'text') {
              stream.text(part.text as string);
              textChunks.push(part.text as string);
            } else if (part.type === 'tool_use') {
              stream.toolUse(part.name as string, part.input);
            }
          }
        }
        break;
      }

      case 'tool_result':
        stream.toolResult(
          event.tool_name as string,
          event.content ?? event.result,
          !(event.is_error as boolean),
        );
        break;

      case 'result':
        // Extract metrics from result event
        if (metrics) {
          // Handle multiple field name variants
          metrics.totalCost = (event.cost_usd as number) ?? (event.cost as number) ?? metrics.totalCost;
          const tokens = event.tokens as Record<string, number> | undefined;
          if (tokens) {
            metrics.inputTokens = tokens.input ?? metrics.inputTokens;
            metrics.outputTokens = tokens.output ?? metrics.outputTokens;
          } else {
            metrics.inputTokens = (event.input_tokens as number) ?? metrics.inputTokens;
            metrics.outputTokens = (event.output_tokens as number) ?? metrics.outputTokens;
          }
          metrics.numTurns = (event.turns as number) ?? metrics.numTurns;
          metrics.model = (event.model as string) ?? metrics.model;
        }
        break;

      default:
        // Unknown event type — skip (forward-compatible)
        break;
    }
  }

  /**
   * Build the prompt from task fields.
   */
  private buildPrompt(task: TaskDispatch): string {
    if (task.prompt) return task.prompt;

    const parts: string[] = [];
    if (task.title) parts.push(`# ${task.title}`);
    if (task.description) parts.push(task.description);

    return parts.join('\n\n') || 'Execute task';
  }
}

// ============================================================================
// JSONL Parsing Utilities (shared across CLI adapters)
// ============================================================================

/**
 * Parse a JSONL buffer and return complete lines + remaining buffer.
 * Handles both \n and \r\n line endings.
 */
export function parseJsonlBuffer(buffer: string): { events: unknown[]; remaining: string } {
  const events: unknown[] = [];
  const lines = buffer.split(/\r?\n/);
  const remaining = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Malformed JSON — skip line
    }
  }

  return { events, remaining };
}
