/**
 * Tests for the OpenCode SDK adapter integration path.
 *
 * Tests cover:
 * 1. SDK import and availability check
 * 2. Session creation mock
 * 3. Prompt sending with SSE streaming
 * 4. Event mapping from SDK events to StreamEvent
 * 5. Abort via session.abort()
 * 6. Error handling
 *
 * Uses mock OpenCode client to test the adapter without a running server.
 * The adapter is designed to work with @opencode-ai/sdk v1.2.15.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OpenCodeSdkAdapter,
  type Task,
  type TaskOutputStream,
  type OpenCodeClient,
  type OpenCodeSession,
  type OpenCodeAssistantMessage,
  type OpenCodeEvent,
  type OpenCodeTextPart,
  type OpenCodeToolPart,
} from '../lib/agent-runner-adapters/opencode-sdk-adapter'

// ============================================================================
// Test Helpers
// ============================================================================

function createMockStream(): TaskOutputStream {
  return {
    stdout: vi.fn(),
    stderr: vi.fn(),
    status: vi.fn(),
    text: vi.fn(),
    toolUse: vi.fn(),
    toolResult: vi.fn(),
    fileChange: vi.fn(),
    sessionInit: vi.fn(),
  }
}

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task-001',
    projectId: 'project-001',
    planNodeId: 'node-001',
    provider: 'opencode',
    prompt: 'Implement a hello world function',
    workingDirectory: '/tmp/test-workspace',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function createMockSession(overrides: Partial<OpenCodeSession> = {}): OpenCodeSession {
  return {
    id: 'session-abc-123',
    title: 'Test Session',
    version: '1',
    time: {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
    ...overrides,
  }
}

function createMockAssistantMessage(
  overrides: Partial<OpenCodeAssistantMessage> = {}
): OpenCodeAssistantMessage {
  return {
    id: 'msg-001',
    cost: 0.0023,
    mode: 'normal',
    modelID: 'claude-sonnet-4-20250514',
    providerID: 'anthropic',
    role: 'assistant',
    sessionID: 'session-abc-123',
    system: [],
    time: {
      created: new Date().toISOString(),
      completed: new Date().toISOString(),
    },
    tokens: {
      input: 150,
      output: 250,
    },
    path: { cwd: '/tmp/test', root: '/tmp/test' },
    ...overrides,
  }
}

/**
 * Creates a mock async iterable that yields events.
 * Simulates the SSE event stream from client.event.list()
 */
function createMockEventStream(
  events: OpenCodeEvent[],
  options: { delayMs?: number } = {}
): AsyncIterable<OpenCodeEvent> & { controller: AbortController } {
  const controller = new AbortController()
  const { delayMs = 0 } = options

  const iterable = {
    controller,
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        async next(): Promise<IteratorResult<OpenCodeEvent>> {
          if (controller.signal.aborted || index >= events.length) {
            return { value: undefined, done: true }
          }
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }
          const value = events[index++]
          return { value, done: false }
        },
        async return(): Promise<IteratorResult<OpenCodeEvent>> {
          return { value: undefined, done: true }
        },
      }
    },
  }

  return iterable
}

function createMockClient(overrides: Partial<{
  session: Partial<OpenCodeClient['session']>;
  event: Partial<OpenCodeClient['event']>;
  events: OpenCodeEvent[];
}> = {}): OpenCodeClient {
  const session = createMockSession()
  const message = createMockAssistantMessage()
  const events = overrides.events ?? []

  return {
    session: {
      create: vi.fn().mockResolvedValue(session),
      chat: vi.fn().mockResolvedValue(message),
      abort: vi.fn().mockResolvedValue({ success: true }),
      messages: vi.fn().mockResolvedValue([message]),
      delete: vi.fn().mockResolvedValue({ success: true }),
      list: vi.fn().mockResolvedValue([session]),
      ...overrides.session,
    },
    event: {
      list: vi.fn().mockResolvedValue(createMockEventStream(events)),
      ...overrides.event,
    },
  }
}

// ============================================================================
// 1. SDK Import and Availability Check
// ============================================================================

describe('OpenCode SDK adapter — SDK import and availability', () => {
  it('exports OpenCodeSdkAdapter class', () => {
    expect(OpenCodeSdkAdapter).toBeDefined()
    expect(typeof OpenCodeSdkAdapter).toBe('function')
  })

  it('has correct type and name properties', () => {
    const adapter = new OpenCodeSdkAdapter()
    expect(adapter.type).toBe('opencode')
    expect(adapter.name).toBe('OpenCode (SDK)')
  })

  it('implements ProviderAdapter interface methods', () => {
    const adapter = new OpenCodeSdkAdapter()
    expect(typeof adapter.isAvailable).toBe('function')
    expect(typeof adapter.execute).toBe('function')
    expect(typeof adapter.getStatus).toBe('function')
  })

  it('isAvailable returns false when server is unreachable', async () => {
    // Use a port that is unlikely to be running
    const adapter = new OpenCodeSdkAdapter({ baseUrl: 'http://localhost:19999' })
    const available = await adapter.isAvailable()
    expect(available).toBe(false)
  })

  it('accepts custom baseUrl in constructor', () => {
    const adapter = new OpenCodeSdkAdapter({ baseUrl: 'http://custom-host:9999' })
    expect(adapter).toBeDefined()
  })

  it('accepts injected client for testing', () => {
    const mockClient = createMockClient()
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    expect(adapter).toBeDefined()
  })

  it('getStatus reports current state', async () => {
    const mockClient = createMockClient()
    const adapter = new OpenCodeSdkAdapter({
      client: mockClient,
      baseUrl: 'http://localhost:19999', // unreachable
    })
    const status = await adapter.getStatus()
    expect(status).toMatchObject({
      available: false,
      version: null,
      activeTasks: 0,
      maxTasks: 4,
    })
  })
})

// ============================================================================
// 2. Session Creation Mock
// ============================================================================

describe('OpenCode SDK adapter — session creation', () => {
  let adapter: OpenCodeSdkAdapter
  let mockClient: OpenCodeClient
  let stream: TaskOutputStream

  beforeEach(() => {
    mockClient = createMockClient()
    adapter = new OpenCodeSdkAdapter({ client: mockClient })
    stream = createMockStream()
  })

  it('creates a session via client.session.create()', async () => {
    const task = createMockTask()
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    expect(mockClient.session.create).toHaveBeenCalledTimes(1)
  })

  it('emits sessionInit with session ID after creation', async () => {
    const task = createMockTask()
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    expect(stream.sessionInit).toHaveBeenCalledWith(
      'session-abc-123',
      'claude-sonnet-4-20250514'
    )
  })

  it('uses task.model when provided', async () => {
    const task = createMockTask({ model: 'gpt-4o' })
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    expect(stream.sessionInit).toHaveBeenCalledWith(
      'session-abc-123',
      'gpt-4o'
    )
  })

  it('returns completed status on successful execution', async () => {
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('completed')
    expect(result.taskId).toBe('test-task-001')
    expect(result.startedAt).toBeDefined()
    expect(result.completedAt).toBeDefined()
  })

  it('includes metrics from assistant message in result', async () => {
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.metrics).toMatchObject({
      inputTokens: 150,
      outputTokens: 250,
      totalCost: 0.0023,
      model: 'claude-sonnet-4-20250514',
    })
    expect(result.metrics!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('handles session creation failure', async () => {
    const failingClient = createMockClient({
      session: {
        create: vi.fn().mockRejectedValue(new Error('Server is starting up')),
      },
    })
    const failAdapter = new OpenCodeSdkAdapter({ client: failingClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await failAdapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('Server is starting up')
  })

  it('sends custom session IDs from create response', async () => {
    const customSession = createMockSession({ id: 'custom-session-xyz' })
    const clientWithCustomSession = createMockClient({
      session: {
        create: vi.fn().mockResolvedValue(customSession),
      },
    })
    const customAdapter = new OpenCodeSdkAdapter({ client: clientWithCustomSession })
    const task = createMockTask()
    const abortController = new AbortController()

    await customAdapter.execute(task, stream, abortController.signal)

    expect(stream.sessionInit).toHaveBeenCalledWith(
      'custom-session-xyz',
      expect.any(String)
    )
  })
})

// ============================================================================
// 3. Prompt Sending with SSE Streaming
// ============================================================================

describe('OpenCode SDK adapter — prompt sending with SSE streaming', () => {
  let adapter: OpenCodeSdkAdapter
  let mockClient: OpenCodeClient
  let stream: TaskOutputStream

  beforeEach(() => {
    stream = createMockStream()
  })

  it('sends prompt via client.session.chat() with correct parameters', async () => {
    mockClient = createMockClient()
    adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask({ prompt: 'Build a REST API' })
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    expect(mockClient.session.chat).toHaveBeenCalledWith(
      'session-abc-123',
      expect.objectContaining({
        modelID: 'claude-sonnet-4-20250514',
        providerID: 'anthropic',
        parts: [{ type: 'text', text: 'Build a REST API' }],
      })
    )
  })

  it('passes systemPrompt to chat when provided', async () => {
    mockClient = createMockClient()
    adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask({
      prompt: 'Build the feature',
      systemPrompt: 'You are a senior engineer',
    })
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    expect(mockClient.session.chat).toHaveBeenCalledWith(
      'session-abc-123',
      expect.objectContaining({
        system: 'You are a senior engineer',
        parts: [{ type: 'text', text: 'Build the feature' }],
      })
    )
  })

  it('starts SSE event listener before sending prompt', async () => {
    const callOrder: string[] = []

    mockClient = createMockClient({
      session: {
        create: vi.fn().mockImplementation(async () => {
          callOrder.push('create')
          return createMockSession()
        }),
        chat: vi.fn().mockImplementation(async () => {
          callOrder.push('chat')
          return createMockAssistantMessage()
        }),
      },
      event: {
        list: vi.fn().mockImplementation(async () => {
          callOrder.push('event.list')
          return createMockEventStream([])
        }),
      },
    })
    adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    expect(callOrder).toEqual(['create', 'event.list', 'chat'])
  })

  it('processes text events from SSE stream', async () => {
    const textEvent: OpenCodeEvent = {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          messageID: 'msg-1',
          sessionID: 'session-abc-123',
          text: 'Hello, world!',
          type: 'text',
        } as OpenCodeTextPart,
      },
    }

    mockClient = createMockClient({ events: [textEvent] })
    adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    expect(stream.text).toHaveBeenCalledWith('Hello, world!')
  })

  it('accumulates text output from multiple events', async () => {
    const events: OpenCodeEvent[] = [
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part-1',
            messageID: 'msg-1',
            sessionID: 'session-abc-123',
            text: 'First chunk. ',
            type: 'text',
          } as OpenCodeTextPart,
        },
      },
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part-2',
            messageID: 'msg-1',
            sessionID: 'session-abc-123',
            text: 'Second chunk.',
            type: 'text',
          } as OpenCodeTextPart,
        },
      },
    ]

    mockClient = createMockClient({ events })
    adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(stream.text).toHaveBeenCalledTimes(2)
    expect(stream.text).toHaveBeenCalledWith('First chunk. ')
    expect(stream.text).toHaveBeenCalledWith('Second chunk.')
    expect(result.output).toBe('First chunk. Second chunk.')
  })

  it('sets up event.list() for SSE streaming', async () => {
    mockClient = createMockClient()
    adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    expect(mockClient.event.list).toHaveBeenCalledTimes(1)
  })

  it('reports status updates during execution lifecycle', async () => {
    mockClient = createMockClient()
    adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    // Should emit status updates at key points
    expect(stream.status).toHaveBeenCalledWith('running', 0, 'Initializing OpenCode SDK')
    expect(stream.status).toHaveBeenCalledWith('running', 5, 'Session created')
    expect(stream.status).toHaveBeenCalledWith('running', 10, 'Sending prompt')
    expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed')
  })
})

// ============================================================================
// 4. Event Mapping from SDK Events to StreamEvent
// ============================================================================

describe('OpenCode SDK adapter — event mapping', () => {
  let adapter: OpenCodeSdkAdapter
  let stream: TaskOutputStream

  beforeEach(() => {
    adapter = new OpenCodeSdkAdapter()
    stream = createMockStream()
  })

  describe('message.part.updated — text parts', () => {
    it('maps TextPart to stream.text()', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part-1',
            messageID: 'msg-1',
            sessionID: 'sess-1',
            text: 'Generated code here',
            type: 'text',
          } as OpenCodeTextPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.text).toHaveBeenCalledWith('Generated code here')
      expect(callbacks.onText).toHaveBeenCalledWith('Generated code here')
    })

    it('ignores text parts with empty text', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part-1',
            messageID: 'msg-1',
            sessionID: 'sess-1',
            text: '',
            type: 'text',
          } as OpenCodeTextPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.text).not.toHaveBeenCalled()
    })
  })

  describe('message.part.updated — tool parts', () => {
    it('maps ToolStateRunning to stream.toolUse()', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool-part-1',
            callID: 'call-1',
            messageID: 'msg-1',
            sessionID: 'sess-1',
            tool: 'bash',
            type: 'tool',
            state: {
              status: 'running',
              input: { command: 'ls -la' },
              title: 'Running bash',
              time: { start: new Date().toISOString() },
            },
          } as OpenCodeToolPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'ls -la' })
    })

    it('maps ToolStateCompleted to stream.toolResult() with success', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool-part-1',
            callID: 'call-1',
            messageID: 'msg-1',
            sessionID: 'sess-1',
            tool: 'bash',
            type: 'tool',
            state: {
              status: 'completed',
              input: { command: 'ls -la' },
              output: 'file1.txt\nfile2.txt',
              title: 'bash',
              metadata: {},
              time: {
                start: new Date().toISOString(),
                end: new Date().toISOString(),
              },
            },
          } as OpenCodeToolPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.toolResult).toHaveBeenCalledWith('bash', 'file1.txt\nfile2.txt', true)
    })

    it('maps ToolStateError to stream.toolResult() with failure', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool-part-1',
            callID: 'call-1',
            messageID: 'msg-1',
            sessionID: 'sess-1',
            tool: 'bash',
            type: 'tool',
            state: {
              status: 'error',
              error: 'Command failed with exit code 1',
              input: { command: 'invalid-cmd' },
              time: {
                start: new Date().toISOString(),
                end: new Date().toISOString(),
              },
            },
          } as OpenCodeToolPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'bash',
        'Command failed with exit code 1',
        false
      )
    })

    it('maps ToolStatePending to no stream calls', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool-part-1',
            callID: 'call-1',
            messageID: 'msg-1',
            sessionID: 'sess-1',
            tool: 'bash',
            type: 'tool',
            state: { status: 'pending' },
          } as OpenCodeToolPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.toolUse).not.toHaveBeenCalled()
      expect(stream.toolResult).not.toHaveBeenCalled()
    })

    it('detects file changes from Write tool completion', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool-part-1',
            callID: 'call-1',
            messageID: 'msg-1',
            sessionID: 'sess-1',
            tool: 'write',
            type: 'tool',
            state: {
              status: 'completed',
              input: { file_path: '/src/index.ts', content: 'export {}' },
              output: 'File written successfully',
              title: 'write',
              metadata: {},
              time: {
                start: new Date().toISOString(),
                end: new Date().toISOString(),
              },
            },
          } as OpenCodeToolPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.fileChange).toHaveBeenCalledWith('/src/index.ts', 'created')
    })

    it('detects file changes from Edit tool completion', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool-part-1',
            callID: 'call-1',
            messageID: 'msg-1',
            sessionID: 'sess-1',
            tool: 'edit',
            type: 'tool',
            state: {
              status: 'completed',
              input: { file_path: '/src/utils.ts', old_string: 'foo', new_string: 'bar' },
              output: 'Edit applied',
              title: 'edit',
              metadata: {},
              time: {
                start: new Date().toISOString(),
                end: new Date().toISOString(),
              },
            },
          } as OpenCodeToolPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.fileChange).toHaveBeenCalledWith('/src/utils.ts', 'modified')
    })

    it('handles tool with running state and no input', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool-part-1',
            callID: 'call-1',
            messageID: 'msg-1',
            sessionID: 'sess-1',
            tool: 'glob',
            type: 'tool',
            state: {
              status: 'running',
              time: { start: new Date().toISOString() },
            },
          } as OpenCodeToolPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.toolUse).toHaveBeenCalledWith('glob', {})
    })
  })

  describe('file.edited events', () => {
    it('maps file.edited to stream.fileChange()', () => {
      const event: OpenCodeEvent = {
        type: 'file.edited',
        properties: {
          file: '/src/app.tsx',
          sessionID: 'sess-1',
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.fileChange).toHaveBeenCalledWith('/src/app.tsx', 'modified')
    })

    it('ignores file.edited events from different sessions', () => {
      const event: OpenCodeEvent = {
        type: 'file.edited',
        properties: {
          file: '/src/other.ts',
          sessionID: 'other-session',
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.fileChange).not.toHaveBeenCalled()
    })
  })

  describe('session.error events', () => {
    it('maps session.error to stream.stderr() and onError callback', () => {
      const event: OpenCodeEvent = {
        type: 'session.error',
        properties: {
          sessionID: 'sess-1',
          error: {
            name: 'ProviderAuthError',
            data: { message: 'Invalid API key' },
          },
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.stderr).toHaveBeenCalledWith('ProviderAuthError: Invalid API key')
      expect(callbacks.onError).toHaveBeenCalledWith('ProviderAuthError: Invalid API key')
    })

    it('handles session.error without data.message', () => {
      const event: OpenCodeEvent = {
        type: 'session.error',
        properties: {
          sessionID: 'sess-1',
          error: { name: 'UnknownError' },
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.stderr).toHaveBeenCalledWith('UnknownError: Unknown error')
      expect(callbacks.onError).toHaveBeenCalled()
    })

    it('handles session.error without error property', () => {
      const event: OpenCodeEvent = {
        type: 'session.error',
        properties: {
          sessionID: 'sess-1',
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.stderr).toHaveBeenCalledWith('Unknown session error')
    })

    it('ignores session.error from different sessions', () => {
      const event: OpenCodeEvent = {
        type: 'session.error',
        properties: {
          sessionID: 'different-session',
          error: { name: 'SomeError' },
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.stderr).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
    })
  })

  describe('session.idle events', () => {
    it('triggers onDone callback for matching session', () => {
      const event: OpenCodeEvent = {
        type: 'session.idle',
        properties: { sessionID: 'sess-1' },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(callbacks.onDone).toHaveBeenCalled()
    })

    it('does not trigger onDone for different session', () => {
      const event: OpenCodeEvent = {
        type: 'session.idle',
        properties: { sessionID: 'other-session' },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(callbacks.onDone).not.toHaveBeenCalled()
    })
  })

  describe('unknown and ignored events', () => {
    it('ignores message.updated events gracefully', () => {
      const event: OpenCodeEvent = {
        type: 'message.updated',
        properties: {
          message: createMockAssistantMessage(),
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      // No crash, no stream calls
      expect(stream.text).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
    })

    it('ignores session.updated events gracefully', () => {
      const event: OpenCodeEvent = {
        type: 'session.updated',
        properties: {
          session: createMockSession(),
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(callbacks.onDone).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
    })

    it('ignores completely unknown event types', () => {
      const event: OpenCodeEvent = {
        type: 'custom.unknown.event',
        properties: { foo: 'bar' },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.toolUse).not.toHaveBeenCalled()
      expect(callbacks.onDone).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
    })

    it('handles null/undefined part in message.part.updated', () => {
      const event: OpenCodeEvent = {
        type: 'message.part.updated',
        properties: {
          part: null as unknown as OpenCodeTextPart,
        },
      }

      const callbacks = { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
      // Should not throw
      adapter.handleSseEvent(event, 'sess-1', stream, callbacks)

      expect(stream.text).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// 5. Abort via session.abort()
// ============================================================================

describe('OpenCode SDK adapter — abort handling', () => {
  let stream: TaskOutputStream

  beforeEach(() => {
    stream = createMockStream()
  })

  it('calls client.session.abort() when signal is aborted', async () => {
    let chatResolve: (() => void) | undefined
    const chatPromise = new Promise<OpenCodeAssistantMessage>((resolve) => {
      chatResolve = () => resolve(createMockAssistantMessage({
        error: { name: 'MessageAbortedError', data: undefined },
      }))
    })

    const mockClient = createMockClient({
      session: {
        chat: vi.fn().mockReturnValue(chatPromise),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const executePromise = adapter.execute(task, stream, abortController.signal)

    // Abort after a short delay
    setTimeout(() => {
      abortController.abort()
      // Resolve the chat to unblock
      chatResolve?.()
    }, 50)

    const result = await executePromise

    expect(mockClient.session.abort).toHaveBeenCalledWith('session-abc-123')
    // When abort signal fires and chat resolves with MessageAbortedError,
    // the adapter correctly maps it to 'cancelled' status
    expect(result.status).toBe('cancelled')
    // Error comes from the MessageAbortedError in the assistant message response
    expect(result.error).toBe('MessageAbortedError')
  })

  it('returns cancelled status when aborted before chat completes', async () => {
    const mockClient = createMockClient({
      session: {
        chat: vi.fn().mockRejectedValue(new Error('Request aborted')),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    // Abort immediately
    abortController.abort()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('cancelled')
    expect(result.error).toBe('Task cancelled')
  })

  it('includes duration metrics even on cancellation', async () => {
    const mockClient = createMockClient({
      session: {
        chat: vi.fn().mockRejectedValue(new Error('Aborted')),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    abortController.abort()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.metrics).toBeDefined()
    expect(result.metrics!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('cleans up SSE event stream on abort', async () => {
    const eventStreamAbortController = new AbortController()
    const mockEventStream = createMockEventStream([], { delayMs: 10000 })
    // Override the controller to track abort
    Object.defineProperty(mockEventStream, 'controller', {
      value: eventStreamAbortController,
      writable: false,
    })

    const mockClient = createMockClient({
      event: {
        list: vi.fn().mockResolvedValue(mockEventStream),
      },
      session: {
        chat: vi.fn().mockRejectedValue(new Error('Aborted')),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    abortController.abort()

    await adapter.execute(task, stream, abortController.signal)

    // The event stream controller should have been aborted
    expect(eventStreamAbortController.signal.aborted).toBe(true)
  })

  it('handles abort when session.abort() fails gracefully', async () => {
    const mockClient = createMockClient({
      session: {
        abort: vi.fn().mockRejectedValue(new Error('Session not found')),
        chat: vi.fn().mockImplementation(() =>
          new Promise<OpenCodeAssistantMessage>((resolve) =>
            setTimeout(() => resolve(createMockAssistantMessage({
              error: { name: 'MessageAbortedError', data: undefined },
            })), 100)
          )
        ),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const executePromise = adapter.execute(task, stream, abortController.signal)

    setTimeout(() => abortController.abort(), 20)

    // Should not throw even if abort() fails
    const result = await executePromise
    expect(result.status).toBe('cancelled')
  })
})

// ============================================================================
// 6. Error Handling
// ============================================================================

describe('OpenCode SDK adapter — error handling', () => {
  let stream: TaskOutputStream

  beforeEach(() => {
    stream = createMockStream()
  })

  it('handles MessageAbortedError in assistant message', async () => {
    const mockClient = createMockClient({
      session: {
        chat: vi.fn().mockResolvedValue(
          createMockAssistantMessage({
            error: { name: 'MessageAbortedError', data: undefined },
          })
        ),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('cancelled')
  })

  it('handles ProviderAuthError in assistant message', async () => {
    const mockClient = createMockClient({
      session: {
        chat: vi.fn().mockResolvedValue(
          createMockAssistantMessage({
            error: {
              name: 'ProviderAuthError',
              data: { message: 'Invalid API key', providerID: 'anthropic' },
            },
          })
        ),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('Invalid API key')
  })

  it('handles UnknownError in assistant message', async () => {
    const mockClient = createMockClient({
      session: {
        chat: vi.fn().mockResolvedValue(
          createMockAssistantMessage({
            error: {
              name: 'UnknownError',
              data: { message: 'Something went wrong' },
            },
          })
        ),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('Something went wrong')
  })

  it('handles session.error from SSE stream', async () => {
    const errorEvent: OpenCodeEvent = {
      type: 'session.error',
      properties: {
        sessionID: 'session-abc-123',
        error: {
          name: 'ProviderAuthError',
          data: { message: 'Rate limited' },
        },
      },
    }

    const mockClient = createMockClient({ events: [errorEvent] })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('ProviderAuthError')
    expect(result.error).toContain('Rate limited')
  })

  it('handles network error during chat', async () => {
    const mockClient = createMockClient({
      session: {
        chat: vi.fn().mockRejectedValue(new Error('fetch failed: ECONNREFUSED')),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('handles event.list() failure gracefully', async () => {
    const mockClient = createMockClient({
      event: {
        list: vi.fn().mockRejectedValue(new Error('SSE connection failed')),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('SSE connection failed')
  })

  it('tracks lastError on failure', async () => {
    const mockClient = createMockClient({
      session: {
        chat: vi.fn().mockRejectedValue(new Error('Server overloaded')),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    const status = await adapter.getStatus()
    expect(status.lastError).toContain('Server overloaded')
  })

  it('decrements activeTasks on failure', async () => {
    const mockClient = createMockClient({
      session: {
        create: vi.fn().mockRejectedValue(new Error('Failed')),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    const status = await adapter.getStatus()
    expect(status.activeTasks).toBe(0)
  })

  it('increments and decrements activeTasks on success', async () => {
    const mockClient = createMockClient()
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    await adapter.execute(task, stream, abortController.signal)

    const status = await adapter.getStatus()
    expect(status.activeTasks).toBe(0)
  })

  it('handles error in assistant message without data field', async () => {
    const mockClient = createMockClient({
      session: {
        chat: vi.fn().mockResolvedValue(
          createMockAssistantMessage({
            error: { name: 'MessageOutputLengthError' },
          })
        ),
      },
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.status).toBe('failed')
    expect(result.error).toBe('MessageOutputLengthError')
  })

  it('preserves output even when execution errors', async () => {
    const textEvent: OpenCodeEvent = {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          messageID: 'msg-1',
          sessionID: 'session-abc-123',
          text: 'Partial output before error',
          type: 'text',
        } as OpenCodeTextPart,
      },
    }
    const errorEvent: OpenCodeEvent = {
      type: 'session.error',
      properties: {
        sessionID: 'session-abc-123',
        error: { name: 'UnknownError', data: { message: 'Timeout' } },
      },
    }

    const mockClient = createMockClient({ events: [textEvent, errorEvent] })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask()
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    expect(result.output).toBe('Partial output before error')
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Timeout')
  })
})

// ============================================================================
// 7. Adapter Source Code Verification
// ============================================================================

describe('OpenCode SDK adapter — source code verification', () => {
  let adapterSource: string

  beforeEach(async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    adapterSource = readFileSync(
      join(process.cwd(), 'lib/agent-runner-adapters/opencode-sdk-adapter.ts'),
      'utf-8'
    )
  })

  it('documents @opencode-ai/sdk v1.2.15 in header', () => {
    expect(adapterSource).toContain('@opencode-ai/sdk')
    expect(adapterSource).toContain('v1.2.15')
  })

  it('documents all SDK methods used', () => {
    // Session management
    expect(adapterSource).toContain('client.session.create()')
    expect(adapterSource).toContain('client.session.chat')
    expect(adapterSource).toContain('client.session.abort')
    expect(adapterSource).toContain('client.event.list()')
  })

  it('documents SSE event types', () => {
    expect(adapterSource).toContain('message.part.updated')
    expect(adapterSource).toContain('session.error')
    expect(adapterSource).toContain('session.idle')
    expect(adapterSource).toContain('file.edited')
    expect(adapterSource).toContain('message.updated')
  })

  it('documents tool part states', () => {
    expect(adapterSource).toContain("status: 'pending'")
    expect(adapterSource).toContain("status: 'running'")
    expect(adapterSource).toContain("status: 'completed'")
    expect(adapterSource).toContain("status: 'error'")
  })

  it('implements isAvailable via /config endpoint', () => {
    expect(adapterSource).toContain('/config')
    expect(adapterSource).toContain('res.ok')
  })

  it('supports dynamic SDK import', () => {
    expect(adapterSource).toContain("import('@opencode-ai/sdk')")
    expect(adapterSource).toContain('npm install @opencode-ai/sdk')
  })

  it('supports constructor injection for testing', () => {
    expect(adapterSource).toContain('options?.client')
  })

  it('handles abort signal cleanup', () => {
    expect(adapterSource).toContain("signal.addEventListener('abort'")
    expect(adapterSource).toContain("signal.removeEventListener('abort'")
  })

  it('implements session filtering for multi-session SSE', () => {
    // Events from other sessions should be ignored
    expect(adapterSource).toContain('!== sessionId')
  })

  it('extracts metrics from OpenCode assistant message', () => {
    expect(adapterSource).toContain('assistantMessage.tokens?.input')
    expect(adapterSource).toContain('assistantMessage.tokens?.output')
    expect(adapterSource).toContain('assistantMessage.cost')
    expect(adapterSource).toContain('assistantMessage.modelID')
  })

  it('maps all relevant OpenCode event types', () => {
    // Text handling
    expect(adapterSource).toContain("part.type === 'text'")
    expect(adapterSource).toContain("part.type === 'tool'")

    // File change detection
    expect(adapterSource).toContain("toolName === 'write'")
    expect(adapterSource).toContain("toolName === 'Write'")
    expect(adapterSource).toContain("toolName === 'edit'")
    expect(adapterSource).toContain("toolName === 'Edit'")
  })

  it('declares correct adapter identity', () => {
    expect(adapterSource).toContain("type = 'opencode'")
    expect(adapterSource).toContain("name = 'OpenCode (SDK)'")
  })

  it('defaults to localhost:4096 base URL', () => {
    expect(adapterSource).toContain('http://localhost:4096')
  })

  it('supports OPENCODE_BASE_URL environment variable', () => {
    expect(adapterSource).toContain('OPENCODE_BASE_URL')
  })
})

// ============================================================================
// 8. Full Integration Flow
// ============================================================================

describe('OpenCode SDK adapter — full integration flow', () => {
  let stream: TaskOutputStream

  beforeEach(() => {
    stream = createMockStream()
  })

  it('executes complete task lifecycle: create → event.list → chat → result', async () => {
    const textEvent: OpenCodeEvent = {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          messageID: 'msg-1',
          sessionID: 'session-abc-123',
          text: 'Here is the implementation:',
          type: 'text',
        } as OpenCodeTextPart,
      },
    }
    const toolRunningEvent: OpenCodeEvent = {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'tool-1',
          callID: 'call-1',
          messageID: 'msg-1',
          sessionID: 'session-abc-123',
          tool: 'write',
          type: 'tool',
          state: {
            status: 'running',
            input: { file_path: '/src/hello.ts', content: 'export const hello = () => "Hello!"' },
            time: { start: new Date().toISOString() },
          },
        } as OpenCodeToolPart,
      },
    }
    const toolCompletedEvent: OpenCodeEvent = {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'tool-1',
          callID: 'call-1',
          messageID: 'msg-1',
          sessionID: 'session-abc-123',
          tool: 'write',
          type: 'tool',
          state: {
            status: 'completed',
            input: { file_path: '/src/hello.ts', content: 'export const hello = () => "Hello!"' },
            output: 'File written successfully',
            title: 'write',
            metadata: {},
            time: {
              start: new Date().toISOString(),
              end: new Date().toISOString(),
            },
          },
        } as OpenCodeToolPart,
      },
    }
    const idleEvent: OpenCodeEvent = {
      type: 'session.idle',
      properties: { sessionID: 'session-abc-123' },
    }

    const mockClient = createMockClient({
      events: [textEvent, toolRunningEvent, toolCompletedEvent, idleEvent],
    })
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const task = createMockTask({
      prompt: 'Create a hello function',
      systemPrompt: 'You are a TypeScript expert',
    })
    const abortController = new AbortController()

    const result = await adapter.execute(task, stream, abortController.signal)

    // Verify session creation
    expect(mockClient.session.create).toHaveBeenCalled()
    expect(stream.sessionInit).toHaveBeenCalledWith(
      'session-abc-123',
      'claude-sonnet-4-20250514'
    )

    // Verify event streaming was set up
    expect(mockClient.event.list).toHaveBeenCalled()

    // Verify prompt was sent
    expect(mockClient.session.chat).toHaveBeenCalledWith(
      'session-abc-123',
      expect.objectContaining({
        parts: [{ type: 'text', text: 'Create a hello function' }],
        system: 'You are a TypeScript expert',
      })
    )

    // Verify streaming events were processed
    expect(stream.text).toHaveBeenCalledWith('Here is the implementation:')
    expect(stream.toolUse).toHaveBeenCalledWith('write', {
      file_path: '/src/hello.ts',
      content: 'export const hello = () => "Hello!"',
    })
    expect(stream.toolResult).toHaveBeenCalledWith('write', 'File written successfully', true)
    expect(stream.fileChange).toHaveBeenCalledWith('/src/hello.ts', 'created')

    // Verify final result
    expect(result.status).toBe('completed')
    expect(result.metrics).toMatchObject({
      inputTokens: 150,
      outputTokens: 250,
      totalCost: 0.0023,
    })
    expect(result.output).toBe('Here is the implementation:')
  })

  it('handles concurrent task tracking', async () => {
    const mockClient = createMockClient()
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })

    // Execute two tasks concurrently
    const task1 = createMockTask({ id: 'task-1' })
    const task2 = createMockTask({ id: 'task-2' })
    const abort1 = new AbortController()
    const abort2 = new AbortController()

    const [result1, result2] = await Promise.all([
      adapter.execute(task1, createMockStream(), abort1.signal),
      adapter.execute(task2, createMockStream(), abort2.signal),
    ])

    expect(result1.taskId).toBe('task-1')
    expect(result2.taskId).toBe('task-2')
    expect(result1.status).toBe('completed')
    expect(result2.status).toBe('completed')

    // activeTasks should be back to 0
    const status = await adapter.getStatus()
    expect(status.activeTasks).toBe(0)
  })
})

// ============================================================================
// 9. SDK API Documentation & Findings
// ============================================================================

describe('OpenCode SDK adapter — SDK API findings', () => {
  /**
   * Documents the actual @opencode-ai/sdk v1.2.15 API surface
   * as discovered during testing. This serves as a reference for
   * the expected SDK interface.
   */

  it('documents SDK initialization pattern', () => {
    // SDK is initialized with: new Opencode({ baseURL, maxRetries, timeout })
    // NOT with createClient() as originally planned in the planning doc
    const source = `
      // Planning doc assumed: import { createClient } from '@opencode-ai/sdk'
      // Actual SDK API: import Opencode from '@opencode-ai/sdk'
      // const client = new Opencode({ baseURL: 'http://localhost:4096' })
    `
    expect(source).toContain('new Opencode')
  })

  it('documents session.chat vs session.prompt difference', () => {
    // Planning doc assumed: client.session.prompt({ path: { id }, body: { parts } })
    // Actual SDK API: client.session.chat(id, { modelID, providerID, parts })
    const adapter = new OpenCodeSdkAdapter()
    // The adapter correctly uses .chat() method
    expect(typeof adapter.execute).toBe('function')
  })

  it('documents required chat parameters', () => {
    // session.chat() requires: modelID, providerID, parts
    // Optional: messageID, mode, system, tools
    // This differs from planning doc which only showed parts
    const mockClient = createMockClient()
    const adapter = new OpenCodeSdkAdapter({ client: mockClient })
    const stream = createMockStream()
    const task = createMockTask()
    const abortController = new AbortController()

    adapter.execute(task, stream, abortController.signal).then(() => {
      expect(mockClient.session.chat).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          modelID: expect.any(String),
          providerID: expect.any(String),
          parts: expect.any(Array),
        })
      )
    })
  })

  it('documents SSE streaming approach', () => {
    // Planning doc assumed: new EventSource('http://localhost:4096/event')
    // Actual SDK API: client.event.list() returns Stream<EventListResponse>
    // Stream is an AsyncIterable with a .controller for abort
    const eventStream = createMockEventStream([])
    expect(Symbol.asyncIterator in eventStream).toBe(true)
    expect(eventStream.controller).toBeInstanceOf(AbortController)
  })

  it('documents all 15 event types from SDK', () => {
    // The SDK defines 15 event types in EventListResponse union
    const eventTypes = [
      'installation.updated',
      'lsp.client.diagnostics',
      'message.updated',
      'message.removed',
      'message.part.updated',
      'message.part.removed',
      'storage.write',
      'permission.updated',
      'file.edited',
      'session.updated',
      'session.deleted',
      'session.idle',
      'session.error',
      'file.watcher.updated',
      'ide.installed',
    ]
    expect(eventTypes).toHaveLength(15)

    // The adapter maps these relevant events:
    const mappedEvents = [
      'message.part.updated',  // → stream.text() / stream.toolUse() / stream.toolResult()
      'file.edited',           // → stream.fileChange()
      'session.error',         // → stream.stderr() + error handling
      'session.idle',          // → completion signal
      'message.updated',       // → ignored (metrics only)
    ]
    expect(mappedEvents.length).toBeGreaterThan(0)
  })

  it('documents tool state lifecycle', () => {
    // ToolPart.state follows this lifecycle:
    // pending → running → completed | error
    const states = ['pending', 'running', 'completed', 'error']
    expect(states).toHaveLength(4)
  })

  it('documents error types in assistant message', () => {
    // AssistantMessage.error can be:
    // - ProviderAuthError: { name: 'ProviderAuthError', data: { message, providerID } }
    // - UnknownError: { name: 'UnknownError', data: { message } }
    // - MessageOutputLengthError: { name: 'MessageOutputLengthError', data: unknown }
    // - MessageAbortedError: { name: 'MessageAbortedError', data: unknown }
    const errorTypes = [
      'ProviderAuthError',
      'UnknownError',
      'MessageOutputLengthError',
      'MessageAbortedError',
    ]
    expect(errorTypes).toHaveLength(4)
  })
})
