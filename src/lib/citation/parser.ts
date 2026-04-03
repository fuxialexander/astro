/**
 * Parse [@citekey] markers from text.
 *
 * Supports:
 *   - Single citations: [@smith2024]
 *   - Multiple citations: [@smith2024; @jones2023]
 *   - Inline text references for rendering
 */

import type { CitationMarker } from './types'

/** Regex to match [@key] citation markers. Keys may contain alphanumeric, hyphens, underscores. */
const CITATION_REGEX = /\[@([\w-]+(?:\s*;\s*@[\w-]+)*)\]/g

/**
 * Extract all citation markers from a text string.
 * Returns them in order of appearance.
 */
export function parseCitations(text: string): CitationMarker[] {
  const markers: CitationMarker[] = []
  let match: RegExpExecArray | null

  // Reset regex state
  CITATION_REGEX.lastIndex = 0

  while ((match = CITATION_REGEX.exec(text)) !== null) {
    const fullMatch = match[0]
    const inner = match[1]
    const start = match.index
    const end = start + fullMatch.length

    // Split on semicolons for multi-cite markers like [@a; @b]
    const keys = inner.split(/\s*;\s*/).map(k => k.replace(/^@/, '').trim()).filter(Boolean)

    for (const key of keys) {
      markers.push({ key, start, end })
    }
  }

  return markers
}

/**
 * Extract unique citation keys from text.
 */
export function extractCiteKeys(text: string): string[] {
  const markers = parseCitations(text)
  return [...new Set(markers.map(m => m.key))]
}

/**
 * Check if text contains any citation markers.
 */
export function hasCitations(text: string): boolean {
  CITATION_REGEX.lastIndex = 0
  return CITATION_REGEX.test(text)
}

/**
 * Replace citation markers in text with formatted inline citations.
 * The replacer function receives the cite key and returns the replacement string.
 */
export function replaceCitations(
  text: string,
  replacer: (key: string, index: number) => string
): string {
  let counter = 0
  CITATION_REGEX.lastIndex = 0
  return text.replace(CITATION_REGEX, (_fullMatch, inner: string) => {
    const keys = inner.split(/\s*;\s*/).map((k: string) => k.replace(/^@/, '').trim()).filter(Boolean)
    const formatted = keys.map(key => {
      const result = replacer(key, counter)
      counter++
      return result
    })
    return formatted.join('; ')
  })
}
