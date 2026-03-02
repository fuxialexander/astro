/**
 * Provider Integration Tests
 *
 * Full lifecycle integration tests for OpenClaw and OpenCode provider adapters.
 * Tests create a real session, send a prompt, stream events, and verify completion.
 *
 * Auto-skips when providers aren't installed on the system.
 * Uses `which openclaw` / `which opencode` to detect availability.
 *
 * Requires:
 * - openclaw or opencode CLI installed and on PATH
 * - Valid API keys configured for the respective provider
 * - A writable temp directory for task working directories
 *
 * Run: npx vitest tests/provider-integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { type ChildProcess, spawn } from 'node:child_process'

// ============================================================================
// Provider availability detection (runs at module load)
// ============================================================================

function isCommandAvailable(command: string): boolean {
  try {
    execSync(`which ${command}`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function getCommandPath(command: string): string | null {
  try {
    return execSync(`which ${command}`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim()
  } catch {
    return null
  }
}

const openclawAvailable = isCommandAvailable('openclaw')
const opencodeAvailable = isCommandAvailable('opencode')

// ============================================================================
// Shared types matching base-adapter.ts interfaces
// ============================================================================

interface StreamEvent {
  type: string
  data: unknown
  timestamp: number
}

interface MockTaskOutputStream {
  events: StreamEvent[]
  stdoutData: string
  stderrData: string
  statusUpdates: Array<{ status: string; progress?: number; message?: string }>
  sessionInits: Array<{ sessionId: string; model?: string }>
  textBlocks: string[]
  toolUses: Array<{ toolName: string; toolInput: unknown }>
  toolResults: Array<{ toolName: string; result: unknown; success: boolean }>
  fileChanges: Array<{ path: string; action: string; linesAdded?: number; linesRemoved?: number }>
  // Interface methods
  stdout: (data: string) => void
  stderr: (data: string) => void
  status: (status: string, progress?: number, message?: string) => void
  toolTrace: (toolName: string, toolInput?: unknown, toolResult?: unknown, success?: boolean) => void
  text: (data: string) => void
  toolUse: (toolName: string, toolInput: unknown) => void
  toolResult: (toolName: string, result: unknown, success: boolean) => void
  fileChange: (path: string, action: string, linesAdded?: number, linesRemoved?: number) => void
  sessionInit: (sessionId: string, model?: string) => void
  approvalRequest: (question: string, options: string[]) => Promise<{ answered: boolean; answer?: string; message?: string }>
}

function createMockStream(): MockTaskOutputStream {
  const stream: MockTaskOutputStream = {
    events: [],
    stdoutData: '',
    stderrData: '',
    statusUpdates: [],
    sessionInits: [],
    textBlocks: [],
    toolUses: [],
    toolResults: [],
    fileChanges: [],
    stdout(data: string) {
      stream.stdoutData += data
      stream.events.push({ type: 'stdout', data, timestamp: Date.now() })
    },
    stderr(data: string) {
      stream.stderrData += data
      stream.events.push({ type: 'stderr', data, timestamp: Date.now() })
    },
    status(status: string, progress?: number, message?: string) {
      stream.statusUpdates.push({ status, progress, message })
      stream.events.push({ type: 'status', data: { status, progress, message }, timestamp: Date.now() })
    },
    toolTrace() {
      // Legacy trace — not used in new adapters
    },
    text(data: string) {
      stream.textBlocks.push(data)
      stream.events.push({ type: 'text', data, timestamp: Date.now() })
    },
    toolUse(toolName: string, toolInput: unknown) {
      stream.toolUses.push({ toolName, toolInput })
      stream.events.push({ type: 'tool_use', data: { toolName, toolInput }, timestamp: Date.now() })
    },
    toolResult(toolName: string, result: unknown, success: boolean) {
      stream.toolResults.push({ toolName, result, success })
      stream.events.push({ type: 'tool_result', data: { toolName, result, success }, timestamp: Date.now() })
    },
    fileChange(path: string, action: string, linesAdded?: number, linesRemoved?: number) {
      stream.fileChanges.push({ path, action, linesAdded, linesRemoved })
      stream.events.push({ type: 'file_change', data: { path, action, linesAdded, linesRemoved }, timestamp: Date.now() })
    },
    sessionInit(sessionId: string, model?: string) {
      stream.sessionInits.push({ sessionId, model })
      stream.events.push({ type: 'session_init', data: { sessionId, model }, timestamp: Date.now() })
    },
    async approvalRequest(_question: string, _options: string[]) {
      // Auto-approve in integration tests
      return { answered: true, answer: _options[0] ?? 'yes' }
    },
  }
  return stream
}

// ============================================================================
// Minimal adapter implementations (inline, since agent-runner submodule
// may not be initialized in the test environment)
// ============================================================================

/**
 * Spawns a provider CLI process and collects streaming output.
 * Returns a promise that resolves with the exit code and collected events.
 */
function spawnProviderProcess(
  cliPath: string,
  args: string[],
  opts: {
    cwd?: string
    env?: Record<string, string>
    timeout?: number
    signal?: AbortSignal
  }
): Promise<{
  exitCode: number
  stdout: string
  stderr: string
  jsonlLines: string[]
}> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcess = spawn(cliPath, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Close stdin immediately (non-interactive mode)
    proc.stdin?.end()

    let stdout = ''
    let stderr = ''
    const jsonlLines: string[] = []
    let lineBuf = ''

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text
      lineBuf += text
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) {
          jsonlLines.push(line.trim())
        }
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    const abortHandler = () => {
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL')
      }, 5000)
    }

    if (opts.signal) {
      opts.signal.addEventListener('abort', abortHandler)
    }

    proc.on('error', (error: Error) => {
      if (opts.signal) opts.signal.removeEventListener('abort', abortHandler)
      reject(error)
    })

    proc.on('close', (code: number | null) => {
      // Flush remaining buffer
      if (lineBuf.trim()) {
        jsonlLines.push(lineBuf.trim())
      }
      if (opts.signal) opts.signal.removeEventListener('abort', abortHandler)
      resolve({ exitCode: code ?? 1, stdout, stderr, jsonlLines })
    })

    // Timeout handling
    if (opts.timeout) {
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGTERM')
          setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL')
          }, 5000)
        }
      }, opts.timeout)
    }
  })
}

// ============================================================================
// Test helpers
// ============================================================================

let tempDir: string

function createTempWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'astro-provider-integ-'))
  // Create a minimal file so the provider has something to work with
  writeFileSync(join(dir, 'README.md'), '# Test Project\nThis is a test project for integration testing.\n')
  return dir
}

// ============================================================================
// OpenClaw Integration Tests
// ============================================================================

describe.skipIf(!openclawAvailable)('OpenClaw Provider Integration', () => {
  const openclawPath = getCommandPath('openclaw')!
  let abortController: AbortController

  beforeEach(() => {
    tempDir = createTempWorkDir()
    abortController = new AbortController()
  })

  afterEach(() => {
    // Cancel any running processes
    if (!abortController.signal.aborted) {
      abortController.abort()
    }
    // Cleanup temp directory
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    }
  })

  it('detects openclaw CLI on PATH', () => {
    expect(openclawPath).toBeTruthy()
    expect(typeof openclawPath).toBe('string')
  })

  it('openclaw --version returns a version string', () => {
    const version = execSync(`${openclawPath} --version`, {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim()
    expect(version).toBeTruthy()
    // Version should contain a number
    expect(version).toMatch(/\d/)
  })

  it('full lifecycle: spawn → stream JSONL → exit', async () => {
    // Use a trivial prompt to minimize API cost / time
    const result = await spawnProviderProcess(
      openclawPath,
      [
        'agent',
        '--mode', 'rpc',
        '--json',
        '--prompt', 'Reply with exactly: INTEGRATION_TEST_OK',
      ],
      {
        cwd: tempDir,
        timeout: 120_000, // 2 minutes for real CLI execution
        signal: abortController.signal,
      }
    )

    // Process should exit (0 = success, non-zero = acceptable for test prompts)
    expect(typeof result.exitCode).toBe('number')

    // Should have produced some stdout
    expect(result.stdout.length).toBeGreaterThan(0)

    // Should have produced JSONL lines
    expect(result.jsonlLines.length).toBeGreaterThan(0)

    // Parse JSONL events and verify structure
    const events: Array<Record<string, unknown>> = []
    for (const line of result.jsonlLines) {
      try {
        events.push(JSON.parse(line) as Record<string, unknown>)
      } catch {
        // Some lines may not be valid JSON (raw output)
      }
    }

    // Should have at least one parseable JSON event
    expect(events.length).toBeGreaterThan(0)

    // Every JSON event should have a 'type' field
    for (const event of events) {
      expect(event).toHaveProperty('type')
      expect(typeof event.type).toBe('string')
    }

    // Check for expected event types in the stream
    const eventTypes = new Set(events.map((e) => e.type as string))

    // session.start should be present (provider session init)
    expect(eventTypes.has('session.start')).toBe(true)

    // Should have some content event (content.text or message.start)
    const hasContent = eventTypes.has('content.text') || eventTypes.has('message.start')
    expect(hasContent).toBe(true)

    // session.end should be present (metrics / completion)
    expect(eventTypes.has('session.end')).toBe(true)
  }, 150_000) // 2.5 min test timeout

  it('streams session.start with session_id and model', async () => {
    const result = await spawnProviderProcess(
      openclawPath,
      [
        'agent',
        '--mode', 'rpc',
        '--json',
        '--prompt', 'Say "hello" and nothing else.',
      ],
      {
        cwd: tempDir,
        timeout: 120_000,
        signal: abortController.signal,
      }
    )

    const events = result.jsonlLines
      .map((line) => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean) as Array<Record<string, unknown>>

    const sessionStart = events.find((e) => e.type === 'session.start')
    expect(sessionStart).toBeDefined()
    if (sessionStart) {
      // session_id should be a string
      expect(typeof sessionStart.session_id).toBe('string')
      expect((sessionStart.session_id as string).length).toBeGreaterThan(0)
    }
  }, 150_000)

  it('streams session.end with metrics', async () => {
    const result = await spawnProviderProcess(
      openclawPath,
      [
        'agent',
        '--mode', 'rpc',
        '--json',
        '--prompt', 'Reply with exactly the word "test".',
      ],
      {
        cwd: tempDir,
        timeout: 120_000,
        signal: abortController.signal,
      }
    )

    const events = result.jsonlLines
      .map((line) => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean) as Array<Record<string, unknown>>

    const sessionEnd = events.find((e) => e.type === 'session.end')
    expect(sessionEnd).toBeDefined()
    if (sessionEnd) {
      // Metrics fields should be present (may be numbers or undefined)
      expect(sessionEnd).toHaveProperty('model')
    }
  }, 150_000)

  it('cancellation via abort signal terminates process', async () => {
    const localAbort = new AbortController()

    // Start a long-running task
    const resultPromise = spawnProviderProcess(
      openclawPath,
      [
        'agent',
        '--mode', 'rpc',
        '--json',
        '--prompt', 'Write a 500-word essay about the history of computing.',
      ],
      {
        cwd: tempDir,
        timeout: 120_000,
        signal: localAbort.signal,
      }
    )

    // Abort after a short delay
    await new Promise((resolve) => setTimeout(resolve, 3000))
    localAbort.abort()

    const result = await resultPromise

    // Process should have been killed (non-zero exit or signal)
    // On SIGTERM, exit code is typically null (mapped to 1) or 143
    expect(result.exitCode).not.toBe(0)
  }, 30_000)

  it('handles non-existent working directory gracefully', async () => {
    const badDir = join(tmpdir(), 'nonexistent-dir-' + Date.now())

    // Process should fail or error when cwd doesn't exist
    try {
      const result = await spawnProviderProcess(
        openclawPath,
        [
          'agent',
          '--mode', 'rpc',
          '--json',
          '--prompt', 'Say hello.',
        ],
        {
          cwd: badDir,
          timeout: 30_000,
          signal: abortController.signal,
        }
      )
      // If it doesn't throw, it should have a non-zero exit
      expect(result.exitCode).not.toBe(0)
    } catch (error) {
      // Spawn with bad cwd throws ENOENT
      expect(error).toBeDefined()
      const errMsg = error instanceof Error ? error.message : String(error)
      expect(errMsg).toMatch(/ENOENT|no such file|does not exist/i)
    }
  }, 30_000)

  it('event ordering: session.start before content before session.end', async () => {
    const result = await spawnProviderProcess(
      openclawPath,
      [
        'agent',
        '--mode', 'rpc',
        '--json',
        '--prompt', 'Reply with exactly "ordering_test".',
      ],
      {
        cwd: tempDir,
        timeout: 120_000,
        signal: abortController.signal,
      }
    )

    const events = result.jsonlLines
      .map((line) => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean) as Array<Record<string, unknown>>

    const typeSequence = events.map((e) => e.type as string)

    const sessionStartIdx = typeSequence.indexOf('session.start')
    const sessionEndIdx = typeSequence.lastIndexOf('session.end')

    // session.start must come before session.end
    if (sessionStartIdx >= 0 && sessionEndIdx >= 0) {
      expect(sessionStartIdx).toBeLessThan(sessionEndIdx)
    }

    // Any content.text events should be between session.start and session.end
    const contentIdx = typeSequence.indexOf('content.text')
    if (contentIdx >= 0 && sessionStartIdx >= 0 && sessionEndIdx >= 0) {
      expect(contentIdx).toBeGreaterThan(sessionStartIdx)
      expect(contentIdx).toBeLessThan(sessionEndIdx)
    }
  }, 150_000)
})

// ============================================================================
// OpenCode Integration Tests
// ============================================================================

describe.skipIf(!opencodeAvailable)('OpenCode Provider Integration', () => {
  const opencodePath = getCommandPath('opencode')!
  let abortController: AbortController

  beforeEach(() => {
    tempDir = createTempWorkDir()
    abortController = new AbortController()
  })

  afterEach(() => {
    // Cancel any running processes
    if (!abortController.signal.aborted) {
      abortController.abort()
    }
    // Cleanup temp directory
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    }
  })

  it('detects opencode CLI on PATH', () => {
    expect(opencodePath).toBeTruthy()
    expect(typeof opencodePath).toBe('string')
  })

  it('opencode --version returns a version string', () => {
    const version = execSync(`${opencodePath} --version`, {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim()
    expect(version).toBeTruthy()
    expect(version).toMatch(/\d/)
  })

  it('full lifecycle: spawn → stream JSONL → exit', async () => {
    const result = await spawnProviderProcess(
      opencodePath,
      [
        'run',
        '--print',
        '--output-format', 'json',
        'Reply with exactly: INTEGRATION_TEST_OK',
      ],
      {
        cwd: tempDir,
        timeout: 120_000,
        signal: abortController.signal,
      }
    )

    expect(typeof result.exitCode).toBe('number')
    expect(result.stdout.length).toBeGreaterThan(0)
    expect(result.jsonlLines.length).toBeGreaterThan(0)

    // Parse JSONL events
    const events: Array<Record<string, unknown>> = []
    for (const line of result.jsonlLines) {
      try {
        events.push(JSON.parse(line) as Record<string, unknown>)
      } catch {
        // Raw output lines are acceptable
      }
    }

    expect(events.length).toBeGreaterThan(0)

    // Every JSON event should have a 'type' field
    for (const event of events) {
      expect(event).toHaveProperty('type')
    }

    const eventTypes = new Set(events.map((e) => e.type as string))

    // OpenCode uses either legacy format (system, assistant, result) or
    // native format (step_start, text, step_finish)
    const hasSessionInit = eventTypes.has('system') || eventTypes.has('step_start')
    expect(hasSessionInit).toBe(true)

    const hasContent = eventTypes.has('assistant') || eventTypes.has('text') || eventTypes.has('reasoning')
    expect(hasContent).toBe(true)
  }, 150_000)

  it('streams session init with model info', async () => {
    const result = await spawnProviderProcess(
      opencodePath,
      [
        'run',
        '--print',
        '--output-format', 'json',
        'Say "hello" and nothing else.',
      ],
      {
        cwd: tempDir,
        timeout: 120_000,
        signal: abortController.signal,
      }
    )

    const events = result.jsonlLines
      .map((line) => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean) as Array<Record<string, unknown>>

    // Look for session init in either format
    const legacyInit = events.find((e) => e.type === 'system')
    const nativeInit = events.find((e) => e.type === 'step_start')

    const initEvent = legacyInit || nativeInit
    expect(initEvent).toBeDefined()

    if (legacyInit) {
      // Legacy format: { type: 'system', session_id, model }
      if (legacyInit.session_id) {
        expect(typeof legacyInit.session_id).toBe('string')
      }
    }

    if (nativeInit) {
      // Native format: { type: 'step_start', sessionID, part: { model } }
      if (nativeInit.sessionID) {
        expect(typeof nativeInit.sessionID).toBe('string')
      }
    }
  }, 150_000)

  it('streams result or step_finish with metrics', async () => {
    const result = await spawnProviderProcess(
      opencodePath,
      [
        'run',
        '--print',
        '--output-format', 'json',
        'Reply with exactly the word "test".',
      ],
      {
        cwd: tempDir,
        timeout: 120_000,
        signal: abortController.signal,
      }
    )

    const events = result.jsonlLines
      .map((line) => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean) as Array<Record<string, unknown>>

    // Check for completion event in either format
    const legacyResult = events.find((e) => e.type === 'result')
    const nativeFinish = events.find((e) => e.type === 'step_finish')

    const completionEvent = legacyResult || nativeFinish
    expect(completionEvent).toBeDefined()
  }, 150_000)

  it('cancellation via abort signal terminates process', async () => {
    const localAbort = new AbortController()

    const resultPromise = spawnProviderProcess(
      opencodePath,
      [
        'run',
        '--print',
        '--output-format', 'json',
        'Write a 500-word essay about the history of computing.',
      ],
      {
        cwd: tempDir,
        timeout: 120_000,
        signal: localAbort.signal,
      }
    )

    // Abort after a short delay
    await new Promise((resolve) => setTimeout(resolve, 3000))
    localAbort.abort()

    const result = await resultPromise
    expect(result.exitCode).not.toBe(0)
  }, 30_000)

  it('handles non-existent working directory gracefully', async () => {
    const badDir = join(tmpdir(), 'nonexistent-dir-' + Date.now())

    try {
      const result = await spawnProviderProcess(
        opencodePath,
        [
          'run',
          '--print',
          '--output-format', 'json',
          'Say hello.',
        ],
        {
          cwd: badDir,
          timeout: 30_000,
          signal: abortController.signal,
        }
      )
      expect(result.exitCode).not.toBe(0)
    } catch (error) {
      expect(error).toBeDefined()
      const errMsg = error instanceof Error ? error.message : String(error)
      expect(errMsg).toMatch(/ENOENT|no such file|does not exist/i)
    }
  }, 30_000)

  it('event ordering is consistent', async () => {
    const result = await spawnProviderProcess(
      opencodePath,
      [
        'run',
        '--print',
        '--output-format', 'json',
        'Reply with exactly "ordering_test".',
      ],
      {
        cwd: tempDir,
        timeout: 120_000,
        signal: abortController.signal,
      }
    )

    const events = result.jsonlLines
      .map((line) => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean) as Array<Record<string, unknown>>

    const typeSequence = events.map((e) => e.type as string)

    // In legacy format: system should come before result
    const systemIdx = typeSequence.indexOf('system')
    const resultIdx = typeSequence.lastIndexOf('result')
    if (systemIdx >= 0 && resultIdx >= 0) {
      expect(systemIdx).toBeLessThan(resultIdx)
    }

    // In native format: step_start should come before step_finish
    const stepStartIdx = typeSequence.indexOf('step_start')
    const stepFinishIdx = typeSequence.lastIndexOf('step_finish')
    if (stepStartIdx >= 0 && stepFinishIdx >= 0) {
      expect(stepStartIdx).toBeLessThan(stepFinishIdx)
    }
  }, 150_000)
})

// ============================================================================
// Adapter JSONL Parsing Tests (run always — no CLI needed)
// ============================================================================

describe('OpenClaw JSONL event parsing', () => {
  it('parses session.start event', () => {
    const line = JSON.stringify({
      type: 'session.start',
      session_id: 'sess-123',
      model: 'claude-sonnet-4-20250514',
    })
    const stream = createMockStream()
    parseOpenClawLine(line, stream)

    expect(stream.sessionInits).toHaveLength(1)
    expect(stream.sessionInits[0].sessionId).toBe('sess-123')
    expect(stream.sessionInits[0].model).toBe('claude-sonnet-4-20250514')
  })

  it('parses content.text event', () => {
    const line = JSON.stringify({ type: 'content.text', text: 'Hello world' })
    const stream = createMockStream()
    parseOpenClawLine(line, stream)

    expect(stream.textBlocks).toHaveLength(1)
    expect(stream.textBlocks[0]).toBe('Hello world')
  })

  it('parses tool_use.start event', () => {
    const line = JSON.stringify({
      type: 'tool_use.start',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test.txt' },
    })
    const stream = createMockStream()
    parseOpenClawLine(line, stream)

    expect(stream.toolUses).toHaveLength(1)
    expect(stream.toolUses[0].toolName).toBe('Read')
    expect(stream.toolUses[0].toolInput).toEqual({ file_path: '/tmp/test.txt' })
  })

  it('parses tool_use.end event', () => {
    const line = JSON.stringify({
      type: 'tool_use.end',
      tool_name: 'Read',
      result: 'file contents here',
      success: true,
    })
    const stream = createMockStream()
    parseOpenClawLine(line, stream)

    expect(stream.toolResults).toHaveLength(1)
    expect(stream.toolResults[0].toolName).toBe('Read')
    expect(stream.toolResults[0].success).toBe(true)
  })

  it('parses file.change event', () => {
    const line = JSON.stringify({
      type: 'file.change',
      path: '/tmp/test.txt',
      action: 'created',
      lines_added: 10,
      lines_removed: 0,
    })
    const stream = createMockStream()
    parseOpenClawLine(line, stream)

    expect(stream.fileChanges).toHaveLength(1)
    expect(stream.fileChanges[0].path).toBe('/tmp/test.txt')
    expect(stream.fileChanges[0].action).toBe('created')
    expect(stream.fileChanges[0].linesAdded).toBe(10)
  })

  it('parses session.end event with metrics', () => {
    const line = JSON.stringify({
      type: 'session.end',
      cost: 0.0123,
      input_tokens: 1000,
      output_tokens: 500,
      turns: 3,
      model: 'claude-sonnet-4-20250514',
      duration_ms: 5000,
    })
    const stream = createMockStream()
    const metrics = parseOpenClawLine(line, stream)

    expect(metrics).toBeDefined()
    expect(metrics!.totalCost).toBe(0.0123)
    expect(metrics!.inputTokens).toBe(1000)
    expect(metrics!.outputTokens).toBe(500)
    expect(metrics!.numTurns).toBe(3)
    expect(metrics!.model).toBe('claude-sonnet-4-20250514')
    expect(metrics!.durationMs).toBe(5000)
  })

  it('parses message.start/end as status updates', () => {
    const stream = createMockStream()
    parseOpenClawLine(JSON.stringify({ type: 'message.start' }), stream)
    parseOpenClawLine(JSON.stringify({ type: 'message.end' }), stream)

    expect(stream.statusUpdates).toHaveLength(2)
    expect(stream.statusUpdates[0].message).toBe('Agent thinking...')
    expect(stream.statusUpdates[1].message).toBe('Turn complete')
  })

  it('handles invalid JSON as raw stdout', () => {
    const stream = createMockStream()
    parseOpenClawLine('not valid json', stream)

    expect(stream.stdoutData).toContain('not valid json')
  })

  it('handles unknown event types silently', () => {
    const stream = createMockStream()
    parseOpenClawLine(JSON.stringify({ type: 'unknown.event', data: 'foo' }), stream)

    // Should not throw and should not produce any events
    expect(stream.events).toHaveLength(0)
  })
})

describe('OpenCode JSONL event parsing — legacy format', () => {
  it('parses system event as session init', () => {
    const line = JSON.stringify({
      type: 'system',
      session_id: 'oc-sess-456',
      model: 'gpt-4o',
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.sessionInits).toHaveLength(1)
    expect(stream.sessionInits[0].sessionId).toBe('oc-sess-456')
    expect(stream.sessionInits[0].model).toBe('gpt-4o')
  })

  it('parses assistant event with text blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      content: [
        { type: 'text', text: 'Hello from OpenCode' },
      ],
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.textBlocks).toHaveLength(1)
    expect(stream.textBlocks[0]).toBe('Hello from OpenCode\n')
  })

  it('parses assistant event with tool_use blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } },
      ],
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.toolUses).toHaveLength(1)
    expect(stream.toolUses[0].toolName).toBe('Bash')
  })

  it('parses tool_result event (direct format)', () => {
    const line = JSON.stringify({
      type: 'tool_result',
      tool_name: 'Bash',
      content: 'file1.txt\nfile2.txt',
      is_error: false,
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.toolResults).toHaveLength(1)
    expect(stream.toolResults[0].toolName).toBe('Bash')
    expect(stream.toolResults[0].success).toBe(true)
  })

  it('parses result event with metrics', () => {
    const line = JSON.stringify({
      type: 'result',
      total_cost_usd: 0.05,
      num_turns: 5,
      duration_ms: 10000,
      usage: { input_tokens: 2000, output_tokens: 1000 },
      model: 'gpt-4o',
    })
    const stream = createMockStream()
    const metrics = parseOpenCodeLine(line, stream)

    expect(metrics).toBeDefined()
    expect(metrics!.totalCost).toBe(0.05)
    expect(metrics!.numTurns).toBe(5)
    expect(metrics!.inputTokens).toBe(2000)
    expect(metrics!.outputTokens).toBe(1000)
    expect(metrics!.model).toBe('gpt-4o')
  })
})

describe('OpenCode JSONL event parsing — native format', () => {
  it('parses step_start event', () => {
    const line = JSON.stringify({
      type: 'step_start',
      sessionID: 'native-sess-789',
      timestamp: Date.now(),
      part: { stepId: 'step-1', model: 'claude-opus-4-20250514', title: 'Starting analysis' },
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.sessionInits).toHaveLength(1)
    expect(stream.sessionInits[0].sessionId).toBe('native-sess-789')
    expect(stream.sessionInits[0].model).toBe('claude-opus-4-20250514')
    expect(stream.statusUpdates.some((s) => s.message === 'Starting analysis')).toBe(true)
  })

  it('parses text event (native)', () => {
    const line = JSON.stringify({
      type: 'text',
      sessionID: 'native-sess-789',
      timestamp: Date.now(),
      part: { text: 'Native text output' },
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.textBlocks).toHaveLength(1)
    expect(stream.textBlocks[0]).toBe('Native text output\n')
  })

  it('parses tool_use event (native, running state)', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      sessionID: 'native-sess-789',
      timestamp: Date.now(),
      part: { toolCallId: 'tc-1', tool: 'Write', state: 'running', input: { path: '/test.ts' } },
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.toolUses).toHaveLength(1)
    expect(stream.toolUses[0].toolName).toBe('Write')
  })

  it('parses tool_use event (native, completed state)', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      sessionID: 'native-sess-789',
      timestamp: Date.now(),
      part: { toolCallId: 'tc-1', tool: 'Write', state: 'completed', output: 'File written' },
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.toolResults).toHaveLength(1)
    expect(stream.toolResults[0].toolName).toBe('Write')
    expect(stream.toolResults[0].success).toBe(true)
  })

  it('parses tool_use event (native, error state)', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      sessionID: 'native-sess-789',
      timestamp: Date.now(),
      part: { toolCallId: 'tc-1', tool: 'Read', state: 'error', error: 'File not found' },
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.toolResults).toHaveLength(1)
    expect(stream.toolResults[0].toolName).toBe('Read')
    expect(stream.toolResults[0].success).toBe(false)
  })

  it('parses step_finish event with metrics', () => {
    const line = JSON.stringify({
      type: 'step_finish',
      sessionID: 'native-sess-789',
      timestamp: Date.now(),
      part: {
        usage: { inputTokens: 500, outputTokens: 200 },
        cost: 0.003,
        model: 'claude-opus-4-20250514',
        reason: 'end_turn',
      },
    })
    const stream = createMockStream()
    const metrics = parseOpenCodeLine(line, stream)

    expect(metrics).toBeDefined()
    expect(metrics!.totalCost).toBe(0.003)
    expect(metrics!.inputTokens).toBe(500)
    expect(metrics!.outputTokens).toBe(200)
    expect(metrics!.model).toBe('claude-opus-4-20250514')
  })

  it('parses error event', () => {
    const line = JSON.stringify({
      type: 'error',
      sessionID: 'native-sess-789',
      timestamp: Date.now(),
      part: { message: 'Rate limit exceeded', code: 'RATE_LIMIT' },
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.stderrData).toContain('RATE_LIMIT')
    expect(stream.stderrData).toContain('Rate limit exceeded')
  })

  it('handles invalid JSON as raw text', () => {
    const stream = createMockStream()
    parseOpenCodeLine('raw text output', stream)

    expect(stream.stdoutData).toContain('raw text output')
  })

  it('parses reasoning event as text', () => {
    const line = JSON.stringify({
      type: 'reasoning',
      sessionID: 'native-sess-789',
      timestamp: Date.now(),
      part: { text: 'Thinking about the problem...' },
    })
    const stream = createMockStream()
    parseOpenCodeLine(line, stream)

    expect(stream.textBlocks).toHaveLength(1)
    expect(stream.textBlocks[0]).toBe('Thinking about the problem...\n')
  })
})

// ============================================================================
// JSONL parsing functions (mirrors adapter logic for testability)
// ============================================================================

/**
 * Parse a single OpenClaw JSONL line and emit to stream.
 * Mirrors OpenClawAdapter.handleStreamLine logic.
 */
function parseOpenClawLine(
  line: string,
  stream: MockTaskOutputStream,
): { totalCost?: number; inputTokens?: number; outputTokens?: number; numTurns?: number; model?: string; durationMs?: number } | undefined {
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
        const action = (event.action as string) || 'modified'
        const linesAdded = event.lines_added as number | undefined
        const linesRemoved = event.lines_removed as number | undefined
        if (path) {
          stream.fileChange(path, action, linesAdded, linesRemoved)
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
        return { totalCost: cost, inputTokens, outputTokens, numTurns: turns, model, durationMs }
      }
      default:
        break
    }
  } catch {
    stream.stdout(line + '\n')
  }
  return undefined
}

/**
 * Parse a single OpenCode JSONL line and emit to stream.
 * Mirrors OpenCodeAdapter.handleStreamLine logic (both legacy + native formats).
 */
function parseOpenCodeLine(
  line: string,
  stream: MockTaskOutputStream,
): { totalCost?: number; inputTokens?: number; outputTokens?: number; numTurns?: number; model?: string; durationMs?: number } | undefined {
  // Track tool IDs → names for correlation
  const toolIdToName = (parseOpenCodeLine as unknown as { _idMap?: Map<string, string> })._idMap ??= new Map<string, string>()

  try {
    const event = JSON.parse(line) as Record<string, unknown>
    const type = event.type as string

    switch (type) {
      // Legacy format
      case 'system': {
        const sessionId = event.session_id as string | undefined
        const model = event.model as string | undefined
        if (sessionId) stream.sessionInit(sessionId, model)
        break
      }
      case 'assistant': {
        const content = event.content as Array<{ type: string; id?: string; text?: string; name?: string; input?: unknown }> | undefined
        const message = event.message as { content?: Array<{ type: string; id?: string; text?: string; name?: string; input?: unknown }> } | undefined
        const blocks = content || message?.content
        if (blocks) {
          for (const block of blocks) {
            if (block.type === 'text' && block.text) {
              stream.text(block.text + '\n')
            } else if (block.type === 'tool_use') {
              if (block.id && block.name) toolIdToName.set(block.id, block.name)
              stream.toolUse(block.name ?? 'unknown', block.input)
            }
          }
        }
        break
      }
      case 'tool_result': {
        if (typeof event.content === 'string' || !event.content) {
          const toolName = (event.tool_name as string) || 'unknown'
          const resultContent = (event.content as string) || ''
          const isError = (event.is_error as boolean) || false
          stream.toolResult(toolName, resultContent, !isError)
          break
        }
        // Array content — process blocks
        const blocks = event.content as Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }> | undefined
        if (blocks) {
          for (const block of blocks) {
            if (block.type === 'tool_result') {
              const toolName = (block.tool_use_id && toolIdToName.get(block.tool_use_id)) ?? 'unknown'
              stream.toolResult(toolName, block.content || '', !block.is_error)
            }
          }
        }
        break
      }
      case 'result': {
        const cost = (event.total_cost_usd ?? event.cost_usd ?? event.cost) as number | undefined
        const numTurns = (event.num_turns ?? event.turns) as number | undefined
        const durationMs = (event.duration_ms ?? event.duration_api_ms) as number | undefined
        const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined
        const tokens = event.tokens as { input?: number; output?: number } | undefined
        const model = event.model as string | undefined
        return {
          totalCost: cost,
          inputTokens: usage?.input_tokens ?? tokens?.input,
          outputTokens: usage?.output_tokens ?? tokens?.output,
          numTurns,
          durationMs,
          model,
        }
      }
      // Native OpenCode format
      case 'step_start': {
        const sessionID = event.sessionID as string | undefined
        const part = event.part as { stepId?: string; model?: string; title?: string } | undefined
        if (sessionID) stream.sessionInit(sessionID, part?.model)
        if (part?.title) stream.status('running', 0, part.title)
        break
      }
      case 'text': {
        const part = event.part as { text?: string } | undefined
        if (part?.text) stream.text(part.text + '\n')
        break
      }
      case 'tool_use': {
        const part = event.part as { toolCallId?: string; tool?: string; state?: string; input?: unknown; output?: unknown; error?: string } | undefined
        if (part) {
          const toolName = part.tool ?? 'unknown'
          if (part.state === 'running') {
            if (part.toolCallId && part.tool) toolIdToName.set(part.toolCallId, toolName)
            stream.toolUse(toolName, part.input)
          } else if (part.state === 'completed') {
            stream.toolResult(toolName, part.output ?? '', true)
          } else if (part.state === 'error') {
            stream.toolResult(toolName, part.error ?? 'Unknown error', false)
          }
        }
        break
      }
      case 'reasoning': {
        const part = event.part as { text?: string } | undefined
        if (part?.text) stream.text(part.text + '\n')
        break
      }
      case 'step_finish': {
        const part = event.part as { usage?: { inputTokens?: number; outputTokens?: number }; cost?: number; model?: string; reason?: string } | undefined
        if (part) {
          return {
            totalCost: part.cost,
            inputTokens: part.usage?.inputTokens,
            outputTokens: part.usage?.outputTokens,
            model: part.model,
          }
        }
        break
      }
      case 'error': {
        const part = event.part as { message?: string; code?: string } | undefined
        if (part?.message) {
          stream.stderr(`[${part.code ?? 'ERROR'}] ${part.message}`)
        }
        break
      }
      default:
        break
    }
  } catch {
    stream.stdout(line)
  }
  return undefined
}
