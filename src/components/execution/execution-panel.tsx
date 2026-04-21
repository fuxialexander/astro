import { useEffect, useRef, useState, useMemo } from "react"
import { Link, useNavigate } from "react-router"
import { Play, Square, CheckCircle2, XCircle, Clock, Loader2, AlertCircle, ExternalLink, Server, ChevronDown, Bot, Boxes, GitBranch, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { useExecutionStore, canExecuteNode, getProjectWorkingDir, type ComputeBackendInfo } from "@/stores/execution-store"
import { RepoConfigDialog } from "@/components/repo-config-dialog"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useContentSaveStore } from "@/stores/content-save-store"
import { useToastStore } from "@/stores/toast-store"
import type { PlanNode, ProviderStatus } from "@/types"
import { deriveAvailableProviders, isProviderAvailable } from "./provider-utils"

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


export function ExecutionPanel({ node, projectId, viewMode }: ExecutionPanelProps) {
  const navigate = useNavigate()
  const outputRef = useRef<HTMLDivElement>(null)
  const rawNodes = usePlanStore((s) => s.nodes)
  const nodes = useMemo(() => rawNodes.filter(isLive), [rawNodes])
  const rawEdges = usePlanStore((s) => s.edges)
  const edges = useMemo(() => rawEdges.filter(isLive), [rawEdges])
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const profile = useUserProfileStore((s) => s.profile)
  const flushPendingSaves = useContentSaveStore((s) => s.flushPendingSaves)

  // Execution state
  const execution = useExecutionStore((s) => s.getExecution(node.id))
  const isExecuting = useExecutionStore((s) => s.isExecuting(node.id))
  const startExecution = useExecutionStore((s) => s.startExecution)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)
  const resetExecution = useExecutionStore((s) => s.resetExecution)

  // Provider state
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const getAvailableProvider = useExecutionStore((s) => s.getAvailableProvider)

  // Default provider from settings store (single source of truth)
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)

  // Machine state
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)

  // Resolve machine from project config (read-only, set at project level)
  const resolvedMachineId = node.machineId || project?.defaultMachineId || profile.defaultMachineId || null
  const resolvedMachine = resolvedMachineId ? machines.find((m) => m.machineId === resolvedMachineId) ?? null : null

  // Local state for execution options
  const [selectedProvider, setSelectedProvider] = useState<string>(defaultProvider || "")
  const getModelForProvider = useSettingsStore((s) => s.getModelForProvider)
  const [selectedModel, setSelectedModel] = useState<string>(() => getModelForProvider(defaultProvider || undefined) || '')
  const [selectedBackend, setSelectedBackend] = useState<string>("")
  const [useWorktree, setUseWorktree] = useState(true)

  // Compute backends available on the resolved machine (non-direct strategies)
  const availableBackends: ComputeBackendInfo[] = resolvedMachine?.executionStrategies
    ? resolvedMachine.executionStrategies.filter((s) => s.available && s.id !== 'direct')
    : []

  // Derive available providers directly from the machine's relay-reported providers.
  // The global `providers` list is unreliable (API returns `machines`, not `providers`),
  // so we build ProviderStatus objects from the machine data instead.
  const machineProviders = resolvedMachine?.providers
  const availableProviders: ProviderStatus[] = useMemo(
    () => deriveAvailableProviders(machineProviders, providers),
    [machineProviders, providers],
  )

  // Derived: selected provider object (use availableProviders which may be machine-derived)
  const selectedProviderObj: ProviderStatus | null = selectedProvider
    ? availableProviders.find((p) => p.id === selectedProvider) ?? null
    : null

  // Reset provider/model selection when resolved machine changes and current provider isn't available
  useEffect(() => {
    if (selectedProvider && availableProviders.length > 0) {
      if (!isProviderAvailable(selectedProvider, availableProviders)) {
        setSelectedProvider("")
        setSelectedModel("")
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on machine change
  }, [resolvedMachineId])

  // Auto-select the first available provider when none is selected
  useEffect(() => {
    if (!selectedProvider && availableProviders.length > 0) {
      setSelectedProvider(availableProviders[0].id)
    }
  }, [selectedProvider, availableProviders])

  // Resolve working directory
  const dirCheck = getProjectWorkingDir(project)
  const workingDir = dirCheck.dir || ''

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

  // Check if node can be executed
  const canExecuteResult = canExecuteNode(node, nodes, edges)
  const availableProvider = getAvailableProvider()

  // Need either a resolved machine or any available provider (backend handles machine selection)
  const hasExecutionTarget = resolvedMachine !== null || availableProvider !== null

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

  // Derive tooltip text from delivery mode + worktree setting
  const executeTooltip = useMemo(() => {
    const dm = project?.deliveryMode ?? "pr"
    if (!useWorktree) {
      if (dm === "pr") return "Execute in project directory (worktree disabled), push branch and open PR"
      if (dm === "push") return "Execute in project directory (worktree disabled), push branch to remote"
      return "Execute directly in project directory (no isolation)"
    }
    switch (dm) {
      case "pr": return "Execute in git worktree, push branch and open PR on GitHub"
      case "push": return "Execute in git worktree, push branch to remote"
      case "branch": return "Execute in git worktree, commit to local branch"
      case "copy": return "Execute in a copy of the project directory"
      case "direct": return "Execute directly in project directory (no isolation, serial only)"
      default: return "Execute task"
    }
  }, [project?.deliveryMode, useWorktree])

  const [repoConfigOpen, setRepoConfigOpen] = useState(false)
  const handleExecute = async () => {
    try {
      // Flush any pending content saves before execution
      await flushPendingSaves([node.id])
    } catch (error) {
      console.error('Failed to save task content before execution:', error)
      useToastStore.getState().add({
        type: 'error',
        title: 'Failed to save changes',
        description: 'Could not save task content before execution. Please try again.',
      })
      return
    }

    // Clean up old server resources (worktree, branch, session) before re-executing
    if (isReexecution) {
      await resetExecution(node.id)
    }
    startExecution(node.id, projectId, {
      preferredProvider: selectedProvider || undefined,
      model: selectedModel || undefined,
      computeBackend: selectedBackend || undefined,
      useWorktree,
    })
    navigate(`/project/${projectId}/task/${node.id}${viewMode ? `?from=${viewMode}` : ''}`)
  }

  const handleCancel = () => {
    cancelExecution(node.id)
  }

  const machineDisplayName = resolvedMachine?.name
    || (machines.length === 1 ? machines[0].name : "Auto")

  return (
    <div className="flex flex-col gap-4">
      {/* Machine (read-only, set at project level) */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Machine</span>
        <span className="flex items-center gap-1.5 text-sm">
          <Server className="h-3.5 w-3.5 text-muted-foreground" />
          {machineDisplayName}
        </span>
      </div>

      {/* Compute Backend Selection (when machine has non-direct strategies) */}
      {availableBackends.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Backend</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 max-w-[180px]">
                <Boxes className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {selectedBackend
                    ? availableBackends.find((b) => b.id === selectedBackend)?.name ?? selectedBackend
                    : "Direct"}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Compute Backend</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setSelectedBackend("")}
                className="gap-2"
              >
                <Boxes className="h-4 w-4" />
                <div className="flex flex-col">
                  <span>Direct</span>
                  <span className="text-xs text-muted-foreground">Local process execution</span>
                </div>
                {!selectedBackend && (
                  <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {availableBackends.map((backend) => (
                <DropdownMenuItem
                  key={backend.id}
                  onClick={() => setSelectedBackend(backend.id)}
                  className="gap-2"
                >
                  <Boxes className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{backend.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {backend.version ? `v${backend.version}` : backend.id}
                    </span>
                  </div>
                  {selectedBackend === backend.id && (
                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Temporary workspace indicator */}
      {dirCheck.source === 'auto-workspace' && (
        <button
          type="button"
          onClick={() => setRepoConfigOpen(true)}
          className="w-full rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-sm text-left cursor-pointer hover:bg-amber-500/15 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <p className="text-amber-600 text-xs">Temporary workspace — files auto-delete after 30 days. <span className="underline">Set a permanent directory.</span></p>
          </div>
        </button>
      )}
      {project && (
        <RepoConfigDialog
          open={repoConfigOpen}
          onOpenChange={setRepoConfigOpen}
          project={project}
        />
      )}

      {/* Provider Selection — always visible when providers loaded */}
      {providersLoaded && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Provider</span>
          {availableProviders.length > 0 ? (
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
                <DropdownMenuLabel>Select Provider</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => { setSelectedProvider(""); setSelectedModel(getModelForProvider(undefined) || '') }}
                  className="gap-2"
                >
                  <Bot className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span>Auto</span>
                    <span className="text-xs text-muted-foreground">Best available provider</span>
                  </div>
                  {!selectedProvider && (
                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {availableProviders.map((provider) => (
                  <DropdownMenuItem
                    key={provider.id}
                    onClick={() => { setSelectedProvider(provider.id); setSelectedModel(getModelForProvider(provider.id) || '') }}
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
              No provider available
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
              {selectedProviderObj.capabilities.availableModels.map((model) => {
                const style = getModelItemStyle(model, selectedModel, selectedProviderObj.capabilities?.defaultModel)
                return (
                  <DropdownMenuItem
                    key={model}
                    onClick={() => setSelectedModel(model)}
                    className={style.itemClassName}
                  >
                    <span className="text-sm">{model}</span>
                    {style.isDefault && (
                      <Badge variant={style.badgeVariant} className="ml-auto text-[10px]">default</Badge>
                    )}
                    {style.isSelected && (
                      <CheckCircle2 className="h-4 w-4 ml-auto text-success" />
                    )}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}


      {/* Worktree Isolation Toggle */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" />
          Worktree
        </span>
        <Switch checked={useWorktree} onCheckedChange={setUseWorktree} />
      </div>

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
            Stop
          </Button>
        ) : (
          isReexecution ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex flex-1">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleExecute}
                    disabled={!canExecuteNow}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Re-execute
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{executeTooltip}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleExecute}
                  disabled={!canExecuteNow}
                >
                  <Play className="h-3.5 w-3.5" />
                  Execute
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{executeTooltip}</TooltipContent>
            </Tooltip>
          )
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

          {/* Reconnection indicator */}
          {execution.connectionState === 'reconnecting' && (
            <div className="rounded-lg bg-yellow-500/10 p-3 text-sm">
              <div className="flex items-center gap-2">
                <WifiOff className="h-4 w-4 text-yellow-600" />
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-yellow-600" />
                  <span className="text-yellow-700 dark:text-yellow-400">Connection lost. Reconnecting...</span>
                </div>
              </div>
            </div>
          )}
          {execution.connectionState === 'polling' && (
            <div className="rounded-lg bg-yellow-500/10 p-3 text-sm">
              <div className="flex items-center gap-2">
                <WifiOff className="h-4 w-4 text-yellow-600" />
                <span className="text-yellow-700 dark:text-yellow-400">Connection lost. Checking for updates...</span>
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
import { getModelItemStyle } from "./model-utils"
