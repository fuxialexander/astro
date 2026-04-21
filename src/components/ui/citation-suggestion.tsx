import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { Reference } from '@/lib/citation/types'
import { CitationDropdownContent } from './citation-dropdown-content'

export interface CitationSuggestionItem {
  id: string
  label: string
  ref: Reference
}

export interface CitationSuggestionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface CitationSuggestionProps {
  items: CitationSuggestionItem[]
  command: (item: CitationSuggestionItem) => void
}

export const CitationSuggestion = forwardRef<CitationSuggestionRef, CitationSuggestionProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          if (items[selectedIndex]) command(items[selectedIndex])
          return true
        }
        return false
      },
    }))

    return (
      <div className="rounded-md border border-border bg-popover shadow-md max-h-[320px] overflow-y-auto min-w-[280px]">
        <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-popover">
          References
        </div>
        <CitationDropdownContent
          refs={items.map((i) => i.ref)}
          selectedIndex={selectedIndex}
          onSelect={(refObj) => {
            const item = items.find((i) => i.ref === refObj)
            if (item) command(item)
          }}
          onHover={setSelectedIndex}
        />
      </div>
    )
  }
)

CitationSuggestion.displayName = 'CitationSuggestion'
