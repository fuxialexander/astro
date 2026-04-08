import { useState, useMemo } from "react"
import { XCircle, GitBranch, FolderX } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useToastStore } from "@/stores/toast-store"
import { statusLabels } from "@/lib/status-config"
import { cn } from "@/lib/utils"
import type { PlanNode } from "@/types"

interface PruneCleanupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: PlanNode
  projectId: string
}

export function PruneCleanupDialog({ open, onOpenChange, node, projectId }: PruneCleanupDialogProps) {
  const [deleteBranches, setDeleteBranches] = useState(true)
  const [deleteOutputs, setDeleteOutputs] = useState(true)
  const [isPruning, setIsPruning] = useState(false)

  const allNodes = usePlanStore((s) => s.nodes)
  const updateNode = usePlanStore((s) => s.updateNode)

  // For milestones, find all child tasks
  const childTasks = useMemo(() => {
    if (node.type !== 'milestone') return []
    return allNodes.filter(
      (n) => isLive(n) && n.milestoneId === node.id && n.id !== node.id && n.status !== 'pruned'
    )
  }, [node.id, node.type, allNodes])

  const isMilestone = node.type === 'milestone'
  const nodesToPrune = isMilestone ? childTasks : []
  const hasOutputDirs = isMilestone
    ? childTasks.some((t) => (t.metadata as Record<string, unknown> | undefined)?.outputDir)
    : !!(node.metadata as Record<string, unknown> | undefined)?.outputDir

  const handlePrune = async (withCleanup: boolean) => {
    setIsPruning(true)
    try {
      if (isMilestone) {
        usePlanStore.getState().pruneMilestone(node.id)
      } else {
        updateNode(node.id, { status: 'pruned' })
      }

      // Request cleanup on the machine if branches/outputs should be deleted
      if (withCleanup && (deleteBranches || deleteOutputs)) {
        const nodeIds = isMilestone ? [node.id, ...childTasks.map((t) => t.id)] : [node.id]
        try {
          const { getAccessToken } = await import("@/lib/supabase-client")
          const { apiUrl } = await import("@/lib/api-url")
          const token = await getAccessToken()
          const headers: HeadersInit = { "Content-Type": "application/json" }
          if (token) headers["Authorization"] = `Bearer ${token}`
          await fetch(apiUrl("/api/dispatch/prune-cleanup"), {
            method: "POST",
            headers,
            body: JSON.stringify({ nodeIds, projectId, deleteBranches, deleteOutputs }),
          })
        } catch (err) {
          console.warn("[prune-cleanup] Cleanup request failed:", err)
          useToastStore.getState().add({ type: "warning", title: "Cleanup scheduling failed", description: "Branches and outputs may not be deleted automatically." })
        }
      }
    } finally {
      setIsPruning(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive" />
            Prune {isMilestone ? `"${node.title}"` : "Task"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isMilestone && nodesToPrune.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">
                This will prune {nodesToPrune.length} task{nodesToPrune.length !== 1 ? 's' : ''}:
              </p>
              <div className="rounded-md border bg-muted/30 px-3 py-2 max-h-40 overflow-y-auto">
                {nodesToPrune.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-1 text-sm">
                    <span className="truncate mr-2">{t.title}</span>
                    <span className={cn(
                      "text-xs shrink-0",
                      t.status === 'completed' || t.status === 'auto_verified'
                        ? "text-green-600 dark:text-green-400"
                        : t.status === 'in_progress' || t.status === 'dispatched'
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-muted-foreground"
                    )}>
                      {statusLabels[t.status] || t.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isMilestone && (
            <p className="text-sm text-muted-foreground">
              Prune &ldquo;{node.title}&rdquo; and clean up associated resources.
            </p>
          )}

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={deleteBranches}
                onChange={(e) => setDeleteBranches(e.target.checked)}
                className="rounded border-border"
              />
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              Delete code branches (recommended)
            </label>
            {hasOutputDirs && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteOutputs}
                  onChange={(e) => setDeleteOutputs(e.target.checked)}
                  className="rounded border-border"
                />
                <FolderX className="h-3.5 w-3.5 text-muted-foreground" />
                Delete output files in analysis/
              </label>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Output files will be moved to .trash/ and automatically deleted after 7 days.
          </p>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isPruning}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePrune(false)} disabled={isPruning}>
              Prune Only
            </Button>
            <Button variant="destructive" size="sm" onClick={() => handlePrune(true)} disabled={isPruning}>
              {isPruning ? "Pruning..." : "Prune & Clean Up"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
