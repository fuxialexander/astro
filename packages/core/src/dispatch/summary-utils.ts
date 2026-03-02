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
