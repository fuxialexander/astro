export type CalendarEventSource =
  | 'task-execution'
  | 'scheduled-run'
  | 'deadline'
  | 'apple-calendar'
  | 'apple-reminder'

export type CalendarEventKind =
  | 'execution'
  | 'scheduled'
  | 'deadline'
  | 'milestone'
  | 'external'

export type CalendarEventColor =
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'purple'
  | 'gray'
  | 'external'

export interface AstroTaskEventRaw {
  nodeId: string
  projectId: string
  status: string
}

export interface ScheduledRunEventRaw {
  scheduleId: string
  runId?: string
}

export interface AppleCalendarEventRaw {
  calendarId: string
  eventId: string
  calendarColor?: string
  isAllDay: boolean
  location?: string
  url?: string
  notes?: string
}

export interface CalendarEvent {
  id: string
  sourceId: string
  source: CalendarEventSource
  kind: CalendarEventKind
  startAt: string
  endAt: string
  allDay: boolean
  title: string
  description?: string
  color: CalendarEventColor
  projectId?: string
  projectName?: string
  nodeId?: string
  scheduleId?: string
  cronExpression?: string
  timezone?: string
  isCompleted: boolean
  isCancelled: boolean
  isDraggable: boolean
  isReadOnly: boolean
  raw?: AstroTaskEventRaw | ScheduledRunEventRaw | AppleCalendarEventRaw
}

export interface CalendarFilter {
  projectIds: string[]
  sources: CalendarEventSource[]
  showExecutions: boolean
  showScheduled: boolean
  showDeadlines: boolean
  showExternal: boolean
}

export const DEFAULT_FILTER: CalendarFilter = {
  projectIds: [],
  sources: ['task-execution', 'scheduled-run', 'deadline', 'apple-calendar', 'apple-reminder'],
  showExecutions: true,
  showScheduled: true,
  showDeadlines: true,
  showExternal: true,
}

export type CalendarView = 'day' | 'week' | 'month' | 'year'

export type CreateDraftKind = 'task' | 'milestone' | 'project' | 'apple-event'

export const CREATE_DRAFT_CYCLE: CreateDraftKind[] = ['task', 'milestone', 'project', 'apple-event']

export interface CreateDraft {
  startAt: string
  endAt: string
  projectId?: string
  kind: CreateDraftKind
  title?: string
  anchorRect?: DOMRect
  isMultiDay: boolean
}
