import { useEffect } from 'react'
import { CalendarView } from '@/components/calendar/calendar-view'
import { useCalendarStore } from '@/stores/calendar-store'
import { useScheduleStore } from '@/stores/schedule-store'
import { initCalendarProviders } from '@/lib/calendar-providers'
import { addDays, parseDate, fmtDate } from '@/lib/timeline-utils'
import { AlertCircle } from 'lucide-react'

function getLoadRange(focusedDate: string): { from: string; to: string } {
  const d = parseDate(focusedDate)
  return {
    from: fmtDate(addDays(d, -60)),
    to: fmtDate(addDays(d, 60)),
  }
}

export function CalendarPage() {
  const focusedDate = useCalendarStore((s) => s.focusedDate)
  const loadExternalEvents = useCalendarStore((s) => s.loadExternalEvents)
  const externalPermissionDenied = useCalendarStore((s) => s.externalPermissionDenied)
  const loadAllSchedules = useScheduleStore((s) => s.loadAllSchedules)
  const allLoaded = useScheduleStore((s) => s.allLoaded)

  // Initialize providers once
  useEffect(() => {
    initCalendarProviders()
  }, [])

  // Load all schedules (needed for schedule events)
  useEffect(() => {
    if (!allLoaded) {
      void loadAllSchedules()
    }
  }, [allLoaded, loadAllSchedules])

  // Load external events when focused date changes significantly
  useEffect(() => {
    const { from, to } = getLoadRange(focusedDate)
    void loadExternalEvents(from, to)
  }, [focusedDate, loadExternalEvents])

  return (
    <div className="flex flex-col h-full">
      {externalPermissionDenied && (
        <div className="flex items-center gap-2 px-4 py-2 bg-warning/10 text-warning text-xs border-b border-warning/20 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>
            Calendar access is denied. To enable Apple Calendar events, go to{' '}
            <strong>System Settings → Privacy & Security → Calendars</strong> and allow Astro.
          </span>
        </div>
      )}
      <CalendarView />
    </div>
  )
}
