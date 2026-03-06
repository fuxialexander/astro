/**
 * Tests for runPrSummaryFallbackChain function.
 *
 * This test suite covers the 4-layer fallback chain for generating PR body summaries:
 * 1. Structured summary from TaskResult.summary.executiveSummary
 * 2. Parsed in-stream executive summary from output text
 * 3. Git diff + commit log summary
 * 4. Task description fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runPrSummaryFallbackChain } from '../summary-utils.js'
import type { TaskResult } from '../types.js'

describe('runPrSummaryFallbackChain', () => {
  const baseTaskResult: TaskResult = {
    taskId: 'task-123',
    status: 'success',
  }

  const baseInput = {
    taskResult: baseTaskResult,
    taskTitle: 'Test Task',
    taskDescription: 'This is a test task description',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Layer 1: Structured summary from TaskResult.summary.executiveSummary', () => {
    it('returns structured source when executiveSummary is present', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Work completed description',
            executiveSummary: 'This is the executive summary from structured output',
            keyFindings: ['Finding 1', 'Finding 2'],
            filesChanged: ['src/index.ts'],
            followUps: ['Follow up task'],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toBe('This is the executive summary from structured output')
    })

    it('builds structured summary from workCompleted and keyFindings when executiveSummary is missing', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Implemented feature X',
            keyFindings: ['Added new component', 'Updated tests'],
            filesChanged: ['src/index.ts'],
            followUps: ['Consider adding more tests'],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('Implemented feature X')
      expect(result.summary).toContain('**Key changes:**')
      expect(result.summary).toContain('- Added new component')
      expect(result.summary).toContain('**Follow-ups:**')
      expect(result.summary).toContain('- Consider adding more tests')
    })

    it('includes status when not success', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'partial',
            workCompleted: 'Partial work done',
            keyFindings: [],
            filesChanged: [],
            followUps: [],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('**Status:** partial')
    })

    it('skips empty executiveSummary', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Work done',
            executiveSummary: '   ', // Empty/whitespace only
            keyFindings: [],
            filesChanged: [],
            followUps: [],
          },
        },
      })

      // Should fall through to workCompleted since executiveSummary is empty
      expect(result.source).toBe('structured')
      expect(result.summary).toContain('Work done')
    })
  })

  describe('Layer 2: Parsed in-stream executive summary', () => {
    it('parses executive summary from output text', async () => {
      const executionOutput = `
Some agent output here...

## Executive Summary
**Status:** success
**What was done:** Implemented the authentication feature.
- Added login endpoint
- Created user model
**Follow-ups:**
- Add password reset
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
      })

      expect(result.source).toBe('parsed')
      expect(result.summary).toContain('Implemented the authentication feature')
      expect(result.summary).toContain('- Added login endpoint')
      expect(result.summary).toContain('- Add password reset')
    })

    it('handles partial status in parsed output', async () => {
      const executionOutput = `
## Executive Summary
**Status:** partial
**What was done:** Partially completed the task.
- Did something
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
      })

      expect(result.source).toBe('parsed')
      expect(result.summary).toContain('**Status:** partial')
    })

    it('falls through when executive summary cannot be parsed', async () => {
      const executionOutput = 'Some output without executive summary format'

      // No API key, so server generation will fail
      // No worktree path, so git diff will fail
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
      })

      // Should fall through to task_description
      expect(result.source).toBe('task_description')
    })
  })

  describe('Layer 3: Git diff summary', () => {
    it('uses git diff summary when provided function returns valid output', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue(`## Changes

\`\`\`
 src/index.ts | 10 +++++-----
 1 file changed, 5 insertions(+), 5 deletions(-)
\`\`\`

## Commits

\`\`\`
abc1234 Fix bug in authentication
\`\`\``)

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        worktreePath: '/path/to/worktree',
        generateGitDiffSummary: mockGitDiffFn,
      })

      expect(result.source).toBe('git_diff')
      expect(result.summary).toContain('## Changes')
      expect(result.summary).toContain('abc1234 Fix bug in authentication')
      expect(mockGitDiffFn).toHaveBeenCalledWith('/path/to/worktree')
    })

    it('falls through when git diff function returns null', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue(null)

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        worktreePath: '/path/to/worktree',
        generateGitDiffSummary: mockGitDiffFn,
      })

      expect(result.source).toBe('task_description')
      expect(mockGitDiffFn).toHaveBeenCalledWith('/path/to/worktree')
    })

    it('skips git diff when worktreePath is not provided', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue('## Changes')

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        generateGitDiffSummary: mockGitDiffFn,
        // No worktreePath
      })

      expect(result.source).toBe('task_description')
      expect(mockGitDiffFn).not.toHaveBeenCalled()
    })

    it('skips git diff when function is not provided', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        worktreePath: '/path/to/worktree',
        // No generateGitDiffSummary function
      })

      expect(result.source).toBe('task_description')
    })
  })

  describe('Layer 4: Task description fallback', () => {
    it('falls back to task description when all other layers fail', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        // No summary in taskResult
        // No executionOutput
        // No worktreePath or gitDiffFn
      })

      expect(result.source).toBe('task_description')
      expect(result.summary).toBe('**Test Task**\n\nThis is a test task description')
    })

    it('includes task title in bold', async () => {
      const result = await runPrSummaryFallbackChain({
        taskResult: baseTaskResult,
        taskTitle: 'My Custom Task Title',
        taskDescription: 'A detailed description',
      })

      expect(result.source).toBe('task_description')
      expect(result.summary).toContain('**My Custom Task Title**')
      expect(result.summary).toContain('A detailed description')
    })
  })

  describe('Fallback chain priority', () => {
    it('prefers structured over parsed', async () => {
      const executionOutput = `
## Executive Summary
**Status:** success
**What was done:** Parsed summary.
- Parsed finding
`

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: 'Structured summary',
            keyFindings: ['Structured finding'],
            filesChanged: [],
            followUps: [],
          },
        },
        executionOutput,
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('Structured summary')
    })

    it('prefers parsed over git_diff', async () => {
      const executionOutput = `
## Executive Summary
**Status:** success
**What was done:** Parsed summary.
- Parsed finding
`
      const mockGitDiffFn = vi.fn().mockReturnValue('## Changes\ngit diff output')

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        executionOutput,
        worktreePath: '/path/to/worktree',
        generateGitDiffSummary: mockGitDiffFn,
      })

      expect(result.source).toBe('parsed')
      expect(result.summary).toContain('Parsed summary')
      expect(mockGitDiffFn).not.toHaveBeenCalled()
    })

    it('prefers git_diff over task_description', async () => {
      const mockGitDiffFn = vi.fn().mockReturnValue('## Changes\ngit diff output')

      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        // No structured summary
        // No parseable executive summary in output
        executionOutput: 'Some output without executive summary',
        worktreePath: '/path/to/worktree',
        generateGitDiffSummary: mockGitDiffFn,
      })

      expect(result.source).toBe('git_diff')
      expect(result.summary).toContain('git diff output')
    })
  })

  describe('Edge cases', () => {
    it('handles empty strings in structured summary fields', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          summary: {
            status: 'success',
            workCompleted: '', // Empty workCompleted should fall through
            keyFindings: [],
            filesChanged: [],
            followUps: [],
          },
        },
      })

      // Empty workCompleted should fall through to next layer
      expect(result.source).toBe('task_description')
    })

    it('handles failure status in task result', async () => {
      const result = await runPrSummaryFallbackChain({
        ...baseInput,
        taskResult: {
          ...baseTaskResult,
          status: 'failure',
          summary: {
            status: 'failure',
            workCompleted: 'Task failed due to test errors',
            keyFindings: ['Tests failed'],
            filesChanged: [],
            followUps: ['Fix tests'],
          },
        },
      })

      expect(result.source).toBe('structured')
      expect(result.summary).toContain('**Status:** failure')
    })
  })
})
