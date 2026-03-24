/**
 * PanelHeader — consistent header bar for sidebar and review panels.
 *
 * Shows a title on the left, a collapse button on the right, and an
 * optional slot for extra action buttons.
 */
import type { ReactNode } from 'react'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { cn } from '@desktop/lib/utils'

interface PanelHeaderProps {
  title: string
  /** Which side the collapse button should point toward */
  side?: 'left' | 'right'
  onCollapse?: () => void
  /** Extra buttons rendered to the left of the collapse button */
  actions?: ReactNode
  className?: string
}

export function PanelHeader({
  title,
  side = 'left',
  onCollapse,
  actions,
  className,
}: PanelHeaderProps) {
  const CollapseIcon = side === 'left' ? PanelLeftClose : PanelRightClose

  return (
    <div
      className={cn(
        'flex items-center h-10 px-3 gap-1 flex-shrink-0',
        'border-b',
        className,
      )}
    >
      <span className="flex-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground truncate select-none">
        {title}
      </span>

      {actions}

      {onCollapse && (
        <button
          onClick={onCollapse}
          className={cn(
            'p-1.5 rounded-md text-muted-foreground',
            'hover:bg-muted hover:text-foreground',
            'transition-colors duration-150',
          )}
          title={`Collapse ${title}`}
        >
          <CollapseIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
