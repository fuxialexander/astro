/**
 * MachineWorkdirSelector — unified machine + working directory selector.
 *
 * Layout: [Recent] [Machine ▾] [Path input + Browse]
 *
 * The path section animates in once a machine is selected (either via dropdown
 * or by picking a recent machine:path combo). Used consistently across
 * playground, plan generation, repo-config-dialog, and plan-canvas.
 */

import { useState, useRef, useMemo } from "react"
import {
  Clock,
  Laptop,
  FolderOpen,
  Search,
  ChevronDown,
  Check,
} from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useRecentWorkdirs, type RecentWorkdir } from "@/hooks/use-recent-workdirs"
import { formatRelativeTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import type { MachineInfo } from "@/stores/execution-store"

// ─── Props ───────────────────────────────────────────────────────
export interface MachineWorkdirSelectorProps {
  /** All available machines */
  machines: MachineInfo[]
  /** Currently selected machine (controlled) */
  selectedMachine: MachineInfo | null
  /** Called when machine changes */
  onMachineChange: (machine: MachineInfo | null) => void
  /** Current working directory path (controlled) */
  workingDir: string
  /** Called when working directory changes */
  onWorkingDirChange: (path: string) => void
  /** Called when user clicks the folder-browse button */
  onBrowse?: () => void
  /** Disable all inputs */
  disabled?: boolean
  /** Compact mode for inline/canvas use */
  compact?: boolean
  /** Optional extra content rendered after the path input (e.g. InstructionPicker) */
  renderMachineExtra?: (machine: MachineInfo) => React.ReactNode
  /** Optional content rendered at the end of the path row (e.g. BranchSelector) */
  renderAfterPath?: React.ReactNode
  /** Label for the machine section */
  machineLabel?: string
  /** Label for the directory section */
  dirLabel?: string
  /** Make directory required (show asterisk) */
  dirRequired?: boolean
  /** Placeholder for path input */
  dirPlaceholder?: string
}

export function MachineWorkdirSelector({
  machines,
  selectedMachine,
  onMachineChange,
  workingDir,
  onWorkingDirChange,
  onBrowse,
  disabled,
  compact,
  renderMachineExtra,
  machineLabel = "Machine",
  dirLabel = "Working directory",
  dirRequired,
  dirPlaceholder = "/path/to/project",
  renderAfterPath,
}: MachineWorkdirSelectorProps) {
  const [recentOpen, setRecentOpen] = useState(false)
  const [machineOpen, setMachineOpen] = useState(false)
  const [recentFilter, setRecentFilter] = useState("")
  const pathRef = useRef<HTMLDivElement>(null)

  // Recent workdirs (no machine filter — shows all combos)
  const recentWorkdirs = useRecentWorkdirs()

  const filteredRecent = useMemo(() => {
    if (!recentFilter.trim()) return recentWorkdirs
    const q = recentFilter.toLowerCase()
    return recentWorkdirs.filter(
      (w) =>
        w.workingDirectory.toLowerCase().includes(q) ||
        w.machineName.toLowerCase().includes(q)
    )
  }, [recentWorkdirs, recentFilter])

  function handleRecentSelect(item: RecentWorkdir) {
    // Find matching machine object
    const machine = machines.find((m) => m.machineId === item.machineId)
    if (machine) onMachineChange(machine)
    onWorkingDirChange(item.workingDirectory)
    setRecentOpen(false)
    setRecentFilter("")
  }

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-1.5">
      {false && !compact && (
        <span className="text-xs text-muted-foreground">
          {machineLabel} &amp; {dirLabel}
          {dirRequired && <span className="text-destructive ml-0.5">*</span>}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        {/* ── Recent button ─────────────────────────────── */}
        {recentWorkdirs.length > 0 && (
          <Popover open={recentOpen} onOpenChange={setRecentOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                title="Recent machine:path combos"
                className={cn(
                  "shrink-0 flex items-center justify-center rounded-md border border-border hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed",
                  compact ? "h-7 w-7" : "h-8 w-8",
                )}
              >
                <Clock className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              {/* Search */}
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  type="text"
                  value={recentFilter}
                  onChange={(e) => setRecentFilter(e.target.value)}
                  placeholder="Filter recent..."
                  className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
                  autoFocus
                />
              </div>

              {/* Items */}
              <div className="max-h-64 overflow-y-auto p-1">
                {filteredRecent.length === 0 && (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    No recent working directories
                  </div>
                )}
                {filteredRecent.map((item) => {
                  const isCurrentCombo =
                    selectedMachine?.machineId === item.machineId &&
                    workingDir === item.workingDirectory
                  return (
                    <button
                      key={`${item.machineId}|${item.workingDirectory}`}
                      type="button"
                      onClick={() => handleRecentSelect(item)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted transition-colors cursor-pointer",
                        isCurrentCombo && "bg-muted/60",
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <code className="text-xs font-mono text-foreground truncate">
                          {item.workingDirectory}
                        </code>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {item.machineName}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(new Date(item.lastUsedAt))}
                        </span>
                        {item.useCount > 1 && (
                          <span className="text-[10px] text-muted-foreground">
                            ({item.useCount}x)
                          </span>
                        )}
                        {isCurrentCombo && (
                          <Check className="h-3 w-3 text-primary ml-auto shrink-0" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* ── Machine dropdown ──────────────────────────── */}
        <Popover open={machineOpen} onOpenChange={setMachineOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled || machines.length === 0}
              className={cn(
                "shrink-0 flex items-center gap-1.5 rounded-md border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                compact ? "h-7 px-2 text-[11px]" : "h-8 px-2.5 text-xs",
                "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <Laptop className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5", "shrink-0")} />
              <span className="truncate max-w-[120px]">
                {selectedMachine?.name || "Select machine"}
              </span>
              <ChevronDown className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5", "shrink-0 opacity-50")} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="start">
            {machines.map((m) => {
              const isSelected = selectedMachine?.machineId === m.machineId
              return (
                <div key={m.machineId} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      onMachineChange(isSelected ? null : m)
                      setMachineOpen(false)
                    }}
                    className={cn(
                      "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer min-w-0",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted text-foreground",
                    )}
                  >
                    <Laptop className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{m.name}</span>
                    {m.status === "online" && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    )}
                    {isSelected && <Check className="h-3.5 w-3.5 ml-auto shrink-0" />}
                  </button>
                  {renderMachineExtra?.(m)}
                </div>
              )
            })}
            {machines.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                No machines connected
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* ── Path input (animated slide-in) ────────────── */}
        <div
          ref={pathRef}
          className={cn(
            "flex items-center gap-1.5 min-w-0 transition-all duration-300 ease-out",
            selectedMachine
              ? "flex-1 opacity-100 translate-x-0"
              : "w-0 opacity-0 -translate-x-2 overflow-hidden pointer-events-none",
          )}
        >
          {onBrowse && (
            <button
              type="button"
              onClick={onBrowse}
              disabled={disabled}
              title="Browse directories"
              className={cn(
                "shrink-0 flex items-center justify-center rounded-md border border-border hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed",
                compact ? "h-7 w-7" : "h-8 w-8",
              )}
            >
              <FolderOpen className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
            </button>
          )}
          <input
            type="text"
            value={workingDir}
            onChange={(e) => onWorkingDirChange(e.target.value)}
            placeholder={dirPlaceholder}
            disabled={disabled}
            className={cn(
              "flex-1 min-w-0 rounded-md border border-border bg-background font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50",
              compact ? "h-7 px-2 text-[11px]" : "h-8 px-2.5 text-xs",
            )}
          />
          {renderAfterPath}
        </div>
      </div>
    </div>
  )
}
