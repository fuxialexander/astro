/**
 * OpenCode SDK Event Parsing Tests
 *
 * Comprehensive unit tests for parsing OpenCode's JSONL streaming output.
 * Tests the SDK event types: text, tool_use, step_start, step_finish, reasoning, error.
 *
 * These tests verify:
 * 1. Each JSONL event type parsing (text, tool_use, step_start, step_finish, reasoning, error)
 * 2. Part structure extraction ({type, sessionID, timestamp, part})
 * 3. Tool ID to name correlation
 * 4. Metrics extraction from step_finish (cost, tokens, reason)
 * 5. Malformed JSON and buffering
 *
 * OpenCode Event Types (wrapped in {type, timestamp, sessionID, ...}):
 * - text:         Completed text output (TextPart with time.end)
 * - tool_use:     Tool execution (ToolPart with status completed/error)
 * - step_start:   Step begins (StepStartPart)
 * - step_finish:  Step completes (StepFinishPart with cost/tokens/reason)
 * - reasoning:    Internal reasoning (ReasoningPart, requires --thinking flag)
 * - error:        Session errors (SessionError)
 *
 * @see docs/planning/cli-jsonl-format-analysis.md
 * @see tests/fixtures/opencode-output.jsonl
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockStream } from './helpers/mock-stream.js'

// =============================================================================
// OpenCode Event Type Definitions
// =============================================================================

/**
 * Base event wrapper for all OpenCode events
 */
interface OpenCodeEventBase {
  type: string
  timestamp: number
  sessionID: string
}

/**
 * Text event - completed text output
 */
interface OpenCodeTextEvent extends OpenCodeEventBase {
  type: 'text'
  part: {
    id: string
    sessionID: string
    messageID: string
    type: 'text'
    text: string
    synthetic?: boolean
    ignored?: boolean
    time?: {
      start: number
      end?: number
    }
    metadata?: Record<string, unknown>
  }
}

/**
 * Tool state for completed tool execution
 */
interface ToolStateCompleted {
  status: 'completed'
  input: Record<string, unknown>
  output: string
  title: string
  metadata: Record<string, unknown>
  time: {
    start: number
    end: number
    compacted?: number
  }
  attachments?: FilePart[]
}

/**
 * Tool state for running tool execution
 */
interface ToolStateRunning {
  status: 'running'
  input: Record<string, unknown>
  time: {
    start: number
  }
}

/**
 * Tool state for error tool execution
 */
interface ToolStateError {
  status: 'error'
  input: Record<string, unknown>
  error: string
  metadata?: Record<string, unknown>
  time: {
    start: number
    end: number
  }
}

/**
 * File part for attachments
 */
interface FilePart {
  id: string
  sessionID: string
  messageID: string
  type: 'file'
  path: string
  mimeType: string
}

/**
 * Tool use event - tool execution
 */
interface OpenCodeToolUseEvent extends OpenCodeEventBase {
  type: 'tool_use'
  part: {
    id: string
    sessionID: string
    messageID: string
    type: 'tool'
    callID: string
    tool: string
    state: ToolStateCompleted | ToolStateRunning | ToolStateError
    metadata?: Record<string, unknown>
  }
}

/**
 * Step start event
 */
interface OpenCodeStepStartEvent extends OpenCodeEventBase {
  type: 'step_start'
  part: {
    id: string
    sessionID: string
    messageID: string
    type: 'step-start'
    snapshot?: string
  }
}

/**
 * Step finish event with metrics
 */
interface OpenCodeStepFinishEvent extends OpenCodeEventBase {
  type: 'step_finish'
  part: {
    id: string
    sessionID: string
    messageID: string
    type: 'step-finish'
    reason: string
    snapshot?: string
    cost: number
    tokens: {
      total?: number
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
  }
}

/**
 * Reasoning event (requires --thinking flag)
 */
interface OpenCodeReasoningEvent extends OpenCodeEventBase {
  type: 'reasoning'
  part: {
    id: string
    sessionID: string
    messageID: string
    type: 'reasoning'
    text: string
    metadata?: Record<string, unknown>
    time: {
      start: number
      end?: number
    }
  }
}

/**
 * Session error types
 */
interface SessionError {
  name: 'APIError' | 'ProviderAuthError' | 'MessageAbortedError' | 'ContextOverflowError' | 'MessageOutputLengthError' | 'UnknownError'
  data: {
    message: string
    statusCode?: number
    provider?: string
    currentTokens?: number
    maxTokens?: number
    outputTokens?: number
    isRetryable: boolean
    stack?: string
  }
}

/**
 * Error event
 */
interface OpenCodeErrorEvent extends OpenCodeEventBase {
  type: 'error'
  error: SessionError
}

type OpenCodeEvent =
  | OpenCodeTextEvent
  | OpenCodeToolUseEvent
  | OpenCodeStepStartEvent
  | OpenCodeStepFinishEvent
  | OpenCodeReasoningEvent
  | OpenCodeErrorEvent

// =============================================================================
// OpenCode Adapter Mock (for testing parsing logic)
// =============================================================================

/**
 * Mock OpenCode adapter for testing event parsing
 * This implements the expected parsing behavior based on the OpenCode SDK format
 */
class MockOpenCodeAdapter {
  private sessionInitEmitted = false
  private lastResultMetrics: {
    totalCost?: number
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reason?: string
  } | null = null

  // Track tool invocations for ID to name correlation
  private toolNameMap = new Map<string, string>()

  /**
   * Handle a single line of JSONL output from OpenCode
   */
  handleStreamLine(line: string, stream: TaskOutputStream): { metrics?: Record<string, unknown> } | void {
    // Skip empty lines and comments
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return
    }

    // Try to parse as JSON
    let event: OpenCodeEvent
    try {
      const parsed = JSON.parse(trimmed)

      // Validate it's an object with a type field
      if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
        stream.stdout(line + '\n')
        return
      }

      event = parsed as OpenCodeEvent
    } catch {
      // Not valid JSON - emit as raw stdout
      stream.stdout(line + '\n')
      return
    }

    // Emit sessionInit on first event with sessionID
    if (!this.sessionInitEmitted && event.sessionID) {
      stream.sessionInit(event.sessionID)
      this.sessionInitEmitted = true
    }

    // Handle each event type
    switch (event.type) {
      case 'text':
        this.handleTextEvent(event, stream)
        break

      case 'tool_use':
        this.handleToolUseEvent(event, stream)
        break

      case 'step_start':
        this.handleStepStartEvent(event, stream)
        break

      case 'step_finish':
        return this.handleStepFinishEvent(event, stream)

      case 'reasoning':
        this.handleReasoningEvent(event, stream)
        break

      case 'error':
        this.handleErrorEvent(event, stream)
        break

      default:
        // Unknown event type - ignore silently for forward compatibility
        break
    }
  }

  /**
   * Handle text event
   */
  private handleTextEvent(event: OpenCodeTextEvent, stream: TaskOutputStream): void {
    const { part } = event

    // Skip empty text, synthetic, or ignored parts
    if (!part.text || part.synthetic || part.ignored) {
      return
    }

    stream.text(part.text)
  }

  /**
   * Handle tool use event
   */
  private handleToolUseEvent(event: OpenCodeToolUseEvent, stream: TaskOutputStream): void {
    const { part } = event
    const { state, tool, callID } = part

    // Store tool name for ID correlation
    this.toolNameMap.set(callID, tool)

    // Title can appear in any state object (not just completed)
    const stateWithTitle = state as { title?: string }
    const title = stateWithTitle.title || tool

    if (state.status === 'running') {
      // Tool execution started
      stream.toolUse(title, { toolCallId: callID, input: state.input })
    } else if (state.status === 'completed') {
      // Tool execution completed successfully
      stream.toolResult(state.title || tool, state.output, true)
    } else if (state.status === 'error') {
      // Tool execution failed
      stream.toolResult(title, state.error, false)
    }
  }

  /**
   * Handle step start event
   */
  private handleStepStartEvent(event: OpenCodeStepStartEvent, stream: TaskOutputStream): void {
    stream.status('running', undefined, 'Step started')
  }

  /**
   * Handle step finish event - extract metrics
   */
  private handleStepFinishEvent(event: OpenCodeStepFinishEvent, stream: TaskOutputStream): { metrics: Record<string, unknown> } {
    const { part } = event

    // Extract metrics
    this.lastResultMetrics = {
      totalCost: part.cost,
      inputTokens: part.tokens.input,
      outputTokens: part.tokens.output,
      reasoningTokens: part.tokens.reasoning,
      cacheReadTokens: part.tokens.cache.read,
      cacheWriteTokens: part.tokens.cache.write,
      reason: part.reason,
    }

    stream.status('running', 100, `Step finished: ${part.reason}`)

    return {
      metrics: {
        totalCost: part.cost,
        inputTokens: part.tokens.input,
        outputTokens: part.tokens.output,
        reasoningTokens: part.tokens.reasoning,
        cacheReadTokens: part.tokens.cache.read,
        cacheWriteTokens: part.tokens.cache.write,
        reason: part.reason,
      },
    }
  }

  /**
   * Handle reasoning event
   */
  private handleReasoningEvent(event: OpenCodeReasoningEvent, stream: TaskOutputStream): void {
    const { part } = event

    // Skip empty reasoning
    if (!part.text) {
      return
    }

    // Emit reasoning as text (or could emit as status with "Thinking:" prefix)
    stream.text(part.text)
  }

  /**
   * Handle error event
   */
  private handleErrorEvent(event: OpenCodeErrorEvent, stream: TaskOutputStream): void {
    const { error } = event
    const message = error.data.message || 'Unknown error'
    const errorName = error.name

    stream.status('running', undefined, `Error [${errorName}]: ${message}`)
  }

  /**
   * Get tool name by call ID
   */
  getToolName(callID: string): string | undefined {
    return this.toolNameMap.get(callID)
  }

  /**
   * Get last extracted metrics
   */
  getLastMetrics() {
    return this.lastResultMetrics
  }

  /**
   * Reset adapter state
   */
  reset(): void {
    this.sessionInitEmitted = false
    this.lastResultMetrics = null
    this.toolNameMap.clear()
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('OpenCode SDK Event Parsing', () => {
  let adapter: MockOpenCodeAdapter
  let stream: TaskOutputStream

  beforeEach(() => {
    adapter = new MockOpenCodeAdapter()
    stream = createMockStream()
  })

  // ===========================================================================
  // 1. text Event Type Parsing
  // ===========================================================================

  describe('text event parsing', () => {
    it('emits text for valid text event', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Hello, world!',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).toHaveBeenCalledWith('Hello, world!')
    })

    it('emits sessionInit on first event', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'First message',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.sessionInit).toHaveBeenCalledWith('oc-sess-001')
    })

    it('emits sessionInit only once', () => {
      const event1: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'First message',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      const event2: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567900,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Second message',
          time: { start: 1709234567895, end: 1709234567900 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event1), stream)
      adapter.handleStreamLine(JSON.stringify(event2), stream)

      expect(stream.sessionInit).toHaveBeenCalledTimes(1)
    })

    it('skips empty text', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: '',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).not.toHaveBeenCalled()
    })

    it('skips synthetic text parts', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Synthetic message',
          synthetic: true,
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).not.toHaveBeenCalled()
    })

    it('skips ignored text parts', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Ignored message',
          ignored: true,
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).not.toHaveBeenCalled()
    })

    it('handles unicode and special characters', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: '日本語 中文 🚀 π ≈ 3.14159',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).toHaveBeenCalledWith('日本語 中文 🚀 π ≈ 3.14159')
    })

    it('handles newlines and escape sequences', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Line 1\nLine 2\tTabbed',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).toHaveBeenCalledWith('Line 1\nLine 2\tTabbed')
    })

    it('handles text without time field', () => {
      const event = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'No time field',
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).toHaveBeenCalledWith('No time field')
    })

    it('handles text with metadata', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Text with metadata',
          time: { start: 1709234567800, end: 1709234567890 },
          metadata: { source: 'test', priority: 1 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).toHaveBeenCalledWith('Text with metadata')
    })
  })

  // ===========================================================================
  // 2. tool_use Event Type Parsing
  // ===========================================================================

  describe('tool_use event parsing', () => {
    it('emits toolResult for completed tool execution', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-001',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'ls -la' },
            output: 'total 120\npackage.json\ntsconfig.json',
            title: 'List directory contents',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'List directory contents',
        'total 120\npackage.json\ntsconfig.json',
        true
      )
    })

    it('emits toolUse for running tool execution', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568000,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-001',
          tool: 'bash',
          state: {
            status: 'running',
            input: { command: 'npm test' },
            time: { start: 1709234568000 },
            title: 'Run test suite',
          } as ToolStateRunning & { title?: string },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      // Uses title when available, falls back to tool name
      expect(stream.toolUse).toHaveBeenCalledWith(
        'Run test suite',
        expect.objectContaining({ toolCallId: 'call-001' })
      )
    })

    it('emits toolResult with success=false for error tool execution', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-001',
          tool: 'bash',
          state: {
            status: 'error',
            input: { command: 'npm test' },
            error: 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
            title: 'Run test suite',
          } as ToolStateError & { title?: string },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      // Uses title when available, falls back to tool name
      expect(stream.toolResult).toHaveBeenCalledWith(
        'Run test suite',
        'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1',
        false
      )
    })

    it('stores tool name for ID correlation', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-unique-123',
          tool: 'read',
          state: {
            status: 'completed',
            input: { path: 'package.json' },
            output: '{"name":"test"}',
            title: 'Read package.json',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(adapter.getToolName('call-unique-123')).toBe('read')
    })

    it('handles read tool', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568900,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p4',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-002',
          tool: 'read',
          state: {
            status: 'completed',
            input: { path: 'package.json' },
            output: '{"name":"astro","version":"1.0.0"}',
            title: 'Read package.json',
            metadata: {},
            time: { start: 1709234568600, end: 1709234568900 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'Read package.json',
        '{"name":"astro","version":"1.0.0"}',
        true
      )
    })

    it('handles write tool', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709235000800,
        sessionID: 'oc-sess-002',
        part: {
          id: 's2-p2',
          sessionID: 'oc-sess-002',
          messageID: 'm2',
          type: 'tool',
          callID: 'call-010',
          tool: 'write',
          state: {
            status: 'completed',
            input: { path: 'src/lib/utils.ts', content: 'export function cn() {}' },
            output: 'File written: src/lib/utils.ts (4 lines)',
            title: 'Write src/lib/utils.ts',
            metadata: { linesWritten: 4 },
            time: { start: 1709235000400, end: 1709235000800 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'Write src/lib/utils.ts',
        'File written: src/lib/utils.ts (4 lines)',
        true
      )
    })

    it('handles edit tool', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709235001600,
        sessionID: 'oc-sess-002',
        part: {
          id: 's2-p4',
          sessionID: 'oc-sess-002',
          messageID: 'm2',
          type: 'tool',
          callID: 'call-011',
          tool: 'edit',
          state: {
            status: 'completed',
            input: { path: 'src/index.ts', old_string: 'export {}', new_string: "export * from './lib/utils';" },
            output: 'File edited: src/index.ts',
            title: 'Edit src/index.ts',
            metadata: {},
            time: { start: 1709235001200, end: 1709235001600 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'Edit src/index.ts',
        'File edited: src/index.ts',
        true
      )
    })

    it('handles glob tool', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709237001600,
        sessionID: 'oc-sess-004',
        part: {
          id: 's4-p2',
          sessionID: 'oc-sess-004',
          messageID: 'm4',
          type: 'tool',
          callID: 'call-030',
          tool: 'glob',
          state: {
            status: 'completed',
            input: { pattern: '**/auth/**/*.ts' },
            output: 'src/auth/index.ts\nsrc/auth/middleware.ts\nsrc/auth/jwt.ts',
            title: 'Find auth files',
            metadata: {},
            time: { start: 1709237001200, end: 1709237001600 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'Find auth files',
        'src/auth/index.ts\nsrc/auth/middleware.ts\nsrc/auth/jwt.ts',
        true
      )
    })

    it('handles grep tool', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709242001000,
        sessionID: 'oc-sess-009',
        part: {
          id: 's9-p2',
          sessionID: 'oc-sess-009',
          messageID: 'm9-1',
          type: 'tool',
          callID: 'call-050',
          tool: 'grep',
          state: {
            status: 'completed',
            input: { pattern: 'export function', path: 'src' },
            output: 'src/index.ts:1:export function main() {}\nsrc/lib/utils.ts:1:export function cn()',
            title: 'Search for exports',
            metadata: {},
            time: { start: 1709242000500, end: 1709242001000 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'Search for exports',
        'src/index.ts:1:export function main() {}\nsrc/lib/utils.ts:1:export function cn()',
        true
      )
    })

    it('handles tool with file attachments', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709243001000,
        sessionID: 'oc-sess-010',
        part: {
          id: 's10-p2',
          sessionID: 'oc-sess-010',
          messageID: 'm10',
          type: 'tool',
          callID: 'call-060',
          tool: 'read',
          state: {
            status: 'completed',
            input: { path: 'tsconfig.json' },
            output: '{"compilerOptions":{"target":"ES2022"}}',
            title: 'Read tsconfig.json',
            metadata: { fileSize: 89, mimeType: 'application/json' },
            time: { start: 1709243000400, end: 1709243001000 },
            attachments: [
              {
                id: 'f1',
                sessionID: 'oc-sess-010',
                messageID: 'm10',
                type: 'file',
                path: 'tsconfig.json',
                mimeType: 'application/json',
              },
            ],
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'Read tsconfig.json',
        '{"compilerOptions":{"target":"ES2022"}}',
        true
      )
    })

    it('handles tool with compacted time', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709244015000,
        sessionID: 'oc-sess-011',
        part: {
          id: 's11-p2',
          sessionID: 'oc-sess-011',
          messageID: 'm11',
          type: 'tool',
          callID: 'call-070',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'npm test' },
            output: 'Test Files  3 passed (3)\nTests  25 passed (25)',
            title: 'Run test suite',
            metadata: { exitCode: 0 },
            time: { start: 1709244000400, end: 1709244015000, compacted: 1709244012000 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'Run test suite',
        'Test Files  3 passed (3)\nTests  25 passed (25)',
        true
      )
    })

    it('falls back to tool name when title is missing', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-001',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'ls' },
            output: 'file.txt',
            title: '',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
          } as ToolStateCompleted,
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      // When title is empty, should fall back to tool name
      expect(stream.toolResult).toHaveBeenCalledWith(
        'bash',
        'file.txt',
        true
      )
    })
  })

  // ===========================================================================
  // 3. step_start Event Type Parsing
  // ===========================================================================

  describe('step_start event parsing', () => {
    it('emits status for step start', () => {
      const event: OpenCodeStepStartEvent = {
        type: 'step_start',
        timestamp: 1709234567700,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p0',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'step-start',
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Step started')
    })

    it('handles step start with snapshot', () => {
      const event: OpenCodeStepStartEvent = {
        type: 'step_start',
        timestamp: 1709242000000,
        sessionID: 'oc-sess-009',
        part: {
          id: 's9-p0',
          sessionID: 'oc-sess-009',
          messageID: 'm9-1',
          type: 'step-start',
          snapshot: 'snap-001',
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Step started')
    })
  })

  // ===========================================================================
  // 4. step_finish Event Type Parsing (Metrics Extraction)
  // ===========================================================================

  describe('step_finish event parsing', () => {
    it('extracts cost from step_finish', () => {
      const event: OpenCodeStepFinishEvent = {
        type: 'step_finish',
        timestamp: 1709234569500,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p6',
          sessionID: 'oc-sess-001',
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
      }

      const result = adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(result).toBeDefined()
      expect(result?.metrics?.totalCost).toBe(0.0025)
    })

    it('extracts token counts from step_finish', () => {
      const event: OpenCodeStepFinishEvent = {
        type: 'step_finish',
        timestamp: 1709234569500,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p6',
          sessionID: 'oc-sess-001',
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
      }

      const result = adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(result?.metrics?.inputTokens).toBe(150)
      expect(result?.metrics?.outputTokens).toBe(75)
    })

    it('extracts reasoning tokens from step_finish', () => {
      const event: OpenCodeStepFinishEvent = {
        type: 'step_finish',
        timestamp: 1709237003100,
        sessionID: 'oc-sess-004',
        part: {
          id: 's4-p5',
          sessionID: 'oc-sess-004',
          messageID: 'm4',
          type: 'step-finish',
          reason: 'end_turn',
          cost: 0.0156,
          tokens: {
            total: 620,
            input: 350,
            output: 150,
            reasoning: 120,
            cache: { read: 80, write: 50 },
          },
        },
      }

      const result = adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(result?.metrics?.reasoningTokens).toBe(120)
    })

    it('extracts cache tokens from step_finish', () => {
      const event: OpenCodeStepFinishEvent = {
        type: 'step_finish',
        timestamp: 1709235002700,
        sessionID: 'oc-sess-002',
        part: {
          id: 's2-p7',
          sessionID: 'oc-sess-002',
          messageID: 'm2',
          type: 'step-finish',
          reason: 'end_turn',
          cost: 0.0089,
          tokens: {
            total: 450,
            input: 280,
            output: 170,
            reasoning: 0,
            cache: { read: 50, write: 100 },
          },
        },
      }

      const result = adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(result?.metrics?.cacheReadTokens).toBe(50)
      expect(result?.metrics?.cacheWriteTokens).toBe(100)
    })

    it('extracts reason from step_finish', () => {
      const event: OpenCodeStepFinishEvent = {
        type: 'step_finish',
        timestamp: 1709234569500,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p6',
          sessionID: 'oc-sess-001',
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
      }

      const result = adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(result?.metrics?.reason).toBe('end_turn')
    })

    it('handles step_finish with snapshot', () => {
      const event: OpenCodeStepFinishEvent = {
        type: 'step_finish',
        timestamp: 1709242001600,
        sessionID: 'oc-sess-009',
        part: {
          id: 's9-p4',
          sessionID: 'oc-sess-009',
          messageID: 'm9-1',
          type: 'step-finish',
          reason: 'end_turn',
          snapshot: 'snap-002',
          cost: 0.0032,
          tokens: {
            total: 280,
            input: 180,
            output: 100,
            reasoning: 0,
            cache: { read: 120, write: 60 },
          },
        },
      }

      const result = adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(result?.metrics?.totalCost).toBe(0.0032)
    })

    it('emits status with completion message', () => {
      const event: OpenCodeStepFinishEvent = {
        type: 'step_finish',
        timestamp: 1709234569500,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p6',
          sessionID: 'oc-sess-001',
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
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Step finished: end_turn')
    })

    it('handles zero cost step_finish', () => {
      const event: OpenCodeStepFinishEvent = {
        type: 'step_finish',
        timestamp: 1709246000400,
        sessionID: 'oc-sess-013',
        part: {
          id: 's13-p3',
          sessionID: 'oc-sess-013',
          messageID: 'm13',
          type: 'step-finish',
          reason: 'end_turn',
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
      }

      const result = adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(result?.metrics?.totalCost).toBe(0)
      expect(result?.metrics?.inputTokens).toBe(0)
    })

    it('stores metrics in adapter state', () => {
      const event: OpenCodeStepFinishEvent = {
        type: 'step_finish',
        timestamp: 1709234569500,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p6',
          sessionID: 'oc-sess-001',
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
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      const metrics = adapter.getLastMetrics()
      expect(metrics).toEqual({
        totalCost: 0.0025,
        inputTokens: 150,
        outputTokens: 75,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reason: 'end_turn',
      })
    })
  })

  // ===========================================================================
  // 5. reasoning Event Type Parsing
  // ===========================================================================

  describe('reasoning event parsing', () => {
    it('emits text for reasoning event', () => {
      const event: OpenCodeReasoningEvent = {
        type: 'reasoning',
        timestamp: 1709237000500,
        sessionID: 'oc-sess-004',
        part: {
          id: 's4-r1',
          sessionID: 'oc-sess-004',
          messageID: 'm4',
          type: 'reasoning',
          text: 'The user wants to refactor the authentication module.',
          time: { start: 1709237000100, end: 1709237000500 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).toHaveBeenCalledWith('The user wants to refactor the authentication module.')
    })

    it('skips empty reasoning text', () => {
      const event: OpenCodeReasoningEvent = {
        type: 'reasoning',
        timestamp: 1709237000500,
        sessionID: 'oc-sess-004',
        part: {
          id: 's4-r1',
          sessionID: 'oc-sess-004',
          messageID: 'm4',
          type: 'reasoning',
          text: '',
          time: { start: 1709237000100, end: 1709237000500 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).not.toHaveBeenCalled()
    })

    it('handles reasoning with metadata', () => {
      const event: OpenCodeReasoningEvent = {
        type: 'reasoning',
        timestamp: 1709237002500,
        sessionID: 'oc-sess-004',
        part: {
          id: 's4-r3',
          sessionID: 'oc-sess-004',
          messageID: 'm4',
          type: 'reasoning',
          text: 'Good, they are using JWT-based authentication.',
          metadata: { confidence: 0.95 },
          time: { start: 1709237002300, end: 1709237002500 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).toHaveBeenCalledWith('Good, they are using JWT-based authentication.')
    })

    it('handles multiple reasoning events in sequence', () => {
      const events: OpenCodeReasoningEvent[] = [
        {
          type: 'reasoning',
          timestamp: 1709237000500,
          sessionID: 'oc-sess-004',
          part: {
            id: 's4-r1',
            sessionID: 'oc-sess-004',
            messageID: 'm4',
            type: 'reasoning',
            text: 'First thought...',
            time: { start: 1709237000100, end: 1709237000500 },
          },
        },
        {
          type: 'reasoning',
          timestamp: 1709237000800,
          sessionID: 'oc-sess-004',
          part: {
            id: 's4-r2',
            sessionID: 'oc-sess-004',
            messageID: 'm4',
            type: 'reasoning',
            text: 'Second thought...',
            time: { start: 1709237000550, end: 1709237000800 },
          },
        },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream)
      }

      expect(stream.text).toHaveBeenCalledTimes(2)
      expect(stream.text).toHaveBeenNthCalledWith(1, 'First thought...')
      expect(stream.text).toHaveBeenNthCalledWith(2, 'Second thought...')
    })
  })

  // ===========================================================================
  // 6. error Event Type Parsing
  // ===========================================================================

  describe('error event parsing', () => {
    it('handles APIError (rate limit)', () => {
      const event: OpenCodeErrorEvent = {
        type: 'error',
        timestamp: 1709238000600,
        sessionID: 'oc-sess-005',
        error: {
          name: 'APIError',
          data: {
            message: 'Rate limit exceeded. Please wait 60 seconds before retrying.',
            statusCode: 429,
            isRetryable: true,
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [APIError]: Rate limit exceeded. Please wait 60 seconds before retrying.'
      )
    })

    it('handles ProviderAuthError', () => {
      const event: OpenCodeErrorEvent = {
        type: 'error',
        timestamp: 1709239000200,
        sessionID: 'oc-sess-006',
        error: {
          name: 'ProviderAuthError',
          data: {
            message: 'Invalid API key. Please check your ANTHROPIC_API_KEY environment variable.',
            provider: 'anthropic',
            isRetryable: false,
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [ProviderAuthError]: Invalid API key. Please check your ANTHROPIC_API_KEY environment variable.'
      )
    })

    it('handles ContextOverflowError', () => {
      const event: OpenCodeErrorEvent = {
        type: 'error',
        timestamp: 1709240001000,
        sessionID: 'oc-sess-007',
        error: {
          name: 'ContextOverflowError',
          data: {
            message: 'Context window exceeded. The conversation exceeds the model\'s 128k token limit.',
            currentTokens: 135000,
            maxTokens: 128000,
            isRetryable: false,
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        expect.stringContaining('Error [ContextOverflowError]')
      )
    })

    it('handles MessageAbortedError', () => {
      const event: OpenCodeErrorEvent = {
        type: 'error',
        timestamp: 1709241001200,
        sessionID: 'oc-sess-008',
        error: {
          name: 'MessageAbortedError',
          data: {
            message: 'Operation was cancelled by user',
            isRetryable: false,
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [MessageAbortedError]: Operation was cancelled by user'
      )
    })

    it('handles MessageOutputLengthError', () => {
      const event: OpenCodeErrorEvent = {
        type: 'error',
        timestamp: 1709248005000,
        sessionID: 'oc-sess-015',
        error: {
          name: 'MessageOutputLengthError',
          data: {
            message: 'Output exceeded maximum length of 8192 tokens.',
            outputTokens: 8500,
            maxTokens: 8192,
            isRetryable: false,
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        expect.stringContaining('Error [MessageOutputLengthError]')
      )
    })

    it('handles UnknownError', () => {
      const event: OpenCodeErrorEvent = {
        type: 'error',
        timestamp: 1709249000500,
        sessionID: 'oc-sess-016',
        error: {
          name: 'UnknownError',
          data: {
            message: 'An unexpected error occurred during execution.',
            stack: 'Error: Unexpected EOF\n    at Parser.parse (parser.js:42)',
            isRetryable: true,
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [UnknownError]: An unexpected error occurred during execution.'
      )
    })
  })

  // ===========================================================================
  // 7. Part Structure Extraction
  // ===========================================================================

  describe('part structure extraction', () => {
    it('extracts sessionID from event wrapper', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'custom-session-id-123',
        part: {
          id: 'p1',
          sessionID: 'custom-session-id-123',
          messageID: 'm1',
          type: 'text',
          text: 'Test',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.sessionInit).toHaveBeenCalledWith('custom-session-id-123')
    })

    it('extracts timestamp from event wrapper', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Test',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      // Timestamp is in the event, adapter should parse it correctly
      adapter.handleStreamLine(JSON.stringify(event), stream)

      // Event processed successfully
      expect(stream.text).toHaveBeenCalled()
    })

    it('extracts part type correctly', () => {
      const textEvent: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Test text',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      const toolEvent: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-001',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'ls' },
            output: 'file.txt',
            title: 'List files',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(textEvent), stream)
      adapter.handleStreamLine(JSON.stringify(toolEvent), stream)

      expect(stream.text).toHaveBeenCalledWith('Test text')
      expect(stream.toolResult).toHaveBeenCalledWith('List files', 'file.txt', true)
    })

    it('handles part with all optional fields', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Full part',
          synthetic: false,
          ignored: false,
          time: { start: 1709234567800, end: 1709234567890 },
          metadata: { key: 'value' },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.text).toHaveBeenCalledWith('Full part')
    })
  })

  // ===========================================================================
  // 8. Tool ID to Name Correlation
  // ===========================================================================

  describe('tool ID to name correlation', () => {
    it('correlates tool callID to tool name', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-abc-123',
          tool: 'read',
          state: {
            status: 'completed',
            input: { path: 'file.txt' },
            output: 'content',
            title: 'Read file.txt',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(adapter.getToolName('call-abc-123')).toBe('read')
    })

    it('tracks multiple tool IDs', () => {
      const events: OpenCodeToolUseEvent[] = [
        {
          type: 'tool_use',
          timestamp: 1709234568200,
          sessionID: 'oc-sess-001',
          part: {
            id: 'p2',
            sessionID: 'oc-sess-001',
            messageID: 'm1',
            type: 'tool',
            callID: 'call-001',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'ls' },
              output: 'files',
              title: 'List',
              metadata: {},
              time: { start: 1709234568000, end: 1709234568200 },
            },
          },
        },
        {
          type: 'tool_use',
          timestamp: 1709234568400,
          sessionID: 'oc-sess-001',
          part: {
            id: 'p3',
            sessionID: 'oc-sess-001',
            messageID: 'm1',
            type: 'tool',
            callID: 'call-002',
            tool: 'read',
            state: {
              status: 'completed',
              input: { path: 'file.txt' },
              output: 'content',
              title: 'Read',
              metadata: {},
              time: { start: 1709234568200, end: 1709234568400 },
            },
          },
        },
        {
          type: 'tool_use',
          timestamp: 1709234568600,
          sessionID: 'oc-sess-001',
          part: {
            id: 'p4',
            sessionID: 'oc-sess-001',
            messageID: 'm1',
            type: 'tool',
            callID: 'call-003',
            tool: 'write',
            state: {
              status: 'completed',
              input: { path: 'out.txt', content: 'data' },
              output: 'written',
              title: 'Write',
              metadata: {},
              time: { start: 1709234568400, end: 1709234568600 },
            },
          },
        },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream)
      }

      expect(adapter.getToolName('call-001')).toBe('bash')
      expect(adapter.getToolName('call-002')).toBe('read')
      expect(adapter.getToolName('call-003')).toBe('write')
    })

    it('returns undefined for unknown tool ID', () => {
      expect(adapter.getToolName('nonexistent-id')).toBeUndefined()
    })

    it('clears tool map on reset', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-001',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'ls' },
            output: 'files',
            title: 'List',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)
      expect(adapter.getToolName('call-001')).toBe('bash')

      adapter.reset()
      expect(adapter.getToolName('call-001')).toBeUndefined()
    })
  })

  // ===========================================================================
  // 9. Malformed JSON Handling
  // ===========================================================================

  describe('malformed JSON handling', () => {
    it('handles incomplete JSON object (missing closing brace)', () => {
      const malformed = '{"type":"text","timestamp":1709234567890,"sessionID":"oc-sess-001"'

      expect(() => {
        adapter.handleStreamLine(malformed, stream)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith(malformed + '\n')
    })

    it('handles truncated JSON in middle of string', () => {
      const truncated = '{"type":"tool_use","timestamp":1709234568000,"sessionID":"oc-sess-001","part":{"id":"p1","type":"tool","callID":"call-'

      expect(() => {
        adapter.handleStreamLine(truncated, stream)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith(truncated + '\n')
    })

    it('handles invalid JSON with extra comma', () => {
      const invalid = '{"type":"step_start","timestamp":1709250001000,"sessionID":"oc-sess-017",}'

      expect(() => {
        adapter.handleStreamLine(invalid, stream)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith(invalid + '\n')
    })

    it('handles invalid JSON with single quotes', () => {
      const invalid = "{'type':'text','timestamp':1709250002000}"

      expect(() => {
        adapter.handleStreamLine(invalid, stream)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith(invalid + '\n')
    })

    it('handles JSON array instead of object', () => {
      const array = '["text", 1709250003000, "oc-sess-017"]'

      expect(() => {
        adapter.handleStreamLine(array, stream)
      }).not.toThrow()

      // Array is valid JSON but not an object with type field
      expect(stream.stdout).toHaveBeenCalledWith(array + '\n')
    })

    it('handles JSON object missing type field', () => {
      const missingType = '{"timestamp":1709250004000,"sessionID":"oc-sess-017","part":{}}'

      expect(() => {
        adapter.handleStreamLine(missingType, stream)
      }).not.toThrow()

      // Should be treated as invalid and emitted as stdout
      expect(stream.stdout).toHaveBeenCalledWith(missingType + '\n')
    })

    it('handles null JSON value', () => {
      expect(() => {
        adapter.handleStreamLine('null', stream)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith('null\n')
    })

    it('handles boolean JSON value', () => {
      expect(() => {
        adapter.handleStreamLine('true', stream)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith('true\n')
    })

    it('handles number JSON value', () => {
      expect(() => {
        adapter.handleStreamLine('42', stream)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith('42\n')
    })

    it('handles empty string', () => {
      expect(() => {
        adapter.handleStreamLine('', stream)
      }).not.toThrow()

      // Empty string should be skipped (not emitted)
      expect(stream.stdout).not.toHaveBeenCalled()
    })

    it('handles whitespace-only string', () => {
      expect(() => {
        adapter.handleStreamLine('   ', stream)
      }).not.toThrow()

      // Whitespace-only should be skipped
      expect(stream.stdout).not.toHaveBeenCalled()
    })

    it('handles non-JSON plain text', () => {
      const plainText = 'This is not JSON at all'

      expect(() => {
        adapter.handleStreamLine(plainText, stream)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith(plainText + '\n')
    })

    it('handles comment lines (starting with #)', () => {
      const comment = '# This is a comment'

      expect(() => {
        adapter.handleStreamLine(comment, stream)
      }).not.toThrow()

      // Comments should be skipped
      expect(stream.stdout).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // 10. Buffering and Line Processing
  // ===========================================================================

  describe('buffering and line processing', () => {
    it('processes multiple events in sequence', () => {
      const events = [
        { type: 'text', timestamp: 1709234567890, sessionID: 'oc-sess-001', part: { id: 'p1', sessionID: 'oc-sess-001', messageID: 'm1', type: 'text', text: 'First' } },
        { type: 'text', timestamp: 1709234567900, sessionID: 'oc-sess-001', part: { id: 'p2', sessionID: 'oc-sess-001', messageID: 'm1', type: 'text', text: 'Second' } },
        { type: 'text', timestamp: 1709234567910, sessionID: 'oc-sess-001', part: { id: 'p3', sessionID: 'oc-sess-001', messageID: 'm1', type: 'text', text: 'Third' } },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream)
      }

      expect(stream.text).toHaveBeenCalledTimes(3)
      expect(stream.text).toHaveBeenNthCalledWith(1, 'First')
      expect(stream.text).toHaveBeenNthCalledWith(2, 'Second')
      expect(stream.text).toHaveBeenNthCalledWith(3, 'Third')
    })

    it('handles mixed valid and invalid lines', () => {
      const lines = [
        '{"type":"text","timestamp":1709234567890,"sessionID":"oc-sess-001","part":{"id":"p1","sessionID":"oc-sess-001","messageID":"m1","type":"text","text":"Valid"}}',
        'invalid json',
        '{"type":"text","timestamp":1709234567900,"sessionID":"oc-sess-001","part":{"id":"p2","sessionID":"oc-sess-001","messageID":"m1","type":"text","text":"Also valid"}}',
      ]

      for (const line of lines) {
        adapter.handleStreamLine(line, stream)
      }

      expect(stream.text).toHaveBeenCalledTimes(2)
      expect(stream.stdout).toHaveBeenCalledWith('invalid json\n')
    })

    it('handles rapid-fire events (100 events)', () => {
      for (let i = 0; i < 100; i++) {
        const event = {
          type: 'text',
          timestamp: 1709234567890 + i,
          sessionID: 'oc-sess-001',
          part: {
            id: `p${i}`,
            sessionID: 'oc-sess-001',
            messageID: 'm1',
            type: 'text',
            text: `Message ${i}`,
          },
        }
        adapter.handleStreamLine(JSON.stringify(event), stream)
      }

      expect(stream.text).toHaveBeenCalledTimes(100)
    })
  })

  // ===========================================================================
  // 11. Full Session Sequences
  // ===========================================================================

  describe('full session sequences', () => {
    it('processes happy path session (Scenario 1 from fixtures)', () => {
      const events = [
        '{"type":"step_start","timestamp":1709234567700,"sessionID":"oc-sess-001","part":{"id":"p0","sessionID":"oc-sess-001","messageID":"m1","type":"step-start"}}',
        '{"type":"text","timestamp":1709234567890,"sessionID":"oc-sess-001","part":{"id":"p1","sessionID":"oc-sess-001","messageID":"m1","type":"text","text":"I\'ll analyze the project structure first.","time":{"start":1709234567750,"end":1709234567890}}}',
        '{"type":"tool_use","timestamp":1709234568200,"sessionID":"oc-sess-001","part":{"id":"p2","sessionID":"oc-sess-001","messageID":"m1","type":"tool","callID":"call-001","tool":"bash","state":{"status":"completed","input":{"command":"ls -la"},"output":"total 120\\npackage.json\\ntsconfig.json","title":"List directory contents","metadata":{},"time":{"start":1709234568000,"end":1709234568200}}}}',
        '{"type":"text","timestamp":1709234568500,"sessionID":"oc-sess-001","part":{"id":"p3","sessionID":"oc-sess-001","messageID":"m1","type":"text","text":"I can see the project has a standard structure.","time":{"start":1709234568250,"end":1709234568500}}}',
        '{"type":"step_finish","timestamp":1709234569500,"sessionID":"oc-sess-001","part":{"id":"p6","sessionID":"oc-sess-001","messageID":"m1","type":"step-finish","reason":"end_turn","cost":0.0025,"tokens":{"input":150,"output":75,"reasoning":0,"cache":{"read":0,"write":0}}}}',
      ]

      for (const line of events) {
        adapter.handleStreamLine(line, stream)
      }

      expect(stream.sessionInit).toHaveBeenCalledWith('oc-sess-001')
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Step started')
      expect(stream.text).toHaveBeenCalledTimes(2)
      expect(stream.toolResult).toHaveBeenCalledWith('List directory contents', expect.any(String), true)
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Step finished: end_turn')
    })

    it('processes session with tool error (Scenario 3 from fixtures)', () => {
      const events = [
        '{"type":"step_start","timestamp":1709236000000,"sessionID":"oc-sess-003","part":{"id":"s3-p0","sessionID":"oc-sess-003","messageID":"m3","type":"step-start"}}',
        '{"type":"text","timestamp":1709236000300,"sessionID":"oc-sess-003","part":{"id":"s3-p1","sessionID":"oc-sess-003","messageID":"m3","type":"text","text":"I\'ll run the test suite.","time":{"start":1709236000100,"end":1709236000300}}}',
        '{"type":"tool_use","timestamp":1709236001200,"sessionID":"oc-sess-003","part":{"id":"s3-p2","sessionID":"oc-sess-003","messageID":"m3","type":"tool","callID":"call-020","tool":"bash","state":{"status":"error","input":{"command":"npm test"},"error":"npm ERR! code ELIFECYCLE\\nnpm ERR! errno 1","metadata":{},"time":{"start":1709236000400,"end":1709236001200}}}}',
        '{"type":"text","timestamp":1709236001500,"sessionID":"oc-sess-003","part":{"id":"s3-p3","sessionID":"oc-sess-003","messageID":"m3","type":"text","text":"The test failed. Let me investigate.","time":{"start":1709236001300,"end":1709236001500}}}',
      ]

      for (const line of events) {
        adapter.handleStreamLine(line, stream)
      }

      expect(stream.toolResult).toHaveBeenCalledWith(
        'bash',
        'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1',
        false
      )
    })

    it('processes session with reasoning (Scenario 4 from fixtures)', () => {
      const events = [
        '{"type":"step_start","timestamp":1709237000000,"sessionID":"oc-sess-004","part":{"id":"s4-p0","sessionID":"oc-sess-004","messageID":"m4","type":"step-start"}}',
        '{"type":"reasoning","timestamp":1709237000500,"sessionID":"oc-sess-004","part":{"id":"s4-r1","sessionID":"oc-sess-004","messageID":"m4","type":"reasoning","text":"The user wants to refactor the authentication module.","time":{"start":1709237000100,"end":1709237000500}}}',
        '{"type":"text","timestamp":1709237001100,"sessionID":"oc-sess-004","part":{"id":"s4-p1","sessionID":"oc-sess-004","messageID":"m4","type":"text","text":"I\'ll start by examining the current implementation.","time":{"start":1709237000900,"end":1709237001100}}}',
        '{"type":"step_finish","timestamp":1709237003100,"sessionID":"oc-sess-004","part":{"id":"s4-p5","sessionID":"oc-sess-004","messageID":"m4","type":"step-finish","reason":"end_turn","cost":0.0156,"tokens":{"total":620,"input":350,"output":150,"reasoning":120,"cache":{"read":80,"write":50}}}}',
      ]

      for (const line of events) {
        adapter.handleStreamLine(line, stream)
      }

      // Reasoning and text should both be emitted
      expect(stream.text).toHaveBeenCalledTimes(2)
      expect(stream.text).toHaveBeenCalledWith('The user wants to refactor the authentication module.')
      expect(stream.text).toHaveBeenCalledWith("I'll start by examining the current implementation.")

      // Metrics should include reasoning tokens
      const result = adapter.getLastMetrics()
      expect(result?.reasoningTokens).toBe(120)
    })

    it('processes session with error event (Scenario 5 from fixtures)', () => {
      const events = [
        '{"type":"step_start","timestamp":1709238000000,"sessionID":"oc-sess-005","part":{"id":"s5-p0","sessionID":"oc-sess-005","messageID":"m5","type":"step-start"}}',
        '{"type":"text","timestamp":1709238000300,"sessionID":"oc-sess-005","part":{"id":"s5-p1","sessionID":"oc-sess-005","messageID":"m5","type":"text","text":"I\'ll analyze the large codebase","time":{"start":1709238000100,"end":1709238000300}}}',
        '{"type":"error","timestamp":1709238000600,"sessionID":"oc-sess-005","error":{"name":"APIError","data":{"message":"Rate limit exceeded. Please wait 60 seconds before retrying.","statusCode":429,"isRetryable":true}}}',
      ]

      for (const line of events) {
        adapter.handleStreamLine(line, stream)
      }

      expect(stream.text).toHaveBeenCalled()
      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        expect.stringContaining('Rate limit exceeded')
      )
    })

    it('processes multi-turn session (Scenario 9 from fixtures)', () => {
      const turn1Events = [
        '{"type":"step_start","timestamp":1709242000000,"sessionID":"oc-sess-009","part":{"id":"s9-p0","sessionID":"oc-sess-009","messageID":"m9-1","type":"step-start","snapshot":"snap-001"}}',
        '{"type":"text","timestamp":1709242000400,"sessionID":"oc-sess-009","part":{"id":"s9-p1","sessionID":"oc-sess-009","messageID":"m9-1","type":"text","text":"I\'ll help you implement the new feature.","time":{"start":1709242000100,"end":1709242000400}}}',
        '{"type":"step_finish","timestamp":1709242001600,"sessionID":"oc-sess-009","part":{"id":"s9-p4","sessionID":"oc-sess-009","messageID":"m9-1","type":"step-finish","reason":"end_turn","snapshot":"snap-002","cost":0.0032,"tokens":{"total":280,"input":180,"output":100,"reasoning":0,"cache":{"read":120,"write":60}}}}',
      ]

      const turn2Events = [
        '{"type":"step_start","timestamp":1709242010000,"sessionID":"oc-sess-009","part":{"id":"s9-p5","sessionID":"oc-sess-009","messageID":"m9-2","type":"step-start","snapshot":"snap-002"}}',
        '{"type":"text","timestamp":1709242010300,"sessionID":"oc-sess-009","part":{"id":"s9-p6","sessionID":"oc-sess-009","messageID":"m9-2","type":"text","text":"Now I\'ll implement the feature.","time":{"start":1709242010100,"end":1709242010300}}}',
        '{"type":"step_finish","timestamp":1709242011500,"sessionID":"oc-sess-009","part":{"id":"s9-p9","sessionID":"oc-sess-009","messageID":"m9-2","type":"step-finish","reason":"end_turn","snapshot":"snap-003","cost":0.0018,"tokens":{"total":200,"input":140,"output":60,"reasoning":0,"cache":{"read":180,"write":20}}}}',
      ]

      for (const line of [...turn1Events, ...turn2Events]) {
        adapter.handleStreamLine(line, stream)
      }

      // Session init should only happen once
      expect(stream.sessionInit).toHaveBeenCalledTimes(1)

      // Two step start events
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Step started')

      // Two text outputs
      expect(stream.text).toHaveBeenCalledTimes(2)

      // Final metrics should be from second turn
      const metrics = adapter.getLastMetrics()
      expect(metrics?.totalCost).toBe(0.0018)
    })
  })

  // ===========================================================================
  // 12. Edge Cases and Boundary Conditions
  // ===========================================================================

  describe('edge cases and boundary conditions', () => {
    it('handles very large text content', () => {
      const largeText = 'A'.repeat(100000)
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: largeText,
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream)
      }).not.toThrow()

      expect(stream.text).toHaveBeenCalledWith(largeText)
    })

    it('handles deeply nested JSON in tool output', () => {
      const nestedOutput = JSON.stringify({
        level1: {
          level2: {
            level3: {
              level4: {
                data: 'deep value',
                array: [1, 2, { nested: true }],
              },
            },
          },
        },
      })

      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-001',
          tool: 'read',
          state: {
            status: 'completed',
            input: { path: 'deep.json' },
            output: nestedOutput,
            title: 'Read deep.json',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
          },
        },
      }

      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream)
      }).not.toThrow()

      expect(stream.toolResult).toHaveBeenCalledWith('Read deep.json', nestedOutput, true)
    })

    it('handles unknown event types silently', () => {
      const unknownEvent = {
        type: 'unknown_future_event',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        data: 'some data',
      }

      expect(() => {
        adapter.handleStreamLine(JSON.stringify(unknownEvent), stream)
      }).not.toThrow()

      // Should emit sessionInit but nothing else
      expect(stream.sessionInit).toHaveBeenCalled()
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.toolResult).not.toHaveBeenCalled()
      expect(stream.stdout).not.toHaveBeenCalled()
    })

    it('handles extra fields in events gracefully', () => {
      const eventWithExtras = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        extra_field_1: 'ignored',
        extra_field_2: 12345,
        nested_extra: { foo: 'bar' },
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'Hello with extras',
          time: { start: 1709234567800, end: 1709234567890 },
          extra_part_field: 'also ignored',
        },
      }

      expect(() => {
        adapter.handleStreamLine(JSON.stringify(eventWithExtras), stream)
      }).not.toThrow()

      expect(stream.text).toHaveBeenCalledWith('Hello with extras')
    })

    it('handles whitespace-only text part', () => {
      const event: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: '   ',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      // Whitespace-only text is still valid text
      expect(stream.text).toHaveBeenCalledWith('   ')
    })

    it('handles tool with empty output', () => {
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-001',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'true' },
            output: '',
            title: 'Run true command',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
          },
        },
      }

      adapter.handleStreamLine(JSON.stringify(event), stream)

      expect(stream.toolResult).toHaveBeenCalledWith('Run true command', '', true)
    })

    it('handles very long tool output', () => {
      const longOutput = 'line\n'.repeat(10000)
      const event: OpenCodeToolUseEvent = {
        type: 'tool_use',
        timestamp: 1709234568200,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p2',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'tool',
          callID: 'call-001',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'find .' },
            output: longOutput,
            title: 'Find all files',
            metadata: {},
            time: { start: 1709234568000, end: 1709234568200 },
          },
        },
      }

      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream)
      }).not.toThrow()

      expect(stream.toolResult).toHaveBeenCalledWith('Find all files', longOutput, true)
    })

    it('resets adapter state correctly', () => {
      // Process some events
      const textEvent: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567890,
        sessionID: 'oc-sess-001',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-001',
          messageID: 'm1',
          type: 'text',
          text: 'First session',
          time: { start: 1709234567800, end: 1709234567890 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(textEvent), stream)
      expect(stream.sessionInit).toHaveBeenCalledWith('oc-sess-001')

      // Reset
      adapter.reset()
      vi.clearAllMocks()

      // Process event from new session
      const newSessionEvent: OpenCodeTextEvent = {
        type: 'text',
        timestamp: 1709234567900,
        sessionID: 'oc-sess-002',
        part: {
          id: 'p1',
          sessionID: 'oc-sess-002',
          messageID: 'm1',
          type: 'text',
          text: 'Second session',
          time: { start: 1709234567895, end: 1709234567900 },
        },
      }

      adapter.handleStreamLine(JSON.stringify(newSessionEvent), stream)

      // Should emit sessionInit for new session
      expect(stream.sessionInit).toHaveBeenCalledWith('oc-sess-002')
    })
  })
})

// =============================================================================
// OpenCode Adapter Lifecycle Tests
// =============================================================================
// These tests mock child_process.spawn to verify process lifecycle behavior:
// - Process spawning with correct args (opencode run --print --output-format json)
// - Environment variable passthrough
// - Abort/cancellation (SIGTERM then SIGKILL after 5s)
// - Process exit code handling
// - Timeout handling
// - stdin close on spawn

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Writable } from 'node:stream'

// Dynamic imports — agent-runner submodule may not be checked out in CI
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let OpenCodeAdapter: any
let lifecycleAdapterAvailable = false

try {
  const mod = await import('../packages/agent-runner/src/providers/opencode-adapter.js')
  OpenCodeAdapter = mod.OpenCodeAdapter
  lifecycleAdapterAvailable = true
} catch {
  // agent-runner submodule not available — lifecycle tests will be skipped
}

// Type aliases — use `any` since type imports can't be dynamic
// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
type LifecycleTaskOutputStream = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Task = any

// Mock the spawn function
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Mock the providers module to make OpenCode "available"
vi.mock('../packages/agent-runner/src/lib/providers.js', () => ({
  getProvider: vi.fn().mockResolvedValue({
    available: true,
    path: '/usr/local/bin/opencode',
    version: '1.0.0',
  }),
}))

// Mock fs.existsSync to control working directory validation
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      // Return false for specific test paths to simulate missing directories
      if (path === '/nonexistent/directory') return false
      return true
    }),
    readFileSync: vi.fn().mockReturnValue('{}'),
  }
})

/**
 * Create a mock TaskOutputStream for lifecycle tests
 */
function createLifecycleMockStream(): TaskOutputStream {
  return {
    stdout: vi.fn(),
    stderr: vi.fn(),
    status: vi.fn(),
    toolTrace: vi.fn(),
    text: vi.fn(),
    toolUse: vi.fn(),
    toolResult: vi.fn(),
    fileChange: vi.fn(),
    sessionInit: vi.fn(),
    approvalRequest: vi.fn(),
  }
}

/**
 * Create a mock ChildProcess with EventEmitter behavior
 */
function createMockProcess(): ChildProcess & {
  _mockStdout: EventEmitter
  _mockStderr: EventEmitter
  _mockStdin: { end: ReturnType<typeof vi.fn> }
  _emitClose: (code: number | null) => void
  _emitError: (error: Error) => void
} {
  const proc = new EventEmitter() as ChildProcess & {
    _mockStdout: EventEmitter
    _mockStderr: EventEmitter
    _mockStdin: { end: ReturnType<typeof vi.fn> }
    _emitClose: (code: number | null) => void
    _emitError: (error: Error) => void
  }

  proc._mockStdout = new EventEmitter()
  proc._mockStderr = new EventEmitter()
  proc._mockStdin = { end: vi.fn() }

  proc.stdout = proc._mockStdout as NodeJS.ReadableStream
  proc.stderr = proc._mockStderr as NodeJS.ReadableStream
  proc.stdin = proc._mockStdin as unknown as Writable
  proc.killed = false
  proc.pid = 12345

  proc.kill = vi.fn(() => {
    proc.killed = true
    return true
  })

  proc._emitClose = (code: number | null) => {
    proc.emit('close', code)
  }

  proc._emitError = (error: Error) => {
    proc.emit('error', error)
  }

  return proc
}

/**
 * Create a minimal task for lifecycle testing
 */
function createLifecycleTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task-123',
    projectId: 'test-project',
    planNodeId: 'test-node',
    provider: 'opencode',
    prompt: 'Test task prompt',
    workingDirectory: '/tmp/test-workspace',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe.skipIf(!lifecycleAdapterAvailable)('OpenCode Adapter Lifecycle', () => {
  let adapter: OpenCodeAdapter
  let mockSpawn: ReturnType<typeof vi.fn>
  let mockProcess: ReturnType<typeof createMockProcess>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    adapter = new OpenCodeAdapter()
    mockProcess = createMockProcess()
    mockSpawn = spawn as ReturnType<typeof vi.fn>
    mockSpawn.mockReturnValue(mockProcess)

    // Force adapter to be available
    await adapter.isAvailable()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. Process Spawning with Correct Args
  // ===========================================================================

  describe('process spawning with correct args', () => {
    it('spawns opencode with run --print --output-format json args', async () => {
      const task = createLifecycleTestTask({ prompt: 'Implement feature X' })
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      // Start execution (don't await - we'll control the process)
      const resultPromise = adapter.execute(task, stream, controller.signal)

      // Let the promise executor run
      await vi.runAllTimersAsync()

      // Emit successful completion
      mockProcess._mockStdout.emit('data', Buffer.from('{"type":"result","cost":0.01}\n'))
      mockProcess._emitClose(0)

      const result = await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/opencode',
        ['run', '--print', '--output-format', 'json', 'Implement feature X'],
        expect.objectContaining({
          cwd: '/tmp/test-workspace',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      )
      expect(result.status).toBe('completed')
    })

    it('includes --model flag when model is specified', async () => {
      const task = createLifecycleTestTask({
        prompt: 'Test prompt',
        model: 'claude-sonnet-4-20250514',
      })
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()
      mockProcess._emitClose(0)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/opencode',
        ['run', '--print', '--output-format', 'json', '--model', 'claude-sonnet-4-20250514', 'Test prompt'],
        expect.any(Object)
      )
    })

    it('combines systemPrompt with prompt when provided', async () => {
      const task = createLifecycleTestTask({
        prompt: 'Implement the feature',
        systemPrompt: 'You are a helpful assistant.',
      })
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()
      mockProcess._emitClose(0)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/opencode',
        [
          'run',
          '--print',
          '--output-format',
          'json',
          'You are a helpful assistant.\n\n---\n\nImplement the feature',
        ],
        expect.any(Object)
      )
    })
  })

  // ===========================================================================
  // 2. Environment Variable Passthrough
  // ===========================================================================

  describe('environment variable passthrough', () => {
    it('passes process.env to spawned process', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()
      mockProcess._emitClose(0)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining(process.env),
        })
      )
    })

    it('merges task.environment with process.env', async () => {
      const task = createLifecycleTestTask({
        environment: {
          ANTHROPIC_API_KEY: 'sk-test-key',
          CUSTOM_CONFIG: 'test-value',
        },
      })
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()
      mockProcess._emitClose(0)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            ...process.env,
            ANTHROPIC_API_KEY: 'sk-test-key',
            CUSTOM_CONFIG: 'test-value',
          }),
        })
      )
    })

    it('task environment overrides process.env variables', async () => {
      const task = createLifecycleTestTask({
        environment: {
          PATH: '/custom/path',
        },
      })
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()
      mockProcess._emitClose(0)

      await resultPromise

      const callArgs = mockSpawn.mock.calls[0]
      const env = callArgs[2].env as Record<string, string>
      expect(env.PATH).toBe('/custom/path')
    })
  })

  // ===========================================================================
  // 3. Abort/Cancellation (SIGTERM then SIGKILL after 5s)
  // ===========================================================================

  describe('abort/cancellation handling', () => {
    it('sends SIGTERM on abort', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      // Start execution - don't await since we want to abort
      adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Abort the task
      controller.abort()

      // Process should receive SIGTERM
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('sends SIGKILL after 5 seconds if process not killed', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      // Make the process appear not killed after SIGTERM
      mockProcess.killed = false
      mockProcess.kill = vi.fn(() => {
        // Don't set killed = true to simulate unresponsive process
        return true
      })

      // Start execution - don't await since we want to abort
      adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Abort the task
      controller.abort()

      // First call should be SIGTERM
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')

      // Advance time by 5 seconds
      await vi.advanceTimersByTimeAsync(5000)

      // Second call should be SIGKILL
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('does not send SIGKILL if process killed within 5 seconds', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      // Make the process killed after SIGTERM
      mockProcess.kill = vi.fn(() => {
        mockProcess.killed = true
        return true
      })

      // Start execution - don't await since we want to abort
      adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Abort the task
      controller.abort()

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
      expect(mockProcess.killed).toBe(true)

      // Advance time by 5 seconds
      await vi.advanceTimersByTimeAsync(5000)

      // Should only have been called once (SIGTERM)
      expect(mockProcess.kill).toHaveBeenCalledTimes(1)
    })

    it('returns cancelled status on abort when signal is aborted', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Abort the task
      controller.abort()

      // Emit error to trigger the catch block which checks signal.aborted
      mockProcess._emitError(new Error('Process killed'))

      const result = await resultPromise

      // When signal is aborted and an error occurs, should return cancelled
      expect(result.status).toBe('cancelled')
      expect(result.error).toBe('Task cancelled')
    })

    it('returns failed status on abort if process exits via close', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Abort the task
      controller.abort()

      // Close the process (not error) - this resolves normally
      mockProcess._emitClose(130) // SIGTERM exit code

      const result = await resultPromise

      // Exit code 130 is non-zero so status is 'failed' (not cancelled)
      // because close event resolves the promise normally
      expect(result.status).toBe('failed')
      expect(result.exitCode).toBe(130)
    })
  })

  // ===========================================================================
  // 4. Process Exit Code Handling
  // ===========================================================================

  describe('process exit code handling', () => {
    it('returns completed status for exit code 0', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitClose(0)

      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.exitCode).toBe(0)
    })

    it('returns failed status for non-zero exit code', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._mockStderr.emit('data', Buffer.from('Error: Something went wrong'))
      mockProcess._emitClose(1)

      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.exitCode).toBe(1)
      expect(result.error).toBe('Error: Something went wrong')
    })

    it('returns failed status for exit code 2 (general error)', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitClose(2)

      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.exitCode).toBe(2)
    })

    it('returns failed status for exit code 130 (SIGINT)', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitClose(130)

      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.exitCode).toBe(130)
    })

    it('handles null exit code (defaults to 1)', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Emit close with null code
      mockProcess._emitClose(null)

      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.exitCode).toBe(1)
    })

    it('captures stdout and stderr in result', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._mockStdout.emit('data', Buffer.from('Output line 1\n'))
      mockProcess._mockStdout.emit('data', Buffer.from('Output line 2\n'))
      mockProcess._mockStderr.emit('data', Buffer.from('Warning: something\n'))
      mockProcess._emitClose(0)

      const result = await resultPromise

      expect(result.output).toContain('Output line 1')
      expect(result.output).toContain('Output line 2')
      expect(result.error).toBe('Warning: something\n')
    })
  })

  // ===========================================================================
  // 5. Timeout Handling
  // ===========================================================================

  describe('timeout handling', () => {
    it('sends SIGTERM when timeout expires', async () => {
      const task = createLifecycleTestTask({ timeout: 10000 }) // 10 second timeout
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      // Make process unresponsive to SIGTERM
      mockProcess.killed = false
      mockProcess.kill = vi.fn(() => {
        // First call (SIGTERM) doesn't kill
        // Second call (SIGKILL) kills
        const callCount = (mockProcess.kill as ReturnType<typeof vi.fn>).mock.calls.length
        if (callCount >= 2) {
          mockProcess.killed = true
        }
        return true
      })

      // Start execution - don't await since we're testing timeout
      adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Advance time past the timeout
      await vi.advanceTimersByTimeAsync(10000)

      // Should have sent SIGTERM
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('sends SIGKILL 5s after timeout SIGTERM if process not killed', async () => {
      const task = createLifecycleTestTask({ timeout: 10000 })
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      // Make process unresponsive
      mockProcess.killed = false
      mockProcess.kill = vi.fn(() => true)

      // Start execution - don't await since we're testing timeout
      adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(10000)

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')

      // Advance 5 more seconds
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('does not timeout if process completes before timeout', async () => {
      const task = createLifecycleTestTask({ timeout: 30000 }) // 30 second timeout
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)

      // Complete the process immediately (before any timers advance)
      mockProcess._emitClose(0)

      const result = await resultPromise

      // Should complete normally with exit code 0
      expect(result.status).toBe('completed')
      expect(result.exitCode).toBe(0)
    })

    it('does not set timeout if task.timeout is not specified', async () => {
      const task = createLifecycleTestTask() // No timeout
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Advance time significantly
      await vi.advanceTimersByTimeAsync(60000)

      // Process should not have been killed
      expect(mockProcess.kill).not.toHaveBeenCalled()

      // Complete the process
      mockProcess._emitClose(0)

      const result = await resultPromise
      expect(result.status).toBe('completed')
    })
  })

  // ===========================================================================
  // 6. stdin Close on Spawn
  // ===========================================================================

  describe('stdin close on spawn', () => {
    it('closes stdin immediately after spawning', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Verify stdin.end() was called
      expect(mockProcess._mockStdin.end).toHaveBeenCalled()

      mockProcess._emitClose(0)
      await resultPromise
    })

    it('handles missing stdin gracefully', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      // Set stdin to null to simulate edge case
      mockProcess.stdin = null

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Should not throw
      mockProcess._emitClose(0)
      const result = await resultPromise

      expect(result.status).toBe('completed')
    })
  })

  // ===========================================================================
  // 7. Working Directory Validation
  // ===========================================================================

  describe('working directory validation', () => {
    it('rejects task if working directory does not exist', async () => {
      const task = createLifecycleTestTask({ workingDirectory: '/nonexistent/directory' })
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const result = await adapter.execute(task, stream, controller.signal)

      expect(result.status).toBe('failed')
      expect(result.error).toContain('Working directory does not exist')
      expect(result.error).toContain('/nonexistent/directory')
    })

    it('passes working directory to spawn as cwd', async () => {
      const task = createLifecycleTestTask({ workingDirectory: '/valid/path' })
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()
      mockProcess._emitClose(0)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cwd: '/valid/path',
        })
      )
    })

    it('handles missing workingDirectory (passes undefined to spawn)', async () => {
      const task = createLifecycleTestTask({ workingDirectory: undefined as unknown as string })
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()
      mockProcess._emitClose(0)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cwd: undefined,
        })
      )
    })
  })

  // ===========================================================================
  // 8. Process Error Handling
  // ===========================================================================

  describe('process error handling', () => {
    it('handles spawn error (e.g., executable not found)', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      // Make spawn throw an error
      mockSpawn.mockImplementationOnce(() => {
        throw new Error('spawn ENOENT')
      })

      const result = await adapter.execute(task, stream, controller.signal)

      expect(result.status).toBe('failed')
      expect(result.error).toBe('spawn ENOENT')
    })

    it('handles process error event', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Emit error event
      mockProcess._emitError(new Error('Process crashed'))

      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.error).toBe('Process crashed')
    })

    it('handles provider not available', async () => {
      // Create a fresh adapter that hasn't been initialized
      const freshAdapter = new OpenCodeAdapter()

      // Mock getProvider to return unavailable
      const { getProvider } = await import('../packages/agent-runner/src/lib/providers.js')
      ;(getProvider as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        available: false,
        path: null,
      })

      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const result = await freshAdapter.execute(task, stream, controller.signal)

      expect(result.status).toBe('failed')
      expect(result.error).toBe('OpenCode not available')
    })
  })

  // ===========================================================================
  // 9. Metrics Extraction from Stream Output
  // ===========================================================================

  describe('metrics extraction from stream output', () => {
    it('extracts metrics from result event', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Emit a result event with metrics
      const resultEvent = JSON.stringify({
        type: 'result',
        total_cost_usd: 0.0312,
        num_turns: 2,
        duration_ms: 15000,
        usage: { input_tokens: 1200, output_tokens: 600 },
        model: 'claude-sonnet-4-20250514',
      })
      mockProcess._mockStdout.emit('data', Buffer.from(resultEvent + '\n'))
      mockProcess._emitClose(0)

      const result = await resultPromise

      expect(result.metrics).toEqual({
        totalCost: 0.0312,
        inputTokens: 1200,
        outputTokens: 600,
        numTurns: 2,
        durationMs: 15000,
        model: 'claude-sonnet-4-20250514',
      })
    })

    it('extracts metrics with alternate field names', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Use alternate field names: cost, turns, tokens
      const resultEvent = JSON.stringify({
        type: 'result',
        cost: 0.02,
        turns: 3,
        duration_api_ms: 10000,
        tokens: { input: 500, output: 250 },
      })
      mockProcess._mockStdout.emit('data', Buffer.from(resultEvent + '\n'))
      mockProcess._emitClose(0)

      const result = await resultPromise

      expect(result.metrics?.totalCost).toBe(0.02)
      expect(result.metrics?.numTurns).toBe(3)
      expect(result.metrics?.inputTokens).toBe(500)
      expect(result.metrics?.outputTokens).toBe(250)
    })
  })

  // ===========================================================================
  // 10. Concurrent Task Tracking
  // ===========================================================================

  describe('concurrent task tracking', () => {
    it('increments activeTasks on execute start', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      // Check initial state
      const initialStatus = await adapter.getStatus()
      expect(initialStatus.activeTasks).toBe(0)

      // Start execution
      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Check activeTasks during execution
      const midStatus = await adapter.getStatus()
      expect(midStatus.activeTasks).toBe(1)

      // Complete execution
      mockProcess._emitClose(0)
      await resultPromise

      // Check final state
      const finalStatus = await adapter.getStatus()
      expect(finalStatus.activeTasks).toBe(0)
    })

    it('decrements activeTasks on execute completion', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitClose(0)
      await resultPromise

      const status = await adapter.getStatus()
      expect(status.activeTasks).toBe(0)
    })

    it('decrements activeTasks on execute failure', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitError(new Error('Process crashed'))
      await resultPromise

      const status = await adapter.getStatus()
      expect(status.activeTasks).toBe(0)
    })

    it('records last error on failure', async () => {
      const task = createLifecycleTestTask()
      const stream = createLifecycleMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitError(new Error('Process crashed unexpectedly'))
      await resultPromise

      const status = await adapter.getStatus()
      expect(status.lastError).toBe('Process crashed unexpectedly')
    })
  })
})
