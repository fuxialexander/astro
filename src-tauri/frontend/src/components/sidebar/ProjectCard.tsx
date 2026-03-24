/**
 * ProjectCard — compact project list item for the sidebar.
 *
 * Displays: icon, name, status badge, last-updated time.
 * Hover state uses a 150 ms ease transition on background.
 */
import { cn } from '@desktop/lib/utils'
import { timeAgo } from '@desktop/lib/utils'
import type { Project } from '@desktop/types'

interface ProjectCardProps {
  project: Project
  active?: boolean
  onClick?: () => void
}

const STATUS_COLORS: Record<Project['status'], string> = {
  active: 'bg-success',
  archived: 'bg-muted-foreground',
  deleted: 'bg-error',
}

const STATUS_LABELS: Record<Project['status'], string> = {
  active: 'Active',
  archived: 'Archived',
  deleted: 'Deleted',
}

export function ProjectCard({ project, active = false, onClick }: ProjectCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2.5 px-3 py-2.5 rounded-md text-left',
        'transition-colors duration-150',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-foreground hover:bg-muted',
      )}
    >
      {/* Emoji icon */}
      <span
        className="text-base leading-none mt-0.5 flex-shrink-0"
        role="img"
        aria-label={project.name}
      >
        {project.icon ?? '📋'}
      </span>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate leading-tight">
            {project.name}
          </span>
          {/* Color dot */}
          {project.color && (
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: project.color }}
            />
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          {/* Status badge */}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span
              className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_COLORS[project.status])}
            />
            {STATUS_LABELS[project.status]}
          </span>

          {/* Last activity */}
          <span className="text-xs text-muted-foreground opacity-70 ml-auto">
            {timeAgo(project.updatedAt)}
          </span>
        </div>
      </div>
    </button>
  )
}
