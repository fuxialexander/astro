import { useState } from "react"
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
  children,
}: {
  value: string | undefined
  options: PickerOption[]
  title: string
  disabled?: boolean
  onSelect: (id: string) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  if (disabled) return <span className="inline-flex items-center">{children}</span>

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-sm p-0.5 -m-0.5 hover:bg-muted transition-colors cursor-pointer"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-48 p-1"
        onPointerDown={(e) => e.stopPropagation()}
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
              onClick={() => { onSelect(opt.id); setOpen(false) }}
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
