import { useState, useCallback } from "react"
import { FolderOpen, HardDrive, Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useProjectStore } from "@/stores/project-store"
import { useRealtimeStore, type MachineEntry } from "@/stores/realtime-store"
import { cn } from "@/lib/utils"
import type { Project } from "@/types"

interface WorkspaceConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  onConfigured: () => void
}

export function WorkspaceConfigDialog({ open, onOpenChange, project, onConfigured }: WorkspaceConfigDialogProps) {
  const machines = useRealtimeStore((s) => s.machines)
  const updateProject = useProjectStore((s) => s.updateProject)

  const [workingDir, setWorkingDir] = useState(project.workingDirectory ?? "")
  const [selectedMachine, setSelectedMachine] = useState(project.defaultMachineId ?? "")
  const [saving, setSaving] = useState(false)

  const connectedMachines = Array.from(machines.values()).filter((m) => m.connectionStatus === "connected")

  const handleSave = useCallback(async () => {
    if (!workingDir.trim()) return
    setSaving(true)
    try {
      const updates: Partial<Project> = { workingDirectory: workingDir.trim() }
      if (selectedMachine) updates.defaultMachineId = selectedMachine
      updateProject(project.id, updates)
      onOpenChange(false)
      onConfigured()
    } finally {
      setSaving(false)
    }
  }, [workingDir, selectedMachine, project.id, updateProject, onOpenChange, onConfigured])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/60" onClick={() => onOpenChange(false)} />
      <div className="fixed left-1/2 top-[20vh] w-full max-w-[480px] -translate-x-1/2 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Configure Workspace</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set up a working directory so agents can run tasks on this repo.
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Info banner */}
          <div className="flex gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div>
              Point this to your local clone of <span className="font-medium text-foreground">{project.githubOwner}/{project.githubRepo}</span>.
              Agents work in isolated git worktrees — your local files stay untouched.
            </div>
          </div>

          {/* Working directory */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <FolderOpen className="h-3 w-3" />
              Working Directory
            </label>
            <Input
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              placeholder="/path/to/your/repo"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Absolute path to your cloned repo. You can change this later in project settings.
            </p>
          </div>

          {/* Machine selection */}
          {connectedMachines.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <HardDrive className="h-3 w-3" />
                Machine (optional)
              </label>
              <div className="space-y-1">
                {connectedMachines.map((machine) => (
                  <MachineOption
                    key={machine.machineId}
                    machine={machine}
                    selected={selectedMachine === machine.machineId}
                    onClick={() => setSelectedMachine(selectedMachine === machine.machineId ? "" : machine.machineId)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={!workingDir.trim() || saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Save & Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

function MachineOption({ machine, selected, onClick }: { machine: MachineEntry; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
        selected
          ? "border-primary/50 bg-primary/5 text-foreground"
          : "border-border/60 hover:bg-muted/30"
      )}
    >
      <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">{machine.name || machine.machineId}</span>
      </div>
      {selected && <span className="text-[10px] text-primary font-medium">Selected</span>}
    </button>
  )
}
