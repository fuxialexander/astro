/**
 * Citation autocomplete dropdown.
 *
 * Renders a searchable list of references when the user types [@
 * inside a textarea. Used by FileCompletionTextarea.
 */

import { memo } from 'react'
import { BookOpen, User, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Reference } from '@/lib/citation/types'

interface CitationAutocompleteProps {
  references: Reference[]
  selectedIndex: number
  onSelect: (ref: Reference) => void
  className?: string
}

/** Truncate text to maxLen characters with ellipsis */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '\u2026'
}

/** Format author names for dropdown display */
function formatAuthorsShort(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  const first = authors[0].split(',')[0]?.split(' ').pop() || authors[0]
  if (authors.length === 1) return first
  if (authors.length === 2) {
    const second = authors[1].split(',')[0]?.split(' ').pop() || authors[1]
    return `${first} & ${second}`
  }
  return `${first} et al.`
}

export const CitationAutocomplete = memo(({
  references,
  selectedIndex,
  onSelect,
  className,
}: CitationAutocompleteProps) => {
  if (references.length === 0) {
    return (
      <div className={cn(
        'rounded-md border bg-popover p-2 text-xs text-muted-foreground shadow-md',
        className
      )}>
        No references found. Add references in project settings.
      </div>
    )
  }

  return (
    <div className={cn(
      'max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md',
      className
    )}>
      <div className="p-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b px-2">
        References
      </div>
      {references.map((ref, i) => (
        <button
          key={ref.id}
          className={cn(
            'w-full text-left px-2 py-1.5 text-xs flex flex-col gap-0.5 border-b border-border/50 last:border-0',
            'hover:bg-accent/50 transition-colors',
            i === selectedIndex && 'bg-accent text-accent-foreground',
          )}
          onMouseDown={(e) => {
            e.preventDefault() // prevent textarea blur
            onSelect(ref)
          }}
        >
          <div className="flex items-center gap-1.5">
            <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="font-medium truncate">{truncate(ref.title, 60)}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground pl-[18px]">
            <span className="flex items-center gap-0.5">
              <User className="h-2.5 w-2.5" />
              {formatAuthorsShort(ref.authors)}
            </span>
            <span className="flex items-center gap-0.5">
              <Calendar className="h-2.5 w-2.5" />
              {ref.year}
            </span>
            {ref.venue && (
              <span className="truncate italic">{truncate(ref.venue, 30)}</span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground/60 pl-[18px] font-mono">
            @{ref.id}
          </div>
        </button>
      ))}
    </div>
  )
})

CitationAutocomplete.displayName = 'CitationAutocomplete'
