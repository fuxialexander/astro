/**
 * Claude Code Provider Tests
 *
 * Unit tests for ClaudeCodeProvider features:
 * - loadDotEnv() helper
 * - buildAppendContent() from cache-utils
 * - calculateCacheStats() and addToolCaching() from cache-utils
 * - SessionLogger (JSONL + Markdown)
 * - Provider capabilities (fallbackModel)
 * - Provider config (hooks, extraArgs)
 * - Type contract checks
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { loadDotEnv, ClaudeCodeProvider } from '../server/lib/providers/adapters/claude-code.js'
import {
  buildAppendContent,
  calculateCacheStats,
  addToolCaching,
} from '../server/lib/providers/cache-utils.js'
import { SessionLogger } from '../server/lib/providers/session-logger.js'
import type { TaskResult, TaskContext, ProviderCapabilities } from '../server/lib/providers/types.js'

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(suffix: string): string {
  const dir = join(tmpdir(), `astro-test-${suffix}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

const dirsToCleanup: string[] = []

afterEach(() => {
  for (const dir of dirsToCleanup) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup
    }
  }
  dirsToCleanup.length = 0
})

// ============================================================================
// loadDotEnv
// ============================================================================

describe('loadDotEnv', () => {
  it('returns empty object for undefined dir', () => {
    expect(loadDotEnv(undefined)).toEqual({})
  })

  it('returns empty object for non-existent dir', () => {
    expect(loadDotEnv('/tmp/does-not-exist-' + Date.now())).toEqual({})
  })

  it('parses simple KEY=VALUE pairs', () => {
    const dir = createTempDir('dotenv-simple')
    dirsToCleanup.push(dir)
    writeFileSync(join(dir, '.env'), 'FOO=bar\nBAZ=qux\n')

    const result = loadDotEnv(dir)
    expect(result.FOO).toBe('bar')
    expect(result.BAZ).toBe('qux')
  })

  it('strips double-quoted values', () => {
    const dir = createTempDir('dotenv-quotes')
    dirsToCleanup.push(dir)
    writeFileSync(join(dir, '.env'), 'DB_URL="postgres://localhost/db"\n')

    expect(loadDotEnv(dir).DB_URL).toBe('postgres://localhost/db')
  })

  it('strips single-quoted values', () => {
    const dir = createTempDir('dotenv-single-quotes')
    dirsToCleanup.push(dir)
    writeFileSync(join(dir, '.env'), "SECRET='my-secret'\n")

    expect(loadDotEnv(dir).SECRET).toBe('my-secret')
  })

  it('skips comments and blank lines', () => {
    const dir = createTempDir('dotenv-comments')
    dirsToCleanup.push(dir)
    writeFileSync(
      join(dir, '.env'),
      [
        '# This is a comment',
        '',
        'KEY1=value1',
        '  # Another comment',
        '  ',
        'KEY2=value2',
      ].join('\n')
    )

    const result = loadDotEnv(dir)
    expect(Object.keys(result)).toHaveLength(2)
    expect(result.KEY1).toBe('value1')
    expect(result.KEY2).toBe('value2')
  })

  it('handles inline comments for unquoted values', () => {
    const dir = createTempDir('dotenv-inline')
    dirsToCleanup.push(dir)
    writeFileSync(join(dir, '.env'), 'PORT=3000 # server port\n')

    expect(loadDotEnv(dir).PORT).toBe('3000')
  })

  it('preserves hash in double-quoted values', () => {
    const dir = createTempDir('dotenv-hash')
    dirsToCleanup.push(dir)
    writeFileSync(join(dir, '.env'), 'COLOR="#ff0000"\n')

    expect(loadDotEnv(dir).COLOR).toBe('#ff0000')
  })

  it('handles empty values', () => {
    const dir = createTempDir('dotenv-empty')
    dirsToCleanup.push(dir)
    writeFileSync(join(dir, '.env'), 'EMPTY=\nALSO_EMPTY=""\n')

    const result = loadDotEnv(dir)
    expect(result.EMPTY).toBe('')
    expect(result.ALSO_EMPTY).toBe('')
  })

  it('handles values with = signs', () => {
    const dir = createTempDir('dotenv-equals')
    dirsToCleanup.push(dir)
    writeFileSync(join(dir, '.env'), 'URL=https://example.com?a=1&b=2\n')

    expect(loadDotEnv(dir).URL).toBe('https://example.com?a=1&b=2')
  })

  it('skips lines without = sign', () => {
    const dir = createTempDir('dotenv-noequals')
    dirsToCleanup.push(dir)
    writeFileSync(join(dir, '.env'), 'GOOD=value\nBADLINE\nALSO_GOOD=works\n')

    const result = loadDotEnv(dir)
    expect(Object.keys(result)).toHaveLength(2)
    expect(result).not.toHaveProperty('BADLINE')
  })
})

// ============================================================================
// buildAppendContent
// ============================================================================

describe('buildAppendContent', () => {
  it('returns undefined when no options provided', () => {
    expect(buildAppendContent({})).toBeUndefined()
  })

  it('returns undefined when all options are undefined', () => {
    expect(
      buildAppendContent({
        baseInstructions: undefined,
        visionDoc: undefined,
        dependencyContext: undefined,
        workingDirectory: undefined,
      })
    ).toBeUndefined()
  })

  it('includes base instructions', () => {
    const result = buildAppendContent({ baseInstructions: 'You are a helpful assistant.' })
    expect(result).toBeDefined()
    expect(result).toContain('You are a helpful assistant.')
  })

  it('includes vision doc with header', () => {
    const result = buildAppendContent({ visionDoc: 'Build an AI platform.' })
    expect(result).toBeDefined()
    expect(result).toContain('## Project Vision')
    expect(result).toContain('Build an AI platform.')
  })

  it('includes dependency context with header', () => {
    const result = buildAppendContent({
      dependencyContext: 'Task A output: schema.sql created',
    })
    expect(result).toBeDefined()
    expect(result).toContain('## Previous Task Outputs')
    expect(result).toContain('schema.sql created')
  })

  it('includes working directory with header', () => {
    const result = buildAppendContent({ workingDirectory: '/home/user/project' })
    expect(result).toBeDefined()
    expect(result).toContain('## Working Directory')
    expect(result).toContain('/home/user/project')
  })

  it('combines multiple sections with double newlines', () => {
    const result = buildAppendContent({
      visionDoc: 'Vision content',
      dependencyContext: 'Dep content',
      workingDirectory: '/tmp/work',
    })
    expect(result).toBeDefined()
    expect(result).toContain('## Project Vision')
    expect(result).toContain('## Previous Task Outputs')
    expect(result).toContain('## Working Directory')
    expect(result).toContain('\n\n')
  })
})

// ============================================================================
// calculateCacheStats
// ============================================================================

describe('calculateCacheStats', () => {
  it('handles empty usage', () => {
    const stats = calculateCacheStats({})
    expect(stats.totalInputTokens).toBe(0)
    expect(stats.cacheHitRate).toBe(0)
    expect(stats.estimatedSavings).toBe(0)
  })

  it('calculates cache hit rate correctly', () => {
    const stats = calculateCacheStats({
      input_tokens: 100,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 0,
    })
    expect(stats.totalInputTokens).toBe(1000)
    expect(stats.cacheHitRate).toBe(0.9)
    expect(stats.estimatedSavings).toBe(81)
  })

  it('handles all cache reads', () => {
    const stats = calculateCacheStats({
      input_tokens: 0,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 0,
    })
    expect(stats.cacheHitRate).toBe(1)
    expect(stats.estimatedSavings).toBe(90)
  })

  it('handles zero cache reads', () => {
    const stats = calculateCacheStats({
      input_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 500,
    })
    expect(stats.cacheHitRate).toBe(0)
    expect(stats.estimatedSavings).toBe(0)
  })
})

// ============================================================================
// addToolCaching
// ============================================================================

describe('addToolCaching', () => {
  it('returns empty array for empty input', () => {
    expect(addToolCaching([])).toHaveLength(0)
  })

  it('adds cache_control to last tool', () => {
    const tools = [
      { name: 'Read', type: 'function' },
      { name: 'Write', type: 'function' },
    ]
    const cached = addToolCaching(tools)

    expect(cached).toHaveLength(2)
    expect(cached[0]).not.toHaveProperty('cache_control')
    expect((cached[1] as Record<string, unknown>).cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    })
  })

  it('supports custom TTL', () => {
    const tools = [{ name: 'Tool1', type: 'function' }]
    const cached = addToolCaching(tools, '5m')

    expect((cached[0] as Record<string, unknown>).cache_control).toEqual({
      type: 'ephemeral',
      ttl: '5m',
    })
  })

  it('does not mutate original array', () => {
    const tools = [{ name: 'Tool1', type: 'function' }]
    addToolCaching(tools)
    expect(tools[0]).not.toHaveProperty('cache_control')
  })
})

// ============================================================================
// SessionLogger
// ============================================================================

describe('SessionLogger', () => {
  const sessionsDir = join(homedir(), '.astro', 'logs', 'sessions')
  const filesToCleanup: string[] = []

  afterEach(() => {
    for (const f of filesToCleanup) {
      try {
        rmSync(f)
      } catch {
        // Best effort
      }
    }
    filesToCleanup.length = 0
  })

  it('writes JSONL and Markdown files', async () => {
    const testTaskId = `test-session-${Date.now()}`
    const logger = new SessionLogger(testTaskId)

    logger.log({
      type: 'system',
      subtype: 'init',
      model: 'claude-sonnet-4-5-20250929',
      session_id: 'sess-123',
    })
    logger.log({ type: 'tool_use', toolName: 'Read' })
    logger.log({ type: 'tool_use', toolName: 'Edit' })
    logger.log({ type: 'tool_use', toolName: 'Bash' })
    logger.log({ type: 'text', text: 'Hello, ' })
    logger.log({ type: 'text', text: 'world!' })

    const result: TaskResult = {
      taskId: testTaskId,
      sessionId: 'sess-123',
      status: 'success',
      metrics: {
        durationMs: 5000,
        estimatedCostUsd: 0.0042,
        model: 'claude-sonnet-4-5-20250929',
        turnsUsed: 3,
        inputTokens: 1500,
        outputTokens: 500,
      },
      providerId: 'claude-code',
      completedAt: new Date(),
    }

    await logger.finalize(result)

    const jsonlPath = join(sessionsDir, `${testTaskId}.jsonl`)
    const mdPath = join(sessionsDir, `${testTaskId}.md`)
    filesToCleanup.push(jsonlPath, mdPath)

    expect(existsSync(jsonlPath)).toBe(true)
    expect(existsSync(mdPath)).toBe(true)

    // Verify JSONL content
    const jsonlContent = readFileSync(jsonlPath, 'utf-8')
    const jsonlLines = jsonlContent.trim().split('\n')
    expect(jsonlLines).toHaveLength(6)

    const firstEntry = JSON.parse(jsonlLines[0])
    expect(firstEntry.type).toBe('system')
    expect(firstEntry.subtype).toBe('init')
    expect(firstEntry.model).toBe('claude-sonnet-4-5-20250929')
    expect(firstEntry).toHaveProperty('_ts')

    // Verify Markdown content
    const mdContent = readFileSync(mdPath, 'utf-8')
    expect(mdContent).toContain(`# Session: ${testTaskId}`)
    expect(mdContent).toContain('| Status | success |')
    expect(mdContent).toContain('| Duration | 5.0s |')
    expect(mdContent).toContain('| Cost | $0.0042 |')
    expect(mdContent).toContain('| Turns | 3 |')
    expect(mdContent).toContain('| Model | claude-sonnet-4-5-20250929 |')
    expect(mdContent).toContain('| Session ID | `sess-123` |')
    expect(mdContent).toContain('## Tool Calls')
    expect(mdContent).toContain('- `Read`')
    expect(mdContent).toContain('- `Edit`')
    expect(mdContent).toContain('- `Bash`')
    expect(mdContent).toContain('## Output')
    expect(mdContent).toContain('Hello, world!')
  })

  it('handles error results', async () => {
    const errorTaskId = `test-error-${Date.now()}`
    const logger = new SessionLogger(errorTaskId)

    logger.log({ type: 'text', text: 'Starting...' })

    const result: TaskResult = {
      taskId: errorTaskId,
      status: 'error',
      errorMessage: 'SDK connection failed: timeout after 30s',
      metrics: { durationMs: 30000 },
      providerId: 'claude-code',
      completedAt: new Date(),
    }

    await logger.finalize(result)

    const mdPath = join(sessionsDir, `${errorTaskId}.md`)
    const jsonlPath = join(sessionsDir, `${errorTaskId}.jsonl`)
    filesToCleanup.push(mdPath, jsonlPath)

    expect(existsSync(mdPath)).toBe(true)

    const mdContent = readFileSync(mdPath, 'utf-8')
    expect(mdContent).toContain('| Status | error |')
    expect(mdContent).toContain('## Error')
    expect(mdContent).toContain('SDK connection failed')
    expect(mdContent).toContain('| Session ID | `N/A` |')
  })
})

// ============================================================================
// ClaudeCodeProvider capabilities & config
// ============================================================================

describe('ClaudeCodeProvider', () => {
  it('capabilities() includes fallbackModel', () => {
    const provider = new ClaudeCodeProvider()
    const caps = provider.capabilities()

    expect(caps.fallbackModel).toBe('sonnet')
    expect(caps.providerId).toBe('claude-code')
    expect(caps.supportsSessionResume).toBe(true)
    expect(caps.supportsStreaming).toBe(true)
    expect(caps.contextInjectionMethod).toBe('system_prompt')
  })

  it('capabilities() lists expected models', () => {
    const provider = new ClaudeCodeProvider()
    const caps = provider.capabilities()

    expect(caps.availableModels).toContain('claude-sonnet-4-5-20250929')
    expect(caps.availableModels).toContain('claude-opus-4-6')
    expect(caps.availableModels.length).toBeGreaterThanOrEqual(3)
  })

  it('accepts config with hooks and extraArgs', () => {
    const provider = new ClaudeCodeProvider({
      hooks: { 'pre-tool': { command: 'echo hello' } },
      extraArgs: { '--verbose': null, '--timeout': '30000' },
    })
    const caps = provider.capabilities()
    expect(caps.providerId).toBe('claude-code')
  })

  it('prepareContext() uses buildAppendContent pattern', async () => {
    const provider = new ClaudeCodeProvider()
    const ctx = await provider.prepareContext({
      projectId: 'proj-1',
      visionDoc: 'Build something great',
      workingDirectory: '/tmp/test-project',
      dependencyContext: 'Previous task created schema.sql',
    })

    expect(ctx.method).toBe('system_prompt')
    expect(ctx.promptContent).toBeDefined()
    expect(ctx.promptContent).toContain('## Project Vision')
    expect(ctx.promptContent).toContain('Build something great')
    expect(ctx.promptContent).toContain('## Previous Task Outputs')
    expect(ctx.promptContent).toContain('## Working Directory')
    expect(ctx.promptContent).toContain('/tmp/test-project')
  })

  it('prepareContext() returns undefined promptContent when no context', async () => {
    const provider = new ClaudeCodeProvider()
    const ctx = await provider.prepareContext({ projectId: 'proj-1' })

    expect(ctx.method).toBe('system_prompt')
    expect(ctx.promptContent).toBeUndefined()
  })
})

// ============================================================================
// Type contract checks (compile-time validation)
// ============================================================================

describe('Type Contracts', () => {
  it('TaskContext supports approvalCallback field', () => {
    const ctx: TaskContext = {
      projectId: 'proj-1',
      approvalCallback: async (_executionId, _question, options) => {
        return options[0]
      },
    }
    expect(typeof ctx.approvalCallback).toBe('function')
  })

  it('TaskContext supports hooks field', () => {
    const ctx: TaskContext = {
      projectId: 'proj-1',
      hooks: { 'pre-tool': { command: 'echo' } },
    }
    expect(ctx.hooks).toBeDefined()
  })

  it('TaskContext supports extraArgs field', () => {
    const ctx: TaskContext = {
      projectId: 'proj-1',
      extraArgs: { '--flag': 'value', '--bool': null },
    }
    expect(ctx.extraArgs).toBeDefined()
  })

  it('ProviderCapabilities supports fallbackModel field', () => {
    const caps: ProviderCapabilities = {
      providerId: 'test',
      name: 'Test',
      languages: ['*'],
      taskTypes: ['general'],
      maxContextTokens: 100000,
      supportsStreaming: true,
      supportsCancellation: true,
      availableModels: ['model-a'],
      defaultModel: 'model-a',
      fallbackModel: 'model-b',
      contextInjectionMethod: 'system_prompt',
      supportsSessionResume: false,
    }
    expect(caps.fallbackModel).toBe('model-b')
  })
})
