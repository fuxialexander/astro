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
