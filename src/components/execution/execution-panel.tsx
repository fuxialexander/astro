import { useEffect, useRef } from "react"
import { Play, Square, CheckCircle2, XCircle, Clock, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useExecutionStore, canExecuteNode } from "@/stores/execution-store"
import { usePlanStore } from "@/stores/plan-store"
import type { PlanNode } from "@/types"

interface ExecutionPanelProps {
  node: PlanNode
  projectId: string
}

const statusConfig = {
  pending: { icon: Clock, label: "Pending", variant: "secondary" as const },
  running: { icon: Loader2, label: "Running", variant: "info" as const },
  success: { icon: CheckCircle2, label: "Success", variant: "success" as const },
  failure: { icon: XCircle, label: "Failed", variant: "destructive" as const },
  cancelled: { icon: Square, label: "Cancelled", variant: "secondary" as const },
}

export function ExecutionPanel({ node, projectId }: ExecutionPanelProps) {
  const outputRef = useRef<HTMLDivElement>(null)
  const nodes = usePlanStore((s) => s.nodes)

  const execution = useExecutionStore((s) => s.getExecution(node.id))
  const isExecuting = useExecutionStore((s) => s.isExecuting(node.id))
  const startExecution = useExecutionStore((s) => s.startExecution)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const getAvailableProvider = useExecutionStore((s) => s.getAvailableProvider)

  // Load providers on mount
  useEffect(() => {
    if (!providersLoaded) {
      loadProviders()
    }
  }, [providersLoaded, loadProviders])

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [execution?.streamText])

  // Check if node can be executed
  const canExecuteResult = canExecuteNode(node, nodes)
  const availableProvider = getAvailableProvider()

  // Determine if execute button should be enabled
  const canExecuteNow =
    canExecuteResult.ready &&
    !isExecuting &&
    node.status === "planned" &&
    availableProvider !== null

  const handleExecute = () => {
    startExecution(node.id, projectId)
  }

  const handleCancel = () => {
    cancelExecution(node.id)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Provider Status */}
      {providersLoaded && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Agent</span>
          {availableProvider ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {availableProvider.name}
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              No agent available
            </Badge>
          )}
        </div>
      )}

      {/* Dependency Status */}
      {!canExecuteResult.ready && (
        <div className="rounded-lg bg-status-warning/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-status-warning mt-0.5" />
            <div>
              <p className="font-medium text-status-warning">Dependencies not met</p>
              <p className="text-muted-foreground mt-1">{canExecuteResult.reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* Execute/Cancel Button */}
      <div className="flex gap-2">
        {isExecuting ? (
          <Button
            variant="destructive"
            size="sm"
            className="flex-1"
            onClick={handleCancel}
          >
            <Square className="h-3.5 w-3.5" />
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            className="flex-1"
            onClick={handleExecute}
            disabled={!canExecuteNow}
          >
            <Play className="h-3.5 w-3.5" />
            Execute
          </Button>
        )}
      </div>

      {/* Execution Status & Output */}
      {execution && (
        <>
          <Separator />

          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <ExecutionStatusBadge status={execution.status} />
          </div>

          {/* Timing */}
          {execution.startedAt && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Started</span>
              <span>{formatTime(execution.startedAt)}</span>
            </div>
          )}
          {execution.completedAt && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Duration</span>
              <span>{formatDuration(execution.startedAt, execution.completedAt)}</span>
            </div>
          )}

          {/* Error */}
          {execution.error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Error</p>
                  <p className="text-muted-foreground mt-1 font-mono text-xs">
                    {execution.error}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Output */}
          {execution.streamText && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Output</span>
              <ScrollArea className="h-[200px] rounded-lg bg-muted p-3" ref={outputRef}>
                <pre className="font-mono text-xs whitespace-pre-wrap break-all">
                  {execution.streamText}
                </pre>
              </ScrollArea>
            </div>
          )}
        </>
      )}

      {/* Empty state for node output from previous execution */}
      {!execution && node.executionOutput && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Previous Output</span>
            <ScrollArea className="h-[200px] rounded-lg bg-muted p-3">
              <pre className="font-mono text-xs whitespace-pre-wrap break-all">
                {node.executionOutput}
              </pre>
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  )
}

function ExecutionStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending
  const Icon = config.icon

  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />
      {config.label}
    </Badge>
  )
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatDuration(start: Date, end: Date): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}
