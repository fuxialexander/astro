/**
 * Haiku retry fallback for plan JSON extraction.
 *
 * When regex-based extraction fails (malformed/truncated output),
 * this sends the accumulated text to Haiku for structured extraction.
 * Non-blocking — returns null on any error.
 */

import Anthropic from '@anthropic-ai/sdk'
import { extractPlanJsonFromText, type PlanJsonResult } from './plan-extraction.js'

const MAX_INPUT_CHARS = 200_000 // Truncate to last 200K chars (plan is at the end)
const TIMEOUT_MS = 30_000

export async function retryPlanExtractionWithHaiku(
  text: string,
  apiKey?: string,
): Promise<PlanJsonResult | null> {
  if (!apiKey) return null

  try {
    const truncated = text.length > MAX_INPUT_CHARS
      ? text.slice(-MAX_INPUT_CHARS)
      : text

    const client = new Anthropic({ apiKey })

    const response = await Promise.race([
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16384,
        messages: [{
          role: 'user',
          content: `Extract the project plan JSON from the following text. Output ONLY the JSON object with projectName, nodes, edges. No explanation, no markdown fences, just the raw JSON.\n\n${truncated}`,
        }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Haiku retry timed out')), TIMEOUT_MS)
      ),
    ])

    // Extract text from the response
    const responseText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')

    if (!responseText) return null

    // Feed through extractPlanJsonFromText for robust parsing
    return extractPlanJsonFromText(responseText)
  } catch (err) {
    console.warn('[plan-extraction-retry] Haiku retry failed:', err instanceof Error ? err.message : err)
    return null
  }
}
