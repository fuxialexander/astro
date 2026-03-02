/**
 * Server-side summary generation via Anthropic API (direct call).
 *
 * Uses buildSummaryPrompt() for prompt construction and calls claude-3-haiku
 * for a single-turn summary generation. This avoids the relay/agent-runner
 * round-trip for a simple structured-output task.
 *
 * Also provides runPrSummaryFallbackChain() for PR body generation with
 * a 5-layer fallback chain.
 */

import Anthropic from '@anthropic-ai/sdk'
import { buildSummaryPrompt } from '../prompt-templates.js'
import type { ExecutionSummary } from '../types.js'
import type { TaskResult } from './types.js'

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

// ============================================================================
// PR Summary Fallback Chain
// ============================================================================

/** Source of the generated PR summary */
export type PrSummarySource =
  | 'structured'       // From TaskResult.summary.executiveSummary
  | 'parsed'           // Parsed from ## Executive Summary in output
  | 'server_generated' // Generated via Anthropic API
  | 'git_diff'         // Generated from git diff + commit log
  | 'task_description' // Fallback to raw task description

/** Result from the PR summary fallback chain */
export interface PrSummaryResult {
  summary: string
  source: PrSummarySource
}

/** Git context for generating a diff-based summary */
export interface GitDiffContext {
  /** Commit messages on the branch */
  commitMessages?: string[]
  /** Files changed with optional diffs */
  filesChanged?: Array<{
    path: string
    action?: 'create' | 'modify' | 'delete'
    linesAdded?: number
    linesRemoved?: number
  }>
  /** Branch name */
  branchName?: string
}

/** Input for the PR summary fallback chain */
export interface PrSummaryChainInput {
  /** Task result from execution (may contain structured summary) */
  taskResult?: TaskResult
  /** Raw output text from execution (for parsing executive summary) */
  executionOutput?: string
  /** Task title for context */
  taskTitle: string
  /** Task description (used as final fallback) */
  taskDescription: string
  /** File changes for server-side summary generation */
  fileChanges?: Array<{ path: string; action: string }>
  /** Git context for diff-based summary */
  gitContext?: GitDiffContext
  /** Anthropic API key (optional, falls back to env var) */
  apiKey?: string
  /** Execution status */
  status?: 'success' | 'failure'
}

/**
 * Parse an executive summary from the agent's stream text.
 * Looks for the structured "## Executive Summary" block at the end of output.
 *
 * Expected format:
 * ```
 * ## Executive Summary
 * **Status:** success | partial | failure
 * **What was done:** One sentence describing the outcome.
 * - Key finding 1
 * - Key finding 2
 * **Follow-ups:**
 * - Suggested follow-up
 * ```
 */
export function parseExecutiveSummaryFromOutput(streamText: string): Partial<ExecutionSummary> | null {
  const match = streamText.match(/## Executive Summary\s*\n([\s\S]*?)(?:\n```|$)/)
  if (!match) return null

  const block = match[1]
  const statusMatch = block.match(/\*\*Status:\*\*\s*(success|partial|failure)/i)
  const whatMatch = block.match(/\*\*What was done:\*\*\s*(.+)/)
  const followUpLines = block.match(/\*\*Follow-ups:\*\*\s*\n((?:\s*-\s*.+\n?)+)/)

  // Extract bullet points (lines starting with "- " that aren't under Follow-ups)
  const lines = block.split('\n')
  const keyFindings: string[] = []
  let inFollowUps = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('**Follow-ups:**')) { inFollowUps = true; continue }
    if (trimmed.startsWith('**')) { inFollowUps = false; continue }
    if (trimmed.startsWith('- ') && !inFollowUps) {
      keyFindings.push(trimmed.slice(2).trim())
    }
  }

  const followUps: string[] = []
  if (followUpLines) {
    for (const line of followUpLines[1].split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('- ')) followUps.push(trimmed.slice(2).trim())
    }
  }

  if (!statusMatch && !whatMatch && keyFindings.length === 0) return null

  return {
    status: (statusMatch?.[1]?.toLowerCase() as 'success' | 'partial' | 'failure') || undefined,
    workCompleted: whatMatch?.[1]?.trim(),
    keyFindings: keyFindings.length > 0 ? keyFindings : undefined,
    followUps: followUps.length > 0 ? followUps : undefined,
  }
}

/**
 * Format a parsed executive summary into a PR-friendly string.
 */
function formatParsedSummary(parsed: Partial<ExecutionSummary>): string {
  const parts: string[] = []

  if (parsed.status) {
    parts.push(`**Status:** ${parsed.status}`)
  }

  if (parsed.workCompleted) {
    parts.push(`\n${parsed.workCompleted}`)
  }

  if (parsed.keyFindings && parsed.keyFindings.length > 0) {
    parts.push('\n### Key Changes')
    for (const finding of parsed.keyFindings) {
      parts.push(`- ${finding}`)
    }
  }

  if (parsed.followUps && parsed.followUps.length > 0) {
    parts.push('\n### Follow-ups')
    for (const followUp of parsed.followUps) {
      parts.push(`- ${followUp}`)
    }
  }

  return parts.join('\n')
}

/**
 * Generate a summary from git diff and commit log context.
 */
function generateGitDiffSummary(gitContext: GitDiffContext, taskTitle: string): string | null {
  const { commitMessages, filesChanged, branchName } = gitContext

  // Need at least some git context to generate a summary
  if ((!commitMessages || commitMessages.length === 0) &&
      (!filesChanged || filesChanged.length === 0)) {
    return null
  }

  const parts: string[] = []

  // Add task context
  parts.push(`## Summary\n\nImplementation of: **${taskTitle}**`)

  // Add branch info if available
  if (branchName) {
    parts.push(`\nBranch: \`${branchName}\``)
  }

  // Summarize commits
  if (commitMessages && commitMessages.length > 0) {
    parts.push('\n### Commits')
    for (const msg of commitMessages.slice(0, 10)) { // Limit to 10 commits
      // Use first line of commit message
      const firstLine = msg.split('\n')[0].trim()
      if (firstLine) {
        parts.push(`- ${firstLine}`)
      }
    }
    if (commitMessages.length > 10) {
      parts.push(`- ... and ${commitMessages.length - 10} more commits`)
    }
  }

  // Summarize file changes
  if (filesChanged && filesChanged.length > 0) {
    const created = filesChanged.filter(f => f.action === 'create')
    const modified = filesChanged.filter(f => f.action === 'modify')
    const deleted = filesChanged.filter(f => f.action === 'delete')

    const totalAdded = filesChanged.reduce((sum, f) => sum + (f.linesAdded || 0), 0)
    const totalRemoved = filesChanged.reduce((sum, f) => sum + (f.linesRemoved || 0), 0)

    parts.push('\n### Files Changed')
    parts.push(`${filesChanged.length} files: +${totalAdded} -${totalRemoved} lines`)

    if (created.length > 0) {
      parts.push(`\n**Added (${created.length}):**`)
      for (const f of created.slice(0, 5)) {
        parts.push(`- \`${f.path}\``)
      }
      if (created.length > 5) {
        parts.push(`- ... and ${created.length - 5} more`)
      }
    }

    if (modified.length > 0) {
      parts.push(`\n**Modified (${modified.length}):**`)
      for (const f of modified.slice(0, 5)) {
        const stats = f.linesAdded || f.linesRemoved
          ? ` (+${f.linesAdded || 0} -${f.linesRemoved || 0})`
          : ''
        parts.push(`- \`${f.path}\`${stats}`)
      }
      if (modified.length > 5) {
        parts.push(`- ... and ${modified.length - 5} more`)
      }
    }

    if (deleted.length > 0) {
      parts.push(`\n**Deleted (${deleted.length}):**`)
      for (const f of deleted.slice(0, 5)) {
        parts.push(`- \`${f.path}\``)
      }
      if (deleted.length > 5) {
        parts.push(`- ... and ${deleted.length - 5} more`)
      }
    }
  }

  return parts.join('\n')
}

/**
 * Run the 5-layer PR summary fallback chain.
 *
 * The chain tries each layer in order and returns the first successful result:
 * 1. Structured JSON summary from TaskResult.summary (if has executiveSummary)
 * 2. Parse in-stream executive summary from output text
 * 3. Call server-side summary generation (Anthropic API)
 * 4. Generate git diff + commit log summary
 * 5. Fall back to raw task description
 *
 * @param input - Chain input containing task result, output, git context, etc.
 * @returns Promise resolving to summary string and its source
 */
export async function runPrSummaryFallbackChain(
  input: PrSummaryChainInput
): Promise<PrSummaryResult> {
  const {
    taskResult,
    executionOutput,
    taskTitle,
    taskDescription,
    fileChanges,
    gitContext,
    apiKey,
    status,
  } = input

  // Layer 1: Structured JSON summary from TaskResult.summary
  if (taskResult?.summary?.workCompleted) {
    // Check if we have an executiveSummary (preferred) or can construct one
    const summary = taskResult.summary
    if (summary.executiveSummary) {
      console.log('[summary-utils] Using structured executiveSummary from TaskResult')
      return {
        summary: summary.executiveSummary,
        source: 'structured',
      }
    }

    // Construct from structured fields if executiveSummary is missing
    const parts: string[] = []
    parts.push(`**Status:** ${summary.status}`)
    parts.push(`\n${summary.workCompleted}`)

    if (summary.keyFindings && summary.keyFindings.length > 0) {
      parts.push('\n### Key Changes')
      for (const finding of summary.keyFindings) {
        parts.push(`- ${finding}`)
      }
    }

    if (summary.filesChanged && summary.filesChanged.length > 0) {
      parts.push(`\n### Files Changed (${summary.filesChanged.length})`)
      for (const file of summary.filesChanged.slice(0, 10)) {
        parts.push(`- \`${file}\``)
      }
      if (summary.filesChanged.length > 10) {
        parts.push(`- ... and ${summary.filesChanged.length - 10} more`)
      }
    }

    if (summary.followUps && summary.followUps.length > 0) {
      parts.push('\n### Follow-ups')
      for (const followUp of summary.followUps) {
        parts.push(`- ${followUp}`)
      }
    }

    console.log('[summary-utils] Using structured summary fields from TaskResult')
    return {
      summary: parts.join('\n'),
      source: 'structured',
    }
  }

  // Layer 2: Parse in-stream executive summary from output text
  if (executionOutput) {
    const parsed = parseExecutiveSummaryFromOutput(executionOutput)
    if (parsed && (parsed.workCompleted || (parsed.keyFindings && parsed.keyFindings.length > 0))) {
      console.log('[summary-utils] Using parsed executive summary from output')
      return {
        summary: formatParsedSummary(parsed),
        source: 'parsed',
      }
    }
  }

  // Layer 3: Server-side summary generation via Anthropic API
  if (executionOutput && executionOutput.length > 100) {
    console.log('[summary-utils] Attempting server-side summary generation')
    const serverSummary = await generateServerSideSummary(
      {
        taskTitle,
        taskDescription,
        executionOutput,
        fileChanges: fileChanges || [],
        status: status || 'success',
      },
      apiKey
    )

    if (serverSummary) {
      // Format the server-generated summary
      const parts: string[] = []
      parts.push(`**Status:** ${serverSummary.status}`)
      parts.push(`\n${serverSummary.workCompleted}`)

      if (serverSummary.executiveSummary) {
        // Use the executiveSummary directly if available
        console.log('[summary-utils] Using server-generated executiveSummary')
        return {
          summary: serverSummary.executiveSummary,
          source: 'server_generated',
        }
      }

      if (serverSummary.keyFindings && serverSummary.keyFindings.length > 0) {
        parts.push('\n### Key Changes')
        for (const finding of serverSummary.keyFindings) {
          parts.push(`- ${finding}`)
        }
      }

      if (serverSummary.followUps && serverSummary.followUps.length > 0) {
        parts.push('\n### Follow-ups')
        for (const followUp of serverSummary.followUps) {
          parts.push(`- ${followUp}`)
        }
      }

      console.log('[summary-utils] Using server-generated summary')
      return {
        summary: parts.join('\n'),
        source: 'server_generated',
      }
    }
  }

  // Layer 4: Git diff + commit log summary
  if (gitContext) {
    const gitSummary = generateGitDiffSummary(gitContext, taskTitle)
    if (gitSummary) {
      console.log('[summary-utils] Using git diff summary')
      return {
        summary: gitSummary,
        source: 'git_diff',
      }
    }
  }

  // Layer 5: Fall back to raw task description
  console.log('[summary-utils] Falling back to task description')
  const fallbackSummary = `## Summary\n\n**Task:** ${taskTitle}\n\n${taskDescription}`
  return {
    summary: fallbackSummary,
    source: 'task_description',
  }
}
