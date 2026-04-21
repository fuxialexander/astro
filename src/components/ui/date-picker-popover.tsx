import { useState } from "react"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isSameDay, isToday, parseISO } from "date-fns"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface DatePickerPopoverProps {
  value?: string        // ISO YYYY-MM-DD or undefined
  onChange: (date: string | undefined) => void
  children: React.ReactNode
  align?: "start" | "center" | "end"
  disabled?: boolean
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

export function DatePickerPopover({ value, onChange, children, align = "start", disabled }: DatePickerPopoverProps) {
  const today = new Date()
  const selected = value ? parseISO(value) : null
  const [viewMonth, setViewMonth] = useState(() => selected ?? today)
  const [open, setOpen] = useState(false)

  const monthStart = startOfMonth(viewMonth)
  const monthEnd = endOfMonth(viewMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // Monday-first offset: getDay returns 0=Sun, convert to 0=Mon
  const startOffset = (getDay(monthStart) + 6) % 7

  function handleSelect(day: Date) {
    onChange(format(day, "yyyy-MM-dd"))
    setOpen(false)
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange(undefined)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <span onClick={() => !disabled && setOpen(true)}>{children}</span>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 select-none"
        align={align}
        sideOffset={6}
        avoidCollisions
        collisionPadding={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
          <button
            type="button"
            onClick={() => setViewMonth(subMonths(viewMonth, 1))}
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-sm font-semibold">{format(viewMonth, "MMM yyyy")}</span>
          <button
            type="button"
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Weekday labels */}
        <div className="grid grid-cols-7 px-2 pb-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground/70 py-0.5">
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 px-2 pb-2 gap-y-0.5">
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {days.map((day) => {
            const isSelected = selected && isSameDay(day, selected)
            const itIsToday = isToday(day)
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => handleSelect(day)}
                className={cn(
                  "h-7 w-7 mx-auto flex items-center justify-center rounded-md text-xs transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground font-semibold"
                    : itIsToday
                    ? "border border-primary/50 text-primary font-medium hover:bg-primary/10"
                    : "text-foreground hover:bg-muted/60"
                )}
              >
                {format(day, "d")}
              </button>
            )
          })}
        </div>

        {/* Footer: today shortcut + clear */}
        <div className="flex items-center justify-between border-t border-border/50 px-3 py-1.5 gap-2">
          <button
            type="button"
            onClick={() => handleSelect(today)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Today
          </button>
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
