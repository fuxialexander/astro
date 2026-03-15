import { useState, useCallback } from "react"
import { FolderOpen, HardDrive, Info, Loader2, GitFork, CheckCircle2 } from "lucide-react"
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="fixed left-1/2 top-[18vh] w-full max-w-[500px] -translate-x-1/2 animate-in fade-in slide-in-from-top-2 duration-200">
        <div className="gh-card overflow-hidden rounded-xl border border-border/50">
          {/* Header */}
          <div className="border-b border-border/40 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                <GitFork className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Configure Workspace</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Set up a working directory so agents can run tasks on this repo.
                </p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="space-y-5 px-6 py-5">
            {/* Info banner */}
            <div className="flex gap-3 rounded-lg border border-info/15 bg-info/[0.04] px-4 py-3">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
              <div className="text-[12px] leading-relaxed text-muted-foreground">
                Point this to your local clone of{" "}
                <span className="font-semibold text-foreground">
                  {project.githubOwner}/{project.githubRepo}
                </span>
                .
                <br />
                <span className="text-muted-foreground/70">
                  Agents work in isolated git worktrees — your local files stay untouched.
                </span>
              </div>
            </div>

            {/* Working directory */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                <FolderOpen className="h-3 w-3" />
                Working Directory
              </label>
              <Input
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                placeholder="/path/to/your/repo"
                className="h-9 border-border/50 bg-background/50 font-mono text-xs transition-colors focus:border-primary/50 focus:bg-background"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                Absolute path to your cloned repo. You can change this later in project settings.
              </p>
            </div>

            {/* Machine selection */}
            {connectedMachines.length > 0 && (
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  <HardDrive className="h-3 w-3" />
                  Machine
                  <span className="font-normal normal-case tracking-normal text-muted-foreground/50">
                    (optional)
                  </span>
                </label>
                <div className="space-y-1.5">
                  {connectedMachines.map((machine) => (
                    <MachineOption
                      key={machine.machineId}
                      machine={machine}
                      selected={selectedMachine === machine.machineId}
                      onClick={() =>
                        setSelectedMachine(
                          selectedMachine === machine.machineId ? "" : machine.machineId,
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2.5 border-t border-border/40 px-6 py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="border-border/50 text-[12px]"
            >
              Cancel
            </Button>
            <button
              className="gh-action-btn flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold disabled:pointer-events-none disabled:opacity-40"
              onClick={() => void handleSave()}
              disabled={!workingDir.trim() || saving}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Save & Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MachineOption({
  machine,
  selected,
  onClick,
}: {
  machine: MachineEntry
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-xs transition-all duration-150",
        selected
          ? "border-primary/40 bg-primary/[0.06] shadow-[0_0_0_1px_rgba(var(--primary-rgb),0.1)]"
          : "border-border/40 hover:border-border/60 hover:bg-muted/20",
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
          selected ? "bg-primary/10" : "bg-muted/30",
        )}
      >
        <HardDrive
          className={cn(
            "h-3.5 w-3.5 transition-colors",
            selected ? "text-primary" : "text-muted-foreground/60",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <span className={cn("font-medium", selected && "text-foreground")}>
          {machine.name || machine.machineId}
        </span>
      </div>
      {selected && (
        <div className="flex items-center gap-1 text-[10px] font-semibold text-primary">
          <CheckCircle2 className="h-3 w-3" />
          Selected
        </div>
      )}
    </button>
  )
}
