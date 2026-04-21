import type { CalendarEvent } from '../types'

export const HOUR_HEIGHT = 60 // px per hour, 1px per minute

export interface MergedCalendarEvent extends CalendarEvent {
  mergedCount: number
}

// Group overlapping timed events from the same project into single merged chips.
// Events without a projectId, or solo events in a project, are returned unchanged.
export function mergeProjectEvents(events: CalendarEvent[]): MergedCalendarEvent[] {
  // Separate project events from non-project events
  const byProject = new Map<string, CalendarEvent[]>()
  const noProject: CalendarEvent[] = []

  for (const ev of events) {
    if (ev.projectId) {
      const arr = byProject.get(ev.projectId) ?? []
      arr.push(ev)
      byProject.set(ev.projectId, arr)
    } else {
      noProject.push(ev)
    }
  }

  const result: MergedCalendarEvent[] = noProject.map((ev) => ({ ...ev, mergedCount: 1 }))

  for (const [, projectEvents] of byProject) {
    const sorted = [...projectEvents].sort((a, b) => a.startAt.localeCompare(b.startAt))
    // Sweep-line merge overlapping events into clusters
    const clusters: CalendarEvent[][] = []
    let currentCluster: CalendarEvent[] = []
    let clusterEndMs = 0

    for (const ev of sorted) {
      const startMs = new Date(ev.startAt).getTime()
      const endMs = new Date(ev.endAt).getTime()
      if (currentCluster.length === 0 || startMs < clusterEndMs) {
        currentCluster.push(ev)
        clusterEndMs = Math.max(clusterEndMs, endMs)
      } else {
        clusters.push(currentCluster)
        currentCluster = [ev]
        clusterEndMs = endMs
      }
    }
    if (currentCluster.length > 0) clusters.push(currentCluster)

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        result.push({ ...cluster[0], mergedCount: 1 })
      } else {
        const minStart = cluster.reduce((m, e) => e.startAt < m ? e.startAt : m, cluster[0].startAt)
        const maxEnd = cluster.reduce((m, e) => e.endAt > m ? e.endAt : m, cluster[0].endAt)
        const representative = cluster[0]
        result.push({
          ...representative,
          id: `merged-${representative.projectId}-${minStart}`,
          startAt: minStart,
          endAt: maxEnd,
          title: representative.projectName ?? representative.title,
          mergedCount: cluster.length,
          isDraggable: false,
        })
      }
    }
  }

  return result
}

export function minuteOfDay(isoStr: string): number {
  const d = new Date(isoStr)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

export function durationMinutes(startAt: string, endAt: string): number {
  return Math.max(15, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000)
}

// Sweep-line interval scheduler: assigns each event to a horizontal lane
export function assignLanes(events: CalendarEvent[]): Array<{ event: CalendarEvent; lane: number; laneCount: number }> {
  if (events.length === 0) return []

  const sorted = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt))
  const lanes: { endMin: number }[] = []
  const assignments = new Map<string, number>()

  for (const ev of sorted) {
    const startMin = minuteOfDay(ev.startAt)
    const endMin = startMin + durationMinutes(ev.startAt, ev.endAt)

    let assigned = -1
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i].endMin <= startMin) {
        assigned = i
        break
      }
    }

    if (assigned === -1) {
      assigned = lanes.length
      lanes.push({ endMin })
    } else {
      lanes[assigned].endMin = Math.max(lanes[assigned].endMin, endMin)
    }

    assignments.set(ev.id, assigned)
  }

  const totalLanes = lanes.length
  return sorted.map((ev) => ({
    event: ev,
    lane: assignments.get(ev.id) ?? 0,
    laneCount: totalLanes,
  }))
}
