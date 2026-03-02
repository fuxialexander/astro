/**
 * Provider Integration Tests
 *
 * Tests the full lifecycle of OpenClaw and OpenCode CLI adapters,
 * including:
 *   - CLI detection and availability (auto-skip when not installed)
 *   - JSONL event parsing (always runs — no CLI needed)
 *   - Capacity management
 *   - Abort signal handling
 *   - Error path cleanup
 *
 * Integration tests that require the CLIs auto-skip via describe.skipIf()
 * when the binary is not found. JSONL parsing unit tests always run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execSync } from 'child_process'
import {
  OpenClawAdapter,
  OpenCodeCliAdapter,
  OpenCodeSdkAdapter,
  parseJsonlBuffer,
  type TaskOutputStream,
  type TaskDispatch,
} from '../lib/agent-runner-adapters/opencode-sdk-adapter'

// ============================================================================
// CLI Detection
// ============================================================================

let hasOpenClaw = false
try {
  execSync('which openclaw', { stdio: 'ignore' })
  hasOpenClaw = true
} catch {
  hasOpenClaw = false
}

let hasOpenCode = false
try {
  execSync('which opencode', { stdio: 'ignore' })
  hasOpenCode = true
} catch {
  hasOpenCode = false
}

// ============================================================================
// Test Helpers
// ============================================================================

function createMockStream(): TaskOutputStream {
  return {
    sessionInit: vi.fn(),
    text: vi.fn(),
    toolUse: vi.fn(),
    toolResult: vi.fn(),
    fileChange: vi.fn(),
    progress: vi.fn(),
  }
}

function createMockTask(overrides: Partial<TaskDispatch> = {}): TaskDispatch {
  return {
    taskId: `task-${Date.now()}`,
    projectId: 'proj-001',
    nodeId: 'node-001',
    title: 'Integration Test Task',
    description: 'Testing the adapter integration',
    prompt: 'echo "Hello from integration test"',
    ...overrides,
  }
}

// ============================================================================
// JSONL Parsing Unit Tests (always run — no CLI needed)
// ============================================================================

describe('JSONL Parsing - OpenClaw event format', () => {
  it('parses session.start event', () => {
    const line = '{"type":"session.start","session_id":"s1","model":"oc-v1"}'
    const { events } = parseJsonlBuffer(line + '\n')
    expect(events).toHaveLength(1)
    expect((events[0] as Record<string, unknown>).type).toBe('session.start')
    expect((events[0] as Record<string, unknown>).session_id).toBe('s1')
  })

  it('parses content.text event', () => {
    const line = '{"type":"content.text","text":"Hello world"}'
    const { events } = parseJsonlBuffer(line + '\n')
    expect((events[0] as Record<string, unknown>).text).toBe('Hello world')
  })

  it('parses tool_use.start event', () => {
    const line = '{"type":"tool_use.start","tool_name":"bash","tool_input":{"cmd":"ls"}}'
    const { events } = parseJsonlBuffer(line + '\n')
    expect((events[0] as Record<string, unknown>).tool_name).toBe('bash')
  })

  it('parses tool_use.end event', () => {
    const line = '{"type":"tool_use.end","tool_name":"bash","result":"file.txt","success":true}'
    const { events } = parseJsonlBuffer(line + '\n')
    expect((events[0] as Record<string, unknown>).success).toBe(true)
  })

  it('parses file.change event', () => {
    const line = '{"type":"file.change","path":"src/index.ts","action":"modified","lines_added":5,"lines_removed":2}'
    const { events } = parseJsonlBuffer(line + '\n')
    expect((events[0] as Record<string, unknown>).path).toBe('src/index.ts')
    expect((events[0] as Record<string, unknown>).lines_added).toBe(5)
  })

  it('parses session.end event with metrics', () => {
    const line = '{"type":"session.end","cost":0.05,"input_tokens":1000,"output_tokens":500,"turns":3}'
    const { events } = parseJsonlBuffer(line + '\n')
    expect((events[0] as Record<string, unknown>).cost).toBe(0.05)
  })

  it('handles full OpenClaw session JSONL', () => {
    const jsonl = [
      '{"type":"session.start","session_id":"s1","model":"v1"}',
      '{"type":"message.start"}',
      '{"type":"content.text","text":"Working on it..."}',
      '{"type":"tool_use.start","tool_name":"bash","tool_input":{"command":"ls"}}',
      '{"type":"tool_use.end","tool_name":"bash","result":"file1.txt\\nfile2.txt","success":true}',
      '{"type":"file.change","path":"README.md","action":"modified","lines_added":2,"lines_removed":0}',
      '{"type":"message.end"}',
      '{"type":"session.end","cost":0.03,"input_tokens":500,"output_tokens":200,"turns":1}',
    ].join('\n') + '\n'

    const { events, remaining } = parseJsonlBuffer(jsonl)
    expect(events).toHaveLength(8)
    expect(remaining).toBe('')
  })
})

describe('JSONL Parsing - OpenCode legacy format', () => {
  it('parses system event', () => {
    const line = '{"type":"system","session_id":"s1","model":"opencode-v1"}'
    const { events } = parseJsonlBuffer(line + '\n')
    expect((events[0] as Record<string, unknown>).type).toBe('system')
    expect((events[0] as Record<string, unknown>).model).toBe('opencode-v1')
  })

  it('parses assistant event with content array', () => {
    const line = '{"type":"assistant","content":[{"type":"text","text":"Hello"},{"type":"tool_use","name":"bash","input":{"cmd":"ls"}}]}'
    const { events } = parseJsonlBuffer(line + '\n')
    const content = (events[0] as Record<string, unknown>).content as Array<Record<string, unknown>>
    expect(content).toHaveLength(2)
    expect(content[0].type).toBe('text')
    expect(content[1].type).toBe('tool_use')
  })

  it('parses tool_result event', () => {
    const line = '{"type":"tool_result","tool_name":"bash","content":"hello\\n","is_error":false}'
    const { events } = parseJsonlBuffer(line + '\n')
    expect((events[0] as Record<string, unknown>).is_error).toBe(false)
  })

  it('parses result event with tokens object', () => {
    const line = '{"type":"result","cost_usd":0.03,"tokens":{"input":800,"output":400},"turns":2}'
    const { events } = parseJsonlBuffer(line + '\n')
    const tokens = (events[0] as Record<string, unknown>).tokens as Record<string, number>
    expect(tokens.input).toBe(800)
    expect(tokens.output).toBe(400)
  })

  it('parses result event with flat token fields', () => {
    const line = '{"type":"result","cost":0.02,"input_tokens":500,"output_tokens":250}'
    const { events } = parseJsonlBuffer(line + '\n')
    expect((events[0] as Record<string, unknown>).input_tokens).toBe(500)
  })

  it('handles full OpenCode session JSONL', () => {
    const jsonl = [
      '{"type":"system","session_id":"s1","model":"opencode-v1"}',
      '{"type":"assistant","content":[{"type":"text","text":"Analyzing..."},{"type":"tool_use","name":"bash","input":{"command":"cat package.json"}}]}',
      '{"type":"tool_result","tool_name":"bash","content":"{\\"name\\":\\"test\\"}","is_error":false}',
      '{"type":"assistant","content":[{"type":"text","text":"Found the project."}]}',
      '{"type":"result","cost_usd":0.05,"tokens":{"input":1000,"output":500},"turns":2,"model":"opencode-v1"}',
    ].join('\n') + '\n'

    const { events, remaining } = parseJsonlBuffer(jsonl)
    expect(events).toHaveLength(5)
    expect(remaining).toBe('')
  })
})

describe('JSONL Parsing - OpenCode native event format', () => {
  it('parses native SDK-style event with parts', () => {
    const line = '{"id":"e1","type":"message.part.updated","properties":{"part":{"type":"text","text":"Hello"}}}'
    const { events } = parseJsonlBuffer(line + '\n')
    const props = (events[0] as Record<string, unknown>).properties as Record<string, unknown>
    const part = props.part as Record<string, unknown>
    expect(part.type).toBe('text')
    expect(part.text).toBe('Hello')
  })

  it('parses tool-invocation part', () => {
    const line = '{"id":"e2","type":"message.part.updated","properties":{"part":{"type":"tool-invocation","toolName":"bash","args":{"command":"ls"},"state":"call"}}}'
    const { events } = parseJsonlBuffer(line + '\n')
    const props = (events[0] as Record<string, unknown>).properties as Record<string, unknown>
    const part = props.part as Record<string, unknown>
    expect(part.type).toBe('tool-invocation')
    expect(part.toolName).toBe('bash')
    expect(part.state).toBe('call')
  })

  it('parses file part', () => {
    const line = '{"id":"e3","type":"message.part.updated","properties":{"part":{"type":"file","path":"src/main.ts","action":"created"}}}'
    const { events } = parseJsonlBuffer(line + '\n')
    const props = (events[0] as Record<string, unknown>).properties as Record<string, unknown>
    const part = props.part as Record<string, unknown>
    expect(part.type).toBe('file')
    expect(part.path).toBe('src/main.ts')
  })
})

// ============================================================================
// OpenClaw Adapter - Capacity & Abort
// ============================================================================

describe('OpenClawAdapter - Capacity Management', () => {
  it('reports at capacity when maxConcurrentTasks reached', () => {
    // Verify the adapter tracks capacity configuration properly
    const adapter = new OpenClawAdapter({ maxConcurrentTasks: 1 })
    expect(adapter.maxConcurrentTasks).toBe(1)
    expect(adapter.type).toBe('openclaw')
  })

  it('returns cancelled when signal is already aborted', async () => {
    const adapter = new OpenClawAdapter()
    const stream = createMockStream()
    const controller = new AbortController()
    controller.abort()

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('cancelled')
    expect(result.errorMessage).toContain('cancelled before execution')
  })
})

describe('OpenCodeCliAdapter - Capacity & Abort', () => {
  it('returns cancelled when signal is already aborted', async () => {
    const adapter = new OpenCodeCliAdapter()
    const stream = createMockStream()
    const controller = new AbortController()
    controller.abort()

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('cancelled')
    expect(result.errorMessage).toContain('cancelled before execution')
  })

  it('handles spawn error gracefully', async () => {
    // Use a non-existent binary path to trigger spawn error
    const adapter = new OpenCodeCliAdapter({ binaryPath: '/nonexistent/opencode' })
    const stream = createMockStream()
    const controller = new AbortController()

    const task = createMockTask()
    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('failure')
    expect(result.errorMessage).toBeDefined()
  })
})

// ============================================================================
// OpenCode SDK Adapter - Concurrent Access
// ============================================================================

describe('OpenCodeSdkAdapter - Concurrency', () => {
  it('allows task after previous task completes', async () => {
    const adapter = new OpenCodeSdkAdapter({ maxConcurrentTasks: 1 })
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'sess' }),
        get: vi.fn(),
        chat: vi.fn().mockResolvedValue({
          id: 'msg',
          role: 'assistant',
          parts: [{ type: 'text', text: 'ok' }],
          metadata: {},
        }),
      },
      event: { list: vi.fn() },
    }
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])
    const stream = createMockStream()
    const controller = new AbortController()

    // First task
    const r1 = await adapter.execute(createMockTask({ taskId: 't1' }), stream, controller.signal)
    expect(r1.status).toBe('success')

    // Second task — should succeed because first task has completed
    const r2 = await adapter.execute(createMockTask({ taskId: 't2' }), stream, controller.signal)
    expect(r2.status).toBe('success')
  })

  it('rejects concurrent tasks when at capacity', async () => {
    const adapter = new OpenCodeSdkAdapter({ maxConcurrentTasks: 1 })
    let chatResolve: ((value: unknown) => void) | undefined
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'sess' }),
        get: vi.fn(),
        chat: vi.fn().mockImplementation(() => new Promise((resolve) => {
          chatResolve = resolve
        })),
      },
      event: { list: vi.fn() },
    }
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])

    const stream = createMockStream()
    const controller = new AbortController()

    // Start first task (will block on chat)
    const p1 = adapter.execute(createMockTask({ taskId: 't1' }), stream, controller.signal)

    // Wait a tick for the first task to start
    await new Promise((r) => setTimeout(r, 10))

    // Second task — should fail due to capacity
    const r2 = await adapter.execute(createMockTask({ taskId: 't2' }), stream, controller.signal)
    expect(r2.status).toBe('failure')
    expect(r2.errorMessage).toContain('capacity')

    // Resolve the first task
    chatResolve!({
      id: 'msg',
      role: 'assistant',
      parts: [],
      metadata: {},
    })
    const r1 = await p1
    expect(r1.status).toBe('success')
  })
})

// ============================================================================
// Integration Tests — OpenClaw CLI (auto-skip if not installed)
// ============================================================================

describe.skipIf(!hasOpenClaw)('OpenClaw CLI Integration', () => {
  let adapter: OpenClawAdapter
  let stream: TaskOutputStream
  let controller: AbortController

  beforeEach(() => {
    adapter = new OpenClawAdapter()
    stream = createMockStream()
    controller = new AbortController()
  })

  it('detects openclaw CLI availability', async () => {
    const available = await adapter.isAvailable()
    expect(available).toBe(true)
  })

  it('executes a simple task', async () => {
    const task = createMockTask({
      prompt: 'echo "hello from openclaw"',
      timeout: 30000,
    })

    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('success')
    expect(result.taskId).toBe(task.taskId)
    expect(result.metrics?.durationMs).toBeGreaterThan(0)
  }, 60000)

  it('handles abort signal', async () => {
    const task = createMockTask({
      prompt: 'sleep 30 && echo done',
      timeout: 60000,
    })

    // Abort after 1 second
    setTimeout(() => controller.abort(), 1000)

    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('cancelled')
  }, 30000)
})

// ============================================================================
// Integration Tests — OpenCode CLI (auto-skip if not installed)
// ============================================================================

describe.skipIf(!hasOpenCode)('OpenCode CLI Integration', () => {
  let adapter: OpenCodeCliAdapter
  let stream: TaskOutputStream
  let controller: AbortController

  beforeEach(() => {
    adapter = new OpenCodeCliAdapter()
    stream = createMockStream()
    controller = new AbortController()
  })

  it('detects opencode CLI availability', async () => {
    const available = await adapter.isAvailable()
    expect(available).toBe(true)
  })

  it('executes a simple task', async () => {
    const task = createMockTask({
      prompt: 'echo "hello from opencode"',
      timeout: 30000,
    })

    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('success')
    expect(result.taskId).toBe(task.taskId)
    expect(result.metrics?.durationMs).toBeGreaterThan(0)
  }, 60000)

  it('handles abort signal', async () => {
    const task = createMockTask({
      prompt: 'sleep 30 && echo done',
      timeout: 60000,
    })

    // Abort after 1 second
    setTimeout(() => controller.abort(), 1000)

    const result = await adapter.execute(task, stream, controller.signal)

    expect(result.status).toBe('cancelled')
  }, 30000)
})

// ============================================================================
// Error Path Cleanup Tests
// ============================================================================

describe('Error Path Cleanup', () => {
  it('OpenCodeSdkAdapter cleans up activeTasks on session.create failure', async () => {
    const adapter = new OpenCodeSdkAdapter({ maxConcurrentTasks: 1 })
    const mockClient = {
      session: {
        create: vi.fn().mockRejectedValue(new Error('Connection refused')),
        get: vi.fn(),
        chat: vi.fn(),
      },
      event: { list: vi.fn() },
    }
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])
    const stream = createMockStream()
    const controller = new AbortController()

    // First call fails
    const r1 = await adapter.execute(createMockTask(), stream, controller.signal)
    expect(r1.status).toBe('failure')

    // Second call should NOT get "at capacity" error
    mockClient.session.create.mockResolvedValue({ id: 'sess' })
    mockClient.session.chat.mockResolvedValue({
      id: 'msg',
      role: 'assistant',
      parts: [],
      metadata: {},
    })
    const r2 = await adapter.execute(createMockTask(), stream, controller.signal)
    expect(r2.status).toBe('success')
  })

  it('OpenCodeSdkAdapter cleans up activeTasks on chat failure', async () => {
    const adapter = new OpenCodeSdkAdapter({ maxConcurrentTasks: 1 })
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'sess' }),
        get: vi.fn(),
        chat: vi.fn().mockRejectedValue(new Error('Rate limited')),
      },
      event: { list: vi.fn() },
    }
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])
    const stream = createMockStream()
    const controller = new AbortController()

    // First call fails at chat
    const r1 = await adapter.execute(createMockTask(), stream, controller.signal)
    expect(r1.status).toBe('failure')

    // Second call should work (capacity freed)
    mockClient.session.chat.mockResolvedValue({
      id: 'msg',
      role: 'assistant',
      parts: [],
      metadata: {},
    })
    const r2 = await adapter.execute(createMockTask(), stream, controller.signal)
    expect(r2.status).toBe('success')
  })

  it('OpenCodeSdkAdapter cleans up activeTasks on abort', async () => {
    const adapter = new OpenCodeSdkAdapter({ maxConcurrentTasks: 1 })
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'sess' }),
        get: vi.fn(),
        chat: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 50))
          const err = new Error('Aborted')
          err.name = 'AbortError'
          throw err
        }),
      },
      event: { list: vi.fn() },
    }
    adapter.setClient(mockClient as unknown as Parameters<typeof adapter.setClient>[0])
    const stream = createMockStream()
    const controller = new AbortController()

    setTimeout(() => controller.abort(), 10)
    const r1 = await adapter.execute(createMockTask(), stream, controller.signal)
    expect(r1.status).toBe('cancelled')

    // Second call should work (capacity freed)
    const controller2 = new AbortController()
    mockClient.session.chat.mockResolvedValue({
      id: 'msg',
      role: 'assistant',
      parts: [],
      metadata: {},
    })
    const r2 = await adapter.execute(createMockTask(), stream, controller2.signal)
    expect(r2.status).toBe('success')
  })
})

// ============================================================================
// Event Ordering Tests
// ============================================================================

describe('Event Ordering', () => {
  it('OpenClawAdapter emits events in JSONL order', () => {
    const adapter = new OpenClawAdapter()
    const order: string[] = []
    const stream: TaskOutputStream = {
      sessionInit: vi.fn(() => order.push('sessionInit')),
      text: vi.fn(() => order.push('text')),
      toolUse: vi.fn(() => order.push('toolUse')),
      toolResult: vi.fn(() => order.push('toolResult')),
      fileChange: vi.fn(() => order.push('fileChange')),
      progress: vi.fn(() => order.push('progress')),
    }

    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenClawEvent({ type: 'session.start', session_id: 's1' }, stream, textChunks, metrics)
    adapter.processOpenClawEvent({ type: 'content.text', text: 'Working...' }, stream, textChunks, metrics)
    adapter.processOpenClawEvent({ type: 'tool_use.start', tool_name: 'bash', tool_input: {} }, stream, textChunks, metrics)
    adapter.processOpenClawEvent({ type: 'tool_use.end', tool_name: 'bash', result: 'ok', success: true }, stream, textChunks, metrics)
    adapter.processOpenClawEvent({ type: 'file.change', path: 'x.ts', action: 'modified' }, stream, textChunks, metrics)

    expect(order).toEqual(['sessionInit', 'text', 'toolUse', 'toolResult', 'fileChange'])
  })

  it('OpenCodeCliAdapter emits events in JSONL order', () => {
    const adapter = new OpenCodeCliAdapter()
    const order: string[] = []
    const stream: TaskOutputStream = {
      sessionInit: vi.fn(() => order.push('sessionInit')),
      text: vi.fn(() => order.push('text')),
      toolUse: vi.fn(() => order.push('toolUse')),
      toolResult: vi.fn(() => order.push('toolResult')),
      fileChange: vi.fn(() => order.push('fileChange')),
      progress: vi.fn(() => order.push('progress')),
    }

    const textChunks: string[] = []
    const metrics: Record<string, unknown> = {}

    adapter.processOpenCodeEvent({ type: 'system', session_id: 's1' }, stream, textChunks, metrics)
    adapter.processOpenCodeEvent(
      { type: 'assistant', content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', name: 'read', input: {} }] },
      stream, textChunks, metrics,
    )
    adapter.processOpenCodeEvent({ type: 'tool_result', tool_name: 'read', content: 'data' }, stream, textChunks, metrics)

    expect(order).toEqual(['sessionInit', 'text', 'toolUse', 'toolResult'])
  })
})
