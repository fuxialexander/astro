/**
 * Server-side summary generation via Anthropic API (direct call).
 *
 * Uses buildSummaryPrompt() for prompt construction and calls claude-3-haiku
 * for a single-turn summary generation. This avoids the relay/agent-runner
 * round-trip for a simple structured-output task.
 *
 * Also provides parseExecutiveSummaryFromOutput() for extracting structured
 * executive summaries from agent output text (regex-based, no API call).
 */

import Anthropic from '@anthropic-ai/sdk'
import { buildSummaryPrompt } from '../prompt-templates.js'
import type { ExecutionSummary } from '../types.js'

// ============================================================================
// Executive Summary Parsing (from agent output text)
// ============================================================================

/**
 * Parsed executive summary extracted from agent output text.
 *
 * This is the structured result of parsing the "## Executive Summary" block
 * that agents emit at the end of their output.
 */
export interface ExecutiveSummaryParsed {
  /** Overall execution status: success, partial, or failure */
  status: 'success' | 'partial' | 'failure'
  /** One-sentence summary of what was accomplished */
  workCompleted: string
  /** Key findings or changes (bullet points) */
  keyFindings: string[]
  /** Suggested follow-up actions (bullet points) */
  followUps: string[]
}

/**
 * Parse an executive summary from agent output text.
 *
 * Looks for the structured "## Executive Summary" block that agents emit
 * at the end of their output. The format is:
 *
 * ```
 * ## Executive Summary
 * **Status:** success | partial | failure
 * **What was done:** One sentence describing the overall outcome.
 * - Key finding or change 1
 * - Key finding or change 2
 * **Follow-ups:**
 * - Suggested follow-up action (if any)
 * ```
 *
 * This function is robust to:
 * - Flexible whitespace (spaces, tabs, multiple newlines)
 * - Optional bold markers (**) on field names
 * - Markdown headers with varying hash counts
 * - Code fence wrapping
 * - Missing sections (returns null for missing required fields)
 *
 * @param output - The full agent output text to parse
 * @returns ExecutiveSummaryParsed object, or null if the summary block is not found or is invalid
 */
export function parseExecutiveSummaryFromOutput(output: string): ExecutiveSummaryParsed | null {
  if (!output || typeof output !== 'string') {
    return null
  }

  // Match the Executive Summary block with flexible header format
  // Supports: ## Executive Summary, ### Executive Summary, **Executive Summary**, etc.
  // Also handles code fence wrapping (```...```)
  const headerPattern = /(?:^|\n)(?:#{1,6}\s*)?(?:\*\*)?Executive\s+Summary(?:\*\*)?[\s:]*\n([\s\S]*?)(?:\n```|$)/i
  const match = output.match(headerPattern)

  if (!match) {
    return null
  }

  const block = match[1]

  // Parse Status field with flexible formatting
  // Supports: **Status:** value, Status: value, **Status**: value, etc.
  const statusPattern = /(?:\*\*)?Status(?:\*\*)?[\s:]+\**\s*(success|partial|failure)\s*\**/i
  const statusMatch = block.match(statusPattern)

  // Parse "What was done" field with flexible formatting
  // Supports: **What was done:** text, What was done: text, etc.
  // Captures the text after the colon/space, stripping any trailing ** or leading **
  const whatDonePattern = /(?:\*\*)?What\s+was\s+done(?:\*\*)?[\s:]+\**\s*([^*\n]+)/i
  const whatMatch = block.match(whatDonePattern)

  // Extract key findings (bullet points not under Follow-ups section)
  const keyFindings: string[] = []
  const followUps: string[] = []

  // Split block into lines and process
  const lines = block.split('\n')
  let inFollowUps = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Detect Follow-ups section header (with or without colon, bold markers)
    // Matches: **Follow-ups:**, Follow-ups:, **Followups**, Follow ups:, etc.
    // The pattern matches any combination of **, Follow-ups, :, and whitespace
    if (/^(?:\*\*)?Follow[\s-]*ups?(?:\*\*)?[\s:]*(?:\*\*)?$/i.test(trimmed)) {
      inFollowUps = true
      continue
    }

    // Detect other labeled sections that should end the Follow-ups section
    // Look for patterns like "**Status:**", "What was done:", etc.
    // But NOT bullet points (which start with -, *, or •)
    if (!trimmed.startsWith('-') && !trimmed.startsWith('*') && !trimmed.startsWith('•')) {
      // Check if this looks like a field header (word(s) followed by colon)
      // This resets inFollowUps mode for new sections
      if (/^(?:\*\*)?[A-Z][a-zA-Z\s]*(?:\*\*)?[\s]*:/.test(trimmed)) {
        inFollowUps = false
        continue
      }
    }

    // Parse bullet points
    // Supports: - item, * item, • item (dash, asterisk, or bullet character)
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/)
    if (bulletMatch) {
      const content = bulletMatch[1].trim()
      if (content) {
        if (inFollowUps) {
          followUps.push(content)
        } else {
          keyFindings.push(content)
        }
      }
    }
  }

  // Validate required fields
  // Status and workCompleted are required; return null if either is missing
  const status = statusMatch?.[1]?.toLowerCase() as 'success' | 'partial' | 'failure' | undefined
  const workCompleted = whatMatch?.[1]?.trim()

  if (!status || !workCompleted) {
    // If we have at least some parsed content, return what we have
    // This allows partial extraction when the format is slightly off
    if (!status && !workCompleted && keyFindings.length === 0 && followUps.length === 0) {
      return null
    }
  }

  // If we're missing status but have workCompleted, try to infer status from text
  let finalStatus = status
  if (!finalStatus && workCompleted) {
    // Default to 'success' if workCompleted is present but status is missing
    finalStatus = 'success'
  }

  // If we're still missing required fields, return null
  if (!finalStatus || !workCompleted) {
    return null
  }

  return {
    status: finalStatus,
    workCompleted,
    keyFindings,
    followUps,
  }
}

/** Input for server-side summary generation */
export interface SummaryInput {
  taskTitle: string
  taskDescription: string
  executionOutput: string
  fileChanges: Array<{ path: string; action: string }>
  status?: 'success' | 'failure'
}

/** Default timeout for summary API calls (ms) */
const SUMMARY_TIMEOUT_MS = 15_000

/**
 * Generate an ExecutionSummary by calling the Anthropic API directly.
 *
 * Uses claude-3-haiku for cost-efficient, single-turn structured output.
 * Returns null on any failure (timeout, API error, JSON parse error)
 * rather than throwing, so callers can gracefully fall back.
 *
 * @param input - Task context for summary generation
 * @param apiKey - Anthropic API key (falls back to ANTHROPIC_API_KEY env var)
 * @returns ExecutionSummary object, or null on failure
 */
export async function generateServerSideSummary(
  input: SummaryInput,
  apiKey?: string,
): Promise<ExecutionSummary | null> {
  const resolvedKey = apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!resolvedKey) {
    console.error('[summary-utils] No Anthropic API key available — cannot generate summary')
    return null
  }

  const client = new Anthropic({ apiKey: resolvedKey })

  const prompt = buildSummaryPrompt({
    taskTitle: input.taskTitle,
    taskDescription: input.taskDescription,
    executionOutput: input.executionOutput,
    fileChanges: input.fileChanges,
    status: input.status ?? 'success',
  })

  try {
    // AbortController for 15s timeout
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS)

    const response = await client.messages.create(
      {
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal },
    )

    clearTimeout(timer)

    // Extract text from the response
    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      console.error('[summary-utils] No text block in Anthropic response')
      return null
    }

    const rawText = textBlock.text

    // Parse JSON from response (may be wrapped in markdown fences or extra text)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[summary-utils] No JSON object found in response')
      return null
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

    // Validate and construct ExecutionSummary
    const summary: ExecutionSummary = {
      workCompleted: typeof parsed.workCompleted === 'string'
        ? parsed.workCompleted
        : 'Summary generation completed',
      keyFindings: Array.isArray(parsed.keyFindings)
        ? (parsed.keyFindings as unknown[]).filter((f): f is string => typeof f === 'string')
        : [],
      filesChanged: Array.isArray(parsed.filesChanged)
        ? (parsed.filesChanged as unknown[]).filter((f): f is string => typeof f === 'string')
        : input.fileChanges.map((f) => f.path),
      status: parsed.status === 'success' || parsed.status === 'partial' || parsed.status === 'failure'
        ? (parsed.status as ExecutionSummary['status'])
        : (input.status === 'failure' ? 'failure' : 'success'),
      followUps: Array.isArray(parsed.followUps)
        ? (parsed.followUps as unknown[]).filter((f): f is string => typeof f === 'string')
        : [],
    }

    // Include executiveSummary if present
    if (typeof parsed.executiveSummary === 'string') {
      summary.executiveSummary = parsed.executiveSummary
    }

    return summary
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[summary-utils] Summary generation timed out after 15s')
    } else {
      console.error('[summary-utils] Summary generation failed:', err instanceof Error ? err.message : err)
    }
    return null
  }
}
