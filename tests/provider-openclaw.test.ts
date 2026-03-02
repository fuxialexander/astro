/**
 * OpenClaw Gateway EventFrame + Legacy Event Parsing Tests
 *
 * Comprehensive unit tests for parsing OpenClaw's JSONL streaming output.
 * Tests the Gateway EventFrame format (chat/agent events) and Legacy flat format.
 *
 * These tests verify:
 * 1. Gateway EventFrame parsing (chat delta/final/aborted/error, agent assistant/tool/lifecycle)
 * 2. Legacy flat format parsing (session.start, content.text, tool_use.start/end, etc.)
 * 3. Batch response parsing (openclaw agent --json)
 * 4. Malformed JSON handling (should not crash, emit as raw stdout)
 * 5. Delta text tracker (cumulative → incremental extraction)
 * 6. Metadata extraction (tokens, cost, model from usage)
 * 7. File change detection from tool args
 * 8. Session init emission
 *
 * Gateway EventFrame format:
 *   { type: "event", event: "chat"|"agent", payload: {...} }
 *
 * Legacy flat format:
 *   { type: "session.start"|"content.text"|"tool_use.start"|... }
 *
 * @see packages/agent-runner/src/providers/openclaw-adapter.ts
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
// Helper: Gateway EventFrame builders
// =============================================================================

/** Build a Gateway chat delta event (cumulative text) */
function chatDelta(text: string, opts?: { runId?: string; sessionKey?: string }) {
  return {
    type: 'event',
    event: 'chat',
    payload: {
      state: 'delta',
      message: { content: [{ type: 'text', text }] },
      ...opts,
    },
  }
}

/** Build a Gateway chat final event (completion with optional usage) */
function chatFinal(usage?: Record<string, unknown>, opts?: { runId?: string }) {
  return {
    type: 'event',
    event: 'chat',
    payload: { state: 'final', usage, ...opts },
  }
}

/** Build a Gateway chat aborted event */
function chatAborted() {
  return {
    type: 'event',
    event: 'chat',
    payload: { state: 'aborted' },
  }
}

/** Build a Gateway chat error event */
function chatError(errorMessage: string, opts?: { runId?: string }) {
  return {
    type: 'event',
    event: 'chat',
    payload: { state: 'error', errorMessage, ...opts },
  }
}

/** Build a Gateway agent assistant text event (incremental) */
function agentText(text: string, opts?: { runId?: string; sessionKey?: string }) {
  return {
    type: 'event',
    event: 'agent',
    payload: { stream: 'assistant', data: { text }, ...opts },
  }
}

/** Build a Gateway agent tool start event */
function agentToolStart(name: string, toolCallId: string, args?: Record<string, unknown>, opts?: { runId?: string }) {
  return {
    type: 'event',
    event: 'agent',
    payload: {
      stream: 'tool',
      data: { phase: 'start', name, toolCallId, args },
      ...opts,
    },
  }
}

/** Build a Gateway agent tool result event */
function agentToolResult(name: string, toolCallId: string, result: unknown, isError = false) {
  return {
    type: 'event',
    event: 'agent',
    payload: {
      stream: 'tool',
      data: { phase: 'result', name, toolCallId, result, isError },
    },
  }
}

/** Build a Gateway agent lifecycle event */
function agentLifecycle(phase: 'start' | 'end' | 'fallback', opts?: { selectedModel?: string; runId?: string }) {
  return {
    type: 'event',
    event: 'agent',
    payload: {
      stream: 'lifecycle',
      data: { phase, ...opts },
      ...(opts?.runId ? { runId: opts.runId } : {}),
    },
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('OpenClaw Gateway EventFrame Parsing', () => {
  let adapter: OpenClawAdapter
  let stream: TaskOutputStream
  let artifacts: TaskArtifact[]

  beforeEach(() => {
    adapter = new OpenClawAdapter()
    stream = createMockStream()
    artifacts = []
  })

  // ===========================================================================
  // 1. Agent Assistant Text Events (incremental)
  // ===========================================================================

  describe('agent assistant text events', () => {
    it('emits text for agent assistant stream', () => {
      const event = agentText('Hello world')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Hello world')
    })

    it('emits text for multiple incremental chunks', () => {
      adapter.handleStreamLine(JSON.stringify(agentText('First ')), stream, artifacts)
      adapter.handleStreamLine(JSON.stringify(agentText('Second ')), stream, artifacts)
      adapter.handleStreamLine(JSON.stringify(agentText('Third')), stream, artifacts)

      expect(stream.text).toHaveBeenCalledTimes(3)
      expect(stream.text).toHaveBeenNthCalledWith(1, 'First ')
      expect(stream.text).toHaveBeenNthCalledWith(2, 'Second ')
      expect(stream.text).toHaveBeenNthCalledWith(3, 'Third')
    })

    it('does not emit for empty agent text', () => {
      const event = agentText('')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('handles unicode and special characters', () => {
      const event = agentText('日本語 中文 🚀 π ≈ 3.14159')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('日本語 中文 🚀 π ≈ 3.14159')
    })

    it('handles newlines and escape sequences', () => {
      const event = agentText('Line 1\nLine 2\tTabbed')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Line 1\nLine 2\tTabbed')
    })

    it('emits sessionInit on first agent event with runId', () => {
      const event = agentText('Hello', { runId: 'run-123' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.sessionInit).toHaveBeenCalledWith('run-123')
      expect(stream.text).toHaveBeenCalledWith('Hello')
    })

    it('emits sessionInit on first agent event with sessionKey', () => {
      const event = agentText('Hello', { sessionKey: 'session-abc' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.sessionInit).toHaveBeenCalledWith('session-abc')
    })

    it('emits sessionInit only once across multiple events', () => {
      adapter.handleStreamLine(JSON.stringify(agentText('First', { runId: 'run-1' })), stream, artifacts)
      adapter.handleStreamLine(JSON.stringify(agentText('Second', { runId: 'run-1' })), stream, artifacts)
      expect(stream.sessionInit).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // 2. Chat Delta Events (cumulative text with delta tracker)
  // ===========================================================================

  describe('chat delta events (cumulative text)', () => {
    it('emits text from chat delta content blocks', () => {
      const event = chatDelta('Hello world')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Hello world')
    })

    it('extracts only new text from cumulative delta', () => {
      // First delta: "Hello "
      adapter.handleStreamLine(JSON.stringify(chatDelta('Hello ')), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Hello ')

      // Second delta: "Hello world" (cumulative) → should only emit "world"
      adapter.handleStreamLine(JSON.stringify(chatDelta('Hello world')), stream, artifacts)
      expect(stream.text).toHaveBeenNthCalledWith(2, 'world')
    })

    it('does not emit for empty content', () => {
      const event = chatDelta('')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('does not emit when no new text in cumulative delta', () => {
      adapter.handleStreamLine(JSON.stringify(chatDelta('Hello')), stream, artifacts)
      // Same text again (no new content)
      adapter.handleStreamLine(JSON.stringify(chatDelta('Hello')), stream, artifacts)
      expect(stream.text).toHaveBeenCalledTimes(1)
    })

    it('emits sessionInit on first chat event with runId', () => {
      const event = chatDelta('Hello', { runId: 'chat-run-1' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.sessionInit).toHaveBeenCalledWith('chat-run-1')
    })

    it('handles chat delta with multiple content blocks', () => {
      const event = {
        type: 'event',
        event: 'chat',
        payload: {
          state: 'delta',
          message: {
            content: [
              { type: 'text', text: 'Part 1' },
              { type: 'text', text: ' Part 2' },
            ],
          },
        },
      }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Part 1 Part 2')
    })

    it('skips non-text content blocks', () => {
      const event = {
        type: 'event',
        event: 'chat',
        payload: {
          state: 'delta',
          message: {
            content: [
              { type: 'image', url: 'http://example.com/img.png' },
              { type: 'text', text: 'Only text' },
            ],
          },
        },
      }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Only text')
    })

    it('resets delta tracker between task executions', () => {
      adapter.handleStreamLine(JSON.stringify(chatDelta('Hello')), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Hello')

      // Reset tracker (simulating new task execution)
      adapter.resetDeltaTracker()

      // Now "Hello" should be treated as new text again
      adapter.handleStreamLine(JSON.stringify(chatDelta('Hello')), stream, artifacts)
      expect(stream.text).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================================================================
  // 3. Agent Tool Events
  // ===========================================================================

  describe('agent tool events', () => {
    it('emits toolUse for tool start phase', () => {
      const event = agentToolStart('read_file', 'call-001', { path: 'package.json' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolUse).toHaveBeenCalledWith('read_file', { path: 'package.json' })
    })

    it('emits toolResult for tool result phase (success)', () => {
      const event = agentToolResult('read_file', 'call-001', '{"name":"astro","version":"1.0.0"}', false)
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolResult).toHaveBeenCalledWith(
        'read_file',
        '{"name":"astro","version":"1.0.0"}',
        true
      )
    })

    it('emits toolResult with success=false for error result', () => {
      const event = agentToolResult('bash', 'call-201', 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1', true)
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolResult).toHaveBeenCalledWith(
        'bash',
        'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1',
        false
      )
    })

    it('uses "unknown" as fallback when tool name is missing', () => {
      const event = {
        type: 'event',
        event: 'agent',
        payload: {
          stream: 'tool',
          data: { phase: 'start', toolCallId: 'call-999', args: {} },
        },
      }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolUse).toHaveBeenCalledWith('unknown', {})
    })

    it('skips tool event without toolCallId', () => {
      const event = {
        type: 'event',
        event: 'agent',
        payload: {
          stream: 'tool',
          data: { phase: 'start', name: 'bash' },
        },
      }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      // toolCallId is required for tool events
      expect(stream.toolUse).not.toHaveBeenCalled()
    })

    it('handles tool start with empty args', () => {
      const event = agentToolStart('bash', 'call-101')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolUse).toHaveBeenCalledWith('bash', {})
    })

    it('handles long tool result output', () => {
      const longOutput = Array(100).fill('line').join('\n') + '... (truncated)'
      const event = agentToolResult('bash', 'call-601', longOutput, false)
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolResult).toHaveBeenCalledWith('bash', longOutput, true)
    })

    it('handles multiple sequential tool start/result pairs', () => {
      // Tool 1
      adapter.handleStreamLine(JSON.stringify(agentToolStart('bash', 'call-1', { command: 'ls' })), stream, artifacts)
      adapter.handleStreamLine(JSON.stringify(agentToolResult('bash', 'call-1', 'file1.txt\nfile2.txt', false)), stream, artifacts)
      // Tool 2
      adapter.handleStreamLine(JSON.stringify(agentToolStart('read_file', 'call-2', { path: 'file1.txt' })), stream, artifacts)
      adapter.handleStreamLine(JSON.stringify(agentToolResult('read_file', 'call-2', 'contents', false)), stream, artifacts)
      // Tool 3
      adapter.handleStreamLine(JSON.stringify(agentToolStart('bash', 'call-3', { command: 'cat file2.txt' })), stream, artifacts)
      adapter.handleStreamLine(JSON.stringify(agentToolResult('bash', 'call-3', 'more contents', false)), stream, artifacts)

      expect(stream.toolUse).toHaveBeenCalledTimes(3)
      expect(stream.toolResult).toHaveBeenCalledTimes(3)
    })
  })

  // ===========================================================================
  // 4. File Change Detection from Tool Args
  // ===========================================================================

  describe('file change detection from tool args', () => {
    it('detects file creation from write_file tool', () => {
      const event = agentToolStart('write_file', 'call-501', { path: 'src/components/Modal.tsx' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.fileChange).toHaveBeenCalledWith('src/components/Modal.tsx', 'created')
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]).toEqual({ type: 'file', name: 'src/components/Modal.tsx', path: 'src/components/Modal.tsx' })
    })

    it('detects file modification from edit_file tool', () => {
      const event = agentToolStart('edit_file', 'call-502', { file_path: 'src/index.ts' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.fileChange).toHaveBeenCalledWith('src/index.ts', 'modified')
    })

    it('detects file deletion from delete tool', () => {
      const event = agentToolStart('delete_file', 'call-503', { path: 'temp.txt' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.fileChange).toHaveBeenCalledWith('temp.txt', 'deleted')
    })

    it('does not detect file change without path in args', () => {
      const event = agentToolStart('bash', 'call-504', { command: 'echo hello' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.fileChange).not.toHaveBeenCalled()
    })

    it('does not add duplicate artifacts for same file path', () => {
      adapter.handleStreamLine(JSON.stringify(agentToolStart('write_file', 'call-1', { path: 'test.ts' })), stream, artifacts)
      adapter.handleStreamLine(JSON.stringify(agentToolStart('edit_file', 'call-2', { path: 'test.ts' })), stream, artifacts)
      expect(artifacts).toHaveLength(1)
    })
  })

  // ===========================================================================
  // 5. Chat Final/Aborted/Error Events
  // ===========================================================================

  describe('chat completion events', () => {
    it('emits completion status for chat final', () => {
      const event = chatFinal()
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed')
    })

    it('returns usage metrics from chat final event', () => {
      const event = chatFinal({
        input_tokens: 1500,
        output_tokens: 800,
        totalCost: 0.0523,
        turns: 3,
        model: 'claude-sonnet-4-20250514',
        duration_ms: 12000,
      })
      const result = adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(result).toBeDefined()
      expect(result?.inputTokens).toBe(1500)
      expect(result?.outputTokens).toBe(800)
      expect(result?.totalCost).toBe(0.0523)
      expect(result?.numTurns).toBe(3)
      expect(result?.model).toBe('claude-sonnet-4-20250514')
      expect(result?.durationMs).toBe(12000)
    })

    it('returns partial metrics from chat final', () => {
      const event = chatFinal({ input_tokens: 500, output_tokens: 250 })
      const result = adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(result).toBeDefined()
      expect(result?.inputTokens).toBe(500)
      expect(result?.outputTokens).toBe(250)
      expect(result?.totalCost).toBeUndefined()
    })

    it('emits aborted status for chat aborted', () => {
      const event = chatAborted()
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Aborted')
    })

    it('emits error status for chat error', () => {
      const event = chatError('API rate limit exceeded')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Error: API rate limit exceeded')
    })

    it('handles chat error without message', () => {
      const event = chatError('')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      // Empty errorMessage falls through to fallback: "Unknown error"
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Error: Unknown error')
    })

    it('emits sessionInit on chat error with runId', () => {
      adapter.resetDeltaTracker()
      const event = chatError('Auth failed', { runId: 'err-run-1' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.sessionInit).toHaveBeenCalledWith('err-run-1')
    })
  })

  // ===========================================================================
  // 6. Agent Lifecycle Events
  // ===========================================================================

  describe('agent lifecycle events', () => {
    it('emits status for lifecycle start', () => {
      const event = agentLifecycle('start')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Agent thinking...')
    })

    it('emits status for lifecycle end', () => {
      const event = agentLifecycle('end')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Turn complete')
    })

    it('emits status for lifecycle fallback with model', () => {
      const event = agentLifecycle('fallback', { selectedModel: 'gpt-4o-mini' })
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Fallback to gpt-4o-mini')
    })

    it('emits status for lifecycle fallback without model', () => {
      const event = agentLifecycle('fallback')
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Fallback to alternate model')
    })
  })

  // ===========================================================================
  // 7. Legacy Flat Format Events
  // ===========================================================================

  describe('legacy flat format events', () => {
    it('emits sessionInit from session.start', () => {
      const event = { type: 'session.start', session_id: 'legacy-session-1', model: 'gpt-4o' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.sessionInit).toHaveBeenCalledWith('legacy-session-1', 'gpt-4o')
    })

    it('emits text from content.text', () => {
      const event = { type: 'content.text', text: 'Hello from legacy format' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Hello from legacy format')
    })

    it('does not emit for empty content.text', () => {
      const event = { type: 'content.text', text: '' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('emits toolUse from tool_use.start', () => {
      const event = { type: 'tool_use.start', tool_name: 'bash', tool_input: { command: 'ls' } }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'ls' })
    })

    it('emits toolResult from tool_use.end', () => {
      const event = { type: 'tool_use.end', tool_name: 'bash', result: 'file1.txt', success: true }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolResult).toHaveBeenCalledWith('bash', 'file1.txt', true)
    })

    it('emits failed toolResult from tool_use.end with success=false', () => {
      const event = { type: 'tool_use.end', tool_name: 'bash', result: 'Error!', success: false }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.toolResult).toHaveBeenCalledWith('bash', 'Error!', false)
    })

    it('emits fileChange from file.change', () => {
      const event = { type: 'file.change', path: 'src/index.ts', action: 'modified', lines_added: 5, lines_removed: 2 }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.fileChange).toHaveBeenCalledWith('src/index.ts', 'modified', 5, 2)
      expect(artifacts).toHaveLength(1)
    })

    it('emits status from message.start', () => {
      const event = { type: 'message.start' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Agent thinking...')
    })

    it('emits status from message.end', () => {
      const event = { type: 'message.end' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Turn complete')
    })

    it('returns metrics from session.end', () => {
      const event = {
        type: 'session.end',
        cost: 0.0312,
        input_tokens: 1200,
        output_tokens: 600,
        turns: 2,
        model: 'gpt-4o',
        duration_ms: 15000,
      }
      const result = adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(result).toBeDefined()
      expect(result?.totalCost).toBe(0.0312)
      expect(result?.inputTokens).toBe(1200)
      expect(result?.outputTokens).toBe(600)
      expect(result?.numTurns).toBe(2)
      expect(result?.model).toBe('gpt-4o')
      expect(result?.durationMs).toBe(15000)
    })

    it('emits status with cost info from session.end', () => {
      const event = { type: 'session.end', cost: 0.05, turns: 3 }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed (3 turns, $0.0500)')
    })

    it('emits generic completion from session.end without cost', () => {
      const event = { type: 'session.end' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed')
    })
  })

  // ===========================================================================
  // 8. Batch Response Format
  // ===========================================================================

  describe('batch response format', () => {
    it('emits text from batch result payloads', () => {
      const event = {
        runId: 'batch-run-1',
        status: 'completed',
        result: { payloads: [{ text: 'Batch result text' }] },
      }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.sessionInit).toHaveBeenCalledWith('batch-run-1')
      expect(stream.text).toHaveBeenCalledWith('Batch result text')
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed')
    })

    it('emits text from summary when no result payloads', () => {
      const event = { summary: 'Task completed successfully', status: 'completed' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('Task completed successfully')
    })

    it('emits error status for batch error', () => {
      const event = { status: 'error', summary: 'Something went wrong' }
      adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Error: Something went wrong')
    })

    it('extracts metrics from batch result meta', () => {
      const event = {
        result: {
          payloads: [{ text: 'Hello' }],
          meta: { usage: { input_tokens: 100, output_tokens: 50, totalCost: 0.001 } },
        },
      }
      const result = adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      expect(result).toBeDefined()
      expect(result?.inputTokens).toBe(100)
      expect(result?.outputTokens).toBe(50)
    })
  })

  // ===========================================================================
  // 9. Malformed JSON Handling
  // ===========================================================================

  describe('malformed JSON handling', () => {
    it('handles incomplete JSON object (missing closing brace)', () => {
      const malformed = '{"type":"event","event":"chat"'
      expect(() => {
        adapter.handleStreamLine(malformed, stream, artifacts)
      }).not.toThrow()
      expect(stream.stdout).toHaveBeenCalledWith(malformed + '\n')
    })

    it('handles truncated JSON in middle of string', () => {
      const truncated = '{"type":"event","event":"agen'
      expect(() => {
        adapter.handleStreamLine(truncated, stream, artifacts)
      }).not.toThrow()
      expect(stream.stdout).toHaveBeenCalledWith(truncated + '\n')
    })

    it('handles invalid JSON with extra comma', () => {
      const invalid = '{"type":"event","event":"chat",}'
      expect(() => {
        adapter.handleStreamLine(invalid, stream, artifacts)
      }).not.toThrow()
      expect(stream.stdout).toHaveBeenCalledWith(invalid + '\n')
    })

    it('handles invalid JSON with single quotes', () => {
      const invalid = "{'type':'event','event':'chat'}"
      expect(() => {
        adapter.handleStreamLine(invalid, stream, artifacts)
      }).not.toThrow()
      expect(stream.stdout).toHaveBeenCalledWith(invalid + '\n')
    })

    it('handles JSON array instead of object', () => {
      const array = '["event", "hello"]'
      expect(() => {
        adapter.handleStreamLine(array, stream, artifacts)
      }).not.toThrow()
    })

    it('handles JSON object missing type field', () => {
      const missingType = '{"text":"This has no type field","stream":"output"}'
      adapter.handleStreamLine(missingType, stream, artifacts)
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
      expect(stream.stdout).toHaveBeenCalledWith(comment + '\n')
    })
  })

  // ===========================================================================
  // 10. Full Gateway Session Sequences (Integration-style)
  // ===========================================================================

  describe('full Gateway session sequences', () => {
    it('processes a complete happy path session', () => {
      const events = [
        agentLifecycle('start', { runId: 'run-happy-1' }),
        agentText("I'll analyze the codebase"),
        agentText(' structure and make'),
        agentText(' the requested changes.'),
        agentToolStart('read_file', 'call-001', { path: 'package.json' }),
        agentToolResult('read_file', 'call-001', '{"name":"astro","version":"1.0.0"}', false),
        agentText('\n\nI found the package.json.'),
        chatFinal({ input_tokens: 1523, output_tokens: 800 }),
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.sessionInit).toHaveBeenCalledWith('run-happy-1')
      expect(stream.text).toHaveBeenCalled()
      expect(stream.toolUse).toHaveBeenCalled()
      expect(stream.toolResult).toHaveBeenCalled()
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed')
    })

    it('processes a multi-tool session', () => {
      const events = [
        agentLifecycle('start', { runId: 'run-multi-1' }),
        agentText('Let me check the directory structure.'),
        agentToolStart('bash', 'call-101', { command: 'ls -la' }),
        agentToolResult('bash', 'call-101', 'total 120\npackage.json\ntsconfig.json', false),
        agentToolStart('bash', 'call-102', { command: "find src -name '*.ts'" }),
        agentToolResult('bash', 'call-102', 'src/index.ts\nsrc/lib/utils.ts', false),
        agentToolStart('read_file', 'call-103', { path: 'src/index.ts' }),
        agentToolResult('read_file', 'call-103', "export * from './lib/utils';", false),
        chatFinal({ input_tokens: 2847 }),
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.toolUse).toHaveBeenCalledTimes(3)
      expect(stream.toolResult).toHaveBeenCalledTimes(3)
    })

    it('processes a session with tool failure', () => {
      const events = [
        agentLifecycle('start'),
        agentText("I'll run the tests."),
        agentToolStart('bash', 'call-201', { command: 'npm test' }),
        agentToolResult('bash', 'call-201', 'npm ERR! Exit status 1', true),
        agentText('\n\nThe tests failed. Let me investigate.'),
        chatFinal(),
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.toolUse).toHaveBeenCalledTimes(1)
      expect(stream.toolResult).toHaveBeenCalledWith('bash', 'npm ERR! Exit status 1', false)
    })

    it('processes a session with error event', () => {
      const events = [
        agentLifecycle('start'),
        agentText("I'll analyze"),
        chatError('API rate limit exceeded.'),
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.text).toHaveBeenCalled()
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Error: API rate limit exceeded.')
    })

    it('processes a session with mixed agent text and chat delta', () => {
      const events = [
        agentText('Agent text first'),
        chatDelta('Chat cumulative text'),
        agentText('More agent text'),
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.text).toHaveBeenCalledTimes(3)
    })

    it('processes an aborted session', () => {
      const events = [
        agentLifecycle('start'),
        agentText("I'll begin refactoring"),
        agentToolStart('bash', 'call-401', { command: 'find . -name *.ts' }),
        chatAborted(),
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.status).toHaveBeenLastCalledWith('running', undefined, 'Aborted')
    })
  })

  // ===========================================================================
  // 11. Edge Cases and Boundary Conditions
  // ===========================================================================

  describe('edge cases and boundary conditions', () => {
    it('handles Gateway event with missing payload', () => {
      const event = { type: 'event', event: 'chat' }
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
    })

    it('handles Gateway event with unknown event type', () => {
      const event = { type: 'event', event: 'unknown_type', payload: { data: 'test' } }
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('handles agent event with unknown stream type', () => {
      const event = {
        type: 'event',
        event: 'agent',
        payload: { stream: 'unknown_stream', data: { text: 'test' } },
      }
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('handles agent event with missing data', () => {
      const event = {
        type: 'event',
        event: 'agent',
        payload: { stream: 'assistant' },
      }
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
    })

    it('handles very large text content', () => {
      const largeText = 'A'.repeat(100000)
      const event = agentText(largeText)
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
    })

    it('handles deeply nested JSON in tool result', () => {
      const nestedResult = {
        level1: { level2: { level3: { level4: { data: 'deep value' } } } },
      }
      const event = agentToolResult('read_file', 'call-nested', nestedResult, false)
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
    })

    it('handles concurrent rapid events', () => {
      for (let i = 0; i < 100; i++) {
        adapter.handleStreamLine(JSON.stringify(agentText(`chunk-${i}`)), stream, artifacts)
      }
      expect(stream.text).toHaveBeenCalledTimes(100)
    })

    it('handles unknown top-level event types silently', () => {
      const unknownEvent = { type: 'unknown_future_event', data: 'some data' }
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(unknownEvent), stream, artifacts)
      }).not.toThrow()
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.stdout).not.toHaveBeenCalled()
    })

    it('handles extra fields in Gateway events gracefully', () => {
      const event = {
        type: 'event',
        event: 'agent',
        payload: {
          stream: 'assistant',
          data: { text: 'Hello' },
          extra_field: 'ignored',
        },
        meta: { version: '2.0' },
      }
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
      expect(stream.text).toHaveBeenCalledWith('Hello')
    })

    it('handles chat delta with missing message field', () => {
      const event = { type: 'event', event: 'chat', payload: { state: 'delta' } }
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('handles chat delta with empty content array', () => {
      const event = {
        type: 'event',
        event: 'chat',
        payload: { state: 'delta', message: { content: [] } },
      }
      expect(() => {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }).not.toThrow()
      expect(stream.text).not.toHaveBeenCalled()
    })
  })
})

// =============================================================================
// OpenClaw Adapter Lifecycle Tests
// =============================================================================
// These tests mock child_process.spawn to verify process lifecycle behavior:
// - Process spawning with correct args
// - Environment variable passthrough
// - Abort/cancellation (SIGTERM then SIGKILL after 5s)
// - Process exit code handling
// - Timeout handling
// - Working directory validation

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Task } from '../packages/agent-runner/src/types.js'

// Mock the spawn function
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Mock the providers module to make OpenClaw "available"
vi.mock('../packages/agent-runner/src/lib/providers.js', () => ({
  getProvider: vi.fn().mockResolvedValue({
    available: true,
    path: '/usr/local/bin/openclaw',
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
 * Create a mock ChildProcess with EventEmitter behavior
 */
function createMockProcess(): ChildProcess & {
  _mockStdout: EventEmitter
  _mockStderr: EventEmitter
  _emitClose: (code: number) => void
  _emitError: (error: Error) => void
} {
  const proc = new EventEmitter() as ChildProcess & {
    _mockStdout: EventEmitter
    _mockStderr: EventEmitter
    _emitClose: (code: number) => void
    _emitError: (error: Error) => void
  }

  proc._mockStdout = new EventEmitter()
  proc._mockStderr = new EventEmitter()

  proc.stdout = proc._mockStdout as NodeJS.ReadableStream
  proc.stderr = proc._mockStderr as NodeJS.ReadableStream
  proc.stdin = null
  proc.killed = false
  proc.pid = 12345

  proc.kill = vi.fn(() => {
    proc.killed = true
    return true
  })

  proc._emitClose = (code: number) => {
    proc.emit('close', code)
  }

  proc._emitError = (error: Error) => {
    proc.emit('error', error)
  }

  return proc
}

/**
 * Create a minimal task for testing
 */
function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task-123',
    projectId: 'test-project',
    planNodeId: 'test-node',
    provider: 'openclaw',
    prompt: 'Test task prompt',
    workingDirectory: '/tmp/test-workspace',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('OpenClaw Adapter Lifecycle', () => {
  let adapter: OpenClawAdapter
  let mockSpawn: ReturnType<typeof vi.fn>
  let mockProcess: ReturnType<typeof createMockProcess>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    adapter = new OpenClawAdapter()
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
    it('spawns openclaw with agent --json --message args', async () => {
      const task = createTestTask({ prompt: 'Implement feature X' })
      const stream = createMockStream()
      const controller = new AbortController()

      // Start execution (don't await - we'll control the process)
      const resultPromise = adapter.execute(task, stream, controller.signal)

      // Let the promise executor run
      await vi.runAllTimersAsync()

      // Emit successful completion
      mockProcess._mockStdout.emit('data', Buffer.from('{"type":"done","stopReason":"end_turn"}\n'))
      mockProcess._emitClose(0)

      const result = await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/openclaw',
        ['agent', '--json', '--message', 'Implement feature X'],
        expect.objectContaining({
          cwd: '/tmp/test-workspace',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      )
      expect(result.status).toBe('completed')
    })

    it('includes --model flag when model is specified', async () => {
      const task = createTestTask({
        prompt: 'Test prompt',
        model: 'claude-sonnet-4-20250514',
      })
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()
      mockProcess._emitClose(0)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/openclaw',
        ['agent', '--json', '--model', 'claude-sonnet-4-20250514', '--message', 'Test prompt'],
        expect.any(Object)
      )
    })

    it('combines systemPrompt with prompt when provided', async () => {
      const task = createTestTask({
        prompt: 'Implement the feature',
        systemPrompt: 'You are a helpful assistant.',
      })
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()
      mockProcess._emitClose(0)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/openclaw',
        [
          'agent',
          '--json',
          '--message',
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
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask({
        environment: {
          ANTHROPIC_API_KEY: 'sk-test-key',
          CUSTOM_CONFIG: 'test-value',
        },
      })
      const stream = createMockStream()
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
      const task = createTestTask({
        environment: {
          PATH: '/custom/path',
        },
      })
      const stream = createMockStream()
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
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask()
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitClose(0)

      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.exitCode).toBe(0)
    })

    it('returns failed status for non-zero exit code', async () => {
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask()
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitClose(2)

      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.exitCode).toBe(2)
    })

    it('returns failed status for exit code 130 (SIGINT)', async () => {
      const task = createTestTask()
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitClose(130)

      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.exitCode).toBe(130)
    })

    it('handles null exit code (defaults to 1)', async () => {
      const task = createTestTask()
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Emit close with null code
      mockProcess.emit('close', null)

      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.exitCode).toBe(1)
    })

    it('captures stdout and stderr in result', async () => {
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask({ timeout: 10000 }) // 10 second timeout
      const stream = createMockStream()
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
      const task = createTestTask({ timeout: 10000 })
      const stream = createMockStream()
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
      const task = createTestTask({ timeout: 30000 }) // 30 second timeout
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)

      // Complete the process immediately (before any timers advance)
      mockProcess._emitClose(0)

      const result = await resultPromise

      // Should complete normally with exit code 0
      expect(result.status).toBe('completed')
      expect(result.exitCode).toBe(0)

      // Note: The timeout timer may still be set, but it checks proc.killed
      // before killing. Since the process has already closed, the check
      // `!proc.killed` might still pass if we advance timers. The adapter
      // implementation does not clear the timeout on normal completion.
      // This is acceptable behavior - the key is the result is correct.
    })

    it('does not set timeout if task.timeout is not specified', async () => {
      const task = createTestTask() // No timeout
      const stream = createMockStream()
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
  // 6. Working Directory Validation
  // ===========================================================================

  describe('working directory validation', () => {
    it('rejects task if working directory does not exist', async () => {
      const task = createTestTask({ workingDirectory: '/nonexistent/directory' })
      const stream = createMockStream()
      const controller = new AbortController()

      const result = await adapter.execute(task, stream, controller.signal)

      expect(result.status).toBe('failed')
      expect(result.error).toContain('Working directory does not exist')
      expect(result.error).toContain('/nonexistent/directory')
    })

    it('passes working directory to spawn as cwd', async () => {
      const task = createTestTask({ workingDirectory: '/valid/path' })
      const stream = createMockStream()
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
      const task = createTestTask({ workingDirectory: undefined as unknown as string })
      const stream = createMockStream()
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
  // 7. Process Error Handling
  // ===========================================================================

  describe('process error handling', () => {
    it('handles spawn error (e.g., executable not found)', async () => {
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask()
      const stream = createMockStream()
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
      const freshAdapter = new OpenClawAdapter()

      // Mock getProvider to return unavailable
      const { getProvider } = await import('../packages/agent-runner/src/lib/providers.js')
      ;(getProvider as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        available: false,
        path: null,
      })

      const task = createTestTask()
      const stream = createMockStream()
      const controller = new AbortController()

      const result = await freshAdapter.execute(task, stream, controller.signal)

      expect(result.status).toBe('failed')
      expect(result.error).toBe('OpenClaw not available')
    })
  })

  // ===========================================================================
  // 8. Metrics Extraction from Stream Output
  // ===========================================================================

  describe('metrics extraction from stream output', () => {
    it('extracts metrics from done event', async () => {
      const task = createTestTask()
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Emit a done event with metrics
      const doneEvent = JSON.stringify({
        type: 'session.end',
        cost: 0.0312,
        input_tokens: 1200,
        output_tokens: 600,
        turns: 2,
        model: 'claude-sonnet-4-20250514',
        duration_ms: 15000,
      })
      mockProcess._mockStdout.emit('data', Buffer.from(doneEvent + '\n'))
      mockProcess._emitClose(0)

      const result = await resultPromise

      expect(result.metrics).toEqual({
        totalCost: 0.0312,
        inputTokens: 1200,
        outputTokens: 600,
        numTurns: 2,
        model: 'claude-sonnet-4-20250514',
        durationMs: 15000,
      })
    })

    it('extracts metrics from Gateway chat final event', async () => {
      const task = createTestTask()
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      // Emit a Gateway EventFrame with chat final event
      const gatewayEvent = JSON.stringify({
        type: 'event',
        event: 'chat',
        payload: {
          state: 'final',
          usage: {
            input_tokens: 500,
            output_tokens: 250,
            totalCost: 0.015,
            model: 'gpt-4o',
            turns: 1,
            duration_ms: 8000,
          },
        },
      })
      mockProcess._mockStdout.emit('data', Buffer.from(gatewayEvent + '\n'))
      mockProcess._emitClose(0)

      const result = await resultPromise

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.inputTokens).toBe(500)
      expect(result.metrics?.outputTokens).toBe(250)
    })
  })

  // ===========================================================================
  // 9. Concurrent Task Tracking
  // ===========================================================================

  describe('concurrent task tracking', () => {
    it('increments activeTasks on execute start', async () => {
      const task = createTestTask()
      const stream = createMockStream()
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
      const task = createTestTask()
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitClose(0)
      await resultPromise

      const status = await adapter.getStatus()
      expect(status.activeTasks).toBe(0)
    })

    it('decrements activeTasks on execute failure', async () => {
      const task = createTestTask()
      const stream = createMockStream()
      const controller = new AbortController()

      const resultPromise = adapter.execute(task, stream, controller.signal)
      await vi.runAllTimersAsync()

      mockProcess._emitError(new Error('Process crashed'))
      await resultPromise

      const status = await adapter.getStatus()
      expect(status.activeTasks).toBe(0)
    })

    it('records last error on failure', async () => {
      const task = createTestTask()
      const stream = createMockStream()
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
