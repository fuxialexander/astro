/**
 * Citation References Section.
 *
 * Renders a formatted bibliography at the bottom of messages
 * that contain citation markers ([@key]).
 */

import { memo, useMemo } from 'react'
import { BookOpen, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { extractCiteKeys } from '@/lib/citation/parser'
import { formatReference } from '@/lib/citation/formatter'
import type { Reference, CitationStyle } from '@/lib/citation/types'

interface CitationReferencesProps {
  /** The text content that may contain [@key] citations */
  text: string
  /** All available references for this project */
  references: Reference[]
  /** Citation formatting style */
  style: CitationStyle
  /** Additional CSS classes */
  className?: string
}

/**
 * Renders a collapsible references section for cited papers.
 * Only renders if the text contains valid citation markers.
 */
export const CitationReferences = memo(({
  text,
  references,
  style,
  className,
}: CitationReferencesProps) => {
  const [expanded, setExpanded] = useState(true)

  const citedRefs = useMemo(() => {
    const keys = extractCiteKeys(text)
    if (keys.length === 0) return []

    const refMap = new Map(references.map(r => [r.id, r]))
    return keys
      .map(key => refMap.get(key))
      .filter((r): r is Reference => r !== undefined)
  }, [text, references])

  if (citedRefs.length === 0) return null

  return (
    <div className={cn(
      'mt-3 pt-2 border-t border-border/60',
      className
    )}>
      <button
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-1.5"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <BookOpen className="h-3 w-3" />
        References ({citedRefs.length})
      </button>

      {expanded && (
        <ol className="space-y-1.5 text-xs text-muted-foreground">
          {citedRefs.map((ref, i) => (
            <li key={ref.id} className="flex gap-2 group">
              {(style === 'nature' || style === 'ieee') && (
                <span className="shrink-0 font-mono text-muted-foreground/60 w-5 text-right">
                  {i + 1}.
                </span>
              )}
              <div className="min-w-0">
                <ReferenceEntry reference={ref} style={style} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
})

CitationReferences.displayName = 'CitationReferences'

/** A single formatted reference entry */
const ReferenceEntry = memo(({ reference, style }: { reference: Reference; style: CitationStyle }) => {
  const formatted = useMemo(() => formatReference(reference, style), [reference, style])

  // Parse the formatted string to render italic venue names properly
  // The formatter wraps venues in *asterisks* for markdown italic
  const parts = formatted.split(/(\*[^*]+\*)/g)

  return (
    <span className="leading-relaxed">
      {parts.map((part, i) => {
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>
        }
        return <span key={i}>{part}</span>
      })}
      {reference.doi && (
        <a
          href={`https://doi.org/${reference.doi}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 ml-1 text-info hover:underline"
          title={`DOI: ${reference.doi}`}
        >
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
      {!reference.doi && reference.url && (
        <a
          href={reference.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 ml-1 text-info hover:underline"
          title={reference.url}
        >
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </span>
  )
})

ReferenceEntry.displayName = 'ReferenceEntry'

