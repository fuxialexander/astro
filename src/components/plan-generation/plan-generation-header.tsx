/**
 * Plan Generation Header
 *
 * Shows project name, status badge, abort button, and optional machine/directory info.
 */

import { Loader2, X, Laptop, CheckCircle2, AlertCircle, XCircle, ChevronLeft, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type PlanGenerationStatus = 'planning' | 'waiting' | 'completed' | 'error' | 'stopped'

interface PlanGenerationHeaderProps {
  projectName: string
  status: PlanGenerationStatus
  machineName?: string
  workingDirectory?: string
  onAbort: () => void
  onBack?: () => void
  onNewPlan?: () => void
}

export function PlanGenerationHeader({
  projectName,
  status,
  machineName,
  workingDirectory,
  onAbort,
  onBack,
  onNewPlan,
}: PlanGenerationHeaderProps) {
  const statusConfig: Record<PlanGenerationStatus, { label: string; color: string; icon: React.ReactNode }> = {
    planning: {
      label: "Planning",
      color: "bg-primary/10 text-primary",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    waiting: {
      label: "Waiting for input",
      color: "bg-warning/10 text-warning",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    completed: {
      label: "Completed",
      color: "bg-success/10 text-success",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    error: {
      label: "Error",
      color: "bg-destructive/10 text-destructive",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    stopped: {
      label: "Stopped",
      color: "bg-muted text-muted-foreground",
      icon: <XCircle className="h-3 w-3" />,
    },
  }

  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold truncate">{projectName}</h2>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn("flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full font-medium", config.color)}>
            {config.icon}
            {config.label}
          </span>
          {machineName && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Laptop className="h-3 w-3" />
              {machineName}
            </span>
          )}
          {workingDirectory && (
            <span className="text-[10px] text-muted-foreground truncate font-mono">
              {workingDirectory}
            </span>
          )}
        </div>
      </div>

      {onNewPlan && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewPlan}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Plan
        </Button>
      )}

      {(status === 'planning' || status === 'waiting') && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAbort}
          className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Stop
        </Button>
      )}
    </div>
  )
}
