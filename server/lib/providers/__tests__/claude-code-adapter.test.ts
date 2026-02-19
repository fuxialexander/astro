/**
 * Claude Code Adapter Bug Fix Tests
 *
 * Tests that:
 * 1. toolUseId is propagated from block.id on tool_use events
 * 2. toolName on tool_result uses the actual tool name (via map lookup)
 *    instead of the tool_use_id correlation ID
 * 3. The toolUseIdToName map correctly correlates multiple tools
 *
 * These tests work at the unit level by directly validating the adapter's
 * stream() output against known SDK message sequences. We mock the
 * @anthropic-ai/claude-agent-sdk query() function.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the SDK — must be before importing the adapter
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(),
  }
})

// Mock the helper modules used by the adapter
vi.mock('../../error-utils.js', () => ({
  errorMessage: (e: Error) => e.message,
}))
vi.mock('../mcp-loader.js', () => ({
  loadMcpConfig: vi.fn().mockReturnValue(undefined),
  mergeAllowedTools: vi.fn().mockReturnValue(undefined),
}))
vi.mock('../../repo-context.js', () => ({
  readRepoContext: vi.fn().mockReturnValue(undefined),
}))
vi.mock('../cache-utils.js', () => ({
  buildCachedSystemPrompt: vi.fn().mockReturnValue([]),
  calculateCacheStats: vi.fn().mockReturnValue({ totalInputTokens: 0, cacheHitRate: 0, estimatedSavings: 0 }),
  extractSourceRepoPath: vi.fn().mockImplementation((dir: string) => Promise.resolve(dir)),
}))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeCodeProvider } from '../../providers/adapters/claude-code.js'
import type { TaskDispatch } from '../../providers/types.js'

const mockedQuery = vi.mocked(query)

// Helper: create a minimal TaskDispatch
function makeTask(overrides?: Partial<TaskDispatch>): TaskDispatch {
  return {
    taskId: 'test-task-1',
    prompt: 'test prompt',
    type: 'general',
    context: {
      projectId: 'proj-1',
    },
    ...overrides,
  }
}

// Helper: create an async generator from an array of messages
async function* asyncGen<T>(items: T[]): AsyncGenerator<T, void, undefined> {
  for (const item of items) {
    yield item
  }
}

describe('ClaudeCodeProvider adapter bug fixes', () => {
  let provider: ClaudeCodeProvider

  beforeEach(() => {
    provider = new ClaudeCodeProvider()
    vi.clearAllMocks()
  })

  it('should propagate toolUseId from block.id on tool_use events', async () => {
    // Simulate SDK messages: init → assistant with tool_use → result
    const messages = [
      {
        type: 'system' as const,
        subtype: 'init' as const,
        model: 'claude-sonnet-4-5-20250929',
        sessionId: 'sess-1',
      },
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use' as const,
              id: 'toolu_01XyZ123abc',  // This is the LLM-assigned ID
              name: 'Read',
              input: { path: '/src/main.ts' },
            },
          ],
        },
      },
      {
        type: 'result' as const,
        subtype: 'success' as const,
        sessionId: 'sess-1',
        result: 'done',
      },
    ]

    mockedQuery.mockReturnValue(asyncGen(messages) as any)

    const events = []
    const task = makeTask()
    for await (const event of provider.stream(task)) {
      events.push(event)
    }

    // Find the tool_use event
    const toolUseEvent = events.find(e => e.type === 'tool_use')
    expect(toolUseEvent).toBeDefined()
    expect(toolUseEvent!.type).toBe('tool_use')
    expect((toolUseEvent as any).toolName).toBe('Read')
    expect((toolUseEvent as any).toolUseId).toBe('toolu_01XyZ123abc')
  })

  it('should use actual tool name on tool_result (not tool_use_id)', async () => {
    const messages = [
      {
        type: 'system' as const,
        subtype: 'init' as const,
        model: 'claude-sonnet-4-5-20250929',
        sessionId: 'sess-1',
      },
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use' as const,
              id: 'toolu_01XyZ123abc',
              name: 'Bash',
              input: { command: 'ls -la' },
            },
          ],
        },
      },
      {
        type: 'user' as const,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: 'toolu_01XyZ123abc',
              content: 'total 42\ndrwxr-xr-x ...',
              is_error: false,
            },
          ],
        },
      },
      {
        type: 'result' as const,
        subtype: 'success' as const,
        sessionId: 'sess-1',
        result: 'done',
      },
    ]

    mockedQuery.mockReturnValue(asyncGen(messages) as any)

    const events = []
    for await (const event of provider.stream(makeTask())) {
      events.push(event)
    }

    // Find tool_result event
    const toolResultEvent = events.find(e => e.type === 'tool_result')
    expect(toolResultEvent).toBeDefined()
    // BUG FIX: toolName should be 'Bash', NOT 'toolu_01XyZ123abc'
    expect((toolResultEvent as any).toolName).toBe('Bash')
    expect((toolResultEvent as any).toolUseId).toBe('toolu_01XyZ123abc')
    expect((toolResultEvent as any).success).toBe(true)
  })

  it('should correctly correlate multiple tool calls in the same turn', async () => {
    const messages = [
      {
        type: 'system' as const,
        subtype: 'init' as const,
        model: 'claude-sonnet-4-5-20250929',
        sessionId: 'sess-1',
      },
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use' as const,
              id: 'toolu_read_1',
              name: 'Read',
              input: { path: '/a.ts' },
            },
            {
              type: 'tool_use' as const,
              id: 'toolu_read_2',
              name: 'Read',
              input: { path: '/b.ts' },
            },
          ],
        },
      },
      {
        type: 'user' as const,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: 'toolu_read_1',
              content: 'contents of a.ts',
              is_error: false,
            },
            {
              type: 'tool_result' as const,
              tool_use_id: 'toolu_read_2',
              content: 'contents of b.ts',
              is_error: false,
            },
          ],
        },
      },
      {
        type: 'result' as const,
        subtype: 'success' as const,
        sessionId: 'sess-1',
        result: 'done',
      },
    ]

    mockedQuery.mockReturnValue(asyncGen(messages) as any)

    const events = []
    for await (const event of provider.stream(makeTask())) {
      events.push(event)
    }

    // Both tool_use events should have correct toolUseId
    const toolUses = events.filter(e => e.type === 'tool_use')
    expect(toolUses).toHaveLength(2)
    expect((toolUses[0] as any).toolUseId).toBe('toolu_read_1')
    expect((toolUses[0] as any).toolName).toBe('Read')
    expect((toolUses[1] as any).toolUseId).toBe('toolu_read_2')
    expect((toolUses[1] as any).toolName).toBe('Read')

    // Both tool_result events should resolve toolName correctly
    const toolResults = events.filter(e => e.type === 'tool_result')
    expect(toolResults).toHaveLength(2)
    // Both should have toolName='Read', NOT the tool_use_id
    expect((toolResults[0] as any).toolName).toBe('Read')
    expect((toolResults[0] as any).toolUseId).toBe('toolu_read_1')
    expect((toolResults[1] as any).toolName).toBe('Read')
    expect((toolResults[1] as any).toolUseId).toBe('toolu_read_2')
  })

  it('should handle mixed tool types and resolve each correctly', async () => {
    const messages = [
      {
        type: 'system' as const,
        subtype: 'init' as const,
        model: 'claude-sonnet-4-5-20250929',
        sessionId: 'sess-1',
      },
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use' as const, id: 'toolu_bash_1', name: 'Bash', input: { command: 'ls' } },
            { type: 'tool_use' as const, id: 'toolu_read_1', name: 'Read', input: { path: '/f.ts' } },
            { type: 'tool_use' as const, id: 'toolu_edit_1', name: 'Edit', input: { path: '/f.ts' } },
          ],
        },
      },
      {
        type: 'user' as const,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result' as const, tool_use_id: 'toolu_bash_1', content: 'ls output', is_error: false },
            { type: 'tool_result' as const, tool_use_id: 'toolu_read_1', content: 'file content', is_error: false },
            { type: 'tool_result' as const, tool_use_id: 'toolu_edit_1', content: 'edited', is_error: false },
          ],
        },
      },
      {
        type: 'result' as const,
        subtype: 'success' as const,
        sessionId: 'sess-1',
        result: 'done',
      },
    ]

    mockedQuery.mockReturnValue(asyncGen(messages) as any)

    const events = []
    for await (const event of provider.stream(makeTask())) {
      events.push(event)
    }

    const toolResults = events.filter(e => e.type === 'tool_result')
    expect(toolResults).toHaveLength(3)
    expect((toolResults[0] as any).toolName).toBe('Bash')
    expect((toolResults[1] as any).toolName).toBe('Read')
    expect((toolResults[2] as any).toolName).toBe('Edit')
  })

  it('should fall back to unknown for unrecognized tool_use_id in tool_result', async () => {
    const messages = [
      {
        type: 'system' as const,
        subtype: 'init' as const,
        model: 'claude-sonnet-4-5-20250929',
        sessionId: 'sess-1',
      },
      // No assistant/tool_use — go straight to user/tool_result (unusual but possible)
      {
        type: 'user' as const,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: 'toolu_unknown_123',
              content: 'some result',
              is_error: false,
            },
          ],
        },
      },
      {
        type: 'result' as const,
        subtype: 'success' as const,
        sessionId: 'sess-1',
        result: 'done',
      },
    ]

    mockedQuery.mockReturnValue(asyncGen(messages) as any)

    const events = []
    for await (const event of provider.stream(makeTask())) {
      events.push(event)
    }

    const toolResult = events.find(e => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect((toolResult as any).toolName).toBe('unknown')
    expect((toolResult as any).toolUseId).toBe('toolu_unknown_123')
  })

  it('should handle tool_result with is_error=true', async () => {
    const messages = [
      {
        type: 'system' as const,
        subtype: 'init' as const,
        model: 'claude-sonnet-4-5-20250929',
        sessionId: 'sess-1',
      },
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use' as const, id: 'toolu_err_1', name: 'Bash', input: { command: 'bad-cmd' } },
          ],
        },
      },
      {
        type: 'user' as const,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: 'toolu_err_1',
              content: 'command not found',
              is_error: true,
            },
          ],
        },
      },
      {
        type: 'result' as const,
        subtype: 'success' as const,
        sessionId: 'sess-1',
        result: 'done',
      },
    ]

    mockedQuery.mockReturnValue(asyncGen(messages) as any)

    const events = []
    for await (const event of provider.stream(makeTask())) {
      events.push(event)
    }

    const toolResult = events.find(e => e.type === 'tool_result')
    expect((toolResult as any).toolName).toBe('Bash')
    expect((toolResult as any).success).toBe(false)
    expect((toolResult as any).toolUseId).toBe('toolu_err_1')
  })

  it('should include text events alongside tool events', async () => {
    const messages = [
      {
        type: 'system' as const,
        subtype: 'init' as const,
        model: 'claude-sonnet-4-5-20250929',
        sessionId: 'sess-1',
      },
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant',
          content: [
            { type: 'text' as const, text: 'Let me check.' },
            { type: 'tool_use' as const, id: 'toolu_t1', name: 'Read', input: { path: '/f.ts' } },
          ],
        },
      },
      {
        type: 'result' as const,
        subtype: 'success' as const,
        sessionId: 'sess-1',
        result: 'done',
      },
    ]

    mockedQuery.mockReturnValue(asyncGen(messages) as any)

    const events = []
    for await (const event of provider.stream(makeTask())) {
      events.push(event)
    }

    const textEvent = events.find(e => e.type === 'text')
    expect(textEvent).toBeDefined()
    expect((textEvent as any).text).toBe('Let me check.')

    const toolUseEvent = events.find(e => e.type === 'tool_use')
    expect((toolUseEvent as any).toolUseId).toBe('toolu_t1')
    expect((toolUseEvent as any).toolName).toBe('Read')
  })
})
