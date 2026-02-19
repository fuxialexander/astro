import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface CollapsibleContentProps {
  title: string
  defaultOpen?: boolean
  badge?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function CollapsibleContent({
  title,
  defaultOpen = false,
  badge,
  className,
  children,
}: CollapsibleContentProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={cn("", className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left py-1 hover:bg-muted/30 rounded transition-colors cursor-pointer group"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        )}
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-medium">
          {title}
        </span>
        {badge}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}
