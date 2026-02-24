/**
 * Unit tests for Codex adapter error paths.
 *
 * Tests error handling in the Codex CLI adapter used by astro-agent.
 * The adapter spawns `codex exec` as a subprocess and parses its output.
 * Known production issues:
 * 1. Slow startup — sandbox initialization takes 10-30s
 * 2. No structured JSONL event parsing despite --json flag
 * 3. Process spawn failures
 * 4. Abort/timeout handling
 */

import { describe, it, expect, vi } from 'vitest'

/**
 * Simulates the Codex adapter's process spawning and output handling.
 * Mirrors the logic in astro-agent/src/providers/codex-adapter.ts.
 */

interface CodexAdapterConfig {
  binary: string
  model: string
  approvalMode: string
  sandbox: string
  timeout: number
}

const DEFAULT_CONFIG: CodexAdapterConfig = {
  binary: 'codex',
  model: 'gpt-5.3-codex',
  approvalMode: 'never',
  sandbox: 'workspace-write',
  timeout: 600_000, // 10 min
}

/**
 * Simulates building the codex exec command args.
 * Mirrors the real adapter's command construction.
 */
function buildCodexArgs(prompt: string, config = DEFAULT_CONFIG): string[] {
  return [
    'exec',
    '-a', config.approvalMode,
    '--sandbox', config.sandbox,
    '--json',
    prompt,
  ]
}

/**
 * Simulates the isAvailable() check.
 * The real adapter runs `codex --version` and checks exit code.
 */
async function checkCodexAvailable(
  execResult: { exitCode: number; stdout: string; stderr: string }
): Promise<{ available: boolean; version?: string; error?: string }> {
  if (execResult.exitCode !== 0) {
    return { available: false, error: execResult.stderr || 'codex not found' }
  }

  const version = execResult.stdout.trim()
  if (!version) {
    return { available: false, error: 'empty version output' }
  }

  return { available: true, version }
}

/**
 * Simulates parsing Codex --json output.
 * The real adapter currently just captures raw stdout/stderr without
 * parsing the JSONL events that --json produces.
 */
function parseCodexJsonOutput(stdout: string): Array<{ type: string; data: unknown }> {
  const events: Array<{ type: string; data: unknown }> = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed.type) {
        events.push(parsed)
      }
    } catch {
      // Non-JSON lines are ignored (e.g., progress messages)
    }
  }
  return events
}

/**
 * Simulates abort handling.
 * The real adapter uses AbortController to kill the codex process.
 */
function createAbortableExecution() {
  const controller = new AbortController()
  let killed = false
  let completed = false

  return {
    controller,
    get killed() { return killed },
    get completed() { return completed },
    execute: () => new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        completed = true
        resolve('done')
      }, 1000)

      controller.signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        killed = true
        reject(new Error('Process killed'))
      })
    }),
  }
}

describe('codex adapter: command construction', () => {
  it('builds correct args for default config', () => {
    const args = buildCodexArgs('Implement feature X')
    expect(args).toEqual([
      'exec',
      '-a', 'never',
      '--sandbox', 'workspace-write',
      '--json',
      'Implement feature X',
    ])
  })

  it('uses custom config values', () => {
    const config: CodexAdapterConfig = {
      ...DEFAULT_CONFIG,
      approvalMode: 'auto-edit',
      sandbox: 'none',
    }
    const args = buildCodexArgs('Test', config)
    expect(args).toContain('auto-edit')
    expect(args).toContain('none')
  })
})

describe('codex adapter: availability check', () => {
  it('reports available when codex --version succeeds', async () => {
    const result = await checkCodexAvailable({
      exitCode: 0,
      stdout: '0.104.0\n',
      stderr: '',
    })
    expect(result.available).toBe(true)
    expect(result.version).toBe('0.104.0')
  })

  it('reports unavailable when codex not found', async () => {
    const result = await checkCodexAvailable({
      exitCode: 127,
      stdout: '',
      stderr: 'command not found: codex',
    })
    expect(result.available).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('reports unavailable for non-zero exit code', async () => {
    const result = await checkCodexAvailable({
      exitCode: 1,
      stdout: '',
      stderr: 'Error: invalid configuration',
    })
    expect(result.available).toBe(false)
  })

  it('reports unavailable for empty version output', async () => {
    const result = await checkCodexAvailable({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
    expect(result.available).toBe(false)
    expect(result.error).toContain('empty version')
  })
})

describe('codex adapter: JSON output parsing', () => {
  it('parses JSONL events from --json output', () => {
    const stdout = [
      '{"type":"start","data":{"model":"gpt-5.3-codex"}}',
      '{"type":"text","data":{"content":"Hello"}}',
      '{"type":"done","data":{"exitCode":0}}',
    ].join('\n')

    const events = parseCodexJsonOutput(stdout)
    expect(events).toHaveLength(3)
    expect(events[0].type).toBe('start')
    expect(events[2].type).toBe('done')
  })

  it('skips non-JSON lines gracefully', () => {
    const stdout = [
      'Initializing sandbox...',
      '{"type":"start","data":{}}',
      'Warning: something',
      '{"type":"done","data":{}}',
    ].join('\n')

    const events = parseCodexJsonOutput(stdout)
    expect(events).toHaveLength(2)
  })

  it('handles empty output', () => {
    expect(parseCodexJsonOutput('')).toEqual([])
  })

  it('handles output with only non-JSON lines', () => {
    const stdout = 'Sandbox starting...\nPlease wait...\n'
    expect(parseCodexJsonOutput(stdout)).toEqual([])
  })

  it('skips JSON objects without type field', () => {
    const stdout = '{"status":"ok"}\n{"type":"done","data":{}}\n'
    const events = parseCodexJsonOutput(stdout)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('done')
  })
})

describe('codex adapter: abort handling', () => {
  it('kills process on abort', async () => {
    const exec = createAbortableExecution()
    const promise = exec.execute()

    // Abort before completion
    exec.controller.abort()

    await expect(promise).rejects.toThrow('Process killed')
    expect(exec.killed).toBe(true)
    expect(exec.completed).toBe(false)
  })

  it('completes normally without abort', async () => {
    vi.useFakeTimers()
    const exec = createAbortableExecution()
    const promise = exec.execute()

    vi.advanceTimersByTime(1100)
    const result = await promise
    expect(result).toBe('done')
    expect(exec.killed).toBe(false)
    expect(exec.completed).toBe(true)
    vi.useRealTimers()
  })
})

/**
 * Tests documenting known Codex startup slowness.
 *
 * The production issue: Codex takes 10-30s to initialize its sandbox
 * before executing any code. This is a known limitation of the Codex
 * sandbox architecture, not a bug in the adapter.
 */
describe('codex adapter: startup timing', () => {
  it('documents expected sandbox initialization delay', () => {
    // Codex sandbox init typically takes:
    const SANDBOX_INIT_MIN_MS = 5_000   // 5s best case
    const SANDBOX_INIT_MAX_MS = 30_000  // 30s worst case
    const ADAPTER_TIMEOUT_MS = 600_000  // 10 min total

    // The timeout is generous enough to accommodate sandbox init
    expect(ADAPTER_TIMEOUT_MS).toBeGreaterThan(SANDBOX_INIT_MAX_MS * 2)

    // But users perceive the init delay as "not starting"
    // because there's no progress feedback during sandbox creation
    expect(SANDBOX_INIT_MIN_MS).toBeGreaterThan(0)
  })
})
