import { BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Reference } from '@/lib/citation/types'

export interface CitationDropdownContentProps {
  refs: Reference[]
  selectedIndex: number
  onSelect: (ref: Reference) => void
  onHover?: (index: number) => void
  /** Use onMouseDown instead of onClick (needed for textareas to prevent blur) */
  useMouseDown?: boolean
}

export function CitationDropdownContent({
  refs,
  selectedIndex,
  onSelect,
  onHover,
  useMouseDown = false,
}: CitationDropdownContentProps) {
  if (refs.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        No matching references found
      </div>
    )
  }

  return (
    <>
      {refs.map((ref, i) => {
        const firstAuthor = ref.authors[0]?.split(',')[0]?.split(' ').pop() || ref.authors[0] || 'Unknown'
        const etAl = ref.authors.length > 1 ? ' et al.' : ''
        const handlers = useMouseDown
          ? {
              onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); onSelect(ref) },
              onMouseEnter: () => onHover?.(i),
            }
          : {
              onClick: () => onSelect(ref),
              onMouseEnter: () => onHover?.(i),
            }

        return (
          <button
            key={ref.id}
            type="button"
            className={cn(
              'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-xs cursor-pointer',
              'hover:bg-accent hover:text-accent-foreground transition-colors',
              i === selectedIndex && 'bg-accent text-accent-foreground',
            )}
            {...handlers}
          >
            <div className="flex items-center gap-1.5">
              <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="font-medium truncate min-w-0">{ref.title}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground pl-[18px]">
              <span>{firstAuthor}{etAl}</span>
              <span>{ref.year}</span>
              {ref.venue && (
                <span className="truncate italic">
                  {ref.venue.length > 30 ? ref.venue.slice(0, 29) + '\u2026' : ref.venue}
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground/60 pl-[18px] font-mono">
              @{ref.id}
            </div>
          </button>
        )
      })}
    </>
  )
}
