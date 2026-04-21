import { useState, useRef } from "react"
import { Check } from "lucide-react"
import type { PickerOption } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"

export function PropertyPicker({
  value,
  options,
  title,
  disabled,
  onSelect,
  openOnHover,
  triggerClassName,
  children,
}: {
  value: string | undefined
  options: PickerOption[]
  title: string
  disabled?: boolean
  onSelect: (id: string) => void
  openOnHover?: boolean
  triggerClassName?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 200)
  }

  const handleMouseEnterTrigger = () => {
    if (!openOnHover) return
    cancelClose()
    setOpen(true)
  }

  const handleMouseLeaveTrigger = () => {
    if (!openOnHover) return
    scheduleClose()
  }

  if (disabled) return <span className="inline-flex items-center">{children}</span>

  const defaultTriggerClass = "inline-flex items-center rounded-md p-2 -m-2 hover:bg-muted transition-colors cursor-pointer"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={triggerClassName ?? defaultTriggerClass}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (!openOnHover) setOpen(!open) }}
          onMouseEnter={handleMouseEnterTrigger}
          onMouseLeave={handleMouseLeaveTrigger}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-48 p-1"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseEnter={() => { if (openOnHover) cancelClose() }}
        onMouseLeave={() => { if (openOnHover) scheduleClose() }}
      >
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{title}</p>
        {options.map((opt) => {
          const Icon = opt.icon
          const selected = value === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
                "hover:bg-accent transition-colors",
                selected && "bg-accent/50"
              )}
              onClick={(e) => { e.stopPropagation(); onSelect(opt.id); setOpen(false) }}
            >
              {Icon && <Icon className={cn("h-4 w-4 shrink-0", opt.iconColor)} />}
              <span className="flex-1 text-left">{opt.label}</span>
              {selected && <Check className="h-3.5 w-3.5 text-foreground" />}
              {opt.shortcut && <kbd className="text-[10px] text-muted-foreground">{opt.shortcut}</kbd>}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
