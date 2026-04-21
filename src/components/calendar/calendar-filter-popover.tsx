import { useState } from 'react'
import { SlidersHorizontal, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCalendarStore } from '@/stores/calendar-store'
import { useProjectStore } from '@/stores/project-store'
import { cn } from '@/lib/utils'
import type { CalendarEventSource } from './types'

const SOURCE_LABELS: Record<CalendarEventSource, string> = {
  'task-execution': 'Task runs',
  'scheduled-run': 'Scheduled runs',
  'deadline': 'Deadlines',
  'apple-calendar': 'Apple Calendar',
  'apple-reminder': 'Reminders',
}

export function CalendarFilterPopover() {
  const [open, setOpen] = useState(false)
  const filter = useCalendarStore((s) => s.filter)
  const setFilter = useCalendarStore((s) => s.setFilter)
  const resetFilter = useCalendarStore((s) => s.resetFilter)
  const projects = useProjectStore((s) => s.projects).filter((p) => p.status === 'active')

  const toggleProject = (id: string) => {
    const cur = filter.projectIds
    setFilter({
      projectIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    })
  }

  const toggleSource = (src: CalendarEventSource) => {
    const cur = filter.sources
    setFilter({
      sources: cur.includes(src) ? cur.filter((x) => x !== src) : [...cur, src],
    })
  }

  const hasFilters = filter.projectIds.length > 0 || filter.sources.length < 5

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-7 gap-1.5 text-xs', hasFilters && 'text-primary')}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filter
          {hasFilters && (
            <span className="bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
              !
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 glass-panel" align="end" sideOffset={6}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-foreground">Filter events</span>
          {hasFilters && (
            <button
              type="button"
              onClick={resetFilter}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          )}
        </div>

        {/* Event sources */}
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Sources</p>
          <div className="space-y-1">
            {(Object.keys(SOURCE_LABELS) as CalendarEventSource[]).map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => toggleSource(src)}
                className="flex items-center gap-2 w-full text-left text-xs text-foreground hover:text-primary py-0.5"
              >
                <div className={cn(
                  'w-3.5 h-3.5 rounded border border-border flex items-center justify-center shrink-0',
                  filter.sources.includes(src) && 'bg-primary border-primary',
                )}>
                  {filter.sources.includes(src) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </div>
                {SOURCE_LABELS[src]}
              </button>
            ))}
          </div>
        </div>

        {/* Projects */}
        {projects.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Projects</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProject(p.id)}
                  className="flex items-center gap-2 w-full text-left text-xs text-foreground hover:text-primary py-0.5"
                >
                  <div className={cn(
                    'w-3.5 h-3.5 rounded border border-border flex items-center justify-center shrink-0',
                    filter.projectIds.includes(p.id) && 'bg-primary border-primary',
                  )}>
                    {filter.projectIds.includes(p.id) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </div>
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Heat map legend */}
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] text-muted-foreground">
            Month heat map = density of task runs per day
          </p>
          <div className="flex items-center gap-1 mt-1">
            {[0.1, 0.3, 0.5, 0.7, 1.0].map((i) => (
              <div
                key={i}
                className="flex-1 h-2 rounded-sm"
                style={{
                  background: `color-mix(in srgb, var(--primary) ${Math.round((0.04 + i * 0.24) * 100)}%, transparent)`,
                }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
            <span>fewer</span>
            <span>more</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
