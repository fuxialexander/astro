/**
 * Activity store — real-time activity events for a project.
 *
 * Tracks task executions, chat messages, file changes, and errors
 * in a unified timeline feed.
 */
import { create } from 'zustand'

// ── Types ─────────────────────────────────────────────────────────────

export type ActivityEventType =
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'chat_message'
  | 'file_change'
  | 'error'
  | 'system'

export interface ActivityEvent {
  id: string
  type: ActivityEventType
  title: string
  description?: string
  nodeId?: string
  timestamp: string
  metadata?: Record<string, unknown>
}

type ActivityFilter = ActivityEventType | 'all'

interface ActivityState {
  events: ActivityEvent[]
  filter: ActivityFilter
  expandedEventId: string | null

  addEvent: (event: ActivityEvent) => void
  addEvents: (events: ActivityEvent[]) => void
  setFilter: (filter: ActivityFilter) => void
  setExpandedEvent: (eventId: string | null) => void
  clearEvents: () => void
  getFilteredEvents: () => ActivityEvent[]
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  events: [],
  filter: 'all',
  expandedEventId: null,

  addEvent: (event) => {
    set((s) => ({
      events: [event, ...s.events].slice(0, 500), // cap at 500 events
    }))
  },

  addEvents: (events) => {
    set((s) => ({
      events: [...events, ...s.events]
        // Deduplicate by id
        .filter((e, i, arr) => arr.findIndex((a) => a.id === e.id) === i)
        .slice(0, 500),
    }))
  },

  setFilter: (filter) => set({ filter }),

  setExpandedEvent: (eventId) => set({ expandedEventId: eventId }),

  clearEvents: () => set({ events: [], expandedEventId: null }),

  getFilteredEvents: () => {
    const { events, filter } = get()
    if (filter === 'all') return events
    return events.filter((e) => e.type === filter)
  },
}))
