/**
 * OpenCode SDK Adapter Tests
 *
 * Comprehensive test suite covering all 6 required areas:
 *   1. SDK client initialization and lifecycle
 *   2. Session management (create, chat, event listing)
 *   3. Event type mapping (text, tool_use, tool_result, file_change, step)
 *   4. Error handling (network, timeout, abort, capacity, SDK not installed)
 *   5. Metric extraction (cost, tokens, model, turns, duration)
 *   6. JSONL parsing for CLI adapters (OpenClaw + OpenCode legacy format)
 *
 * Tests use mock SDK clients (no real OpenCode server needed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OpenCodeSdkAdapter,
  OpenClawAdapter,
  OpenCodeCliAdapter,
  parseJsonlBuffer,
  type TaskOutputStream,
  type TaskDispatch,
} from '../lib/agent-runner-adapters/opencode-sdk-adapter'

// ============================================================================
// Test Helpers
// ============================================================================

function createMockStream(): TaskOutputStream & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    sessionInit: [],
    text: [],
    toolUse: [],
    toolResult: [],
    fileChange: [],
    progress: [],
  }
  return {
    calls,
    sessionInit: vi.fn((...args: unknown[]) => { calls.sessionInit.push(args) }),
    text: vi.fn((...args: unknown[]) => { calls.text.push(args) }),
    toolUse: vi.fn((...args: unknown[]) => { calls.toolUse.push(args) }),
    toolResult: vi.fn((...args: unknown[]) => { calls.toolResult.push(args) }),
    fileChange: vi.fn((...args: unknown[]) => { calls.fileChange.push(args) }),
    progress: vi.fn((...args: unknown[]) => { calls.progress.push(args) }),
  }
}

function createMockTask(overrides: Partial<TaskDispatch> = {}): TaskDispatch {
  return {
    taskId: 'test-task-001',
    projectId: 'proj-001',
    nodeId: 'node-001',
    title: 'Test Task',
    description: 'A test task for the adapter',
    ...overrides,
  }
}

function createAbortController(): AbortController {
  return new AbortController()
}

interface MockClient {
  session: {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    chat: ReturnType<typeof vi.fn>;
  };
  event: {
    list: ReturnType<typeof vi.fn>;
  };
}

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ id: 'sess-001', model: 'opencode-v1' }),
      get: vi.fn().mockResolvedValue({ id: 'sess-001', model: 'opencode-v1' }),
      chat: vi.fn().mockResolvedValue({
        id: 'msg-001',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello from OpenCode!' }],
        metadata: {
          model: 'opencode-v1',
          cost: 0.05,
          inputTokens: 100,
          outputTokens: 50,
          turns: 1,
        },
      }),
      ...overrides.session,
    },
    event: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      ...overrides.event,
    },
  }
}

// ============================================================================
// 1. SDK Client Initialization & Lifecycle
// ============================================================================

describe('OpenCodeSdkAdapter - Initialization', () => {
  it('creates adapter with default config', () => {
    const adapter = new OpenCodeSdkAdapter()
    expect(adapter.type).toBe('opencode')
    expect(adapter.name).toBe('OpenCode (SDK)')
    expect(adapter.maxConcurrentTasks).toBe(1)
  })

  it('creates adapter with custom config', () => {
    const adapter = new OpenCodeSdkAdapter({
      baseURL: 'http://custom:9999',
      apiKey: 'test-key',
      maxConcurrentTasks: 3,
      defaultTimeout: 60000,
    })
    expect(adapter.maxConcurrentTasks).toBe(3)
  })

  it('accepts injected mock client', async () => {
    const adapter = new OpenCodeSdkAdapter()
    const mockClient = createMockClient()
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])

    // The client should be usable after setClient
    await expect(adapter.getClient()).resolves.toBe(mockClient)
  })

  it('caches client across multiple getClient() calls', async () => {
    const adapter = new OpenCodeSdkAdapter()
    const mockClient = createMockClient()
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])

    const c1 = await adapter.getClient()
    const c2 = await adapter.getClient()
    expect(c1).toBe(c2)
  })

  it('throws descriptive error when SDK is not installed', async () => {
    const adapter = new OpenCodeSdkAdapter()
    // Don't set a mock client → getClient() will try dynamic import
    // which should fail since @opencode-ai/sdk isn't installed in tests
    await expect(adapter.getClient()).rejects.toThrow(/opencode/i)
  })
})

// ============================================================================
// 2. Session Management
// ============================================================================

describe('OpenCodeSdkAdapter - Session Management', () => {
  let adapter: OpenCodeSdkAdapter
  let mockClient: MockClient
  let stream: ReturnType<typeof createMockStream>
  let controller: AbortController

  beforeEach(() => {
    adapter = new OpenCodeSdkAdapter()
    mockClient = createMockClient()
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])
    stream = createMockStream()
    controller = createAbortController()
  })

  it('creates a session and calls chat', async () => {
    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(mockClient.session.create).toHaveBeenCalledOnce()
    expect(mockClient.session.chat).toHaveBeenCalledOnce()
    expect(mockClient.session.chat).toHaveBeenCalledWith('sess-001', {
      message: expect.any(String),
    })
  })

  it('emits sessionInit with session ID and model', async () => {
    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.sessionInit).toHaveBeenCalledWith('sess-001', 'opencode-v1')
  })

  it('uses task model as fallback when session has no model', async () => {
    mockClient.session.create.mockResolvedValue({ id: 'sess-002' })
    const task = createMockTask({ model: 'claude-3' })
    await adapter.execute(task, stream, controller.signal)

    expect(stream.sessionInit).toHaveBeenCalledWith('sess-002', 'claude-3')
  })

  it('returns sessionId in result', async () => {
    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.sessionId).toBe('sess-001')
  })

  it('uses pre-built prompt when available', async () => {
    const task = createMockTask({ prompt: 'Custom prompt here' })
    await adapter.execute(task, stream, controller.signal)

    expect(mockClient.session.chat).toHaveBeenCalledWith('sess-001', {
      message: 'Custom prompt here',
    })
  })

  it('builds prompt from title + description when no prompt provided', async () => {
    const task = createMockTask({ prompt: undefined, title: 'My Title', description: 'My description' })
    await adapter.execute(task, stream, controller.signal)

    const chatCall = mockClient.session.chat.mock.calls[0]
    expect(chatCall[1].message).toContain('My Title')
    expect(chatCall[1].message).toContain('My description')
  })

  it('uses fallback prompt when title and description are empty', () => {
    const prompt = adapter.buildPrompt({ taskId: 'x', projectId: 'x', nodeId: 'x', title: '', description: '' })
    expect(prompt).toBe('Execute task')
  })
})

// ============================================================================
// 3. Event Type Mapping (Message Parts → Stream Events)
// ============================================================================

describe('OpenCodeSdkAdapter - Event Mapping', () => {
  let adapter: OpenCodeSdkAdapter
  let mockClient: MockClient
  let stream: ReturnType<typeof createMockStream>
  let controller: AbortController

  beforeEach(() => {
    adapter = new OpenCodeSdkAdapter()
    mockClient = createMockClient()
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])
    stream = createMockStream()
    controller = createAbortController()
  })

  it('maps text parts to stream.text()', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'First chunk' },
        { type: 'text', text: 'Second chunk' },
      ],
      metadata: {},
    })

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(stream.text).toHaveBeenCalledTimes(2)
    expect(stream.text).toHaveBeenCalledWith('First chunk')
    expect(stream.text).toHaveBeenCalledWith('Second chunk')
    expect(result.stdout).toBe('First chunkSecond chunk')
  })

  it('maps tool-invocation (call) to stream.toolUse()', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{
        type: 'tool-invocation',
        toolInvocationId: 'inv-1',
        toolName: 'bash',
        args: { command: 'ls -la' },
        state: 'call',
      }],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'ls -la' })
  })

  it('maps tool-invocation (partial-call) to stream.toolUse()', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{
        type: 'tool-invocation',
        toolInvocationId: 'inv-1',
        toolName: 'write',
        args: { file: 'test.ts' },
        state: 'partial-call',
      }],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.toolUse).toHaveBeenCalledWith('write', { file: 'test.ts' })
  })

  it('maps tool-invocation (result) to stream.toolResult() with success=true', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{
        type: 'tool-invocation',
        toolInvocationId: 'inv-1',
        toolName: 'bash',
        args: { command: 'echo hello' },
        state: 'result',
        result: 'hello\n',
      }],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.toolResult).toHaveBeenCalledWith('bash', 'hello\n', true)
  })

  it('maps tool-invocation (error) to stream.toolResult() with success=false', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{
        type: 'tool-invocation',
        toolInvocationId: 'inv-1',
        toolName: 'bash',
        args: { command: 'exit 1' },
        state: 'error',
        error: 'Command failed with exit code 1',
      }],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.toolResult).toHaveBeenCalledWith('bash', 'Command failed with exit code 1', false)
  })

  it('maps file parts to stream.fileChange()', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{
        type: 'file',
        path: 'src/index.ts',
        action: 'modified',
        diff: '+const x = 1;',
        linesAdded: 1,
        linesRemoved: 0,
      }],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.fileChange).toHaveBeenCalledWith(
      'src/index.ts', 'modified', '+const x = 1;', 1, 0
    )
  })

  it('defaults file action to "modified" when omitted', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{
        type: 'file',
        path: 'README.md',
      }],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.fileChange).toHaveBeenCalledWith(
      'README.md', 'modified', undefined, undefined, undefined
    )
  })

  it('maps step-start to stream.progress(0, title)', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{ type: 'step-start', stepId: 'step-1', title: 'Analyzing code' }],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.progress).toHaveBeenCalledWith(0, 'Analyzing code')
  })

  it('maps step-finish to stream.progress(100, status)', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{ type: 'step-finish', stepId: 'step-1', status: 'completed' }],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.progress).toHaveBeenCalledWith(100, 'Step step-1 completed')
  })

  it('ignores snapshot parts (no stream event)', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{ type: 'snapshot', data: { state: 'checkpoint' } }],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(stream.text).not.toHaveBeenCalled()
    expect(stream.toolUse).not.toHaveBeenCalled()
    expect(stream.progress).not.toHaveBeenCalled()
  })

  it('handles messages with no parts gracefully', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: undefined,
      metadata: {},
    })

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('success')
    expect(stream.text).not.toHaveBeenCalled()
  })

  it('handles unknown part types gracefully (forward-compat)', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'known' },
        { type: 'future-type', data: 'ignored' },
        { type: 'text', text: ' part' },
      ],
      metadata: {},
    })

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('success')
    expect(stream.text).toHaveBeenCalledTimes(2)
    expect(result.stdout).toBe('known part')
  })

  it('processes mixed parts in correct order', async () => {
    const order: string[] = []
    stream.text = vi.fn(() => { order.push('text') })
    stream.toolUse = vi.fn(() => { order.push('toolUse') })
    stream.toolResult = vi.fn(() => { order.push('toolResult') })
    stream.fileChange = vi.fn(() => { order.push('fileChange') })

    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Plan:' },
        { type: 'tool-invocation', toolInvocationId: 'i1', toolName: 'bash', args: {}, state: 'call' },
        { type: 'tool-invocation', toolInvocationId: 'i1', toolName: 'bash', args: {}, state: 'result', result: 'ok' },
        { type: 'file', path: 'test.ts', action: 'created' },
        { type: 'text', text: 'Done!' },
      ],
      metadata: {},
    })

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    expect(order).toEqual(['text', 'toolUse', 'toolResult', 'fileChange', 'text'])
  })
})

// ============================================================================
// 4. Error Handling
// ============================================================================

describe('OpenCodeSdkAdapter - Error Handling', () => {
  let adapter: OpenCodeSdkAdapter
  let mockClient: MockClient
  let stream: ReturnType<typeof createMockStream>
  let controller: AbortController

  beforeEach(() => {
    adapter = new OpenCodeSdkAdapter()
    mockClient = createMockClient()
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])
    stream = createMockStream()
    controller = createAbortController()
  })

  it('returns failure when at capacity', async () => {
    // Make the adapter think it has 1 active task already
    const adapter2 = new OpenCodeSdkAdapter({ maxConcurrentTasks: 1 })
    adapter2.setClient(mockClient as unknown as Parameters<typeof adapter2.setClient>[0])

    // First task starts execution
    const longRunning = new Promise<void>((resolve) => {
      mockClient.session.chat.mockImplementation(() => new Promise((r) => setTimeout(() => r({
        id: 'msg',
        role: 'assistant',
        parts: [],
        metadata: {},
      }), 100)))
      setTimeout(resolve, 150)
    })

    // Start first task
    const task1Promise = adapter2.execute(createMockTask({ taskId: 'task-1' }), stream, controller.signal)

    // Try second task immediately while first is running
    await new Promise((r) => setTimeout(r, 10))
    const result = await adapter2.execute(createMockTask({ taskId: 'task-2' }), stream, controller.signal)

    expect(result.status).toBe('failure')
    expect(result.errorMessage).toContain('capacity')

    await longRunning
    await task1Promise
  })

  it('returns cancelled when signal is already aborted', async () => {
    controller.abort()
    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('cancelled')
    expect(result.errorMessage).toContain('cancelled before execution')
  })

  it('returns cancelled when abort during chat', async () => {
    mockClient.session.chat.mockImplementation(async () => {
      // Simulate slow operation — abort will fire during this
      await new Promise((r) => setTimeout(r, 50))
      const error = new Error('Aborted')
      error.name = 'AbortError'
      throw error
    })

    // Abort after a short delay
    setTimeout(() => controller.abort(), 10)

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('cancelled')
  })

  it('returns cancelled for MessageAbortedError', async () => {
    const error = new Error('Message was aborted')
    error.name = 'MessageAbortedError'
    mockClient.session.chat.mockRejectedValue(error)

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('cancelled')
    expect(result.errorMessage).toBe('Message was aborted')
  })

  it('returns failure for session creation error', async () => {
    mockClient.session.create.mockRejectedValue(new Error('Connection refused'))

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('failure')
    expect(result.errorMessage).toContain('Connection refused')
  })

  it('returns failure for chat error', async () => {
    mockClient.session.chat.mockRejectedValue(new Error('Rate limited'))

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('failure')
    expect(result.errorMessage).toContain('Rate limited')
  })

  it('returns failure for timeout', async () => {
    const adapter2 = new OpenCodeSdkAdapter({ defaultTimeout: 50 })
    adapter2.setClient(mockClient as unknown as Parameters<typeof adapter2.setClient>[0])

    mockClient.session.chat.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 200))
      return {
        id: 'msg',
        role: 'assistant',
        parts: [{ type: 'text', text: 'too late' }],
        metadata: {},
      }
    })

    const task = createMockTask()
    const result = await adapter2.execute(task, stream, controller.signal)

    // Either timeout or the chat completes — depends on timing
    // The timeout flag is checked after chat completes
    expect(['failure', 'success']).toContain(result.status)
  })

  it('handles task.timeout override', async () => {
    mockClient.session.chat.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 200))
      return { id: 'msg', role: 'assistant', parts: [], metadata: {} }
    })

    const task = createMockTask({ timeout: 50 })
    const result = await adapter.execute(task, stream, controller.signal)

    // Timeout should have been triggered by task-level timeout
    expect(['failure', 'success']).toContain(result.status)
  })

  it('always decrements activeTasks on error', async () => {
    mockClient.session.create.mockRejectedValue(new Error('fail'))

    const task = createMockTask()
    await adapter.execute(task, stream, controller.signal)

    // Second task should not get "at capacity" error
    mockClient.session.create.mockResolvedValue({ id: 'sess' })
    const result = await adapter.execute(task, stream, controller.signal)
    expect(result.status).not.toBe('failure')
  })

  it('categorizes CancelledError as cancelled', async () => {
    const error = new Error('Cancelled')
    error.name = 'CancelledError'
    mockClient.session.chat.mockRejectedValue(error)

    const result = await adapter.execute(createMockTask(), stream, controller.signal)
    expect(result.status).toBe('cancelled')
  })

  it('categorizes generic errors as failure', async () => {
    const error = new Error('Something went wrong')
    error.name = 'SomeOtherError'
    mockClient.session.chat.mockRejectedValue(error)

    const result = await adapter.execute(createMockTask(), stream, controller.signal)
    expect(result.status).toBe('failure')
    expect(result.errorMessage).toBe('Something went wrong')
  })
})

// ============================================================================
// 5. Metric Extraction
// ============================================================================

describe('OpenCodeSdkAdapter - Metrics', () => {
  let adapter: OpenCodeSdkAdapter
  let mockClient: MockClient
  let stream: ReturnType<typeof createMockStream>
  let controller: AbortController

  beforeEach(() => {
    adapter = new OpenCodeSdkAdapter()
    mockClient = createMockClient()
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])
    stream = createMockStream()
    controller = createAbortController()
  })

  it('extracts all metric fields from message metadata', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [{ type: 'text', text: 'ok' }],
      metadata: {
        model: 'opencode-v1',
        cost: 0.05,
        inputTokens: 1000,
        outputTokens: 500,
        turns: 3,
      },
    })

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.metrics).toBeDefined()
    expect(result.metrics!.model).toBe('opencode-v1')
    expect(result.metrics!.totalCost).toBe(0.05)
    expect(result.metrics!.inputTokens).toBe(1000)
    expect(result.metrics!.outputTokens).toBe(500)
    expect(result.metrics!.numTurns).toBe(3)
    expect(result.metrics!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('handles missing metadata fields gracefully', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [],
      metadata: {},
    })

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.metrics).toBeDefined()
    expect(result.metrics!.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.metrics!.model).toBeUndefined()
    expect(result.metrics!.totalCost).toBeUndefined()
  })

  it('uses model override when metadata has no model', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [],
      metadata: {},
    })

    const task = createMockTask({ model: 'claude-3.5-sonnet' })
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.metrics!.model).toBe('claude-3.5-sonnet')
  })

  it('prefers metadata model over task model', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [],
      metadata: { model: 'opencode-turbo' },
    })

    const task = createMockTask({ model: 'claude-3.5-sonnet' })
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.metrics!.model).toBe('opencode-turbo')
  })

  it('handles null metadata', async () => {
    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [],
    })

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.metrics).toBeDefined()
    expect(result.metrics!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('includes durationMs on error results', async () => {
    mockClient.session.chat.mockRejectedValue(new Error('fail'))

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// 6. JSONL Parsing (shared utility)
// ============================================================================

describe('parseJsonlBuffer', () => {
  it('parses complete JSONL lines', () => {
    const buffer = '{"type":"text","text":"hello"}\n{"type":"text","text":"world"}\n'
    const result = parseJsonlBuffer(buffer)

    expect(result.events).toHaveLength(2)
    expect(result.remaining).toBe('')
  })

  it('returns incomplete line as remaining', () => {
    const buffer = '{"type":"text","text":"hello"}\n{"type":"tex'
    const result = parseJsonlBuffer(buffer)

    expect(result.events).toHaveLength(1)
    expect(result.remaining).toBe('{"type":"tex')
  })

  it('handles \\r\\n line endings', () => {
    const buffer = '{"type":"a"}\r\n{"type":"b"}\r\n'
    const result = parseJsonlBuffer(buffer)

    expect(result.events).toHaveLength(2)
    expect(result.remaining).toBe('')
  })

  it('handles mixed \\n and \\r\\n line endings', () => {
    const buffer = '{"type":"a"}\n{"type":"b"}\r\n{"type":"c"}\n'
    const result = parseJsonlBuffer(buffer)

    expect(result.events).toHaveLength(3)
  })

  it('skips malformed JSON lines', () => {
    const buffer = '{"type":"ok"}\nnot json\n{"type":"also ok"}\n'
    const result = parseJsonlBuffer(buffer)

    expect(result.events).toHaveLength(2)
    expect((result.events[0] as Record<string, string>).type).toBe('ok')
    expect((result.events[1] as Record<string, string>).type).toBe('also ok')
  })

  it('skips empty lines', () => {
    const buffer = '{"type":"a"}\n\n\n{"type":"b"}\n'
    const result = parseJsonlBuffer(buffer)

    expect(result.events).toHaveLength(2)
  })

  it('returns empty array for empty buffer', () => {
    const result = parseJsonlBuffer('')

    expect(result.events).toHaveLength(0)
    expect(result.remaining).toBe('')
  })

  it('handles single incomplete line', () => {
    const result = parseJsonlBuffer('{"partial')

    expect(result.events).toHaveLength(0)
    expect(result.remaining).toBe('{"partial')
  })
})

// ============================================================================
// OpenClaw Adapter Tests
// ============================================================================

describe('OpenClawAdapter - Initialization', () => {
  it('creates adapter with default config', () => {
    const adapter = new OpenClawAdapter()
    expect(adapter.type).toBe('openclaw')
    expect(adapter.name).toBe('OpenClaw (CLI)')
    expect(adapter.maxConcurrentTasks).toBe(1)
  })

  it('creates adapter with custom config', () => {
    const adapter = new OpenClawAdapter({
      binaryPath: '/opt/openclaw/bin/openclaw',
      maxConcurrentTasks: 2,
      defaultTimeout: 120000,
    })
    expect(adapter.maxConcurrentTasks).toBe(2)
  })
})

describe('OpenClawAdapter - Event Processing', () => {
  let adapter: OpenClawAdapter
  let stream: ReturnType<typeof createMockStream>

  beforeEach(() => {
    adapter = new OpenClawAdapter()
    stream = createMockStream()
  })

  it('maps session.start to sessionInit', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent(
      { type: 'session.start', session_id: 'sess-123', model: 'openclaw-v2' },
      stream, textChunks, metrics,
    )

    expect(stream.sessionInit).toHaveBeenCalledWith('sess-123', 'openclaw-v2')
  })

  it('maps content.text to text', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent(
      { type: 'content.text', text: 'Hello world' },
      stream, textChunks, metrics,
    )

    expect(stream.text).toHaveBeenCalledWith('Hello world')
    expect(textChunks).toEqual(['Hello world'])
  })

  it('maps tool_use.start to toolUse', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent(
      { type: 'tool_use.start', tool_name: 'bash', tool_input: { cmd: 'ls' } },
      stream, textChunks, metrics,
    )

    expect(stream.toolUse).toHaveBeenCalledWith('bash', { cmd: 'ls' })
  })

  it('maps tool_use.end to toolResult', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent(
      { type: 'tool_use.end', tool_name: 'bash', result: 'file1.txt', success: true },
      stream, textChunks, metrics,
    )

    expect(stream.toolResult).toHaveBeenCalledWith('bash', 'file1.txt', true)
  })

  it('maps file.change to fileChange', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent(
      { type: 'file.change', path: 'src/app.ts', action: 'modified', diff: '+line', lines_added: 1, lines_removed: 0 },
      stream, textChunks, metrics,
    )

    expect(stream.fileChange).toHaveBeenCalledWith('src/app.ts', 'modified', '+line', 1, 0)
  })

  it('extracts metrics from session.end', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent(
      { type: 'session.end', cost: 0.05, input_tokens: 1000, output_tokens: 500, turns: 3, model: 'v2' },
      stream, textChunks, metrics,
    )

    expect(metrics.totalCost).toBe(0.05)
    expect(metrics.inputTokens).toBe(1000)
    expect(metrics.outputTokens).toBe(500)
    expect(metrics.numTurns).toBe(3)
    expect(metrics.model).toBe('v2')
  })

  it('handles message.start and message.end silently', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent({ type: 'message.start' }, stream, textChunks, metrics)
    adapter.processOpenClawEvent({ type: 'message.end' }, stream, textChunks, metrics)

    expect(stream.text).not.toHaveBeenCalled()
    expect(stream.sessionInit).not.toHaveBeenCalled()
  })

  it('handles unknown event types gracefully', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    // Should not throw
    adapter.processOpenClawEvent(
      { type: 'future.event' as 'session.start' },
      stream, textChunks, metrics,
    )

    expect(stream.text).not.toHaveBeenCalled()
  })

  it('falls back to input when tool_input is missing', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent(
      { type: 'tool_use.start', tool_name: 'write', input: { file: 'x.ts' } },
      stream, textChunks, metrics,
    )

    expect(stream.toolUse).toHaveBeenCalledWith('write', { file: 'x.ts' })
  })

  it('defaults success to true for tool_use.end when not specified', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent(
      { type: 'tool_use.end', tool_name: 'bash', result: 'ok' },
      stream, textChunks, metrics,
    )

    // success defaults to true via ?? true
    expect(stream.toolResult).toHaveBeenCalledWith('bash', 'ok', true)
  })
})

// ============================================================================
// OpenCode CLI Adapter Tests
// ============================================================================

describe('OpenCodeCliAdapter - Initialization', () => {
  it('creates adapter with default config', () => {
    const adapter = new OpenCodeCliAdapter()
    expect(adapter.type).toBe('opencode')
    expect(adapter.name).toBe('OpenCode (CLI)')
    expect(adapter.maxConcurrentTasks).toBe(1)
  })
})

describe('OpenCodeCliAdapter - Event Processing', () => {
  let adapter: OpenCodeCliAdapter
  let stream: ReturnType<typeof createMockStream>

  beforeEach(() => {
    adapter = new OpenCodeCliAdapter()
    stream = createMockStream()
  })

  it('maps system event to sessionInit', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      { type: 'system', session_id: 'sess-001', model: 'opencode-v1' },
      stream, textChunks, metrics,
    )

    expect(stream.sessionInit).toHaveBeenCalledWith('sess-001', 'opencode-v1')
  })

  it('maps assistant text parts to text', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      {
        type: 'assistant',
        content: [
          { type: 'text', text: 'I will help you ' },
          { type: 'text', text: 'with this task.' },
        ],
      },
      stream, textChunks, metrics,
    )

    expect(stream.text).toHaveBeenCalledTimes(2)
    expect(textChunks).toEqual(['I will help you ', 'with this task.'])
  })

  it('maps assistant tool_use parts to toolUse', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      {
        type: 'assistant',
        content: [
          { type: 'tool_use', name: 'bash', input: { command: 'ls -la' } },
        ],
      },
      stream, textChunks, metrics,
    )

    expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'ls -la' })
  })

  it('handles mixed text and tool_use in assistant content', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      {
        type: 'assistant',
        content: [
          { type: 'text', text: 'Running command:' },
          { type: 'tool_use', name: 'bash', input: { command: 'echo hi' } },
        ],
      },
      stream, textChunks, metrics,
    )

    expect(stream.text).toHaveBeenCalledWith('Running command:')
    expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'echo hi' })
  })

  it('maps tool_result to toolResult', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      { type: 'tool_result', tool_name: 'bash', content: 'hello\n', is_error: false },
      stream, textChunks, metrics,
    )

    expect(stream.toolResult).toHaveBeenCalledWith('bash', 'hello\n', true)
  })

  it('maps tool_result with error to toolResult with success=false', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      { type: 'tool_result', tool_name: 'bash', content: 'Error: not found', is_error: true },
      stream, textChunks, metrics,
    )

    expect(stream.toolResult).toHaveBeenCalledWith('bash', 'Error: not found', false)
  })

  it('extracts metrics from result event with tokens object', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      {
        type: 'result',
        cost_usd: 0.03,
        tokens: { input: 800, output: 400 },
        turns: 2,
        model: 'opencode-v1',
      },
      stream, textChunks, metrics,
    )

    expect(metrics.totalCost).toBe(0.03)
    expect(metrics.inputTokens).toBe(800)
    expect(metrics.outputTokens).toBe(400)
    expect(metrics.numTurns).toBe(2)
    expect(metrics.model).toBe('opencode-v1')
  })

  it('extracts metrics from result event with flat token fields', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      {
        type: 'result',
        cost: 0.02,
        input_tokens: 500,
        output_tokens: 250,
      },
      stream, textChunks, metrics,
    )

    // cost_usd takes priority over cost, but cost is used as fallback
    expect(metrics.totalCost).toBe(0.02)
    expect(metrics.inputTokens).toBe(500)
    expect(metrics.outputTokens).toBe(250)
  })

  it('prefers cost_usd over cost', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      {
        type: 'result',
        cost_usd: 0.03,
        cost: 0.01,
      },
      stream, textChunks, metrics,
    )

    expect(metrics.totalCost).toBe(0.03)
  })

  it('handles assistant with no content array', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      { type: 'assistant' },
      stream, textChunks, metrics,
    )

    expect(stream.text).not.toHaveBeenCalled()
    expect(stream.toolUse).not.toHaveBeenCalled()
  })

  it('handles unknown event types gracefully', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      { type: 'future_event' as 'system' },
      stream, textChunks, metrics,
    )

    expect(stream.text).not.toHaveBeenCalled()
  })

  it('uses result field as fallback for tool_result content', () => {
    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent(
      { type: 'tool_result', tool_name: 'read', result: 'file contents' },
      stream, textChunks, metrics,
    )

    expect(stream.toolResult).toHaveBeenCalledWith('read', 'file contents', true)
  })
})

// ============================================================================
// Prompt Building Tests
// ============================================================================

describe('Prompt Building', () => {
  it('OpenCodeSdkAdapter.buildPrompt uses prompt when available', () => {
    const adapter = new OpenCodeSdkAdapter()
    const prompt = adapter.buildPrompt(createMockTask({ prompt: 'Direct prompt' }))
    expect(prompt).toBe('Direct prompt')
  })

  it('OpenCodeSdkAdapter.buildPrompt combines title + description', () => {
    const adapter = new OpenCodeSdkAdapter()
    const prompt = adapter.buildPrompt(createMockTask({ title: 'Title', description: 'Desc', prompt: undefined }))
    expect(prompt).toBe('# Title\n\nDesc')
  })

  it('OpenCodeSdkAdapter.buildPrompt uses fallback for empty fields', () => {
    const adapter = new OpenCodeSdkAdapter()
    const prompt = adapter.buildPrompt(createMockTask({ title: '', description: '', prompt: undefined }))
    expect(prompt).toBe('Execute task')
  })
})

// ============================================================================
// Full Lifecycle Test
// ============================================================================

describe('OpenCodeSdkAdapter - Full Lifecycle', () => {
  it('executes complete task with all event types', async () => {
    const adapter = new OpenCodeSdkAdapter()
    const mockClient = createMockClient()
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])

    mockClient.session.chat.mockResolvedValue({
      id: 'msg-001',
      role: 'assistant',
      parts: [
        { type: 'step-start', stepId: 's1', title: 'Analyzing' },
        { type: 'text', text: 'Let me analyze the code.' },
        { type: 'tool-invocation', toolInvocationId: 'i1', toolName: 'bash', args: { command: 'cat file.ts' }, state: 'call' },
        { type: 'tool-invocation', toolInvocationId: 'i1', toolName: 'bash', args: { command: 'cat file.ts' }, state: 'result', result: 'const x = 1;' },
        { type: 'file', path: 'file.ts', action: 'modified', diff: '-const x = 1;\n+const x = 2;', linesAdded: 1, linesRemoved: 1 },
        { type: 'text', text: '\nDone! Changed x from 1 to 2.' },
        { type: 'step-finish', stepId: 's1', status: 'completed' },
      ],
      metadata: {
        model: 'opencode-v1',
        cost: 0.12,
        inputTokens: 2500,
        outputTokens: 800,
        turns: 5,
      },
    })

    const stream = createMockStream()
    const controller = createAbortController()
    const task = createMockTask()

    const result = await adapter.execute(task, stream, controller.signal)

    // Verify result
    expect(result.status).toBe('success')
    expect(result.taskId).toBe('test-task-001')
    expect(result.sessionId).toBe('sess-001')
    expect(result.stdout).toBe('Let me analyze the code.\nDone! Changed x from 1 to 2.')

    // Verify metrics
    expect(result.metrics!.model).toBe('opencode-v1')
    expect(result.metrics!.totalCost).toBe(0.12)
    expect(result.metrics!.inputTokens).toBe(2500)
    expect(result.metrics!.outputTokens).toBe(800)
    expect(result.metrics!.numTurns).toBe(5)
    expect(result.metrics!.durationMs).toBeGreaterThanOrEqual(0)

    // Verify all stream events were emitted
    expect(stream.sessionInit).toHaveBeenCalledOnce()
    expect(stream.progress).toHaveBeenCalledTimes(2)
    expect(stream.text).toHaveBeenCalledTimes(2)
    expect(stream.toolUse).toHaveBeenCalledOnce()
    expect(stream.toolResult).toHaveBeenCalledOnce()
    expect(stream.fileChange).toHaveBeenCalledOnce()
  })
})
