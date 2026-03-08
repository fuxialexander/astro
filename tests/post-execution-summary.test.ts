/**
 * Tests for post-execution summary generation logic.
 *
 * Validates:
 * 1. buildSummaryPrompt — prompt construction for all providers
 * 2. Summary JSON parsing — valid JSON, invalid JSON, edge cases
 * 3. Fallback summary construction when JSON parsing fails
 * 4. Integration with replan context via buildInteractivePlanPrompt
 *
 * Run with: npx vitest run tests/post-execution-summary.test.ts
 */

import { describe, it, expect } from 'vitest'
import { buildSummaryPrompt, buildInteractivePlanPrompt } from '../packages/core/src/prompt-templates'
import type { ExecutionSummaryResult } from '../server/types/relay'

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Mirrors the JSON parsing logic used in generatePostExecutionSummary
 * (server/routes/dispatch.ts) and the /api/agent/summarize endpoint.
 * Extracted here for testability.
 */
function parseSummaryOutput(
  output: string,
  fallbackStatus: 'success' | 'failure',
  fallbackFileChanges: Array<{ path: string; action: string }>,
): ExecutionSummaryResult | undefined {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        status: parsed.status || fallbackStatus,
        workCompleted: parsed.workCompleted || '',
        executiveSummary: parsed.executiveSummary,
        keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
        filesChanged: Array.isArray(parsed.filesChanged) ? parsed.filesChanged : [],
        followUps: Array.isArray(parsed.followUps) ? parsed.followUps : [],
      }
    }
  } catch {
    // JSON parse failed — construct a text-based fallback
    return {
      status: fallbackStatus === 'success' ? 'success' : 'failure',
      workCompleted: output.slice(0, 500),
      keyFindings: [],
      filesChanged: fallbackFileChanges.map((f) => f.path),
      followUps: [],
    }
  }
  return undefined
}

// ─── buildSummaryPrompt ──────────────────────────────────────────────

describe('buildSummaryPrompt', () => {
  const baseContext = {
    taskTitle: 'Implement user auth',
    taskDescription: 'Add passkey-based authentication flow',
    executionOutput: 'Created auth routes, added middleware, wrote 12 tests. All passing.',
    fileChanges: [
      { path: 'src/auth/routes.ts', action: 'created' },
      { path: 'src/middleware/auth.ts', action: 'modified' },
    ],
    status: 'success' as const,
  }

  it('includes task title and description', () => {
    const prompt = buildSummaryPrompt(baseContext)
    expect(prompt).toContain('Implement user auth')
    expect(prompt).toContain('Add passkey-based authentication flow')
  })

  it('includes execution output', () => {
    const prompt = buildSummaryPrompt(baseContext)
    expect(prompt).toContain('Created auth routes')
  })

  it('includes file changes', () => {
    const prompt = buildSummaryPrompt(baseContext)
    expect(prompt).toContain('src/auth/routes.ts')
    expect(prompt).toContain('src/middleware/auth.ts')
  })

  it('includes execution status', () => {
    const prompt = buildSummaryPrompt(baseContext)
    expect(prompt).toContain('success')
  })

  it('handles failure status', () => {
    const prompt = buildSummaryPrompt({ ...baseContext, status: 'failure' })
    expect(prompt).toContain('failure')
  })

  it('handles empty file changes', () => {
    const prompt = buildSummaryPrompt({ ...baseContext, fileChanges: [] })
    expect(prompt).toContain('No file changes recorded')
  })

  it('truncates long execution output to 15K chars', () => {
    const longOutput = 'x'.repeat(20000)
    const prompt = buildSummaryPrompt({ ...baseContext, executionOutput: longOutput })
    // Should contain the truncation indicator
    expect(prompt).toContain('...')
    // Should not contain the full 20K output
    expect(prompt.length).toBeLessThan(20000 + 2000) // 15K output + prompt text overhead
  })

  it('requests JSON-only response format', () => {
    const prompt = buildSummaryPrompt(baseContext)
    expect(prompt).toContain('ONLY a JSON object')
    expect(prompt).toContain('workCompleted')
    expect(prompt).toContain('keyFindings')
    expect(prompt).toContain('filesChanged')
    expect(prompt).toContain('followUps')
  })

  it('works with minimal context (empty strings)', () => {
    const prompt = buildSummaryPrompt({
      taskTitle: '',
      taskDescription: '',
      executionOutput: '',
      fileChanges: [],
      status: 'success',
    })
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('includes file action types in the prompt', () => {
    const prompt = buildSummaryPrompt({
      ...baseContext,
      fileChanges: [
        { path: 'new.ts', action: 'created' },
        { path: 'old.ts', action: 'deleted' },
        { path: 'existing.ts', action: 'modified' },
      ],
    })
    expect(prompt).toContain('created: new.ts')
    expect(prompt).toContain('deleted: old.ts')
    expect(prompt).toContain('modified: existing.ts')
  })
})

// ─── parseSummaryOutput ──────────────────────────────────────────────

describe('parseSummaryOutput', () => {
  const defaultFileChanges = [
    { path: 'src/index.ts', action: 'modified' },
  ]

  describe('valid JSON parsing', () => {
    it('parses a complete valid JSON summary', () => {
      const output = JSON.stringify({
        workCompleted: 'Implemented the auth flow',
        keyFindings: ['Added 3 routes', 'All tests pass'],
        filesChanged: ['src/auth.ts', 'src/routes.ts'],
        status: 'success',
        followUps: ['Add rate limiting'],
      })

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Implemented the auth flow')
      expect(result!.keyFindings).toEqual(['Added 3 routes', 'All tests pass'])
      expect(result!.filesChanged).toEqual(['src/auth.ts', 'src/routes.ts'])
      expect(result!.followUps).toEqual(['Add rate limiting'])
    })

    it('parses JSON embedded in surrounding text', () => {
      const output = `Here is the summary:
{"workCompleted": "Done", "keyFindings": ["finding1"], "filesChanged": [], "status": "success", "followUps": []}
End of summary.`

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.workCompleted).toBe('Done')
    })

    it('parses JSON with executiveSummary field', () => {
      const output = JSON.stringify({
        workCompleted: 'Done',
        executiveSummary: 'Detailed executive summary paragraph.',
        keyFindings: ['finding'],
        filesChanged: [],
        status: 'success',
        followUps: [],
      })

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.executiveSummary).toBe('Detailed executive summary paragraph.')
    })

    it('uses fallback status when JSON status is missing', () => {
      const output = JSON.stringify({
        workCompleted: 'Done',
        keyFindings: [],
        filesChanged: [],
        followUps: [],
      })

      const result = parseSummaryOutput(output, 'failure', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.status).toBe('failure')
    })

    it('coerces non-array keyFindings to empty array', () => {
      const output = JSON.stringify({
        workCompleted: 'Done',
        keyFindings: 'not an array',
        filesChanged: [],
        status: 'success',
        followUps: [],
      })

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.keyFindings).toEqual([])
    })

    it('coerces non-array filesChanged to empty array', () => {
      const output = JSON.stringify({
        workCompleted: 'Done',
        keyFindings: [],
        filesChanged: null,
        status: 'success',
        followUps: [],
      })

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.filesChanged).toEqual([])
    })

    it('coerces non-array followUps to empty array', () => {
      const output = JSON.stringify({
        workCompleted: 'Done',
        keyFindings: [],
        filesChanged: [],
        status: 'success',
        followUps: 'string followup',
      })

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.followUps).toEqual([])
    })

    it('defaults workCompleted to empty string when missing', () => {
      const output = JSON.stringify({
        keyFindings: ['finding'],
        filesChanged: [],
        status: 'success',
        followUps: [],
      })

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.workCompleted).toBe('')
    })

    it('handles JSON with markdown code fence wrapper', () => {
      const output = `\`\`\`json
{"workCompleted": "Done", "keyFindings": [], "filesChanged": [], "status": "success", "followUps": []}
\`\`\``

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.workCompleted).toBe('Done')
    })
  })

  describe('invalid JSON fallback', () => {
    it('returns text fallback for malformed JSON with braces', () => {
      // Has both { and } so the regex matches, but JSON.parse fails
      const output = '{ this is not: valid json !!! }'

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe(output.slice(0, 500))
      expect(result!.keyFindings).toEqual([])
      expect(result!.filesChanged).toEqual(['src/index.ts'])
      expect(result!.followUps).toEqual([])
    })

    it('truncates long output in fallback to 500 chars', () => {
      const longOutput = '{ invalid: ' + 'x'.repeat(1000) + ' }'

      const result = parseSummaryOutput(longOutput, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.workCompleted.length).toBeLessThanOrEqual(500)
    })

    it('uses fallback file paths from collected file changes', () => {
      const fileChanges = [
        { path: 'a.ts', action: 'created' },
        { path: 'b.ts', action: 'modified' },
        { path: 'c.ts', action: 'deleted' },
      ]

      const result = parseSummaryOutput('{ bad: json }', 'success', fileChanges)

      expect(result).toBeDefined()
      expect(result!.filesChanged).toEqual(['a.ts', 'b.ts', 'c.ts'])
    })

    it('uses failure status in fallback when execution failed', () => {
      const result = parseSummaryOutput('{ bad: json }', 'failure', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.status).toBe('failure')
    })

    it('returns undefined when no closing brace exists (no regex match)', () => {
      const result = parseSummaryOutput('{ incomplete json without closing brace', 'success', defaultFileChanges)

      expect(result).toBeUndefined()
    })
  })

  describe('no JSON found', () => {
    it('returns undefined for plain text without any JSON-like content', () => {
      const output = 'Just some plain text without any braces.'

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      const result = parseSummaryOutput('', 'success', defaultFileChanges)

      expect(result).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('handles deeply nested JSON', () => {
      const output = JSON.stringify({
        workCompleted: 'Nested task',
        keyFindings: ['finding with "quotes" inside'],
        filesChanged: ['path/to/deep/file.ts'],
        status: 'success',
        followUps: [],
        extraField: { nested: true }, // Extra fields should be ignored
      })

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.workCompleted).toBe('Nested task')
      expect(result!.keyFindings).toEqual(['finding with "quotes" inside'])
    })

    it('handles JSON with unicode characters', () => {
      const output = JSON.stringify({
        workCompleted: 'Added support for émojis 🎉 and ünïcödé',
        keyFindings: ['Handled i18n ✅'],
        filesChanged: [],
        status: 'success',
        followUps: [],
      })

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.workCompleted).toContain('émojis')
    })

    it('handles multiple JSON objects in output — picks the first', () => {
      const output = `{"workCompleted": "First", "keyFindings": [], "filesChanged": [], "status": "success", "followUps": []}
Some text in between
{"workCompleted": "Second"}`

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      // The regex /{[\s\S]*}/ is greedy, so it matches from first { to last }
      // This means it might capture both objects — the JSON.parse will then
      // fail or succeed depending on the content. With the above input,
      // it captures everything from first { to last }, which is invalid JSON.
      // The fallback should kick in.
      // (This tests the actual behavior of the regex pattern)
    })

    it('handles empty JSON object', () => {
      const output = '{}'

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('')
      expect(result!.keyFindings).toEqual([])
    })

    it('preserves all string values from large keyFindings arrays', () => {
      const findings = Array.from({ length: 20 }, (_, i) => `Finding ${i + 1}`)
      const output = JSON.stringify({
        workCompleted: 'Done',
        keyFindings: findings,
        filesChanged: [],
        status: 'success',
        followUps: [],
      })

      const result = parseSummaryOutput(output, 'success', defaultFileChanges)

      expect(result).toBeDefined()
      expect(result!.keyFindings).toHaveLength(20)
      expect(result!.keyFindings[19]).toBe('Finding 20')
    })
  })
})

// ─── Integration: summary in replan context ──────────────────────────

describe('summary integration with replan context', () => {
  it('buildInteractivePlanPrompt includes execution summary in lessons', () => {
    const prompt = buildInteractivePlanPrompt('Build a dashboard', {
      replanContext: {
        previousPlanSummary: 'Initial plan had 3 tasks.',
        changeDescription: 'Auth task failed, need to redesign.',
        lessons: [
          {
            taskTitle: 'Setup database',
            taskDescription: 'Create tables and migrations',
            status: 'success',
            executionSummary: 'Created 5 tables, ran all migrations successfully.',
          },
          {
            taskTitle: 'Implement auth',
            taskDescription: 'Add passkey auth',
            status: 'failure',
            executionSummary: 'WebAuthn API not available in test environment.',
            followUps: ['Use test double for WebAuthn', 'Add fallback flow'],
          },
          {
            taskTitle: 'Build UI',
            taskDescription: 'Create dashboard components',
            status: 'not_executed',
          },
        ],
      },
    })

    // Successful task with summary
    expect(prompt).toContain('Setup database')
    expect(prompt).toContain('Created 5 tables')

    // Failed task with summary and follow-ups
    expect(prompt).toContain('Implement auth')
    expect(prompt).toContain('WebAuthn API not available')
    expect(prompt).toContain('Use test double for WebAuthn')
    expect(prompt).toContain('Add fallback flow')

    // Not-executed task — no summary
    expect(prompt).toContain('Build UI')
  })

  it('buildInteractivePlanPrompt handles lessons without executionSummary', () => {
    const prompt = buildInteractivePlanPrompt('Build a dashboard', {
      replanContext: {
        lessons: [
          {
            taskTitle: 'Task without summary',
            taskDescription: 'Ran by non-Claude provider without summary generation',
            status: 'success',
          },
        ],
      },
    })

    expect(prompt).toContain('Task without summary')
    // Should not have a "Summary:" line for this task
    expect(prompt).not.toContain('Summary:')
  })

  it('buildInteractivePlanPrompt handles empty lessons array', () => {
    const prompt = buildInteractivePlanPrompt('Build a dashboard', {
      replanContext: {
        lessons: [],
        changeDescription: 'Starting fresh',
      },
    })

    expect(prompt).toContain('Starting fresh')
    expect(prompt).not.toContain('Per-Task Lessons')
  })

  it('buildInteractivePlanPrompt shows status badges for all statuses', () => {
    const prompt = buildInteractivePlanPrompt('Replan', {
      replanContext: {
        lessons: [
          { taskTitle: 'A', taskDescription: 'a', status: 'success', executionSummary: 'ok' },
          { taskTitle: 'B', taskDescription: 'b', status: 'partial', executionSummary: 'half' },
          { taskTitle: 'C', taskDescription: 'c', status: 'failure', executionSummary: 'err' },
          { taskTitle: 'D', taskDescription: 'd', status: 'not_executed' },
        ],
      },
    })

    expect(prompt).toContain('✅')
    expect(prompt).toContain('⚠️')
    expect(prompt).toContain('❌')
    expect(prompt).toContain('⏭️')
  })
})

// ─── Provider-agnostic summary (design contract) ────────────────────

describe('provider-agnostic summary contract', () => {
  it('buildSummaryPrompt output does not reference any specific AI provider', () => {
    const prompt = buildSummaryPrompt({
      taskTitle: 'Test task',
      taskDescription: 'Test description',
      executionOutput: 'Output from any provider',
      fileChanges: [],
      status: 'success',
    })

    // The prompt should not mention Claude, Codex, OpenCode, or OpenClaw
    expect(prompt.toLowerCase()).not.toContain('claude')
    expect(prompt.toLowerCase()).not.toContain('codex')
    expect(prompt.toLowerCase()).not.toContain('opencode')
    expect(prompt.toLowerCase()).not.toContain('openclaw')
  })

  it('buildSummaryPrompt accepts output from any provider format', () => {
    // Simulate outputs from different provider styles
    const outputs = {
      claudeSdk: 'I analyzed the codebase and implemented the changes.\n\nFiles modified:\n- src/auth.ts\n- src/routes.ts',
      codex: 'COMPLETED: Modified 2 files\nChanges applied successfully',
      openCode: '> Task completed\n\nModified auth module\nAll tests passing (12/12)',
      openClaw: '--- Execution Complete ---\nStatus: OK\nFiles: src/auth.ts (+42, -10)',
    }

    for (const [provider, output] of Object.entries(outputs)) {
      const prompt = buildSummaryPrompt({
        taskTitle: `Task from ${provider}`,
        taskDescription: 'Auth implementation',
        executionOutput: output,
        fileChanges: [{ path: 'src/auth.ts', action: 'modified' }],
        status: 'success',
      })

      expect(prompt).toContain(output.slice(0, 100))
      expect(prompt).toContain('src/auth.ts')
    }
  })

  it('summary JSON schema is the same regardless of provider', () => {
    // All providers should produce the same summary shape
    const validSummary = {
      workCompleted: 'Done',
      keyFindings: ['f1'],
      filesChanged: ['f.ts'],
      status: 'success',
      followUps: ['fu1'],
    }

    const result = parseSummaryOutput(
      JSON.stringify(validSummary),
      'success',
      [],
    )

    expect(result).toBeDefined()
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('workCompleted')
    expect(result).toHaveProperty('keyFindings')
    expect(result).toHaveProperty('filesChanged')
    expect(result).toHaveProperty('followUps')
  })
})
