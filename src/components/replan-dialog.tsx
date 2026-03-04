import { useState, useMemo } from "react"
import { useNavigate } from "react-router"
import { RefreshCw, AlertTriangle, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useToastStore } from "@/stores/toast-store"
import { extractLessonsFromPlan, buildPreviousPlanSummary } from "@/lib/replan-utils"
import { bulkResetTasks } from "@/lib/api-client"
import type { Project } from "@/types"

interface ReplanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
}

export function ReplanDialog({ open, onOpenChange, project }: ReplanDialogProps) {
  const navigate = useNavigate()
  const [changeDescription, setChangeDescription] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)

  const nodes = usePlanStore((s) => s.nodes)
  const edges = usePlanStore((s) => s.edges)

  const stats = useMemo(() => {
    const liveNodes = nodes.filter((n) => isLive(n) && n.projectId === project.id)
    const total = liveNodes.length
    const completed = liveNodes.filter(
      (n) => n.status === "completed" || n.status === "auto_verified"
    ).length
    const withPrs = liveNodes.filter((n) => n.prUrl).length
    const running = liveNodes.filter(
      (n) => n.status === "dispatched" || n.status === "in_progress"
    ).length
    return { total, completed, withPrs, running }
  }, [nodes, project.id])

  const handleRegenerate = async () => {
    setIsProcessing(true)
    try {
      // Get live nodes and edges
      const liveNodes = nodes.filter((n) => isLive(n) && n.projectId === project.id)
      const liveNodeIds = new Set(liveNodes.map((n) => n.id))
      const liveEdges = edges.filter(
        (e) => isLive(e) && (liveNodeIds.has(e.source) || liveNodeIds.has(e.target))
      )

      // Extract lessons and build summary
      const lessons = extractLessonsFromPlan(liveNodes)
      const previousPlanSummary = buildPreviousPlanSummary(liveNodes, liveEdges)

      // Archive all live nodes for this project
      const archivedNodeIds = usePlanStore.getState().archiveProjectForReplan(project.id)

      // Fire-and-forget: reset tasks on the backend
      if (archivedNodeIds.length > 0) {
        bulkResetTasks(archivedNodeIds, project.id).catch((err) => {
          console.error("[replan-dialog] bulkResetTasks failed:", err)
        })
      }

      // Start the replan session
      await useExecutionStore.getState().startReplanSession(
        project.id,
        changeDescription || undefined,
        lessons,
        previousPlanSummary,
        { visionDoc: project.visionDoc }
      )

      onOpenChange(false)
      // Navigate to the plan activity page to show generation progress
      navigate(`/plan?projectId=${project.id}`)
    } catch (error) {
      console.error("[replan-dialog] Replan failed:", error)
      useToastStore.getState().add({
        type: "error",
        title: "Replan failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
      })
      setIsProcessing(false)
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
            This will archive your current tasks, gather lessons from execution history,
            and generate a new plan.
          </DialogDescription>
        </DialogHeader>

        {/* Stats section */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{stats.total}</span> total tasks
          </div>
          <div>
            <span className="font-medium text-foreground">{stats.completed}</span> completed
          </div>
          {stats.withPrs > 0 && (
            <div>
              <span className="font-medium text-foreground">{stats.withPrs}</span> with open PRs
            </div>
          )}
        </div>

        {/* Change description textarea */}
        <div className="space-y-2">
          <label htmlFor="change-description" className="text-sm font-medium">
            What should change?
          </label>
          <Textarea
            id="change-description"
            placeholder="Describe what you'd like different in the new plan (optional)"
            value={changeDescription}
            onChange={(e) => setChangeDescription(e.target.value)}
            className="min-h-[80px] resize-none"
            disabled={isProcessing}
          />
        </div>

        {/* Warning banner for running tasks */}
        {stats.running > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
            <span>
              Some tasks are currently running. They will be cancelled.
            </span>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleRegenerate}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Regenerating...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
