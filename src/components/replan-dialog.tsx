import { useState, useMemo } from "react"
import { RefreshCw, AlertTriangle } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { Project, PlanNode } from "@/types"

interface ReplanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  nodes: PlanNode[]
}

export function ReplanDialog({ open, onOpenChange, project, nodes }: ReplanDialogProps) {
  const [changeDescription, setChangeDescription] = useState("")
  const [isRegenerating, setIsRegenerating] = useState(false)

  const stats = useMemo(() => {
    const completed = nodes.filter((n) => n.status === "completed" || n.status === "auto_verified")
    const inProgress = nodes.filter((n) => n.status === "in_progress" || n.status === "dispatched")
    const planned = nodes.filter((n) => n.status === "planned")
    return { completed: completed.length, inProgress: inProgress.length, planned: planned.length, total: nodes.length }
  }, [nodes])

  const hasRunningTasks = stats.inProgress > 0

  const handleRegenerate = async () => {
    setIsRegenerating(true)
    try {
      // TODO: integrate with startReplanSession once replan backend is wired
      // For now, close the dialog
      onOpenChange(false)
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Regenerate Plan
          </DialogTitle>
          <DialogDescription>
            Replace the current plan with a new AI-generated plan for &ldquo;{project.name}&rdquo;.
          </DialogDescription>
        </DialogHeader>

        {/* Stats summary */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border p-2">
            <div className="text-lg font-semibold">{stats.completed}</div>
            <div className="text-xs text-muted-foreground">Completed</div>
          </div>
          <div className="rounded-lg border p-2">
            <div className="text-lg font-semibold">{stats.inProgress}</div>
            <div className="text-xs text-muted-foreground">In Progress</div>
          </div>
          <div className="rounded-lg border p-2">
            <div className="text-lg font-semibold">{stats.planned}</div>
            <div className="text-xs text-muted-foreground">Planned</div>
          </div>
        </div>

        {/* Running task warning */}
        {hasRunningTasks && (
          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <span className="text-yellow-700 dark:text-yellow-400">
              {stats.inProgress} task{stats.inProgress > 1 ? "s are" : " is"} currently running.
              They will be cancelled before regeneration.
            </span>
          </div>
        )}

        {/* Change description */}
        <div className="space-y-2">
          <label htmlFor="change-description" className="text-sm font-medium">
            What should change? <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="change-description"
            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            placeholder="Describe what you want different in the new plan..."
            value={changeDescription}
            onChange={(e) => setChangeDescription(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRegenerating}>
            Cancel
          </Button>
          <Button onClick={handleRegenerate} disabled={isRegenerating}>
            {isRegenerating ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Regenerating...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
