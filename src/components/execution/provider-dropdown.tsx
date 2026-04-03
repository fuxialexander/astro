/**
 * ProviderDropdown — compact popover dropdown for AI agent selection.
 */

import { useState, useRef } from "react"
import { Bot, ChevronDown, Check } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { PROVIDER_NAMES } from "./provider-utils"
import { cn } from "@/lib/utils"
import type { ProviderStatus } from "@/types"

interface ProviderDropdownProps {
  providers: ProviderStatus[]
  selectedProvider: string
  onSelect: (providerId: string) => void
  compact?: boolean
}

export function ProviderDropdown({
  providers,
  selectedProvider,
  onSelect,
  compact,
}: ProviderDropdownProps) {
  const [open, setOpen] = useState(false)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>(null)
  const selectedName = selectedProvider
    ? PROVIDER_NAMES[selectedProvider] || providers.find((p) => p.id === selectedProvider)?.name || selectedProvider
    : "Auto"

  const handleMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    hoverTimeout.current = setTimeout(() => setOpen(true), 150)
  }
  const handleMouseLeave = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    hoverTimeout.current = setTimeout(() => setOpen(false), 200)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={cn(
            "shrink-0 flex items-center gap-1.5 rounded-md border transition-colors cursor-pointer",
            compact ? "h-7 px-2 text-[11px]" : "h-8 px-2.5 text-xs",
            selectedProvider
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          <Bot className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5", "shrink-0")} />
          <span className="truncate max-w-[140px]">{selectedName}</span>
          <ChevronDown className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5", "shrink-0 opacity-50")} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        {/* Auto option */}
        <button
          type="button"
          onClick={() => { onSelect(""); setOpen(false) }}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer",
            !selectedProvider ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground",
          )}
        >
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span>Auto</span>
          {!selectedProvider && <Check className="h-3.5 w-3.5 ml-auto shrink-0" />}
        </button>
        {providers.map((p) => {
          const isSelected = selectedProvider === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => { onSelect(isSelected ? "" : p.id); setOpen(false) }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer",
                isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground",
              )}
            >
              <Bot className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{PROVIDER_NAMES[p.id] || p.name || p.id}</span>
              {isSelected && <Check className="h-3.5 w-3.5 ml-auto shrink-0" />}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
