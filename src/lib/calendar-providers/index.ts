import type { CalendarProvider } from './types'
import { AppleCalendarProvider } from './apple-calendar-provider'

export type { CalendarProvider, CalendarInfo, ExternalCalendarEvent, CreateEventInput } from './types'
export { CalendarPermissionError } from './types'

const registry = new Map<string, CalendarProvider>()

export function registerProvider(p: CalendarProvider): void {
  registry.set(p.id, p)
}

export function getProvider(id: string): CalendarProvider | undefined {
  return registry.get(id)
}

export function getAvailableProviders(): CalendarProvider[] {
  return Array.from(registry.values()).filter((p) => p.isAvailable)
}

let initialized = false

export function initCalendarProviders(): void {
  if (initialized) return
  initialized = true
  registerProvider(new AppleCalendarProvider())
}
