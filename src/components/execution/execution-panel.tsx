import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { Play, Square, CheckCircle2, XCircle, Clock, Loader2, AlertCircle, ExternalLink, Server, Laptop, Cloud, Globe, ChevronDown, Bot } from "lucide-react"
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
import { useExecutionStore, canExecuteNode, getProjectWorkingDir, getAllowedEnvironments, type MachineInfo } from "@/stores/execution-store"
import { usePlanStore } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { PlanNode, ProviderStatus } from "@/types"

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
  remote: { icon: Globe, label: "Remote", description: "Run on remote machine" },
  hpc: { icon: Server, label: "HPC", description: "Run on HPC cluster" },
  cloud: { icon: Cloud, label: "Cloud", description: "Run on cloud instance" },
}

export function ExecutionPanel({ node, projectId }: ExecutionPanelProps) {
  const outputRef = useRef<HTMLDivElement>(null)
  const nodes = usePlanStore((s) => s.nodes)
  const edges = usePlanStore((s) => s.edges)
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
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const getMachinesForEnvironment = useExecutionStore((s) => s.getMachinesForEnvironment)

  // Compute allowed environments from project config
  const envConstraints = getAllowedEnvironments(project)

  // Local state for execution options — default to project's defaultEnvironment
  const [selectedEnvironment, setSelectedEnvironment] = useState<'local' | 'remote' | 'hpc' | 'cloud'>(
    project?.defaultEnvironment || node.environment || 'local'
  )
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>(defaultProvider || "")
  const [selectedModel, setSelectedModel] = useState<string>("")

  // Derived: selected provider object
  const selectedProviderObj: ProviderStatus | null = selectedProvider
    ? providers.find((p) => p.id === selectedProvider) ?? null
    : null

  // Resolve working directory based on selected environment
  const dirCheck = getProjectWorkingDir(project, selectedEnvironment)
  const workingDir = dirCheck.dir || ''

  // If locked to a specific machine, compute the effective machine from available machines
  const lockedMachine = envConstraints.lockedMachineId && machinesLoaded
    ? getMachinesForEnvironment(selectedEnvironment).find((m) => m.machineId === envConstraints.lockedMachineId) ?? null
    : null
  const effectiveMachine = selectedMachine ?? lockedMachine

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
  const canExecuteResult = canExecuteNode(node, nodes, edges)
  const availableProvider = getAvailableProvider()

  // Determine if execute button should be enabled
  // For local environment, just need a provider
  // For remote environments, need either a selected machine or available machines
  const hasExecutionTarget =
    selectedEnvironment === 'local'
      ? availableProvider !== null
      : effectiveMachine !== null || availableMachines.length > 0

  // Allow execution for planned nodes, and re-execution for stuck/failed nodes
  const executableStatuses: PlanNode["status"][] = ["planned", "in_progress", "awaiting_judgment"]
  const canExecuteNow =
    canExecuteResult.ready &&
    !isExecuting &&
    executableStatuses.includes(node.status) &&
    hasExecutionTarget &&
    !!workingDir.trim()

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

  const EnvironmentIcon = environmentConfig[selectedEnvironment].icon

  return (
    <div className="flex flex-col gap-4">
      {/* Environment Selection */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Environment</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={envConstraints.allowed.length <= 1}>
              <EnvironmentIcon className="h-3.5 w-3.5" />
              {environmentConfig[selectedEnvironment].label}
              {envConstraints.allowed.length > 1 && <ChevronDown className="h-3 w-3 opacity-50" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Select Environment</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(environmentConfig) as Array<'local' | 'remote' | 'hpc' | 'cloud'>).map((env) => {
              const config = environmentConfig[env]
              const Icon = config.icon
              const machineCount = getMachinesForEnvironment(env).length
              const isAllowed = envConstraints.allowed.includes(env)
              return (
                <DropdownMenuItem
                  key={env}
                  onClick={() => {
                    if (!isAllowed) return
                    setSelectedEnvironment(env)
                    setSelectedMachine(null)
                  }}
                  className="gap-2"
                  disabled={!isAllowed}
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

      {/* Environment lock info */}
      {envConstraints.lockReason && (
        <div className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
          {envConstraints.lockReason}
        </div>
      )}

      {/* Machine Selection (for non-local environments) */}
      {selectedEnvironment !== 'local' && availableMachines.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Machine</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 max-w-[180px]">
                <Server className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {effectiveMachine?.name || "Auto-select"}
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
                {!effectiveMachine && (
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
                  {effectiveMachine?.machineId === machine.machineId && (
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
