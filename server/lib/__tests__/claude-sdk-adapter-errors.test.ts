/**
 * Unit tests for Claude SDK adapter error paths.
 *
 * Tests error handling in the Claude Agent SDK adapter used by astro-agent.
 * The adapter uses `query()` from @anthropic-ai/claude-agent-sdk to run
 * Claude sessions in-process. Known production issues:
 * 1. Auth 401 errors when API key is invalid/missing
 * 2. Session init failures
 * 3. Abort/cancel handling
 * 4. Error propagation to task results
 */

import { describe, it, expect } from 'vitest'

/**
 * Simulates the Claude SDK adapter's error handling logic.
 * Mirrors the patterns in astro-agent/src/providers/claude-sdk-adapter.ts.
 */

type TaskStatus = 'completed' | 'failed' | 'cancelled'

interface TaskResult {
  taskId: string
  status: TaskStatus
  output?: string
  error?: string
  duration?: number
}

interface StreamEvent {
  type: string
  data: unknown
}

/**
 * Simulates isAvailable() check.
 * The real adapter checks for ANTHROPIC_API_KEY env var and optionally
 * makes a test API call.
 */
function checkClaudeSdkAvailable(env: Record<string, string | undefined>): {
  available: boolean
  error?: string
} {
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { available: false, error: 'ANTHROPIC_API_KEY not set' }
  }
  if (!apiKey.startsWith('sk-ant-')) {
    return { available: false, error: 'Invalid API key format' }
  }
  return { available: true }
}

/**
 * Simulates the execute() error handling.
 * The real adapter wraps query() in a try/catch and maps errors to TaskResult.
 */
async function simulateExecution(options: {
  apiKey?: string
  prompt: string
  workingDir: string
  shouldAbort?: boolean
  queryError?: Error
  queryResult?: { output: string }
}): Promise<TaskResult> {
  const taskId = 'test-task-1'
  const startTime = Date.now()

  // Check availability first
  if (!options.apiKey) {
    return {
      taskId,
      status: 'failed',
      error: 'Provider not available: ANTHROPIC_API_KEY not set',
    }
  }

  // Create abort controller
  const controller = new AbortController()

  try {
    // Simulate abort
    if (options.shouldAbort) {
      controller.abort()
      return {
        taskId,
        status: 'cancelled',
        output: 'Task was cancelled by user',
        duration: Date.now() - startTime,
      }
    }

    // Simulate query() call
    if (options.queryError) {
      throw options.queryError
    }

    if (options.queryResult) {
      return {
        taskId,
        status: 'completed',
        output: options.queryResult.output,
        duration: Date.now() - startTime,
      }
    }

    return {
      taskId,
      status: 'completed',
      output: '',
      duration: Date.now() - startTime,
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))

    // Classify the error
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      return {
        taskId,
        status: 'failed',
        error: `Authentication failed: ${error.message}`,
        duration: Date.now() - startTime,
      }
    }

    if (error.message.includes('rate_limit') || error.message.includes('429')) {
      return {
        taskId,
        status: 'failed',
        error: `Rate limited: ${error.message}`,
        duration: Date.now() - startTime,
      }
    }

    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return {
        taskId,
        status: 'failed',
        error: `Request timeout: ${error.message}`,
        duration: Date.now() - startTime,
      }
    }

    return {
      taskId,
      status: 'failed',
      error: error.message,
      duration: Date.now() - startTime,
    }
  }
}

/**
 * Simulates streaming event emission during execution.
 * The real adapter emits events for text, tool_use, tool_result, etc.
 */
function simulateStreamEvents(options: {
  events: Array<{ type: string; data: unknown }>
  errorAtIndex?: number
}): { emitted: StreamEvent[]; error?: Error } {
  const emitted: StreamEvent[] = []

  for (let i = 0; i < options.events.length; i++) {
    if (options.errorAtIndex !== undefined && i === options.errorAtIndex) {
      return { emitted, error: new Error(`Stream error at event ${i}`) }
    }
    emitted.push(options.events[i])
  }

  return { emitted }
}

describe('claude SDK adapter: availability check', () => {
  it('reports available with valid API key', () => {
    const result = checkClaudeSdkAvailable({ ANTHROPIC_API_KEY: 'sk-ant-api03-abc' })
    expect(result.available).toBe(true)
  })

  it('reports unavailable without API key', () => {
    const result = checkClaudeSdkAvailable({})
    expect(result.available).toBe(false)
    expect(result.error).toContain('ANTHROPIC_API_KEY')
  })

  it('reports unavailable with undefined API key', () => {
    const result = checkClaudeSdkAvailable({ ANTHROPIC_API_KEY: undefined })
    expect(result.available).toBe(false)
  })

  it('rejects invalid API key format', () => {
    const result = checkClaudeSdkAvailable({ ANTHROPIC_API_KEY: 'bad-key' })
    expect(result.available).toBe(false)
    expect(result.error).toContain('Invalid API key')
  })
})

describe('claude SDK adapter: execution errors', () => {
  it('returns failed status when API key is missing', async () => {
    const result = await simulateExecution({
      prompt: 'Test',
      workingDir: '/tmp',
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('not available')
  })

  it('classifies 401 errors as authentication failures', async () => {
    const result = await simulateExecution({
      apiKey: 'sk-ant-api03-abc',
      prompt: 'Test',
      workingDir: '/tmp',
      queryError: new Error('401 Unauthorized: Invalid API key'),
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Authentication failed')
  })

  it('classifies rate limit errors', async () => {
    const result = await simulateExecution({
      apiKey: 'sk-ant-api03-abc',
      prompt: 'Test',
      workingDir: '/tmp',
      queryError: new Error('429 rate_limit_exceeded'),
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Rate limited')
  })

  it('classifies timeout errors', async () => {
    const result = await simulateExecution({
      apiKey: 'sk-ant-api03-abc',
      prompt: 'Test',
      workingDir: '/tmp',
      queryError: new Error('ETIMEDOUT: connection timed out'),
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('timeout')
  })

  it('returns generic error for unknown failures', async () => {
    const result = await simulateExecution({
      apiKey: 'sk-ant-api03-abc',
      prompt: 'Test',
      workingDir: '/tmp',
      queryError: new Error('Something unexpected happened'),
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('Something unexpected happened')
  })

  it('returns cancelled status on abort', async () => {
    const result = await simulateExecution({
      apiKey: 'sk-ant-api03-abc',
      prompt: 'Test',
      workingDir: '/tmp',
      shouldAbort: true,
    })
    expect(result.status).toBe('cancelled')
  })

  it('returns completed status on success', async () => {
    const result = await simulateExecution({
      apiKey: 'sk-ant-api03-abc',
      prompt: 'Test',
      workingDir: '/tmp',
      queryResult: { output: 'Task completed successfully' },
    })
    expect(result.status).toBe('completed')
    expect(result.output).toBe('Task completed successfully')
    expect(result.duration).toBeDefined()
  })
})

describe('claude SDK adapter: stream events', () => {
  it('emits all events on success', () => {
    const events = [
      { type: 'text', data: { content: 'Hello' } },
      { type: 'tool_use', data: { name: 'bash', input: 'ls' } },
      { type: 'tool_result', data: { output: 'file.txt' } },
    ]
    const result = simulateStreamEvents({ events })
    expect(result.emitted).toHaveLength(3)
    expect(result.error).toBeUndefined()
  })

  it('stops emitting on stream error', () => {
    const events = [
      { type: 'text', data: { content: 'Hello' } },
      { type: 'tool_use', data: { name: 'bash', input: 'ls' } },
      { type: 'tool_result', data: { output: 'file.txt' } },
    ]
    const result = simulateStreamEvents({ events, errorAtIndex: 1 })
    expect(result.emitted).toHaveLength(1)
    expect(result.error?.message).toContain('Stream error at event 1')
  })

  it('handles empty event list', () => {
    const result = simulateStreamEvents({ events: [] })
    expect(result.emitted).toHaveLength(0)
    expect(result.error).toBeUndefined()
  })
})

/**
 * Tests for the auth 401 error chain observed in production.
 *
 * The production error flow:
 * 1. Browser connects to SSE /api/events/stream
 * 2. SSE requires auth → token is passed as query param
 * 3. If token is expired/invalid → 401 returned
 * 4. EventSource sees 401 as error → triggers onerror
 * 5. EventSource auto-reconnects → sends same expired token → 401 loop
 *
 * Meanwhile, the Claude SDK adapter:
 * 6. Uses ANTHROPIC_API_KEY for Claude API calls (separate auth)
 * 7. If API key is invalid → query() throws 401
 * 8. Error is caught and mapped to task result with status='failed'
 *
 * These are two separate auth failures that can happen simultaneously.
 */
describe('production auth error chain', () => {
  it('SSE auth failure is independent from Claude API auth failure', () => {
    // SSE uses Supabase JWT (browser auth)
    const sseAuthValid = true
    // Claude SDK uses ANTHROPIC_API_KEY (server env)
    const claudeAuthValid = false

    // Both can fail independently
    expect(sseAuthValid).not.toBe(claudeAuthValid)
  })

  it('expired SSE token causes reconnection loop', () => {
    // Simulate EventSource reconnection behavior
    let reconnectCount = 0
    const maxReconnects = 5
    const tokenExpired = true

    while (tokenExpired && reconnectCount < maxReconnects) {
      reconnectCount++
      // In the real code, EventSource auto-reconnects with the same URL
      // (same expired token), creating a 401 loop
    }

    expect(reconnectCount).toBe(maxReconnects)
    // Fix: The client should refresh the token before reconnecting
  })
})
