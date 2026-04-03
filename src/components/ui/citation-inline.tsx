/**
 * Inline citation marker component.
 *
 * Renders [@key] markers as styled inline elements with tooltips
 * showing the full reference.
 */

import { memo, useMemo } from 'react'
import type { Reference, CitationStyle } from '@/lib/citation/types'
import { formatInlineCitation } from '@/lib/citation/formatter'

interface CitationInlineProps {
  /** The cite key */
  citeKey: string
  /** The resolved reference (if found) */
  reference?: Reference
  /** Citation style */
  style: CitationStyle
  /** Ordered index for numbered styles */
  index?: number
}

export const CitationInline = memo(({
  citeKey,
  reference,
  style,
  index,
}: CitationInlineProps) => {
  const inlineText = useMemo(
    () => reference ? formatInlineCitation(reference, style, index) : '',
    [reference, style, index]
  )

  const tooltip = reference
    ? `${reference.title}\n${reference.authors.join(', ')} (${reference.year})${reference.venue ? `\n${reference.venue}` : ''}`
    : `Unresolved citation: ${citeKey}`

  if (!reference) {
    // Unresolved citation — show as-is with warning style
    return (
      <span
        className="inline-flex items-center px-0.5 rounded text-[10px] font-mono bg-destructive/10 text-destructive border border-destructive/20"
        title={tooltip}
      >
        [@{citeKey}]
      </span>
    )
  }

  // For nature/ieee style, render as superscript or bracketed number
  if (style === 'nature') {
    return (
      <sup
        className="inline-flex items-center text-[9px] text-info cursor-help"
        title={tooltip}
      >
        {index !== undefined ? index + 1 : '?'}
      </sup>
    )
  }

  if (style === 'ieee') {
    return (
      <span
        className="inline-flex items-center text-[10px] text-info cursor-help"
        title={tooltip}
      >
        [{index !== undefined ? index + 1 : '?'}]
      </span>
    )
  }

  // APA / Chicago: (Author, Year)
  return (
    <span
      className="inline-flex items-center px-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 cursor-help"
      title={tooltip}
    >
      {inlineText}
    </span>
  )
})

CitationInline.displayName = 'CitationInline'
