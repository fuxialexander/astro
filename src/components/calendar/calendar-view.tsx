import { useCalendarStore } from '@/stores/calendar-store'
import { useCalendarKeyboard } from '@/hooks/use-calendar-keyboard'
import { CalendarToolbar } from './calendar-toolbar'
import { DayView } from './day/day-view'
import { WeekView } from './week/week-view'
import { MonthView } from './month/month-view'

export function CalendarView() {
  const view = useCalendarStore((s) => s.view)
  const focusedDate = useCalendarStore((s) => s.focusedDate)

  useCalendarKeyboard()

  return (
    <div className="flex flex-col h-full bg-background">
      <CalendarToolbar />
      <div className="flex-1 overflow-hidden cal-view-enter-forward" key={`${view}-${focusedDate}`}>
        {view === 'day' && <DayView focusedDate={focusedDate} />}
        {view === 'week' && <WeekView focusedDate={focusedDate} />}
        {view === 'month' && <MonthView focusedDate={focusedDate} />}
      </div>
    </div>
  )
}
