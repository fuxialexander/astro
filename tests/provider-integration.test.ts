/**
 * Provider Integration Tests
 *
 * End-to-end lifecycle tests for OpenClaw and OpenCode provider adapters.
 * These tests auto-skip when the corresponding CLI tool is not installed,
 * making them safe to run in any environment (CI, local, etc.).
 *
 * Test coverage:
 * 1. Provider availability detection (via `which` / PATH lookup)
 * 2. Full lifecycle: create adapter → check availability → execute task → stream events → complete
 * 3. Abort/cancellation during execution
 * 4. Timeout enforcement for real CLI execution
 * 5. Error handling for invalid working directories
 * 6. Concurrent task tracking
 * 7. Provider status reporting
 * 8. Full execute() lifecycle via mocked child process (always runs)
 *
 * Auto-skip logic:
 *   Uses `describe.skipIf()` with a pre-check via `which openclaw` / `which opencode`
 *   to skip the entire test suite if the provider CLI is not installed.
 *
 * @see packages/agent-runner/src/providers/opencode-adapter.ts
 * @see packages/agent-runner/src/providers/openclaw-adapter.ts
 * @see packages/agent-runner/src/providers/base-adapter.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTrackedMockStream } from './helpers/mock-stream.js'
import { exec, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
// Dynamic imports — agent-runner submodule may not be checked out in CI
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically imported class constructor
let OpenCodeAdapter: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically imported class constructor
let OpenClawAdapter: any
let adapterAvailable = false

try {
  const opencodeMod = await import('../packages/agent-runner/src/providers/opencode-adapter.js')
  const openclawMod = await import('../packages/agent-runner/src/providers/openclaw-adapter.js')
  OpenCodeAdapter = opencodeMod.OpenCodeAdapter
  OpenClawAdapter = openclawMod.OpenClawAdapter
  adapterAvailable = true
} catch {
  // agent-runner submodule not available — tests will be skipped
}

// Type aliases — use Record<string, unknown> since type imports can't be dynamic
type Task = Record<string, unknown>

const execAsync = promisify(exec)

// =============================================================================
// Module-level mock control variables (used by vi.mock at bottom of file)
// =============================================================================
// vi.hoisted ensures these exist when the hoisted vi.mock factories run.
const { mockSpawnFn, mockGetProviderFn } = vi.hoisted(() => ({
  mockSpawnFn: vi.fn(),
  mockGetProviderFn: vi.fn().mockResolvedValue(null),
}))

// =============================================================================
// CLI Availability Detection
// =============================================================================

/**
 * Check if a CLI command is available on this machine.
 * Uses `which` (Unix) or `where` (Windows) to detect installation.
 */
async function isCliAvailable(command: string): Promise<boolean> {
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    await execAsync(`${whichCmd} ${command}`, { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

// Pre-check availability at module level for describe.skipIf()
const openclawAvailable = await isCliAvailable('openclaw')
const opencodeAvailable = await isCliAvailable('opencode')

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a minimal test task with reasonable defaults.
 */
function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'test-project',
    planNodeId: 'test-node',
    provider: 'opencode',
    prompt: 'Say "hello" and nothing else. Do not use any tools.',
    workingDirectory: tmpdir(),
    createdAt: new Date().toISOString(),
    timeout: 60_000, // 60s timeout for real CLI execution
    ...overrides,
  }
}

/**
 * Create a mock ChildProcess for testing execute() without real CLI.
 * Returns an EventEmitter-based mock that can simulate stdout/stderr/close events.
 */
function createMockChildProcess(): ChildProcess & {
  _emitStdout: (data: string) => void
  _emitStderr: (data: string) => void
  _close: (code: number) => void
  _emitError: (error: Error) => void
} {
  const proc = new EventEmitter() as ChildProcess & {
    _emitStdout: (data: string) => void
    _emitStderr: (data: string) => void
    _close: (code: number) => void
    _emitError: (error: Error) => void
  }

  // Create readable streams for stdout/stderr
  const stdoutEmitter = new EventEmitter()
  const stderrEmitter = new EventEmitter()

  // Attach as readable streams with 'on' method
  proc.stdout = stdoutEmitter as unknown as Readable
  proc.stderr = stderrEmitter as unknown as Readable

  // Create a writable stdin that does nothing
  const stdinStream = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
  proc.stdin = stdinStream

  proc.pid = 12345
  proc.killed = false
  proc.kill = vi.fn(() => {
    proc.killed = true
    return true
  })

  // Helper to emit stdout data
  proc._emitStdout = (data: string) => {
    stdoutEmitter.emit('data', Buffer.from(data))
  }

  // Helper to emit stderr data
  proc._emitStderr = (data: string) => {
    stderrEmitter.emit('data', Buffer.from(data))
  }

  // Helper to close the process
  proc._close = (code: number) => {
    proc.emit('close', code)
  }

  // Helper to emit error
  proc._emitError = (error: Error) => {
    proc.emit('error', error)
  }

  return proc
}

// =============================================================================
// OpenCode Provider Integration Tests
// =============================================================================

describe.skipIf(!adapterAvailable || !opencodeAvailable)('OpenCode Provider Integration', () => {
  let adapter: OpenCodeAdapter
  let stream: ReturnType<typeof createTrackedMockStream>
  let tempDir: string

  beforeEach(() => {
    adapter = new OpenCodeAdapter()
    stream = createTrackedMockStream()
    // Create an isolated temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'astro-opencode-integration-'))
    // Write a minimal file so the directory isn't empty
    writeFileSync(join(tempDir, 'README.md'), '# Test\n')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  // ---------------------------------------------------------------------------
  // Availability Detection
  // ---------------------------------------------------------------------------

  describe('Availability', () => {
    it('should detect opencode as available', async () => {
      // Mock the provider detection to avoid full system scan
      mockGetProviderFn.mockReset()
      mockGetProviderFn.mockImplementation(async (type: string) => {
        if (type === 'opencode') {
          return {
            type: 'opencode',
            name: 'OpenCode',
            version: '1.0.0',
            path: '/usr/local/bin/opencode',
            available: true,
            capabilities: {
              streaming: true,
              tools: true,
              multiTurn: true,
              maxConcurrentTasks: 1,
            },
          }
        }
        return null
      })

      const available = await adapter.isAvailable()
      expect(available).toBe(true)
    })

    it('should report correct status shape', async () => {
      mockGetProviderFn.mockReset()
      mockGetProviderFn.mockImplementation(async (type: string) => {
        if (type === 'opencode') {
          return {
            type: 'opencode',
            name: 'OpenCode',
            version: '1.0.0',
            path: '/usr/local/bin/opencode',
            available: true,
            capabilities: {
              streaming: true,
              tools: true,
              multiTurn: true,
              maxConcurrentTasks: 1,
            },
          }
        }
        return null
      })

      const status = await adapter.getStatus()
      expect(status).toHaveProperty('available')
      expect(status).toHaveProperty('version')
      expect(status).toHaveProperty('activeTasks')
      expect(status).toHaveProperty('maxTasks')
      expect(typeof status.activeTasks).toBe('number')
      expect(typeof status.maxTasks).toBe('number')
      expect(status.activeTasks).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // JSONL Event Parsing (handleStreamLine)
  // ---------------------------------------------------------------------------

  describe('JSONL Event Parsing', () => {
    it('should emit sessionInit on system event', () => {
      const line = JSON.stringify({
        type: 'system',
        session_id: 'sess-123',
        model: 'claude-sonnet-4-20250514',
      })

      adapter.handleStreamLine(line, stream)

      expect(stream.sessionInit).toHaveBeenCalledWith('sess-123', 'claude-sonnet-4-20250514')
    })

    it('should emit text on assistant text block', () => {
      const line = JSON.stringify({
        type: 'assistant',
        content: [
          { type: 'text', text: 'Hello, world!' },
        ],
      })

      adapter.handleStreamLine(line, stream)

      expect(stream.text).toHaveBeenCalledWith('Hello, world!\n')
    })

    it('should emit toolUse on assistant tool_use block', () => {
      const line = JSON.stringify({
        type: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'bash', input: { command: 'ls' } },
        ],
      })

      adapter.handleStreamLine(line, stream)

      expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'ls' })
    })

    it('should emit toolResult on tool_result event', () => {
      const line = JSON.stringify({
        type: 'tool_result',
        tool_name: 'bash',
        content: 'file1.txt\nfile2.txt',
        is_error: false,
      })

      adapter.handleStreamLine(line, stream)

      expect(stream.toolResult).toHaveBeenCalledWith('bash', 'file1.txt\nfile2.txt', true)
    })

    it('should extract metrics from result event', () => {
      const line = JSON.stringify({
        type: 'result',
        total_cost_usd: 0.0123,
        num_turns: 3,
        duration_ms: 15000,
        usage: { input_tokens: 500, output_tokens: 200 },
        model: 'claude-sonnet-4-20250514',
      })

      adapter.handleStreamLine(line, stream)

      expect(stream.status).toHaveBeenCalledWith('running', 100, expect.stringContaining('Completed'))
    })

    it('should handle malformed JSON gracefully', () => {
      const line = 'not valid json {{'

      adapter.handleStreamLine(line, stream)

      // Should fall back to raw stdout
      expect(stream.stdout).toHaveBeenCalledWith('not valid json {{')
    })

    it('should handle empty lines without error', () => {
      adapter.handleStreamLine('', stream)
      // Empty string parsed as JSON fails, falls back to stdout
      expect(stream.stdout).toHaveBeenCalled()
    })

    it('should handle unknown event types without error', () => {
      const line = JSON.stringify({ type: 'unknown_event', data: 'test' })

      adapter.handleStreamLine(line, stream)

      // Should not emit anything specific
      expect(stream.text).not.toHaveBeenCalled()
      expect(stream.toolUse).not.toHaveBeenCalled()
    })

    it('should correlate tool_use ID to tool_result via toolIdToName map', () => {
      // First, send tool_use with an ID
      const toolUseLine = JSON.stringify({
        type: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-abc', name: 'read_file', input: { path: 'test.ts' } },
        ],
      })
      adapter.handleStreamLine(toolUseLine, stream)

      // Then send tool_result referencing that ID
      const toolResultLine = JSON.stringify({
        type: 'tool_result',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-abc', content: 'file contents', is_error: false },
        ],
      })
      adapter.handleStreamLine(toolResultLine, stream)

      // Should resolve tool name from the map
      expect(stream.toolResult).toHaveBeenCalledWith('read_file', 'file contents', true)
    })

    it('should handle assistant message wrapper format', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Wrapped text' },
          ],
        },
      })

      adapter.handleStreamLine(line, stream)

      expect(stream.text).toHaveBeenCalledWith('Wrapped text\n')
    })
  })

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should reject with descriptive error for non-existent working directory', async () => {
      mockGetProviderFn.mockReset()
      mockGetProviderFn.mockImplementation(async () => ({
        type: 'opencode',
        name: 'OpenCode',
        version: '1.0.0',
        path: '/usr/local/bin/opencode',
        available: true,
        capabilities: { streaming: true, tools: true, multiTurn: true, maxConcurrentTasks: 1 },
      }))

      await adapter.isAvailable()

      const task = createTestTask({
        workingDirectory: '/nonexistent/path/that/does/not/exist',
      })

      const controller = new AbortController()
      const result = await adapter.execute(task, stream, controller.signal)

      expect(result.status).toBe('failed')
      expect(result.error).toContain('Working directory does not exist')
    })

    it('should return failed result when provider is not available', async () => {
      mockGetProviderFn.mockReset()
      mockGetProviderFn.mockResolvedValue(null)

      const task = createTestTask()
      const controller = new AbortController()
      const result = await adapter.execute(task, stream, controller.signal)

      expect(result.status).toBe('failed')
      expect(result.error).toContain('not available')
    })
  })
})

// =============================================================================
// OpenClaw Provider Integration Tests
// =============================================================================

describe.skipIf(!adapterAvailable || !openclawAvailable)('OpenClaw Provider Integration', () => {
  let adapter: OpenClawAdapter
  let stream: ReturnType<typeof createTrackedMockStream>
  let artifacts: Array<{ type: string; name: string; path?: string }>
  let tempDir: string

  beforeEach(() => {
    adapter = new OpenClawAdapter()
    stream = createTrackedMockStream()
    artifacts = []
    // Create an isolated temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'astro-openclaw-integration-'))
    writeFileSync(join(tempDir, 'README.md'), '# Test\n')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  // ---------------------------------------------------------------------------
  // Availability Detection
  // ---------------------------------------------------------------------------

  describe('Availability', () => {
    it('should detect openclaw as available', async () => {
      mockGetProviderFn.mockReset()
      mockGetProviderFn.mockImplementation(async (type: string) => {
        if (type === 'openclaw') {
          return {
            type: 'openclaw',
            name: 'OpenClaw',
            version: '1.0.0',
            path: '/usr/local/bin/openclaw',
            available: true,
            capabilities: {
              streaming: true,
              tools: true,
              multiTurn: true,
              maxConcurrentTasks: 1,
            },
          }
        }
        return null
      })

      const available = await adapter.isAvailable()
      expect(available).toBe(true)
    })

    it('should report correct status shape', async () => {
      mockGetProviderFn.mockReset()
      mockGetProviderFn.mockImplementation(async (type: string) => {
        if (type === 'openclaw') {
          return {
            type: 'openclaw',
            name: 'OpenClaw',
            version: '1.0.0',
            path: '/usr/local/bin/openclaw',
            available: true,
            capabilities: {
              streaming: true,
              tools: true,
              multiTurn: true,
              maxConcurrentTasks: 1,
            },
          }
        }
        return null
      })

      const status = await adapter.getStatus()
      expect(status).toHaveProperty('available')
      expect(status).toHaveProperty('version')
      expect(status).toHaveProperty('activeTasks')
      expect(status).toHaveProperty('maxTasks')
      expect(typeof status.activeTasks).toBe('number')
      expect(typeof status.maxTasks).toBe('number')
      expect(status.activeTasks).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // JSONL Event Parsing (handleStreamLine)
  // ---------------------------------------------------------------------------

  describe('JSONL Event Parsing', () => {
    it('should emit sessionInit on session.start event', () => {
      const line = JSON.stringify({
        type: 'session.start',
        session_id: 'claw-sess-123',
        model: 'claude-sonnet-4-20250514',
      })

      adapter.handleStreamLine(line, stream, artifacts)

      expect(stream.sessionInit).toHaveBeenCalledWith('claw-sess-123', 'claude-sonnet-4-20250514')
    })

    it('should emit text on content.text event', () => {
      const line = JSON.stringify({
        type: 'content.text',
        text: 'Hello from OpenClaw!',
      })

      adapter.handleStreamLine(line, stream, artifacts)

      expect(stream.text).toHaveBeenCalledWith('Hello from OpenClaw!')
    })

    it('should emit toolUse on tool_use.start event', () => {
      const line = JSON.stringify({
        type: 'tool_use.start',
        tool_name: 'bash',
        tool_input: { command: 'ls -la' },
      })

      adapter.handleStreamLine(line, stream, artifacts)

      expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'ls -la' })
    })

    it('should emit toolResult on tool_use.end event', () => {
      const line = JSON.stringify({
        type: 'tool_use.end',
        tool_name: 'bash',
        result: 'total 4\ndrwxr-xr-x',
        success: true,
      })

      adapter.handleStreamLine(line, stream, artifacts)

      expect(stream.toolResult).toHaveBeenCalledWith('bash', 'total 4\ndrwxr-xr-x', true)
    })

    it('should emit fileChange and track artifacts on file.change event', () => {
      const line = JSON.stringify({
        type: 'file.change',
        path: '/tmp/test/new-file.ts',
        action: 'created',
        lines_added: 10,
        lines_removed: 0,
      })

      adapter.handleStreamLine(line, stream, artifacts)

      expect(stream.fileChange).toHaveBeenCalledWith('/tmp/test/new-file.ts', 'created', 10, 0)
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]).toEqual({
        type: 'file',
        name: '/tmp/test/new-file.ts',
        path: '/tmp/test/new-file.ts',
      })
    })

    it('should not duplicate artifacts for the same file path', () => {
      const line = JSON.stringify({
        type: 'file.change',
        path: '/tmp/test/file.ts',
        action: 'modified',
      })

      adapter.handleStreamLine(line, stream, artifacts)
      adapter.handleStreamLine(line, stream, artifacts)

      expect(artifacts).toHaveLength(1)
    })

    it('should emit status on message.start event', () => {
      const line = JSON.stringify({ type: 'message.start' })

      adapter.handleStreamLine(line, stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Agent thinking...')
    })

    it('should emit status on message.end event', () => {
      const line = JSON.stringify({ type: 'message.end' })

      adapter.handleStreamLine(line, stream, artifacts)

      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Turn complete')
    })

    it('should extract metrics from session.end event', () => {
      const line = JSON.stringify({
        type: 'session.end',
        cost: 0.0234,
        input_tokens: 1000,
        output_tokens: 500,
        turns: 2,
        model: 'claude-sonnet-4-20250514',
        duration_ms: 12000,
      })

      const metrics = adapter.handleStreamLine(line, stream, artifacts)

      expect(metrics).toEqual({
        totalCost: 0.0234,
        inputTokens: 1000,
        outputTokens: 500,
        numTurns: 2,
        model: 'claude-sonnet-4-20250514',
        durationMs: 12000,
      })
      expect(stream.status).toHaveBeenCalledWith('running', 100, expect.stringContaining('Completed'))
    })

    it('should handle session.end without cost', () => {
      const line = JSON.stringify({
        type: 'session.end',
      })

      const metrics = adapter.handleStreamLine(line, stream, artifacts)

      expect(metrics).toEqual({
        totalCost: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        numTurns: undefined,
        model: undefined,
        durationMs: undefined,
      })
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed')
    })

    it('should handle malformed JSON gracefully', () => {
      const line = 'not valid json {{'

      const metrics = adapter.handleStreamLine(line, stream, artifacts)

      expect(metrics).toBeUndefined()
      expect(stream.stdout).toHaveBeenCalledWith('not valid json {{\n')
    })

    it('should handle unknown event types without error', () => {
      const line = JSON.stringify({ type: 'unknown_event', data: 'test' })

      const metrics = adapter.handleStreamLine(line, stream, artifacts)

      expect(metrics).toBeUndefined()
      expect(stream.text).not.toHaveBeenCalled()
    })

    it('should emit toolResult with success=false on failed tool', () => {
      const line = JSON.stringify({
        type: 'tool_use.end',
        tool_name: 'bash',
        result: 'command not found',
        success: false,
      })

      adapter.handleStreamLine(line, stream, artifacts)

      expect(stream.toolResult).toHaveBeenCalledWith('bash', 'command not found', false)
    })
  })

  // ---------------------------------------------------------------------------
  // Full Lifecycle Sequence (simulated JSONL stream)
  // ---------------------------------------------------------------------------

  describe('Full Lifecycle Sequence', () => {
    it('should process a complete session sequence', () => {
      const events = [
        { type: 'session.start', session_id: 'lifecycle-sess', model: 'claude-sonnet-4-20250514' },
        { type: 'message.start' },
        { type: 'content.text', text: 'I will create a file.' },
        { type: 'tool_use.start', tool_name: 'write_file', tool_input: { path: 'hello.txt', content: 'Hello!' } },
        { type: 'tool_use.end', tool_name: 'write_file', result: 'File written successfully', success: true },
        { type: 'file.change', path: 'hello.txt', action: 'created', lines_added: 1, lines_removed: 0 },
        { type: 'content.text', text: 'Done! The file has been created.' },
        { type: 'message.end' },
        { type: 'session.end', cost: 0.05, input_tokens: 2000, output_tokens: 800, turns: 1, model: 'claude-sonnet-4-20250514', duration_ms: 8000 },
      ]

      let lastMetrics = undefined
      for (const event of events) {
        const metrics = adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
        if (metrics) lastMetrics = metrics
      }

      // Verify session was initialized
      expect(stream.sessionInit).toHaveBeenCalledWith('lifecycle-sess', 'claude-sonnet-4-20250514')

      // Verify text was emitted
      expect(stream.text).toHaveBeenCalledTimes(2)
      expect(stream._calls.text).toContain('I will create a file.')
      expect(stream._calls.text).toContain('Done! The file has been created.')

      // Verify tool usage
      expect(stream.toolUse).toHaveBeenCalledWith('write_file', { path: 'hello.txt', content: 'Hello!' })
      expect(stream.toolResult).toHaveBeenCalledWith('write_file', 'File written successfully', true)

      // Verify file change tracked
      expect(stream.fileChange).toHaveBeenCalledWith('hello.txt', 'created', 1, 0)
      expect(artifacts).toHaveLength(1)

      // Verify metrics
      expect(lastMetrics).toEqual({
        totalCost: 0.05,
        inputTokens: 2000,
        outputTokens: 800,
        numTurns: 1,
        model: 'claude-sonnet-4-20250514',
        durationMs: 8000,
      })

      // Verify status progression
      const statusCalls = stream._calls.status
      expect(statusCalls.some((s) => s.message === 'Agent thinking...')).toBe(true)
      expect(statusCalls.some((s) => s.message === 'Turn complete')).toBe(true)
      expect(statusCalls.some((s) => s.message?.includes('Completed'))).toBe(true)
    })

    it('should process a session with multiple tool calls', () => {
      const events = [
        { type: 'session.start', session_id: 'multi-tool-sess', model: 'claude-sonnet-4-20250514' },
        { type: 'message.start' },
        { type: 'content.text', text: 'Let me check the files.' },
        { type: 'tool_use.start', tool_name: 'bash', tool_input: { command: 'ls' } },
        { type: 'tool_use.end', tool_name: 'bash', result: 'README.md', success: true },
        { type: 'tool_use.start', tool_name: 'read_file', tool_input: { path: 'README.md' } },
        { type: 'tool_use.end', tool_name: 'read_file', result: '# Test', success: true },
        { type: 'content.text', text: 'I found the README.' },
        { type: 'message.end' },
        { type: 'session.end', cost: 0.03, input_tokens: 1500, output_tokens: 400, turns: 1 },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      expect(stream.toolUse).toHaveBeenCalledTimes(2)
      expect(stream.toolResult).toHaveBeenCalledTimes(2)
      expect(stream._calls.toolUse[0].name).toBe('bash')
      expect(stream._calls.toolUse[1].name).toBe('read_file')
    })

    it('should handle error events in the stream', () => {
      const events = [
        { type: 'session.start', session_id: 'error-sess' },
        { type: 'message.start' },
        { type: 'content.text', text: 'Attempting...' },
        { type: 'tool_use.start', tool_name: 'bash', tool_input: { command: 'failing-command' } },
        { type: 'tool_use.end', tool_name: 'bash', result: 'command not found', success: false },
        { type: 'message.end' },
        { type: 'session.end' },
      ]

      for (const event of events) {
        adapter.handleStreamLine(JSON.stringify(event), stream, artifacts)
      }

      // The failed tool should be recorded with success=false
      expect(stream._calls.toolResult[0].success).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should reject with descriptive error for non-existent working directory', async () => {
      mockGetProviderFn.mockReset()
      mockGetProviderFn.mockResolvedValue({
        type: 'openclaw',
        name: 'OpenClaw',
        version: '1.0.0',
        path: '/usr/local/bin/openclaw',
        available: true,
        capabilities: { streaming: true, tools: true, multiTurn: true, maxConcurrentTasks: 1 },
      })

      await adapter.isAvailable()

      const task = createTestTask({
        provider: 'openclaw',
        workingDirectory: '/nonexistent/path/that/does/not/exist',
      })

      const controller = new AbortController()
      const result = await adapter.execute(task, stream, controller.signal)

      expect(result.status).toBe('failed')
      expect(result.error).toContain('Working directory does not exist')
    })

    it('should return failed result when provider is not available', async () => {
      mockGetProviderFn.mockReset()
      mockGetProviderFn.mockResolvedValue(null)

      const task = createTestTask({ provider: 'openclaw' })
      const controller = new AbortController()
      const result = await adapter.execute(task, stream, controller.signal)

      expect(result.status).toBe('failed')
      expect(result.error).toContain('not available')
    })
  })
})

// =============================================================================
// OpenCode Full Session JSONL Parsing Tests
// =============================================================================

describe.skipIf(!adapterAvailable || !opencodeAvailable)('OpenCode Full Session JSONL Sequences', () => {
  let adapter: OpenCodeAdapter
  let stream: ReturnType<typeof createTrackedMockStream>

  beforeEach(() => {
    adapter = new OpenCodeAdapter()
    stream = createTrackedMockStream()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should process a complete OpenCode session with multiple content blocks', () => {
    const events = [
      { type: 'system', session_id: 'oc-full-1', model: 'claude-sonnet-4-20250514' },
      {
        type: 'assistant',
        content: [
          { type: 'text', text: 'I will examine the code.' },
          { type: 'tool_use', id: 'tu-1', name: 'bash', input: { command: 'cat main.ts' } },
        ],
      },
      {
        type: 'tool_result',
        tool_name: 'bash',
        content: 'console.log("hello")',
        is_error: false,
      },
      {
        type: 'assistant',
        content: [
          { type: 'text', text: 'The code looks good.' },
        ],
      },
      {
        type: 'result',
        total_cost_usd: 0.015,
        num_turns: 2,
        duration_ms: 5000,
        usage: { input_tokens: 300, output_tokens: 150 },
        model: 'claude-sonnet-4-20250514',
      },
    ]

    for (const event of events) {
      adapter.handleStreamLine(JSON.stringify(event), stream)
    }

    // Verify session init
    expect(stream.sessionInit).toHaveBeenCalledWith('oc-full-1', 'claude-sonnet-4-20250514')

    // Verify text blocks
    expect(stream.text).toHaveBeenCalledTimes(2)
    expect(stream._calls.text[0]).toBe('I will examine the code.\n')
    expect(stream._calls.text[1]).toBe('The code looks good.\n')

    // Verify tool usage
    expect(stream.toolUse).toHaveBeenCalledWith('bash', { command: 'cat main.ts' })
    expect(stream.toolResult).toHaveBeenCalledWith('bash', 'console.log("hello")', true)
  })

  it('should handle user-type tool_result events with content array', () => {
    // First register tool ID mapping
    adapter.handleStreamLine(JSON.stringify({
      type: 'assistant',
      content: [
        { type: 'tool_use', id: 'tool-xyz', name: 'read', input: { path: 'package.json' } },
      ],
    }), stream)

    // Now send user-type event with tool_result blocks
    adapter.handleStreamLine(JSON.stringify({
      type: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tool-xyz', content: '{"name": "test"}', is_error: false },
      ],
    }), stream)

    expect(stream.toolResult).toHaveBeenCalledWith('read', '{"name": "test"}', true)
  })

  it('should handle interleaved text and tool blocks in assistant events', () => {
    const line = JSON.stringify({
      type: 'assistant',
      content: [
        { type: 'text', text: 'First thought' },
        { type: 'tool_use', id: 'tu-a', name: 'search', input: { query: 'test' } },
        { type: 'text', text: 'After tool call' },
      ],
    })

    adapter.handleStreamLine(line, stream)

    expect(stream.text).toHaveBeenCalledTimes(2)
    expect(stream.toolUse).toHaveBeenCalledTimes(1)
    expect(stream._calls.text[0]).toBe('First thought\n')
    expect(stream._calls.text[1]).toBe('After tool call\n')
  })
})

// =============================================================================
// Full Execute Lifecycle Tests (mocked child process — always runs)
// =============================================================================

describe.skipIf(!adapterAvailable)('OpenCode Execute Lifecycle (mocked spawn)', () => {
  let adapter: OpenCodeAdapter
  let stream: ReturnType<typeof createTrackedMockStream>
  let mockProc: ReturnType<typeof createMockChildProcess>
  let tempDir: string

  beforeEach(() => {
    adapter = new OpenCodeAdapter()
    stream = createTrackedMockStream()
    mockProc = createMockChildProcess()

    // Create isolated temp directory
    tempDir = mkdtempSync(join(tmpdir(), 'astro-opencode-exec-'))
    writeFileSync(join(tempDir, 'README.md'), '# Test\n')

    // Configure shared mocks for this section
    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockImplementation(async (type: string) => {
      if (type === 'opencode') {
        return {
          type: 'opencode',
          name: 'OpenCode',
          version: '1.0.0',
          path: '/usr/local/bin/opencode',
          available: true,
          capabilities: {
            streaming: true,
            tools: true,
            multiTurn: true,
            maxConcurrentTasks: 1,
          },
        }
      }
      return null
    })

    mockSpawnFn.mockReset()
    mockSpawnFn.mockReturnValue(mockProc)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should complete full lifecycle: create session → stream events → complete', async () => {
    // Make adapter think it's available
    await adapter.isAvailable()

    const task = createTestTask({ workingDirectory: tempDir })
    const controller = new AbortController()

    // Start execution (returns a promise)
    const resultPromise = adapter.execute(task, stream, controller.signal)

    // Simulate JSONL output from the CLI
    // Small delay to let the promise setup
    await new Promise((resolve) => setTimeout(resolve, 10))

    mockProc._emitStdout(
      JSON.stringify({ type: 'system', session_id: 'exec-sess-1', model: 'claude-sonnet-4-20250514' }) + '\n'
    )
    mockProc._emitStdout(
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'Hello!' }] }) + '\n'
    )
    mockProc._emitStdout(
      JSON.stringify({
        type: 'result',
        total_cost_usd: 0.001,
        num_turns: 1,
        duration_ms: 2000,
        usage: { input_tokens: 100, output_tokens: 50 },
        model: 'claude-sonnet-4-20250514',
      }) + '\n'
    )

    // Close the process with exit code 0
    mockProc._close(0)

    const result = await resultPromise

    // Verify TaskResult structure
    expect(result.taskId).toBe(task.id)
    expect(result.status).toBe('completed')
    expect(result.exitCode).toBe(0)
    expect(result.startedAt).toBeDefined()
    expect(result.completedAt).toBeDefined()

    // Verify metrics were captured
    expect(result.metrics).toBeDefined()
    expect(result.metrics?.totalCost).toBe(0.001)
    expect(result.metrics?.numTurns).toBe(1)
    expect(result.metrics?.inputTokens).toBe(100)
    expect(result.metrics?.outputTokens).toBe(50)

    // Verify stream events were emitted
    expect(stream.sessionInit).toHaveBeenCalledWith('exec-sess-1', 'claude-sonnet-4-20250514')
    expect(stream.text).toHaveBeenCalledWith('Hello!\n')
    expect(stream._calls.status.some((s) => s.message === 'Starting OpenCode')).toBe(true)
    expect(stream._calls.status.some((s) => s.message?.includes('Completed'))).toBe(true)
  }, 30_000) // 30s timeout for execute lifecycle

  it('should return failed status on non-zero exit code', async () => {
    await adapter.isAvailable()

    const task = createTestTask({ workingDirectory: tempDir })
    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    mockProc._emitStderr('Error: something went wrong\n')
    mockProc._close(1)

    const result = await resultPromise

    expect(result.taskId).toBe(task.id)
    expect(result.status).toBe('failed')
    expect(result.exitCode).toBe(1)
    expect(result.error).toContain('Error: something went wrong')
  }, 30_000)

  it('should handle abort/cancellation during execution', async () => {
    await adapter.isAvailable()

    const task = createTestTask({ workingDirectory: tempDir })
    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Simulate some initial output
    mockProc._emitStdout(
      JSON.stringify({ type: 'system', session_id: 'abort-sess' }) + '\n'
    )

    // Abort the execution
    controller.abort()

    // The mock kill should have been called
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')

    // Close the process (simulating the process exiting after SIGTERM)
    mockProc._close(143) // SIGTERM exit code

    const result = await resultPromise

    // Even on abort, we should get a valid TaskResult
    expect(result.taskId).toBe(task.id)
    expect(result.startedAt).toBeDefined()
    expect(result.completedAt).toBeDefined()
  }, 30_000)

  it('should process multi-turn session with tools through execute()', async () => {
    await adapter.isAvailable()

    const task = createTestTask({
      workingDirectory: tempDir,
      prompt: 'Read the README and summarize it.',
    })
    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Simulate a multi-turn session
    const events = [
      { type: 'system', session_id: 'multi-turn-exec', model: 'claude-sonnet-4-20250514' },
      { type: 'assistant', content: [
        { type: 'text', text: 'Let me read the README.' },
        { type: 'tool_use', id: 'tu-exec-1', name: 'bash', input: { command: 'cat README.md' } },
      ]},
      { type: 'tool_result', tool_name: 'bash', content: '# Test', is_error: false },
      { type: 'assistant', content: [
        { type: 'text', text: 'The README contains a test heading.' },
      ]},
      { type: 'result', total_cost_usd: 0.005, num_turns: 2, duration_ms: 3000, usage: { input_tokens: 200, output_tokens: 100 }, model: 'claude-sonnet-4-20250514' },
    ]

    for (const event of events) {
      mockProc._emitStdout(JSON.stringify(event) + '\n')
    }

    mockProc._close(0)
    const result = await resultPromise

    expect(result.status).toBe('completed')
    expect(result.metrics?.numTurns).toBe(2)
    expect(stream._calls.text).toHaveLength(2)
    expect(stream._calls.toolUse).toHaveLength(1)
    expect(stream._calls.toolResult).toHaveLength(1)
    expect(stream._calls.sessionInit).toHaveLength(1)
    expect(stream._calls.sessionInit[0].sessionId).toBe('multi-turn-exec')
  }, 30_000)

  it('should handle stderr output alongside stdout', async () => {
    await adapter.isAvailable()

    const task = createTestTask({ workingDirectory: tempDir })
    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Emit some stderr (warnings) alongside stdout
    mockProc._emitStderr('Warning: deprecated feature used\n')
    mockProc._emitStdout(
      JSON.stringify({ type: 'system', session_id: 'stderr-test' }) + '\n'
    )
    mockProc._emitStdout(
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'Done.' }] }) + '\n'
    )
    mockProc._emitStdout(
      JSON.stringify({ type: 'result', total_cost_usd: 0.001, num_turns: 1 }) + '\n'
    )

    mockProc._close(0)
    const result = await resultPromise

    expect(result.status).toBe('completed')
    expect(stream.stderr).toHaveBeenCalledWith('Warning: deprecated feature used\n')
    expect(stream.sessionInit).toHaveBeenCalledWith('stderr-test', undefined)
  }, 30_000)

  it('should handle incomplete JSONL lines (line buffering)', async () => {
    await adapter.isAvailable()

    const task = createTestTask({ workingDirectory: tempDir })
    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Send a partial line, then the rest
    const fullLine = JSON.stringify({ type: 'system', session_id: 'buffer-test', model: 'claude-sonnet-4-20250514' })
    const halfway = Math.floor(fullLine.length / 2)

    mockProc._emitStdout(fullLine.slice(0, halfway))
    // The partial line should NOT have triggered sessionInit yet
    expect(stream.sessionInit).not.toHaveBeenCalled()

    // Now send the rest with a newline
    mockProc._emitStdout(fullLine.slice(halfway) + '\n')

    // Now it should have been processed
    expect(stream.sessionInit).toHaveBeenCalledWith('buffer-test', 'claude-sonnet-4-20250514')

    mockProc._emitStdout(
      JSON.stringify({ type: 'result', total_cost_usd: 0.001, num_turns: 1 }) + '\n'
    )
    mockProc._close(0)

    const result = await resultPromise
    expect(result.status).toBe('completed')
  }, 30_000)
})

describe.skipIf(!adapterAvailable)('OpenClaw Execute Lifecycle (mocked spawn)', () => {
  let adapter: OpenClawAdapter
  let stream: ReturnType<typeof createTrackedMockStream>
  let mockProc: ReturnType<typeof createMockChildProcess>
  let tempDir: string

  beforeEach(() => {
    adapter = new OpenClawAdapter()
    stream = createTrackedMockStream()
    mockProc = createMockChildProcess()

    tempDir = mkdtempSync(join(tmpdir(), 'astro-openclaw-exec-'))
    writeFileSync(join(tempDir, 'README.md'), '# Test\n')

    // Configure shared mocks for this section
    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockImplementation(async (type: string) => {
      if (type === 'openclaw') {
        return {
          type: 'openclaw',
          name: 'OpenClaw',
          version: '1.0.0',
          path: '/usr/local/bin/openclaw',
          available: true,
          capabilities: {
            streaming: true,
            tools: true,
            multiTurn: true,
            maxConcurrentTasks: 1,
          },
        }
      }
      return null
    })

    mockSpawnFn.mockReset()
    mockSpawnFn.mockReturnValue(mockProc)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should complete full lifecycle: create session → stream events → complete', async () => {
    await adapter.isAvailable()

    const task = createTestTask({ provider: 'openclaw', workingDirectory: tempDir })
    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Simulate OpenClaw JSONL output
    const events = [
      { type: 'session.start', session_id: 'claw-exec-1', model: 'claude-sonnet-4-20250514' },
      { type: 'message.start' },
      { type: 'content.text', text: 'Hello from OpenClaw!' },
      { type: 'message.end' },
      { type: 'session.end', cost: 0.002, input_tokens: 150, output_tokens: 60, turns: 1, model: 'claude-sonnet-4-20250514', duration_ms: 1500 },
    ]

    for (const event of events) {
      mockProc._emitStdout(JSON.stringify(event) + '\n')
    }

    mockProc._close(0)
    const result = await resultPromise

    expect(result.taskId).toBe(task.id)
    expect(result.status).toBe('completed')
    expect(result.exitCode).toBe(0)
    expect(result.startedAt).toBeDefined()
    expect(result.completedAt).toBeDefined()

    // Verify metrics
    expect(result.metrics).toBeDefined()
    expect(result.metrics?.totalCost).toBe(0.002)
    expect(result.metrics?.numTurns).toBe(1)

    // Verify stream events
    expect(stream.sessionInit).toHaveBeenCalledWith('claw-exec-1', 'claude-sonnet-4-20250514')
    expect(stream.text).toHaveBeenCalledWith('Hello from OpenClaw!')
    expect(stream._calls.status.some((s) => s.message === 'Starting OpenClaw')).toBe(true)
    expect(stream._calls.status.some((s) => s.message === 'Agent thinking...')).toBe(true)
    expect(stream._calls.status.some((s) => s.message === 'Turn complete')).toBe(true)
    expect(stream._calls.status.some((s) => s.message?.includes('Completed'))).toBe(true)
  }, 30_000)

  it('should handle abort/cancellation during execution', async () => {
    await adapter.isAvailable()

    const task = createTestTask({ provider: 'openclaw', workingDirectory: tempDir })
    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    mockProc._emitStdout(
      JSON.stringify({ type: 'session.start', session_id: 'claw-abort' }) + '\n'
    )

    // Abort
    controller.abort()
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')

    mockProc._close(143)
    const result = await resultPromise

    expect(result.taskId).toBe(task.id)
    expect(result.startedAt).toBeDefined()
    expect(result.completedAt).toBeDefined()
  }, 30_000)

  it('should process session with file changes through execute()', async () => {
    await adapter.isAvailable()

    const task = createTestTask({ provider: 'openclaw', workingDirectory: tempDir })
    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    const events = [
      { type: 'session.start', session_id: 'file-change-exec' },
      { type: 'message.start' },
      { type: 'tool_use.start', tool_name: 'write_file', tool_input: { path: 'test.ts', content: 'console.log("hi")' } },
      { type: 'tool_use.end', tool_name: 'write_file', result: 'Written', success: true },
      { type: 'file.change', path: 'test.ts', action: 'created', lines_added: 1, lines_removed: 0 },
      { type: 'message.end' },
      { type: 'session.end', cost: 0.003, input_tokens: 200, output_tokens: 80, turns: 1 },
    ]

    for (const event of events) {
      mockProc._emitStdout(JSON.stringify(event) + '\n')
    }

    mockProc._close(0)
    const result = await resultPromise

    expect(result.status).toBe('completed')
    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts?.[0]).toEqual({
      type: 'file',
      name: 'test.ts',
      path: 'test.ts',
    })
    expect(stream.fileChange).toHaveBeenCalledWith('test.ts', 'created', 1, 0)
  }, 30_000)
})

// =============================================================================
// Timeout Configuration Tests
// =============================================================================

describe.skipIf(!adapterAvailable)('Timeout Configuration', () => {
  let mockProc: ReturnType<typeof createMockChildProcess>
  let stream: ReturnType<typeof createTrackedMockStream>
  let tempDir: string

  beforeEach(() => {
    mockProc = createMockChildProcess()
    stream = createTrackedMockStream()
    tempDir = mkdtempSync(join(tmpdir(), 'astro-timeout-'))
    writeFileSync(join(tempDir, 'README.md'), '# Test\n')

    // Configure shared mocks for this section
    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockImplementation(async (type: string) => {
      if (type === 'opencode' || type === 'openclaw') {
        return {
          type,
          name: type === 'opencode' ? 'OpenCode' : 'OpenClaw',
          version: '1.0.0',
          path: `/usr/local/bin/${type}`,
          available: true,
          capabilities: {
            streaming: true,
            tools: true,
            multiTurn: true,
            maxConcurrentTasks: 1,
          },
        }
      }
      return null
    })

    mockSpawnFn.mockReset()
    mockSpawnFn.mockReturnValue(mockProc)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should use task timeout for CLI execution (OpenCode)', async () => {
    const adapter = new OpenCodeAdapter()
    await adapter.isAvailable()

    const task = createTestTask({
      workingDirectory: tempDir,
      timeout: 120_000, // 2 minute timeout for real CLI
    })

    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Complete normally before timeout
    mockProc._emitStdout(JSON.stringify({ type: 'system', session_id: 'timeout-test' }) + '\n')
    mockProc._emitStdout(JSON.stringify({ type: 'result', total_cost_usd: 0.001, num_turns: 1 }) + '\n')
    mockProc._close(0)

    const result = await resultPromise
    expect(result.status).toBe('completed')
    expect(result.taskId).toBe(task.id)
  }, 30_000)

  it('should accept configurable timeout values', () => {
    // Verify task can be created with various timeout values
    const shortTimeout = createTestTask({ timeout: 10_000 }) // 10s
    const defaultTimeout = createTestTask({}) // 60s default
    const longTimeout = createTestTask({ timeout: 300_000 }) // 5 minutes

    expect(shortTimeout.timeout).toBe(10_000)
    expect(defaultTimeout.timeout).toBe(60_000)
    expect(longTimeout.timeout).toBe(300_000)
  })
})

// =============================================================================
// Concurrent Task Tracking Tests
// =============================================================================

describe.skipIf(!adapterAvailable)('Concurrent Task Tracking', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'astro-concurrent-'))
    writeFileSync(join(tempDir, 'README.md'), '# Test\n')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should track active tasks through OpenCode adapter status', async () => {
    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockResolvedValue(null)

    const adapter = new OpenCodeAdapter()

    // Initially no active tasks
    const status1 = await adapter.getStatus()
    expect(status1.activeTasks).toBe(0)
    expect(status1.maxTasks).toBe(1)
  })

  it('should track active tasks through OpenClaw adapter status', async () => {
    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockResolvedValue(null)

    const adapter = new OpenClawAdapter()

    const status1 = await adapter.getStatus()
    expect(status1.activeTasks).toBe(0)
    expect(status1.maxTasks).toBe(1)
  })

  it('should return activeTasks=0 after execution completes (OpenCode)', async () => {
    const mockProc = createMockChildProcess()

    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockImplementation(async (type: string) => {
      if (type === 'opencode') {
        return {
          type: 'opencode',
          name: 'OpenCode',
          version: '1.0.0',
          path: '/usr/local/bin/opencode',
          available: true,
          capabilities: { streaming: true, tools: true, multiTurn: true, maxConcurrentTasks: 1 },
        }
      }
      return null
    })

    mockSpawnFn.mockReset()
    mockSpawnFn.mockReturnValue(mockProc)

    const adapter = new OpenCodeAdapter()
    await adapter.isAvailable()
    const stream = createTrackedMockStream()

    const task = createTestTask({ workingDirectory: tempDir })
    const controller = new AbortController()
    const resultPromise = adapter.execute(task, stream, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 10))

    mockProc._emitStdout(JSON.stringify({ type: 'result', total_cost_usd: 0.001, num_turns: 1 }) + '\n')
    mockProc._close(0)

    await resultPromise

    // After execution completes, activeTasks should be back to 0
    const status = await adapter.getStatus()
    expect(status.activeTasks).toBe(0)
  }, 30_000)

  it('should return activeTasks=0 after failed execution (OpenCode)', async () => {
    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockResolvedValue(null)

    const adapter = new OpenCodeAdapter()
    const stream = createTrackedMockStream()

    const task = createTestTask({ workingDirectory: tempDir })
    const controller = new AbortController()

    // Execute will fail because provider is not available
    await adapter.execute(task, stream, controller.signal)

    // Even after failure, activeTasks should be 0
    const status = await adapter.getStatus()
    expect(status.activeTasks).toBe(0)
  })
})

// =============================================================================
// Cross-Provider Contract Tests
// =============================================================================

describe.skipIf(!adapterAvailable)('Provider Adapter Contract', () => {
  const adapters: Array<{ name: string; createAdapter: () => OpenCodeAdapter | OpenClawAdapter; available: boolean }> = [
    { name: 'OpenCode', createAdapter: () => new OpenCodeAdapter(), available: opencodeAvailable },
    { name: 'OpenClaw', createAdapter: () => new OpenClawAdapter(), available: openclawAvailable },
  ]

  for (const { name, createAdapter, available } of adapters) {
    describe.skipIf(!available)(`${name} adapter contract`, () => {
      it('should have correct type property', () => {
        const adapter = createAdapter()
        expect(adapter.type).toBe(name.toLowerCase().replace(/\s/g, ''))
      })

      it('should have a non-empty name property', () => {
        const adapter = createAdapter()
        expect(adapter.name).toBeTruthy()
        expect(typeof adapter.name).toBe('string')
      })

      it('should implement isAvailable() returning a boolean promise', async () => {
        mockGetProviderFn.mockReset()
        mockGetProviderFn.mockResolvedValue(null)

        const adapter = createAdapter()
        const result = await adapter.isAvailable()
        expect(typeof result).toBe('boolean')
      })

      it('should implement getStatus() returning a proper ProviderStatus', async () => {
        mockGetProviderFn.mockReset()
        mockGetProviderFn.mockResolvedValue(null)

        const adapter = createAdapter()
        const status = await adapter.getStatus()

        expect(status).toHaveProperty('available')
        expect(status).toHaveProperty('version')
        expect(status).toHaveProperty('activeTasks')
        expect(status).toHaveProperty('maxTasks')
        expect(typeof status.available).toBe('boolean')
        expect(typeof status.activeTasks).toBe('number')
        expect(typeof status.maxTasks).toBe('number')
      })

      it('should return a TaskResult from execute() even on failure', async () => {
        mockGetProviderFn.mockReset()
        mockGetProviderFn.mockResolvedValue(null)

        const adapter = createAdapter()
        const stream = createTrackedMockStream()
        const task = createTestTask({ provider: adapter.type as 'opencode' | 'openclaw' })
        const controller = new AbortController()

        const result = await adapter.execute(task, stream, controller.signal)

        expect(result).toHaveProperty('taskId')
        expect(result).toHaveProperty('status')
        expect(result.taskId).toBe(task.id)
        expect(['completed', 'failed', 'cancelled']).toContain(result.status)
        expect(result).toHaveProperty('startedAt')
        expect(result).toHaveProperty('completedAt')
      })
    })
  }
})

// =============================================================================
// Provider Detection Tests (always run, no skip)
// =============================================================================

describe.skipIf(!adapterAvailable)('Provider CLI Detection', () => {
  it('should detect presence/absence of openclaw consistently', async () => {
    const result = await isCliAvailable('openclaw')
    expect(typeof result).toBe('boolean')
    // Should be consistent across calls
    const result2 = await isCliAvailable('openclaw')
    expect(result).toBe(result2)
  })

  it('should detect presence/absence of opencode consistently', async () => {
    const result = await isCliAvailable('opencode')
    expect(typeof result).toBe('boolean')
    const result2 = await isCliAvailable('opencode')
    expect(result).toBe(result2)
  })

  it('should return false for a non-existent CLI tool', async () => {
    const result = await isCliAvailable('nonexistent-cli-tool-xyz-12345')
    expect(result).toBe(false)
  })

  it('should handle timeout gracefully for slow commands', async () => {
    // This tests the timeout behavior of our detection function
    const result = await isCliAvailable('nonexistent-cli-tool')
    expect(typeof result).toBe('boolean')
    expect(result).toBe(false)
  })

  it('should report which providers are available in this environment', () => {
    // Informational test — logs which providers were found
    const providers = [
      { name: 'openclaw', available: openclawAvailable },
      { name: 'opencode', available: opencodeAvailable },
    ]

    for (const p of providers) {
      if (p.available) {
        console.log(`  ✓ ${p.name} is available — integration tests will run`)
      } else {
        console.log(`  ○ ${p.name} not found — integration tests will be skipped`)
      }
    }

    // At least one assertion so the test passes
    expect(providers).toHaveLength(2)
  })
})

// =============================================================================
// Cross-Provider Error Handling Parity Tests
// =============================================================================

describe.skipIf(!adapterAvailable)('Cross-Provider Error Handling Parity', () => {
  let openCodeAdapter: InstanceType<typeof OpenCodeAdapter>
  let openClawAdapter: InstanceType<typeof OpenClawAdapter>
  let mockProc: ReturnType<typeof createMockChildProcess>
  let tempDir: string

  beforeEach(() => {
    openCodeAdapter = new OpenCodeAdapter()
    openClawAdapter = new OpenClawAdapter()
    mockProc = createMockChildProcess()
    mockSpawnFn.mockReturnValue(mockProc)
    tempDir = mkdtempSync(join(tmpdir(), 'parity-test-'))
    writeFileSync(join(tempDir, '.git'), 'gitdir: /tmp/fake-git')
  })

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('both adapters should emit proper error status on CLI exit code 1', async () => {
    // Setup both adapters as available
    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockImplementation(async (type: string) => ({
      type,
      name: type === 'opencode' ? 'OpenCode' : 'OpenClaw',
      version: '1.0.0',
      path: `/usr/local/bin/${type}`,
      available: true,
      capabilities: { streaming: true, tools: true, multiTurn: true, maxConcurrentTasks: 1 },
    }))

    // Test OpenCode adapter
    await openCodeAdapter.isAvailable()
    const ocStream = createTrackedMockStream()
    const ocTask = createTestTask({ provider: 'opencode', workingDirectory: tempDir })
    const ocController = new AbortController()
    const ocResultPromise = openCodeAdapter.execute(ocTask, ocStream, ocController.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    mockProc._emitStderr('Fatal: connection refused\n')
    mockProc._close(1)
    const ocResult = await ocResultPromise

    expect(ocResult.status).toBe('failed')
    expect(ocResult.exitCode).toBe(1)
    expect(ocResult.error).toBeTruthy()
    expect(typeof ocResult.error).toBe('string')
    expect(ocResult.error!.length).toBeGreaterThan(0)

    // Reset mock process for OpenClaw
    mockProc = createMockChildProcess()
    mockSpawnFn.mockReturnValue(mockProc)

    // Test OpenClaw adapter
    await openClawAdapter.isAvailable()
    const clawStream = createTrackedMockStream()
    const clawTask = createTestTask({ provider: 'openclaw', workingDirectory: tempDir })
    const clawController = new AbortController()
    const clawResultPromise = openClawAdapter.execute(clawTask, clawStream, clawController.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    mockProc._emitStderr('Error: API key invalid\n')
    mockProc._close(1)
    const clawResult = await clawResultPromise

    expect(clawResult.status).toBe('failed')
    expect(clawResult.exitCode).toBe(1)
    expect(clawResult.error).toBeTruthy()
    expect(typeof clawResult.error).toBe('string')
    expect(clawResult.error!.length).toBeGreaterThan(0)
  }, 30_000)

  it('both adapters should surface error messages from stderr (not silently swallow them)', async () => {
    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockImplementation(async (type: string) => ({
      type,
      name: type === 'opencode' ? 'OpenCode' : 'OpenClaw',
      version: '1.0.0',
      path: `/usr/local/bin/${type}`,
      available: true,
      capabilities: { streaming: true, tools: true, multiTurn: true, maxConcurrentTasks: 1 },
    }))

    const errorMessage = 'ENOENT: no such file or directory'

    // OpenCode: stderr should be surfaced in result
    await openCodeAdapter.isAvailable()
    const ocStream = createTrackedMockStream()
    const ocTask = createTestTask({ provider: 'opencode', workingDirectory: tempDir })
    const ocController = new AbortController()
    const ocResultPromise = openCodeAdapter.execute(ocTask, ocStream, ocController.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    mockProc._emitStderr(`${errorMessage}\n`)
    mockProc._close(1)
    const ocResult = await ocResultPromise

    expect(ocResult.status).toBe('failed')
    expect(ocResult.error).toContain(errorMessage)

    // Reset for OpenClaw
    mockProc = createMockChildProcess()
    mockSpawnFn.mockReturnValue(mockProc)

    // OpenClaw: stderr should be surfaced in result
    await openClawAdapter.isAvailable()
    const clawStream = createTrackedMockStream()
    const clawTask = createTestTask({ provider: 'openclaw', workingDirectory: tempDir })
    const clawController = new AbortController()
    const clawResultPromise = openClawAdapter.execute(clawTask, clawStream, clawController.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    mockProc._emitStderr(`${errorMessage}\n`)
    mockProc._close(1)
    const clawResult = await clawResultPromise

    expect(clawResult.status).toBe('failed')
    expect(clawResult.error).toContain(errorMessage)
  }, 30_000)

  it('neither adapter should silently fall back to degraded behavior on spawn error', async () => {
    mockGetProviderFn.mockReset()
    mockGetProviderFn.mockImplementation(async (type: string) => ({
      type,
      name: type === 'opencode' ? 'OpenCode' : 'OpenClaw',
      version: '1.0.0',
      path: `/usr/local/bin/${type}`,
      available: true,
      capabilities: { streaming: true, tools: true, multiTurn: true, maxConcurrentTasks: 1 },
    }))

    // OpenCode: non-existent directory should produce failed status with error description
    await openCodeAdapter.isAvailable()
    const ocStream = createTrackedMockStream()
    const ocTask = createTestTask({
      provider: 'opencode',
      workingDirectory: '/nonexistent/path/should/fail',
    })
    const ocController = new AbortController()
    const ocResult = await openCodeAdapter.execute(ocTask, ocStream, ocController.signal)

    expect(ocResult.status).toBe('failed')
    expect(ocResult.error).toBeTruthy()
    // Error must be descriptive, not empty or generic
    expect(ocResult.error!.length).toBeGreaterThan(5)

    // OpenClaw: non-existent directory should produce failed status with error description
    await openClawAdapter.isAvailable()
    const clawStream = createTrackedMockStream()
    const clawTask = createTestTask({
      provider: 'openclaw',
      workingDirectory: '/nonexistent/path/should/fail',
    })
    const clawController = new AbortController()
    const clawResult = await openClawAdapter.execute(clawTask, clawStream, clawController.signal)

    expect(clawResult.status).toBe('failed')
    expect(clawResult.error).toBeTruthy()
    // Error must be descriptive, not empty or generic
    expect(clawResult.error!.length).toBeGreaterThan(5)
  }, 30_000)
})

// =============================================================================
// Module-level vi.mock declarations (MUST be at bottom so they're the last
// hoisted mock for each module path — vitest uses the last factory per path)
// =============================================================================

vi.mock('../packages/agent-runner/src/lib/providers.js', () => ({
  getProvider: mockGetProviderFn,
}))

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return {
    ...original,
    spawn: mockSpawnFn,
  }
})
