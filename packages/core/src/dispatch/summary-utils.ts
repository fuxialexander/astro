/**
 * Server-side summary generation via Anthropic API (direct call).
 *
 * Uses buildSummaryPrompt() for prompt construction and calls claude-3-haiku
 * for a single-turn summary generation. This avoids the relay/agent-runner
 * round-trip for a simple structured-output task.
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

/** Source types for PR summary fallback chain */
export type PrSummarySource =
  | 'structured'
  | 'parsed'
  | 'server_generated'
  | 'git_diff'
  | 'task_description'

/** Result of PR summary fallback chain */
export interface PrSummaryResult {
  summary: string
  source: PrSummarySource
}

/** Input for PR summary fallback chain */
export interface PrSummaryInput {
  /** Task result from execution */
  taskResult?: TaskResult
  /** Raw execution output text (for parsing) */
  executionOutput?: string
  /** Task title */
  taskTitle: string
  /** Task description */
  taskDescription: string
  /** File changes for server-side summary generation */
  fileChanges?: Array<{ path: string; action: string }>
  /** Git diff output for diff-based summary */
  gitDiff?: string
  /** Git commit log for commit-based summary */
  gitCommitLog?: string
  /** Anthropic API key for server-side generation */
  apiKey?: string
  /** Whether to skip server-side generation (for testing/offline mode) */
  skipServerGeneration?: boolean
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

/**
 * Parse in-stream executive summary from execution output text.
 *
 * Looks for the `## Executive Summary` format that agents are instructed
 * to produce at the end of their output.
 *
 * @param output - Raw execution output text
 * @returns Parsed summary string, or null if not found
 */
export function parseInStreamExecutiveSummary(output: string): string | null {
  if (!output) return null

  // Pattern: ## Executive Summary followed by content until end or next ## heading
  // The format is:
  // ## Executive Summary
  // **Status:** success | partial | failure
  // **What was done:** One sentence describing the overall outcome.
  // - Key finding or change 1
  // - Key finding or change 2
  // **Follow-ups:**
  // - Suggested follow-up action

  const summaryMatch = output.match(
    /##\s*Executive\s+Summary\s*\n([\s\S]*?)(?:(?:\n##\s+)|$)/i
  )
  if (!summaryMatch) return null

  const rawContent = summaryMatch[1].trim()
  if (!rawContent) return null

  // Parse the structured format into a clean PR body format
  const lines = rawContent.split('\n')
  const result: string[] = []

  let status = ''
  let whatWasDone = ''
  const keyFindings: string[] = []
  const followUps: string[] = []
  let currentSection: 'main' | 'findings' | 'followups' = 'main'

  for (const line of lines) {
    const trimmed = line.trim()

    // Parse **Status:**
    const statusMatch = trimmed.match(/^\*\*Status:\*\*\s*(.+)/i)
    if (statusMatch) {
      status = statusMatch[1].trim()
      continue
    }

    // Parse **What was done:**
    const whatMatch = trimmed.match(/^\*\*What was done:\*\*\s*(.+)/i)
    if (whatMatch) {
      whatWasDone = whatMatch[1].trim()
      currentSection = 'findings'
      continue
    }

    // Parse **Follow-ups:**
    const followUpsMatch = trimmed.match(/^\*\*Follow-ups?:\*\*/i)
    if (followUpsMatch) {
      currentSection = 'followups'
      continue
    }

    // Parse bullet points
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/)
    if (bulletMatch) {
      if (currentSection === 'findings') {
        keyFindings.push(bulletMatch[1])
      } else if (currentSection === 'followups') {
        followUps.push(bulletMatch[1])
      }
    }
  }

  // Build formatted summary for PR body
  if (whatWasDone) {
    result.push(`## Summary`)
    result.push('')
    result.push(whatWasDone)
    result.push('')
  }

  if (keyFindings.length > 0) {
    result.push(`## Changes`)
    result.push('')
    for (const finding of keyFindings) {
      result.push(`- ${finding}`)
    }
    result.push('')
  }

  if (followUps.length > 0) {
    result.push(`## Follow-ups`)
    result.push('')
    for (const followUp of followUps) {
      result.push(`- ${followUp}`)
    }
    result.push('')
  }

  // Add status badge if not success
  if (status && status !== 'success') {
    result.unshift(`> **Status:** ${status}`)
    result.unshift('')
  }

  const finalSummary = result.join('\n').trim()
  return finalSummary || null
}

/**
 * Generate a summary from git diff and commit log.
 *
 * Creates a simple summary by extracting key information from
 * the git diff (files changed) and commit messages.
 *
 * @param gitDiff - Git diff output
 * @param gitCommitLog - Git commit log
 * @returns Formatted summary string, or null if insufficient data
 */
export function generateGitDiffSummary(
  gitDiff?: string,
  gitCommitLog?: string
): string | null {
  if (!gitDiff && !gitCommitLog) return null

  const result: string[] = []

  // Extract files changed from diff
  if (gitDiff) {
    const filePattern = /^diff --git a\/(.+?) b\//gm
    const files: string[] = []
    let match
    while ((match = filePattern.exec(gitDiff)) !== null) {
      files.push(match[1])
    }

    // Count insertions/deletions
    const statsMatch = gitDiff.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/
    )

    result.push(`## Summary`)
    result.push('')
    result.push(`Changes made to ${files.length} file${files.length === 1 ? '' : 's'}.`)
    result.push('')

    if (files.length > 0 && files.length <= 20) {
      result.push(`## Files Changed`)
      result.push('')
      for (const file of files.slice(0, 20)) {
        result.push(`- \`${file}\``)
      }
      if (files.length > 20) {
        result.push(`- ... and ${files.length - 20} more files`)
      }
      result.push('')
    }

    if (statsMatch) {
      const [, , insertions, deletions] = statsMatch
      const stats: string[] = []
      if (insertions) stats.push(`+${insertions}`)
      if (deletions) stats.push(`-${deletions}`)
      if (stats.length > 0) {
        result.push(`**Stats:** ${stats.join(', ')}`)
        result.push('')
      }
    }
  }

  // Extract commit messages
  if (gitCommitLog) {
    const commitPattern = /^commit [a-f0-9]+\n(?:Author:.+\n)?(?:Date:.+\n)?\n\s*(.+)/gm
    const commits: string[] = []
    let match
    while ((match = commitPattern.exec(gitCommitLog)) !== null) {
      const message = match[1].trim()
      if (message && !message.startsWith('Merge')) {
        commits.push(message)
      }
    }

    // Alternative simpler pattern for one-line log format
    if (commits.length === 0) {
      // Use a new regex each time to avoid state issues
      const lines = gitCommitLog.split('\n')
      for (const line of lines) {
        const simpleMatch = line.match(/^[a-f0-9]+\s+(.+)$/)
        if (simpleMatch) {
          const message = simpleMatch[1].trim()
          if (message && !message.startsWith('Merge')) {
            commits.push(message)
          }
        }
      }
    }

    if (commits.length > 0) {
      result.push(`## Commits`)
      result.push('')
      for (const commit of commits.slice(0, 10)) {
        result.push(`- ${commit}`)
      }
      if (commits.length > 10) {
        result.push(`- ... and ${commits.length - 10} more commits`)
      }
      result.push('')
    }
  }

  const finalSummary = result.join('\n').trim()
  return finalSummary || null
}

/**
 * Format structured ExecutionSummary into PR body format.
 *
 * @param summary - ExecutionSummary object
 * @returns Formatted markdown string for PR body
 */
export function formatStructuredSummary(
  summary: NonNullable<TaskResult['summary']>
): string {
  const result: string[] = []

  // Add status if not success
  if (summary.status && summary.status !== 'success') {
    result.push(`> **Status:** ${summary.status}`)
    result.push('')
  }

  result.push(`## Summary`)
  result.push('')
  result.push(summary.workCompleted)
  result.push('')

  if (summary.keyFindings && summary.keyFindings.length > 0) {
    result.push(`## Changes`)
    result.push('')
    for (const finding of summary.keyFindings) {
      result.push(`- ${finding}`)
    }
    result.push('')
  }

  if (summary.filesChanged && summary.filesChanged.length > 0) {
    result.push(`## Files Changed`)
    result.push('')
    for (const file of summary.filesChanged.slice(0, 20)) {
      result.push(`- \`${file}\``)
    }
    if (summary.filesChanged.length > 20) {
      result.push(`- ... and ${summary.filesChanged.length - 20} more files`)
    }
    result.push('')
  }

  if (summary.followUps && summary.followUps.length > 0) {
    result.push(`## Follow-ups`)
    result.push('')
    for (const followUp of summary.followUps) {
      result.push(`- ${followUp}`)
    }
    result.push('')
  }

  return result.join('\n').trim()
}

/**
 * Run the 5-layer PR summary fallback chain.
 *
 * Attempts to generate a PR body summary using multiple strategies,
 * falling back to the next layer if the current one fails or produces
 * insufficient content.
 *
 * **Fallback Chain:**
 * 1. **Structured** - Use TaskResult.summary if available with executiveSummary
 * 2. **Parsed** - Parse in-stream executive summary from output text
 * 3. **Server Generated** - Call Anthropic API to generate summary
 * 4. **Git Diff** - Generate summary from git diff + commit log
 * 5. **Task Description** - Fall back to raw task description
 *
 * @param input - PrSummaryInput with task result, output, and context
 * @returns PrSummaryResult with summary string and source identifier
 */
export async function runPrSummaryFallbackChain(
  input: PrSummaryInput
): Promise<PrSummaryResult> {
  // Layer 1: Structured JSON summary from TaskResult.summary
  if (input.taskResult?.summary) {
    const summary = input.taskResult.summary
    // Check if we have an executiveSummary in the ExecutionSummary type
    // The TaskResult.summary type doesn't have executiveSummary, but ExecutionSummary does
    // Check workCompleted as a proxy for having meaningful content
    if (summary.workCompleted && summary.workCompleted.length > 0) {
      const formatted = formatStructuredSummary(summary)
      if (formatted.length > 50) {
        return { summary: formatted, source: 'structured' }
      }
    }
  }

  // Layer 2: Parse in-stream executive summary from output text
  const outputText = input.executionOutput ?? input.taskResult?.stdout
  if (outputText) {
    const parsed = parseInStreamExecutiveSummary(outputText)
    if (parsed && parsed.length > 50) {
      return { summary: parsed, source: 'parsed' }
    }
  }

  // Layer 3: Server-side summary generation via Anthropic API
  if (!input.skipServerGeneration && outputText) {
    const serverSummary = await generateServerSideSummary(
      {
        taskTitle: input.taskTitle,
        taskDescription: input.taskDescription,
        executionOutput: outputText,
        fileChanges: input.fileChanges ?? [],
        status: input.taskResult?.status === 'failure' ? 'failure' : 'success',
      },
      input.apiKey
    )

    if (serverSummary) {
      const formatted = formatStructuredSummary({
        status: serverSummary.status,
        workCompleted: serverSummary.workCompleted,
        keyFindings: serverSummary.keyFindings,
        filesChanged: serverSummary.filesChanged,
        followUps: serverSummary.followUps,
      })
      if (formatted.length > 50) {
        return { summary: formatted, source: 'server_generated' }
      }
    }
  }

  // Layer 4: Git diff + commit log summary
  if (input.gitDiff || input.gitCommitLog) {
    const gitSummary = generateGitDiffSummary(input.gitDiff, input.gitCommitLog)
    if (gitSummary && gitSummary.length > 50) {
      return { summary: gitSummary, source: 'git_diff' }
    }
  }

  // Layer 5: Fall back to raw task description
  const fallbackSummary = [
    `## Summary`,
    '',
    `**Task:** ${input.taskTitle}`,
    '',
    input.taskDescription,
  ].join('\n')

  return { summary: fallbackSummary, source: 'task_description' }
}
