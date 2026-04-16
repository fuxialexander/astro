import { useState, useMemo, useCallback, useEffect } from "react"
import {
  Diamond, Plus, X, Clock, Play, Trash2, ToggleLeft, ToggleRight,
  XCircle, ArrowUpRight, RotateCcw, MoreHorizontal, Copy, FileText,
  GitBranch, Square, Loader2, Check, Sparkles, ChevronDown, ChevronRight, AlertCircle, Paperclip
} from "lucide-react"
import { useNavigate } from "react-router"
import { PropertyPicker } from "@/components/property-picker"
import { LabelPicker } from "@/components/label-picker"
import { LabelManagerDialog } from "@/components/label-manager-dialog"
import { ConvertToProjectDialog } from "@/components/convert-to-project-dialog"
import { PruneCleanupDialog } from "@/components/prune-cleanup-dialog"
import { RepoConfigDialog } from "@/components/repo-config-dialog"
import { ScheduleForm } from "@/components/schedule/schedule-form"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore, canExecuteNode, getProjectWorkingDir } from "@/stores/execution-store"
import { useScheduleStore } from "@/stores/schedule-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useContentSaveStore } from "@/stores/content-save-store"
import { useToastStore } from "@/stores/toast-store"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { statusLabels } from "@/lib/status-config"
import { cn, getShortId } from "@/lib/utils"
import { isNodeIsolated } from "@/lib/plan-utils"
import { refineContent } from "@/lib/api-client"
import { stripHtml } from "@/lib/html-utils"
import { marked } from "marked"
import { deriveAvailableProviders } from "@/components/execution/provider-utils"
import { ProviderAgentPicker } from "@/components/execution/provider-agent-picker"
import { MachineWorkdirPill } from "@/components/execution/machine-workdir-pill"
import { useMachinesStore } from "@/stores/machines-store"
import type { PlanNode, Priority, ProviderStatus } from "@/types"

interface TaskPropertiesBarProps {
  node: PlanNode
  project: {
    id: string
    workingDirectory?: string
    defaultMachineId?: string
    fileTree?: string[]
  }
  viewMode?: string
  onNodeUpdate?: (node: PlanNode) => void
  /** Whether the node has note content (content/description/attachments) */
  hasNote?: boolean
  /** Number of attachments + links */
  attachmentCount?: number
  /** Rendered note content (shown when expanded) */
  children?: React.ReactNode
}

/**
 * Unified task bar: Notes toggle + properties + execution pills in one compact row.
 * Mirrors the ProjectInfoSection pattern from plan-view.
 */
export function TaskPropertiesBar({ node, project, viewMode = "list", onNodeUpdate, hasNote, attachmentCount = 0, children }: TaskPropertiesBarProps) {
  const navigate = useNavigate()
  const updateNodeStore = usePlanStore((s) => s.updateNode)
  const allNodes = usePlanStore((s) => s.nodes)
  const allEdges = usePlanStore((s) => s.edges)
  const addEdge = usePlanStore((s) => s.addEdge)
  const removeEdge = usePlanStore((s) => s.removeEdge)
  const liveNodes = useMemo(() => allNodes.filter(isLive), [allNodes])
  const liveEdges = useMemo(() => allEdges.filter(isLive), [allEdges])

  // Execution store
  const isExecuting = useExecutionStore((s) => s.isExecuting(node.id))
  const startExecution = useExecutionStore((s) => s.startExecution)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const getAvailableProvider = useExecutionStore((s) => s.getAvailableProvider)
  const flushPendingSaves = useContentSaveStore((s) => s.flushPendingSaves)
  const profile = useUserProfileStore((s) => s.profile)

  const [isResetting, setIsResetting] = useState(false)
  const [labelManagerOpen, setLabelManagerOpen] = useState(false)
  const [convertDialogOpen, setConvertDialogOpen] = useState(false)
  const [pruneDialogOpen, setPruneDialogOpen] = useState(false)
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
  const [repoConfigOpen, setRepoConfigOpen] = useState(false)
  const [addDepOpen, setAddDepOpen] = useState(false)
  const [addDepSearch, setAddDepSearch] = useState("")
  const [isRefining, setIsRefining] = useState(false)
  const [justRefined, setJustRefined] = useState(false)
  const [noteExpanded, setNoteExpanded] = useState(false)

  // Provider/model/worktree — provider lives at project level (settings store),
  // matching the plan-view WorkdirBar. Model + worktree remain per-task.
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)
  const setDefaultProvider = useSettingsStore((s) => s.setDefaultProvider)
  const getModelForProvider = useSettingsStore((s) => s.getModelForProvider)
  const selectedProvider = defaultProvider || ""
  const selectedModel = getModelForProvider(selectedProvider || undefined) || ''
  const [useWorktree, setUseWorktree] = useState(true)

  // Schedule state
  const schedules = useScheduleStore((s) => s.schedules)
  const loadSchedules = useScheduleStore((s) => s.loadSchedules)
  const deleteSchedule = useScheduleStore((s) => s.deleteSchedule)
  const updateScheduleStore = useScheduleStore((s) => s.updateSchedule)
  const triggerSchedule = useScheduleStore((s) => s.triggerSchedule)
  const nodeSchedule = schedules.find((s) => s.scope === 'node' && s.nodeId === node.id)

  useEffect(() => { loadSchedules(node.projectId) }, [node.projectId, loadSchedules])
  useEffect(() => { if (!providersLoaded) loadProviders() }, [providersLoaded, loadProviders])
  useEffect(() => { if (!machinesLoaded) loadMachines() }, [machinesLoaded, loadMachines])

  const fullProject = useProjectStore((s) => s.projects.find((p) => p.id === node.projectId))
  const projectLabels = fullProject?.labels ?? []
  const isIsolated = useMemo(() => isNodeIsolated(node.id, allEdges, isLive), [allEdges, node.id])

  // Registered machines (same source used by plan-view WorkdirBar) — needed so
  // providers show up even when the machine isn't currently live-connected.
  const registeredMachines = useMachinesStore((s) => s.machines)
  const fetchRegisteredMachines = useMachinesStore((s) => s.fetchMachines)
  useEffect(() => {
    if (registeredMachines.length === 0) fetchRegisteredMachines()
  }, [registeredMachines.length, fetchRegisteredMachines])

  // Machine resolution
  const resolvedMachineId = node.machineId || fullProject?.defaultMachineId || profile.defaultMachineId || null
  const resolvedMachine = resolvedMachineId ? machines.find((m) => m.machineId === resolvedMachineId) ?? null : null

  // Providers derived from: (1) live machine, (2) registered machine, (3) global
  const machineProviders = resolvedMachine?.providers
  const registeredProviderIds = useMemo(() => {
    if (!resolvedMachineId) return null
    const reg = registeredMachines.find((m) => m.id === resolvedMachineId)
    return reg?.providers ?? null
  }, [resolvedMachineId, registeredMachines])
  const availableProviders: ProviderStatus[] = useMemo(() => {
    if (machineProviders?.length) return deriveAvailableProviders(machineProviders, providers)
    if (registeredProviderIds?.length) {
      return registeredProviderIds.map((id) => ({
        id,
        name: id,
        available: true,
        installed: true,
        authStatus: "unknown" as ProviderStatus["authStatus"],
      }))
    }
    return providers
  }, [machineProviders, registeredProviderIds, providers])

  // Working directory check
  const dirCheck = getProjectWorkingDir(fullProject)
  const workingDir = dirCheck.dir || ''

  // Can execute check
  const canExecuteResult = canExecuteNode(node, liveNodes, liveEdges)
  const availableProvider = getAvailableProvider()
  const hasExecutionTarget = resolvedMachine !== null || availableProvider !== null
  const executableStatuses: PlanNode["status"][] = ["planned", "in_progress", "awaiting_judgment", "completed", "auto_verified"]
  const canExecuteNow = canExecuteResult.ready && !isExecuting && executableStatuses.includes(node.status) && hasExecutionTarget && !!workingDir.trim()
  const isReexecution = node.status === "completed" || node.status === "auto_verified" || !!node.executionOutput

  // Upstream dependencies
  const upstreamDeps = useMemo(() => {
    const depEdges = liveEdges.filter((e) => e.target === node.id)
    return depEdges.map((e) => {
      const depNode = liveNodes.find((n) => n.id === e.source)
      return { id: e.source, title: depNode?.title ?? e.source, status: depNode?.status }
    })
  }, [liveEdges, liveNodes, node.id])

  const addCandidates = useMemo(() => {
    const existingDepIds = new Set(upstreamDeps.map((d) => d.id))
    return liveNodes
      .filter((n) => n.projectId === node.projectId && n.id !== node.id && !existingDepIds.has(n.id))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [liveNodes, upstreamDeps, node.projectId, node.id])

  const filteredCandidates = useMemo(() => {
    if (!addDepSearch) return addCandidates
    const q = addDepSearch.toLowerCase()
    return addCandidates.filter((n) => n.title.toLowerCase().includes(q))
  }, [addCandidates, addDepSearch])

  const milestoneOptions = useMemo(() => {
    const milestones = liveNodes
      .filter((n) => n.type === 'milestone' && n.projectId === node.projectId)
      .map((n) => ({ id: n.id, label: n.title, icon: Diamond }))
    return [{ id: 'none', label: 'No milestone' }, ...milestones]
  }, [liveNodes, node.projectId])

  const currentMilestoneName = useMemo(() => {
    if (!node.milestoneId) return null
    return allNodes.find((n) => n.id === node.milestoneId)?.title ?? null
  }, [allNodes, node.milestoneId])

  const handleUpdate = useCallback((updates: Partial<PlanNode>) => {
    updateNodeStore(node.id, updates)
    onNodeUpdate?.({ ...node, ...updates })
  }, [node, updateNodeStore, onNodeUpdate])

  const handleAddDep = useCallback((sourceId: string) => {
    addEdge({ id: crypto.randomUUID(), source: sourceId, target: node.id, type: "dependency" })
    const targetNode = allNodes.find((n) => n.id === node.id)
    if (targetNode && !targetNode.dependencies.includes(sourceId)) {
      updateNodeStore(node.id, { dependencies: [...targetNode.dependencies, sourceId] })
    }
    setAddDepOpen(false)
    setAddDepSearch("")
  }, [addEdge, node.id, allNodes, updateNodeStore])

  const handleRemoveDep = useCallback((sourceId: string) => {
    removeEdge(sourceId, node.id)
    const targetNode = allNodes.find((n) => n.id === node.id)
    if (targetNode) {
      updateNodeStore(node.id, { dependencies: targetNode.dependencies.filter((d) => d !== sourceId) })
    }
  }, [removeEdge, node.id, allNodes, updateNodeStore])

  const handleExecute = async () => {
    try {
      await flushPendingSaves([node.id])
    } catch {
      useToastStore.getState().add({ type: 'error', title: 'Failed to save changes', description: 'Could not save task content before execution.' })
      return
    }
    if (isReexecution) await resetExecution(node.id)
    startExecution(node.id, node.projectId, {
      preferredProvider: selectedProvider || undefined,
      model: selectedModel || undefined,
      useWorktree,
    })
    navigate(`/project/${project.id}/task/${node.id}${viewMode ? `?from=${viewMode}` : ''}`)
  }

  const handleRefine = async () => {
    setIsRefining(true)
    try {
      const result = await refineContent(node.title, node.content ? stripHtml(node.content) : (node.description ?? ""), "task")
      if (result) {
        const contentHtml = await marked.parse(result.refinedDescription, { async: false }) as string
        updateNodeStore(node.id, { title: result.refinedTitle, description: result.refinedDescription, content: contentHtml })
        setJustRefined(true)
        setTimeout(() => setJustRefined(false), 1500)
      }
    } catch { /* best-effort */ }
    setIsRefining(false)
  }

  const nodeOutputDir = (node.metadata as Record<string, unknown> | undefined)?.outputDir as string | undefined
  const priorityConfig = PRIORITY_CONFIG[(node.priority ?? "none") as Priority]

  // Pill button base class (matches WorkdirBar pattern)
  const pillClass = "flex h-6 items-center gap-1 px-2 rounded-full border border-border hover:bg-muted hover:text-foreground transition-colors cursor-pointer text-[11px] text-muted-foreground shrink-0"

  return (
    <>
      {/* Unified bar: Notes toggle + properties + execution pills */}
      <div className="flex items-center gap-1 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
        {/* Notes toggle */}
        {(hasNote || attachmentCount > 0) && (
          <>
            <button
              type="button"
              onClick={() => setNoteExpanded(!noteExpanded)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer whitespace-nowrap px-1.5 py-0.5 rounded-md hover:bg-muted/40 shrink-0"
            >
              {noteExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <FileText className="h-3 w-3" />
              Note
              {attachmentCount > 0 && <Paperclip className="h-2.5 w-2.5 opacity-60" />}
            </button>
            <span className="text-muted-foreground/30 text-[10px]">&middot;</span>
          </>
        )}

        {/* Status */}
        <PropertyPicker value={node.status} options={STATUS_OPTIONS} title="Set status" onSelect={(id) => handleUpdate({ status: id as PlanNode["status"] })}>
          <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">{statusLabels[node.status]}</span>
        </PropertyPicker>

        <span className="text-muted-foreground/30 text-[10px]">&middot;</span>

        {/* Priority */}
        <PropertyPicker value={node.priority ?? "none"} options={PRIORITY_OPTIONS} title="Set priority" onSelect={(id) => handleUpdate({ priority: id as Priority })}>
          <span className={cn("text-[11px] font-medium whitespace-nowrap", priorityConfig.color)}>{priorityConfig.label}</span>
        </PropertyPicker>

        <span className="text-muted-foreground/30 text-[10px]">&middot;</span>

        {/* Estimate */}
        <PropertyPicker value={node.estimate} options={ESTIMATE_OPTIONS} title="Set estimate" onSelect={(id) => handleUpdate({ estimate: id as PlanNode["estimate"] })}>
          <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">{node.estimate ?? "Est."}</span>
        </PropertyPicker>

        <span className="text-muted-foreground/30 text-[10px]">&middot;</span>

        {/* Labels */}
        {projectLabels.length > 0 ? (
          <LabelPicker labelIds={node.labelIds ?? []} allLabels={projectLabels} displayMode="badges" onChange={(labelIds) => handleUpdate({ labelIds })} onManageLabels={() => setLabelManagerOpen(true)} />
        ) : (
          <button type="button" onClick={() => setLabelManagerOpen(true)} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer whitespace-nowrap px-1.5 py-0.5 rounded-md hover:bg-muted/40">Labels</button>
        )}

        {/* Milestone */}
        {node.type !== 'milestone' && (
          <>
            <span className="text-muted-foreground/30 text-[10px]">&middot;</span>
            <PropertyPicker value={node.milestoneId ?? 'none'} options={milestoneOptions} title="Set milestone" onSelect={(id) => handleUpdate({ milestoneId: id === 'none' ? undefined : id })}>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                <Diamond className="h-3 w-3" />
                {currentMilestoneName ?? "Milestone"}
              </span>
            </PropertyPicker>
          </>
        )}

        {/* Dependencies */}
        <span className="text-muted-foreground/30 text-[10px]">&middot;</span>
        <Popover open={addDepOpen} onOpenChange={(o) => { setAddDepOpen(o); if (!o) setAddDepSearch("") }}>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer whitespace-nowrap px-1.5 py-0.5 rounded-md hover:bg-muted/40" onPointerDown={(e) => e.stopPropagation()}>
              Deps{upstreamDeps.length > 0 && <span className="text-[10px] text-muted-foreground/60">({upstreamDeps.length})</span>}
              <Plus className="h-2.5 w-2.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0" onPointerDown={(e) => e.stopPropagation()}>
            <input type="text" placeholder="Search tasks..." value={addDepSearch} onChange={(e) => setAddDepSearch(e.target.value)} className="w-full px-3 py-2 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground/50" autoFocus />
            {upstreamDeps.length > 0 && (
              <div className="px-1 py-1 border-b border-border/50">
                <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Current</p>
                {upstreamDeps.map((dep) => (
                  <div key={dep.id} className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] hover:bg-muted/50 transition-colors">
                    <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", dep.status === "completed" || dep.status === "auto_verified" ? "bg-success" : dep.status === "in_progress" || dep.status === "dispatched" ? "bg-warning" : "border border-muted-foreground/40")} />
                    <span className="flex-1 truncate">{dep.title}</span>
                    <button type="button" onClick={() => handleRemoveDep(dep.id)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all cursor-pointer"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="max-h-48 overflow-y-auto py-1 px-1">
              {filteredCandidates.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No tasks available</p>
              ) : filteredCandidates.map((n) => (
                <button key={n.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer" onClick={() => handleAddDep(n.id)}>
                  <span className="text-muted-foreground text-xs font-mono min-w-[48px]">{getShortId(n.id)}</span>
                  <span className="flex-1 text-left truncate">{n.title}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Schedule indicator */}
        {nodeSchedule && (
          <>
            <span className="text-muted-foreground/30 text-[10px]">&middot;</span>
            <div className="inline-flex items-center gap-1 shrink-0">
              <code className="text-[10px] bg-muted px-1 py-0.5 rounded font-mono">{nodeSchedule.cronExpression}</code>
              <button type="button" onClick={() => updateScheduleStore(nodeSchedule.id, { enabled: !nodeSchedule.enabled })} className="p-0.5 rounded hover:bg-muted transition-colors cursor-pointer" title={nodeSchedule.enabled ? "Pause" : "Enable"}>
                {nodeSchedule.enabled ? <ToggleRight className="h-3 w-3 text-success" /> : <ToggleLeft className="h-3 w-3 text-muted-foreground" />}
              </button>
            </div>
          </>
        )}

        <div className="flex-1 min-w-[8px]" />

        {/* Execution pills — inline in the same row */}
        {!node.executionId && (
          <>
            {fullProject && (
              <MachineWorkdirPill project={fullProject} onClick={() => setRepoConfigOpen(true)} />
            )}

            <ProviderAgentPicker
              providers={availableProviders}
              value={selectedProvider}
              onChange={(id) => setDefaultProvider(id)}
              align="start"
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={() => setUseWorktree(!useWorktree)} className={cn(pillClass, useWorktree && "border-primary/40 text-primary")}>
                  <GitBranch className="h-3 w-3 shrink-0" />
                  {useWorktree ? <ToggleRight className="h-3 w-3 text-primary" /> : <ToggleLeft className="h-3 w-3" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{useWorktree ? "Worktree isolation on" : "Worktree off"}</TooltipContent>
            </Tooltip>

            {!canExecuteResult.ready && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex h-6 items-center gap-1 px-2 rounded-full bg-warning/10 border border-warning/30 text-[11px] text-warning shrink-0">
                    <AlertCircle className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{canExecuteResult.reason}</TooltipContent>
              </Tooltip>
            )}

            {dirCheck.source === 'auto-workspace' && (
              <button type="button" onClick={() => setRepoConfigOpen(true)} className="flex h-6 items-center gap-1 px-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 shrink-0 hover:bg-amber-500/15 transition-colors cursor-pointer">
                <AlertCircle className="h-3 w-3" />
              </button>
            )}

            {/* Execute button */}
            {isExecuting ? (
              <button type="button" onClick={() => cancelExecution(node.id)} className="flex h-6 items-center gap-1 px-3 rounded-full bg-destructive text-destructive-foreground text-[11px] font-medium shrink-0 hover:bg-destructive/90 transition-colors cursor-pointer">
                <Square className="h-3 w-3" />
              </button>
            ) : (
              <div className="flex items-center shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={handleExecute} disabled={!canExecuteNow || isRefining} className={cn("flex h-6 items-center gap-1 px-2.5 rounded-l-full bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed")}>
                      {justRefined ? <Check className="h-3 w-3" /> : isRefining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{isReexecution ? "Re-execute" : "Execute"}</TooltipContent>
                </Tooltip>
                {!isReexecution && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" disabled={!canExecuteNow || isRefining} className="flex h-6 items-center px-1 rounded-r-full bg-primary text-primary-foreground border-l border-primary-foreground/20 hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        <ChevronDown className="h-2.5 w-2.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-36 p-1">
                      <button type="button" onClick={handleRefine} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"><Sparkles className="h-3.5 w-3.5" />Refine</button>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
          </>
        )}

        {/* Actions overflow menu */}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex items-center justify-center p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer shrink-0">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1">
            <button type="button" onClick={() => setScheduleDialogOpen(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer">
              <Clock className="h-3.5 w-3.5" />{nodeSchedule ? 'Edit Schedule' : 'Add Schedule'}
            </button>
            {nodeSchedule && (
              <>
                <button type="button" onClick={() => triggerSchedule(nodeSchedule.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"><Play className="h-3.5 w-3.5" />Run Now</button>
                <button type="button" onClick={() => deleteSchedule(nodeSchedule.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-accent transition-colors cursor-pointer"><Trash2 className="h-3.5 w-3.5" />Delete Schedule</button>
              </>
            )}
            {node.executionId && (
              <>
                <div className="h-px bg-border my-1" />
                <button type="button" disabled={isResetting} onClick={async () => { setIsResetting(true); try { await resetExecution(node.id); onNodeUpdate?.(usePlanStore.getState().nodes.find((n) => n.id === node.id) ?? node) } finally { setIsResetting(false) } }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer disabled:opacity-50">
                  <RotateCcw className={cn("h-3.5 w-3.5", isResetting && "animate-spin")} />{isResetting ? "Resetting..." : "Reset Execution"}
                </button>
              </>
            )}
            {nodeOutputDir && (
              <button type="button" onClick={() => { navigator.clipboard.writeText(`analysis/${nodeOutputDir}/`); useToastStore.getState().add({ title: "Copied output path", type: "success" }) }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"><Copy className="h-3.5 w-3.5" />Copy Output Path</button>
            )}
            {node.status !== "pruned" && (
              <>
                <div className="h-px bg-border my-1" />
                <button type="button" onClick={() => setPruneDialogOpen(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-accent transition-colors cursor-pointer"><XCircle className="h-3.5 w-3.5" />{node.type === 'milestone' ? 'Prune Milestone' : 'Prune Branch'}</button>
              </>
            )}
            {isIsolated && node.status !== "pruned" && (
              <button type="button" onClick={() => setConvertDialogOpen(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"><ArrowUpRight className="h-3.5 w-3.5" />Turn into Project</button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Expanded note content */}
      {noteExpanded && children && (
        <div className="border-t border-border/30 max-h-[40vh] overflow-auto">
          {children}
        </div>
      )}

      {/* Dialogs */}
      <LabelManagerDialog open={labelManagerOpen} onOpenChange={setLabelManagerOpen} projectId={node.projectId} />
      <PruneCleanupDialog open={pruneDialogOpen} onOpenChange={setPruneDialogOpen} node={node} projectId={project.id} />
      {isIsolated && <ConvertToProjectDialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen} node={node} hasGitHub={!!(fullProject?.githubOwner && fullProject?.githubRepo)} />}
      {fullProject && <RepoConfigDialog open={repoConfigOpen} onOpenChange={setRepoConfigOpen} project={fullProject} />}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{nodeSchedule ? 'Edit Schedule' : 'Create Schedule'}</DialogTitle></DialogHeader>
          <ScheduleForm projectId={node.projectId} scope="node" nodeId={node.id} schedule={nodeSchedule} onSave={() => { setScheduleDialogOpen(false); loadSchedules(node.projectId) }} onCancel={() => setScheduleDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
