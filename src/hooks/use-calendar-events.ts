import { useMemo } from 'react'
import { usePlanStore } from '@/stores/plan-store'
import { useProjectStore } from '@/stores/project-store'
import { useScheduleStore } from '@/stores/schedule-store'
import { useCalendarStore } from '@/stores/calendar-store'
import { planNodeToEvents, scheduleToEvents } from '@/components/calendar/event-adapters'
import type { CalendarEvent, CalendarFilter } from '@/components/calendar/types'

function applyFilter(events: CalendarEvent[], filter: CalendarFilter): CalendarEvent[] {
  return events.filter((ev) => {
    if (filter.projectIds.length > 0 && ev.projectId && !filter.projectIds.includes(ev.projectId)) {
      return false
    }
    if (!filter.showExecutions && ev.kind === 'execution') return false
    if (!filter.showScheduled && ev.kind === 'scheduled') return false
    if (!filter.showDeadlines && (ev.kind === 'deadline' || ev.kind === 'milestone')) return false
    if (!filter.showExternal && ev.kind === 'external') return false
    if (!filter.sources.includes(ev.source)) return false
    return true
  })
}

function eventStartDay(ev: CalendarEvent): string {
  return ev.startAt.slice(0, 10)
}

export function useCalendarEvents(): {
  events: CalendarEvent[]
  byDay: Map<string, CalendarEvent[]>
  heatMap: Map<string, number>
} {
  const nodes = usePlanStore((s) => s.nodes)
  const projects = useProjectStore((s) => s.projects)
  const allSchedules = useScheduleStore((s) => s.allSchedules)
  const runs = useScheduleStore((s) => s.runs)
  const externalEvents = useCalendarStore((s) => s.externalEvents)
  const filter = useCalendarStore((s) => s.filter)

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  )

  const rawEvents = useMemo(() => {
    const evs: CalendarEvent[] = []

    // Task nodes
    for (const node of nodes) {
      if (node.status === 'pruned') continue
      const project = projectMap.get(node.projectId)
      if (!project) continue
      evs.push(...planNodeToEvents(node, project))
    }

    // Schedules
    for (const schedule of allSchedules) {
      const scheduleRuns = runs[schedule.id] ?? []
      evs.push(...scheduleToEvents(schedule, scheduleRuns))
    }

    // External (Apple Calendar etc.)
    evs.push(...externalEvents)

    return evs
  }, [nodes, allSchedules, runs, externalEvents, projectMap])

  const filteredEvents = useMemo(() => applyFilter(rawEvents, filter), [rawEvents, filter])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const ev of filteredEvents) {
      const day = eventStartDay(ev)
      const arr = map.get(day) ?? []
      arr.push(ev)
      map.set(day, arr)
    }
    // Sort each day's events by start time
    for (const [day, arr] of map) {
      map.set(day, arr.sort((a, b) => a.startAt.localeCompare(b.startAt)))
    }
    return map
  }, [filteredEvents])

  const heatMap = useMemo(() => {
    // Count execution + scheduled events per day (not deadlines — those are already shown as markers)
    const rawCounts = new Map<string, number>()
    for (const ev of filteredEvents) {
      if (ev.kind !== 'execution' && ev.kind !== 'scheduled') continue
      const day = eventStartDay(ev)
      rawCounts.set(day, (rawCounts.get(day) ?? 0) + 1)
    }

    // Normalize to [0, 1]
    const max = Math.max(1, ...rawCounts.values())
    const normalized = new Map<string, number>()
    for (const [day, count] of rawCounts) {
      normalized.set(day, count / max)
    }
    return normalized
  }, [filteredEvents])

  return { events: filteredEvents, byDay, heatMap }
}
