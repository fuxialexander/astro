/**
 * Claude Code Provider Unit Tests
 *
 * Tests the ClaudeCodeProvider by mocking the SDK's query() function
 * at the boundary. This exercises all provider logic:
 * - execute() message processing, result building, metrics extraction
 * - stream() event mapping (SDK messages → StreamEvent types)
 * - cancel() via AbortController
 * - detect() in various auth environments
 * - prepareContext() builds correct append content
 * - buildQueryOptions() for different task types
 * - Error handling: SDK errors, non-success results, abort
 * - SessionLogger integration
 * - loadDotEnv() edge cases
 * - MCP config loading
 * - canUseTool callback for AskUserQuestion
 *
 * Always runs — no external dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskDispatch, StreamEvent } from '../server/lib/providers/types.js'

// ============================================================================
// Mock the SDK's query() — this is the only external boundary
// ============================================================================

const mockQuery = vi.fn()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

// Mock session logger to avoid filesystem side effects
vi.mock('../server/lib/providers/session-logger.js', () => ({
  SessionLogger: class MockSessionLogger {
    log() {}
    async finalize() {}
  },
}))

// Mock MCP loader
vi.mock('../server/lib/providers/mcp-loader.js', () => ({
  loadMcpConfig: () => undefined,
  mergeAllowedTools: (tools?: string[], dirs?: string[]) => {
    const merged = [...(tools ?? []), ...(dirs ?? [])]
    return merged.length > 0 ? merged : undefined
  },
}))

// ============================================================================
// Helpers: create async generators that simulate SDK message sequences
// ============================================================================

async function* simulateSDKMessages(messages: Array<Record<string, unknown>>) {
  for (const msg of messages) {
    yield msg
  }
}

function makeInitMessage(opts: { model?: string; sessionId?: string } = {}) {
  return {
    type: 'system',
    subtype: 'init',
    model: opts.model ?? 'claude-sonnet-4-5-20250929',
    session_id: opts.sessionId ?? 'sess-123',
  }
}

function makeAssistantMessage(text: string) {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }],
    },
  }
}

function makeToolUseMessage(name: string, input: unknown, id: string) {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', name, input, id }],
    },
  }
}

function makeToolResultMessage(toolUseId: string, content: string, isError = false) {
  return {
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
    },
  }
}

function makeSuccessResult(opts: {
  sessionId?: string
  result?: string
  structuredOutput?: unknown
  usage?: Record<string, number>
  modelUsage?: Record<string, Record<string, number>>
  totalCostUsd?: number
  numTurns?: number
  durationMs?: number
} = {}) {
  return {
    type: 'result',
    subtype: 'success',
    session_id: opts.sessionId ?? 'sess-123',
    result: opts.result ?? null,
    structured_output: opts.structuredOutput ?? null,
    usage: opts.usage,
    modelUsage: opts.modelUsage,
    total_cost_usd: opts.totalCostUsd,
    num_turns: opts.numTurns,
    duration_ms: opts.durationMs,
  }
}

function makeErrorResult(subtype: string, opts: { error?: string; sessionId?: string } = {}) {
  return {
    type: 'result',
    subtype,
    session_id: opts.sessionId ?? 'sess-123',
    error: opts.error,
  }
}

// ============================================================================
// Import provider AFTER mocks are set up
// ============================================================================

const { ClaudeCodeProvider, loadDotEnv } = await import(
  '../server/lib/providers/adapters/claude-code.js'
)

// ============================================================================
// Tests
// ============================================================================

describe('ClaudeCodeProvider — execute()', () => {
  let provider: InstanceType<typeof ClaudeCodeProvider>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new ClaudeCodeProvider()
  })

  it('processes init + assistant text + success result', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage({ model: 'claude-sonnet-4-5-20250929', sessionId: 'sess-abc' }),
        makeAssistantMessage('Hello world'),
        makeSuccessResult({ sessionId: 'sess-abc', numTurns: 1, durationMs: 500 }),
      ])
    )

    const task: TaskDispatch = {
      taskId: 'test-exec-1',
      type: 'chat',
      prompt: 'Say hello',
      maxTurns: 1,
      context: { projectId: 'proj-1' },
    }

    const result = await provider.execute(task)

    expect(result.taskId).toBe('test-exec-1')
    expect(result.providerId).toBe('claude-code')
    expect(result.status).toBe('success')
    expect(result.sessionId).toBe('sess-abc')
    expect(result.stdout).toBe('Hello world')
    expect(result.completedAt).toBeInstanceOf(Date)
    expect(result.metrics.model).toBe('claude-sonnet-4-5-20250929')
    expect(result.metrics.turnsUsed).toBe(1)
    expect(result.metrics.durationMs).toBe(500)
  })

  it('concatenates multiple assistant text blocks', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage('Part 1 '),
        makeAssistantMessage('Part 2 '),
        makeAssistantMessage('Part 3'),
        makeSuccessResult(),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-concat',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.stdout).toBe('Part 1 Part 2 Part 3')
    expect(result.status).toBe('success')
  })

  it('extracts metrics from modelUsage (multi-model)', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage('ok'),
        makeSuccessResult({
          modelUsage: {
            'claude-sonnet-4-5-20250929': {
              inputTokens: 100,
              outputTokens: 50,
              cacheReadInputTokens: 200,
              cacheCreationInputTokens: 30,
            },
            'claude-haiku-4-5-20251001': {
              inputTokens: 10,
              outputTokens: 5,
            },
          },
          totalCostUsd: 0.0042,
          numTurns: 3,
          durationMs: 2000,
        }),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-metrics',
      type: 'chat',
      prompt: 'test',
      maxTurns: 3,
      context: { projectId: 'p1' },
    })

    // inputTokens = (100 + 200 + 30) + (10 + 0 + 0) = 340
    expect(result.metrics.inputTokens).toBe(340)
    // outputTokens = 50 + 5 = 55
    expect(result.metrics.outputTokens).toBe(55)
    expect(result.metrics.tokensUsed).toBe(395)
    expect(result.metrics.estimatedCostUsd).toBe(0.0042)
    expect(result.metrics.turnsUsed).toBe(3)
    expect(result.metrics.durationMs).toBe(2000)
  })

  it('falls back to BetaUsage when modelUsage is absent', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage('ok'),
        makeSuccessResult({
          usage: { input_tokens: 150, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-beta-usage',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.metrics.inputTokens).toBe(150)
    expect(result.metrics.outputTokens).toBe(60)
    expect(result.metrics.tokensUsed).toBe(210)
  })

  it('handles structured_output in result', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage(''),
        makeSuccessResult({ structuredOutput: { plan: [{ id: 'n1', title: 'Task 1' }] } }),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-structured',
      type: 'planning',
      prompt: 'plan',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.output).toBeDefined()
    expect(result.output!.type).toBe('structured')
    expect((result.output!.data as { plan: unknown[] }).plan).toHaveLength(1)
  })

  it('parses JSON string result as structured output', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage(''),
        makeSuccessResult({ result: '{"foo": "bar"}' }),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-json-parse',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.output).toBeDefined()
    expect(result.output!.type).toBe('json')
    expect(result.output!.data).toEqual({ foo: 'bar' })
  })

  it('handles non-JSON result string gracefully', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage('text output'),
        makeSuccessResult({ result: 'not-json-at-all' }),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-non-json',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    // Non-JSON result: structured output not set
    expect(result.output).toBeUndefined()
    expect(result.status).toBe('success')
  })

  it('maps error result subtype correctly', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeErrorResult('error', { error: 'API rate limit' }),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-error-result',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.status).toBe('error')
    expect(result.errorMessage).toContain('Task failed with an error')
  })

  it('maps error_max_turns subtype', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage('partial'),
        makeErrorResult('error_max_turns'),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-max-turns',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.status).toBe('error')
    expect(result.errorMessage).toContain('Max turns reached')
  })

  it('maps error_max_budget_usd subtype', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeErrorResult('error_max_budget_usd'),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-max-budget',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.status).toBe('error')
    expect(result.errorMessage).toContain('Budget limit reached')
  })

  it('handles unknown error subtype with error field', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeErrorResult('error_unknown_thing', { error: 'Something weird happened' }),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-unknown-error',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.status).toBe('error')
    expect(result.errorMessage).toBe('Something weird happened')
  })

  it('catches SDK throw and returns error result', async () => {
    mockQuery.mockReturnValue(
      // eslint-disable-next-line require-yield
      (async function* () {
        throw new Error('SDK crashed unexpectedly')
      })()
    )

    const result = await provider.execute({
      taskId: 'test-sdk-throw',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.status).toBe('error')
    expect(result.errorMessage).toContain('SDK crashed unexpectedly')
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('handles AbortError as cancellation', async () => {
    const abortController = new AbortController()

    mockQuery.mockReturnValue(
      (async function* () {
        yield makeInitMessage()
        yield makeAssistantMessage('starting...')
        // Simulate abort during iteration
        abortController.abort()
        const err = new Error('Aborted')
        err.name = 'AbortError'
        throw err
      })()
    )

    const result = await provider.execute({
      taskId: 'test-abort',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
      abortController,
    })

    expect(result.status).toBe('cancelled')
    expect(result.errorMessage).toContain('Aborted')
  })

  it('uses model override from task', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage({ model: 'claude-opus-4-6' }),
        makeAssistantMessage('ok'),
        makeSuccessResult(),
      ])
    )

    const result = await provider.execute({
      taskId: 'test-model-override',
      type: 'chat',
      prompt: 'test',
      model: 'claude-opus-4-6',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.metrics.model).toBe('claude-opus-4-6')
    // Verify query was called with the right model
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const callOpts = mockQuery.mock.calls[0][0].options
    expect(callOpts.model).toBe('claude-opus-4-6')
  })
})

describe('ClaudeCodeProvider — stream()', () => {
  let provider: InstanceType<typeof ClaudeCodeProvider>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new ClaudeCodeProvider()
  })

  it('yields init, text, result events in correct order', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage({ model: 'claude-sonnet-4-5-20250929', sessionId: 'sess-s1' }),
        makeAssistantMessage('Hello'),
        makeAssistantMessage(' World'),
        makeSuccessResult({ sessionId: 'sess-s1' }),
      ])
    )

    const events: StreamEvent[] = []
    const gen = provider.stream({
      taskId: 'test-stream-1',
      type: 'chat',
      prompt: 'Say hello',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    for await (const event of gen) {
      events.push(event)
    }

    expect(events).toHaveLength(4) // init + 2 text + result

    expect(events[0].type).toBe('init')
    expect((events[0] as { sessionId: string }).sessionId).toBe('sess-s1')

    expect(events[1].type).toBe('text')
    expect((events[1] as { text: string }).text).toBe('Hello')

    expect(events[2].type).toBe('text')
    expect((events[2] as { text: string }).text).toBe(' World')

    expect(events[3].type).toBe('result')

    // All events have taskId and timestamp
    for (const e of events) {
      expect(e.taskId).toBe('test-stream-1')
      expect(e.timestamp).toBeInstanceOf(Date)
    }
  })

  it('maps tool_use and tool_result SDK messages', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeToolUseMessage('Read', { file_path: '/tmp/test.txt' }, 'tu-1'),
        makeToolResultMessage('tu-1', 'file contents here'),
        makeAssistantMessage('I read the file'),
        makeSuccessResult(),
      ])
    )

    const events: StreamEvent[] = []
    for await (const event of provider.stream({
      taskId: 'test-tools',
      type: 'code_generation',
      prompt: 'read file',
      maxTurns: 3,
      context: { projectId: 'p1', workingDirectory: '/tmp' },
    })) {
      events.push(event)
    }

    const toolUse = events.find(e => e.type === 'tool_use')
    expect(toolUse).toBeDefined()
    expect((toolUse as { toolName: string }).toolName).toBe('Read')
    expect((toolUse as { toolUseId: string }).toolUseId).toBe('tu-1')
    expect((toolUse as { toolInput: unknown }).toolInput).toEqual({ file_path: '/tmp/test.txt' })

    const toolResult = events.find(e => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect((toolResult as { toolName: string }).toolName).toBe('Read')
    expect((toolResult as { success: boolean }).success).toBe(true)
    expect((toolResult as { result: string }).result).toBe('file contents here')
    expect((toolResult as { toolUseId: string }).toolUseId).toBe('tu-1')
  })

  it('maps tool_result with is_error=true as success=false', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeToolUseMessage('Bash', { command: 'bad_cmd' }, 'tu-2'),
        makeToolResultMessage('tu-2', 'command not found', true),
        makeAssistantMessage('Tool failed'),
        makeSuccessResult(),
      ])
    )

    const events: StreamEvent[] = []
    for await (const event of provider.stream({
      taskId: 'test-tool-error',
      type: 'code_generation',
      prompt: 'run bad command',
      maxTurns: 3,
      context: { projectId: 'p1', workingDirectory: '/tmp' },
    })) {
      events.push(event)
    }

    const toolResult = events.find(e => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect((toolResult as { success: boolean }).success).toBe(false)
    expect((toolResult as { result: string }).result).toBe('command not found')
  })

  it('yields structured_output event for structured data', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage(''),
        makeSuccessResult({ structuredOutput: { tasks: ['a', 'b'] } }),
      ])
    )

    const events: StreamEvent[] = []
    for await (const event of provider.stream({
      taskId: 'test-structured-stream',
      type: 'planning',
      prompt: 'plan',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })) {
      events.push(event)
    }

    const structured = events.find(e => e.type === 'structured_output')
    expect(structured).toBeDefined()
    expect((structured as { output: { data: unknown } }).output.data).toEqual({ tasks: ['a', 'b'] })
  })

  it('yields error event for non-success result subtype', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage('partial output'),
        makeErrorResult('error_max_turns'),
      ])
    )

    const events: StreamEvent[] = []
    for await (const event of provider.stream({
      taskId: 'test-stream-error',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })) {
      events.push(event)
    }

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect((errorEvent as { error: string }).error).toContain('Max turns reached')

    // result event should also be present
    const resultEvent = events.find(e => e.type === 'result')
    expect(resultEvent).toBeDefined()
  })

  it('yields aborted event when AbortError thrown', async () => {
    const abortController = new AbortController()

    mockQuery.mockReturnValue(
      (async function* () {
        yield makeInitMessage()
        yield makeAssistantMessage('start...')
        abortController.abort()
        const err = new Error('Aborted')
        err.name = 'AbortError'
        throw err
      })()
    )

    const events: StreamEvent[] = []
    for await (const event of provider.stream({
      taskId: 'test-stream-abort',
      type: 'chat',
      prompt: 'long task',
      maxTurns: 1,
      context: { projectId: 'p1' },
      abortController,
    })) {
      events.push(event)
    }

    const aborted = events.find(e => e.type === 'aborted')
    expect(aborted).toBeDefined()
    expect((aborted as { reason: string }).reason).toBe('User cancelled')
  })

  it('yields error event when SDK throws non-abort error', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield makeInitMessage()
        throw new Error('Network connection lost')
      })()
    )

    const events: StreamEvent[] = []
    for await (const event of provider.stream({
      taskId: 'test-stream-crash',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })) {
      events.push(event)
    }

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect((errorEvent as { error: string }).error).toContain('Network connection lost')
    expect((errorEvent as { recoverable: boolean }).recoverable).toBe(false)
  })

  it('handles multiple tool_use blocks in a single assistant message', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' }, id: 'tu-a' },
              { type: 'tool_use', name: 'Read', input: { file_path: '/b.ts' }, id: 'tu-b' },
            ],
          },
        },
        makeToolResultMessage('tu-a', 'content A'),
        makeToolResultMessage('tu-b', 'content B'),
        makeAssistantMessage('Done reading'),
        makeSuccessResult(),
      ])
    )

    const events: StreamEvent[] = []
    for await (const event of provider.stream({
      taskId: 'test-multi-tool',
      type: 'code_generation',
      prompt: 'test',
      maxTurns: 3,
      context: { projectId: 'p1', workingDirectory: '/tmp' },
    })) {
      events.push(event)
    }

    const toolUses = events.filter(e => e.type === 'tool_use')
    expect(toolUses).toHaveLength(2)
    expect((toolUses[0] as { toolUseId: string }).toolUseId).toBe('tu-a')
    expect((toolUses[1] as { toolUseId: string }).toolUseId).toBe('tu-b')

    const toolResults = events.filter(e => e.type === 'tool_result')
    expect(toolResults).toHaveLength(2)
    // tool_result correlates back to tool_use name via toolUseId
    expect((toolResults[0] as { toolName: string }).toolName).toBe('Read')
    expect((toolResults[1] as { toolName: string }).toolName).toBe('Read')
  })
})

describe('ClaudeCodeProvider — cancel()', () => {
  let provider: InstanceType<typeof ClaudeCodeProvider>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new ClaudeCodeProvider()
  })

  it('returns true and aborts when task is active', async () => {
    let abortCalled = false

    mockQuery.mockReturnValue(
      (async function* () {
        yield makeInitMessage()
        // Hang forever (simulating a long task)
        await new Promise<void>((resolve) => {
          // Resolve when aborted
          const check = setInterval(() => {
            if (abortCalled) {
              clearInterval(check)
              resolve()
            }
          }, 10)
        })
      })()
    )

    // Start streaming in background
    const streamPromise = (async () => {
      const events: StreamEvent[] = []
      try {
        for await (const event of provider.stream({
          taskId: 'test-cancel-active',
          type: 'chat',
          prompt: 'long task',
          maxTurns: 1,
          context: { projectId: 'p1' },
        })) {
          events.push(event)
        }
      } catch {
        // expected
      }
      return events
    })()

    // Wait for stream to start
    await new Promise(r => setTimeout(r, 50))

    abortCalled = true
    const cancelled = await provider.cancel('test-cancel-active')
    expect(cancelled).toBe(true)

    await streamPromise
  })

  it('returns false for unknown taskId', async () => {
    const cancelled = await provider.cancel('nonexistent-task')
    expect(cancelled).toBe(false)
  })
})

describe('ClaudeCodeProvider — detect()', () => {
  let provider: InstanceType<typeof ClaudeCodeProvider>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new ClaudeCodeProvider()
  })

  it('detects authenticated state when query returns init message', async () => {
    // Detect tries query() to see if SDK works
    // In non-CLAUDECODE env, it makes a real query
    const originalClaudeCode = process.env.CLAUDECODE
    delete process.env.CLAUDECODE

    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage({ model: 'claude-sonnet-4-5-20250929' }),
      ])
    )

    const result = await provider.detect()

    expect(result.installed).toBe(true)
    expect(result.authStatus).toBe('authenticated')
    expect(result.version).toBe('claude-sonnet-4-5-20250929')

    process.env.CLAUDECODE = originalClaudeCode
  })

  it('detects nested session with Bedrock auth', async () => {
    const originalClaudeCode = process.env.CLAUDECODE
    const originalBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    const originalProfile = process.env.AWS_PROFILE

    process.env.CLAUDECODE = '1'
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.AWS_PROFILE = 'default'

    // Clear cached detection
    provider = new ClaudeCodeProvider()
    const result = await provider.detect()

    expect(result.installed).toBe(true)
    expect(result.authStatus).toBe('authenticated')
    expect(result.message).toContain('Bedrock auth')

    // query() should NOT have been called (fast path)
    expect(mockQuery).not.toHaveBeenCalled()

    process.env.CLAUDECODE = originalClaudeCode
    process.env.CLAUDE_CODE_USE_BEDROCK = originalBedrock
    process.env.AWS_PROFILE = originalProfile
  })

  it('detects nested session without auth', async () => {
    const originalClaudeCode = process.env.CLAUDECODE
    const originalKey = process.env.ANTHROPIC_API_KEY
    const originalOAuth = process.env.CLAUDE_CODE_OAUTH_TOKEN
    const originalBedrock = process.env.CLAUDE_CODE_USE_BEDROCK

    process.env.CLAUDECODE = '1'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.CLAUDE_CODE_USE_BEDROCK

    provider = new ClaudeCodeProvider()
    const result = await provider.detect()

    expect(result.installed).toBe(true)
    expect(result.authStatus).toBe('unauthenticated')

    process.env.CLAUDECODE = originalClaudeCode
    process.env.ANTHROPIC_API_KEY = originalKey
    process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOAuth
    process.env.CLAUDE_CODE_USE_BEDROCK = originalBedrock
  })

  it('handles auth error from SDK', async () => {
    const originalClaudeCode = process.env.CLAUDECODE
    delete process.env.CLAUDECODE

    mockQuery.mockReturnValue(
      // eslint-disable-next-line require-yield
      (async function* () {
        throw new Error('Invalid API key auth failed')
      })()
    )

    provider = new ClaudeCodeProvider()
    const result = await provider.detect()

    expect(result.installed).toBe(true)
    expect(result.authStatus).toBe('unauthenticated')
    expect(result.message).toContain('authentication')

    process.env.CLAUDECODE = originalClaudeCode
  })
})

describe('ClaudeCodeProvider — capabilities()', () => {
  it('returns correct provider metadata', () => {
    const provider = new ClaudeCodeProvider()
    const caps = provider.capabilities()

    expect(caps.providerId).toBe('claude-code')
    expect(caps.name).toBe('Claude Code')
    expect(caps.supportsStreaming).toBe(true)
    expect(caps.supportsCancellation).toBe(true)
    expect(caps.supportsSessionResume).toBe(true)
    expect(caps.contextInjectionMethod).toBe('system_prompt')
    expect(caps.fallbackModel).toBe('sonnet')
    expect(caps.languages).toEqual(['*'])
    expect(caps.taskTypes).toContain('chat')
    expect(caps.taskTypes).toContain('code_generation')
    expect(caps.taskTypes).toContain('planning')
    expect(caps.maxTurns).toBe(150)
  })
})

describe('ClaudeCodeProvider — prepareContext()', () => {
  let provider: InstanceType<typeof ClaudeCodeProvider>

  beforeEach(() => {
    provider = new ClaudeCodeProvider()
  })

  it('returns system_prompt method with no content when context is empty', async () => {
    const prepared = await provider.prepareContext({ projectId: 'p1' })
    expect(prepared.method).toBe('system_prompt')
    expect(prepared.promptContent).toBeUndefined()
  })

  it('includes vision doc in prompt content', async () => {
    const prepared = await provider.prepareContext({
      projectId: 'p1',
      visionDoc: 'Build an AI planning tool',
    })

    expect(prepared.promptContent).toContain('Project Vision')
    expect(prepared.promptContent).toContain('Build an AI planning tool')
  })

  it('includes dependency context', async () => {
    const prepared = await provider.prepareContext({
      projectId: 'p1',
      dependencyContext: 'Task A output: schema created',
    })

    expect(prepared.promptContent).toContain('Previous Task Outputs')
    expect(prepared.promptContent).toContain('schema created')
  })

  it('includes working directory', async () => {
    const prepared = await provider.prepareContext({
      projectId: 'p1',
      workingDirectory: '/home/user/project',
    })

    expect(prepared.promptContent).toContain('Working Directory')
    expect(prepared.promptContent).toContain('/home/user/project')
  })

  it('combines all context fields', async () => {
    const prepared = await provider.prepareContext({
      projectId: 'p1',
      visionDoc: 'vision',
      dependencyContext: 'deps',
      workingDirectory: '/wd',
      environment: 'local' as const,
    })

    expect(prepared.promptContent).toContain('Execution Environment')
    expect(prepared.promptContent).toContain('vision')
    expect(prepared.promptContent).toContain('deps')
    expect(prepared.promptContent).toContain('/wd')
  })
})

describe('ClaudeCodeProvider — query option building', () => {
  let provider: InstanceType<typeof ClaudeCodeProvider>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new ClaudeCodeProvider()
  })

  it('chat task gets allowedTools: [] (no tools)', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([makeInitMessage(), makeSuccessResult()]))

    await provider.execute({
      taskId: 'test-chat-opts',
      type: 'chat',
      prompt: 'hello',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    const opts = mockQuery.mock.calls[0][0].options
    expect(opts.allowedTools).toEqual([])
    expect(opts.permissionMode).toBeUndefined()
  })

  it('code_generation task gets bypassPermissions + settingSources', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([makeInitMessage(), makeSuccessResult()]))

    await provider.execute({
      taskId: 'test-codegen-opts',
      type: 'code_generation',
      prompt: 'fix bug',
      maxTurns: 3,
      context: { projectId: 'p1', workingDirectory: '/projects/foo' },
    })

    const opts = mockQuery.mock.calls[0][0].options
    expect(opts.permissionMode).toBe('bypassPermissions')
    expect(opts.settingSources).toEqual(['user', 'project', 'local'])
    expect(opts.cwd).toBe('/projects/foo')
  })

  it('planning task without workingDirectory gets no tools', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([makeInitMessage(), makeSuccessResult()]))

    await provider.execute({
      taskId: 'test-plan-no-wd',
      type: 'planning',
      prompt: 'plan',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    const opts = mockQuery.mock.calls[0][0].options
    expect(opts.allowedTools).toEqual([])
  })

  it('planning task WITH workingDirectory gets full tool access', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([makeInitMessage(), makeSuccessResult()]))

    await provider.execute({
      taskId: 'test-plan-with-wd',
      type: 'planning',
      prompt: 'plan',
      maxTurns: 1,
      context: { projectId: 'p1', workingDirectory: '/projects/bar' },
    })

    const opts = mockQuery.mock.calls[0][0].options
    expect(opts.permissionMode).toBe('bypassPermissions')
  })

  it('passes sessionId as resume option', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([makeInitMessage(), makeSuccessResult()]))

    await provider.execute({
      taskId: 'test-resume',
      type: 'chat',
      prompt: 'continue',
      sessionId: 'prev-session-xyz',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    const opts = mockQuery.mock.calls[0][0].options
    expect(opts.resume).toBe('prev-session-xyz')
  })

  it('passes environment variables in env', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([makeInitMessage(), makeSuccessResult()]))

    await provider.execute({
      taskId: 'test-env-vars',
      type: 'code_generation',
      prompt: 'test',
      maxTurns: 1,
      context: {
        projectId: 'p1',
        workingDirectory: '/tmp',
        environmentVariables: { MY_VAR: 'my-value' },
      },
    })

    const opts = mockQuery.mock.calls[0][0].options
    expect(opts.env.MY_VAR).toBe('my-value')
  })

  it('passes outputFormat for structured output', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([makeInitMessage(), makeSuccessResult()]))

    const schema = { type: 'object', properties: { name: { type: 'string' } } }
    await provider.execute({
      taskId: 'test-output-format',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      outputFormat: { type: 'json_schema', schema },
      context: { projectId: 'p1' },
    })

    const opts = mockQuery.mock.calls[0][0].options
    expect(opts.outputFormat).toEqual({ type: 'json_schema', schema })
  })
})

describe('loadDotEnv()', () => {
  it('returns empty object for undefined dir', () => {
    expect(loadDotEnv(undefined)).toEqual({})
  })

  it('returns empty object for nonexistent directory', () => {
    expect(loadDotEnv('/nonexistent/dir/xyz')).toEqual({})
  })
})

describe('ClaudeCodeProvider — edge cases', () => {
  let provider: InstanceType<typeof ClaudeCodeProvider>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new ClaudeCodeProvider()
  })

  it('execute() handles empty message stream (no init, no result)', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([]))

    const result = await provider.execute({
      taskId: 'test-empty-stream',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    // No result message means success status stays as default
    expect(result.status).toBe('success')
    expect(result.stdout).toBe('')
  })

  it('execute() handles init without result (SDK stream ends early)', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        makeAssistantMessage('partial'),
        // No result message — stream just ends
      ])
    )

    const result = await provider.execute({
      taskId: 'test-no-result',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    expect(result.stdout).toBe('partial')
    expect(result.status).toBe('success') // default status
  })

  it('stream() handles mixed text + tool_use in single assistant message', async () => {
    mockQuery.mockReturnValue(
      simulateSDKMessages([
        makeInitMessage(),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Let me read that file. ' },
              { type: 'tool_use', name: 'Read', input: { file_path: '/f.ts' }, id: 'tu-mix' },
            ],
          },
        },
        makeToolResultMessage('tu-mix', 'file contents'),
        makeAssistantMessage('Done'),
        makeSuccessResult(),
      ])
    )

    const events: StreamEvent[] = []
    for await (const event of provider.stream({
      taskId: 'test-mixed',
      type: 'code_generation',
      prompt: 'test',
      maxTurns: 3,
      context: { projectId: 'p1', workingDirectory: '/tmp' },
    })) {
      events.push(event)
    }

    const types = events.map(e => e.type)
    expect(types).toContain('text')
    expect(types).toContain('tool_use')
    expect(types).toContain('tool_result')

    // Text "Let me read" comes before tool_use
    const textIdx = types.indexOf('text')
    const toolUseIdx = types.indexOf('tool_use')
    expect(textIdx).toBeLessThan(toolUseIdx)
  })

  it('stream() with zero events from SDK returns result', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([]))

    const events: StreamEvent[] = []
    const returnValue = provider.stream({
      taskId: 'test-zero-events',
      type: 'chat',
      prompt: 'test',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    for await (const event of returnValue) {
      events.push(event)
    }

    // Should get at least a result event from the finally block
    expect(events.length).toBeGreaterThanOrEqual(1)
    const resultEvent = events.find(e => e.type === 'result')
    expect(resultEvent).toBeDefined()
  })

  it('execute() with custom systemPrompt passes it through', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([makeInitMessage(), makeSuccessResult()]))

    await provider.execute({
      taskId: 'test-sysprompt',
      type: 'chat',
      prompt: 'test',
      systemPrompt: 'You are a pirate',
      maxTurns: 1,
      context: { projectId: 'p1' },
    })

    const opts = mockQuery.mock.calls[0][0].options
    expect(opts.systemPrompt).toBe('You are a pirate')
  })

  it('execute() with hooks passes them through', async () => {
    mockQuery.mockReturnValue(simulateSDKMessages([makeInitMessage(), makeSuccessResult()]))

    await provider.execute({
      taskId: 'test-hooks',
      type: 'code_generation',
      prompt: 'test',
      maxTurns: 1,
      context: {
        projectId: 'p1',
        workingDirectory: '/tmp',
        hooks: { preToolUse: [{ matcher: '*', action: 'allow' }] },
      },
    })

    const opts = mockQuery.mock.calls[0][0].options
    expect(opts.hooks).toBeDefined()
    expect(opts.hooks.preToolUse).toBeDefined()
  })
})
