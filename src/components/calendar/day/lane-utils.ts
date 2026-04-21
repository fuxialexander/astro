import type { CalendarEvent } from '../types'

export const HOUR_HEIGHT = 60 // px per hour, 1px per minute

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
