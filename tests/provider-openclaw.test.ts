/**
 * OpenClaw Provider — Comprehensive Unit Tests
 *
 * Self-contained tests for the OpenClaw JSONL event parsing logic.
 * The OpenClaw adapter lives in packages/agent-runner (git submodule),
 * so we inline the parsing function + types here for independent testing.
 *
 * Tests cover:
 * 1. Each JSONL event type parsing (session.start, content.text, tool_use.start,
 *    tool_use.end, file.change, message.start, message.end, session.end)
 * 2. Malformed JSON handling (should not crash, emits to stdout)
 * 3. Incomplete line buffering (split chunks across data events)
 * 4. Event type mapping to StreamEvent (text(), toolUse(), toolResult(), sessionInit())
 * 5. Metadata extraction (tokens, cost, model from session.end event)
 * 6. Uses vi.fn() mocks for TaskOutputStream
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Inlined types from packages/agent-runner (submodule may not be initialized)
// ============================================================================

type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'

interface TaskOutputStream {
  stdout: (data: string) => void
  stderr: (data: string) => void
  status: (status: TaskStatus, progress?: number, message?: string) => void
  toolTrace: (toolName: string, toolInput?: unknown, toolResult?: unknown, success?: boolean) => void
  text: (data: string) => void
  toolUse: (toolName: string, toolInput: unknown) => void
  toolResult: (toolName: string, result: unknown, success: boolean) => void
  fileChange: (path: string, action: 'created' | 'modified' | 'deleted', linesAdded?: number, linesRemoved?: number, diff?: string) => void
  sessionInit: (sessionId: string, model?: string) => void
  approvalRequest: (question: string, options: string[]) => Promise<{ answered: boolean; answer?: string; message?: string }>
}

interface TaskArtifact {
  type: 'file' | 'log' | 'metric'
  name: string
  path?: string
  content?: string
  metadata?: Record<string, unknown>
}

interface TaskMetrics {
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  totalCost?: number
  model?: string
  numTurns?: number
}

// ============================================================================
// Inlined handleStreamLine from openclaw-adapter.ts
// (source of truth: packages/agent-runner/src/providers/openclaw-adapter.ts)
// ============================================================================

/**
 * Handle a single JSONL line from OpenClaw's RPC output.
 *
 * OpenClaw JSONL event types:
 * - session.start     → sessionInit
 * - content.text      → text output
 * - tool_use.start    → toolUse
 * - tool_use.end      → toolResult
 * - file.change       → fileChange
 * - message.start     → status update (agent thinking)
 * - message.end       → status update (turn complete)
 * - session.end       → metrics extraction
 *
 * Returns metrics if a session.end event is processed.
 */
function handleStreamLine(
  line: string,
  stream: TaskOutputStream,
  artifacts: TaskArtifact[],
): TaskMetrics | undefined {
  try {
    const event = JSON.parse(line) as Record<string, unknown>
    const type = event.type as string

    switch (type) {
      case 'session.start': {
        const sessionId = event.session_id as string | undefined
        const model = event.model as string | undefined
        if (sessionId) {
          stream.sessionInit(sessionId, model)
        }
        break
      }

      case 'message.start': {
        stream.status('running', undefined, 'Agent thinking...')
        break
      }

      case 'content.text': {
        const text = event.text as string | undefined
        if (text) {
          stream.text(text)
        }
        break
      }

      case 'tool_use.start': {
        const toolName = (event.tool_name as string) || 'unknown'
        const toolInput = event.tool_input ?? {}
        stream.toolUse(toolName, toolInput)
        break
      }

      case 'tool_use.end': {
        const toolName = (event.tool_name as string) || 'unknown'
        const result = event.result
        const success = event.success !== false
        stream.toolResult(toolName, result, success)
        break
      }

      case 'file.change': {
        const path = event.path as string
        const action = (event.action as 'created' | 'modified' | 'deleted') || 'modified'
        const linesAdded = event.lines_added as number | undefined
        const linesRemoved = event.lines_removed as number | undefined
        if (path) {
          stream.fileChange(path, action, linesAdded, linesRemoved)
          if (!artifacts.some((a) => a.path === path)) {
            artifacts.push({ type: 'file', name: path, path })
          }
        }
        break
      }

      case 'message.end': {
        stream.status('running', undefined, 'Turn complete')
        break
      }

      case 'session.end': {
        const cost = event.cost as number | undefined
        const inputTokens = event.input_tokens as number | undefined
        const outputTokens = event.output_tokens as number | undefined
        const turns = event.turns as number | undefined
        const model = event.model as string | undefined
        const durationMs = event.duration_ms as number | undefined

        if (cost !== undefined) {
          stream.status('running', 100, `Completed (${turns ?? 0} turns, $${cost.toFixed(4)})`)
        } else {
          stream.status('running', 100, 'Completed')
        }

        return {
          totalCost: cost,
          inputTokens,
          outputTokens,
          numTurns: turns,
          model,
          durationMs,
        }
      }

      default:
        // Unknown event type — skip silently
        break
    }
  } catch {
    // Not valid JSON — send as raw stdout
    stream.stdout(line + '\n')
  }

  return undefined
}

// ============================================================================
// Line buffer simulation (mirrors runOpenClaw's stdout data handler)
// ============================================================================

/**
 * Simulate the line-buffered JSONL processing from the adapter's
 * `proc.stdout.on('data', ...)` handler. Accepts raw chunks and
 * produces complete lines via a persistent buffer.
 */
class LineBuffer {
  private buf = ''

  push(
    chunk: string,
    stream: TaskOutputStream,
    artifacts: TaskArtifact[],
  ): TaskMetrics | undefined {
    this.buf += chunk
    const lines = this.buf.split('\n')
    this.buf = lines.pop() || ''

    let lastMetrics: TaskMetrics | undefined
    for (const line of lines) {
      if (line.trim()) {
        const metrics = handleStreamLine(line, stream, artifacts)
        if (metrics) lastMetrics = metrics
      }
    }
    return lastMetrics
  }

  /** Flush remaining buffer content (called on process close) */
  flush(
    stream: TaskOutputStream,
    artifacts: TaskArtifact[],
  ): TaskMetrics | undefined {
    if (this.buf.trim()) {
      return handleStreamLine(this.buf, stream, artifacts)
    }
    return undefined
  }
}

// ============================================================================
// Mock factory
// ============================================================================

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

// ============================================================================
// Tests
// ============================================================================

describe('OpenClaw provider: handleStreamLine', () => {
  let stream: TaskOutputStream
  let artifacts: TaskArtifact[]

  beforeEach(() => {
    stream = createMockStream()
    artifacts = []
  })

  // ==========================================================================
  // 1. Each JSONL event type parsing
  // ==========================================================================

  describe('session.start — sessionInit mapping', () => {
    it('emits sessionInit with session_id and model', () => {
      const result = handleStreamLine(
        JSON.stringify({ type: 'session.start', session_id: 'sess-abc-123', model: 'claude-sonnet-4-20250514' }),
        stream,
        artifacts,
      )

      expect(stream.sessionInit).toHaveBeenCalledWith('sess-abc-123', 'claude-sonnet-4-20250514')
      expect(result).toBeUndefined()
    })

    it('emits sessionInit without model when not provided', () => {
      handleStreamLine(
        JSON.stringify({ type: 'session.start', session_id: 'sess-456' }),
        stream,
        artifacts,
      )
      expect(stream.sessionInit).toHaveBeenCalledWith('sess-456', undefined)
    })

    it('does NOT emit sessionInit when session_id is missing', () => {
      handleStreamLine(JSON.stringify({ type: 'session.start' }), stream, artifacts)
      expect(stream.sessionInit).not.toHaveBeenCalled()
    })

    it('does NOT emit sessionInit when session_id is empty string', () => {
      handleStreamLine(
        JSON.stringify({ type: 'session.start', session_id: '' }),
        stream,
        artifacts,
      )
      expect(stream.sessionInit).not.toHaveBeenCalled()
    })
  })

  describe('content.text — text() mapping', () => {
    it('emits text with content string', () => {
      handleStreamLine(
        JSON.stringify({ type: 'content.text', text: 'Analyzing the codebase...' }),
        stream,
        artifacts,
      )
      expect(stream.text).toHaveBeenCalledWith('Analyzing the codebase...')
    })

    it('does NOT emit text when text field is empty string', () => {
      handleStreamLine(JSON.stringify({ type: 'content.text', text: '' }), stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('does NOT emit text when text field is missing', () => {
      handleStreamLine(JSON.stringify({ type: 'content.text' }), stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('preserves multi-line text content', () => {
      const multiline = 'Line 1\nLine 2\nLine 3'
      handleStreamLine(
        JSON.stringify({ type: 'content.text', text: multiline }),
        stream,
        artifacts,
      )
      expect(stream.text).toHaveBeenCalledWith(multiline)
    })

    it('preserves unicode and special characters', () => {
      const text = '日本語テスト 🎉 <script>alert("xss")</script> path/to/file.ts'
      handleStreamLine(JSON.stringify({ type: 'content.text', text }), stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith(text)
    })
  })

  describe('tool_use.start — toolUse() mapping', () => {
    it('emits toolUse with tool name and input object', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.start', tool_name: 'bash', tool_input: { command: 'ls -la' } }),
        stream,
        artifacts,
      )
      expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'ls -la' })
    })

    it('defaults tool_name to "unknown" when missing', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.start', tool_input: { path: '/tmp' } }),
        stream,
        artifacts,
      )
      expect(stream.toolUse).toHaveBeenCalledWith('unknown', { path: '/tmp' })
    })

    it('defaults tool_input to empty object when missing', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.start', tool_name: 'read_file' }),
        stream,
        artifacts,
      )
      expect(stream.toolUse).toHaveBeenCalledWith('read_file', {})
    })

    it('defaults tool_name to "unknown" when empty string', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.start', tool_name: '', tool_input: {} }),
        stream,
        artifacts,
      )
      expect(stream.toolUse).toHaveBeenCalledWith('unknown', {})
    })

    it('preserves complex nested tool_input', () => {
      const input = { files: ['a.ts', 'b.ts'], options: { recursive: true, depth: 3 } }
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.start', tool_name: 'glob', tool_input: input }),
        stream,
        artifacts,
      )
      expect(stream.toolUse).toHaveBeenCalledWith('glob', input)
    })
  })

  describe('tool_use.end — toolResult() mapping', () => {
    it('emits toolResult with name, result, and success=true', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.end', tool_name: 'bash', result: 'file1.txt\nfile2.txt', success: true }),
        stream,
        artifacts,
      )
      expect(stream.toolResult).toHaveBeenCalledWith('bash', 'file1.txt\nfile2.txt', true)
    })

    it('emits toolResult with success=false for failures', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.end', tool_name: 'bash', result: 'command not found: foobar', success: false }),
        stream,
        artifacts,
      )
      expect(stream.toolResult).toHaveBeenCalledWith('bash', 'command not found: foobar', false)
    })

    it('defaults success to true when not specified', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.end', tool_name: 'write_file', result: 'File written' }),
        stream,
        artifacts,
      )
      expect(stream.toolResult).toHaveBeenCalledWith('write_file', 'File written', true)
    })

    it('defaults tool_name to "unknown" when missing', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.end', result: 'ok', success: true }),
        stream,
        artifacts,
      )
      expect(stream.toolResult).toHaveBeenCalledWith('unknown', 'ok', true)
    })

    it('handles null result gracefully', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.end', tool_name: 'bash', result: null, success: true }),
        stream,
        artifacts,
      )
      expect(stream.toolResult).toHaveBeenCalledWith('bash', null, true)
    })

    it('handles object result', () => {
      const resultObj = { files: ['a.ts', 'b.ts'], count: 2 }
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.end', tool_name: 'glob', result: resultObj, success: true }),
        stream,
        artifacts,
      )
      expect(stream.toolResult).toHaveBeenCalledWith('glob', resultObj, true)
    })

    it('treats explicit success=false correctly', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.end', tool_name: 'test', result: 'FAIL', success: false }),
        stream,
        artifacts,
      )
      expect(stream.toolResult).toHaveBeenCalledWith('test', 'FAIL', false)
    })
  })

  describe('file.change — fileChange() mapping', () => {
    it('emits fileChange and creates artifact for new file', () => {
      handleStreamLine(
        JSON.stringify({ type: 'file.change', path: 'src/index.ts', action: 'created', lines_added: 42 }),
        stream,
        artifacts,
      )
      expect(stream.fileChange).toHaveBeenCalledWith('src/index.ts', 'created', 42, undefined)
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]).toEqual({ type: 'file', name: 'src/index.ts', path: 'src/index.ts' })
    })

    it('emits fileChange for modified file with both added/removed', () => {
      handleStreamLine(
        JSON.stringify({ type: 'file.change', path: 'lib/utils.ts', action: 'modified', lines_added: 10, lines_removed: 3 }),
        stream,
        artifacts,
      )
      expect(stream.fileChange).toHaveBeenCalledWith('lib/utils.ts', 'modified', 10, 3)
    })

    it('emits fileChange for deleted file', () => {
      handleStreamLine(
        JSON.stringify({ type: 'file.change', path: 'old-file.ts', action: 'deleted', lines_removed: 25 }),
        stream,
        artifacts,
      )
      expect(stream.fileChange).toHaveBeenCalledWith('old-file.ts', 'deleted', undefined, 25)
    })

    it('defaults action to "modified" when missing', () => {
      handleStreamLine(
        JSON.stringify({ type: 'file.change', path: 'test.ts' }),
        stream,
        artifacts,
      )
      expect(stream.fileChange).toHaveBeenCalledWith('test.ts', 'modified', undefined, undefined)
    })

    it('ignores file.change when path is missing', () => {
      handleStreamLine(
        JSON.stringify({ type: 'file.change', action: 'modified', lines_added: 5 }),
        stream,
        artifacts,
      )
      expect(stream.fileChange).not.toHaveBeenCalled()
      expect(artifacts).toHaveLength(0)
    })

    it('does NOT add duplicate artifacts for same path', () => {
      artifacts.push({ type: 'file', name: 'src/index.ts', path: 'src/index.ts' })

      handleStreamLine(
        JSON.stringify({ type: 'file.change', path: 'src/index.ts', action: 'modified', lines_added: 2 }),
        stream,
        artifacts,
      )
      expect(artifacts).toHaveLength(1)
      // But fileChange is still emitted
      expect(stream.fileChange).toHaveBeenCalledWith('src/index.ts', 'modified', 2, undefined)
    })

    it('adds separate artifacts for different paths', () => {
      handleStreamLine(JSON.stringify({ type: 'file.change', path: 'a.ts', action: 'created' }), stream, artifacts)
      handleStreamLine(JSON.stringify({ type: 'file.change', path: 'b.ts', action: 'created' }), stream, artifacts)
      handleStreamLine(JSON.stringify({ type: 'file.change', path: 'c.ts', action: 'modified' }), stream, artifacts)

      expect(artifacts).toHaveLength(3)
      expect(artifacts.map((a) => a.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    })
  })

  describe('message.start — status update', () => {
    it('emits running status with "Agent thinking..." message', () => {
      handleStreamLine(JSON.stringify({ type: 'message.start' }), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Agent thinking...')
    })

    it('ignores extra fields on message.start', () => {
      handleStreamLine(
        JSON.stringify({ type: 'message.start', extra: 'data', timestamp: '2025-01-01' }),
        stream,
        artifacts,
      )
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Agent thinking...')
    })
  })

  describe('message.end — status update', () => {
    it('emits running status with "Turn complete" message', () => {
      handleStreamLine(JSON.stringify({ type: 'message.end' }), stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Turn complete')
    })
  })

  describe('session.end — metrics extraction', () => {
    it('returns full metrics from session.end with cost', () => {
      const result = handleStreamLine(
        JSON.stringify({
          type: 'session.end',
          cost: 0.0523,
          input_tokens: 1500,
          output_tokens: 800,
          turns: 3,
          model: 'claude-sonnet-4-20250514',
          duration_ms: 12000,
        }),
        stream,
        artifacts,
      )

      expect(result).toEqual({
        totalCost: 0.0523,
        inputTokens: 1500,
        outputTokens: 800,
        numTurns: 3,
        model: 'claude-sonnet-4-20250514',
        durationMs: 12000,
      })
    })

    it('emits status with cost and turns in message', () => {
      handleStreamLine(
        JSON.stringify({ type: 'session.end', cost: 0.0312, turns: 2 }),
        stream,
        artifacts,
      )
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed (2 turns, $0.0312)')
    })

    it('emits "Completed" status when cost is undefined', () => {
      handleStreamLine(
        JSON.stringify({ type: 'session.end', input_tokens: 500, output_tokens: 200, turns: 1 }),
        stream,
        artifacts,
      )
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed')
    })

    it('returns metrics with undefined fields when minimal session.end', () => {
      const result = handleStreamLine(
        JSON.stringify({ type: 'session.end' }),
        stream,
        artifacts,
      )
      expect(result).toEqual({
        totalCost: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        numTurns: undefined,
        model: undefined,
        durationMs: undefined,
      })
    })

    it('handles zero cost correctly', () => {
      const result = handleStreamLine(
        JSON.stringify({ type: 'session.end', cost: 0, turns: 0, input_tokens: 0, output_tokens: 0 }),
        stream,
        artifacts,
      )
      expect(result).toEqual({
        totalCost: 0,
        inputTokens: 0,
        outputTokens: 0,
        numTurns: 0,
        model: undefined,
        durationMs: undefined,
      })
      // cost is 0 (not undefined), so detailed status message is emitted
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed (0 turns, $0.0000)')
    })

    it('handles very small cost values (precision)', () => {
      const result = handleStreamLine(
        JSON.stringify({ type: 'session.end', cost: 0.00001 }),
        stream,
        artifacts,
      )
      expect(result!.totalCost).toBe(0.00001)
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed (0 turns, $0.0000)')
    })

    it('handles large token counts', () => {
      const result = handleStreamLine(
        JSON.stringify({
          type: 'session.end',
          cost: 15.5,
          input_tokens: 1_000_000,
          output_tokens: 500_000,
          turns: 50,
          model: 'claude-opus-4-20250514',
          duration_ms: 300_000,
        }),
        stream,
        artifacts,
      )
      expect(result).toEqual({
        totalCost: 15.5,
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        numTurns: 50,
        model: 'claude-opus-4-20250514',
        durationMs: 300_000,
      })
    })

    it('formats cost with 4 decimal places when turns is undefined', () => {
      handleStreamLine(
        JSON.stringify({ type: 'session.end', cost: 1.23456789 }),
        stream,
        artifacts,
      )
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed (0 turns, $1.2346)')
    })
  })

  // ==========================================================================
  // 2. Malformed JSON handling
  // ==========================================================================

  describe('malformed JSON handling', () => {
    it('sends non-JSON lines to stdout with newline appended', () => {
      handleStreamLine('this is not json', stream, artifacts)
      expect(stream.stdout).toHaveBeenCalledWith('this is not json\n')
    })

    it('sends incomplete JSON to stdout', () => {
      handleStreamLine('{invalid json', stream, artifacts)
      expect(stream.stdout).toHaveBeenCalledWith('{invalid json\n')
    })

    it('sends truncated JSON to stdout', () => {
      handleStreamLine('{"type": "session.start", "session_id":', stream, artifacts)
      expect(stream.stdout).toHaveBeenCalledWith('{"type": "session.start", "session_id":\n')
    })

    it('does NOT crash on empty string', () => {
      handleStreamLine('', stream, artifacts)
      expect(stream.stdout).toHaveBeenCalledWith('\n')
    })

    it('does NOT crash on whitespace-only string', () => {
      handleStreamLine('   ', stream, artifacts)
      expect(stream.stdout).toHaveBeenCalledWith('   \n')
    })

    it('does NOT crash and does NOT call text/toolUse/toolResult on malformed JSON', () => {
      handleStreamLine('not a json object at all!', stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.toolUse).not.toHaveBeenCalled()
      expect(stream.toolResult).not.toHaveBeenCalled()
      expect(stream.sessionInit).not.toHaveBeenCalled()
      expect(stream.fileChange).not.toHaveBeenCalled()
    })

    it('returns undefined for malformed JSON (no metrics)', () => {
      const result = handleStreamLine('{broken', stream, artifacts)
      expect(result).toBeUndefined()
    })

    it('handles JSON array (not object) without crash', () => {
      handleStreamLine('[1, 2, 3]', stream, artifacts)
      // Parses as JSON but type is undefined → falls through to default
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.stdout).not.toHaveBeenCalled()
    })

    it('handles null JSON value without crash', () => {
      handleStreamLine('null', stream, artifacts)
      // JSON.parse("null") = null → accessing .type on null throws → stdout
      expect(stream.stdout).toHaveBeenCalledWith('null\n')
    })

    it('handles JSON number without crash', () => {
      handleStreamLine('42', stream, artifacts)
      // JSON.parse("42") = 42 → .type is undefined → falls through default case
      expect(stream.stdout).not.toHaveBeenCalled()
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('handles JSON string without crash', () => {
      handleStreamLine('"hello"', stream, artifacts)
      // JSON.parse('"hello"') = "hello" → accessing .type on string → undefined → default
      expect(stream.stdout).not.toHaveBeenCalled()
      expect(stream.text).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 3. Unknown event types
  // ==========================================================================

  describe('unknown event types', () => {
    it('silently ignores unknown event types', () => {
      const result = handleStreamLine(
        JSON.stringify({ type: 'some.future.event', data: 'hello' }),
        stream,
        artifacts,
      )
      expect(result).toBeUndefined()
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.stdout).not.toHaveBeenCalled()
      expect(stream.status).not.toHaveBeenCalled()
    })

    it('handles empty JSON object (no type) silently', () => {
      handleStreamLine('{}', stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.toolUse).not.toHaveBeenCalled()
      expect(stream.toolResult).not.toHaveBeenCalled()
      expect(stream.sessionInit).not.toHaveBeenCalled()
      expect(stream.fileChange).not.toHaveBeenCalled()
      expect(stream.status).not.toHaveBeenCalled()
    })

    it('handles event with null type silently', () => {
      handleStreamLine(JSON.stringify({ type: null }), stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.stdout).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 4. Event type mapping verification (cross-cutting)
  // ==========================================================================

  describe('event type mapping to stream methods', () => {
    it('session.start maps ONLY to sessionInit', () => {
      handleStreamLine(
        JSON.stringify({ type: 'session.start', session_id: 'sid', model: 'gpt-4o' }),
        stream,
        artifacts,
      )
      expect(stream.sessionInit).toHaveBeenCalledTimes(1)
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.toolUse).not.toHaveBeenCalled()
      expect(stream.toolResult).not.toHaveBeenCalled()
      expect(stream.fileChange).not.toHaveBeenCalled()
      expect(stream.stdout).not.toHaveBeenCalled()
      expect(stream.stderr).not.toHaveBeenCalled()
    })

    it('content.text maps ONLY to text()', () => {
      handleStreamLine(
        JSON.stringify({ type: 'content.text', text: 'hello' }),
        stream,
        artifacts,
      )
      expect(stream.text).toHaveBeenCalledTimes(1)
      expect(stream.sessionInit).not.toHaveBeenCalled()
      expect(stream.toolUse).not.toHaveBeenCalled()
      expect(stream.toolResult).not.toHaveBeenCalled()
      expect(stream.status).not.toHaveBeenCalled()
    })

    it('tool_use.start maps ONLY to toolUse()', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.start', tool_name: 'bash', tool_input: {} }),
        stream,
        artifacts,
      )
      expect(stream.toolUse).toHaveBeenCalledTimes(1)
      expect(stream.toolResult).not.toHaveBeenCalled()
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.sessionInit).not.toHaveBeenCalled()
    })

    it('tool_use.end maps ONLY to toolResult()', () => {
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.end', tool_name: 'bash', result: 'ok', success: true }),
        stream,
        artifacts,
      )
      expect(stream.toolResult).toHaveBeenCalledTimes(1)
      expect(stream.toolUse).not.toHaveBeenCalled()
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.sessionInit).not.toHaveBeenCalled()
    })

    it('file.change maps to fileChange() AND updates artifacts', () => {
      handleStreamLine(
        JSON.stringify({ type: 'file.change', path: 'x.ts', action: 'created' }),
        stream,
        artifacts,
      )
      expect(stream.fileChange).toHaveBeenCalledTimes(1)
      expect(artifacts).toHaveLength(1)
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.toolUse).not.toHaveBeenCalled()
    })

    it('message.start maps ONLY to status()', () => {
      handleStreamLine(JSON.stringify({ type: 'message.start' }), stream, artifacts)
      expect(stream.status).toHaveBeenCalledTimes(1)
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.sessionInit).not.toHaveBeenCalled()
    })

    it('message.end maps ONLY to status()', () => {
      handleStreamLine(JSON.stringify({ type: 'message.end' }), stream, artifacts)
      expect(stream.status).toHaveBeenCalledTimes(1)
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('session.end maps to status() AND returns metrics', () => {
      const result = handleStreamLine(
        JSON.stringify({ type: 'session.end', cost: 0.01, turns: 1 }),
        stream,
        artifacts,
      )
      expect(stream.status).toHaveBeenCalledTimes(1)
      expect(result).toBeDefined()
      expect(result!.totalCost).toBe(0.01)
    })
  })

  // ==========================================================================
  // 5. Metadata extraction (detailed)
  // ==========================================================================

  describe('metadata extraction from session.end', () => {
    it('extracts all metrics fields correctly', () => {
      const result = handleStreamLine(
        JSON.stringify({
          type: 'session.end',
          cost: 0.0842,
          input_tokens: 3200,
          output_tokens: 1500,
          turns: 5,
          model: 'gpt-4o-mini',
          duration_ms: 45000,
        }),
        stream,
        artifacts,
      )

      expect(result).toBeDefined()
      expect(result!.totalCost).toBe(0.0842)
      expect(result!.inputTokens).toBe(3200)
      expect(result!.outputTokens).toBe(1500)
      expect(result!.numTurns).toBe(5)
      expect(result!.model).toBe('gpt-4o-mini')
      expect(result!.durationMs).toBe(45000)
    })

    it('maps OpenClaw field names to internal metric names', () => {
      // Verify the mapping: cost → totalCost, input_tokens → inputTokens, etc.
      const result = handleStreamLine(
        JSON.stringify({
          type: 'session.end',
          cost: 1.0,
          input_tokens: 100,
          output_tokens: 50,
          turns: 2,
          model: 'test-model',
          duration_ms: 5000,
        }),
        stream,
        artifacts,
      )!

      // snake_case → camelCase mapping
      expect(result).toHaveProperty('totalCost', 1.0)
      expect(result).toHaveProperty('inputTokens', 100)
      expect(result).toHaveProperty('outputTokens', 50)
      expect(result).toHaveProperty('numTurns', 2)
      expect(result).toHaveProperty('model', 'test-model')
      expect(result).toHaveProperty('durationMs', 5000)

      // Verify there are no snake_case keys leaked
      expect(result).not.toHaveProperty('cost')
      expect(result).not.toHaveProperty('input_tokens')
      expect(result).not.toHaveProperty('output_tokens')
      expect(result).not.toHaveProperty('turns')
      expect(result).not.toHaveProperty('duration_ms')
    })

    it('handles partial metrics (only cost and model)', () => {
      const result = handleStreamLine(
        JSON.stringify({ type: 'session.end', cost: 0.5, model: 'claude-haiku' }),
        stream,
        artifacts,
      )!

      expect(result.totalCost).toBe(0.5)
      expect(result.model).toBe('claude-haiku')
      expect(result.inputTokens).toBeUndefined()
      expect(result.outputTokens).toBeUndefined()
      expect(result.numTurns).toBeUndefined()
      expect(result.durationMs).toBeUndefined()
    })

    it('non-session.end events return undefined (no metrics)', () => {
      const types = ['session.start', 'content.text', 'tool_use.start', 'tool_use.end', 'message.start', 'message.end']
      for (const type of types) {
        const result = handleStreamLine(
          JSON.stringify({ type, session_id: 's', text: 't', tool_name: 'bash', result: 'r', path: 'p' }),
          stream,
          artifacts,
        )
        expect(result).toBeUndefined()
      }
    })
  })

  // ==========================================================================
  // 6. Incomplete line buffering
  // ==========================================================================

  describe('incomplete line buffering', () => {
    let buffer: LineBuffer

    beforeEach(() => {
      buffer = new LineBuffer()
    })

    it('handles a single complete line in one chunk', () => {
      const event = JSON.stringify({ type: 'content.text', text: 'hello' })
      buffer.push(event + '\n', stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('hello')
    })

    it('handles a line split across two chunks', () => {
      const event = JSON.stringify({ type: 'content.text', text: 'split line' })
      const half = Math.floor(event.length / 2)

      buffer.push(event.slice(0, half), stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled() // Not yet — no newline

      buffer.push(event.slice(half) + '\n', stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('split line')
    })

    it('handles a line split across three chunks', () => {
      const event = JSON.stringify({ type: 'content.text', text: 'three-way split' })
      const third = Math.floor(event.length / 3)

      buffer.push(event.slice(0, third), stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()

      buffer.push(event.slice(third, third * 2), stream, artifacts)
      expect(stream.text).not.toHaveBeenCalled()

      buffer.push(event.slice(third * 2) + '\n', stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('three-way split')
    })

    it('handles multiple complete lines in one chunk', () => {
      const e1 = JSON.stringify({ type: 'content.text', text: 'line1' })
      const e2 = JSON.stringify({ type: 'content.text', text: 'line2' })
      const e3 = JSON.stringify({ type: 'content.text', text: 'line3' })

      buffer.push(e1 + '\n' + e2 + '\n' + e3 + '\n', stream, artifacts)

      expect(stream.text).toHaveBeenCalledTimes(3)
      expect(stream.text).toHaveBeenNthCalledWith(1, 'line1')
      expect(stream.text).toHaveBeenNthCalledWith(2, 'line2')
      expect(stream.text).toHaveBeenNthCalledWith(3, 'line3')
    })

    it('flushes remaining buffer content on close', () => {
      const event = JSON.stringify({ type: 'content.text', text: 'no newline at end' })
      buffer.push(event, stream, artifacts) // No trailing newline
      expect(stream.text).not.toHaveBeenCalled()

      buffer.flush(stream, artifacts)
      expect(stream.text).toHaveBeenCalledWith('no newline at end')
    })

    it('flush returns metrics when last buffered line is session.end', () => {
      const event = JSON.stringify({ type: 'session.end', cost: 0.05, turns: 2 })
      buffer.push(event, stream, artifacts) // No trailing newline

      const metrics = buffer.flush(stream, artifacts)
      expect(metrics).toBeDefined()
      expect(metrics!.totalCost).toBe(0.05)
    })

    it('skips empty lines between events', () => {
      const e1 = JSON.stringify({ type: 'content.text', text: 'a' })
      const e2 = JSON.stringify({ type: 'content.text', text: 'b' })

      // Simulates blank lines between events (the trim() check filters them)
      buffer.push(e1 + '\n\n\n' + e2 + '\n', stream, artifacts)

      expect(stream.text).toHaveBeenCalledTimes(2)
      expect(stream.text).toHaveBeenNthCalledWith(1, 'a')
      expect(stream.text).toHaveBeenNthCalledWith(2, 'b')
    })

    it('processes complete lines immediately, holds partial for next chunk', () => {
      const e1 = JSON.stringify({ type: 'content.text', text: 'immediate' })
      const e2Start = '{"type": "content.text", "text": "part'

      buffer.push(e1 + '\n' + e2Start, stream, artifacts)

      expect(stream.text).toHaveBeenCalledTimes(1)
      expect(stream.text).toHaveBeenCalledWith('immediate')

      // Complete the second line
      buffer.push('ial"}\n', stream, artifacts)
      expect(stream.text).toHaveBeenCalledTimes(2)
      expect(stream.text).toHaveBeenNthCalledWith(2, 'partial')
    })

    it('propagates metrics from complete lines within chunk', () => {
      const endEvent = JSON.stringify({ type: 'session.end', cost: 0.1, turns: 3 })
      const metrics = buffer.push(endEvent + '\n', stream, artifacts)
      expect(metrics).toBeDefined()
      expect(metrics!.totalCost).toBe(0.1)
    })

    it('returns last metrics when multiple metrics-producing lines in one chunk', () => {
      // Unlikely but possible: two session.end events (e.g., error recovery)
      const e1 = JSON.stringify({ type: 'session.end', cost: 0.01, turns: 1 })
      const e2 = JSON.stringify({ type: 'session.end', cost: 0.05, turns: 3 })

      const metrics = buffer.push(e1 + '\n' + e2 + '\n', stream, artifacts)
      // Should return the LAST metrics
      expect(metrics).toBeDefined()
      expect(metrics!.totalCost).toBe(0.05)
      expect(metrics!.numTurns).toBe(3)
    })
  })

  // ==========================================================================
  // 7. Full session sequence (integration-style)
  // ==========================================================================

  describe('full session sequence', () => {
    it('processes a realistic multi-turn session correctly', () => {
      const events = [
        { type: 'session.start', session_id: 'sess-001', model: 'gpt-4o' },
        { type: 'message.start' },
        { type: 'content.text', text: 'I will analyze the codebase.' },
        { type: 'tool_use.start', tool_name: 'bash', tool_input: { command: 'ls -la' } },
        { type: 'tool_use.end', tool_name: 'bash', result: 'file1.txt\nfile2.txt', success: true },
        { type: 'content.text', text: 'Found 2 files. Creating new module.' },
        { type: 'tool_use.start', tool_name: 'write_file', tool_input: { path: 'src/mod.ts', content: 'export {}' } },
        { type: 'tool_use.end', tool_name: 'write_file', result: 'File written', success: true },
        { type: 'file.change', path: 'src/mod.ts', action: 'created', lines_added: 1 },
        { type: 'message.end' },
        { type: 'session.end', cost: 0.0312, input_tokens: 1200, output_tokens: 600, turns: 2 },
      ]

      let lastResult: TaskMetrics | undefined
      for (const event of events) {
        const r = handleStreamLine(JSON.stringify(event), stream, artifacts)
        if (r) lastResult = r
      }

      // sessionInit called once
      expect(stream.sessionInit).toHaveBeenCalledTimes(1)
      expect(stream.sessionInit).toHaveBeenCalledWith('sess-001', 'gpt-4o')

      // text called twice
      expect(stream.text).toHaveBeenCalledTimes(2)
      expect((stream.text as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('I will analyze the codebase.')
      expect((stream.text as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe('Found 2 files. Creating new module.')

      // 2 tool starts, 2 tool results
      expect(stream.toolUse).toHaveBeenCalledTimes(2)
      expect(stream.toolResult).toHaveBeenCalledTimes(2)

      // 1 file change
      expect(stream.fileChange).toHaveBeenCalledTimes(1)
      expect(stream.fileChange).toHaveBeenCalledWith('src/mod.ts', 'created', 1, undefined)
      expect(artifacts).toHaveLength(1)

      // 3 status calls: message.start, message.end, session.end
      expect(stream.status).toHaveBeenCalledTimes(3)

      // Final metrics
      expect(lastResult).toEqual({
        totalCost: 0.0312,
        inputTokens: 1200,
        outputTokens: 600,
        numTurns: 2,
        model: undefined,
        durationMs: undefined,
      })
    })

    it('handles error tool results mid-session gracefully', () => {
      const events = [
        { type: 'session.start', session_id: 'sess-err', model: 'claude-sonnet' },
        { type: 'message.start' },
        { type: 'tool_use.start', tool_name: 'bash', tool_input: { command: 'rm -rf /' } },
        { type: 'tool_use.end', tool_name: 'bash', result: 'Permission denied', success: false },
        { type: 'content.text', text: 'The command failed. Let me try another approach.' },
        { type: 'tool_use.start', tool_name: 'bash', tool_input: { command: 'echo hello' } },
        { type: 'tool_use.end', tool_name: 'bash', result: 'hello', success: true },
        { type: 'message.end' },
        { type: 'session.end', cost: 0.01, turns: 1 },
      ]

      for (const event of events) {
        handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      // First tool result was failure
      expect(stream.toolResult).toHaveBeenNthCalledWith(1, 'bash', 'Permission denied', false)
      // Second was success
      expect(stream.toolResult).toHaveBeenNthCalledWith(2, 'bash', 'hello', true)
    })

    it('handles multiple file changes across different files', () => {
      const events = [
        { type: 'session.start', session_id: 's', model: 'm' },
        { type: 'message.start' },
        { type: 'file.change', path: 'src/a.ts', action: 'created', lines_added: 10 },
        { type: 'file.change', path: 'src/b.ts', action: 'modified', lines_added: 5, lines_removed: 2 },
        { type: 'file.change', path: 'src/c.ts', action: 'deleted', lines_removed: 20 },
        { type: 'file.change', path: 'src/a.ts', action: 'modified', lines_added: 3 }, // Same file again
        { type: 'message.end' },
        { type: 'session.end' },
      ]

      for (const event of events) {
        handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.fileChange).toHaveBeenCalledTimes(4)
      // Only 3 unique artifacts (src/a.ts deduped)
      expect(artifacts).toHaveLength(3)
      expect(artifacts.map((a) => a.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    })

    it('processes session via line buffer with chunked input', () => {
      const buffer = new LineBuffer()
      const e1 = JSON.stringify({ type: 'session.start', session_id: 'buf-test', model: 'gpt-4o' })
      const e2 = JSON.stringify({ type: 'content.text', text: 'buffered text' })
      const e3 = JSON.stringify({ type: 'session.end', cost: 0.02, turns: 1 })

      // Deliver as a single blob
      buffer.push(e1 + '\n' + e2 + '\n', stream, artifacts)
      expect(stream.sessionInit).toHaveBeenCalledWith('buf-test', 'gpt-4o')
      expect(stream.text).toHaveBeenCalledWith('buffered text')

      // session.end arrives in two chunks
      const half = Math.floor(e3.length / 2)
      buffer.push(e3.slice(0, half), stream, artifacts)
      expect(stream.status).not.toHaveBeenCalled() // Not complete yet

      buffer.push(e3.slice(half) + '\n', stream, artifacts)
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed (1 turns, $0.0200)')
    })
  })

  // ==========================================================================
  // 8. Edge cases & robustness
  // ==========================================================================

  describe('edge cases & robustness', () => {
    it('handles very long text content without issue', () => {
      const longText = 'x'.repeat(100_000)
      handleStreamLine(
        JSON.stringify({ type: 'content.text', text: longText }),
        stream,
        artifacts,
      )
      expect(stream.text).toHaveBeenCalledWith(longText)
    })

    it('handles deeply nested tool_input', () => {
      const deepInput = {
        level1: {
          level2: {
            level3: {
              level4: { data: [1, 2, 3] },
            },
          },
        },
      }
      handleStreamLine(
        JSON.stringify({ type: 'tool_use.start', tool_name: 'complex', tool_input: deepInput }),
        stream,
        artifacts,
      )
      expect(stream.toolUse).toHaveBeenCalledWith('complex', deepInput)
    })

    it('handles special characters in file paths', () => {
      handleStreamLine(
        JSON.stringify({ type: 'file.change', path: 'src/my file (1).ts', action: 'created' }),
        stream,
        artifacts,
      )
      expect(stream.fileChange).toHaveBeenCalledWith('src/my file (1).ts', 'created', undefined, undefined)
      expect(artifacts[0]!.path).toBe('src/my file (1).ts')
    })

    it('handles unicode in session_id', () => {
      handleStreamLine(
        JSON.stringify({ type: 'session.start', session_id: 'sess-日本語-123' }),
        stream,
        artifacts,
      )
      expect(stream.sessionInit).toHaveBeenCalledWith('sess-日本語-123', undefined)
    })

    it('handles extra unexpected fields without error', () => {
      handleStreamLine(
        JSON.stringify({
          type: 'content.text',
          text: 'hello',
          unexpected_field: 'ignored',
          another: { nested: true },
        }),
        stream,
        artifacts,
      )
      expect(stream.text).toHaveBeenCalledWith('hello')
    })

    it('handles boolean/number values for text field (truthy but not string-like)', () => {
      // The adapter casts to string, so non-empty truthy values pass the `if (text)` check
      handleStreamLine(
        JSON.stringify({ type: 'content.text', text: 0 }),
        stream,
        artifacts,
      )
      // 0 is falsy → text() should NOT be called
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('processes events with numeric type values silently (no crash)', () => {
      handleStreamLine(
        JSON.stringify({ type: 12345 }),
        stream,
        artifacts,
      )
      // Falls through to default case — no output, no crash
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.stdout).not.toHaveBeenCalled()
    })

    it('handles rapid successive calls without state leakage', () => {
      // Process many events quickly — verify no cross-event contamination
      for (let i = 0; i < 100; i++) {
        handleStreamLine(
          JSON.stringify({ type: 'content.text', text: `msg-${i}` }),
          stream,
          artifacts,
        )
      }
      expect(stream.text).toHaveBeenCalledTimes(100)
      expect((stream.text as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('msg-0')
      expect((stream.text as ReturnType<typeof vi.fn>).mock.calls[99][0]).toBe('msg-99')
    })
  })
})
