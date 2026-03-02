/**
 * Tests for PR summary fallback chain and helper functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseInStreamExecutiveSummary,
  generateGitDiffSummary,
  formatStructuredSummary,
  runPrSummaryFallbackChain,
} from '../packages/core/src/dispatch/summary-utils.js'
import type { TaskResult } from '../packages/core/src/dispatch/types.js'

describe('parseInStreamExecutiveSummary', () => {
  it('should parse a well-formatted executive summary', () => {
    const output = `
Some execution output here...

## Executive Summary
**Status:** success
**What was done:** Implemented the new feature with comprehensive tests.
- Added new component
- Updated API endpoint
- Fixed existing bugs
**Follow-ups:**
- Add more edge case tests
- Update documentation
`
    const result = parseInStreamExecutiveSummary(output)

    expect(result).not.toBeNull()
    expect(result).toContain('## Summary')
    expect(result).toContain('Implemented the new feature')
    expect(result).toContain('## Changes')
    expect(result).toContain('Added new component')
    expect(result).toContain('## Follow-ups')
    expect(result).toContain('Add more edge case tests')
  })

  it('should include status badge for non-success status', () => {
    const output = `
## Executive Summary
**Status:** partial
**What was done:** Partially completed the task.
- Made some changes
`
    const result = parseInStreamExecutiveSummary(output)

    expect(result).not.toBeNull()
    expect(result).toContain('> **Status:** partial')
  })

  it('should not include status badge for success', () => {
    const output = `
## Executive Summary
**Status:** success
**What was done:** Completed the task successfully.
- Made changes
`
    const result = parseInStreamExecutiveSummary(output)

    expect(result).not.toBeNull()
    expect(result).not.toContain('> **Status:**')
  })

  it('should return null for missing executive summary', () => {
    const output = 'Just some regular output without a summary section.'
    const result = parseInStreamExecutiveSummary(output)

    expect(result).toBeNull()
  })

  it('should return null for empty output', () => {
    expect(parseInStreamExecutiveSummary('')).toBeNull()
    expect(parseInStreamExecutiveSummary(null as unknown as string)).toBeNull()
  })

  it('should handle executive summary at end of output', () => {
    const output = `
Task execution log...

## Executive Summary
**Status:** success
**What was done:** Done.
- Change 1`
    const result = parseInStreamExecutiveSummary(output)

    expect(result).not.toBeNull()
    expect(result).toContain('Done.')
    expect(result).toContain('Change 1')
  })

  it('should stop at next heading', () => {
    const output = `
## Executive Summary
**Status:** success
**What was done:** Done.
- Change 1

## Another Section
This should not be included.
`
    const result = parseInStreamExecutiveSummary(output)

    expect(result).not.toBeNull()
    expect(result).toContain('Done.')
    expect(result).not.toContain('Another Section')
    expect(result).not.toContain('should not be included')
  })
})

describe('generateGitDiffSummary', () => {
  it('should parse git diff output', () => {
    const gitDiff = `
diff --git a/src/file1.ts b/src/file1.ts
index abc123..def456 100644
--- a/src/file1.ts
+++ b/src/file1.ts
@@ -1,3 +1,5 @@
+// New comment
 export function foo() {}
diff --git a/src/file2.ts b/src/file2.ts
index 111111..222222 100644
--- a/src/file2.ts
+++ b/src/file2.ts
@@ -1 +1,2 @@
+// Another change
 export const bar = 1;
`
    const result = generateGitDiffSummary(gitDiff)

    expect(result).not.toBeNull()
    expect(result).toContain('## Summary')
    expect(result).toContain('Changes made to 2 files')
    expect(result).toContain('## Files Changed')
    expect(result).toContain('`src/file1.ts`')
    expect(result).toContain('`src/file2.ts`')
  })

  it('should handle singular file correctly', () => {
    const gitDiff = `
diff --git a/src/file.ts b/src/file.ts
index abc123..def456 100644
`
    const result = generateGitDiffSummary(gitDiff)

    expect(result).toContain('Changes made to 1 file.')
  })

  it('should parse commit log in standard format', () => {
    const gitCommitLog = `
commit abc1234567890abcdef
Author: Test User <test@example.com>
Date:   Mon Jan 1 00:00:00 2024 +0000

    Add new feature

commit def1234567890abcdef
Author: Test User <test@example.com>
Date:   Mon Jan 1 00:00:00 2024 +0000

    Fix bug
`
    const result = generateGitDiffSummary(undefined, gitCommitLog)

    expect(result).not.toBeNull()
    expect(result).toContain('## Commits')
    expect(result).toContain('Add new feature')
    expect(result).toContain('Fix bug')
  })

  it('should parse commit log in one-line format', () => {
    const gitCommitLog = `
abc1234 Add new feature
def5678 Fix bug
`
    const result = generateGitDiffSummary(undefined, gitCommitLog)

    expect(result).not.toBeNull()
    expect(result).toContain('## Commits')
    expect(result).toContain('Add new feature')
    expect(result).toContain('Fix bug')
  })

  it('should return null for empty inputs', () => {
    expect(generateGitDiffSummary()).toBeNull()
    expect(generateGitDiffSummary(undefined, undefined)).toBeNull()
    expect(generateGitDiffSummary('', '')).toBeNull()
  })

  it('should filter out merge commits', () => {
    // Git hashes use only hex characters (0-9, a-f)
    const gitCommitLog = `
abc1234 Merge branch main
def5678 Add feature
aaa0012 Merge pull request #1
bbb3456 Fix bug
`
    const result = generateGitDiffSummary(undefined, gitCommitLog)

    expect(result).toContain('Add feature')
    expect(result).toContain('Fix bug')
    expect(result).not.toContain('Merge branch')
    expect(result).not.toContain('Merge pull request')
  })
})

describe('formatStructuredSummary', () => {
  it('should format a complete summary', () => {
    const summary = {
      status: 'success' as const,
      workCompleted: 'Implemented the feature.',
      keyFindings: ['Added component', 'Updated API'],
      filesChanged: ['src/file1.ts', 'src/file2.ts'],
      followUps: ['Add tests'],
    }

    const result = formatStructuredSummary(summary)

    expect(result).toContain('## Summary')
    expect(result).toContain('Implemented the feature.')
    expect(result).toContain('## Changes')
    expect(result).toContain('Added component')
    expect(result).toContain('## Files Changed')
    expect(result).toContain('`src/file1.ts`')
    expect(result).toContain('## Follow-ups')
    expect(result).toContain('Add tests')
  })

  it('should show status badge for non-success status', () => {
    const summary = {
      status: 'failure' as const,
      workCompleted: 'Task failed.',
      keyFindings: [],
      filesChanged: [],
      followUps: [],
    }

    const result = formatStructuredSummary(summary)

    expect(result).toContain('> **Status:** failure')
  })

  it('should truncate many files', () => {
    const summary = {
      status: 'success' as const,
      workCompleted: 'Changed many files.',
      keyFindings: [],
      filesChanged: Array(25).fill(0).map((_, i) => `src/file${i}.ts`),
      followUps: [],
    }

    const result = formatStructuredSummary(summary)

    expect(result).toContain('`src/file0.ts`')
    expect(result).toContain('`src/file19.ts`')
    expect(result).toContain('... and 5 more files')
  })

  it('should handle minimal summary', () => {
    const summary = {
      status: 'success' as const,
      workCompleted: 'Done.',
      keyFindings: [],
      filesChanged: [],
      followUps: [],
    }

    const result = formatStructuredSummary(summary)

    expect(result).toContain('## Summary')
    expect(result).toContain('Done.')
    expect(result).not.toContain('## Changes')
    expect(result).not.toContain('## Files Changed')
    expect(result).not.toContain('## Follow-ups')
  })
})

describe('runPrSummaryFallbackChain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should use structured summary when available (Layer 1)', async () => {
    const input = {
      taskTitle: 'Test Task',
      taskDescription: 'A test task description.',
      taskResult: {
        taskId: 'test-1',
        status: 'success' as const,
        summary: {
          status: 'success' as const,
          workCompleted: 'Completed the implementation of the new feature.',
          keyFindings: ['Added component', 'Updated API'],
          filesChanged: ['src/file.ts'],
          followUps: ['Add tests'],
        },
      } as TaskResult,
      skipServerGeneration: true,
    }

    const result = await runPrSummaryFallbackChain(input)

    expect(result.source).toBe('structured')
    expect(result.summary).toContain('Completed the implementation')
  })

  it('should fall back to parsed summary when structured is empty (Layer 2)', async () => {
    const input = {
      taskTitle: 'Test Task',
      taskDescription: 'A test task description.',
      executionOutput: `
Some execution output...

## Executive Summary
**Status:** success
**What was done:** Parsed from in-stream executive summary.
- Made important changes
- Fixed critical bugs
`,
      skipServerGeneration: true,
    }

    const result = await runPrSummaryFallbackChain(input)

    expect(result.source).toBe('parsed')
    expect(result.summary).toContain('Parsed from in-stream')
  })

  it('should fall back to git diff summary (Layer 4)', async () => {
    const input = {
      taskTitle: 'Test Task',
      taskDescription: 'A test task description.',
      gitDiff: `
diff --git a/src/feature.ts b/src/feature.ts
index abc123..def456 100644
`,
      gitCommitLog: `
abc1234 Add new feature implementation
`,
      skipServerGeneration: true,
    }

    const result = await runPrSummaryFallbackChain(input)

    expect(result.source).toBe('git_diff')
    expect(result.summary).toContain('Changes made to 1 file')
    expect(result.summary).toContain('Add new feature implementation')
  })

  it('should fall back to task description (Layer 5)', async () => {
    const input = {
      taskTitle: 'Test Task',
      taskDescription: 'A test task description that will be used as fallback.',
      skipServerGeneration: true,
    }

    const result = await runPrSummaryFallbackChain(input)

    expect(result.source).toBe('task_description')
    expect(result.summary).toContain('## Summary')
    expect(result.summary).toContain('**Task:** Test Task')
    expect(result.summary).toContain('test task description that will be used as fallback')
  })

  it('should prefer structured over parsed', async () => {
    const input = {
      taskTitle: 'Test Task',
      taskDescription: 'A test task description.',
      taskResult: {
        taskId: 'test-1',
        status: 'success' as const,
        stdout: `
## Executive Summary
**Status:** success
**What was done:** This should be ignored.
- Ignored change
`,
        summary: {
          status: 'success' as const,
          workCompleted: 'This structured summary should be used instead.',
          keyFindings: ['Structured finding'],
          filesChanged: [],
          followUps: [],
        },
      } as TaskResult,
      skipServerGeneration: true,
    }

    const result = await runPrSummaryFallbackChain(input)

    expect(result.source).toBe('structured')
    expect(result.summary).toContain('structured summary should be used')
    expect(result.summary).not.toContain('should be ignored')
  })

  it('should skip empty/short summaries and continue fallback', async () => {
    const input = {
      taskTitle: 'Test Task',
      taskDescription: 'A test task description that is long enough to be used.',
      taskResult: {
        taskId: 'test-1',
        status: 'success' as const,
        summary: {
          status: 'success' as const,
          workCompleted: '', // Empty workCompleted
          keyFindings: [],
          filesChanged: [],
          followUps: [],
        },
      } as TaskResult,
      skipServerGeneration: true,
    }

    const result = await runPrSummaryFallbackChain(input)

    // Should skip structured and fall back to task_description
    expect(result.source).toBe('task_description')
  })

  it('should use stdout from taskResult when executionOutput is not provided', async () => {
    const input = {
      taskTitle: 'Test Task',
      taskDescription: 'A test task description.',
      taskResult: {
        taskId: 'test-1',
        status: 'success' as const,
        stdout: `
## Executive Summary
**Status:** success
**What was done:** Parsed from stdout.
- Made changes
`,
      } as TaskResult,
      skipServerGeneration: true,
    }

    const result = await runPrSummaryFallbackChain(input)

    expect(result.source).toBe('parsed')
    expect(result.summary).toContain('Parsed from stdout')
  })
})
