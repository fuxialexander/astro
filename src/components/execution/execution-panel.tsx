import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { Play, Square, CheckCircle2, XCircle, Clock, Loader2, AlertCircle, ExternalLink, Server, Laptop, Cloud, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useExecutionStore, canExecuteNode, type ExecutionOptions, type MachineInfo } from "@/stores/execution-store"
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

const environmentConfig = {
  local: { icon: Laptop, label: "Local", description: "Run on local machine" },
  hpc: { icon: Server, label: "HPC", description: "Run on HPC cluster" },
  cloud: { icon: Cloud, label: "Cloud", description: "Run on cloud instance" },
}

export function ExecutionPanel({ node, projectId }: ExecutionPanelProps) {
  const outputRef = useRef<HTMLDivElement>(null)
  const nodes = usePlanStore((s) => s.nodes)

  // Execution state
  const execution = useExecutionStore((s) => s.getExecution(node.id))
  const isExecuting = useExecutionStore((s) => s.isExecuting(node.id))
  const startExecution = useExecutionStore((s) => s.startExecution)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)

  // Provider state
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const getAvailableProvider = useExecutionStore((s) => s.getAvailableProvider)

  // Machine state
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const getMachinesForEnvironment = useExecutionStore((s) => s.getMachinesForEnvironment)

  // Local state for execution options
  const [selectedEnvironment, setSelectedEnvironment] = useState<'local' | 'hpc' | 'cloud'>(
    node.environment || 'local'
  )
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)

  // Load providers and machines on mount
  useEffect(() => {
    if (!providersLoaded) {
      loadProviders()
    }
    if (!machinesLoaded) {
      loadMachines()
    }
  }, [providersLoaded, loadProviders, machinesLoaded, loadMachines])

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [execution?.streamText])

  // Get available machines for selected environment
  const availableMachines = getMachinesForEnvironment(selectedEnvironment)

  // Check if node can be executed
  const canExecuteResult = canExecuteNode(node, nodes)
  const availableProvider = getAvailableProvider()

  // Determine if execute button should be enabled
  // For local environment, just need a provider
  // For remote environments, need either a selected machine or available machines
  const hasExecutionTarget =
    selectedEnvironment === 'local'
      ? availableProvider !== null
      : selectedMachine !== null || availableMachines.length > 0

  // Allow execution for planned nodes, and re-execution for stuck/failed nodes
  const executableStatuses: PlanNode["status"][] = ["planned", "in_progress", "awaiting_judgment"]
  const canExecuteNow =
    canExecuteResult.ready &&
    !isExecuting &&
    executableStatuses.includes(node.status) &&
    hasExecutionTarget

  const handleExecute = () => {
    const options: ExecutionOptions = {
      environment: selectedEnvironment,
    }

    if (selectedMachine) {
      options.targetMachineId = selectedMachine.machineId
    }

    startExecution(node.id, projectId, options)
  }

  const handleCancel = () => {
    cancelExecution(node.id)
  }

  const EnvironmentIcon = environmentConfig[selectedEnvironment].icon

  return (
    <div className="flex flex-col gap-4">
      {/* Environment Selection */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Environment</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <EnvironmentIcon className="h-3.5 w-3.5" />
              {environmentConfig[selectedEnvironment].label}
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Select Environment</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(environmentConfig) as Array<'local' | 'hpc' | 'cloud'>).map((env) => {
              const config = environmentConfig[env]
              const Icon = config.icon
              const machineCount = getMachinesForEnvironment(env).length
              return (
                <DropdownMenuItem
                  key={env}
                  onClick={() => {
                    setSelectedEnvironment(env)
                    setSelectedMachine(null)
                  }}
                  className="gap-2"
                >
                  <Icon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{config.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {env === 'local' ? config.description : `${machineCount} available`}
                    </span>
                  </div>
                  {selectedEnvironment === env && (
                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Machine Selection (for non-local environments) */}
      {selectedEnvironment !== 'local' && availableMachines.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Machine</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 max-w-[180px]">
                <Server className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {selectedMachine?.name || "Auto-select"}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Select Machine</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setSelectedMachine(null)}
                className="gap-2"
              >
                <Server className="h-4 w-4" />
                <div className="flex flex-col">
                  <span>Auto-select</span>
                  <span className="text-xs text-muted-foreground">
                    Best available machine
                  </span>
                </div>
                {!selectedMachine && (
                  <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {availableMachines.map((machine) => (
                <DropdownMenuItem
                  key={machine.machineId}
                  onClick={() => setSelectedMachine(machine)}
                  className="gap-2"
                >
                  <Server className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{machine.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {machine.hostname || machine.machineId}
                      {machine.load && ` • ${machine.load.activeTasks} tasks`}
                    </span>
                  </div>
                  {selectedMachine?.machineId === machine.machineId && (
                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* No machines warning for non-local environments */}
      {selectedEnvironment !== 'local' && availableMachines.length === 0 && machinesLoaded && (
        <div className="rounded-lg bg-warning/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
            <div>
              <p className="font-medium text-warning">No machines available</p>
              <p className="text-muted-foreground mt-1">
                No {environmentConfig[selectedEnvironment].label} machines are connected.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Provider Status (for local environment) */}
      {selectedEnvironment === 'local' && providersLoaded && (
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
        <div className="rounded-lg bg-warning/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
            <div>
              <p className="font-medium text-warning">Dependencies not met</p>
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

      {/* View Details link */}
      {(execution || node.executionOutput) && (
        <Button variant="outline" size="sm" className="gap-1.5" asChild>
          <Link to={`/project/${projectId}/task/${node.id}`}>
            <ExternalLink className="h-3.5 w-3.5" />
            View Details
          </Link>
        </Button>
      )}

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
