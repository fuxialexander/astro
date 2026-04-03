/**
 * QuickActions — command strip with primary actions for the dashboard.
 */
import { Plus, Search } from 'lucide-react'
import { cn } from '@desktop/lib/utils'

interface QuickActionsProps {
  onNewProject: () => void
  onOpenPalette: () => void
}

export function QuickActions({ onNewProject, onOpenPalette }: QuickActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onNewProject}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg',
          'bg-primary text-primary-foreground text-sm font-medium',
          'hover:opacity-90 transition-opacity duration-150',
        )}
      >
        <Plus className="w-4 h-4" />
        New Project
      </button>
      <button
        onClick={onOpenPalette}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg',
          'bg-muted text-foreground text-sm font-medium',
          'hover:bg-muted/80 transition-colors duration-150',
        )}
      >
        <Search className="w-4 h-4" />
        <span className="font-mono text-xs opacity-70">⌘K</span>
      </button>
    </div>
  )
}
