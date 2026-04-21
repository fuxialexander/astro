import type { PlanNode, Project, Schedule, ScheduleRun } from '@/types'
import type { CalendarEvent, CalendarEventColor, AppleCalendarEventRaw } from './types'

function statusToColor(status: PlanNode['status']): CalendarEventColor {
  switch (status) {
    case 'completed':
    case 'auto_verified':
      return 'green'
    case 'in_progress':
    case 'dispatched':
      return 'blue'
    case 'awaiting_judgment':
    case 'awaiting_approval':
      return 'amber'
    case 'pruned':
      return 'gray'
    default:
      return 'gray'
  }
}

function toISOLocal(d: Date): string {
  return d.toISOString()
}

function dateStrToISO(s: string): string {
  return `${s}T00:00:00.000Z`
}

export function planNodeToEvents(node: PlanNode, project: Project): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const color = statusToColor(node.status)
  const isCompleted = node.status === 'completed' || node.status === 'auto_verified'
  const isCancelled = node.status === 'pruned'

  // 1. Execution event (actual run time)
  if (node.executionStartedAt) {
    const startAt = toISOLocal(new Date(node.executionStartedAt))
    const endAt = node.executionCompletedAt
      ? toISOLocal(new Date(node.executionCompletedAt))
      : toISOLocal(new Date(new Date(node.executionStartedAt).getTime() + 30 * 60 * 1000))
    events.push({
      id: `task-execution:${node.id}`,
      sourceId: node.id,
      source: 'task-execution',
      kind: 'execution',
      startAt,
      endAt,
      allDay: false,
      title: node.title,
      description: node.description,
      color,
      projectId: node.projectId,
      projectName: project.name,
      nodeId: node.id,
      isCompleted,
      isCancelled,
      isDraggable: false,
      isReadOnly: true,
      raw: { nodeId: node.id, projectId: node.projectId, status: node.status },
    })
  }

  // 2. Milestone event
  if (node.type === 'milestone' && node.startDate) {
    events.push({
      id: `milestone:${node.id}`,
      sourceId: node.id,
      source: 'deadline',
      kind: 'milestone',
      startAt: dateStrToISO(node.startDate),
      endAt: dateStrToISO(node.endDate ?? node.startDate),
      allDay: true,
      title: `◆ ${node.title}`,
      description: node.description,
      color: 'purple',
      projectId: node.projectId,
      projectName: project.name,
      nodeId: node.id,
      isCompleted,
      isCancelled,
      isDraggable: false,
      isReadOnly: false,
      raw: { nodeId: node.id, projectId: node.projectId, status: node.status },
    })
  }

  // 3. Deadline event
  if (node.dueDate) {
    events.push({
      id: `deadline:${node.id}`,
      sourceId: node.id,
      source: 'deadline',
      kind: 'deadline',
      startAt: dateStrToISO(node.dueDate),
      endAt: dateStrToISO(node.dueDate),
      allDay: true,
      title: node.title,
      description: node.description,
      color: isCompleted ? 'green' : 'red',
      projectId: node.projectId,
      projectName: project.name,
      nodeId: node.id,
      isCompleted,
      isCancelled,
      isDraggable: false,
      isReadOnly: false,
      raw: { nodeId: node.id, projectId: node.projectId, status: node.status },
    })
  }

  return events
}

export function scheduleToEvents(schedule: Schedule, runs: ScheduleRun[]): CalendarEvent[] {
  const events: CalendarEvent[] = []

  // Past runs
  for (const run of runs) {
    if (!run.startedAt) continue
    const startAt = toISOLocal(new Date(run.startedAt))
    const endAt = run.completedAt
      ? toISOLocal(new Date(run.completedAt))
      : toISOLocal(new Date(new Date(run.startedAt).getTime() + 5 * 60 * 1000))
    const isCompleted = run.status === 'success'
    const isCancelled = run.status === 'missed'
    const color: CalendarEventColor =
      run.status === 'success' ? 'green' :
      run.status === 'failure' ? 'red' :
      run.status === 'running' ? 'blue' :
      'amber'

    events.push({
      id: `scheduled-run:${run.id}`,
      sourceId: run.id,
      source: 'scheduled-run',
      kind: 'execution',
      startAt,
      endAt,
      allDay: false,
      title: schedule.name,
      color,
      projectId: schedule.projectId,
      scheduleId: schedule.id,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      isCompleted,
      isCancelled,
      isDraggable: false,
      isReadOnly: true,
      raw: { scheduleId: schedule.id, runId: run.id },
    })
  }

  // Next scheduled trigger (future)
  if (schedule.nextRunAt && schedule.enabled) {
    const startAt = toISOLocal(new Date(schedule.nextRunAt))
    events.push({
      id: `scheduled-run:${schedule.id}:next`,
      sourceId: `${schedule.id}:next`,
      source: 'scheduled-run',
      kind: 'scheduled',
      startAt,
      endAt: toISOLocal(new Date(new Date(schedule.nextRunAt).getTime() + 5 * 60 * 1000)),
      allDay: false,
      title: schedule.name,
      color: 'amber',
      projectId: schedule.projectId,
      scheduleId: schedule.id,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      isCompleted: false,
      isCancelled: false,
      isDraggable: false,
      isReadOnly: true,
      raw: { scheduleId: schedule.id },
    })
  }

  return events
}

export interface AppleCalendarEvent {
  id: string
  calendarId: string
  calendarName: string
  calendarColor: string | null
  title: string
  startDate: string
  endDate: string
  allDay: boolean
  notes: string | null
  location: string | null
  url: string | null
  isRecurring: boolean
}

export function appleEventToCalendarEvent(ev: AppleCalendarEvent): CalendarEvent {
  return {
    id: `apple-calendar:${ev.id}`,
    sourceId: ev.id,
    source: 'apple-calendar',
    kind: 'external',
    startAt: ev.startDate,
    endAt: ev.endDate,
    allDay: ev.allDay,
    title: ev.title,
    description: ev.notes ?? undefined,
    color: 'external',
    isCompleted: false,
    isCancelled: false,
    isDraggable: true,
    isReadOnly: false,
    raw: {
      calendarId: ev.calendarId,
      eventId: ev.id,
      calendarColor: ev.calendarColor ?? undefined,
      isAllDay: ev.allDay,
      location: ev.location ?? undefined,
      url: ev.url ?? undefined,
      notes: ev.notes ?? undefined,
    } as AppleCalendarEventRaw,
  }
}
