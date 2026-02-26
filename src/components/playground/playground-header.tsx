/**
 * Playground Session Header
 *
 * Compact header bar showing session title, machine info, status, and controls.
 */

import { ArrowLeft, Loader2, X, Laptop, CheckCircle2, AlertCircle, PanelRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type PlaygroundStatus = 'running' | 'waiting' | 'completed' | 'error'

interface PlaygroundHeaderProps {
  title: string
  status: PlaygroundStatus
  machineName?: string
  workingDirectory?: string
  fileSidebarOpen: boolean
  onBack: () => void
  onAbort: () => void
  onToggleFileSidebar: () => void
  onStartPlan?: () => void
}

export function PlaygroundHeader({
  title,
  status,
  machineName,
  workingDirectory,
  fileSidebarOpen,
  onBack,
  onAbort,
  onToggleFileSidebar,
  onStartPlan,
}: PlaygroundHeaderProps) {
  const statusConfig: Record<PlaygroundStatus, { label: string; color: string; icon: React.ReactNode }> = {
    running: {
      label: "Running",
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
  }

  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold truncate">{title}</h2>
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

      {status === 'completed' && onStartPlan && (
        <Button
          variant="outline"
          size="sm"
          onClick={onStartPlan}
          className="shrink-0 gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Plan from this
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 shrink-0", fileSidebarOpen && "bg-muted")}
        onClick={onToggleFileSidebar}
        title="Toggle file sidebar"
      >
        <PanelRight className="h-4 w-4" />
      </Button>

      {(status === 'running' || status === 'waiting') && (
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
