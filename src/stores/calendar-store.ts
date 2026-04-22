import { create } from 'zustand'
import type { CalendarEvent, CalendarFilter, CalendarView, CreateDraft } from '@/components/calendar/types'
import { DEFAULT_FILTER } from '@/components/calendar/types'
import { getAvailableProviders, CalendarPermissionError } from '@/lib/calendar-providers'
import { appleEventToCalendarEvent } from '@/components/calendar/event-adapters'
import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface AvailableCalendar {
  id: string
  name: string
  color: string | null
  isReminder: boolean
}

interface CalendarStore {
  view: CalendarView
  focusedDate: string
  setView: (v: CalendarView) => void
  setFocusedDate: (d: string) => void
  navigateBy: (delta: number) => void

  externalEvents: CalendarEvent[]
  externalLoading: boolean
  externalError: string | null
  externalPermissionDenied: boolean
  lastFetchedRange: { from: string; to: string } | null
  loadExternalEvents: (from: string, to: string) => Promise<void>
  addExternalEvent: (event: CalendarEvent) => void
  removeExternalEvent: (id: string) => void

  filter: CalendarFilter
  setFilter: (patch: Partial<CalendarFilter>) => void
  resetFilter: () => void

  // Per-calendar on/off
  availableCalendars: AvailableCalendar[]
  disabledCalendarIds: string[]
  loadAvailableCalendars: () => Promise<void>
  toggleCalendar: (id: string) => void

  createDraft: CreateDraft | null
  setCreateDraft: (draft: CreateDraft | null) => void
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  view: 'week',
  focusedDate: todayStr(),

  setView: (v) => set({ view: v }),
  setFocusedDate: (d) => set({ focusedDate: d }),

  navigateBy: (delta) => {
    const { view, focusedDate } = get()
    const d = new Date(`${focusedDate}T00:00:00Z`)
    if (view === 'day') {
      d.setUTCDate(d.getUTCDate() + delta)
    } else if (view === 'week') {
      d.setUTCDate(d.getUTCDate() + delta * 7)
    } else if (view === 'year') {
      d.setUTCFullYear(d.getUTCFullYear() + delta)
    } else {
      d.setUTCMonth(d.getUTCMonth() + delta)
    }
    set({ focusedDate: d.toISOString().slice(0, 10) })
  },

  externalEvents: [],
  externalLoading: false,
  externalError: null,
  externalPermissionDenied: false,
  lastFetchedRange: null,

  loadExternalEvents: async (from, to) => {
    set({ externalLoading: true, externalError: null })
    try {
      const { disabledCalendarIds } = get()
      const providers = getAvailableProviders()
      const allEvents: CalendarEvent[] = []
      for (const provider of providers) {
        try {
          const events = await provider.listEvents(from, to)
          for (const ev of events) {
            if (disabledCalendarIds.includes(ev.calendarId)) continue
            allEvents.push(appleEventToCalendarEvent({
              id: ev.id,
              calendarId: ev.calendarId,
              calendarName: ev.calendarName,
              calendarColor: ev.calendarColor,
              title: ev.title,
              startDate: ev.startAt,
              endDate: ev.endAt,
              allDay: ev.allDay,
              notes: ev.notes ?? null,
              location: ev.location ?? null,
              url: ev.url ?? null,
              isRecurring: ev.isRecurring,
            }))
          }
        } catch (err) {
          if (err instanceof CalendarPermissionError) {
            set({ externalPermissionDenied: true, externalError: null })
          } else {
            console.error(`[calendar-store] Provider ${provider.id} error:`, err)
            set({ externalError: err instanceof Error ? err.message : 'Calendar provider error' })
          }
        }
      }

      // Load reminders on desktop
      if (isDesktop()) {
        try {
          const res = await desktopBridge.calendar.listReminders(from, to)
          if (res.permissionDenied) {
            set({ externalPermissionDenied: true })
          } else {
            for (const r of res.reminders) {
              if (disabledCalendarIds.includes(r.calendarId)) continue
              if (!r.dueDate) continue
              allEvents.push({
                id: `reminder-${r.id}`,
                sourceId: r.id,
                source: 'apple-reminder',
                kind: 'external',
                startAt: r.dueDate,
                endAt: r.dueDate,
                allDay: true,
                title: r.title,
                description: r.notes ?? undefined,
                color: r.isCompleted ? 'green' : 'purple',
                isCompleted: r.isCompleted,
                isCancelled: false,
                isDraggable: false,
                isReadOnly: true,
                raw: {
                  calendarId: r.calendarId,
                  eventId: r.id,
                  calendarColor: r.calendarColor ?? undefined,
                  isAllDay: true,
                  notes: r.notes ?? undefined,
                },
              })
            }
          }
        } catch (err) {
          console.warn('[calendar-store] reminders error:', err)
        }
      }

      set({ externalEvents: allEvents, lastFetchedRange: { from, to } })
    } catch (err) {
      set({ externalError: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      set({ externalLoading: false })
    }
  },

  addExternalEvent: (event) => set((s) => ({ externalEvents: [...s.externalEvents, event] })),
  removeExternalEvent: (id) => set((s) => ({ externalEvents: s.externalEvents.filter((e) => e.id !== id) })),

  filter: DEFAULT_FILTER,
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: DEFAULT_FILTER }),

  availableCalendars: [],
  disabledCalendarIds: [],

  loadAvailableCalendars: async () => {
    if (!isDesktop()) return
    try {
      const [evRes, remRes] = await Promise.allSettled([
        desktopBridge.calendar.listCalendars(),
        desktopBridge.calendar.listReminders(
          new Date(Date.now() - 30 * 86400000).toISOString(),
          new Date(Date.now() + 30 * 86400000).toISOString(),
        ),
      ])
      const cals: AvailableCalendar[] = []
      if (evRes.status === 'fulfilled') {
        for (const c of evRes.value.calendars) {
          cals.push({ id: c.id, name: c.name, color: c.color, isReminder: false })
        }
      }
      // Derive reminder calendars from the returned reminders
      if (remRes.status === 'fulfilled' && !remRes.value.permissionDenied) {
        const seen = new Set<string>()
        for (const r of remRes.value.reminders) {
          if (!seen.has(r.calendarId)) {
            seen.add(r.calendarId)
            cals.push({ id: r.calendarId, name: r.calendarName, color: r.calendarColor, isReminder: true })
          }
        }
      }
      set({ availableCalendars: cals })
    } catch (err) {
      console.warn('[calendar-store] loadAvailableCalendars error:', err)
    }
  },

  toggleCalendar: (id) => set((s) => ({
    disabledCalendarIds: s.disabledCalendarIds.includes(id)
      ? s.disabledCalendarIds.filter((x) => x !== id)
      : [...s.disabledCalendarIds, id],
  })),

  createDraft: null,
  setCreateDraft: (draft) => set({ createDraft: draft }),
}))
