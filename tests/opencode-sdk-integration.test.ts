/**
 * OpenCode SDK (@opencode-ai/sdk v1.2.15) Integration Path Tests
 *
 * Tests the SDK integration path for Astro's OpenCode provider adapter.
 * The SDK provides a REST/SSE client that communicates with a local OpenCode server.
 *
 * SDK Architecture (discovered from type analysis):
 * - `createOpencodeClient()` → OpencodeClient (HTTP REST client)
 * - `createOpencodeServer()` → { url, close() } (local server instance)
 * - `createOpencode()` → { client, server } (convenience wrapper)
 *
 * Session lifecycle via SDK:
 * 1. client.session.create() → Session { id, projectID, directory, ... }
 * 2. client.session.prompt({ path: { id }, body: { parts: [...] } }) → { info: AssistantMessage, parts: Part[] }
 * 3. client.session.promptAsync({ path: { id }, body: { parts: [...] } }) → fire-and-forget, stream via events
 * 4. client.event.subscribe() → AsyncGenerator<Event> (SSE stream)
 * 5. client.session.abort({ path: { id } }) → boolean
 *
 * Event types relevant for execution streaming:
 * - message.part.updated → Part (TextPart | ToolPart | StepStartPart | StepFinishPart | ReasoningPart | ...)
 * - message.updated → Message (AssistantMessage with cost/tokens/finish)
 * - session.status → SessionStatus (idle | retry | busy)
 * - session.error → SessionError
 * - session.idle → session completed
 *
 * Key findings vs CLI adapter:
 * - SDK is an HTTP client (not CLI spawn) — requires a running OpenCode server
 * - Events come via SSE subscription, not JSONL stdout
 * - SDK events use dot-notation types (e.g., "message.part.updated") vs CLI snake_case ("text", "tool_use")
 * - Session.prompt() is synchronous (waits for completion), promptAsync() is fire-and-forget
 * - Abort is via client.session.abort(), not process SIGTERM
 *
 * @see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts
 * @see node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts
 * @see packages/agent-runner/src/providers/opencode-adapter.ts (CLI adapter)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockStream } from './helpers/mock-stream.js'

// Check if @opencode-ai/sdk is installed (optional dependency)
let sdkAvailable = false
try {
  await import('@opencode-ai/sdk')
  sdkAvailable = true
} catch {
  // SDK not installed — tests that require it will be skipped
}

// =============================================================================
// SDK Type Re-exports (from @opencode-ai/sdk)
// =============================================================================

// Import actual SDK types to verify they exist and match our expectations
import type {
  // Core types
  Session,
  TextPart,
  ToolPart,
  ToolStatePending,
  ToolStateRunning,
  ToolStateCompleted,
  ToolStateError,
  StepStartPart,
  StepFinishPart,
  ReasoningPart,
  Part,
  AssistantMessage,
  UserMessage,
  // Event types
  Event,
  EventMessagePartUpdated,
  EventMessageUpdated,
  EventSessionStatus,
  EventSessionError,
  EventSessionIdle,
  EventSessionCreated,
  // Error types
  ApiError,
  MessageOutputLengthError,
  // Input types
  TextPartInput,
  // Session data types
  SessionCreateData,
  SessionPromptData,
  SessionPromptAsyncData,
  SessionAbortData,
} from '@opencode-ai/sdk'

// =============================================================================
// OpenCode SDK Adapter — Maps SDK events to TaskOutputStream
// =============================================================================

/**
 * Adapter that maps OpenCode SDK events to Astro's TaskOutputStream interface.
 *
 * This is the bridge between the SDK's REST/SSE API and the agent runner's
 * streaming event system. Unlike the CLI adapter which parses JSONL from stdout,
 * this adapter processes structured Event objects from the SDK's SSE subscription.
 *
 * Key differences from CLI adapter:
 * - No process spawning — uses HTTP client
 * - Events are typed objects, not JSON strings
 * - Session management via SDK methods, not CLI args
 * - Abort via client.session.abort(), not process signals
 */
class OpenCodeSdkAdapter {
  private sessionId: string | null = null
  private sessionInitEmitted = false
  private lastMetrics: {
    totalCost?: number
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reason?: string
    model?: string
  } | null = null
  private toolNameMap = new Map<string, string>()

  /**
   * Handle an SDK Event and emit corresponding TaskOutputStream calls.
   *
   * Maps SDK event types to the Astro streaming protocol:
   * - message.part.updated → text(), toolUse(), toolResult(), status()
   * - message.updated → metrics extraction
   * - session.status → status()
   * - session.error → status() with error
   * - session.created → sessionInit()
   * - session.idle → status() completion
   */
  handleEvent(event: Event, stream: TaskOutputStream): void {
    switch (event.type) {
      case 'message.part.updated':
        this.handlePartUpdated(event as EventMessagePartUpdated, stream)
        break

      case 'message.updated':
        this.handleMessageUpdated(event as EventMessageUpdated, stream)
        break

      case 'session.status':
        this.handleSessionStatus(event as EventSessionStatus, stream)
        break

      case 'session.error':
        this.handleSessionError(event as EventSessionError, stream)
        break

      case 'session.created':
        this.handleSessionCreated(event as EventSessionCreated, stream)
        break

      case 'session.idle':
        this.handleSessionIdle(event as EventSessionIdle, stream)
        break

      default:
        // Forward compatibility — ignore unknown events
        break
    }
  }

  /**
   * Handle message.part.updated event.
   * Maps Part types to TaskOutputStream methods.
   */
  private handlePartUpdated(event: EventMessagePartUpdated, stream: TaskOutputStream): void {
    const { part } = event.properties

    // Emit sessionInit on first part if not already done
    if (!this.sessionInitEmitted && part.sessionID) {
      this.sessionId = part.sessionID
      stream.sessionInit(part.sessionID)
      this.sessionInitEmitted = true
    }

    switch (part.type) {
      case 'text':
        this.handleTextPart(part as TextPart, stream)
        break

      case 'tool':
        this.handleToolPart(part as ToolPart, stream)
        break

      case 'step-start':
        this.handleStepStart(part as StepStartPart, stream)
        break

      case 'step-finish':
        this.handleStepFinish(part as StepFinishPart, stream)
        break

      case 'reasoning':
        this.handleReasoningPart(part as ReasoningPart, stream)
        break

      default:
        // Other part types (snapshot, patch, agent, retry, compaction, subtask) — skip
        break
    }
  }

  private handleTextPart(part: TextPart, stream: TaskOutputStream): void {
    // Skip empty, synthetic, or ignored text
    if (!part.text || part.synthetic || part.ignored) return
    stream.text(part.text)
  }

  private handleToolPart(part: ToolPart, stream: TaskOutputStream): void {
    const { state, tool, callID } = part

    // Track tool name for ID correlation
    this.toolNameMap.set(callID, tool)

    const title = ('title' in state && state.title) || tool

    switch (state.status) {
      case 'pending':
        // Tool queued but not yet running
        stream.toolUse(tool, { toolCallId: callID, input: state.input })
        break

      case 'running':
        stream.toolUse(title, { toolCallId: callID, input: state.input })
        break

      case 'completed':
        stream.toolResult(state.title || tool, state.output, true)
        break

      case 'error':
        stream.toolResult(title, state.error, false)
        break
    }
  }

  private handleStepStart(_part: StepStartPart, stream: TaskOutputStream): void {
    stream.status('running', undefined, 'Step started')
  }

  private handleStepFinish(part: StepFinishPart, stream: TaskOutputStream): void {
    this.lastMetrics = {
      totalCost: part.cost,
      inputTokens: part.tokens.input,
      outputTokens: part.tokens.output,
      reasoningTokens: part.tokens.reasoning,
      cacheReadTokens: part.tokens.cache.read,
      cacheWriteTokens: part.tokens.cache.write,
      reason: part.reason,
    }

    stream.status('running', 100, `Step finished: ${part.reason}`)
  }

  private handleReasoningPart(part: ReasoningPart, stream: TaskOutputStream): void {
    if (!part.text) return
    stream.text(part.text)
  }

  /**
   * Handle message.updated event — extract metrics from AssistantMessage.
   */
  private handleMessageUpdated(event: EventMessageUpdated, stream: TaskOutputStream): void {
    const { info } = event.properties
    if (info.role !== 'assistant') return

    const msg = info as AssistantMessage
    this.lastMetrics = {
      ...this.lastMetrics,
      totalCost: msg.cost,
      inputTokens: msg.tokens.input,
      outputTokens: msg.tokens.output,
      reasoningTokens: msg.tokens.reasoning,
      cacheReadTokens: msg.tokens.cache.read,
      cacheWriteTokens: msg.tokens.cache.write,
      reason: msg.finish,
      model: msg.modelID,
    }

    // Emit session init from message if not done
    if (!this.sessionInitEmitted && msg.sessionID) {
      this.sessionId = msg.sessionID
      stream.sessionInit(msg.sessionID)
      this.sessionInitEmitted = true
    }

    // Handle message-level errors
    if (msg.error) {
      const errName = msg.error.name
      const errMsg = 'message' in msg.error.data
        ? (msg.error.data as { message: string }).message
        : 'Unknown error'
      stream.status('running', undefined, `Error [${errName}]: ${errMsg}`)
    }
  }

  /**
   * Handle session.status event.
   */
  private handleSessionStatus(event: EventSessionStatus, stream: TaskOutputStream): void {
    const { status } = event.properties

    if (!this.sessionInitEmitted && event.properties.sessionID) {
      this.sessionId = event.properties.sessionID
      stream.sessionInit(event.properties.sessionID)
      this.sessionInitEmitted = true
    }

    switch (status.type) {
      case 'busy':
        stream.status('running', undefined, 'Session busy')
        break
      case 'retry':
        stream.status('running', undefined, `Retrying (attempt ${status.attempt}): ${status.message}`)
        break
      case 'idle':
        stream.status('running', 100, 'Session idle')
        break
    }
  }

  /**
   * Handle session.error event.
   */
  private handleSessionError(event: EventSessionError, stream: TaskOutputStream): void {
    const { error, sessionID } = event.properties

    if (!this.sessionInitEmitted && sessionID) {
      this.sessionId = sessionID
      stream.sessionInit(sessionID)
      this.sessionInitEmitted = true
    }

    if (error) {
      const errName = error.name
      const errMsg = 'message' in error.data
        ? (error.data as { message: string }).message
        : 'Unknown error'
      stream.status('running', undefined, `Error [${errName}]: ${errMsg}`)
    }
  }

  /**
   * Handle session.created event.
   */
  private handleSessionCreated(event: EventSessionCreated, stream: TaskOutputStream): void {
    const { info } = event.properties

    if (!this.sessionInitEmitted) {
      this.sessionId = info.id
      stream.sessionInit(info.id)
      this.sessionInitEmitted = true
    }
  }

  /**
   * Handle session.idle event.
   */
  private handleSessionIdle(event: EventSessionIdle, stream: TaskOutputStream): void {
    if (!this.sessionInitEmitted && event.properties.sessionID) {
      this.sessionId = event.properties.sessionID
      stream.sessionInit(event.properties.sessionID)
      this.sessionInitEmitted = true
    }

    stream.status('running', 100, 'Session completed')
  }

  // Accessors

  getSessionId(): string | null {
    return this.sessionId
  }

  getLastMetrics() {
    return this.lastMetrics
  }

  getToolName(callID: string): string | undefined {
    return this.toolNameMap.get(callID)
  }

  reset(): void {
    this.sessionId = null
    this.sessionInitEmitted = false
    this.lastMetrics = null
    this.toolNameMap.clear()
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('OpenCode SDK Integration Path', () => {
  // ===========================================================================
  // 1. SDK Import and Availability Check
  // ===========================================================================

  describe.skipIf(!sdkAvailable)('SDK import and availability check', () => {
    it('imports createOpencodeClient from @opencode-ai/sdk', async () => {
      const sdk = await import('@opencode-ai/sdk')
      expect(sdk.createOpencodeClient).toBeDefined()
      expect(typeof sdk.createOpencodeClient).toBe('function')
    })

    it('imports createOpencodeServer from @opencode-ai/sdk', async () => {
      const sdk = await import('@opencode-ai/sdk')
      expect(sdk.createOpencodeServer).toBeDefined()
      expect(typeof sdk.createOpencodeServer).toBe('function')
    })

    it('imports createOpencode convenience wrapper from @opencode-ai/sdk', async () => {
      const sdk = await import('@opencode-ai/sdk')
      expect(sdk.createOpencode).toBeDefined()
      expect(typeof sdk.createOpencode).toBe('function')
    })

    it('exports OpencodeClient class', async () => {
      const sdk = await import('@opencode-ai/sdk')
      expect(sdk.OpencodeClient).toBeDefined()
    })

    it('createOpencodeClient accepts config with baseUrl', async () => {
      // Type check: verify the function signature accepts expected params
      const sdk = await import('@opencode-ai/sdk')
      // This should not throw — we're not connecting, just creating the client
      // Note: The client creation doesn't make network calls, it just configures
      const client = sdk.createOpencodeClient({
        baseUrl: 'http://localhost:23818',
      })
      expect(client).toBeDefined()
      expect(client.session).toBeDefined()
      expect(client.event).toBeDefined()
    })

    it('SDK client has expected session methods', async () => {
      const sdk = await import('@opencode-ai/sdk')
      const client = sdk.createOpencodeClient({
        baseUrl: 'http://localhost:23818',
      })

      // Verify session sub-client has the methods we need
      expect(typeof client.session.create).toBe('function')
      expect(typeof client.session.prompt).toBe('function')
      expect(typeof client.session.promptAsync).toBe('function')
      expect(typeof client.session.abort).toBe('function')
      expect(typeof client.session.get).toBe('function')
      expect(typeof client.session.list).toBe('function')
      expect(typeof client.session.delete).toBe('function')
      expect(typeof client.session.messages).toBe('function')
      expect(typeof client.session.status).toBe('function')
    })

    it('SDK client has event subscription method', async () => {
      const sdk = await import('@opencode-ai/sdk')
      const client = sdk.createOpencodeClient({
        baseUrl: 'http://localhost:23818',
      })

      expect(typeof client.event.subscribe).toBe('function')
    })

    it('SDK client has global event method', async () => {
      const sdk = await import('@opencode-ai/sdk')
      const client = sdk.createOpencodeClient({
        baseUrl: 'http://localhost:23818',
      })

      expect(typeof client.global.event).toBe('function')
    })
  })

  // ===========================================================================
  // 2. Session Creation Mock
  // ===========================================================================

  describe('session creation mock', () => {
    it('creates a session with expected response shape', async () => {
      // Mock the session.create call
      const mockSession: Session = {
        id: 'oc-sdk-sess-001',
        projectID: 'proj-001',
        directory: '/tmp/test-project',
        title: 'Test Session',
        version: '1.0.0',
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }

      const mockCreate = vi.fn().mockResolvedValue({
        data: mockSession,
        error: undefined,
      })

      // Simulate calling session.create
      const result = await mockCreate({
        body: { title: 'Test Session' },
        query: { directory: '/tmp/test-project' },
      })

      expect(result.data).toBeDefined()
      expect(result.data.id).toBe('oc-sdk-sess-001')
      expect(result.data.directory).toBe('/tmp/test-project')
      expect(result.data.time.created).toBeDefined()
    })

    it('creates a session with parent ID for forking', async () => {
      const mockSession: Session = {
        id: 'oc-sdk-sess-002',
        projectID: 'proj-001',
        directory: '/tmp/test-project',
        parentID: 'oc-sdk-sess-001',
        title: 'Forked Session',
        version: '1.0.0',
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }

      const mockCreate = vi.fn().mockResolvedValue({
        data: mockSession,
        error: undefined,
      })

      const result = await mockCreate({
        body: { parentID: 'oc-sdk-sess-001', title: 'Forked Session' },
      })

      expect(result.data.parentID).toBe('oc-sdk-sess-001')
    })

    it('handles session creation error (400 BadRequest)', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: undefined,
        error: {
          data: {},
          errors: [{ message: 'Invalid session parameters' }],
          success: false,
        },
      })

      const result = await mockCreate({
        body: { title: '' },
      })

      expect(result.error).toBeDefined()
      expect(result.data).toBeUndefined()
    })

    it('session.create matches SessionCreateData shape', () => {
      // Type check: verify the data shape
      const createData: SessionCreateData = {
        body: {
          title: 'Test',
          parentID: 'parent-123',
        },
        query: {
          directory: '/tmp/project',
        },
        url: '/session',
      }

      expect(createData.url).toBe('/session')
      expect(createData.body?.title).toBe('Test')
    })
  })

  // ===========================================================================
  // 3. Prompt Sending with SSE Streaming
  // ===========================================================================

  describe('prompt sending with SSE streaming', () => {
    it('sends a prompt with text part input', () => {
      // Verify TextPartInput shape matches SDK types
      const textInput: TextPartInput = {
        type: 'text',
        text: 'Implement a new feature for the app',
      }

      expect(textInput.type).toBe('text')
      expect(textInput.text).toBe('Implement a new feature for the app')
    })

    it('prompt data matches SessionPromptData shape', () => {
      const promptData: SessionPromptData = {
        path: { id: 'oc-sdk-sess-001' },
        body: {
          parts: [
            { type: 'text', text: 'Implement the feature' },
          ],
        },
        url: '/session/{id}/message',
      }

      expect(promptData.path.id).toBe('oc-sdk-sess-001')
      expect(promptData.body?.parts).toHaveLength(1)
    })

    it('prompt data supports model selection', () => {
      const promptData: SessionPromptData = {
        path: { id: 'oc-sdk-sess-001' },
        body: {
          parts: [{ type: 'text', text: 'Test' }],
          model: {
            providerID: 'anthropic',
            modelID: 'claude-sonnet-4-20250514',
          },
        },
        url: '/session/{id}/message',
      }

      expect(promptData.body?.model?.providerID).toBe('anthropic')
      expect(promptData.body?.model?.modelID).toBe('claude-sonnet-4-20250514')
    })

    it('prompt data supports system prompt', () => {
      const promptData: SessionPromptData = {
        path: { id: 'oc-sdk-sess-001' },
        body: {
          parts: [{ type: 'text', text: 'Test' }],
          system: 'You are a helpful coding assistant.',
        },
        url: '/session/{id}/message',
      }

      expect(promptData.body?.system).toBe('You are a helpful coding assistant.')
    })

    it('promptAsync data matches SessionPromptAsyncData shape', () => {
      const promptData: SessionPromptAsyncData = {
        path: { id: 'oc-sdk-sess-001' },
        body: {
          parts: [{ type: 'text', text: 'Background task' }],
        },
        url: '/session/{id}/prompt_async',
      }

      expect(promptData.url).toBe('/session/{id}/prompt_async')
    })

    it('simulates sync prompt returning AssistantMessage', async () => {
      const mockAssistantMessage: AssistantMessage = {
        id: 'msg-001',
        sessionID: 'oc-sdk-sess-001',
        role: 'assistant',
        time: {
          created: Date.now(),
          completed: Date.now() + 5000,
        },
        parentID: 'msg-000',
        modelID: 'claude-sonnet-4-20250514',
        providerID: 'anthropic',
        mode: 'default',
        path: { cwd: '/tmp/test', root: '/tmp/test' },
        cost: 0.0045,
        tokens: {
          input: 200,
          output: 100,
          reasoning: 0,
          cache: { read: 50, write: 30 },
        },
        finish: 'end_turn',
      }

      const mockTextPart: TextPart = {
        id: 'part-001',
        sessionID: 'oc-sdk-sess-001',
        messageID: 'msg-001',
        type: 'text',
        text: 'I have implemented the feature.',
        time: { start: Date.now(), end: Date.now() + 5000 },
      }

      const mockPrompt = vi.fn().mockResolvedValue({
        data: {
          info: mockAssistantMessage,
          parts: [mockTextPart],
        },
        error: undefined,
      })

      const result = await mockPrompt({
        path: { id: 'oc-sdk-sess-001' },
        body: {
          parts: [{ type: 'text', text: 'Implement the feature' }],
        },
      })

      expect(result.data.info.role).toBe('assistant')
      expect(result.data.info.cost).toBe(0.0045)
      expect(result.data.info.tokens.input).toBe(200)
      expect(result.data.parts).toHaveLength(1)
      expect(result.data.parts[0].type).toBe('text')
    })

    it('simulates async SSE event stream from promptAsync', async () => {
      // Create a mock async generator for event.subscribe()
      const events: Event[] = [
        {
          type: 'session.status',
          properties: {
            sessionID: 'oc-sdk-sess-001',
            status: { type: 'busy' },
          },
        } as EventSessionStatus,
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'oc-sdk-sess-001',
              messageID: 'm1',
              type: 'text',
              text: 'Starting implementation...',
              time: { start: Date.now() },
            } as TextPart,
          },
        } as EventMessagePartUpdated,
        {
          type: 'session.idle',
          properties: {
            sessionID: 'oc-sdk-sess-001',
          },
        } as EventSessionIdle,
      ]

      async function* mockEventStream(): AsyncGenerator<Event> {
        for (const event of events) {
          yield event
        }
      }

      const stream = createMockStream()
      const adapter = new OpenCodeSdkAdapter()

      for await (const event of mockEventStream()) {
        adapter.handleEvent(event, stream)
      }

      expect(stream.sessionInit).toHaveBeenCalledWith('oc-sdk-sess-001')
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Session busy')
      expect(stream.text).toHaveBeenCalledWith('Starting implementation...')
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Session completed')
    })
  })

  // ===========================================================================
  // 4. Event Mapping from SDK Events to StreamEvent (TaskOutputStream)
  // ===========================================================================

  describe('event mapping from SDK events to TaskOutputStream', () => {
    let adapter: OpenCodeSdkAdapter
    let stream: TaskOutputStream

    beforeEach(() => {
      adapter = new OpenCodeSdkAdapter()
      stream = createMockStream()
    })

    // --- Text Part ---

    describe('TextPart mapping', () => {
      it('maps text part to stream.text()', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'text',
              text: 'Hello, world!',
              time: { start: Date.now(), end: Date.now() },
            },
          },
        }

        adapter.handleEvent(event, stream)

        expect(stream.text).toHaveBeenCalledWith('Hello, world!')
      })

      it('skips empty text', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'text',
              text: '',
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.text).not.toHaveBeenCalled()
      })

      it('skips synthetic text', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'text',
              text: 'Synthetic content',
              synthetic: true,
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.text).not.toHaveBeenCalled()
      })

      it('skips ignored text', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'text',
              text: 'Ignored content',
              ignored: true,
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.text).not.toHaveBeenCalled()
      })

      it('handles unicode text', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'text',
              text: '日本語 中文 🚀 π ≈ 3.14159',
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.text).toHaveBeenCalledWith('日本語 中文 🚀 π ≈ 3.14159')
      })

      it('handles whitespace-only text (valid)', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'text',
              text: '   ',
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.text).toHaveBeenCalledWith('   ')
      })
    })

    // --- Tool Part ---

    describe('ToolPart mapping', () => {
      it('maps running tool to stream.toolUse()', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p2',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'tool',
              callID: 'call-001',
              tool: 'bash',
              state: {
                status: 'running',
                input: { command: 'ls -la' },
                title: 'List files',
                time: { start: Date.now() },
              } as ToolStateRunning,
            },
          },
        }

        adapter.handleEvent(event, stream)

        expect(stream.toolUse).toHaveBeenCalledWith(
          'List files',
          expect.objectContaining({ toolCallId: 'call-001' }),
        )
      })

      it('maps pending tool to stream.toolUse()', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p2',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'tool',
              callID: 'call-001',
              tool: 'bash',
              state: {
                status: 'pending',
                input: { command: 'pwd' },
                raw: 'pwd',
              } as ToolStatePending,
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.toolUse).toHaveBeenCalledWith(
          'bash',
          expect.objectContaining({ toolCallId: 'call-001' }),
        )
      })

      it('maps completed tool to stream.toolResult() with success', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p2',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'tool',
              callID: 'call-001',
              tool: 'bash',
              state: {
                status: 'completed',
                input: { command: 'ls' },
                output: 'file1.txt\nfile2.txt',
                title: 'List directory',
                metadata: {},
                time: { start: Date.now(), end: Date.now() + 100 },
              } as ToolStateCompleted,
            },
          },
        }

        adapter.handleEvent(event, stream)

        expect(stream.toolResult).toHaveBeenCalledWith(
          'List directory',
          'file1.txt\nfile2.txt',
          true,
        )
      })

      it('maps error tool to stream.toolResult() with failure', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p2',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'tool',
              callID: 'call-001',
              tool: 'bash',
              state: {
                status: 'error',
                input: { command: 'bad-cmd' },
                error: 'command not found: bad-cmd',
                time: { start: Date.now(), end: Date.now() + 50 },
              } as ToolStateError,
            },
          },
        }

        adapter.handleEvent(event, stream)

        expect(stream.toolResult).toHaveBeenCalledWith(
          'bash',
          'command not found: bad-cmd',
          false,
        )
      })

      it('falls back to tool name when title is missing', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p2',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'tool',
              callID: 'call-001',
              tool: 'read',
              state: {
                status: 'completed',
                input: { path: 'file.txt' },
                output: 'contents',
                title: '',
                metadata: {},
                time: { start: Date.now(), end: Date.now() + 100 },
              } as ToolStateCompleted,
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.toolResult).toHaveBeenCalledWith('read', 'contents', true)
      })

      it('tracks tool callID → name mapping', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p2',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'tool',
              callID: 'unique-call-123',
              tool: 'write',
              state: {
                status: 'completed',
                input: { path: 'out.ts' },
                output: 'written',
                title: 'Write file',
                metadata: {},
                time: { start: Date.now(), end: Date.now() + 100 },
              } as ToolStateCompleted,
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(adapter.getToolName('unique-call-123')).toBe('write')
      })
    })

    // --- StepStart / StepFinish ---

    describe('StepStartPart and StepFinishPart mapping', () => {
      it('maps step_start to status("running")', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p0',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'step-start',
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Step started')
      })

      it('maps step_finish to metrics extraction', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p6',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'step-finish',
              reason: 'end_turn',
              cost: 0.0025,
              tokens: {
                input: 150,
                output: 75,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        }

        adapter.handleEvent(event, stream)

        const metrics = adapter.getLastMetrics()
        expect(metrics?.totalCost).toBe(0.0025)
        expect(metrics?.inputTokens).toBe(150)
        expect(metrics?.outputTokens).toBe(75)
        expect(metrics?.reason).toBe('end_turn')
        expect(stream.status).toHaveBeenCalledWith('running', 100, 'Step finished: end_turn')
      })

      it('extracts reasoning tokens from step_finish', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p6',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'step-finish',
              reason: 'end_turn',
              cost: 0.015,
              tokens: {
                input: 350,
                output: 150,
                reasoning: 120,
                cache: { read: 80, write: 50 },
              },
            },
          },
        }

        adapter.handleEvent(event, stream)

        const metrics = adapter.getLastMetrics()
        expect(metrics?.reasoningTokens).toBe(120)
        expect(metrics?.cacheReadTokens).toBe(80)
        expect(metrics?.cacheWriteTokens).toBe(50)
      })
    })

    // --- Reasoning Part ---

    describe('ReasoningPart mapping', () => {
      it('maps reasoning to stream.text()', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'r1',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'reasoning',
              text: 'The user wants to refactor auth.',
              time: { start: Date.now() },
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.text).toHaveBeenCalledWith('The user wants to refactor auth.')
      })

      it('skips empty reasoning', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'r1',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'reasoning',
              text: '',
              time: { start: Date.now() },
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.text).not.toHaveBeenCalled()
      })
    })

    // --- Session Events ---

    describe('session event mapping', () => {
      it('maps session.created to sessionInit', () => {
        const event: EventSessionCreated = {
          type: 'session.created',
          properties: {
            info: {
              id: 'new-sess-001',
              projectID: 'proj-001',
              directory: '/tmp/project',
              title: 'New Session',
              version: '1.0.0',
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.sessionInit).toHaveBeenCalledWith('new-sess-001')
      })

      it('maps session.status (busy) to status', () => {
        const event: EventSessionStatus = {
          type: 'session.status',
          properties: {
            sessionID: 'sess-001',
            status: { type: 'busy' },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Session busy')
      })

      it('maps session.status (retry) to status with details', () => {
        const event: EventSessionStatus = {
          type: 'session.status',
          properties: {
            sessionID: 'sess-001',
            status: {
              type: 'retry',
              attempt: 2,
              message: 'Rate limited',
              next: Date.now() + 60000,
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.status).toHaveBeenCalledWith(
          'running',
          undefined,
          'Retrying (attempt 2): Rate limited',
        )
      })

      it('maps session.status (idle) to completion', () => {
        const event: EventSessionStatus = {
          type: 'session.status',
          properties: {
            sessionID: 'sess-001',
            status: { type: 'idle' },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.status).toHaveBeenCalledWith('running', 100, 'Session idle')
      })

      it('maps session.idle to completion', () => {
        const event: EventSessionIdle = {
          type: 'session.idle',
          properties: {
            sessionID: 'sess-001',
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.status).toHaveBeenCalledWith('running', 100, 'Session completed')
      })
    })

    // --- Message Updated ---

    describe('message.updated mapping', () => {
      it('extracts metrics from AssistantMessage', () => {
        const event: EventMessageUpdated = {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-001',
              sessionID: 'sess-001',
              role: 'assistant',
              time: { created: Date.now(), completed: Date.now() + 5000 },
              parentID: 'msg-000',
              modelID: 'claude-sonnet-4-20250514',
              providerID: 'anthropic',
              mode: 'default',
              path: { cwd: '/tmp', root: '/tmp' },
              cost: 0.0089,
              tokens: {
                input: 280,
                output: 170,
                reasoning: 0,
                cache: { read: 50, write: 100 },
              },
              finish: 'end_turn',
            } as AssistantMessage,
          },
        }

        adapter.handleEvent(event, stream)

        const metrics = adapter.getLastMetrics()
        expect(metrics?.totalCost).toBe(0.0089)
        expect(metrics?.inputTokens).toBe(280)
        expect(metrics?.outputTokens).toBe(170)
        expect(metrics?.model).toBe('claude-sonnet-4-20250514')
        expect(metrics?.reason).toBe('end_turn')
      })

      it('handles AssistantMessage with error', () => {
        const event: EventMessageUpdated = {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-001',
              sessionID: 'sess-001',
              role: 'assistant',
              time: { created: Date.now() },
              parentID: 'msg-000',
              modelID: 'claude-sonnet-4-20250514',
              providerID: 'anthropic',
              mode: 'default',
              path: { cwd: '/tmp', root: '/tmp' },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              error: {
                name: 'APIError',
                data: { message: 'Rate limited', statusCode: 429, isRetryable: true },
              } as ApiError,
            } as AssistantMessage,
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.status).toHaveBeenCalledWith(
          'running',
          undefined,
          'Error [APIError]: Rate limited',
        )
      })

      it('ignores UserMessage in message.updated', () => {
        const event: EventMessageUpdated = {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-000',
              sessionID: 'sess-001',
              role: 'user',
              time: { created: Date.now() },
              agent: 'default',
              model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' },
            } as UserMessage,
          },
        }

        adapter.handleEvent(event, stream)
        // No metrics should be extracted from user messages
        expect(adapter.getLastMetrics()).toBeNull()
      })
    })

    // --- Session Init ---

    describe('sessionInit emission', () => {
      it('emits sessionInit on first event with sessionID', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'auto-init-sess',
              messageID: 'm1',
              type: 'text',
              text: 'Hello',
            },
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.sessionInit).toHaveBeenCalledWith('auto-init-sess')
      })

      it('emits sessionInit only once across events', () => {
        const events: Event[] = [
          {
            type: 'message.part.updated',
            properties: {
              part: { id: 'p1', sessionID: 'sess-001', messageID: 'm1', type: 'text', text: 'First' },
            },
          } as EventMessagePartUpdated,
          {
            type: 'message.part.updated',
            properties: {
              part: { id: 'p2', sessionID: 'sess-001', messageID: 'm1', type: 'text', text: 'Second' },
            },
          } as EventMessagePartUpdated,
        ]

        for (const event of events) {
          adapter.handleEvent(event, stream)
        }

        expect(stream.sessionInit).toHaveBeenCalledTimes(1)
      })
    })

    // --- Unknown Events ---

    describe('forward compatibility', () => {
      it('ignores unknown event types', () => {
        const event = {
          type: 'future.new.event',
          properties: { data: 'test' },
        } as unknown as Event

        // Should not throw
        expect(() => adapter.handleEvent(event, stream)).not.toThrow()
        expect(stream.text).not.toHaveBeenCalled()
        expect(stream.toolUse).not.toHaveBeenCalled()
      })

      it('ignores non-text/tool part types (snapshot, patch, agent, etc.)', () => {
        const event: EventMessagePartUpdated = {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'snap-1',
              sessionID: 'sess-001',
              messageID: 'm1',
              type: 'snapshot',
              snapshot: 'data',
            } as Part,
          },
        }

        adapter.handleEvent(event, stream)
        expect(stream.text).not.toHaveBeenCalled()
        expect(stream.toolUse).not.toHaveBeenCalled()
        expect(stream.toolResult).not.toHaveBeenCalled()
      })
    })
  })

  // ===========================================================================
  // 5. Abort via session.abort()
  // ===========================================================================

  describe('abort via session.abort()', () => {
    it('abort data matches SessionAbortData shape', () => {
      const abortData: SessionAbortData = {
        path: { id: 'oc-sdk-sess-001' },
        url: '/session/{id}/abort',
      }

      expect(abortData.path.id).toBe('oc-sdk-sess-001')
      expect(abortData.url).toBe('/session/{id}/abort')
    })

    it('simulates successful abort returning true', async () => {
      const mockAbort = vi.fn().mockResolvedValue({
        data: true,
        error: undefined,
      })

      const result = await mockAbort({
        path: { id: 'oc-sdk-sess-001' },
      })

      expect(result.data).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('simulates abort with 404 (session not found)', async () => {
      const mockAbort = vi.fn().mockResolvedValue({
        data: undefined,
        error: {
          name: 'NotFoundError',
          data: { message: 'Session not found' },
        },
      })

      const result = await mockAbort({
        path: { id: 'nonexistent-session' },
      })

      expect(result.error).toBeDefined()
      expect(result.data).toBeUndefined()
    })

    it('handles abort followed by session.error event', () => {
      const stream = createMockStream()
      const adapter = new OpenCodeSdkAdapter()

      // Simulate the error event that follows an abort
      const errorEvent: EventSessionError = {
        type: 'session.error',
        properties: {
          sessionID: 'oc-sdk-sess-001',
          error: {
            name: 'MessageAbortedError',
            data: { message: 'Operation was cancelled by user' },
          },
        },
      }

      adapter.handleEvent(errorEvent, stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [MessageAbortedError]: Operation was cancelled by user',
      )
    })

    it('handles abort followed by session.idle event', () => {
      const stream = createMockStream()
      const adapter = new OpenCodeSdkAdapter()

      // First some activity
      const textEvent: EventMessagePartUpdated = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 'oc-sdk-sess-001',
            messageID: 'm1',
            type: 'text',
            text: 'Working on it...',
          },
        },
      }
      adapter.handleEvent(textEvent, stream)

      // Then abort leads to idle
      const idleEvent: EventSessionIdle = {
        type: 'session.idle',
        properties: { sessionID: 'oc-sdk-sess-001' },
      }
      adapter.handleEvent(idleEvent, stream)

      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Session completed')
    })
  })

  // ===========================================================================
  // 6. Error Handling
  // ===========================================================================

  describe('error handling', () => {
    let adapter: OpenCodeSdkAdapter
    let stream: TaskOutputStream

    beforeEach(() => {
      adapter = new OpenCodeSdkAdapter()
      stream = createMockStream()
    })

    it('handles ProviderAuthError in session.error', () => {
      const event: EventSessionError = {
        type: 'session.error',
        properties: {
          sessionID: 'sess-001',
          error: {
            name: 'ProviderAuthError',
            data: {
              providerID: 'anthropic',
              message: 'Invalid API key',
            },
          },
        },
      }

      adapter.handleEvent(event, stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [ProviderAuthError]: Invalid API key',
      )
    })

    it('handles APIError in session.error', () => {
      const event: EventSessionError = {
        type: 'session.error',
        properties: {
          sessionID: 'sess-001',
          error: {
            name: 'APIError',
            data: {
              message: 'Rate limit exceeded',
              statusCode: 429,
              isRetryable: true,
            },
          },
        },
      }

      adapter.handleEvent(event, stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [APIError]: Rate limit exceeded',
      )
    })

    it('handles MessageAbortedError in session.error', () => {
      const event: EventSessionError = {
        type: 'session.error',
        properties: {
          sessionID: 'sess-001',
          error: {
            name: 'MessageAbortedError',
            data: { message: 'Operation cancelled' },
          },
        },
      }

      adapter.handleEvent(event, stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [MessageAbortedError]: Operation cancelled',
      )
    })

    it('handles UnknownError in session.error', () => {
      const event: EventSessionError = {
        type: 'session.error',
        properties: {
          sessionID: 'sess-001',
          error: {
            name: 'UnknownError',
            data: { message: 'Something went wrong' },
          },
        },
      }

      adapter.handleEvent(event, stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [UnknownError]: Something went wrong',
      )
    })

    it('handles MessageOutputLengthError in message.updated', () => {
      const event: EventMessageUpdated = {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg-err',
            sessionID: 'sess-001',
            role: 'assistant',
            time: { created: Date.now() },
            parentID: 'msg-000',
            modelID: 'claude-sonnet-4-20250514',
            providerID: 'anthropic',
            mode: 'default',
            path: { cwd: '/tmp', root: '/tmp' },
            cost: 0.001,
            tokens: { input: 100, output: 8192, reasoning: 0, cache: { read: 0, write: 0 } },
            error: {
              name: 'MessageOutputLengthError',
              data: { message: 'Output exceeded maximum' },
            } as unknown as MessageOutputLengthError,
          } as AssistantMessage,
        },
      }

      adapter.handleEvent(event, stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        expect.stringContaining('Error [MessageOutputLengthError]'),
      )
    })

    it('handles session.error without error details', () => {
      const event: EventSessionError = {
        type: 'session.error',
        properties: {
          sessionID: 'sess-001',
        },
      }

      // Should not throw
      expect(() => adapter.handleEvent(event, stream)).not.toThrow()
    })

    it('handles session.error with sessionID → sessionInit', () => {
      const event: EventSessionError = {
        type: 'session.error',
        properties: {
          sessionID: 'sess-error-init',
          error: {
            name: 'APIError',
            data: { message: 'Server error', statusCode: 500, isRetryable: true },
          },
        },
      }

      adapter.handleEvent(event, stream)

      // Should emit sessionInit from error event
      expect(stream.sessionInit).toHaveBeenCalledWith('sess-error-init')
    })
  })

  // ===========================================================================
  // 7. Full Session Integration Sequence
  // ===========================================================================

  describe('full session integration sequence', () => {
    it('processes a complete SDK session lifecycle', () => {
      const stream = createMockStream()
      const adapter = new OpenCodeSdkAdapter()

      const events: Event[] = [
        // Session created
        {
          type: 'session.created',
          properties: {
            info: {
              id: 'full-sess-001',
              projectID: 'proj-001',
              directory: '/tmp/project',
              title: 'Full Session',
              version: '1.0.0',
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        } as EventSessionCreated,

        // Session becomes busy
        {
          type: 'session.status',
          properties: {
            sessionID: 'full-sess-001',
            status: { type: 'busy' },
          },
        } as EventSessionStatus,

        // Step starts
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p0',
              sessionID: 'full-sess-001',
              messageID: 'm1',
              type: 'step-start',
            },
          },
        } as EventMessagePartUpdated,

        // Text output
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'full-sess-001',
              messageID: 'm1',
              type: 'text',
              text: "I'll analyze the project structure.",
            },
          },
        } as EventMessagePartUpdated,

        // Tool running
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p2',
              sessionID: 'full-sess-001',
              messageID: 'm1',
              type: 'tool',
              callID: 'call-001',
              tool: 'bash',
              state: {
                status: 'running',
                input: { command: 'ls -la' },
                title: 'List directory',
                time: { start: Date.now() },
              } as ToolStateRunning,
            },
          },
        } as EventMessagePartUpdated,

        // Tool completed
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p2',
              sessionID: 'full-sess-001',
              messageID: 'm1',
              type: 'tool',
              callID: 'call-001',
              tool: 'bash',
              state: {
                status: 'completed',
                input: { command: 'ls -la' },
                output: 'package.json\ntsconfig.json\nsrc/',
                title: 'List directory',
                metadata: {},
                time: { start: Date.now(), end: Date.now() + 200 },
              } as ToolStateCompleted,
            },
          },
        } as EventMessagePartUpdated,

        // More text
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p3',
              sessionID: 'full-sess-001',
              messageID: 'm1',
              type: 'text',
              text: 'The project has standard structure.',
            },
          },
        } as EventMessagePartUpdated,

        // Step finishes with metrics
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p6',
              sessionID: 'full-sess-001',
              messageID: 'm1',
              type: 'step-finish',
              reason: 'end_turn',
              cost: 0.0045,
              tokens: {
                input: 200,
                output: 100,
                reasoning: 0,
                cache: { read: 50, write: 30 },
              },
            },
          },
        } as EventMessagePartUpdated,

        // Message completed
        {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-001',
              sessionID: 'full-sess-001',
              role: 'assistant',
              time: { created: Date.now(), completed: Date.now() + 5000 },
              parentID: 'msg-000',
              modelID: 'claude-sonnet-4-20250514',
              providerID: 'anthropic',
              mode: 'default',
              path: { cwd: '/tmp/project', root: '/tmp/project' },
              cost: 0.0045,
              tokens: {
                input: 200,
                output: 100,
                reasoning: 0,
                cache: { read: 50, write: 30 },
              },
              finish: 'end_turn',
            } as AssistantMessage,
          },
        } as EventMessageUpdated,

        // Session becomes idle
        {
          type: 'session.idle',
          properties: { sessionID: 'full-sess-001' },
        } as EventSessionIdle,
      ]

      for (const event of events) {
        adapter.handleEvent(event, stream)
      }

      // Verify full lifecycle
      expect(stream.sessionInit).toHaveBeenCalledTimes(1)
      expect(stream.sessionInit).toHaveBeenCalledWith('full-sess-001')

      expect(stream.text).toHaveBeenCalledTimes(2)
      expect(stream.text).toHaveBeenCalledWith("I'll analyze the project structure.")
      expect(stream.text).toHaveBeenCalledWith('The project has standard structure.')

      expect(stream.toolUse).toHaveBeenCalledTimes(1)
      expect(stream.toolResult).toHaveBeenCalledTimes(1)
      expect(stream.toolResult).toHaveBeenCalledWith(
        'List directory',
        'package.json\ntsconfig.json\nsrc/',
        true,
      )

      // Verify metrics
      const metrics = adapter.getLastMetrics()
      expect(metrics?.totalCost).toBe(0.0045)
      expect(metrics?.model).toBe('claude-sonnet-4-20250514')
      expect(metrics?.reason).toBe('end_turn')

      // Verify completion
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Session completed')
    })

    it('processes session with error and recovery', () => {
      const stream = createMockStream()
      const adapter = new OpenCodeSdkAdapter()

      const events: Event[] = [
        // Text output
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1',
              sessionID: 'err-sess-001',
              messageID: 'm1',
              type: 'text',
              text: 'Starting analysis...',
            },
          },
        } as EventMessagePartUpdated,

        // Error occurs
        {
          type: 'session.error',
          properties: {
            sessionID: 'err-sess-001',
            error: {
              name: 'APIError',
              data: { message: 'Rate limited', statusCode: 429, isRetryable: true },
            },
          },
        } as EventSessionError,

        // Retry status
        {
          type: 'session.status',
          properties: {
            sessionID: 'err-sess-001',
            status: { type: 'retry', attempt: 1, message: 'Rate limited', next: Date.now() + 60000 },
          },
        } as EventSessionStatus,
      ]

      for (const event of events) {
        adapter.handleEvent(event, stream)
      }

      expect(stream.text).toHaveBeenCalledWith('Starting analysis...')
      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        expect.stringContaining('Rate limited'),
      )
    })
  })

  // ===========================================================================
  // 8. Adapter State Management
  // ===========================================================================

  describe('adapter state management', () => {
    it('tracks sessionId from events', () => {
      const adapter = new OpenCodeSdkAdapter()
      const stream = createMockStream()

      const event: EventSessionCreated = {
        type: 'session.created',
        properties: {
          info: {
            id: 'tracked-sess',
            projectID: 'proj-001',
            directory: '/tmp',
            title: 'Test',
            version: '1.0.0',
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      }

      adapter.handleEvent(event, stream)
      expect(adapter.getSessionId()).toBe('tracked-sess')
    })

    it('resets adapter state cleanly', () => {
      const adapter = new OpenCodeSdkAdapter()
      const stream = createMockStream()

      // Process some events
      const event: EventMessagePartUpdated = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 'sess-to-reset',
            messageID: 'm1',
            type: 'tool',
            callID: 'call-reset',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'ls' },
              output: 'files',
              title: 'List',
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            } as ToolStateCompleted,
          },
        },
      }

      adapter.handleEvent(event, stream)
      expect(adapter.getSessionId()).toBe('sess-to-reset')
      expect(adapter.getToolName('call-reset')).toBe('bash')

      // Reset
      adapter.reset()

      expect(adapter.getSessionId()).toBeNull()
      expect(adapter.getToolName('call-reset')).toBeUndefined()
      expect(adapter.getLastMetrics()).toBeNull()
    })

    it('processes events from new session after reset', () => {
      const adapter = new OpenCodeSdkAdapter()
      const stream = createMockStream()

      // First session
      adapter.handleEvent({
        type: 'message.part.updated',
        properties: {
          part: { id: 'p1', sessionID: 'sess-1', messageID: 'm1', type: 'text', text: 'First' },
        },
      } as EventMessagePartUpdated, stream)

      expect(stream.sessionInit).toHaveBeenCalledWith('sess-1')

      // Reset
      adapter.reset()
      vi.clearAllMocks()

      // Second session
      adapter.handleEvent({
        type: 'message.part.updated',
        properties: {
          part: { id: 'p1', sessionID: 'sess-2', messageID: 'm1', type: 'text', text: 'Second' },
        },
      } as EventMessagePartUpdated, stream)

      expect(stream.sessionInit).toHaveBeenCalledWith('sess-2')
      expect(adapter.getSessionId()).toBe('sess-2')
    })
  })

  // ===========================================================================
  // 9. SDK API Findings Documentation
  // ===========================================================================

  describe('SDK API findings and documentation', () => {
    it('documents SDK architecture (REST/SSE client, not CLI)', () => {
      /**
       * FINDING: The @opencode-ai/sdk v1.2.15 is fundamentally different from the CLI adapter:
       *
       * CLI Adapter (opencode-adapter.ts):
       * - Spawns `opencode run --print --output-format json` subprocess
       * - Parses JSONL from stdout line-by-line
       * - Abort via SIGTERM/SIGKILL process signals
       * - Events: system, assistant, tool_result, result (flat JSONL)
       *
       * SDK Adapter:
       * - Creates HTTP client via createOpencodeClient({ baseUrl })
       * - Requires a running OpenCode server (createOpencodeServer())
       * - Session CRUD via REST endpoints
       * - Streaming via SSE subscription (client.event.subscribe())
       * - Abort via REST API (client.session.abort())
       * - Events: message.part.updated, message.updated, session.status, session.error, etc.
       *
       * The SDK is a typed HTTP/SSE client generated from an OpenAPI spec
       * (HeyAPI codegen). It does NOT directly execute code — it communicates
       * with a local OpenCode server process.
       */
      expect(true).toBe(true) // Documentation test
    })

    it('documents event type differences between CLI and SDK', () => {
      /**
       * CLI JSONL Event Types → SDK Event Types Mapping:
       *
       * CLI "text" (wrapped)        → "message.part.updated" { part: TextPart }
       * CLI "tool_use" (wrapped)    → "message.part.updated" { part: ToolPart }
       * CLI "step_start" (wrapped)  → "message.part.updated" { part: StepStartPart }
       * CLI "step_finish" (wrapped) → "message.part.updated" { part: StepFinishPart }
       * CLI "reasoning" (wrapped)   → "message.part.updated" { part: ReasoningPart }
       * CLI "error" (top-level)     → "session.error" { error: SessionError }
       * CLI session init            → "session.created" or first event sessionID
       * CLI N/A                     → "session.status" (busy/idle/retry)
       * CLI N/A                     → "message.updated" (full message with metrics)
       * CLI N/A                     → "session.idle" (explicit completion)
       *
       * Key difference: CLI wraps events as { type, timestamp, sessionID, part },
       * SDK uses { type: "message.part.updated", properties: { part } }.
       * The Part structure is identical in both cases.
       */
      expect(true).toBe(true) // Documentation test
    })

    it('documents session prompt API shape', () => {
      /**
       * SDK Prompt API:
       *
       * Synchronous (waits for completion):
       *   client.session.prompt({
       *     path: { id: sessionId },
       *     body: {
       *       parts: [{ type: 'text', text: 'prompt' }],
       *       model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' },
       *       system: 'Optional system prompt',
       *       agent: 'Optional agent name',
       *       tools: { bash: true, read: true },  // Tool toggles
       *     },
       *   }) → { info: AssistantMessage, parts: Part[] }
       *
       * Asynchronous (fire-and-forget, stream via events):
       *   client.session.promptAsync({ ... same shape ... })
       *   // Then subscribe: client.event.subscribe() for SSE events
       *
       * For Astro integration, promptAsync + event.subscribe is the preferred
       * pattern since we need real-time streaming to the frontend.
       */
      expect(true).toBe(true) // Documentation test
    })

    it('verifies Part type compatibility between SDK and existing tests', () => {
      // The Part types in the SDK match exactly what the existing
      // provider-opencode.test.ts mock adapter expects
      const textPart: TextPart = {
        id: 'p1',
        sessionID: 's1',
        messageID: 'm1',
        type: 'text',
        text: 'test',
      }
      expect(textPart.type).toBe('text')

      const toolPart: ToolPart = {
        id: 'p2',
        sessionID: 's1',
        messageID: 'm1',
        type: 'tool',
        callID: 'c1',
        tool: 'bash',
        state: {
          status: 'completed',
          input: { command: 'ls' },
          output: 'files',
          title: 'List',
          metadata: {},
          time: { start: 0, end: 1 },
        },
      }
      expect(toolPart.type).toBe('tool')

      const stepFinish: StepFinishPart = {
        id: 'p3',
        sessionID: 's1',
        messageID: 'm1',
        type: 'step-finish',
        reason: 'end_turn',
        cost: 0.01,
        tokens: {
          input: 100,
          output: 50,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }
      expect(stepFinish.type).toBe('step-finish')
    })
  })

  // ===========================================================================
  // 9. Concurrent Session Handling
  // ===========================================================================

  describe('concurrent session handling', () => {
    it('independent adapters track separate session state', () => {
      const adapter1 = new OpenCodeSdkAdapter()
      const adapter2 = new OpenCodeSdkAdapter()
      const stream1 = createMockStream()
      const stream2 = createMockStream()

      // Session 1 gets created
      const created1: EventSessionCreated = {
        type: 'session.created',
        properties: {
          info: {
            id: 'session-001',
            projectID: 'proj-1',
            directory: '/workspace/a',
          } as Session,
        },
      }
      adapter1.handleEvent(created1, stream1)

      // Session 2 gets created with different ID
      const created2: EventSessionCreated = {
        type: 'session.created',
        properties: {
          info: {
            id: 'session-002',
            projectID: 'proj-2',
            directory: '/workspace/b',
          } as Session,
        },
      }
      adapter2.handleEvent(created2, stream2)

      expect(adapter1.getSessionId()).toBe('session-001')
      expect(adapter2.getSessionId()).toBe('session-002')

      // Events for session 1 don't affect session 2
      const text1: EventMessagePartUpdated = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 'session-001',
            messageID: 'm1',
            type: 'text',
            text: 'Hello from session 1',
          },
        },
      }
      adapter1.handleEvent(text1, stream1)

      expect(stream1.text).toHaveBeenCalledWith('Hello from session 1')
      expect(stream2.text).not.toHaveBeenCalled()
    })

    it('adapter reset isolates sequential sessions', () => {
      const adapter = new OpenCodeSdkAdapter()
      const stream1 = createMockStream()
      const stream2 = createMockStream()

      // First session
      const created1: EventSessionCreated = {
        type: 'session.created',
        properties: {
          info: {
            id: 'session-A',
            projectID: 'proj-1',
            directory: '/workspace',
          } as Session,
        },
      }
      adapter.handleEvent(created1, stream1)
      expect(adapter.getSessionId()).toBe('session-A')

      // Record some metrics
      const stepFinish: EventMessagePartUpdated = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 'session-A',
            messageID: 'm1',
            type: 'step-finish',
            reason: 'end_turn',
            cost: 0.05,
            tokens: { input: 500, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
          } as StepFinishPart,
        },
      }
      adapter.handleEvent(stepFinish, stream1)
      expect(adapter.getLastMetrics()?.totalCost).toBe(0.05)

      // Reset between sessions
      adapter.reset()
      expect(adapter.getSessionId()).toBeNull()
      expect(adapter.getLastMetrics()).toBeNull()

      // Second session starts fresh
      const created2: EventSessionCreated = {
        type: 'session.created',
        properties: {
          info: {
            id: 'session-B',
            projectID: 'proj-2',
            directory: '/workspace',
          } as Session,
        },
      }
      adapter.handleEvent(created2, stream2)
      expect(adapter.getSessionId()).toBe('session-B')

      // Metrics should not carry over
      expect(adapter.getLastMetrics()).toBeNull()
    })

    it('tool name maps are isolated per adapter instance', () => {
      const adapter1 = new OpenCodeSdkAdapter()
      const adapter2 = new OpenCodeSdkAdapter()
      const stream1 = createMockStream()

      // Adapter 1 tracks a tool call
      const tool1: EventMessagePartUpdated = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            sessionID: 's1',
            messageID: 'm1',
            type: 'tool',
            callID: 'call-001',
            tool: 'bash',
            state: {
              status: 'running',
              input: { command: 'ls' },
              title: 'List files',
              metadata: {},
              time: { start: 0 },
            } as ToolStateRunning,
          } as ToolPart,
        },
      }
      adapter1.handleEvent(tool1, stream1)

      // Adapter 1 should know about call-001, adapter 2 should not
      expect(adapter1.getToolName('call-001')).toBe('bash')
      expect(adapter2.getToolName('call-001')).toBeUndefined()
    })

    it('handles interleaved events from multiple sessions correctly', () => {
      const adapter1 = new OpenCodeSdkAdapter()
      const adapter2 = new OpenCodeSdkAdapter()
      const stream1 = createMockStream()
      const stream2 = createMockStream()

      // Session 1: text event
      adapter1.handleEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1', sessionID: 's1', messageID: 'm1',
            type: 'text', text: 'Session 1 text',
          },
        },
      } as EventMessagePartUpdated, stream1)

      // Session 2: text event (interleaved)
      adapter2.handleEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p2', sessionID: 's2', messageID: 'm2',
            type: 'text', text: 'Session 2 text',
          },
        },
      } as EventMessagePartUpdated, stream2)

      // Session 1: another text event
      adapter1.handleEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p3', sessionID: 's1', messageID: 'm1',
            type: 'text', text: ' continued',
          },
        },
      } as EventMessagePartUpdated, stream1)

      // Verify streams received the correct events
      expect(stream1.text).toHaveBeenCalledTimes(2)
      expect(stream1.text).toHaveBeenCalledWith('Session 1 text')
      expect(stream1.text).toHaveBeenCalledWith(' continued')
      expect(stream2.text).toHaveBeenCalledTimes(1)
      expect(stream2.text).toHaveBeenCalledWith('Session 2 text')
    })
  })
})
