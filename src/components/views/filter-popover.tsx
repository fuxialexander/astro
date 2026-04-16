import { useState, type ReactNode } from "react"
import { ListFilter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface FilterPopoverProps {
  /** Number of active (non-default) filters */
  activeCount?: number
  children: ReactNode
}

/**
 * A round icon button that opens a popover with filter controls.
 * Replaces the full-width filter bar to save vertical space.
 */
export function FilterPopover({ activeCount = 0, children }: FilterPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={activeCount > 0 ? "secondary" : "outline"}
            size="sm"
            className="h-8 w-8 p-0 rounded-full relative"
            onClick={() => setOpen(!open)}
          >
            <ListFilter className={cn("h-3.5 w-3.5", activeCount > 0 && "text-primary")} />
            {activeCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-primary-foreground">
                {activeCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Filter</TooltipContent>
      </Tooltip>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 min-w-[200px] rounded-lg border bg-popover p-3 shadow-lg">
            <div className="flex flex-col gap-3">
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

interface FilterRowProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}

/** A single filter row inside the FilterPopover */
export function FilterRow({ label, value, options, onChange }: FilterRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-muted-foreground shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs bg-transparent border border-border/60 rounded-md px-2 py-1 outline-none cursor-pointer text-foreground hover:border-border transition-colors min-w-[120px]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}
