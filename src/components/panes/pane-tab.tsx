/**
 * PaneTab — custom dockview tab header matching Claude Code panel aesthetic.
 *
 * Compact 30px header with title on the left and a hover-reveal close button
 * on the right. The active tab gets full foreground color; inactive tabs are
 * muted.
 */
import { X } from 'lucide-react'
import type { IDockviewPanelHeaderProps } from 'dockview'
import { cn } from '@/lib/utils'

export function PaneTab({ api }: IDockviewPanelHeaderProps) {
  const title = api.title
  return (
    <div
      className={cn(
        'group flex h-full items-center gap-1.5 px-3 select-none',
        'text-[11px] font-medium tracking-wide',
      )}
    >
      <span className="truncate max-w-[140px] text-muted-foreground group-[[data-active-tab]]:text-foreground">
        {title}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          api.close()
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'flex shrink-0 items-center justify-center rounded w-3.5 h-3.5',
          'text-muted-foreground/0 hover:text-foreground hover:bg-muted/70',
          'group-hover:text-muted-foreground/60',
          'transition-colors duration-100',
        )}
        title="Close panel"
      >
        <X size={9} strokeWidth={2.5} />
      </button>
    </div>
  )
}

