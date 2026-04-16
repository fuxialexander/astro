/**
 * Build citation context for LLM system prompts.
 *
 * When a user sends a chat message containing [@key] citation markers,
 * this module expands them into full metadata so the LLM has context
 * about the cited papers.
 */

import type { Reference } from './types'
import { extractCiteKeys } from './parser'

/**
 * Build a citation context block for injection into system prompts.
 * Returns a formatted string with full reference metadata, or empty string
 * if no valid citations are found.
 */
export function buildCitationContext(
  message: string,
  references: Reference[],
): string {
  const keys = extractCiteKeys(message)
  if (keys.length === 0) return ''

  const refMap = new Map(references.map(r => [r.id, r]))
  const citedRefs = keys
    .map(key => refMap.get(key))
    .filter((r): r is Reference => r !== undefined)

  if (citedRefs.length === 0) return ''

  const entries = citedRefs.map(ref => {
    const parts: string[] = []
    parts.push(`  - **[@${ref.id}]**: "${ref.title}"`)
    parts.push(`    Authors: ${ref.authors.join(', ')}`)
    parts.push(`    Year: ${ref.year}`)
    if (ref.venue) parts.push(`    Venue: ${ref.venue}`)
    if (ref.doi) parts.push(`    DOI: ${ref.doi}`)
    if (ref.abstract) parts.push(`    Abstract: ${ref.abstract}`)
    if (ref.url) parts.push(`    URL: ${ref.url}`)
    return parts.join('\n')
  })

  return `\n## Cited References\n\nThe user's message references the following papers. Use this metadata to provide informed, citation-aware responses:\n\n${entries.join('\n\n')}\n`
}

/**
 * Expand citation markers in a message for the LLM.
 * Appends reference metadata as a context block at the end of the message.
 */
export function expandCitationsForLLM(
  message: string,
  references: Reference[],
): string {
  const context = buildCitationContext(message, references)
  if (!context) return message

  return `${message}\n\n---\n${context}`
}
