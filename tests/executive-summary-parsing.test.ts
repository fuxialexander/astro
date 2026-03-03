/**
 * Tests for parseExecutiveSummaryFromOutput utility
 *
 * Validates parsing of the structured "## Executive Summary" block
 * that agents emit at the end of their output.
 */

import { describe, it, expect } from 'vitest'
import { parseExecutiveSummaryFromOutput } from '../packages/core/src/dispatch/summary-utils.js'

describe('parseExecutiveSummaryFromOutput', () => {
  describe('standard format', () => {
    it('parses a complete executive summary', () => {
      const output = `
Some agent output here...

## Executive Summary
**Status:** success
**What was done:** Implemented the new feature.
- Added new API endpoint
- Updated database schema
- Wrote comprehensive tests
**Follow-ups:**
- Monitor performance in production
- Consider adding caching
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Implemented the new feature.')
      expect(result!.keyFindings).toEqual([
        'Added new API endpoint',
        'Updated database schema',
        'Wrote comprehensive tests',
      ])
      expect(result!.followUps).toEqual([
        'Monitor performance in production',
        'Consider adding caching',
      ])
    })

    it('parses partial status', () => {
      const output = `
## Executive Summary
**Status:** partial
**What was done:** Completed most of the implementation.
- Core functionality working
**Follow-ups:**
- Fix edge cases
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('partial')
    })

    it('parses failure status', () => {
      const output = `
## Executive Summary
**Status:** failure
**What was done:** Failed to complete the task.
- Build errors encountered
**Follow-ups:**
- Review dependencies
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('failure')
    })
  })

  describe('flexible whitespace handling', () => {
    it('handles extra whitespace between sections', () => {
      const output = `
## Executive Summary

**Status:**    success

**What was done:**   Completed with extra spaces.

- Finding one

**Follow-ups:**

- Follow-up one
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('Completed with extra spaces.')
    })

    it('handles tabs in content', () => {
      const output = `
## Executive Summary
**Status:**	success
**What was done:**	Task completed.
-	Tab-prefixed finding
**Follow-ups:**
-	Tab-prefixed follow-up
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
    })
  })

  describe('flexible header formats', () => {
    it('handles different markdown header levels', () => {
      const output = `
### Executive Summary
**Status:** success
**What was done:** Different header level.
- Finding
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
    })

    it('handles header without bold markers', () => {
      const output = `
## Executive Summary
Status: success
What was done: No bold markers used.
- Finding
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
      expect(result!.workCompleted).toBe('No bold markers used.')
    })
  })

  describe('flexible bullet point formats', () => {
    it('handles asterisk bullets', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Using asterisks.
* Finding with asterisk
**Follow-ups:**
* Follow-up with asterisk
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.keyFindings).toContain('Finding with asterisk')
      expect(result!.followUps).toContain('Follow-up with asterisk')
    })
  })

  describe('edge cases', () => {
    it('returns null for empty input', () => {
      expect(parseExecutiveSummaryFromOutput('')).toBeNull()
    })

    it('returns null for null input', () => {
      expect(parseExecutiveSummaryFromOutput(null as unknown as string)).toBeNull()
    })

    it('returns null for undefined input', () => {
      expect(parseExecutiveSummaryFromOutput(undefined as unknown as string)).toBeNull()
    })

    it('returns null for non-string input', () => {
      expect(parseExecutiveSummaryFromOutput(123 as unknown as string)).toBeNull()
    })

    it('returns null when executive summary block is not found', () => {
      const output = `
Some agent output without executive summary.
Just regular text here.
`

      expect(parseExecutiveSummaryFromOutput(output)).toBeNull()
    })

    it('returns null when missing required status and workCompleted', () => {
      const output = `
## Executive Summary
- Just a bullet point without status or what was done
`

      expect(parseExecutiveSummaryFromOutput(output)).toBeNull()
    })

    it('handles summary with no follow-ups', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Task completed successfully.
- Finding one
- Finding two
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.followUps).toEqual([])
    })

    it('handles summary with no key findings', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Simple task with no findings.
**Follow-ups:**
- Consider adding tests
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.keyFindings).toEqual([])
      expect(result!.followUps).toContain('Consider adding tests')
    })

    it('handles code fence terminated summary', () => {
      const output = `
## Executive Summary
**Status:** success
**What was done:** Task done.
- Finding
\`\`\`
code after summary
\`\`\`
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
    })

    it('handles summary at the very end of output', () => {
      const output = `
Long agent output here...
More output...

## Executive Summary
**Status:** success
**What was done:** Final summary.
- Complete`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
    })
  })

  describe('case insensitivity', () => {
    it('handles uppercase status values', () => {
      const output = `
## Executive Summary
**Status:** SUCCESS
**What was done:** Case test.
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('success')
    })

    it('handles mixed case status values', () => {
      const output = `
## Executive Summary
**Status:** Partial
**What was done:** Mixed case test.
`

      const result = parseExecutiveSummaryFromOutput(output)

      expect(result).not.toBeNull()
      expect(result!.status).toBe('partial')
    })
  })
})
