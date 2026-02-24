import { useMemo } from "react"
import { Cpu, Activity, Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { formatDuration } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import { statusBadgeVariants } from "@/lib/status-config"

export function Agents() {
  const executions = useExecutionStore((s) => s.executions)
  const taskStreams = useRealtimeStore((s) => s.taskStreams)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const projects = useProjectStore((s) => s.projects)

  // Get all nodes that are currently executing
  const executingNodes = nodes.filter(
    (node) => node.status === "in_progress" || node.status === "dispatched"
  )

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#60A5FA] via-[#3B82F6] to-[#2563EB]">
            <Cpu className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Running Agents</h1>
            <p className="text-sm text-muted-foreground">
              {executingNodes.length} active task{executingNodes.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {executingNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Cpu className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">No Active Agents</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Agent tasks will appear here when they're running
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {executingNodes.map((node) => {
              const project = projects.find((p) => p.id === node.projectId)
              const execution = executions.get(node.id)
              const stream = node.executionId ? taskStreams.get(node.executionId) : undefined
              const progress = stream?.progress ?? 0
              const isRunning = node.status === "in_progress"

              return (
                <div
                  key={node.id}
                  className={cn(
                    "flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:bg-accent/5",
                    isRunning && "border-info/30 bg-info/5"
                  )}
                >
                  {/* Header Row */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-base truncate">{node.title}</h3>
                        <Badge variant={statusBadgeVariants[node.status]} className="text-xs">
                          {node.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      {project && (
                        <p className="text-sm text-muted-foreground truncate">
                          {project.name} · {node.type}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isRunning && (
                        <Activity className="h-4 w-4 text-info animate-pulse" />
                      )}
                      {node.executionStartedAt && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{formatDuration(node.executionStartedAt, node.executionCompletedAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {isRunning && progress > 0 && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-info transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-info shrink-0 w-10 text-right">
                        {progress}%
                      </span>
                    </div>
                  )}

                  {/* Execution Info */}
                  {execution && (
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                      {execution.machineId && (
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-success" />
                          <span className="font-mono">{execution.machineId.slice(0, 16)}</span>
                        </div>
                      )}
                      {execution.providerId && (
                        <div className="flex items-center gap-1.5">
                          <Cpu className="h-3 w-3" />
                          <span className="capitalize">{execution.providerId}</span>
                        </div>
                      )}
                      {execution.executionId && (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono">{execution.executionId.slice(0, 20)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
