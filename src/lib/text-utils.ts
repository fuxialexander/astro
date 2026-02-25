/** Extract a concise title from a longer description. */
export function extractTitle(text: string, maxLength = 80): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (trimmed.length <= maxLength) return trimmed
  // First sentence (split by period or newline)
  const firstSentence = trimmed.split(/[.\n]/)[0].trim()
  if (firstSentence.length <= maxLength) return firstSentence
  // Truncate at word boundary
  return firstSentence.slice(0, maxLength).replace(/\s+\S*$/, '') + '...'
}

const WORD_THRESHOLD = 12

/**
 * Split user input into a concise title and a description.
 *
 * If the text has fewer than WORD_THRESHOLD words, both title and description
 * are set to the full text (short task, no split needed).
 *
 * For longer text the heuristic is:
 *  1. If there's a newline, the first line becomes the title.
 *  2. If there's a sentence break (period/colon followed by a space), the
 *     first sentence becomes the title.
 *  3. Otherwise, take the first ~8 words as the title.
 *
 * The description always contains the full original text so nothing is lost.
 */
export function splitTitleDescription(text: string): { title: string; description: string } {
  const trimmed = text.trim()
  if (!trimmed) return { title: '', description: '' }

  const words = trimmed.split(/\s+/)
  if (words.length < WORD_THRESHOLD) {
    return { title: trimmed, description: trimmed }
  }

  // Strategy 1: newline split
  const newlineIdx = trimmed.indexOf('\n')
  if (newlineIdx > 0) {
    const title = trimmed.slice(0, newlineIdx).trim()
    return { title: title.slice(0, 80), description: trimmed }
  }

  // Strategy 2: first sentence (period or colon followed by space)
  const sentenceMatch = trimmed.match(/^(.+?[.:])(\s)/)
  if (sentenceMatch && sentenceMatch[1].length <= 80) {
    return { title: sentenceMatch[1].trim(), description: trimmed }
  }

  // Strategy 3: first N words
  const title = words.slice(0, 8).join(' ')
  return { title: title.length <= 80 ? title : title.slice(0, 80), description: trimmed }
}
