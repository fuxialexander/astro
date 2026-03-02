/**
 * OpenCode SDK provider adapter
 *
 * Executes tasks using the @opencode-ai/sdk (v1.2.15) JavaScript client.
 * Connects to a running OpenCode server via REST API + SSE streaming.
 *
 * SDK: @opencode-ai/sdk (npm, zero dependencies)
 * Server: OpenCode Hono.js server on port 4096
 * Streaming: SSE via client.event.list() async iterator
 *
 * API Surface (from @opencode-ai/sdk):
 *   - client.session.create()        → Session
 *   - client.session.chat(id, body)  → AssistantMessage
 *   - client.session.abort(id)       → SessionAbortResponse
 *   - client.session.messages(id)    → SessionMessagesResponse
 *   - client.session.delete(id)      → SessionDeleteResponse
 *   - client.event.list()            → Stream<EventListResponse>
 *
 * Event types (SSE via event.list):
 *   - message.part.updated   → part: TextPart | ToolPart | FilePart | ...
 *   - message.updated        → full message update
 *   - session.error          → error details
 *   - session.idle           → session completed
 *   - file.edited            → file change
 *
 * Tool part states:
 *   - ToolStatePending:   { status: 'pending' }
 *   - ToolStateRunning:   { status: 'running', input?, title? }
 *   - ToolStateCompleted: { status: 'completed', input, output, title }
 *   - ToolStateError:     { status: 'error', error, input }
 */

// ============================================================================
// Types — mirror the adapter interface from openclaw-adapter.ts
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
// OpenCode SDK Types — mirrors @opencode-ai/sdk types
// ============================================================================

/**
 * These types represent the actual API surface of @opencode-ai/sdk v1.2.15
 * as documented at https://github.com/sst/opencode-sdk-js
 */

export interface OpenCodeSession {
  id: string;
  title: string;
  version: string;
  time: { created: string; updated: string };
  parentID?: string;
}

export interface OpenCodeAssistantMessage {
  id: string;
  cost: number;
  mode: string;
  modelID: string;
  providerID: string;
  role: 'assistant';
  sessionID: string;
  system: string[];
  time: { created: string; completed?: string };
  tokens: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } };
  error?: { name: string; data?: unknown };
  summary?: boolean;
  path: { cwd: string; root: string };
}

export interface OpenCodeTextPart {
  id: string;
  messageID: string;
  sessionID: string;
  text: string;
  type: 'text';
  synthetic?: boolean;
  time?: { created: string; updated: string };
}

export interface OpenCodeToolPart {
  id: string;
  callID: string;
  messageID: string;
  sessionID: string;
  tool: string;
  type: 'tool';
  state:
    | { status: 'pending' }
    | { status: 'running'; input?: unknown; title?: string; metadata?: Record<string, unknown>; time: { start: string } }
    | { status: 'completed'; input: Record<string, unknown>; output: string; title: string; metadata: Record<string, unknown>; time: { start: string; end: string } }
    | { status: 'error'; error: string; input: Record<string, unknown>; time: { start: string; end: string } };
}

export type OpenCodePart = OpenCodeTextPart | OpenCodeToolPart;

/**
 * SSE event types from client.event.list()
 */
export type OpenCodeEvent =
  | { type: 'message.part.updated'; properties: { part: OpenCodePart } }
  | { type: 'message.updated'; properties: { message: OpenCodeAssistantMessage } }
  | { type: 'session.error'; properties: { sessionID?: string; error?: { name: string; data?: { message?: string } } } }
  | { type: 'session.idle'; properties: { sessionID: string } }
  | { type: 'session.updated'; properties: { session: OpenCodeSession } }
  | { type: 'session.deleted'; properties: { sessionID: string } }
  | { type: 'file.edited'; properties: { file: string; sessionID: string } }
  | { type: 'message.removed'; properties: { messageID: string; sessionID: string } }
  | { type: 'message.part.removed'; properties: { partID: string; messageID: string; sessionID: string } }
  | { type: string; properties: Record<string, unknown> };

/**
 * Minimal interface for the OpenCode SDK client
 * Represents the actual API of `new Opencode()` from @opencode-ai/sdk
 */
export interface OpenCodeClient {
  session: {
    create(): Promise<OpenCodeSession>;
    chat(id: string, body: {
      modelID: string;
      providerID: string;
      parts: Array<{ type: 'text'; text: string }>;
      system?: string;
      mode?: string;
    }): Promise<OpenCodeAssistantMessage>;
    abort(id: string): Promise<{ success: boolean }>;
    messages(id: string): Promise<Array<OpenCodeAssistantMessage | { role: 'user' }>>;
    delete(id: string): Promise<{ success: boolean }>;
    list(): Promise<OpenCodeSession[]>;
  };
  event: {
    list(): Promise<AsyncIterable<OpenCodeEvent> & { controller: AbortController }>;
  };
}

// ============================================================================
// OpenCode SDK Adapter
// ============================================================================

/**
 * Default OpenCode server URL
 */
const DEFAULT_BASE_URL = 'http://localhost:4096';

/**
 * Default model and provider IDs (configurable via task or environment)
 */
const DEFAULT_MODEL_ID = 'claude-sonnet-4-20250514';
const DEFAULT_PROVIDER_ID = 'anthropic';

export class OpenCodeSdkAdapter implements ProviderAdapter {
  readonly type = 'opencode';
  readonly name = 'OpenCode (SDK)';

  private activeTasks = 0;
  private maxTasks = 4;
  private lastError?: string;
  private baseUrl: string;
  private client: OpenCodeClient | null = null;

  constructor(options?: { baseUrl?: string; client?: OpenCodeClient }) {
    this.baseUrl = options?.baseUrl ?? process.env.OPENCODE_BASE_URL ?? DEFAULT_BASE_URL;
    if (options?.client) {
      this.client = options.client;
    }
  }

  /**
   * Check if OpenCode server is reachable by hitting the /config endpoint
   */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/config`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Lazily initialize the SDK client.
   * Uses constructor-injected client for testing, or dynamically imports @opencode-ai/sdk.
   */
  private async getClient(): Promise<OpenCodeClient> {
    if (this.client) return this.client;

    try {
      // Dynamic import to avoid hard dependency on @opencode-ai/sdk
      const sdk = await import('@opencode-ai/sdk');
      const Opencode = sdk.default ?? sdk;
      this.client = new Opencode({ baseURL: this.baseUrl }) as unknown as OpenCodeClient;
      return this.client;
    } catch (error) {
      throw new Error(
        `Failed to import @opencode-ai/sdk. Install it with: npm install @opencode-ai/sdk\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async execute(task: Task, stream: TaskOutputStream, signal: AbortSignal): Promise<TaskResult> {
    this.activeTasks++;
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      stream.status('running', 0, 'Initializing OpenCode SDK');

      const client = await this.getClient();

      // 1. Create a new session
      const session = await client.session.create();
      const sessionId = session.id;
      stream.sessionInit(sessionId, task.model ?? DEFAULT_MODEL_ID);
      stream.status('running', 5, 'Session created');

      // 2. Set up SSE event listener for real-time streaming
      const eventStream = await client.event.list();
      let eventAbortController: AbortController | undefined;

      // Extract the abort controller from the stream if available
      if ('controller' in eventStream && eventStream.controller instanceof AbortController) {
        eventAbortController = eventStream.controller;
      }

      // Track session error and output
      let sessionError: string | undefined;
      let fullOutput = '';

      // Process SSE events in the background
      const eventProcessing = (async () => {
        try {
          for await (const event of eventStream) {
            if (signal.aborted) break;

            this.handleSseEvent(event, sessionId, stream, {
              onText: (text) => { fullOutput += text; },
              onDone: () => { /* session idle — no-op, chat() return drives completion */ },
              onError: (error) => { sessionError = error; },
            });
          }
        } catch (error) {
          // Stream closed or aborted — expected during abort
          if (!signal.aborted) {
            const msg = error instanceof Error ? error.message : String(error);
            sessionError = msg;
          }
        }
      })();

      // 3. Handle abort signal
      const abortHandler = async () => {
        try {
          // Abort via SDK
          await client.session.abort(sessionId);
        } catch {
          // Best effort abort
        }
        // Also abort the SSE stream
        eventAbortController?.abort();
      };

      signal.addEventListener('abort', abortHandler);

      // 4. Send prompt via SDK chat method
      const modelID = task.model ?? DEFAULT_MODEL_ID;
      const providerID = DEFAULT_PROVIDER_ID;
      const parts: Array<{ type: 'text'; text: string }> = [
        { type: 'text', text: task.prompt }
      ];

      stream.status('running', 10, 'Sending prompt');

      let assistantMessage: OpenCodeAssistantMessage;
      try {
        assistantMessage = await client.session.chat(sessionId, {
          modelID,
          providerID,
          parts,
          system: task.systemPrompt,
        });
      } catch (error) {
        // If aborted during chat, handle gracefully
        if (signal.aborted) {
          signal.removeEventListener('abort', abortHandler);
          eventAbortController?.abort();

          return {
            taskId: task.id,
            status: 'cancelled',
            error: 'Task cancelled',
            startedAt,
            completedAt: new Date().toISOString(),
            metrics: {
              durationMs: Date.now() - startTime,
              model: modelID,
            },
          };
        }
        throw error;
      }

      // 5. Wait for event processing to complete
      // Give SSE events a short grace period to arrive after chat returns
      await Promise.race([
        eventProcessing,
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);

      // Clean up event stream
      eventAbortController?.abort();
      signal.removeEventListener('abort', abortHandler);

      // 6. Build metrics from the assistant message
      const durationMs = Date.now() - startTime;
      const metrics: TaskResult['metrics'] = {
        durationMs,
        inputTokens: assistantMessage.tokens?.input,
        outputTokens: assistantMessage.tokens?.output,
        totalCost: assistantMessage.cost,
        model: assistantMessage.modelID ?? modelID,
        numTurns: 1,
      };

      // Check for errors in the assistant message
      if (assistantMessage.error) {
        const errorName = assistantMessage.error.name;
        const errorData = assistantMessage.error.data;
        const errorMsg = typeof errorData === 'object' && errorData !== null && 'message' in errorData
          ? (errorData as { message: string }).message
          : errorName;

        this.lastError = errorMsg;

        return {
          taskId: task.id,
          status: errorName === 'MessageAbortedError' ? 'cancelled' : 'failed',
          error: errorMsg,
          output: fullOutput || undefined,
          startedAt,
          completedAt: new Date().toISOString(),
          metrics,
        };
      }

      // Check for session-level error from SSE
      if (sessionError) {
        this.lastError = sessionError;
        return {
          taskId: task.id,
          status: 'failed',
          error: sessionError,
          output: fullOutput || undefined,
          startedAt,
          completedAt: new Date().toISOString(),
          metrics,
        };
      }

      stream.status('running', 100, 'Completed');

      return {
        taskId: task.id,
        status: 'completed',
        output: fullOutput || undefined,
        startedAt,
        completedAt: new Date().toISOString(),
        metrics,
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
          metrics: {
            durationMs: Date.now() - startTime,
          },
        };
      }

      return {
        taskId: task.id,
        status: 'failed',
        error: errorMsg,
        startedAt,
        completedAt: new Date().toISOString(),
        metrics: {
          durationMs: Date.now() - startTime,
        },
      };
    } finally {
      this.activeTasks--;
    }
  }

  async getStatus(): Promise<ProviderStatus> {
    const available = await this.isAvailable();
    return {
      available,
      version: null, // Could be populated by querying /config
      activeTasks: this.activeTasks,
      maxTasks: this.maxTasks,
      lastError: this.lastError,
    };
  }

  // ============================================================================
  // SSE Event Handling
  // ============================================================================

  /**
   * Handle a single SSE event from the OpenCode event stream.
   *
   * Maps OpenCode SDK event types to TaskOutputStream methods:
   *   - message.part.updated (text)  → stream.text()
   *   - message.part.updated (tool)  → stream.toolUse() / stream.toolResult()
   *   - file.edited                  → stream.fileChange()
   *   - session.error                → stream.stderr()
   *   - session.idle                 → completion signal
   */
  handleSseEvent(
    event: OpenCodeEvent,
    sessionId: string,
    stream: TaskOutputStream,
    callbacks: {
      onText: (text: string) => void;
      onDone: () => void;
      onError: (error: string) => void;
    }
  ): void {
    switch (event.type) {
      case 'message.part.updated': {
        const part = event.properties.part as OpenCodePart;
        if (!part) break;

        if (part.type === 'text') {
          const textPart = part as OpenCodeTextPart;
          if (textPart.text) {
            stream.text(textPart.text);
            callbacks.onText(textPart.text);
          }
        } else if (part.type === 'tool') {
          const toolPart = part as OpenCodeToolPart;
          this.handleToolPartUpdate(toolPart, stream);
        }
        break;
      }

      case 'file.edited': {
        const file = event.properties.file as string;
        const eventSessionId = event.properties.sessionID as string;

        // Only process events for our session
        if (eventSessionId && eventSessionId !== sessionId) break;

        if (file) {
          stream.fileChange(file, 'modified');
        }
        break;
      }

      case 'session.error': {
        const errorProp = event.properties.error as { name: string; data?: { message?: string } } | undefined;
        const eventSessionId = event.properties.sessionID as string;

        if (eventSessionId && eventSessionId !== sessionId) break;

        const errorMsg = errorProp
          ? `${errorProp.name}: ${errorProp.data?.message ?? 'Unknown error'}`
          : 'Unknown session error';

        stream.stderr(errorMsg);
        callbacks.onError(errorMsg);
        break;
      }

      case 'session.idle': {
        const eventSessionId = event.properties.sessionID as string;
        if (eventSessionId === sessionId) {
          callbacks.onDone();
        }
        break;
      }

      case 'message.updated': {
        // Full message update — could extract additional metrics
        // For now, just track completion
        break;
      }

      default:
        // Unknown event type — ignore
        break;
    }
  }

  /**
   * Handle tool part updates from SSE events.
   *
   * Maps ToolPart state transitions to stream events:
   *   - running    → stream.toolUse(tool, input)
   *   - completed  → stream.toolResult(tool, output, true)
   *   - error      → stream.toolResult(tool, error, false)
   */
  private handleToolPartUpdate(
    toolPart: OpenCodeToolPart,
    stream: TaskOutputStream,
  ): void {
    const toolName = toolPart.tool;
    const state = toolPart.state;

    switch (state.status) {
      case 'pending':
        // Tool queued, no action yet
        break;

      case 'running':
        stream.toolUse(toolName, state.input ?? {});
        break;

      case 'completed':
        stream.toolResult(toolName, state.output, true);

        // Detect file changes from Write/Edit tool results
        if (toolName === 'write' || toolName === 'Write') {
          const filePath = state.input?.file_path ?? state.input?.path;
          if (typeof filePath === 'string') {
            stream.fileChange(filePath, 'created');
          }
        } else if (toolName === 'edit' || toolName === 'Edit') {
          const filePath = state.input?.file_path ?? state.input?.path;
          if (typeof filePath === 'string') {
            stream.fileChange(filePath, 'modified');
          }
        }
        break;

      case 'error':
        stream.toolResult(toolName, state.error, false);
        break;
    }
  }
}
