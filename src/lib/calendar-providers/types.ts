export interface ExternalCalendarEvent {
  id: string
  calendarId: string
  calendarName: string
  calendarColor: string | null
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  notes?: string
  location?: string
  url?: string
  isRecurring: boolean
  isWritable: boolean
}

export interface CalendarInfo {
  id: string
  name: string
  color: string | null
  isSubscribed: boolean
  isWritable: boolean
}

export interface CreateEventInput {
  calendarId?: string
  calendarName?: string
  title: string
  startAt: string
  endAt: string
  allDay?: boolean
  notes?: string
  location?: string
}

export interface CalendarProvider {
  readonly id: string
  readonly displayName: string
  readonly isAvailable: boolean
  listCalendars(): Promise<CalendarInfo[]>
  listEvents(from: string, to: string): Promise<ExternalCalendarEvent[]>
  createEvent(input: CreateEventInput): Promise<{ id: string }>
  updateEvent(id: string, calendarId: string, patch: Partial<CreateEventInput>): Promise<void>
  deleteEvent(id: string, calendarId: string): Promise<void>
}

export class CalendarPermissionError extends Error {
  constructor(message = 'Calendar access was denied') {
    super(message)
    this.name = 'CalendarPermissionError'
  }
}
