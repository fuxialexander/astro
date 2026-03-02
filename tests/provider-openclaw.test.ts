/**
 * OpenClaw adapter lifecycle tests
 *
 * Tests the process lifecycle management of the OpenClaw adapter
 * (packages/agent-runner/src/providers/openclaw-adapter.ts).
 *
 * Since the agent-runner is a git submodule not initialized in every
 * worktree, these tests reproduce the adapter's core process-management
 * logic inline and exercise it against a mocked child_process.spawn.
 *
 * Coverage:
 *   (1) Process spawning with correct args (openclaw agent --mode rpc --json --prompt)
 *   (2) Environment variable passthrough (API keys, config)
 *   (3) Abort/cancellation (SIGTERM then SIGKILL after 5s)
 *   (4) Process exit code handling (0=success, non-zero=error)
 *   (5) Timeout handling
 *   (6) Working directory validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'

// =============================================================================
// Types mirroring the adapter's interfaces (self-contained)
// =============================================================================

interface TaskOutputStream {
  stdout: (data: string) => void
  stderr: (data: string) => void
  status: (status: string, progress?: number, message?: string) => void
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

interface RunOpenClawResult {
  exitCode: number
  output: string
  error?: string
  artifacts?: TaskArtifact[]
  metrics?: TaskMetrics
}

// Minimal Task type matching the fields used by runOpenClaw
interface Task {
  id: string
  prompt: string
  workingDirectory: string
  environment?: Record<string, string>
  timeout?: number
  model?: string
  systemPrompt?: string
}

// =============================================================================
// Mock ChildProcess factory
// =============================================================================

class MockChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = new EventEmitter()
  killed = false
  pid = 12345

  private _killSignals: string[] = []

  kill(signal?: string): boolean {
    this._killSignals.push(signal || 'SIGTERM')
    this.killed = true
    return true
  }

  get killSignals(): string[] {
    return this._killSignals
  }

  /** Simulate stdout data */
  sendStdout(data: string): void {
    this.stdout.emit('data', Buffer.from(data))
  }

  /** Simulate stderr data */
  sendStderr(data: string): void {
    this.stderr.emit('data', Buffer.from(data))
  }

  /** Simulate process close */
  close(code: number | null): void {
    this.emit('close', code)
  }

  /** Simulate process error */
  emitError(err: Error): void {
    this.emit('error', err)
  }
}

// =============================================================================
// Mock stream parsing — mirrors OpenClawAdapter.handleStreamLine
// =============================================================================

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
        break
    }
  } catch {
    stream.stdout(line + '\n')
  }

  return undefined
}

// =============================================================================
// runOpenClaw — mirrors the adapter's private method
// =============================================================================

function runOpenClaw(
  openclawPath: string,
  task: Task,
  stream: TaskOutputStream,
  signal: AbortSignal,
  configModel: string | null,
  spawnFn: typeof import('node:child_process').spawn,
  existsSyncFn: (path: string) => boolean,
): Promise<RunOpenClawResult> {
  return new Promise((resolve, reject) => {
    const model = task.model || configModel

    const effectivePrompt = task.systemPrompt
      ? `${task.systemPrompt}\n\n---\n\n${task.prompt}`
      : task.prompt

    const args = [
      'agent',
      '--mode', 'rpc',
      '--json',
      ...(model ? ['--model', model] : []),
      '--prompt', effectivePrompt,
    ]

    const env = {
      ...process.env,
      ...task.environment,
    }

    // Validate working directory exists before spawning
    if (task.workingDirectory && !existsSyncFn(task.workingDirectory)) {
      reject(new Error(
        `Working directory does not exist: ${task.workingDirectory}. ` +
        `Ensure the directory exists on this machine before dispatching.`,
      ))
      return
    }

    let proc: ChildProcess

    try {
      proc = spawnFn(openclawPath, args, {
        cwd: task.workingDirectory || undefined,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }

    let stdout = ''
    let stderr = ''
    let lastMetrics: TaskMetrics | undefined
    const artifacts: TaskArtifact[] = []

    const abortHandler = () => {
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL')
        }
      }, 5000)
    }

    signal.addEventListener('abort', abortHandler)

    let lineBuf = ''

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text

      lineBuf += text
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) {
          const metrics = handleStreamLine(line, stream, artifacts)
          if (metrics) {
            lastMetrics = metrics
          }
        }
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text
      stream.stderr(text)
    })

    proc.on('error', (error) => {
      signal.removeEventListener('abort', abortHandler)
      reject(error)
    })

    proc.on('close', (code) => {
      // Flush remaining buffer
      if (lineBuf.trim()) {
        const metrics = handleStreamLine(lineBuf, stream, artifacts)
        if (metrics) {
          lastMetrics = metrics
        }
      }

      signal.removeEventListener('abort', abortHandler)

      resolve({
        exitCode: code ?? 1,
        output: stdout,
        error: stderr || undefined,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        metrics: lastMetrics,
      })
    })

    if (task.timeout) {
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGTERM')
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL')
            }
          }, 5000)
        }
      }, task.timeout)
    }
  })
}

// =============================================================================
// Mock stream factory
// =============================================================================

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
    approvalRequest: vi.fn().mockResolvedValue({ answered: false }),
  }
}

// =============================================================================
// Helper: base task factory
// =============================================================================

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-001',
    prompt: 'Fix the login bug',
    workingDirectory: '/home/user/project',
    ...overrides,
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('OpenClaw adapter lifecycle: process spawning', () => {
  let mockProc: MockChildProcess
  let mockSpawn: ReturnType<typeof vi.fn>
  let stream: TaskOutputStream
  let existsSyncFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    mockProc = new MockChildProcess()
    mockSpawn = vi.fn().mockReturnValue(mockProc)
    stream = createMockStream()
    existsSyncFn = vi.fn().mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // (1) Process spawning with correct args
  // ===========================================================================

  describe('spawns openclaw with correct CLI arguments', () => {
    it('uses "agent --mode rpc --json --prompt" base args', async () => {
      const task = makeTask({ prompt: 'Hello world' })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Resolve the process
      mockProc.close(0)
      await resultP

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      const [bin, args, opts] = mockSpawn.mock.calls[0]
      expect(bin).toBe('/usr/local/bin/openclaw')
      expect(args).toEqual([
        'agent', '--mode', 'rpc', '--json', '--prompt', 'Hello world',
      ])
      expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    })

    it('includes --model when task.model is set', async () => {
      const task = makeTask({ model: 'claude-sonnet-4-20250514' })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const args = mockSpawn.mock.calls[0][1]
      expect(args).toContain('--model')
      expect(args).toContain('claude-sonnet-4-20250514')
    })

    it('falls back to configModel when task.model is unset', async () => {
      const task = makeTask({ model: undefined })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        'gpt-4o', mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const args = mockSpawn.mock.calls[0][1]
      expect(args).toContain('--model')
      expect(args).toContain('gpt-4o')
    })

    it('omits --model when neither task.model nor configModel is set', async () => {
      const task = makeTask({ model: undefined })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const args = mockSpawn.mock.calls[0][1]
      expect(args).not.toContain('--model')
    })

    it('task.model takes priority over configModel', async () => {
      const task = makeTask({ model: 'opus' })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        'haiku', mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const args = mockSpawn.mock.calls[0][1]
      expect(args).toContain('opus')
      expect(args).not.toContain('haiku')
    })

    it('combines systemPrompt with prompt when both are provided', async () => {
      const task = makeTask({
        systemPrompt: 'You are a code reviewer.',
        prompt: 'Review this PR',
      })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const args = mockSpawn.mock.calls[0][1]
      const promptIdx = args.indexOf('--prompt')
      expect(promptIdx).toBeGreaterThan(-1)
      const promptValue = args[promptIdx + 1]
      expect(promptValue).toBe('You are a code reviewer.\n\n---\n\nReview this PR')
    })

    it('uses raw prompt when systemPrompt is undefined', async () => {
      const task = makeTask({ prompt: 'Just do the thing' })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const args = mockSpawn.mock.calls[0][1]
      const promptIdx = args.indexOf('--prompt')
      expect(args[promptIdx + 1]).toBe('Just do the thing')
    })

    it('passes working directory as cwd option', async () => {
      const task = makeTask({ workingDirectory: '/home/dev/myproject' })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const opts = mockSpawn.mock.calls[0][2]
      expect(opts.cwd).toBe('/home/dev/myproject')
    })

    it('passes cwd as undefined when workingDirectory is empty', async () => {
      const task = makeTask({ workingDirectory: '' })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const opts = mockSpawn.mock.calls[0][2]
      expect(opts.cwd).toBeUndefined()
    })

    it('preserves argument order: agent, --mode, rpc, --json, [--model], --prompt', async () => {
      const task = makeTask({ model: 'claude-sonnet-4-20250514', prompt: 'test' })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const args = mockSpawn.mock.calls[0][1]
      expect(args[0]).toBe('agent')
      expect(args[1]).toBe('--mode')
      expect(args[2]).toBe('rpc')
      expect(args[3]).toBe('--json')
      expect(args[4]).toBe('--model')
      expect(args[5]).toBe('claude-sonnet-4-20250514')
      expect(args[6]).toBe('--prompt')
      expect(args[7]).toBe('test')
    })
  })

  // ===========================================================================
  // (2) Environment variable passthrough
  // ===========================================================================

  describe('environment variable passthrough', () => {
    it('merges process.env with task.environment', async () => {
      const task = makeTask({
        environment: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          CUSTOM_VAR: 'hello',
        },
      })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const opts = mockSpawn.mock.calls[0][2]
      expect(opts.env.ANTHROPIC_API_KEY).toBe('sk-ant-test')
      expect(opts.env.CUSTOM_VAR).toBe('hello')
      // process.env should also be present
      expect(opts.env.PATH).toBeDefined()
    })

    it('task.environment overrides process.env values', async () => {
      // Temporarily set a process.env value
      process.env.TEST_OVERRIDE_VAR = 'original'

      const task = makeTask({
        environment: {
          TEST_OVERRIDE_VAR: 'overridden',
        },
      })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const opts = mockSpawn.mock.calls[0][2]
      expect(opts.env.TEST_OVERRIDE_VAR).toBe('overridden')

      // Cleanup
      delete process.env.TEST_OVERRIDE_VAR
    })

    it('passes process.env when task.environment is undefined', async () => {
      const task = makeTask({ environment: undefined })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const opts = mockSpawn.mock.calls[0][2]
      // Should still have process.env entries
      expect(opts.env.PATH).toBeDefined()
    })

    it('passes multiple API keys simultaneously', async () => {
      const task = makeTask({
        environment: {
          ANTHROPIC_API_KEY: 'sk-ant-xxx',
          OPENAI_API_KEY: 'sk-oai-yyy',
          OPENCLAW_CONFIG_DIR: '/etc/openclaw',
        },
      })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      await resultP

      const opts = mockSpawn.mock.calls[0][2]
      expect(opts.env.ANTHROPIC_API_KEY).toBe('sk-ant-xxx')
      expect(opts.env.OPENAI_API_KEY).toBe('sk-oai-yyy')
      expect(opts.env.OPENCLAW_CONFIG_DIR).toBe('/etc/openclaw')
    })

    it('passes empty environment without crashing', async () => {
      const task = makeTask({ environment: {} })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      const result = await resultP

      expect(result.exitCode).toBe(0)
    })
  })

  // ===========================================================================
  // (3) Abort/cancellation (SIGTERM then SIGKILL after 5s)
  // ===========================================================================

  describe('abort and cancellation', () => {
    it('sends SIGTERM immediately on abort', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Abort the signal
      controller.abort()

      expect(mockProc.killSignals).toContain('SIGTERM')

      // Let the process close after being killed
      mockProc.close(143) // 128 + 15 (SIGTERM)
      await resultP
    })

    it('sends SIGKILL after 5s if process has not terminated', async () => {
      const task = makeTask()
      const controller = new AbortController()

      // Override killed to stay false (process resists SIGTERM)
      let sigkillSent = false
      mockProc.kill = vi.fn((signal?: string): boolean => {
        if (signal === 'SIGKILL') {
          sigkillSent = true
          // Actually mark as killed on SIGKILL
          mockProc.killed = true
        }
        // For SIGTERM, don't mark as killed (simulating resistant process)
        if (signal === 'SIGTERM') {
          // Process does NOT die from SIGTERM
        }
        return true
      })

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Abort the signal
      controller.abort()

      // SIGTERM sent immediately
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')

      // SIGKILL not sent yet
      expect(sigkillSent).toBe(false)

      // Advance 5 seconds for the escalation timeout
      vi.advanceTimersByTime(5000)

      // Now SIGKILL should have been sent
      expect(sigkillSent).toBe(true)

      // Finally close the process
      mockProc.emit('close', 137) // 128 + 9 (SIGKILL)
      await resultP
    })

    it('does NOT send SIGKILL if process exits before 5s', async () => {
      const task = makeTask()
      const controller = new AbortController()

      // Track kill calls
      const killCalls: string[] = []
      mockProc.kill = vi.fn((signal?: string): boolean => {
        killCalls.push(signal || 'SIGTERM')
        if (signal === 'SIGTERM') {
          mockProc.killed = true
        }
        return true
      })

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      controller.abort()

      expect(killCalls).toContain('SIGTERM')

      // Process exits quickly (before 5s escalation)
      mockProc.emit('close', 143)
      await resultP

      // Advance past the 5s timeout
      vi.advanceTimersByTime(6000)

      // No SIGKILL because proc.killed was already true
      expect(killCalls).not.toContain('SIGKILL')
    })

    it('removes abort event listener after process closes', async () => {
      const task = makeTask()
      const controller = new AbortController()
      const signal = controller.signal

      const addSpy = vi.spyOn(signal, 'addEventListener')
      const removeSpy = vi.spyOn(signal, 'removeEventListener')

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, signal,
        null, mockSpawn as never, existsSyncFn,
      )

      expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function))

      mockProc.close(0)
      await resultP

      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    })

    it('removes abort event listener on process error', async () => {
      const task = makeTask()
      const controller = new AbortController()
      const signal = controller.signal

      const removeSpy = vi.spyOn(signal, 'removeEventListener')

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.emitError(new Error('spawn ENOENT'))

      await expect(resultP).rejects.toThrow('spawn ENOENT')
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    })

    it('result includes collected output even when cancelled', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Send some output before aborting
      mockProc.sendStdout('partial output\n')
      mockProc.sendStderr('warning: timeout approaching\n')

      controller.abort()
      mockProc.close(143)

      const result = await resultP
      expect(result.output).toContain('partial output')
      expect(result.error).toContain('warning: timeout approaching')
      expect(result.exitCode).toBe(143)
    })
  })

  // ===========================================================================
  // (4) Process exit code handling
  // ===========================================================================

  describe('process exit code handling', () => {
    it('exit code 0 means success', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      const result = await resultP

      expect(result.exitCode).toBe(0)
    })

    it('exit code 1 means general failure', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.sendStderr('Error: something went wrong\n')
      mockProc.close(1)

      const result = await resultP

      expect(result.exitCode).toBe(1)
      expect(result.error).toContain('Error: something went wrong')
    })

    it('exit code 143 (SIGTERM) preserved', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(143) // 128 + SIGTERM(15)
      const result = await resultP

      expect(result.exitCode).toBe(143)
    })

    it('exit code 137 (SIGKILL) preserved', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(137) // 128 + SIGKILL(9)
      const result = await resultP

      expect(result.exitCode).toBe(137)
    })

    it('null exit code defaults to 1', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(null)
      const result = await resultP

      expect(result.exitCode).toBe(1)
    })

    it('exit code 2 preserved for argument errors', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.sendStderr('Unknown flag: --invalid\n')
      mockProc.close(2)

      const result = await resultP

      expect(result.exitCode).toBe(2)
      expect(result.error).toContain('Unknown flag')
    })

    it('collects stdout output on successful exit', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.sendStdout('{"type":"session.start","session_id":"s1"}\n')
      mockProc.sendStdout('{"type":"content.text","text":"Hello"}\n')
      mockProc.close(0)

      const result = await resultP

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('session.start')
      expect(result.output).toContain('Hello')
    })

    it('error is undefined when stderr is empty', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      const result = await resultP

      expect(result.error).toBeUndefined()
    })

    it('process error (ENOENT) rejects the promise', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.emitError(new Error('spawn /usr/local/bin/openclaw ENOENT'))

      await expect(resultP).rejects.toThrow('ENOENT')
    })

    it('spawn throwing rejects the promise', async () => {
      const task = makeTask()
      const controller = new AbortController()
      const throwingSpawn = vi.fn(() => { throw new Error('spawn failed') })

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, throwingSpawn as never, existsSyncFn,
      )

      await expect(resultP).rejects.toThrow('spawn failed')
    })

    it('collects metrics from session.end event', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.sendStdout(JSON.stringify({
        type: 'session.end',
        cost: 0.0042,
        input_tokens: 1000,
        output_tokens: 500,
        turns: 3,
        model: 'claude-sonnet-4-20250514',
        duration_ms: 12000,
      }) + '\n')
      mockProc.close(0)

      const result = await resultP

      expect(result.metrics).toEqual({
        totalCost: 0.0042,
        inputTokens: 1000,
        outputTokens: 500,
        numTurns: 3,
        model: 'claude-sonnet-4-20250514',
        durationMs: 12000,
      })
    })

    it('collects artifacts from file.change events', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.sendStdout(JSON.stringify({
        type: 'file.change',
        path: 'src/main.ts',
        action: 'modified',
        lines_added: 10,
        lines_removed: 5,
      }) + '\n')
      mockProc.sendStdout(JSON.stringify({
        type: 'file.change',
        path: 'src/utils.ts',
        action: 'created',
      }) + '\n')
      mockProc.close(0)

      const result = await resultP

      expect(result.artifacts).toHaveLength(2)
      expect(result.artifacts![0]).toEqual({
        type: 'file',
        name: 'src/main.ts',
        path: 'src/main.ts',
      })
      expect(result.artifacts![1]).toEqual({
        type: 'file',
        name: 'src/utils.ts',
        path: 'src/utils.ts',
      })
    })

    it('returns undefined artifacts when no file changes', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.sendStdout(JSON.stringify({ type: 'content.text', text: 'done' }) + '\n')
      mockProc.close(0)

      const result = await resultP

      expect(result.artifacts).toBeUndefined()
    })
  })

  // ===========================================================================
  // (5) Timeout handling
  // ===========================================================================

  describe('timeout handling', () => {
    it('sends SIGTERM when task.timeout is reached', async () => {
      const task = makeTask({ timeout: 30000 }) // 30s timeout
      const controller = new AbortController()

      // Don't mark as killed on SIGTERM to test escalation
      const killSignals: string[] = []
      mockProc.kill = vi.fn((signal?: string): boolean => {
        killSignals.push(signal || 'SIGTERM')
        if (signal === 'SIGKILL') {
          mockProc.killed = true
        }
        return true
      })

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Advance to just before timeout
      vi.advanceTimersByTime(29999)
      expect(killSignals).toHaveLength(0)

      // Advance past timeout
      vi.advanceTimersByTime(1)
      expect(killSignals).toContain('SIGTERM')

      // Close the process
      mockProc.emit('close', 143)
      await resultP
    })

    it('escalates to SIGKILL after timeout + 5s if process resists', async () => {
      const task = makeTask({ timeout: 10000 })
      const controller = new AbortController()

      const killSignals: string[] = []
      mockProc.kill = vi.fn((signal?: string): boolean => {
        killSignals.push(signal || 'SIGTERM')
        // Don't set killed for SIGTERM (process resists)
        if (signal === 'SIGKILL') {
          mockProc.killed = true
        }
        return true
      })

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Advance to timeout
      vi.advanceTimersByTime(10000)
      expect(killSignals).toEqual(['SIGTERM'])

      // Not yet escalated
      vi.advanceTimersByTime(4999)
      expect(killSignals).toEqual(['SIGTERM'])

      // Escalate at 5s after SIGTERM
      vi.advanceTimersByTime(1)
      expect(killSignals).toEqual(['SIGTERM', 'SIGKILL'])

      // Process finally closes
      mockProc.emit('close', 137)
      await resultP
    })

    it('does not send SIGKILL if process exits within 5s of SIGTERM', async () => {
      const task = makeTask({ timeout: 5000 })
      const controller = new AbortController()

      const killSignals: string[] = []
      mockProc.kill = vi.fn((signal?: string): boolean => {
        killSignals.push(signal || 'SIGTERM')
        mockProc.killed = true // Process exits promptly
        return true
      })

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Advance to timeout
      vi.advanceTimersByTime(5000)
      expect(killSignals).toEqual(['SIGTERM'])

      // Process closes before SIGKILL escalation
      mockProc.emit('close', 143)
      await resultP

      // Advance past the 5s escalation window
      vi.advanceTimersByTime(6000)

      // No SIGKILL since process was already killed
      expect(killSignals).toEqual(['SIGTERM'])
    })

    it('does not kill if no timeout is set', async () => {
      const task = makeTask({ timeout: undefined })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Advance a very long time
      vi.advanceTimersByTime(600000) // 10 minutes
      expect(mockProc.killSignals).toHaveLength(0)

      mockProc.close(0)
      await resultP
    })

    it('timeout of 0 does not set a timer', async () => {
      const task = makeTask({ timeout: 0 })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // timeout is falsy (0), so no timer set
      vi.advanceTimersByTime(100000)
      expect(mockProc.killSignals).toHaveLength(0)

      mockProc.close(0)
      await resultP
    })

    it('preserves partial output collected before timeout kills process', async () => {
      const task = makeTask({ timeout: 5000 })
      const controller = new AbortController()

      mockProc.kill = vi.fn((): boolean => {
        mockProc.killed = true
        return true
      })

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Send some output before timeout
      mockProc.sendStdout(JSON.stringify({ type: 'content.text', text: 'Working...' }) + '\n')
      mockProc.sendStdout(JSON.stringify({ type: 'file.change', path: 'src/a.ts', action: 'modified' }) + '\n')

      // Advance to timeout
      vi.advanceTimersByTime(5000)

      // Process terminates
      mockProc.emit('close', 143)

      const result = await resultP

      expect(result.output).toContain('Working...')
      expect(result.artifacts).toHaveLength(1)
      expect(result.exitCode).toBe(143)
    })
  })

  // ===========================================================================
  // (6) Working directory validation
  // ===========================================================================

  describe('working directory validation', () => {
    it('rejects when working directory does not exist', async () => {
      const task = makeTask({ workingDirectory: '/nonexistent/path' })
      const controller = new AbortController()

      existsSyncFn.mockReturnValue(false)

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      await expect(resultP).rejects.toThrow('Working directory does not exist: /nonexistent/path')
      await expect(resultP).rejects.toThrow('Ensure the directory exists on this machine before dispatching')

      // spawn should NOT have been called
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('proceeds when working directory exists', async () => {
      const task = makeTask({ workingDirectory: '/existing/project' })
      const controller = new AbortController()

      existsSyncFn.mockReturnValue(true)

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      const result = await resultP

      expect(result.exitCode).toBe(0)
      expect(mockSpawn).toHaveBeenCalledTimes(1)
      expect(existsSyncFn).toHaveBeenCalledWith('/existing/project')
    })

    it('skips validation when working directory is empty string', async () => {
      const task = makeTask({ workingDirectory: '' })
      const controller = new AbortController()

      // existsSyncFn should not be called for empty string (falsy)
      existsSyncFn.mockReturnValue(false)

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.close(0)
      const result = await resultP

      expect(result.exitCode).toBe(0)
      expect(existsSyncFn).not.toHaveBeenCalled()
    })

    it('error message includes the bad path', async () => {
      const task = makeTask({ workingDirectory: '/bad/dir/path' })
      const controller = new AbortController()

      existsSyncFn.mockReturnValue(false)

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      await expect(resultP).rejects.toThrow('/bad/dir/path')
    })
  })

  // ===========================================================================
  // (7) Stdout/stderr stream processing
  // ===========================================================================

  describe('stdout and stderr stream processing', () => {
    it('forwards stderr to stream.stderr', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.sendStderr('Warning: deprecated API\n')
      mockProc.close(0)

      await resultP

      expect(stream.stderr).toHaveBeenCalledWith('Warning: deprecated API\n')
    })

    it('flushes incomplete line buffer on close', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Send data without trailing newline
      mockProc.sendStdout('{"type":"content.text","text":"final"}')
      mockProc.close(0)

      await resultP

      // The incomplete buffer is flushed on close
      expect(stream.text).toHaveBeenCalledWith('final')
    })

    it('handles multi-line JSONL chunks', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Send multiple JSONL lines in a single chunk
      const chunk =
        '{"type":"session.start","session_id":"s1","model":"claude"}\n' +
        '{"type":"content.text","text":"Hello"}\n' +
        '{"type":"content.text","text":" world"}\n'

      mockProc.sendStdout(chunk)
      mockProc.close(0)

      await resultP

      expect(stream.sessionInit).toHaveBeenCalledWith('s1', 'claude')
      expect(stream.text).toHaveBeenCalledWith('Hello')
      expect(stream.text).toHaveBeenCalledWith(' world')
    })

    it('handles split JSONL lines across chunks', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Send a line split across two chunks
      mockProc.sendStdout('{"type":"content.te')
      mockProc.sendStdout('xt","text":"split"}\n')
      mockProc.close(0)

      await resultP

      expect(stream.text).toHaveBeenCalledWith('split')
    })

    it('skips empty lines', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.sendStdout('\n\n{"type":"content.text","text":"after gaps"}\n\n')
      mockProc.close(0)

      await resultP

      expect(stream.text).toHaveBeenCalledTimes(1)
      expect(stream.text).toHaveBeenCalledWith('after gaps')
    })

    it('sends non-JSON lines as raw stdout', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      mockProc.sendStdout('This is plain text output\n')
      mockProc.close(0)

      await resultP

      expect(stream.stdout).toHaveBeenCalledWith('This is plain text output\n')
    })
  })

  // ===========================================================================
  // (8) Full lifecycle integration
  // ===========================================================================

  describe('full lifecycle integration', () => {
    it('complete successful session: start → text → tools → files → end', async () => {
      const task = makeTask({
        model: 'claude-sonnet-4-20250514',
        environment: { CUSTOM_KEY: 'val' },
      })
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Session start
      mockProc.sendStdout(JSON.stringify({
        type: 'session.start', session_id: 'sess-100', model: 'claude-sonnet-4-20250514',
      }) + '\n')

      // Message start
      mockProc.sendStdout(JSON.stringify({ type: 'message.start' }) + '\n')

      // Text output
      mockProc.sendStdout(JSON.stringify({ type: 'content.text', text: 'I will fix the bug.' }) + '\n')

      // Tool use
      mockProc.sendStdout(JSON.stringify({
        type: 'tool_use.start', tool_name: 'Edit', tool_input: { path: 'src/fix.ts' },
      }) + '\n')
      mockProc.sendStdout(JSON.stringify({
        type: 'tool_use.end', tool_name: 'Edit', result: 'OK', success: true,
      }) + '\n')

      // File change
      mockProc.sendStdout(JSON.stringify({
        type: 'file.change', path: 'src/fix.ts', action: 'modified', lines_added: 3, lines_removed: 1,
      }) + '\n')

      // Message end
      mockProc.sendStdout(JSON.stringify({ type: 'message.end' }) + '\n')

      // Session end with metrics
      mockProc.sendStdout(JSON.stringify({
        type: 'session.end',
        cost: 0.0123,
        input_tokens: 2000,
        output_tokens: 800,
        turns: 2,
        model: 'claude-sonnet-4-20250514',
        duration_ms: 8500,
      }) + '\n')

      mockProc.close(0)

      const result = await resultP

      // Verify full result
      expect(result.exitCode).toBe(0)
      expect(result.artifacts).toHaveLength(1)
      expect(result.artifacts![0].path).toBe('src/fix.ts')
      expect(result.metrics).toEqual({
        totalCost: 0.0123,
        inputTokens: 2000,
        outputTokens: 800,
        numTurns: 2,
        model: 'claude-sonnet-4-20250514',
        durationMs: 8500,
      })

      // Verify stream calls
      expect(stream.sessionInit).toHaveBeenCalledWith('sess-100', 'claude-sonnet-4-20250514')
      expect(stream.text).toHaveBeenCalledWith('I will fix the bug.')
      expect(stream.toolUse).toHaveBeenCalledWith('Edit', { path: 'src/fix.ts' })
      expect(stream.toolResult).toHaveBeenCalledWith('Edit', 'OK', true)
      expect(stream.fileChange).toHaveBeenCalledWith('src/fix.ts', 'modified', 3, 1)
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Agent thinking...')
      expect(stream.status).toHaveBeenCalledWith('running', undefined, 'Turn complete')
      expect(stream.status).toHaveBeenCalledWith('running', 100, 'Completed (2 turns, $0.0123)')
    })

    it('timeout during active session produces partial results', async () => {
      const task = makeTask({ timeout: 2000 })
      const controller = new AbortController()

      mockProc.kill = vi.fn((): boolean => {
        mockProc.killed = true
        return true
      })

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // Some output arrives
      mockProc.sendStdout(JSON.stringify({
        type: 'session.start', session_id: 'timeout-sess',
      }) + '\n')
      mockProc.sendStdout(JSON.stringify({
        type: 'content.text', text: 'Starting analysis...',
      }) + '\n')
      mockProc.sendStdout(JSON.stringify({
        type: 'file.change', path: 'partial.ts', action: 'created',
      }) + '\n')

      // Timeout fires
      vi.advanceTimersByTime(2000)

      // Process terminates from signal
      mockProc.emit('close', 143)

      const result = await resultP

      expect(result.exitCode).toBe(143)
      expect(result.artifacts).toHaveLength(1)
      expect(result.artifacts![0].path).toBe('partial.ts')
      // No metrics since session.end never arrived
      expect(result.metrics).toBeUndefined()

      // Stream calls still happened
      expect(stream.sessionInit).toHaveBeenCalledWith('timeout-sess', undefined)
      expect(stream.text).toHaveBeenCalledWith('Starting analysis...')
    })

    it('abort during tool execution preserves completed tool results', async () => {
      const task = makeTask()
      const controller = new AbortController()

      const resultP = runOpenClaw(
        '/usr/local/bin/openclaw', task, stream, controller.signal,
        null, mockSpawn as never, existsSyncFn,
      )

      // First tool completes
      mockProc.sendStdout(JSON.stringify({
        type: 'tool_use.start', tool_name: 'Read', tool_input: { path: 'a.ts' },
      }) + '\n')
      mockProc.sendStdout(JSON.stringify({
        type: 'tool_use.end', tool_name: 'Read', result: 'file contents', success: true,
      }) + '\n')

      // Second tool starts but abort fires before completion
      mockProc.sendStdout(JSON.stringify({
        type: 'tool_use.start', tool_name: 'Edit', tool_input: { path: 'b.ts' },
      }) + '\n')

      controller.abort()
      mockProc.close(143)

      const result = await resultP

      // Both tool_use events were processed
      expect(stream.toolUse).toHaveBeenCalledTimes(2)
      expect(stream.toolResult).toHaveBeenCalledTimes(1) // Only first completed
      expect(result.exitCode).toBe(143)
    })
  })
})

// =============================================================================
// Source code verification tests — validates the actual adapter file
// =============================================================================

describe('OpenClaw adapter source code verification', () => {
  let source: string

  try {
    const adapterPath = join(process.cwd(), 'packages/agent-runner/src/providers/openclaw-adapter.ts')
    source = readFileSync(adapterPath, 'utf-8')
  } catch {
    // Submodule not initialized — skip source verification
    source = ''
  }

  const skipIfNoSource = source ? it : it.skip

  describe('CLI invocation pattern', () => {
    skipIfNoSource('uses openclaw agent --mode rpc --json', () => {
      expect(source).toContain("'agent'")
      expect(source).toContain("'--mode'")
      expect(source).toContain("'rpc'")
      expect(source).toContain("'--json'")
    })

    skipIfNoSource('passes prompt via --prompt flag', () => {
      expect(source).toContain("'--prompt'")
      expect(source).toContain('effectivePrompt')
    })

    skipIfNoSource('supports optional --model flag', () => {
      expect(source).toContain("'--model'")
      expect(source).toContain('model ?')
    })
  })

  describe('environment handling', () => {
    skipIfNoSource('spreads process.env and task.environment', () => {
      expect(source).toContain('...process.env')
      expect(source).toContain('...task.environment')
    })
  })

  describe('abort handling', () => {
    skipIfNoSource('sends SIGTERM on abort', () => {
      expect(source).toContain("proc.kill('SIGTERM')")
    })

    skipIfNoSource('escalates to SIGKILL after 5s', () => {
      expect(source).toContain("proc.kill('SIGKILL')")
      expect(source).toContain('5000')
    })

    skipIfNoSource('registers and removes abort listener', () => {
      expect(source).toContain("signal.addEventListener('abort', abortHandler)")
      expect(source).toContain("signal.removeEventListener('abort', abortHandler)")
    })
  })

  describe('exit code handling', () => {
    skipIfNoSource('uses null-coalescing to default exit code to 1', () => {
      expect(source).toContain('code ?? 1')
    })
  })

  describe('working directory validation', () => {
    skipIfNoSource('validates directory existence before spawning', () => {
      expect(source).toContain('existsSync(task.workingDirectory)')
      expect(source).toContain('Working directory does not exist')
    })
  })

  describe('timeout handling', () => {
    skipIfNoSource('uses task.timeout to set a kill timer', () => {
      expect(source).toContain('task.timeout')
      expect(source).toContain('setTimeout')
    })

    skipIfNoSource('timeout uses same SIGTERM → SIGKILL escalation', () => {
      // Both abort and timeout use the same pattern
      const sigtermMatches = (source.match(/proc\.kill\('SIGTERM'\)/g) || []).length
      const sigkillMatches = (source.match(/proc\.kill\('SIGKILL'\)/g) || []).length
      // There should be 2 SIGTERM calls (abort + timeout) and 2 SIGKILL calls
      expect(sigtermMatches).toBeGreaterThanOrEqual(2)
      expect(sigkillMatches).toBeGreaterThanOrEqual(2)
    })
  })

  describe('system prompt concatenation', () => {
    skipIfNoSource('combines systemPrompt with prompt using separator', () => {
      expect(source).toContain('task.systemPrompt')
      expect(source).toContain('\\n\\n---\\n\\n')
    })
  })
})
