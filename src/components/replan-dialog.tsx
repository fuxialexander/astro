import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { Archive, AlertTriangle, Loader2 } from "lucide-react"
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
  const { t } = useTranslation('dialogs')
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
      // Get live nodes and edges BEFORE archiving (for lessons extraction)
      const liveNodes = nodes.filter((n) => isLive(n) && n.projectId === project.id)
      const liveNodeIds = new Set(liveNodes.map((n) => n.id))
      const liveEdges = edges.filter(
        (e) => isLive(e) && (liveNodeIds.has(e.source) || liveNodeIds.has(e.target))
      )

      // Extract lessons and build summary from current plan
      const lessons = extractLessonsFromPlan(liveNodes)
      const previousPlanSummary = buildPreviousPlanSummary(liveNodes, liveEdges)

      // Start the replan session FIRST — if this fails (network, auth),
      // the original plan remains untouched.
      await useExecutionStore.getState().startReplanSession(
        project.id,
        changeDescription || undefined,
        lessons,
        previousPlanSummary,
        { visionDoc: project.visionDoc }
      )

      // Replan dispatch succeeded — now safe to archive the old plan.
      // The deletionActionId groups all archived nodes for potential restoration.
      const archivedNodeIds = usePlanStore.getState().archiveProjectForReplan(project.id)

      // Await bulkResetTasks to ensure execution state is consistent
      if (archivedNodeIds.length > 0) {
        try {
          await bulkResetTasks(archivedNodeIds, project.id)
        } catch (err) {
          console.error("[replan-dialog] bulkResetTasks failed:", err)
        }
      }

      onOpenChange(false)
      // Navigate to the project page
      navigate(`/project/${project.id}`)
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
            <Archive className="h-4 w-4" />
            {t('replan.regenerateTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('replan.regenerateDescription')}
          </DialogDescription>
        </DialogHeader>

        {/* Stats section */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{stats.total}</span> {t('replan.totalTasks')}
          </div>
          <div>
            <span className="font-medium text-foreground">{stats.completed}</span> {t('replan.completed')}
          </div>
          {stats.withPrs > 0 && (
            <div>
              <span className="font-medium text-foreground">{stats.withPrs}</span> {t('replan.withOpenPrs')}
            </div>
          )}
        </div>

        {/* Change description textarea */}
        <div className="space-y-2">
          <label htmlFor="change-description" className="text-sm font-medium">
            {t('replan.whatShouldChange')}
          </label>
          <Textarea
            id="change-description"
            placeholder={t('replan.changePlaceholder')}
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
              {t('replan.runningWarning')}
            </span>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            onClick={handleRegenerate}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('replan.regenerating')}
              </>
            ) : (
              <>
                <Archive className="h-4 w-4" />
                {t('replan.archiveAndRegenerate', 'Archive & Regenerate')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
