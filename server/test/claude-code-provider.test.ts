/**
 * Claude Code Provider Tests
 *
 * Unit tests for the new features added to ClaudeCodeProvider:
 * - loadDotEnv() helper
 * - buildAppendContent() from cache-utils
 * - SessionLogger (JSONL + Markdown)
 * - Provider capabilities (fallbackModel)
 * - Provider config (hooks, extraArgs)
 *
 * Run with: npx tsx server/test/claude-code-provider.test.ts
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadDotEnv, ClaudeCodeProvider } from '../lib/providers/adapters/claude-code.js'
import { buildAppendContent, calculateCacheStats, addToolCaching } from '../lib/providers/cache-utils.js'
import { SessionLogger } from '../lib/providers/session-logger.js'
import type { TaskResult } from '../lib/providers/types.js'

// ============================================================================
// Test Utilities
// ============================================================================

let testsPassed = 0
let testsFailed = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`)
    testsPassed++
  } else {
    console.log(`  ❌ ${message}`)
    testsFailed++
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (pass) {
    console.log(`  ✅ ${message}`)
    testsPassed++
  } else {
    console.log(`  ❌ ${message}`)
    console.log(`     Expected: ${JSON.stringify(expected)}`)
    console.log(`     Actual:   ${JSON.stringify(actual)}`)
    testsFailed++
  }
}

function assertContains(text: string, substring: string, message: string): void {
  const pass = text.includes(substring)
  if (pass) {
    console.log(`  ✅ ${message}`)
    testsPassed++
  } else {
    console.log(`  ❌ ${message}`)
    console.log(`     Text does not contain: "${substring}"`)
    testsFailed++
  }
}

function describe(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  console.log(`\n📦 ${name}`)
  return fn()
}

function it(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  console.log(`\n  🧪 ${name}`)
  try {
    const result = fn()
    if (result instanceof Promise) {
      return result.catch((error) => {
        console.log(`  ❌ ${name} - threw error`)
        console.log(`     ${error}`)
        testsFailed++
      })
    }
  } catch (error) {
    console.log(`  ❌ ${name} - threw error`)
    console.log(`     ${error}`)
    testsFailed++
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

function createTempDir(suffix: string): string {
  const dir = join(tmpdir(), `astro-test-${suffix}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup
  }
}

// ============================================================================
// Tests: loadDotEnv
// ============================================================================

describe('loadDotEnv', () => {
  it('returns empty object for undefined dir', () => {
    const result = loadDotEnv(undefined)
    assertEqual(result, {}, 'undefined dir returns {}')
  })

  it('returns empty object for non-existent dir', () => {
    const result = loadDotEnv('/tmp/does-not-exist-' + Date.now())
    assertEqual(result, {}, 'non-existent dir returns {}')
  })

  it('parses simple KEY=VALUE pairs', () => {
    const dir = createTempDir('dotenv-simple')
    writeFileSync(join(dir, '.env'), 'FOO=bar\nBAZ=qux\n')

    const result = loadDotEnv(dir)
    assertEqual(result.FOO, 'bar', 'FOO=bar parsed')
    assertEqual(result.BAZ, 'qux', 'BAZ=qux parsed')

    cleanupDir(dir)
  })

  it('strips double-quoted values', () => {
    const dir = createTempDir('dotenv-quotes')
    writeFileSync(join(dir, '.env'), 'DB_URL="postgres://localhost/db"\n')

    const result = loadDotEnv(dir)
    assertEqual(result.DB_URL, 'postgres://localhost/db', 'double quotes stripped')

    cleanupDir(dir)
  })

  it('strips single-quoted values', () => {
    const dir = createTempDir('dotenv-single-quotes')
    writeFileSync(join(dir, '.env'), "SECRET='my-secret'\n")

    const result = loadDotEnv(dir)
    assertEqual(result.SECRET, 'my-secret', 'single quotes stripped')

    cleanupDir(dir)
  })

  it('skips comments and blank lines', () => {
    const dir = createTempDir('dotenv-comments')
    writeFileSync(join(dir, '.env'), [
      '# This is a comment',
      '',
      'KEY1=value1',
      '  # Another comment',
      '  ',
      'KEY2=value2',
    ].join('\n'))

    const result = loadDotEnv(dir)
    assertEqual(Object.keys(result).length, 2, 'only 2 keys parsed')
    assertEqual(result.KEY1, 'value1', 'KEY1 parsed')
    assertEqual(result.KEY2, 'value2', 'KEY2 parsed')

    cleanupDir(dir)
  })

  it('handles inline comments for unquoted values', () => {
    const dir = createTempDir('dotenv-inline')
    writeFileSync(join(dir, '.env'), 'PORT=3000 # server port\n')

    const result = loadDotEnv(dir)
    assertEqual(result.PORT, '3000', 'inline comment stripped')

    cleanupDir(dir)
  })

  it('preserves hash in double-quoted values', () => {
    const dir = createTempDir('dotenv-hash')
    writeFileSync(join(dir, '.env'), 'COLOR="#ff0000"\n')

    const result = loadDotEnv(dir)
    assertEqual(result.COLOR, '#ff0000', 'hash preserved in quoted value')

    cleanupDir(dir)
  })

  it('handles empty values', () => {
    const dir = createTempDir('dotenv-empty')
    writeFileSync(join(dir, '.env'), 'EMPTY=\nALSO_EMPTY=""\n')

    const result = loadDotEnv(dir)
    assertEqual(result.EMPTY, '', 'empty unquoted value')
    assertEqual(result.ALSO_EMPTY, '', 'empty quoted value')

    cleanupDir(dir)
  })

  it('handles values with = signs', () => {
    const dir = createTempDir('dotenv-equals')
    writeFileSync(join(dir, '.env'), 'URL=https://example.com?a=1&b=2\n')

    const result = loadDotEnv(dir)
    assertEqual(result.URL, 'https://example.com?a=1&b=2', 'value with = signs preserved')

    cleanupDir(dir)
  })

  it('skips lines without = sign', () => {
    const dir = createTempDir('dotenv-noequals')
    writeFileSync(join(dir, '.env'), 'GOOD=value\nBADLINE\nALSO_GOOD=works\n')

    const result = loadDotEnv(dir)
    assertEqual(Object.keys(result).length, 2, 'only valid lines parsed')
    assert(!('BADLINE' in result), 'invalid line skipped')

    cleanupDir(dir)
  })
})

// ============================================================================
// Tests: buildAppendContent
// ============================================================================

describe('buildAppendContent', () => {
  it('returns undefined when no options provided', () => {
    const result = buildAppendContent({})
    assertEqual(result, undefined, 'empty options returns undefined')
  })

  it('returns undefined when all options are undefined', () => {
    const result = buildAppendContent({
      baseInstructions: undefined,
      visionDoc: undefined,
      dependencyContext: undefined,
      workingDirectory: undefined,
    })
    assertEqual(result, undefined, 'all-undefined options returns undefined')
  })

  it('includes base instructions', () => {
    const result = buildAppendContent({ baseInstructions: 'You are a helpful assistant.' })
    assert(result !== undefined, 'result is defined')
    assertContains(result!, 'You are a helpful assistant.', 'base instructions included')
  })

  it('includes vision doc with header', () => {
    const result = buildAppendContent({ visionDoc: 'Build an AI platform.' })
    assert(result !== undefined, 'result is defined')
    assertContains(result!, '## Project Vision', 'vision doc header present')
    assertContains(result!, 'Build an AI platform.', 'vision doc content present')
  })

  it('includes dependency context with header', () => {
    const result = buildAppendContent({ dependencyContext: 'Task A output: schema.sql created' })
    assert(result !== undefined, 'result is defined')
    assertContains(result!, '## Previous Task Outputs', 'dependency context header present')
    assertContains(result!, 'schema.sql created', 'dependency context content present')
  })

  it('includes working directory with header', () => {
    const result = buildAppendContent({ workingDirectory: '/home/user/project' })
    assert(result !== undefined, 'result is defined')
    assertContains(result!, '## Working Directory', 'working directory header present')
    assertContains(result!, '/home/user/project', 'working directory path present')
  })

  it('combines multiple sections with double newlines', () => {
    const result = buildAppendContent({
      visionDoc: 'Vision content',
      dependencyContext: 'Dep content',
      workingDirectory: '/tmp/work',
    })
    assert(result !== undefined, 'result is defined')
    // All 3 sections present
    assertContains(result!, '## Project Vision', 'vision section')
    assertContains(result!, '## Previous Task Outputs', 'dependency section')
    assertContains(result!, '## Working Directory', 'directory section')
    // Sections separated by double newlines
    assert(result!.includes('\n\n'), 'sections separated by double newlines')
  })
})

// ============================================================================
// Tests: calculateCacheStats
// ============================================================================

describe('calculateCacheStats', () => {
  it('handles empty usage', () => {
    const stats = calculateCacheStats({})
    assertEqual(stats.totalInputTokens, 0, 'total tokens is 0')
    assertEqual(stats.cacheHitRate, 0, 'hit rate is 0')
    assertEqual(stats.estimatedSavings, 0, 'savings is 0')
  })

  it('calculates cache hit rate correctly', () => {
    const stats = calculateCacheStats({
      input_tokens: 100,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 0,
    })
    assertEqual(stats.totalInputTokens, 1000, 'total is 1000')
    assertEqual(stats.cacheHitRate, 0.9, 'hit rate is 90%')
    assertEqual(stats.estimatedSavings, 81, 'savings is 81%')
  })

  it('handles all cache reads', () => {
    const stats = calculateCacheStats({
      input_tokens: 0,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 0,
    })
    assertEqual(stats.cacheHitRate, 1, 'hit rate is 100%')
    assertEqual(stats.estimatedSavings, 90, 'savings is 90%')
  })

  it('handles zero cache reads', () => {
    const stats = calculateCacheStats({
      input_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 500,
    })
    assertEqual(stats.cacheHitRate, 0, 'hit rate is 0%')
    assertEqual(stats.estimatedSavings, 0, 'savings is 0%')
  })
})

// ============================================================================
// Tests: addToolCaching
// ============================================================================

describe('addToolCaching', () => {
  it('returns empty array for empty input', () => {
    const result = addToolCaching([])
    assertEqual(result.length, 0, 'empty in, empty out')
  })

  it('adds cache_control to last tool', () => {
    const tools = [
      { name: 'Read', type: 'function' },
      { name: 'Write', type: 'function' },
    ]
    const cached = addToolCaching(tools)
    assertEqual(cached.length, 2, 'same number of tools')
    assert(!('cache_control' in cached[0]), 'first tool has no cache_control')
    assertEqual((cached[1] as Record<string, unknown>).cache_control, { type: 'ephemeral', ttl: '1h' }, 'last tool has 1h cache')
  })

  it('supports custom TTL', () => {
    const tools = [{ name: 'Tool1', type: 'function' }]
    const cached = addToolCaching(tools, '5m')
    assertEqual((cached[0] as Record<string, unknown>).cache_control, { type: 'ephemeral', ttl: '5m' }, '5m TTL applied')
  })

  it('does not mutate original array', () => {
    const tools = [{ name: 'Tool1', type: 'function' }]
    addToolCaching(tools)
    assert(!('cache_control' in tools[0]), 'original array not mutated')
  })
})

// ============================================================================
// Tests: SessionLogger
// ============================================================================

async function testSessionLogger(): Promise<void> {
  await describe('SessionLogger', async () => {
    const testTaskId = `test-session-${Date.now()}`

    await it('writes JSONL and Markdown files', async () => {
      const logger = new SessionLogger(testTaskId)

      // Log init event
      logger.log({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-5-20250929', session_id: 'sess-123' })

      // Log some tool uses
      logger.log({ type: 'tool_use', toolName: 'Read' })
      logger.log({ type: 'tool_use', toolName: 'Edit' })
      logger.log({ type: 'tool_use', toolName: 'Bash' })

      // Log text output
      logger.log({ type: 'text', text: 'Hello, ' })
      logger.log({ type: 'text', text: 'world!' })

      // Finalize with result
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

      // Check JSONL file exists and has content
      const { homedir } = await import('node:os')
      const sessionsDir = join(homedir(), '.astro', 'logs', 'sessions')
      const jsonlPath = join(sessionsDir, `${testTaskId}.jsonl`)
      const mdPath = join(sessionsDir, `${testTaskId}.md`)

      assert(existsSync(jsonlPath), 'JSONL file exists')
      assert(existsSync(mdPath), 'Markdown file exists')

      // Verify JSONL content
      const jsonlContent = readFileSync(jsonlPath, 'utf-8')
      const jsonlLines = jsonlContent.trim().split('\n')
      assertEqual(jsonlLines.length, 6, 'JSONL has 6 lines (init + 3 tools + 2 text)')

      // Parse first line to verify structure
      const firstEntry = JSON.parse(jsonlLines[0])
      assertEqual(firstEntry.type, 'system', 'first entry is system')
      assertEqual(firstEntry.subtype, 'init', 'first entry subtype is init')
      assertEqual(firstEntry.model, 'claude-sonnet-4-5-20250929', 'model recorded')
      assert('_ts' in firstEntry, 'timestamp added to entry')

      // Verify Markdown content
      const mdContent = readFileSync(mdPath, 'utf-8')
      assertContains(mdContent, `# Session: ${testTaskId}`, 'MD has session title')
      assertContains(mdContent, '| Status | success |', 'MD has status')
      assertContains(mdContent, '| Duration | 5.0s |', 'MD has duration')
      assertContains(mdContent, '| Cost | $0.0042 |', 'MD has cost')
      assertContains(mdContent, '| Turns | 3 |', 'MD has turns')
      assertContains(mdContent, '| Model | claude-sonnet-4-5-20250929 |', 'MD has model')
      assertContains(mdContent, '| Session ID | `sess-123` |', 'MD has session ID')
      assertContains(mdContent, '## Tool Calls', 'MD has tool calls section')
      assertContains(mdContent, '- `Read`', 'MD lists Read tool')
      assertContains(mdContent, '- `Edit`', 'MD lists Edit tool')
      assertContains(mdContent, '- `Bash`', 'MD lists Bash tool')
      assertContains(mdContent, '## Output', 'MD has output section')
      assertContains(mdContent, 'Hello, world!', 'MD has accumulated output text')

      // Cleanup test files
      try {
        rmSync(jsonlPath)
        rmSync(mdPath)
      } catch {
        // Best effort
      }
    })

    await it('handles error results', async () => {
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

      const { homedir } = await import('node:os')
      const sessionsDir = join(homedir(), '.astro', 'logs', 'sessions')
      const mdPath = join(sessionsDir, `${errorTaskId}.md`)

      assert(existsSync(mdPath), 'error MD file exists')

      const mdContent = readFileSync(mdPath, 'utf-8')
      assertContains(mdContent, '| Status | error |', 'MD shows error status')
      assertContains(mdContent, '## Error', 'MD has error section')
      assertContains(mdContent, 'SDK connection failed', 'MD shows error message')
      assertContains(mdContent, '| Session ID | `N/A` |', 'session ID is N/A when not set')

      // Cleanup
      try {
        rmSync(join(sessionsDir, `${errorTaskId}.jsonl`))
        rmSync(mdPath)
      } catch {
        // Best effort
      }
    })
  })
}

// ============================================================================
// Tests: ClaudeCodeProvider capabilities & config
// ============================================================================

describe('ClaudeCodeProvider', () => {
  it('capabilities() includes fallbackModel', () => {
    const provider = new ClaudeCodeProvider()
    const caps = provider.capabilities()
    assertEqual(caps.fallbackModel, 'sonnet', 'fallbackModel is sonnet')
    assertEqual(caps.providerId, 'claude-code', 'providerId is claude-code')
    assertEqual(caps.supportsSessionResume, true, 'supports session resume')
    assertEqual(caps.supportsStreaming, true, 'supports streaming')
    assertEqual(caps.contextInjectionMethod, 'system_prompt', 'context via system_prompt')
  })

  it('capabilities() lists expected models', () => {
    const provider = new ClaudeCodeProvider()
    const caps = provider.capabilities()
    assert(caps.availableModels.includes('claude-sonnet-4-5-20250929'), 'includes sonnet')
    assert(caps.availableModels.includes('claude-opus-4-6'), 'includes opus 4.6')
    assert(caps.availableModels.length >= 3, 'at least 3 models available')
  })

  it('accepts config with hooks and extraArgs', () => {
    const provider = new ClaudeCodeProvider({
      hooks: { 'pre-tool': { command: 'echo hello' } },
      extraArgs: { '--verbose': null, '--timeout': '30000' },
    })
    const caps = provider.capabilities()
    // Config doesn't affect capabilities, but construction should succeed
    assertEqual(caps.providerId, 'claude-code', 'provider created with config')
  })

  it('prepareContext() uses buildAppendContent pattern', async () => {
    const provider = new ClaudeCodeProvider()
    const ctx = await provider.prepareContext({
      projectId: 'proj-1',
      visionDoc: 'Build something great',
      workingDirectory: '/tmp/test-project',
      dependencyContext: 'Previous task created schema.sql',
    })

    assertEqual(ctx.method, 'system_prompt', 'method is system_prompt')
    assert(ctx.promptContent !== undefined, 'promptContent is defined')
    assertContains(ctx.promptContent!, '## Project Vision', 'contains vision header')
    assertContains(ctx.promptContent!, 'Build something great', 'contains vision content')
    assertContains(ctx.promptContent!, '## Previous Task Outputs', 'contains dependency header')
    assertContains(ctx.promptContent!, '## Working Directory', 'contains working dir header')
    assertContains(ctx.promptContent!, '/tmp/test-project', 'contains working dir path')
  })

  it('prepareContext() returns undefined promptContent when no context', async () => {
    const provider = new ClaudeCodeProvider()
    const ctx = await provider.prepareContext({ projectId: 'proj-1' })

    assertEqual(ctx.method, 'system_prompt', 'method is system_prompt')
    assertEqual(ctx.promptContent, undefined, 'no content when empty context')
  })
})

// ============================================================================
// Tests: Type contract checks
// ============================================================================

describe('Type Contracts', () => {
  it('TaskContext supports approvalCallback field', () => {
    // This is a compile-time check — if this file compiles, the type is correct
    const ctx: import('../lib/providers/types.js').TaskContext = {
      projectId: 'proj-1',
      approvalCallback: async (executionId, question, options) => {
        return options[0]
      },
    }
    assert(typeof ctx.approvalCallback === 'function', 'approvalCallback is a function')
  })

  it('TaskContext supports hooks field', () => {
    const ctx: import('../lib/providers/types.js').TaskContext = {
      projectId: 'proj-1',
      hooks: { 'pre-tool': { command: 'echo' } },
    }
    assert(ctx.hooks !== undefined, 'hooks field accepted')
  })

  it('TaskContext supports extraArgs field', () => {
    const ctx: import('../lib/providers/types.js').TaskContext = {
      projectId: 'proj-1',
      extraArgs: { '--flag': 'value', '--bool': null },
    }
    assert(ctx.extraArgs !== undefined, 'extraArgs field accepted')
  })

  it('ProviderCapabilities supports fallbackModel field', () => {
    const caps: import('../lib/providers/types.js').ProviderCapabilities = {
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
    assertEqual(caps.fallbackModel, 'model-b', 'fallbackModel accepted in type')
  })
})

// ============================================================================
// Run all tests
// ============================================================================

async function main(): Promise<void> {
  console.log('🚀 Claude Code Provider Test Suite\n')
  console.log('=' .repeat(60))

  // Sync tests already ran via describe() calls above
  // Now run async tests
  await testSessionLogger()

  console.log('\n' + '='.repeat(60))
  console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed`)

  if (testsFailed > 0) {
    console.log('\n💥 Some tests failed!')
    process.exit(1)
  } else {
    console.log('\n🎉 All tests passed!')
  }
}

main().catch((err) => {
  console.error('Fatal error running tests:', err)
  process.exit(1)
})
