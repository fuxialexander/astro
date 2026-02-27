import { useState } from "react"
import { Check, Settings } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { Label } from "@/types"

interface LabelPickerProps {
  labelIds: string[]
  allLabels: Label[]
  disabled?: boolean
  onChange: (labelIds: string[]) => void
  onManageLabels?: () => void
  displayMode?: "dots" | "badges"
}

export function LabelPicker({
  labelIds,
  allLabels,
  disabled,
  onChange,
  onManageLabels,
  displayMode = "dots",
}: LabelPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const nodeLabels = labelIds
    .map((id) => allLabels.find((l) => l.id === id))
    .filter((l): l is Label => !!l)

  if (allLabels.length === 0 && !onManageLabels) return null

  const trigger =
    displayMode === "dots" ? (
      <div className="flex items-center gap-1 min-h-[20px]">
        {nodeLabels.length > 0 ? (
          nodeLabels.map((label) => (
            <span
              key={label.id}
              className="h-2.5 w-2.5 rounded-full shrink-0"
              title={label.name}
              style={{ backgroundColor: label.color }}
            />
          ))
        ) : (
          <span className="text-[10px] text-muted-foreground/50">&mdash;</span>
        )}
      </div>
    ) : (
      <div className="flex items-center gap-1 flex-wrap min-h-[20px]">
        {nodeLabels.length > 0 ? (
          nodeLabels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))
        ) : (
          <span className="text-[10px] text-muted-foreground/50">No labels</span>
        )}
      </div>
    )

  if (disabled) return trigger

  const filteredLabels =
    search && allLabels.length > 5
      ? allLabels.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()))
      : allLabels

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch("") }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-sm p-0.5 -m-0.5 hover:bg-muted transition-colors cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-44 p-1"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Labels</p>
        {allLabels.length > 5 && (
          <input
            type="text"
            placeholder="Search labels..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground/50"
            autoFocus
          />
        )}
        {filteredLabels.length === 0 && allLabels.length > 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching labels</p>
        )}
        {filteredLabels.map((label) => {
          const isActive = labelIds.includes(label.id)
          return (
            <button
              key={label.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
                "hover:bg-accent transition-colors",
                isActive && "bg-accent/50",
              )}
              onClick={() => {
                const next = isActive
                  ? labelIds.filter((id) => id !== label.id)
                  : [...labelIds, label.id]
                onChange(next)
              }}
            >
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: label.color }}
              />
              <span className="flex-1 text-left text-xs">{label.name}</span>
              {isActive && <Check className="h-3.5 w-3.5 text-foreground" />}
            </button>
          )
        })}
        {onManageLabels && (
          <>
            <div className="border-t border-border my-1" />
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              onClick={() => {
                setOpen(false)
                onManageLabels()
              }}
            >
              <Settings className="h-3 w-3" />
              Manage labels
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
