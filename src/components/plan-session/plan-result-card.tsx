/**
 * Plan Result Card
 *
 * Shows when plan JSON is extracted from the final output.
 * Displays node/edge counts and a "View Plan" navigation button.
 */

import { useNavigate } from "react-router"
import { CheckCircle2, ArrowRight, GitBranch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PlanResultCardProps {
  projectId: string
  projectName: string
  nodeCount: number
  edgeCount: number
  milestoneNames: string[]
  status: 'success' | 'partial'
}

export function PlanResultCard({
  projectId,
  projectName,
  nodeCount,
  edgeCount,
  milestoneNames,
  status,
}: PlanResultCardProps) {
  const navigate = useNavigate()

  const statusColor = status === 'success'
    ? 'border-success/30 bg-success/5'
    : 'border-warning/30 bg-warning/5'

  const statusBadge = status === 'success'
    ? 'bg-success/10 text-success'
    : 'bg-warning/10 text-warning'

  return (
    <div className={cn("mx-4 my-3 rounded-lg border p-4", statusColor)}>
      <div className="flex items-start gap-3">
        <CheckCircle2 className={cn(
          "h-5 w-5 mt-0.5 shrink-0",
          status === 'success' ? "text-success" : "text-warning"
        )} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold">Plan Created</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", statusBadge)}>
              {status}
            </span>
          </div>

          <p className="text-sm text-foreground font-medium mb-2">{projectName}</p>

          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
            <span>{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
            <span>{edgeCount} edge{edgeCount !== 1 ? 's' : ''}</span>
            {milestoneNames.length > 0 && (
              <span className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                {milestoneNames.length} milestone{milestoneNames.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {milestoneNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {milestoneNames.map((name) => (
                <span
                  key={name}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                >
                  {name}
                </span>
              ))}
            </div>
          )}

          <Button
            size="sm"
            onClick={() => navigate(`/project/${projectId}/graph`)}
            className="gap-1.5"
          >
            View Plan
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
