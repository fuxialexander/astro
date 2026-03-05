import { useState } from "react"
import { Check, Server, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AVAILABLE_BACKENDS } from "./backend-constants"
import { cn } from "@/lib/utils"

interface BackendMultiSelectProps {
  selectedBackends: string[]
  onSelectionChange: (backends: string[]) => void
  className?: string
}

export function BackendMultiSelect({
  selectedBackends,
  onSelectionChange,
  className,
}: BackendMultiSelectProps) {
  const [open, setOpen] = useState(false)

  const toggle = (id: string) => {
    if (selectedBackends.includes(id)) {
      onSelectionChange(selectedBackends.filter((b) => b !== id))
    } else {
      onSelectionChange([...selectedBackends, id])
    }
  }

  const label =
    selectedBackends.length === 0
      ? "Compute"
      : selectedBackends
          .map((id) => AVAILABLE_BACKENDS.find((b) => b.id === id)?.name ?? id)
          .join(", ")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7 gap-1 text-xs font-normal", className)}
        >
          <Server className="h-3 w-3" />
          <span className="max-w-[120px] truncate">{label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="space-y-0.5">
          {AVAILABLE_BACKENDS.map((backend) => {
            const selected = selectedBackends.includes(backend.id)
            return (
              <button
                key={backend.id}
                onClick={() => toggle(backend.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
              >
                <div
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-sm border",
                    selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                  )}
                >
                  {selected && <Check className="h-3 w-3" />}
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium">{backend.name}</div>
                  {backend.description && (
                    <div className="text-[11px] text-muted-foreground">{backend.description}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        <div className="mt-1 border-t px-2 py-1.5 text-[11px] text-muted-foreground">
          Customize skills per backend in Environment settings
        </div>
      </PopoverContent>
    </Popover>
  )
}
