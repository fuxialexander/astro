/**
 * Claude Code SDK Integration Tests
 *
 * Smoke tests that actually call the Claude Agent SDK to verify:
 * - execute() and stream() produce valid results
 * - SessionLogger captures real SDK messages
 * - fallbackModel is accepted
 * - env passthrough works
 * - cancel() works mid-execution
 *
 * Requires authentication: ANTHROPIC_API_KEY or Claude Code OAuth.
 * Auto-skips when auth is unavailable.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ClaudeCodeProvider } from '../server/lib/providers/adapters/claude-code.js'
import type { TaskDispatch, StreamEvent } from '../server/lib/providers/types.js'

// ============================================================================
// Auth check — skip entire suite if SDK not authenticated
// ============================================================================

const provider = new ClaudeCodeProvider()
const sessionsDir = join(homedir(), '.astro', 'logs', 'sessions')
const cleanupFiles: string[] = []

function trackSessionFiles(taskId: string): void {
  cleanupFiles.push(join(sessionsDir, `${taskId}.jsonl`))
  cleanupFiles.push(join(sessionsDir, `${taskId}.md`))
}

afterAll(() => {
  for (const f of cleanupFiles) {
    try {
      rmSync(f)
    } catch {
      /* best effort */
    }
  }
})

// Check if SDK is authenticated; skip all tests if not
let isAuthenticated = false
try {
  const detection = await provider.detect()
  isAuthenticated = detection.installed && detection.authStatus === 'authenticated'
} catch {
  isAuthenticated = false
}

describe.skipIf(!isAuthenticated)('Claude Code SDK Integration', () => {
  it('execute() — basic prompt (no tools)', async () => {
    const taskId = `sdk-test-execute-${Date.now()}`
    trackSessionFiles(taskId)

    const task: TaskDispatch = {
      taskId,
      type: 'chat',
      prompt: 'Respond with exactly: SDK_TEST_OK',
      maxTurns: 1,
      context: { projectId: 'test-project' },
    }

    const result = await provider.execute(task)

    expect(result.taskId).toBe(taskId)
    expect(result.providerId).toBe('claude-code')
    expect(result.status).toBe('success')
    expect(result.sessionId).toBeDefined()
    expect(result.stdout).toBeDefined()
    expect(result.stdout!.length).toBeGreaterThan(0)
    expect(result.stdout).toContain('SDK_TEST_OK')
    expect(result.metrics.durationMs).toBeGreaterThan(0)
    expect(result.metrics.model).toBeDefined()
    expect(result.completedAt).toBeInstanceOf(Date)

    // Verify session logger files
    const jsonlPath = join(sessionsDir, `${taskId}.jsonl`)
    const mdPath = join(sessionsDir, `${taskId}.md`)
    expect(existsSync(jsonlPath)).toBe(true)
    expect(existsSync(mdPath)).toBe(true)

    if (existsSync(jsonlPath)) {
      const content = readFileSync(jsonlPath, 'utf-8').trim()
      if (content.length > 0) {
        const lines = content.split('\n')
        expect(lines.length).toBeGreaterThanOrEqual(2)
        const firstEntry = JSON.parse(lines[0])
        expect(firstEntry.type).toBe('system')
      }
    }

    if (existsSync(mdPath)) {
      const md = readFileSync(mdPath, 'utf-8')
      expect(md).toContain('| Status | success |')
    }
  }, 60_000)

  it('stream() — streaming events', async () => {
    const taskId = `sdk-test-stream-${Date.now()}`
    trackSessionFiles(taskId)

    const task: TaskDispatch = {
      taskId,
      type: 'chat',
      prompt: 'Respond with exactly: STREAM_TEST_OK',
      maxTurns: 1,
      context: { projectId: 'test-project' },
    }

    const events: StreamEvent[] = []
    for await (const event of provider.stream(task)) {
      events.push(event)
    }

    const initEvents = events.filter((e) => e.type === 'init')
    expect(initEvents).toHaveLength(1)
    if (initEvents.length > 0) {
      const init = initEvents[0] as { type: 'init'; sessionId: string; model: string }
      expect(init.sessionId).toBeDefined()
      expect(init.model).toBeDefined()
    }

    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents.length).toBeGreaterThanOrEqual(1)
    const fullText = textEvents.map((e) => (e as { text: string }).text).join('')
    expect(fullText).toContain('STREAM_TEST_OK')

    const resultEvents = events.filter((e) => e.type === 'result')
    expect(resultEvents).toHaveLength(1)

    for (const event of events) {
      expect(event.taskId).toBe(taskId)
      expect(event.timestamp).toBeInstanceOf(Date)
    }
  }, 60_000)

  it('execute() — with tools (code_generation)', async () => {
    const taskId = `sdk-test-tools-${Date.now()}`
    trackSessionFiles(taskId)

    const task: TaskDispatch = {
      taskId,
      type: 'code_generation',
      prompt:
        'Use the Read tool to read the file /etc/hostname, then respond with the content. Keep your response very short.',
      maxTurns: 3,
      context: {
        projectId: 'test-project',
        workingDirectory: '/tmp',
      },
    }

    const result = await provider.execute(task)

    expect(result.status).toBe('success')
    expect(result.stdout).toBeDefined()
    expect(result.stdout!.length).toBeGreaterThan(0)
    expect(result.metrics.durationMs).toBeGreaterThan(0)
  }, 120_000)

  it('stream() — env passthrough', async () => {
    const taskId = `sdk-test-env-${Date.now()}`
    trackSessionFiles(taskId)

    const task: TaskDispatch = {
      taskId,
      type: 'code_generation',
      prompt:
        'Run this exact bash command: echo $ASTRO_TEST_VAR — then tell me the value you see. Keep response very short.',
      maxTurns: 3,
      context: {
        projectId: 'test-project',
        workingDirectory: '/tmp',
        environmentVariables: {
          ASTRO_TEST_VAR: 'hello_from_astro_test',
        },
      },
    }

    const events: StreamEvent[] = []
    for await (const event of provider.stream(task)) {
      events.push(event)
    }

    const resultEvents = events.filter((e) => e.type === 'result')
    expect(resultEvents).toHaveLength(1)

    const allText = events
      .filter((e) => e.type === 'text' || e.type === 'tool_result')
      .map((e) => {
        if (e.type === 'text') return (e as unknown as { text: string }).text
        if (e.type === 'tool_result')
          return String((e as unknown as { result?: unknown }).result ?? '')
        return ''
      })
      .join('')
    expect(allText).toContain('hello_from_astro_test')
  }, 120_000)

  it('execute() — fallbackModel does not cause errors', async () => {
    const taskId = `sdk-test-fallback-${Date.now()}`
    trackSessionFiles(taskId)

    const task: TaskDispatch = {
      taskId,
      type: 'chat',
      prompt: 'Respond with exactly: FALLBACK_OK',
      maxTurns: 1,
      context: { projectId: 'test-project' },
    }

    const result = await provider.execute(task)

    expect(result.status).toBe('success')
    expect(result.stdout).toContain('FALLBACK_OK')

    const caps = provider.capabilities()
    expect(caps.fallbackModel).toBe('sonnet')
  }, 60_000)

  it('cancel() — abort mid-execution', async () => {
    const taskId = `sdk-test-cancel-${Date.now()}`
    trackSessionFiles(taskId)

    const task: TaskDispatch = {
      taskId,
      type: 'chat',
      prompt:
        'Write a very long essay about the history of computing, at least 5000 words. Include every detail you know.',
      maxTurns: 1,
      context: { projectId: 'test-project' },
    }

    const streamPromise = (async () => {
      const events: StreamEvent[] = []
      try {
        for await (const event of provider.stream(task)) {
          events.push(event)
        }
      } catch {
        // Expected: abort error
      }
      return events
    })()

    await new Promise((resolve) => setTimeout(resolve, 3000))
    const cancelled = await provider.cancel(taskId)
    expect(cancelled).toBe(true)

    const events = await streamPromise
    expect(events.length).toBeGreaterThanOrEqual(1)
  }, 60_000)
})
