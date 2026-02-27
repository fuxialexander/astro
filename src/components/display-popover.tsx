import { useState } from "react"
import { SlidersHorizontal, ChevronDown, ArrowUp, ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { useDisplaySettingsStore, type ViewKey, type DisplaySettings } from "@/stores/display-settings-store"
import { cn } from "@/lib/utils"

export interface DisplayOption {
  value: string
  label: string
}

export interface DisplayPopoverConfig {
  viewKey: ViewKey
  groupByOptions: DisplayOption[]
  orderByOptions: DisplayOption[]
  propertyOptions: DisplayOption[]
  columnByOptions?: DisplayOption[]
  groupByLabel?: string
  showZoom?: boolean
  showTimelineOptions?: boolean
  /** "View as" options to switch between layout variants (e.g., list, timeline, board) */
  viewAsOptions?: DisplayOption[]
  /** Callback when a "View as" option is selected */
  onViewAsChange?: (value: string) => void
  /** Currently active "View as" value */
  activeViewAs?: string
}

function InlineSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: DisplayOption[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase">{label}</span>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs hover:bg-secondary/80 transition-colors cursor-pointer"
        >
          {selected?.label ?? value}
          <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-10 mt-1 min-w-[120px] rounded-md border bg-popover p-1 shadow-md">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={cn(
                  "w-full rounded-sm px-2 py-1.5 text-left text-xs transition-colors cursor-pointer hover:bg-accent",
                  value === opt.value && "bg-accent font-medium"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between py-1 cursor-pointer"
    >
      <span className="text-xs text-foreground">{label}</span>
      <div
        className={cn(
          "h-4 w-7 rounded-full transition-colors relative",
          checked ? "bg-primary" : "bg-border"
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0.5"
          )}
        />
      </div>
    </button>
  )
}

export function DisplayPopover({ config }: { config: DisplayPopoverConfig }) {
  const settings = useDisplaySettingsStore((s) => s.get(config.viewKey))
  const update = useDisplaySettingsStore((s) => s.update)
  const reset = useDisplaySettingsStore((s) => s.reset)

  const handleUpdate = (partial: Partial<DisplaySettings>) => {
    update(config.viewKey, partial)
  }

  const toggleProperty = (prop: string) => {
    const current = settings.visibleProperties
    const next = current.includes(prop)
      ? current.filter((p) => p !== prop)
      : [...current, prop]
    handleUpdate({ visibleProperties: next })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Display</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-3">
          {/* View as (layout variants) */}
          {config.viewAsOptions && config.viewAsOptions.length > 0 && (
            <>
              <div>
                <span className="text-[11px] font-semibold text-muted-foreground uppercase">View as</span>
                <div className="mt-1.5 flex items-center gap-1">
                  {config.viewAsOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => config.onViewAsChange?.(opt.value)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer capitalize",
                        config.activeViewAs === opt.value
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Grouping (board views) */}
          {config.columnByOptions && (
            <InlineSelect
              label="Grouping"
              value={settings.columnBy ?? "status"}
              options={config.columnByOptions}
              onChange={(v) => handleUpdate({ columnBy: v as "status" | "priority" | "milestone" })}
            />
          )}

          {/* Grouping / Highlight by (list/timeline/graph views — hidden when columnBy is shown) */}
          {!config.columnByOptions && config.groupByOptions.length > 0 && (
            <InlineSelect
              label={config.groupByLabel ?? "Grouping"}
              value={settings.groupBy}
              options={config.groupByOptions}
              onChange={(v) => handleUpdate({ groupBy: v })}
            />
          )}

          {/* Ordering */}
          {config.orderByOptions.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">Ordering</span>
              <div className="flex items-center gap-1">
                <div className="relative">
                  <InlineSelectInner
                    value={settings.orderBy}
                    options={config.orderByOptions}
                    onChange={(v) => handleUpdate({ orderBy: v })}
                  />
                </div>
                <button
                  onClick={() =>
                    handleUpdate({
                      orderDirection: settings.orderDirection === "asc" ? "desc" : "asc",
                    })
                  }
                  className="rounded-md bg-secondary p-1 hover:bg-secondary/80 transition-colors cursor-pointer"
                  title={settings.orderDirection === "asc" ? "Ascending" : "Descending"}
                >
                  {settings.orderDirection === "asc" ? (
                    <ArrowUp className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ArrowDown className="h-3 w-3 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Show completed */}
          <ToggleRow
            label="Show completed"
            checked={settings.showCompleted}
            onChange={(v) => handleUpdate({ showCompleted: v })}
          />

          {/* Zoom — timeline only */}
          {config.showZoom && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase">Zoom</span>
                <div className="flex items-center gap-0.5">
                  {(["month", "quarter", "year"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => handleUpdate({ zoom: level })}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs transition-colors cursor-pointer capitalize",
                        settings.zoom === level
                          ? "bg-accent font-semibold text-accent-foreground"
                          : "font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Timeline options */}
          {config.showTimelineOptions && (
            <>
              <ToggleRow
                label="Show project list"
                checked={settings.showProjectList ?? true}
                onChange={(v) => handleUpdate({ showProjectList: v })}
              />
              <ToggleRow
                label="Show empty groups"
                checked={settings.showEmptyGroups ?? false}
                onChange={(v) => handleUpdate({ showEmptyGroups: v })}
              />
            </>
          )}

          {config.propertyOptions.length > 0 && (
            <>
              <Separator />

              {/* Display properties */}
              <div>
                <span className="text-[11px] font-semibold text-muted-foreground uppercase">Properties</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {config.propertyOptions.map((prop) => {
                    const active = settings.visibleProperties.includes(prop.value)
                    return (
                      <button
                        key={prop.value}
                        onClick={() => toggleProperty(prop.value)}
                        className={cn(
                          "rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                          active
                            ? "bg-secondary text-foreground"
                            : "border border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {prop.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Reset */}
          <button
            onClick={() => reset(config.viewKey)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-left"
          >
            Reset to defaults
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Inner select without label — used in the ordering row alongside the direction toggle
function InlineSelectInner({
  value,
  options,
  onChange,
}: {
  value: string
  options: DisplayOption[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs hover:bg-secondary/80 transition-colors cursor-pointer"
      >
        {selected?.label ?? value}
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 min-w-[120px] rounded-md border bg-popover p-1 shadow-md">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={cn(
                "w-full rounded-sm px-2 py-1.5 text-left text-xs transition-colors cursor-pointer hover:bg-accent",
                value === opt.value && "bg-accent font-medium"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
