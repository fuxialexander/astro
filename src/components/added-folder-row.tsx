/**
 * AddedFolderRow — a row representing an extra folder to mount alongside the
 * primary working directory. Two modes:
 *   • working   — agent can edit (forced into a worktree)
 *   • reference — agent can read only
 *
 * Layout: [mode badge] [machine picker] [path input + browse] (on {branch})
 *         [worktree ✓ forced | -] [✕ remove]
 */

import { useState, useRef, useEffect } from "react"
import {
  BookOpen,
  Check,
  ChevronDown,
  FolderOpen,
  FolderEdit,
  GitBranch,
  Laptop,
  Lock,
  X,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { useDirectoryDetection } from "@/hooks/use-directory-detection"
import { cn } from "@/lib/utils"
import type { MachineInfo } from "@/stores/execution-store"

export interface AddedFolderRowProps {
  mode: 'working' | 'reference'
  machineId: string
  path: string
  machines: MachineInfo[]
  onMachineChange: (machineId: string) => void
  onPathChange: (path: string) => void
  onRemove: () => void
  disabled?: boolean
}

export function AddedFolderRow({
  mode,
  machineId,
  path,
  machines,
  onMachineChange,
  onPathChange,
  onRemove,
  disabled,
}: AddedFolderRowProps) {
  const [machineOpen, setMachineOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const hoverRef = useRef<ReturnType<typeof setTimeout>>(null)

  const selected = machines.find((m) => m.machineId === machineId) || null
  const { detection } = useDirectoryDetection(path, machineId)

  const handleEnter = () => {
    if (hoverRef.current) clearTimeout(hoverRef.current)
    hoverRef.current = setTimeout(() => setMachineOpen(true), 150)
  }
  const handleLeave = () => {
    if (hoverRef.current) clearTimeout(hoverRef.current)
    hoverRef.current = setTimeout(() => setMachineOpen(false), 200)
  }

  useEffect(() => {
    return () => {
      if (hoverRef.current) clearTimeout(hoverRef.current)
    }
  }, [])

  const isWorking = mode === 'working'

  return (
    <>
      <div className="flex items-center gap-1.5 pl-4">
        {/* Mode badge */}
        <span
          className={cn(
            "inline-flex items-center gap-1 h-7 px-2 rounded-md border text-[11px] font-medium shrink-0",
            isWorking
              ? "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400"
              : "border-muted-foreground/20 bg-muted/40 text-muted-foreground",
          )}
          title={isWorking ? "Agent can edit this folder (isolated in a worktree)" : "Read-only reference — agent can read but not write"}
        >
          {isWorking ? <FolderEdit className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
          <span>{isWorking ? 'working' : 'reference'}</span>
        </span>

        {/* Machine picker */}
        <Popover open={machineOpen} onOpenChange={setMachineOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled || machines.length === 0}
              onMouseEnter={handleEnter}
              onMouseLeave={handleLeave}
              className={cn(
                "shrink-0 flex items-center gap-1.5 h-7 px-2 rounded-md border text-[11px] transition-colors cursor-pointer",
                "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
                "disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-0",
              )}
            >
              <Laptop className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[120px]">{selected?.name || "Select machine"}</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="start" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
            {machines.map((m) => {
              const isSelected = machineId === m.machineId
              return (
                <button
                  key={m.machineId}
                  type="button"
                  onClick={() => { onMachineChange(m.machineId); setMachineOpen(false) }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer min-w-0",
                    isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground",
                  )}
                >
                  <Laptop className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{m.name}</span>
                  {m.status === "online" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
                  {isSelected && <Check className="h-3.5 w-3.5 ml-auto shrink-0" />}
                </button>
              )
            })}
            {machines.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">No machines connected</div>
            )}
          </PopoverContent>
        </Popover>

        {/* Browse button */}
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          disabled={disabled || !machineId}
          title="Browse directories"
          className="shrink-0 flex items-center justify-center h-7 w-7 rounded-md border border-border hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>

        {/* Path input */}
        <input
          type="text"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          disabled={disabled}
          placeholder="/path/to/other-folder"
          className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-background font-mono text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />

        {/* (on {currentBranch}) — fall back to "detached HEAD" so the user still
            sees the repo was detected. */}
        {detection?.isGit && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 shrink-0">
            <GitBranch className="h-3 w-3" />
            {detection.currentBranch ? `on ${detection.currentBranch}` : 'detached HEAD'}
          </span>
        )}

        {/* Worktree forced badge (working only) */}
        {isWorking && (
          <span
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-primary/30 bg-primary/5 text-primary text-[11px] font-medium shrink-0"
            title="Working folders are always isolated in a worktree"
          >
            <Lock className="h-3 w-3" />
            <span>worktree</span>
          </span>
        )}

        {/* Remove button */}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          title="Remove folder"
          className="shrink-0 flex items-center justify-center h-7 w-7 rounded-md border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors cursor-pointer text-muted-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Path browser dialog */}
      {machineId && (
        <RemotePathBrowser
          open={browserOpen}
          onOpenChange={setBrowserOpen}
          machineId={machineId}
          machineName={selected?.name}
          currentPath={path || undefined}
          onSelect={(p) => onPathChange(p)}
        />
      )}
    </>
  )
}
