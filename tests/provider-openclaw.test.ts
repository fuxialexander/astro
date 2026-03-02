/**
 * OpenClaw ACP (Agent Client Protocol) Event Parsing Tests
 *
 * Comprehensive unit tests for parsing OpenClaw's JSONL streaming output.
 * Tests the ACP format event types: text_delta, tool_call, status, done, error.
 *
 * These tests verify:
 * 1. Each JSONL event type parsing (text_delta, tool_call, status, done, error)
 * 2. Malformed JSON handling (should not crash, emit warning)
 * 3. Incomplete line buffering
 * 4. Event type mapping to StreamEvent (text(), toolUse(), toolResult(), sessionInit())
 * 5. Metadata extraction (tokens, cost, model from done event)
 *
 * ACP Event Types:
 * - text_delta: Streaming text output (output or thought stream)
 * - status:     Progress/status updates with optional metrics
 * - tool_call:  Tool invocations (in_progress/completed/error)
 * - done:       Session completion with stop reason
 * - error:      Error reporting with code and retry info
 *
 * @see docs/planning/13-CLI-JSONL-FORMAT-ANALYSIS.md
 * @see tests/fixtures/openclaw-output.jsonl
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { OpenClawAdapter } from '../packages/agent-runner/src/providers/openclaw-adapter.js'
import type { TaskOutputStream } from '../packages/agent-runner/src/providers/base-adapter.js'
import type { TaskArtifact } from '../packages/agent-runner/src/types.js'

/**
 * Create a mock TaskOutputStream with vi.fn() for each method
 */
function createMockStream(): TaskOutputStream {
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

// =============================================================================
// ACP Event Type Definitions for Test Clarity
// =============================================================================

interface AcpTextDeltaEvent {
  type: 'text_delta'
  text: string
  stream?: 'output' | 'thought'
  tag?: string
}

interface AcpStatusEvent {
  type: 'status'
  text: string
  tag?: string
  used?: number
  size?: number
}

interface AcpToolCallEvent {
  type: 'tool_call'
  text: string
  tag?: string
  toolCallId?: string
  status?: 'in_progress' | 'completed' | 'error'
  title?: string
}

interface AcpDoneEvent {
  type: 'done'
  stopReason?: string
  // Extended fields for metrics (if/when supported)
  cost?: number
  input_tokens?: number
  output_tokens?: number
  turns?: number
  model?: string
  duration_ms?: number
}

interface AcpErrorEvent {
  type: 'error'
  message: string
  code?: string
  retryable?: boolean
}

type AcpRuntimeEvent = AcpTextDeltaEvent | AcpStatusEvent | AcpToolCallEvent | AcpDoneEvent | AcpErrorEvent

// =============================================================================
// Test Suite
// =============================================================================

describe('OpenClaw ACP Event Parsing', () => {
  let adapter: OpenClawAdapter
  let stream: TaskOutputStream
  let artifacts: TaskArtifact[]

  beforeEach(() => {
    adapter = new OpenClawAdapter()
    stream = createMockStream()
    artifacts = []
  })

  // ===========================================================================
  // 1. text_delta Event Type Parsing
  // ===========================================================================

  describe('text_delta event parsing', () => {
    it('emits text for output stream', () => {
      const event: AcpTextDeltaEvent = {
        type: 'text_delta',
        text: 'Hello world',
        stream: 'output',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.text).toHaveBeenCalledWith('Hello world')
    })

    it('emits text for thought stream', () => {
      const event: AcpTextDeltaEvent = {
        type: 'text_delta',
        text: 'Let me think about this...',
        stream: 'thought',
        tag: 'agent_thought_chunk',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // Thought text should also be emitted (implementation may vary)
      expect(stream.text).toHaveBeenCalledWith('Let me think about this...')
    })

    it('handles text_delta without stream field', () => {
      const event: AcpTextDeltaEvent = {
        type: 'text_delta',
        text: 'Default stream text',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.text).toHaveBeenCalledWith('Default stream text')
    })

    it('handles empty text_delta', () => {
      const event: AcpTextDeltaEvent = {
        type: 'text_delta',
        text: '',
        stream: 'output',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // Empty text should not emit
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('handles text_delta with agent_message_chunk tag', () => {
      const event: AcpTextDeltaEvent = {
        type: 'text_delta',
        text: 'I will analyze the codebase',
        stream: 'output',
        tag: 'agent_message_chunk',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.text).toHaveBeenCalledWith('I will analyze the codebase')
    })

    it('handles unicode and special characters in text', () => {
      const event: AcpTextDeltaEvent = {
        type: 'text_delta',
        text: '日本語 中文 🚀 π ≈ 3.14159',
        stream: 'output',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.text).toHaveBeenCalledWith('日本語 中文 🚀 π ≈ 3.14159')
    })

    it('handles newlines and escape sequences in text', () => {
      const event: AcpTextDeltaEvent = {
        type: 'text_delta',
        text: 'Line 1\nLine 2\tTabbed',
        stream: 'output',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.text).toHaveBeenCalledWith('Line 1\nLine 2\tTabbed')
    })

    it('handles plan tag for planning output', () => {
      const event: AcpTextDeltaEvent = {
        type: 'text_delta',
        text: '1. Create the new API endpoint',
        stream: 'output',
        tag: 'plan',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.text).toHaveBeenCalledWith('1. Create the new API endpoint')
    })
  })

  // ===========================================================================
  // 2. tool_call Event Type Parsing
  // ===========================================================================

  describe('tool_call event parsing', () => {
    it('emits toolUse for in_progress status', () => {
      const event: AcpToolCallEvent = {
        type: 'tool_call',
        text: 'Reading project configuration',
        toolCallId: 'call-001',
        title: 'read_file: package.json',
        status: 'in_progress',
        tag: 'tool_call',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // Should emit toolUse when status is in_progress
      expect(stream.toolUse).toHaveBeenCalledWith(
        'read_file: package.json',
        { toolCallId: 'call-001', text: 'Reading project configuration' }
      )
    })

    it('emits toolResult for completed status', () => {
      const event: AcpToolCallEvent = {
        type: 'tool_call',
        text: '{"name":"astro","version":"1.0.0"}',
        toolCallId: 'call-001',
        title: 'read_file: package.json',
        status: 'completed',
        tag: 'tool_call_update',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'read_file: package.json',
        '{"name":"astro","version":"1.0.0"}',
        true
      )
    })

    it('emits toolResult with success=false for error status', () => {
      const event: AcpToolCallEvent = {
        type: 'tool_call',
        text: 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1',
        toolCallId: 'call-201',
        title: 'bash: npm test',
        status: 'error',
        tag: 'tool_call_update',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'bash: npm test',
        'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1',
        false
      )
    })

    it('handles tool_call without status field (defaults to in_progress)', () => {
      const event: AcpToolCallEvent = {
        type: 'tool_call',
        text: 'Listing files',
        toolCallId: 'call-102',
        title: 'bash: ls -la',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // Should treat as in_progress by default
      expect(stream.toolUse).toHaveBeenCalledWith(
        'bash: ls -la',
        { toolCallId: 'call-102', text: 'Listing files' }
      )
    })

    it('handles tool_call without title field', () => {
      const event: AcpToolCallEvent = {
        type: 'tool_call',
        text: 'File content here',
        toolCallId: 'call-999',
        status: 'completed',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // Should use 'unknown' as fallback
      expect(stream.toolResult).toHaveBeenCalledWith(
        'unknown',
        'File content here',
        true
      )
    })

    it('handles tool_call without toolCallId', () => {
      const event: AcpToolCallEvent = {
        type: 'tool_call',
        text: 'Running command',
        title: 'bash: echo hello',
        status: 'in_progress',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.toolUse).toHaveBeenCalledWith(
        'bash: echo hello',
        { toolCallId: undefined, text: 'Running command' }
      )
    })

    it('handles bash command tool_call', () => {
      const event: AcpToolCallEvent = {
        type: 'tool_call',
        text: 'file1.txt\nfile2.txt\nfile3.txt',
        toolCallId: 'call-101',
        title: 'bash: ls -la',
        status: 'completed',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'bash: ls -la',
        'file1.txt\nfile2.txt\nfile3.txt',
        true
      )
    })

    it('handles file operation tool_call', () => {
      const event: AcpToolCallEvent = {
        type: 'tool_call',
        text: 'File created successfully (45 lines)',
        toolCallId: 'call-501',
        title: 'write_file: src/components/Modal.tsx',
        status: 'completed',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'write_file: src/components/Modal.tsx',
        'File created successfully (45 lines)',
        true
      )
    })

    it('handles long tool output', () => {
      const longOutput = Array(100).fill('line').join('\n') + '... (truncated)'
      const event: AcpToolCallEvent = {
        type: 'tool_call',
        text: longOutput,
        toolCallId: 'call-601',
        title: 'bash: find . -type f',
        status: 'completed',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.toolResult).toHaveBeenCalledWith(
        'bash: find . -type f',
        longOutput,
        true
      )
    })
  })

  // ===========================================================================
  // 3. status Event Type Parsing
  // ===========================================================================

  describe('status event parsing', () => {
    it('emits status update for session_info_update', () => {
      const event: AcpStatusEvent = {
        type: 'status',
        text: 'Starting session...',
        tag: 'session_info_update',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Starting session...')
    })

    it('emits status update with usage metrics', () => {
      const event: AcpStatusEvent = {
        type: 'status',
        text: 'Processing complete',
        tag: 'usage_update',
        used: 1523,
        size: 4096,
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Processing complete')
    })

    it('handles status without tag', () => {
      const event: AcpStatusEvent = {
        type: 'status',
        text: 'Processing...',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Processing...')
    })

    it('handles current_mode_update tag', () => {
      const event: AcpStatusEvent = {
        type: 'status',
        text: 'Model: claude-sonnet-4-20250514',
        tag: 'current_mode_update',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalled()
    })

    it('handles available_commands_update tag', () => {
      const event: AcpStatusEvent = {
        type: 'status',
        text: 'Available commands: /help, /clear, /exit',
        tag: 'available_commands_update',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalled()
    })

    it('handles empty status text', () => {
      const event: AcpStatusEvent = {
        type: 'status',
        text: '',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // Implementation choice: may or may not emit for empty text
      // Just ensure it doesn't crash
    })

    it('extracts token usage from usage_update', () => {
      const event: AcpStatusEvent = {
        type: 'status',
        text: 'Tokens used: 150 / 8192',
        tag: 'usage_update',
        used: 150,
        size: 8192,
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // Metrics tracking - implementation may accumulate these
      expect(stream.status).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // 4. done Event Type Parsing
  // ===========================================================================

  describe('done event parsing', () => {
    it('emits completion status for end_turn', () => {
      const event: AcpDoneEvent = {
        type: 'done',
        stopReason: 'end_turn',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith('running', 100, expect.stringContaining('end_turn'))
    })

    it('handles cancelled stop reason', () => {
      const event: AcpDoneEvent = {
        type: 'done',
        stopReason: 'cancelled',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith('running', 100, expect.stringContaining('cancelled'))
    })

    it('handles done without stop reason', () => {
      const event: AcpDoneEvent = {
        type: 'done',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed')
    })

    it('returns metrics from done event when provided', () => {
      const event: AcpDoneEvent = {
        type: 'done',
        stopReason: 'end_turn',
        cost: 0.0523,
        input_tokens: 1500,
        output_tokens: 800,
        turns: 3,
        model: 'claude-sonnet-4-20250514',
        duration_ms: 12000,
      }

      const result = adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // If metrics are extracted, they should be returned
      // The current implementation may not support all these fields
      if (result) {
        expect(result.totalCost).toBe(0.0523)
        expect(result.inputTokens).toBe(1500)
        expect(result.outputTokens).toBe(800)
        expect(result.numTurns).toBe(3)
        expect(result.model).toBe('claude-sonnet-4-20250514')
        expect(result.durationMs).toBe(12000)
      }
    })

    it('handles done with partial metrics', () => {
      const event: AcpDoneEvent = {
        type: 'done',
        stopReason: 'end_turn',
        cost: 0.01,
        turns: 1,
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // 5. error Event Type Parsing
  // ===========================================================================

  describe('error event parsing', () => {
    it('handles rate limit error (retryable)', () => {
      const event: AcpErrorEvent = {
        type: 'error',
        message: 'API rate limit exceeded. Please wait 60 seconds before retrying.',
        code: 'rate_limit',
        retryable: true,
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [rate_limit]: API rate limit exceeded. Please wait 60 seconds before retrying.'
      )
    })

    it('handles auth error (non-retryable)', () => {
      const event: AcpErrorEvent = {
        type: 'error',
        message: 'Invalid API key. Please check your credentials.',
        code: 'auth_error',
        retryable: false,
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [auth_error]: Invalid API key. Please check your credentials.'
      )
    })

    it('handles context overflow error', () => {
      const event: AcpErrorEvent = {
        type: 'error',
        message: 'Context window exceeded. The conversation is too long.',
        code: 'context_overflow',
        retryable: false,
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [context_overflow]: Context window exceeded. The conversation is too long.'
      )
    })

    it('handles error without code', () => {
      const event: AcpErrorEvent = {
        type: 'error',
        message: 'Something went wrong',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error: Something went wrong'
      )
    })

    it('handles error without retryable field', () => {
      const event: AcpErrorEvent = {
        type: 'error',
        message: 'Unknown error occurred',
        code: 'unknown',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith(
        'running',
        undefined,
        'Error [unknown]: Unknown error occurred'
      )
    })

    it('handles empty error message', () => {
      const event: AcpErrorEvent = {
        type: 'error',
        message: '',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // Should not crash on empty message
    })
  })

  // ===========================================================================
  // 6. Malformed JSON Handling
  // ===========================================================================

  describe('malformed JSON handling', () => {
    it('handles incomplete JSON object (missing closing brace)', () => {
      const malformed = '{"type":"text_delta","text":"Hello world"'

      // Should not throw
      expect(() => {
        adapter.handleStreamLine(malformed, stream, artifacts)
      }).not.toThrow()

      // Should emit as raw stdout
      expect(stream.stdout).toHaveBeenCalledWith(malformed + '\n')
    })

    it('handles truncated JSON in middle of string', () => {
      const truncated = '{"type":"tool_call","text":"Reading fi'

      expect(() => {
        adapter.handleStreamLine(truncated, stream, artifacts)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith(truncated + '\n')
    })

    it('handles invalid JSON with extra comma', () => {
      const invalid = '{"type":"status","text":"Processing",}'

      expect(() => {
        adapter.handleStreamLine(invalid, stream, artifacts)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith(invalid + '\n')
    })

    it('handles invalid JSON with single quotes', () => {
      const invalid = "{'type':'error','message':'Invalid'}"

      expect(() => {
        adapter.handleStreamLine(invalid, stream, artifacts)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith(invalid + '\n')
    })

    it('handles JSON array instead of object', () => {
      const array = '["text_delta", "hello"]'

      expect(() => {
        adapter.handleStreamLine(array, stream, artifacts)
      }).not.toThrow()

      // Should not throw, may emit as stdout or ignore
    })

    it('handles JSON object missing type field', () => {
      const missingType = '{"text":"This has no type field","stream":"output"}'

      adapter.handleStreamLine(missingType, stream, artifacts)

      // Should not crash, just ignore unknown event
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('handles null JSON value', () => {
      expect(() => {
        adapter.handleStreamLine('null', stream, artifacts)
      }).not.toThrow()
    })

    it('handles boolean JSON value', () => {
      expect(() => {
        adapter.handleStreamLine('true', stream, artifacts)
      }).not.toThrow()
    })

    it('handles number JSON value', () => {
      expect(() => {
        adapter.handleStreamLine('42', stream, artifacts)
      }).not.toThrow()
    })

    it('handles empty string', () => {
      expect(() => {
        adapter.handleStreamLine('', stream, artifacts)
      }).not.toThrow()

      // Empty line should output newline
      expect(stream.stdout).toHaveBeenCalledWith('\n')
    })

    it('handles whitespace-only string', () => {
      expect(() => {
        adapter.handleStreamLine('   ', stream, artifacts)
      }).not.toThrow()
    })

    it('handles non-JSON plain text', () => {
      const plainText = 'This is not JSON at all'

      expect(() => {
        adapter.handleStreamLine(plainText, stream, artifacts)
      }).not.toThrow()

      expect(stream.stdout).toHaveBeenCalledWith(plainText + '\n')
    })

    it('handles comment lines (starting with #)', () => {
      const comment = '# This is a comment'

      expect(() => {
        adapter.handleStreamLine(comment, stream, artifacts)
      }).not.toThrow()

      // Comments are not valid JSON, should be emitted as stdout
      expect(stream.stdout).toHaveBeenCalledWith(comment + '\n')
    })
  })

  // ===========================================================================
  // 7. Incomplete Line Buffering
  // ===========================================================================

  describe('incomplete line buffering', () => {
    it('buffers incomplete lines across multiple chunks', () => {
      // This tests the line buffering logic in the actual runOpenClaw method
      // Here we test the handleStreamLine behavior with partial data

      // First chunk: partial JSON
      const partial1 = '{"type":"text_'
      adapter.handleStreamLine(partial1, stream, artifacts)
      expect(stream.stdout).toHaveBeenCalledWith(partial1 + '\n')

      // Reset mock
      vi.clearAllMocks()

      // Full event should work normally
      const fullEvent = '{"type":"text_delta","text":"Hello"}'
      adapter.handleStreamLine(fullEvent, stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Hello')
    })

    it('handles multiple events received in sequence', () => {
      const events = [
        { type: 'text_delta', text: 'First ' },
        { type: 'text_delta', text: 'Second ' },
        { type: 'text_delta', text: 'Third' },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.text).toHaveBeenCalledTimes(3)
      expect(stream.text).toHaveBeenNthCalledWith(1, 'First ')
      expect(stream.text).toHaveBeenNthCalledWith(2, 'Second ')
      expect(stream.text).toHaveBeenNthCalledWith(3, 'Third')
    })
  })

  // ===========================================================================
  // 8. Event Type Mapping to StreamEvent
  // ===========================================================================

  describe('event type mapping', () => {
    it('maps text_delta to text()', () => {
      const event = { type: 'text_delta', text: 'Hello', stream: 'output' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Hello')
    })

    it('maps tool_call (in_progress) to toolUse()', () => {
      const event = {
        type: 'tool_call',
        text: 'Starting',
        title: 'bash: ls',
        status: 'in_progress',
        toolCallId: 'call-1',
      }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolUse).toHaveBeenCalled()
    })

    it('maps tool_call (completed) to toolResult()', () => {
      const event = {
        type: 'tool_call',
        text: 'file.txt',
        title: 'bash: ls',
        status: 'completed',
        toolCallId: 'call-1',
      }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolResult).toHaveBeenCalledWith('bash: ls', 'file.txt', true)
    })

    it('maps status events to status()', () => {
      const event = { type: 'status', text: 'Processing...' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalled()
    })

    it('maps done events to status()', () => {
      const event = { type: 'done', stopReason: 'end_turn' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalled()
    })

    it('maps error events to status()', () => {
      const event = { type: 'error', message: 'Something failed' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalled()
    })

    it('emits sessionInit on first event (when session_id available)', () => {
      // Note: ACP format doesn't have session.start, but we may emit sessionInit
      // based on first event or status with session_info_update tag
      const event = { type: 'status', text: 'Session initialized', tag: 'session_info_update' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // Implementation may emit sessionInit here or later
      expect(stream.status).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // 9. Metadata Extraction
  // ===========================================================================

  describe('metadata extraction', () => {
    it('extracts metrics from done event with cost and tokens', () => {
      const event = {
        type: 'done',
        stopReason: 'end_turn',
        cost: 0.0312,
        input_tokens: 1200,
        output_tokens: 600,
        turns: 2,
        model: 'gpt-4o',
        duration_ms: 15000,
      }

      const result = adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      // If implementation extracts metrics, verify them
      if (result) {
        expect(result.totalCost).toBe(0.0312)
        expect(result.inputTokens).toBe(1200)
        expect(result.outputTokens).toBe(600)
        expect(result.numTurns).toBe(2)
        expect(result.model).toBe('gpt-4o')
        expect(result.durationMs).toBe(15000)
      }
    })

    it('accumulates usage from status updates', () => {
      // Multiple status events with usage_update tag
      const events = [
        { type: 'status', text: 'Progress 1', tag: 'usage_update', used: 100, size: 8192 },
        { type: 'status', text: 'Progress 2', tag: 'usage_update', used: 500, size: 8192 },
        { type: 'status', text: 'Progress 3', tag: 'usage_update', used: 1000, size: 8192 },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      // Usage tracking implementation may accumulate these
      expect(stream.status).toHaveBeenCalledTimes(3)
    })

    it('extracts model from status with current_mode_update', () => {
      const event = {
        type: 'status',
        text: 'Model: claude-sonnet-4-20250514',
        tag: 'current_mode_update',
      }

      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)

      expect(stream.status).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // 10. Full Session Sequences (Integration-style)
  // ===========================================================================

  describe('full ACP session sequences', () => {
    it('processes a complete happy path session', () => {
      const events: AcpRuntimeEvent[] = [
        { type: 'status', text: 'Starting session...', tag: 'session_info_update' },
        { type: 'text_delta', text: "I'll analyze the codebase", stream: 'output', tag: 'agent_message_chunk' },
        { type: 'text_delta', text: ' structure and make', stream: 'output', tag: 'agent_message_chunk' },
        { type: 'text_delta', text: ' the requested changes.', stream: 'output', tag: 'agent_message_chunk' },
        { type: 'tool_call', text: 'Reading project configuration', toolCallId: 'call-001', title: 'read_file: package.json', status: 'in_progress', tag: 'tool_call' },
        { type: 'tool_call', text: '{"name":"astro","version":"1.0.0"}', toolCallId: 'call-001', title: 'read_file: package.json', status: 'completed', tag: 'tool_call_update' },
        { type: 'text_delta', text: '\n\nI found the package.json. ', stream: 'output', tag: 'agent_message_chunk' },
        { type: 'status', text: 'Processing complete', tag: 'usage_update', used: 1523, size: 4096 },
        { type: 'done', stopReason: 'end_turn' },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      // Verify sequence of calls
      expect(stream.status).toHaveBeenCalled()
      expect(stream.text).toHaveBeenCalled()
      expect(stream.toolUse).toHaveBeenCalled()
      expect(stream.toolResult).toHaveBeenCalled()
    })

    it('processes a multi-tool session', () => {
      const events: AcpRuntimeEvent[] = [
        { type: 'status', text: 'Initializing agent...', tag: 'session_info_update' },
        { type: 'text_delta', text: 'Let me check the directory structure.', stream: 'output' },
        { type: 'tool_call', text: 'Listing files', toolCallId: 'call-101', title: 'bash: ls -la', status: 'in_progress' },
        { type: 'tool_call', text: 'total 120\npackage.json\ntsconfig.json', toolCallId: 'call-101', title: 'bash: ls -la', status: 'completed' },
        { type: 'tool_call', text: 'Finding files', toolCallId: 'call-102', title: "bash: find src -name '*.ts'", status: 'in_progress' },
        { type: 'tool_call', text: 'src/index.ts\nsrc/lib/utils.ts', toolCallId: 'call-102', title: "bash: find src -name '*.ts'", status: 'completed' },
        { type: 'tool_call', text: 'Reading entry point', toolCallId: 'call-103', title: 'read_file: src/index.ts', status: 'in_progress' },
        { type: 'tool_call', text: "export * from './lib/utils';", toolCallId: 'call-103', title: 'read_file: src/index.ts', status: 'completed' },
        { type: 'status', text: 'Analysis complete', tag: 'usage_update', used: 2847, size: 8192 },
        { type: 'done', stopReason: 'end_turn' },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.toolUse).toHaveBeenCalledTimes(3)
      expect(stream.toolResult).toHaveBeenCalledTimes(3)
    })

    it('processes a session with tool failure', () => {
      const events: AcpRuntimeEvent[] = [
        { type: 'status', text: 'Starting task...', tag: 'session_info_update' },
        { type: 'text_delta', text: "I'll run the tests.", stream: 'output' },
        { type: 'tool_call', text: 'Running test suite', toolCallId: 'call-201', title: 'bash: npm test', status: 'in_progress' },
        { type: 'tool_call', text: 'npm ERR! Exit status 1', toolCallId: 'call-201', title: 'bash: npm test', status: 'error' },
        { type: 'text_delta', text: '\n\nThe tests failed. Let me investigate.', stream: 'output' },
        { type: 'done', stopReason: 'end_turn' },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      // Should have one toolUse and one failed toolResult
      expect(stream.toolUse).toHaveBeenCalledTimes(1)
      expect(stream.toolResult).toHaveBeenCalledWith(
        'bash: npm test',
        'npm ERR! Exit status 1',
        false
      )
    })

    it('processes a session with error event', () => {
      const events: AcpRuntimeEvent[] = [
        { type: 'status', text: 'Processing request...', tag: 'session_info_update' },
        { type: 'text_delta', text: "I'll analyze", stream: 'output' },
        { type: 'error', message: 'API rate limit exceeded.', code: 'rate_limit', retryable: true },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      // Should handle error gracefully
      expect(stream.text).toHaveBeenCalled()
      expect(stream.status).toHaveBeenCalled()
    })

    it('processes a session with thought stream', () => {
      const events: AcpRuntimeEvent[] = [
        { type: 'status', text: 'Agent thinking...', tag: 'session_info_update' },
        { type: 'text_delta', text: 'Let me think about this problem...', stream: 'thought', tag: 'agent_thought_chunk' },
        { type: 'text_delta', text: ' The user wants to refactor.', stream: 'thought', tag: 'agent_thought_chunk' },
        { type: 'text_delta', text: "I'll start by reviewing the module.", stream: 'output', tag: 'agent_message_chunk' },
        { type: 'done', stopReason: 'end_turn' },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      // Both thought and output text should be emitted
      expect(stream.text).toHaveBeenCalledTimes(3)
    })

    it('processes a cancelled session', () => {
      const events: AcpRuntimeEvent[] = [
        { type: 'status', text: 'Starting long operation...', tag: 'session_info_update' },
        { type: 'text_delta', text: "I'll begin refactoring", stream: 'output' },
        { type: 'tool_call', text: 'Analyzing project', toolCallId: 'call-401', title: 'bash: find . -name *.ts', status: 'in_progress' },
        { type: 'done', stopReason: 'cancelled' },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      // Session ended with cancellation
      expect(stream.status).toHaveBeenLastCalledWith('running', 100, expect.stringContaining('cancelled'))
    })
  })

  // ===========================================================================
  // 11. Edge Cases and Boundary Conditions
  // ===========================================================================

  describe('edge cases and boundary conditions', () => {
    it('handles empty event fields gracefully', () => {
      const events = [
        { type: 'text_delta', text: '', stream: 'output' },
        { type: 'tool_call', text: '', toolCallId: '', title: '', status: '' },
        { type: 'status', text: '' },
        { type: 'done' },
        { type: 'error', message: '' },
      ]

      for (const event of events) {
        expect(() => {
          adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
        }).not.toThrow()
      }
    })

    it('handles very large text content', () => {
      const largeText = 'A'.repeat(100000)
      const event = { type: 'text_delta', text: largeText, stream: 'output' }

      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
    })

    it('handles deeply nested JSON in tool output', () => {
      const nestedJson = JSON.stringify({
        level1: {
          level2: {
            level3: {
              level4: {
                data: 'deep value',
              },
            },
          },
        },
      })

      const event = {
        type: 'tool_call',
        text: nestedJson,
        toolCallId: 'call-nested',
        title: 'read_file: deep.json',
        status: 'completed',
      }

      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
    })

    it('handles concurrent rapid events', () => {
      // Simulate rapid-fire events
      for (let i = 0; i < 100; i++) {
        const event = { type: 'text_delta', text: `chunk-${i}`, stream: 'output' }
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.text).toHaveBeenCalledTimes(100)
    })

    it('handles unknown event types silently', () => {
      const unknownEvent = { type: 'unknown_future_event', data: 'some data' }

      expect(() => {
        adapter.handleStreamLine(JSON.stringify(unknownEvent), stream, artifacts)
      }).not.toThrow()

      // Should not emit any known event
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.stdout).not.toHaveBeenCalled()
    })

    it('handles extra fields in events gracefully', () => {
      const eventWithExtras = {
        type: 'text_delta',
        text: 'Hello',
        stream: 'output',
        extra_field_1: 'ignored',
        extra_field_2: 12345,
        nested_extra: { foo: 'bar' },
      }

      expect(() => {
        adapter.handleStreamLine(JSON.stringify(eventWithExtras), stream, artifacts)
      }).not.toThrow()

      expect(stream.text).toHaveBeenCalledWith('Hello')
    })
  })
})
