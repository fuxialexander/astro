import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'
import type { CalendarProvider, CalendarInfo, ExternalCalendarEvent, CreateEventInput } from './types'
import { CalendarPermissionError } from './types'

export class AppleCalendarProvider implements CalendarProvider {
  readonly id = 'apple'
  readonly displayName = 'Apple Calendar'

  get isAvailable(): boolean {
    return isDesktop()
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const res = await desktopBridge.calendar.listCalendars()
    return res.calendars
  }

  async listEvents(from: string, to: string): Promise<ExternalCalendarEvent[]> {
    const res = await desktopBridge.calendar.listEvents(from, to)
    if (res.permissionDenied) {
      throw new CalendarPermissionError()
    }
    return res.events.map((ev) => ({
      id: ev.id,
      calendarId: ev.calendarId,
      calendarName: ev.calendarName,
      calendarColor: ev.calendarColor,
      title: ev.title,
      startAt: ev.startDate,
      endAt: ev.endDate,
      allDay: ev.allDay,
      notes: ev.notes ?? undefined,
      location: ev.location ?? undefined,
      url: ev.url ?? undefined,
      isRecurring: ev.isRecurring,
      isWritable: true,
    }))
  }

  async createEvent(input: CreateEventInput): Promise<{ id: string }> {
    const res = await desktopBridge.calendar.createEvent({
      calendarName: input.calendarName,
      title: input.title,
      startDate: input.startAt,
      endDate: input.endAt,
      allDay: input.allDay,
      notes: input.notes,
    })
    if (!res.ok) throw new Error('Failed to create Apple Calendar event')
    return { id: res.id }
  }

  async updateEvent(id: string, calendarId: string, patch: Partial<CreateEventInput>): Promise<void> {
    await desktopBridge.calendar.updateEvent({
      eventId: id,
      calendarId,
      title: patch.title,
      startDate: patch.startAt,
      endDate: patch.endAt,
      notes: patch.notes,
    })
  }

  async deleteEvent(id: string, calendarId: string): Promise<void> {
    await desktopBridge.calendar.deleteEvent(id, calendarId)
  }
}
