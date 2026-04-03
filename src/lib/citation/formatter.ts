/**
 * Pure-TypeScript citation formatter.
 *
 * Formats references in APA, Chicago, Nature, and IEEE styles.
 * This avoids the heavy WASM dependency of citeproc-rs while covering
 * the most common academic styles.
 */

import type { Reference, CitationStyle } from './types'

/** Format author list for display: "Smith, J., Jones, A. B., & Lee, C." */
function formatAuthorsAPA(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`
  if (authors.length <= 20) {
    return authors.slice(0, -1).join(', ') + ', & ' + authors[authors.length - 1]
  }
  // 21+ authors: first 19, ..., last
  return authors.slice(0, 19).join(', ') + ', ... ' + authors[authors.length - 1]
}

function formatAuthorsChicago(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`
  if (authors.length <= 10) {
    return authors.slice(0, -1).join(', ') + ', and ' + authors[authors.length - 1]
  }
  return authors.slice(0, 7).join(', ') + ', et al.'
}

function formatAuthorsNature(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  if (authors.length <= 5) return authors.join(', ')
  return authors.slice(0, 5).join(', ') + ' et al.'
}

function formatAuthorsIEEE(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`
  return authors.slice(0, -1).join(', ') + ', and ' + authors[authors.length - 1]
}

/**
 * Format a single reference as a full bibliography entry.
 */
export function formatReference(ref: Reference, style: CitationStyle): string {
  switch (style) {
    case 'apa':
      return formatAPA(ref)
    case 'chicago':
      return formatChicago(ref)
    case 'nature':
      return formatNature(ref)
    case 'ieee':
      return formatIEEE(ref)
    default:
      return formatAPA(ref)
  }
}

/** APA 7th Edition: Author, A. B. (Year). Title. *Venue*, vol(issue), pages. DOI */
function formatAPA(ref: Reference): string {
  const parts: string[] = []
  parts.push(`${formatAuthorsAPA(ref.authors)} (${ref.year}).`)
  parts.push(`${ref.title}.`)
  if (ref.venue) {
    let venueStr = `*${ref.venue}*`
    if (ref.volume) {
      venueStr += `, *${ref.volume}*`
      if (ref.issue) venueStr += `(${ref.issue})`
    }
    if (ref.pages) venueStr += `, ${ref.pages}`
    parts.push(venueStr + '.')
  }
  if (ref.doi) parts.push(`https://doi.org/${ref.doi}`)
  return parts.join(' ')
}

/** Chicago Author-Date: Author. Year. "Title." *Venue* vol, no. issue: pages. */
function formatChicago(ref: Reference): string {
  const parts: string[] = []
  parts.push(`${formatAuthorsChicago(ref.authors)}.`)
  parts.push(`${ref.year}.`)
  parts.push(`"${ref.title}."`)
  if (ref.venue) {
    let venueStr = `*${ref.venue}*`
    if (ref.volume) {
      venueStr += ` ${ref.volume}`
      if (ref.issue) venueStr += `, no. ${ref.issue}`
    }
    if (ref.pages) venueStr += `: ${ref.pages}`
    parts.push(venueStr + '.')
  }
  if (ref.doi) parts.push(`https://doi.org/${ref.doi}.`)
  return parts.join(' ')
}

/** Nature style: Author, A. B. et al. Title. *Venue* **vol**, pages (year). */
function formatNature(ref: Reference): string {
  const parts: string[] = []
  parts.push(formatAuthorsNature(ref.authors))
  parts.push(`${ref.title}.`)
  if (ref.venue) {
    let venueStr = `*${ref.venue}*`
    if (ref.volume) venueStr += ` **${ref.volume}**`
    if (ref.pages) venueStr += `, ${ref.pages}`
    venueStr += ` (${ref.year}).`
    parts.push(venueStr)
  } else {
    parts.push(`(${ref.year}).`)
  }
  if (ref.doi) parts.push(`https://doi.org/${ref.doi}`)
  return parts.join(' ')
}

/** IEEE: A. B. Author, "Title," *Venue*, vol. V, no. I, pp. P, Year. */
function formatIEEE(ref: Reference): string {
  const parts: string[] = []
  parts.push(`${formatAuthorsIEEE(ref.authors)},`)
  parts.push(`"${ref.title},"`)
  if (ref.venue) {
    let venueStr = `*${ref.venue}*`
    if (ref.volume) venueStr += `, vol. ${ref.volume}`
    if (ref.issue) venueStr += `, no. ${ref.issue}`
    if (ref.pages) venueStr += `, pp. ${ref.pages}`
    parts.push(venueStr + `,`)
  }
  parts.push(`${ref.year}.`)
  if (ref.doi) parts.push(`doi: ${ref.doi}.`)
  return parts.join(' ')
}

/**
 * Format an inline citation (the short form that appears in text).
 * Returns e.g. "(Smith, 2024)" for APA or "[1]" for IEEE.
 */
export function formatInlineCitation(
  ref: Reference,
  style: CitationStyle,
  index?: number
): string {
  const firstAuthor = ref.authors[0]?.split(',')[0]?.split(' ').pop() || 'Unknown'
  const etAl = ref.authors.length > 2 ? ' et al.' : ref.authors.length === 2 ? ` & ${ref.authors[1]?.split(',')[0]?.split(' ').pop()}` : ''

  switch (style) {
    case 'apa':
    case 'chicago':
      return `(${firstAuthor}${etAl}, ${ref.year})`
    case 'nature':
      return index !== undefined ? `<sup>${index + 1}</sup>` : `<sup>[?]</sup>`
    case 'ieee':
      return index !== undefined ? `[${index + 1}]` : '[?]'
    default:
      return `(${firstAuthor}, ${ref.year})`
  }
}

/**
 * Format multiple references as a bibliography section (markdown).
 */
export function formatBibliography(
  refs: Reference[],
  style: CitationStyle
): string {
  if (refs.length === 0) return ''

  const lines = refs.map((ref, i) => {
    const formatted = formatReference(ref, style)
    if (style === 'nature' || style === 'ieee') {
      return `${i + 1}. ${formatted}`
    }
    return `- ${formatted}`
  })

  return lines.join('\n')
}

/**
 * Inline citation renderer — replaces [@key] markers with formatted inline citations.
 * Used inside markdown text to render (Author, Year) or [1] style citations.
 */
export function renderInlineCitations(
  text: string,
  references: Reference[],
  style: CitationStyle,
): string {
  const refMap = new Map(references.map(r => [r.id, r]))
  const orderedKeys: string[] = []

  // Build ordered list for numbered styles
  const keyRegex = /\[@([\w-]+(?:\s*;\s*@[\w-]+)*)\]/g
  let m: RegExpExecArray | null
  while ((m = keyRegex.exec(text)) !== null) {
    const keys = m[1].split(/\s*;\s*/).map(k => k.replace(/^@/, '').trim())
    for (const key of keys) {
      if (!orderedKeys.includes(key)) orderedKeys.push(key)
    }
  }

  return text.replace(/\[@([\w-]+(?:\s*;\s*@[\w-]+)*)\]/g, (_match, inner: string) => {
    const keys = inner.split(/\s*;\s*/).map((k: string) => k.replace(/^@/, '').trim())
    const citations = keys.map(key => {
      const ref = refMap.get(key)
      if (!ref) return `[@${key}]` // unresolved — leave as-is
      const index = orderedKeys.indexOf(key)
      return formatInlineCitation(ref, style, index >= 0 ? index : undefined)
    })
    return citations.join('; ')
  })
}
