/**
 * Summary Parsing Utilities
 *
 * Server-side utilities for parsing structured Executive Summary blocks
 * from agent output text.
 */

/**
 * Parsed result from an Executive Summary block.
 * All fields are optional to handle partial summaries.
 */
export interface ExecutiveSummaryParsed {
  /** Task outcome: success, partial, or failure */
  status?: 'success' | 'partial' | 'failure'
  /** One-sentence summary of what was accomplished */
  workCompleted?: string
  /** Key bullet points of findings/changes (between "What was done" and "Follow-ups") */
  keyFindings?: string[]
  /** Suggested follow-up actions */
  followUps?: string[]
}

/**
 * Parse an Executive Summary block from agent output text.
 *
 * Looks for the structured "## Executive Summary" block and extracts:
 * - Status: success | partial | failure
 * - What was done: one-sentence summary
 * - Key findings: bullet points between "What was done" and "Follow-ups"
 * - Follow-ups: bullet points after "Follow-ups:"
 *
 * @param output - Raw agent output text
 * @returns Parsed summary object, or null if no valid summary found
 *
 * @example
 * ```typescript
 * const output = \`
 * ## Executive Summary
 * **Status:** success
 * **What was done:** Implemented the authentication flow.
 * - Added JWT validation
 * - Created refresh endpoint
 * **Follow-ups:**
 * - Add rate limiting
 * \`
 * const result = parseExecutiveSummaryFromOutput(output)
 * // { status: 'success', workCompleted: 'Implemented the authentication flow.', ... }
 * ```
 */
export function parseExecutiveSummaryFromOutput(output: string): ExecutiveSummaryParsed | null {
  if (!output || typeof output !== 'string') {
    return null
  }

  // Match the Executive Summary section header with flexible whitespace
  // Handles: "## Executive Summary", "##Executive Summary", "##  Executive Summary"
  // Also handles various markdown heading levels (##, ###)
  const headerMatch = output.match(/#{2,3}\s*Executive\s+Summary\s*\n/i)
  if (!headerMatch) {
    return null
  }

  // Extract the block after the header until end of text or a code block/new section
  const startIndex = headerMatch.index! + headerMatch[0].length
  const remainder = output.slice(startIndex)

  // Find the end of the summary block:
  // - Another ## heading (new section)
  // - A code fence (```)
  // - End of string
  const endMatch = remainder.match(/\n#{2,3}\s+[A-Z]|\n```|$/)
  const block = endMatch
    ? remainder.slice(0, endMatch.index !== undefined ? endMatch.index : remainder.length)
    : remainder

  // Parse status line with flexible formatting
  // Handles: "**Status:** success", "**Status**: success", "* *Status:* * success", etc.
  const statusMatch = block.match(/\*\*Status:?\*\*:?\s*(success|partial|failure)/i)

  // Parse "What was done" line - captures the rest of the line after the label
  // Handles: "**What was done:** ...", "**What was done**: ...", etc.
  const whatMatch = block.match(/\*\*What\s+was\s+done:?\*\*:?\s*(.+?)(?:\n|$)/i)

  // Split block into lines for bullet parsing
  const lines = block.split('\n')
  const keyFindings: string[] = []
  const followUps: string[] = []

  // State machine for tracking which section we're in
  let inFollowUps = false
  let pastWhatWasDone = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) continue

    // Check for section headers
    if (/\*\*Follow-?ups?:?\*\*/i.test(trimmed)) {
      inFollowUps = true
      continue
    }
    if (/\*\*What\s+was\s+done:?\*\*:?\s*/i.test(trimmed)) {
      pastWhatWasDone = true
      inFollowUps = false
      continue
    }
    if (/\*\*Status:?\*\*/i.test(trimmed)) {
      inFollowUps = false
      continue
    }

    // Parse bullet points (- or *)
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (bulletMatch) {
      const bulletText = bulletMatch[1].trim()
      // Skip empty bullets
      if (!bulletText) continue

      if (inFollowUps) {
        followUps.push(bulletText)
      } else if (pastWhatWasDone) {
        // Key findings are bullets between "What was done" and "Follow-ups"
        keyFindings.push(bulletText)
      }
    }
  }

  // If we found nothing useful, return null
  const status = statusMatch?.[1]?.toLowerCase() as ExecutiveSummaryParsed['status']
  const workCompleted = whatMatch?.[1]?.trim()

  if (!status && !workCompleted && keyFindings.length === 0 && followUps.length === 0) {
    return null
  }

  // Build the result object, only including non-empty fields
  const result: ExecutiveSummaryParsed = {}

  if (status) {
    result.status = status
  }
  if (workCompleted) {
    result.workCompleted = workCompleted
  }
  if (keyFindings.length > 0) {
    result.keyFindings = keyFindings
  }
  if (followUps.length > 0) {
    result.followUps = followUps
  }

  return result
}

/**
 * Check if an output string contains a valid Executive Summary block.
 *
 * @param output - Raw agent output text
 * @returns true if a summary header is found
 */
export function hasExecutiveSummary(output: string): boolean {
  if (!output || typeof output !== 'string') {
    return false
  }
  return /#{2,3}\s*Executive\s+Summary\s*\n/i.test(output)
}
