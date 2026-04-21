import { create } from 'zustand'
import type { Schedule, ScheduleRun } from '@/types'
import { apiUrl } from '@/lib/api-url'
import { getAccessToken } from '@/lib/supabase-client'

function getActiveTeamId(): string | null {
  return localStorage.getItem('activeTeamId')
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const teamId = getActiveTeamId()
  if (teamId) headers['X-Team-Id'] = teamId
  return headers
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders()
  const res = await fetch(apiUrl(url), { ...init, headers: { ...headers, ...init?.headers } })
  if (!res.ok) {
    // Try to extract descriptive error from API response body
    try {
      const body = await res.json() as { error?: string }
      if (body?.error) throw new Error(body.error)
    } catch (e) {
      if (e instanceof Error && e.message !== `${res.status} ${res.statusText}`) throw e
    }
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

interface ScheduleState {
  schedules: Schedule[]
  allSchedules: Schedule[]
  runs: Record<string, ScheduleRun[]>
  loading: boolean
  allLoaded: boolean

  loadSchedules: (projectId: string) => Promise<void>
  loadAllSchedules: () => Promise<void>
  loadRuns: (scheduleId: string) => Promise<void>
  createSchedule: (data: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'nextRunAt' | 'lastRunAt'>) => Promise<Schedule>
  updateSchedule: (id: string, data: Partial<Schedule>) => Promise<void>
  deleteSchedule: (id: string) => Promise<void>
  triggerSchedule: (id: string) => Promise<ScheduleRun>
  isNodeScheduled: (nodeId: string) => boolean
  isProjectScheduled: (projectId: string) => boolean
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  schedules: [],
  allSchedules: [],
  runs: {},
  loading: false,
  allLoaded: false,

  loadSchedules: async (projectId: string) => {
    set({ loading: true })
    try {
      const res = await fetchJson<{ data: Schedule[] }>(`/api/schedules?projectId=${projectId}`)
      set({ schedules: res.data })
    } finally {
      set({ loading: false })
    }
  },

  loadAllSchedules: async () => {
    set({ loading: true })
    try {
      const res = await fetchJson<{ data: Schedule[] }>('/api/schedules')
      set({ allSchedules: res.data ?? [], allLoaded: true })
    } catch {
      set({ allLoaded: true })
    } finally {
      set({ loading: false })
    }
  },

  loadRuns: async (scheduleId: string) => {
    const res = await fetchJson<{ data: ScheduleRun[] }>(`/api/schedules/${scheduleId}/runs`)
    set((s) => ({ runs: { ...s.runs, [scheduleId]: res.data } }))
  },

  createSchedule: async (data) => {
    const res = await fetchJson<{ data: Schedule }>('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    set((s) => ({
      schedules: [res.data, ...s.schedules],
      allSchedules: [res.data, ...s.allSchedules],
    }))
    return res.data
  },

  updateSchedule: async (id, data) => {
    const res = await fetchJson<{ data: Schedule }>(`/api/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
    set((s) => ({
      schedules: s.schedules.map((sched) => (sched.id === id ? res.data : sched)),
      allSchedules: s.allSchedules.map((sched) => (sched.id === id ? res.data : sched)),
    }))
  },

  deleteSchedule: async (id) => {
    await fetchJson(`/api/schedules/${id}`, { method: 'DELETE' })
    set((s) => ({
      schedules: s.schedules.filter((sched) => sched.id !== id),
      allSchedules: s.allSchedules.filter((sched) => sched.id !== id),
      runs: Object.fromEntries(Object.entries(s.runs).filter(([key]) => key !== id)),
    }))
  },

  triggerSchedule: async (id) => {
    const res = await fetchJson<{ data: ScheduleRun }>(`/api/schedules/${id}/trigger`, {
      method: 'POST',
    })
    get().loadRuns(id)
    return res.data
  },

  isNodeScheduled: (nodeId: string) => {
    return get().allSchedules.some((s) => s.scope === 'node' && s.nodeId === nodeId && s.enabled)
  },

  isProjectScheduled: (projectId: string) => {
    return get().allSchedules.some((s) => s.scope === 'project' && s.projectId === projectId && s.enabled)
  },
}))
