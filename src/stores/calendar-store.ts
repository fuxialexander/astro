import { create } from 'zustand'
import type { CalendarEvent, CalendarFilter, CalendarView, CreateDraft } from '@/components/calendar/types'
import { DEFAULT_FILTER } from '@/components/calendar/types'
import { getAvailableProviders, CalendarPermissionError } from '@/lib/calendar-providers'
import { appleEventToCalendarEvent } from '@/components/calendar/event-adapters'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
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
      const providers = getAvailableProviders()
      const allEvents: CalendarEvent[] = []
      for (const provider of providers) {
        try {
          const events = await provider.listEvents(from, to)
          for (const ev of events) {
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

  createDraft: null,
  setCreateDraft: (draft) => set({ createDraft: draft }),
}))
