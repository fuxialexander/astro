/**
 * PR Summary Fallback Chain Tests
 *
 * Unit tests for runPrSummaryFallbackChain() covering the 5-layer fallback:
 * 1. Structured summary (result.summary) - source: 'structured'
 * 2. Parsed executive summary from stdout - source: 'parsed'
 * 3. Server-generated summary (Anthropic API) - source: 'server_generated'
 * 4. File changes summary - source: 'file_changes'
 * 5. Task description fallback - source: 'task_description'
 */

import { describe, it, expect, vi } from 'vitest'
import {
  runPrSummaryFallbackChain,
  parseExecutiveSummaryFromOutput,
  formatPrBody,
  type PrSummaryInput,
  type PrSummarySource,
} from '../server/lib/events/hooks/pr-summary-fallback.js'
import type { ExecutionSummary } from '../packages/core/src/types.js'

// ============================================================================
// Test Helpers
// ============================================================================

function makeNode(overrides: Partial<PrSummaryInput['node']> = {}): PrSummaryInput['node'] {
  return {
    title: 'Test Task',
    description: 'Test task description',
    ...overrides,
  }
}

function makeStructuredSummary(overrides: Partial<NonNullable<PrSummaryInput['summary']>> = {}): NonNullable<PrSummaryInput['summary']> {
  return {
    workCompleted: 'Implemented the feature successfully',
    keyFindings: ['Added new component', 'Updated tests'],
    filesChanged: ['src/component.ts', 'tests/component.test.ts'],
    followUps: ['Add more tests', 'Verify in production'],
    status: 'success',
    ...overrides,
  }
}

// Mock server summary generator
function createMockServerGenerator(result: ExecutionSummary | null) {
  return vi.fn().mockResolvedValue(result)
}

// ============================================================================
// 1. parseExecutiveSummaryFromOutput
// ============================================================================

describe('parseExecutiveSummaryFromOutput', () => {
  it('parses valid executive summary', () => {
    const output = `Some agent output here...

## Executive Summary
**Status:** success
**What was done:** Implemented the new feature.
- Added component X
- Updated tests

More output after...`

    const result = parseExecutiveSummaryFromOutput(output)
    expect(result).not.toBeNull()
    expect(result).toContain('Status:')
    expect(result).toContain('What was done:')
  })

  it('returns null for output without Executive Summary header', () => {
    const output = `This is normal output.
No summary section here.
**Status:** success`

    const result = parseExecutiveSummaryFromOutput(output)
    expect(result).toBeNull()
  })

  it('returns null for summary shorter than 20 characters', () => {
    const output = `## Executive Summary
Short`

    const result = parseExecutiveSummaryFromOutput(output)
    expect(result).toBeNull()
  })

  it('extracts summary until next ## heading', () => {
    const output = `## Executive Summary
This is the summary content that should be extracted.
- Point 1
- Point 2

## Next Section
This should not be included`

    const result = parseExecutiveSummaryFromOutput(output)
    expect(result).not.toBeNull()
    expect(result).toContain('This is the summary content')
    expect(result).toContain('Point 1')
    expect(result).not.toContain('Next Section')
  })

  it('extracts summary until --- separator', () => {
    const output = `## Executive Summary
This is the summary.
- Finding 1
- Finding 2

---
Footer content`

    const result = parseExecutiveSummaryFromOutput(output)
    expect(result).not.toBeNull()
    expect(result).toContain('This is the summary')
    expect(result).not.toContain('Footer')
  })

  it('handles case-insensitive header', () => {
    const output = `## EXECUTIVE SUMMARY
This is a case-insensitive test summary.`

    const result = parseExecutiveSummaryFromOutput(output)
    expect(result).not.toBeNull()
    expect(result).toContain('case-insensitive')
  })
})

// ============================================================================
// 2. formatPrBody
// ============================================================================

describe('formatPrBody', () => {
  it('formats complete PR body with all sections', () => {
    const body = formatPrBody({
      summary: 'Task completed successfully',
      changes: ['Added feature X', 'Fixed bug Y'],
      filesChanged: ['src/a.ts', 'src/b.ts'],
      testPlan: ['Run unit tests', 'Verify in staging'],
      astroUrl: 'https://astro.app/project/123/task/456',
      relatedIssue: '#42',
    })

    expect(body).toContain('## Summary')
    expect(body).toContain('Task completed successfully')
    expect(body).toContain('## Changes')
    expect(body).toContain('- Added feature X')
    expect(body).toContain('## Files Changed')
    expect(body).toContain('`src/a.ts`')
    expect(body).toContain('## Test Plan')
    expect(body).toContain('- [ ] Run unit tests')
    expect(body).toContain('## Astro')
    expect(body).toContain('[View task in Astro]')
    expect(body).toContain('## Related Issue')
    expect(body).toContain('Closes #42')
    expect(body).toContain('PR description generated by')
  })

  it('omits empty sections', () => {
    const body = formatPrBody({
      summary: 'Just a summary',
    })

    expect(body).toContain('## Summary')
    expect(body).not.toContain('## Changes')
    expect(body).not.toContain('## Files Changed')
    expect(body).not.toContain('## Test Plan')
    expect(body).not.toContain('## Astro')
    expect(body).not.toContain('## Related Issue')
  })

  it('truncates file list at 30 files', () => {
    const files = Array.from({ length: 35 }, (_, i) => `src/file${i}.ts`)
    const body = formatPrBody({
      summary: 'Many files changed',
      filesChanged: files,
    })

    expect(body).toContain('`src/file0.ts`')
    expect(body).toContain('`src/file29.ts`')
    expect(body).not.toContain('`src/file30.ts`')
    expect(body).toContain('...and 5 more files')
  })
})

// ============================================================================
// 3. runPrSummaryFallbackChain - Layer 1 (Structured Summary)
// ============================================================================

describe('runPrSummaryFallbackChain - Layer 1: Structured Summary', () => {
  it('returns structured summary when available', async () => {
    const input: PrSummaryInput = {
      summary: makeStructuredSummary(),
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('structured')
    expect(result!.body).toContain('Implemented the feature successfully')
    expect(result!.body).toContain('Added new component')
  })

  it('uses executiveSummary over workCompleted when available', async () => {
    const input: PrSummaryInput = {
      summary: makeStructuredSummary({
        workCompleted: 'Short work completed',
        executiveSummary: 'This is the detailed executive summary with more context.',
      }),
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('structured')
    expect(result!.body).toContain('This is the detailed executive summary')
    expect(result!.body).not.toContain('Short work completed')
  })

  it('separates test follow-ups from other follow-ups', async () => {
    const input: PrSummaryInput = {
      summary: makeStructuredSummary({
        followUps: [
          'Run integration tests',
          'Document the API',
          'Verify the fix in staging',
          'Update changelog',
        ],
      }),
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('structured')
    // Test plan should contain test/verify items
    expect(result!.body).toContain('## Test Plan')
    expect(result!.body).toContain('Run integration tests')
    expect(result!.body).toContain('Verify the fix')
    // Changes should contain non-test follow-ups
    expect(result!.body).toContain('Document the API')
    expect(result!.body).toContain('Update changelog')
  })

  it('includes related issue when githubIssueUrl is provided', async () => {
    const input: PrSummaryInput = {
      summary: makeStructuredSummary(),
      node: makeNode({
        githubIssueUrl: 'https://github.com/org/repo/issues/42',
      }),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.body).toContain('## Related Issue')
    expect(result!.body).toContain('https://github.com/org/repo/issues/42')
  })

  it('includes related issue reference when githubIssueNumber is provided', async () => {
    const input: PrSummaryInput = {
      summary: makeStructuredSummary(),
      node: makeNode({
        githubIssueNumber: 99,
      }),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.body).toContain('Closes #99')
  })
})

// ============================================================================
// 4. runPrSummaryFallbackChain - Layer 2 (Parsed Summary)
// ============================================================================

describe('runPrSummaryFallbackChain - Layer 2: Parsed Summary', () => {
  it('falls back to parsed summary when structured missing', async () => {
    const input: PrSummaryInput = {
      stdout: `Agent output...

## Executive Summary
**Status:** success
**What was done:** This is the parsed summary from output.
- Key finding 1
- Key finding 2

Done.`,
      filesChanged: [{ path: 'src/file.ts' }],
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('parsed')
    expect(result!.body).toContain('parsed summary from output')
  })

  it('includes file changes from result when parsing summary', async () => {
    const input: PrSummaryInput = {
      stdout: `## Executive Summary
This is the parsed executive summary content.`,
      filesChanged: [
        { path: 'src/component.tsx' },
        { path: 'tests/component.test.ts' },
      ],
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('parsed')
    expect(result!.body).toContain('`src/component.tsx`')
    expect(result!.body).toContain('`tests/component.test.ts`')
  })

  it('prefers structured over parsed when both available', async () => {
    const input: PrSummaryInput = {
      summary: makeStructuredSummary(),
      stdout: `## Executive Summary
This is the parsed summary that should be ignored.`,
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('structured')
    expect(result!.body).not.toContain('should be ignored')
  })
})

// ============================================================================
// 5. runPrSummaryFallbackChain - Layer 3 (Server-Generated)
// ============================================================================

describe('runPrSummaryFallbackChain - Layer 3: Server-Generated', () => {
  it('falls back to server-generated when parsing fails', async () => {
    const mockGenerator = createMockServerGenerator({
      workCompleted: 'Server-generated summary of the work.',
      executiveSummary: 'Detailed server-generated executive summary.',
      keyFindings: ['Server finding 1', 'Server finding 2'],
      filesChanged: ['src/server.ts'],
      status: 'success',
      followUps: [],
    })

    const input: PrSummaryInput = {
      stdout: 'Some output without executive summary section',
      filesChanged: [{ path: 'src/file.ts' }],
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, {
      serverSummaryGenerator: mockGenerator,
    })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('server_generated')
    expect(result!.body).toContain('server-generated executive summary')
    expect(mockGenerator).toHaveBeenCalledOnce()
  })

  it('uses workCompleted when executiveSummary is missing', async () => {
    const mockGenerator = createMockServerGenerator({
      workCompleted: 'Server work completed text.',
      keyFindings: [],
      filesChanged: [],
      status: 'success',
      followUps: [],
    })

    const input: PrSummaryInput = {
      stdout: 'Output without summary',
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, {
      serverSummaryGenerator: mockGenerator,
    })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('server_generated')
    expect(result!.body).toContain('Server work completed text')
  })

  it('passes correct input to server generator', async () => {
    const mockGenerator = createMockServerGenerator({
      workCompleted: 'Generated summary',
      keyFindings: [],
      filesChanged: [],
      status: 'success',
      followUps: [],
    })

    const input: PrSummaryInput = {
      stdout: 'Agent output text',
      filesChanged: [
        { path: 'src/a.ts', diff: '+line' },
        { path: 'src/b.ts' },
      ],
      node: makeNode({
        title: 'My Task Title',
        description: 'My task description',
      }),
    }

    await runPrSummaryFallbackChain(input, {
      serverSummaryGenerator: mockGenerator,
    })

    expect(mockGenerator).toHaveBeenCalledWith({
      taskTitle: 'My Task Title',
      taskDescription: 'My task description',
      executionOutput: 'Agent output text',
      fileChanges: [
        { path: 'src/a.ts', action: 'modified' },
        { path: 'src/b.ts', action: 'changed' },
      ],
      status: 'success',
    })
  })

  it('falls back to next layer when server returns null', async () => {
    const mockGenerator = createMockServerGenerator(null)

    const input: PrSummaryInput = {
      stdout: 'Output without parseable summary',
      filesChanged: [{ path: 'src/file.ts' }],
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, {
      serverSummaryGenerator: mockGenerator,
    })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('file_changes')
    expect(mockGenerator).toHaveBeenCalledOnce()
  })

  it('falls back to next layer when server throws', async () => {
    const mockGenerator = vi.fn().mockRejectedValue(new Error('API error'))

    const input: PrSummaryInput = {
      stdout: 'Output',
      filesChanged: [{ path: 'src/file.ts' }],
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, {
      serverSummaryGenerator: mockGenerator,
    })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('file_changes')
  })

  it('skips server generation when skipServerSummary is true', async () => {
    const mockGenerator = createMockServerGenerator({
      workCompleted: 'Should not be used',
      keyFindings: [],
      filesChanged: [],
      status: 'success',
      followUps: [],
    })

    const input: PrSummaryInput = {
      stdout: 'Output without parseable summary',
      filesChanged: [{ path: 'src/file.ts' }],
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, {
      serverSummaryGenerator: mockGenerator,
      skipServerSummary: true,
    })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('file_changes')
    expect(mockGenerator).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 6. runPrSummaryFallbackChain - Layer 4 (File Changes)
// ============================================================================

describe('runPrSummaryFallbackChain - Layer 4: File Changes', () => {
  it('falls back to file changes when server fails', async () => {
    const input: PrSummaryInput = {
      filesChanged: [
        { path: 'src/component.ts' },
        { path: 'src/utils.ts' },
        { path: 'tests/component.test.ts' },
      ],
      node: makeNode({ title: 'Update Component' }),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('file_changes')
    expect(result!.body).toContain('Completed task: Update Component')
    expect(result!.body).toContain('Modified 3 file(s)')
    expect(result!.body).toContain('`src/component.ts`')
    expect(result!.body).toContain('`src/utils.ts`')
  })

  it('skips server layer when no stdout', async () => {
    const mockGenerator = createMockServerGenerator({
      workCompleted: 'Server summary',
      keyFindings: [],
      filesChanged: [],
      status: 'success',
      followUps: [],
    })

    const input: PrSummaryInput = {
      // No stdout - server layer should still run with file changes
      filesChanged: [{ path: 'src/file.ts' }],
      node: makeNode(),
    }

    const result = await runPrSummaryFallbackChain(input, {
      serverSummaryGenerator: mockGenerator,
    })

    // Server should be called because we have filesChanged
    expect(mockGenerator).toHaveBeenCalled()
    expect(result!.source).toBe('server_generated')
  })
})

// ============================================================================
// 7. runPrSummaryFallbackChain - Layer 5 (Task Description)
// ============================================================================

describe('runPrSummaryFallbackChain - Layer 5: Task Description', () => {
  it('falls back to task description as last resort', async () => {
    const input: PrSummaryInput = {
      node: makeNode({
        title: 'Implement Feature X',
        description: 'This task implements feature X with detailed requirements.',
      }),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('task_description')
    expect(result!.body).toContain('This task implements feature X')
  })

  it('uses title when description is missing', async () => {
    const input: PrSummaryInput = {
      node: makeNode({
        title: 'Fix Critical Bug',
        description: undefined,
      }),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('task_description')
    expect(result!.body).toContain('Fix Critical Bug')
  })

  it('truncates long descriptions at 500 characters', async () => {
    const longDescription = 'A'.repeat(600)
    const input: PrSummaryInput = {
      node: makeNode({
        title: 'Task',
        description: longDescription,
      }),
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('task_description')
    expect(result!.body).toContain('A'.repeat(500))
    expect(result!.body).toContain('…')
    expect(result!.body).not.toContain('A'.repeat(501))
  })

  it('returns null when no title or description', async () => {
    const input: PrSummaryInput = {
      node: {
        title: '',
        description: '',
      },
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).toBeNull()
  })
})

// ============================================================================
// 8. runPrSummaryFallbackChain - Astro URL Generation
// ============================================================================

describe('runPrSummaryFallbackChain - Astro URL', () => {
  it('includes Astro URL when projectId and nodeId provided', async () => {
    const input: PrSummaryInput = {
      summary: makeStructuredSummary(),
      node: makeNode(),
      projectId: 'proj-123',
      nodeId: 'node-456',
      astroBaseUrl: 'https://app.astro.dev',
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.body).toContain('## Astro')
    expect(result!.body).toContain('https://app.astro.dev/project/proj-123/task/node-456')
  })

  it('omits Astro URL when projectId or nodeId missing', async () => {
    const input: PrSummaryInput = {
      summary: makeStructuredSummary(),
      node: makeNode(),
      projectId: 'proj-123',
      // nodeId missing
    }

    const result = await runPrSummaryFallbackChain(input, { skipServerSummary: true })

    expect(result).not.toBeNull()
    expect(result!.body).not.toContain('## Astro')
  })
})

// ============================================================================
// 9. runPrSummaryFallbackChain - Full Fallback Chain Integration
// ============================================================================

describe('runPrSummaryFallbackChain - Full Chain Integration', () => {
  it('correctly falls through all layers in priority order', async () => {
    // Test Layer 1 -> 2 -> 3 -> 4 -> 5 fallback
    const sources: PrSummarySource[] = []

    // Layer 1: Structured summary
    let result = await runPrSummaryFallbackChain({
      summary: makeStructuredSummary(),
      stdout: '## Executive Summary\nParsed content here.',
      filesChanged: [{ path: 'file.ts' }],
      node: makeNode(),
    }, { skipServerSummary: true })
    sources.push(result!.source)

    // Layer 2: No structured, but has parseable stdout
    result = await runPrSummaryFallbackChain({
      stdout: '## Executive Summary\nThis is the parsed executive summary content.',
      filesChanged: [{ path: 'file.ts' }],
      node: makeNode(),
    }, { skipServerSummary: true })
    sources.push(result!.source)

    // Layer 3: Server generated (mocked)
    result = await runPrSummaryFallbackChain({
      stdout: 'No parseable summary here',
      filesChanged: [{ path: 'file.ts' }],
      node: makeNode(),
    }, {
      serverSummaryGenerator: createMockServerGenerator({
        workCompleted: 'Server generated',
        keyFindings: [],
        filesChanged: [],
        status: 'success',
        followUps: [],
      }),
    })
    sources.push(result!.source)

    // Layer 4: File changes only
    result = await runPrSummaryFallbackChain({
      filesChanged: [{ path: 'file.ts' }],
      node: makeNode(),
    }, { skipServerSummary: true })
    sources.push(result!.source)

    // Layer 5: Task description only
    result = await runPrSummaryFallbackChain({
      node: makeNode({ title: 'Task', description: 'Description' }),
    }, { skipServerSummary: true })
    sources.push(result!.source)

    expect(sources).toEqual([
      'structured',
      'parsed',
      'server_generated',
      'file_changes',
      'task_description',
    ])
  })

  it('verifies source field is correct for each layer', async () => {
    // Layer 1
    let result = await runPrSummaryFallbackChain({
      summary: makeStructuredSummary(),
      node: makeNode(),
    }, { skipServerSummary: true })
    expect(result!.source).toBe('structured')

    // Layer 2
    result = await runPrSummaryFallbackChain({
      stdout: '## Executive Summary\nThis is a valid parsed summary content.',
      node: makeNode(),
    }, { skipServerSummary: true })
    expect(result!.source).toBe('parsed')

    // Layer 3
    result = await runPrSummaryFallbackChain({
      stdout: 'No summary',
      node: makeNode(),
    }, {
      serverSummaryGenerator: createMockServerGenerator({
        workCompleted: 'Server',
        keyFindings: [],
        filesChanged: [],
        status: 'success',
        followUps: [],
      }),
    })
    expect(result!.source).toBe('server_generated')

    // Layer 4
    result = await runPrSummaryFallbackChain({
      filesChanged: [{ path: 'file.ts' }],
      node: makeNode(),
    }, { skipServerSummary: true })
    expect(result!.source).toBe('file_changes')

    // Layer 5
    result = await runPrSummaryFallbackChain({
      node: makeNode(),
    }, { skipServerSummary: true })
    expect(result!.source).toBe('task_description')
  })
})
