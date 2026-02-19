import { useEffect, useRef, useState, useMemo } from "react"
import { Link } from "react-router"
import { Play, Square, CheckCircle2, XCircle, Clock, Loader2, AlertCircle, ExternalLink, Server, Laptop, Cloud, Globe, ChevronDown, Bot } from "lucide-react"
// Cloud and Globe used via environmentConfig lookup
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useExecutionStore, canExecuteNode, getProjectWorkingDir } from "@/stores/execution-store"
import { shouldUseSupabase } from "@/lib/supabase-client"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { PlanNode, ProviderStatus } from "@/types"

interface ExecutionPanelProps {
  node: PlanNode
  projectId: string
  viewMode?: string // Optional: the view mode to return to when navigating back
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
  remote: { icon: Globe, label: "Remote", description: "Run on remote machine" },
  hpc: { icon: Server, label: "HPC", description: "Run on HPC cluster" },
  cloud: { icon: Cloud, label: "Cloud", description: "Run on cloud instance" },
}

export function ExecutionPanel({ node, projectId, viewMode }: ExecutionPanelProps) {
  const outputRef = useRef<HTMLDivElement>(null)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const rawEdges = usePlanStore((s) => s.edges)
  const edges = useMemo(() => rawEdges.filter(isLive), [rawEdges])
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))

  // Execution state
  const execution = useExecutionStore((s) => s.getExecution(node.id))
  const isExecuting = useExecutionStore((s) => s.isExecuting(node.id))
  const startExecution = useExecutionStore((s) => s.startExecution)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)

  // Provider state
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const getAvailableProvider = useExecutionStore((s) => s.getAvailableProvider)

  // Default provider from settings
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)

  // Machine state
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)

  // In Supabase mode, no "Local" option — only registered machines
  const isMultiTenant = shouldUseSupabase()

  // Local state for execution options — default to node's machine, then project defaults
  const defaultMachineId = node.machineId || project?.defaultMachineId
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(defaultMachineId || null)
  const [selectedProvider, setSelectedProvider] = useState<string>(defaultProvider || "")
  const [selectedModel, setSelectedModel] = useState<string>("")

  // Derive environment from selected machine
  const selectedMachine = selectedMachineId ? machines.find((m) => m.machineId === selectedMachineId) ?? null : null
  const selectedEnvironment: 'local' | 'remote' | 'hpc' | 'cloud' = selectedMachine?.environmentType || 'local'

  // Derived: selected provider object
  const selectedProviderObj: ProviderStatus | null = selectedProvider
    ? providers.find((p) => p.id === selectedProvider) ?? null
    : null

  // Resolve working directory based on selected environment
  const dirCheck = getProjectWorkingDir(project, selectedEnvironment)
  const workingDir = dirCheck.dir || ''

  const effectiveMachine = selectedMachine

  // Sync selected machine when node or project defaults change
  const syncMachineId = node.machineId || project?.defaultMachineId
  if (syncMachineId && !selectedMachineId) {
    setSelectedMachineId(syncMachineId)
  }

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

  // All online machines
  const onlineMachines = machines.filter((m) => m.status !== 'offline')

  // Check if node can be executed
  const canExecuteResult = canExecuteNode(node, nodes, edges)
  const availableProvider = getAvailableProvider()

  // For local (no machine selected), need a provider; for remote, need a machine
  const hasExecutionTarget = selectedMachineId
    ? effectiveMachine !== null
    : availableProvider !== null

  // Allow execution for planned nodes, and re-execution for stuck/failed/completed nodes
  const executableStatuses: PlanNode["status"][] = ["planned", "in_progress", "awaiting_judgment", "completed", "auto_verified"]
  const canExecuteNow =
    canExecuteResult.ready &&
    !isExecuting &&
    executableStatuses.includes(node.status) &&
    hasExecutionTarget &&
    !!workingDir.trim()

  // Determine if this is a re-execution (task has been executed before)
  const isReexecution = node.status === "completed" || node.status === "auto_verified" || !!node.executionOutput

  const handleExecute = () => {
    startExecution(node.id, projectId, {
      environment: selectedEnvironment,
      targetMachineId: effectiveMachine?.machineId,
      preferredProvider: selectedProvider || undefined,
      model: selectedModel || undefined,
    })
  }

  const handleCancel = () => {
    cancelExecution(node.id)
  }

  const MachineIcon = selectedMachine
    ? environmentConfig[selectedMachine.environmentType]?.icon || Server
    : Laptop
  const machineDisplayName = selectedMachine?.name || (isMultiTenant ? "Select machine" : "Local")

  return (
    <div className="flex flex-col gap-4">
      {/* Machine Selection */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Machine</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 max-w-[200px]">
              <MachineIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {machineDisplayName}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Select Machine</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {!isMultiTenant && (
              <DropdownMenuItem
                onClick={() => setSelectedMachineId(null)}
                className="gap-2"
              >
                <Laptop className="h-4 w-4" />
                <div className="flex flex-col">
                  <span>Local</span>
                  <span className="text-xs text-muted-foreground">Run on this machine</span>
                </div>
                {!selectedMachineId && (
                  <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                )}
              </DropdownMenuItem>
            )}
            {!isMultiTenant && onlineMachines.length > 0 && <DropdownMenuSeparator />}
            {onlineMachines.map((machine) => {
              const envConfig = environmentConfig[machine.environmentType]
              const Icon = envConfig?.icon || Server
              return (
                <DropdownMenuItem
                  key={machine.machineId}
                  onClick={() => setSelectedMachineId(machine.machineId)}
                  className="gap-2"
                >
                  <Icon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{machine.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {machine.hostname || machine.environmentType}
                      {machine.load && ` · ${machine.load.activeTasks} tasks`}
                    </span>
                  </div>
                  {selectedMachineId === machine.machineId && (
                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Working directory warning */}
      {!dirCheck.ok && (
        <div className="rounded-lg bg-warning/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
            <div>
              <p className="font-medium text-warning">Cannot execute</p>
              <p className="text-muted-foreground mt-1">{dirCheck.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Provider Selection */}
      {providersLoaded && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Agent</span>
          {providers.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 max-w-[200px]">
                  <Bot className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {selectedProviderObj?.name || "Auto"}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Select Agent</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => { setSelectedProvider(""); setSelectedModel("") }}
                  className="gap-2"
                >
                  <Bot className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span>Auto</span>
                    <span className="text-xs text-muted-foreground">Best available agent</span>
                  </div>
                  {!selectedProvider && (
                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {providers.map((provider) => (
                  <DropdownMenuItem
                    key={provider.id}
                    onClick={() => { setSelectedProvider(provider.id); setSelectedModel("") }}
                    className="gap-2"
                    disabled={!provider.available}
                  >
                    <Bot className="h-4 w-4" />
                    <div className="flex flex-col">
                      <span>{provider.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {provider.available
                          ? "Available"
                          : provider.installed
                            ? `Auth: ${provider.authStatus}`
                            : "Not installed"}
                      </span>
                    </div>
                    {selectedProvider === provider.id && (
                      <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Badge variant="warning" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              No agent available
            </Badge>
          )}
        </div>
      )}

      {/* Model Selection (when a specific provider is selected and has models) */}
      {selectedProviderObj?.capabilities?.availableModels && selectedProviderObj.capabilities.availableModels.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Model</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 max-w-[220px]">
                <span className="truncate text-xs">
                  {selectedModel || selectedProviderObj.capabilities.defaultModel || "Default"}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Select Model</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {selectedProviderObj.capabilities.availableModels.map((model) => (
                <DropdownMenuItem
                  key={model}
                  onClick={() => setSelectedModel(model)}
                  className="gap-2"
                >
                  <span className="text-sm">{model}</span>
                  {model === selectedProviderObj.capabilities?.defaultModel && (
                    <Badge variant="secondary" className="ml-auto text-[10px]">default</Badge>
                  )}
                  {selectedModel === model && (
                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
            {isReexecution ? "Reset" : "Execute"}
          </Button>
        )}
      </div>

      {/* View Details link */}
      {(execution || node.executionOutput) && (
        <Button variant="outline" size="sm" className="gap-1.5" asChild>
          <Link to={`/project/${projectId}/task/${node.id}${viewMode ? `?from=${viewMode}` : ''}`}>
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
              <div className="max-h-[200px] overflow-y-auto rounded-lg bg-muted p-3" ref={outputRef}>
                <pre className="font-mono text-xs whitespace-pre-wrap break-all">
                  {execution.streamText}
                </pre>
              </div>
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
            <div className="max-h-[200px] overflow-y-auto rounded-lg bg-muted p-3">
              <pre className="font-mono text-xs whitespace-pre-wrap break-all">
                {node.executionOutput}
              </pre>
            </div>
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

import { formatTime, formatDuration } from "@/lib/date-utils"
