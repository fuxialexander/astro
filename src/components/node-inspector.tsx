import { useState, useEffect, useMemo, useCallback } from "react"
import { Link } from "react-router"
import { FileText, XCircle, RotateCcw, X, Plus, Pencil, ArrowUpRight, Diamond, Clock, Play, Trash2, ToggleLeft, ToggleRight, ShieldCheck, SkipForward, RefreshCw, Eye, MessageSquare, Loader2, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InlineRenameInput } from "@/components/inline-rename-input"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { PropertyPicker } from "@/components/property-picker"
import { LabelPicker } from "@/components/label-picker"
import { LabelManagerDialog } from "@/components/label-manager-dialog"
import { ConvertToProjectDialog } from "@/components/convert-to-project-dialog"
import { PruneCleanupDialog } from "@/components/prune-cleanup-dialog"

import { ExecutionPanel } from "@/components/execution"
import { ScheduleForm } from "@/components/schedule/schedule-form"
import { useScheduleStore } from "@/stores/schedule-store"

import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { useTeamStore } from "@/stores/team-store"
import { useToastStore } from "@/stores/toast-store"
import { PRIORITY_CONFIG, PRIORITY_OPTIONS, ESTIMATE_OPTIONS, STATUS_OPTIONS } from "@/lib/constants"
import { statusLabels } from "@/lib/status-config"
import { cn, getShortId } from "@/lib/utils"
import { isNodeIsolated } from "@/lib/plan-utils"
import { dataClient } from "@/lib/data-client"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import type { PlanNode, Priority } from "@/types"

/**
 * Validates a task title.
 * Returns an error message string, or null if valid.
 */
function validateTaskTitle(title: string): string | null {
  if (!title.trim()) {
    return "Task title cannot be empty"
  }
  if (title.length > 200) {
    return "Task title is too long (max 200 characters)"
  }
  return null
}

/**
 * Custom hook for task title editing with optimistic updates.
 * Handles rename state, keyboard shortcuts, and error recovery.
 */
function useTaskRename(
  node: PlanNode,
  onNodeUpdate: (node: PlanNode) => void,
  options?: { guardOpen?: boolean }
) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [prevNodeId, setPrevNodeId] = useState(node.id)
  const addToast = useToastStore((s) => s.add)

  // Reset rename state when node changes (React-recommended in-render pattern)
  if (prevNodeId !== node.id) {
    setPrevNodeId(node.id)
    setIsRenaming(false)
    setEditingValue(null)
  }

  // Wrap setIsRenaming to also manage editingValue
  const startRenaming = useCallback(() => {
    setIsRenaming(true)
    setEditingValue(node.title)
  }, [node.title])

  const stopRenaming = useCallback(() => {
    setIsRenaming(false)
    setEditingValue(null)
  }, [])

  // Add keyboard shortcut (F2) for rename
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shouldGuard = options?.guardOpen !== undefined
      const isGuardOpen = options?.guardOpen ?? true
      if (e.key === 'F2' && !isRenaming && (!shouldGuard || isGuardOpen)) {
        e.preventDefault()
        startRenaming()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isRenaming, options?.guardOpen, startRenaming])

  const handleRename = useCallback(async (newTitle: string) => {
    // Read fresh node from store to avoid stale closure
    const nodes = usePlanStore.getState().nodes
    const freshNode = nodes.find(n => n.id === node.id)

    if (!freshNode) {
      addToast({
        type: 'error',
        title: 'Task not found',
        description: 'This task may have been deleted. Please refresh the page.',
      })
      return
    }

    // Optimistically update local state
    const nextNodes = nodes.map(n =>
      n.id === node.id ? { ...n, title: newTitle, updatedAt: new Date() } : n
    )
    usePlanStore.setState({ nodes: nextNodes })
    onNodeUpdate({ ...freshNode, title: newTitle })

    try {
      // Persist to backend
      await dataClient.updateNode(node.id, { title: newTitle })

      // Close input on success
      stopRenaming()
    } catch (err) {
      // Revert optimistic update - only revert the title field to preserve concurrent updates
      const currentNodes = usePlanStore.getState().nodes
      const revertedNodes = currentNodes.map(n =>
        n.id === node.id ? { ...n, title: freshNode.title } : n
      )
      usePlanStore.setState({ nodes: revertedNodes })
      onNodeUpdate(freshNode)

      addToast({
        type: 'error',
        title: 'Failed to update task title',
        description: err instanceof Error ? err.message : 'An unknown error occurred',
      })
      // Keep input open so user can retry or cancel
    }
  }, [node.id, onNodeUpdate, addToast, stopRenaming])

  return { isRenaming, startRenaming, stopRenaming, editingValue, handleRename }
}

interface NodeInspectorProps {
  node: PlanNode
  /** Project context for file completion and execution links */
  project: {
    id: string
    workingDirectory?: string
    defaultMachineId?: string
    fileTree?: string[]
  }
  /** Current view mode, used in "View Execution" link query param */
  viewMode?: string
  /** Called when inspector wants to close */
  onClose: () => void
  /** Called when node is updated (to sync local state) */
  onNodeUpdate: (node: PlanNode) => void
}

function ElapsedTime({ node }: { node: PlanNode }) {
  const execution = useExecutionStore((s) => s.getExecution(node.id))
  const [, setTick] = useState(0)

  const startedAt = execution?.startedAt
    ?? (node.executionStartedAt ? new Date(node.executionStartedAt) : undefined)
  const completedAt = execution?.completedAt
    ?? (node.executionCompletedAt ? new Date(node.executionCompletedAt) : undefined)
  const isRunning = !completedAt && !!startedAt

  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isRunning])

  if (!startedAt || isNaN(startedAt.getTime())) {
    return <span className="text-[13px] text-muted-foreground">-</span>
  }

  const endTime = completedAt ?? new Date()
  const seconds = Math.floor((endTime.getTime() - startedAt.getTime()) / 1000)
  if (seconds < 0) return <span className="text-[13px] text-muted-foreground">-</span>
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return (
    <span className="text-[13px] font-medium text-info tabular-nums">
      {m}:{s.toString().padStart(2, "0")}
    </span>
  )
}

/**
 * Reusable node inspector content panel.
 * Shows priority, estimate, dependencies, status, description, and action buttons.
 */
export function NodeInspectorContent({
  node,
  project,
  viewMode = "list",
  onNodeUpdate,
}: NodeInspectorProps) {
  const updateNode = usePlanStore((s) => s.updateNode)
  const resetExecution = useExecutionStore((s) => s.resetExecution)
  const [isResetting, setIsResetting] = useState(false)

  const allNodes = usePlanStore((s) => s.nodes)
  const allEdges = usePlanStore((s) => s.edges)
  const addEdge = usePlanStore((s) => s.addEdge)
  const removeEdge = usePlanStore((s) => s.removeEdge)

  // Upstream dependencies: edges pointing INTO this node
  const upstreamDeps = useMemo(() => {
    const liveEdges = allEdges.filter(isLive)
    const depEdges = liveEdges.filter((e) => e.target === node.id)
    const liveNodes = allNodes.filter(isLive)
    return depEdges.map((e) => {
      const depNode = liveNodes.find((n) => n.id === e.source)
      return { id: e.source, title: depNode?.title ?? e.source, status: depNode?.status }
    })
  }, [allEdges, allNodes, node.id])

  // Candidate nodes that can be added as dependencies (same project, not self, not already a dep)
  const addCandidates = useMemo(() => {
    const existingDepIds = new Set(upstreamDeps.map((d) => d.id))
    return allNodes
      .filter(isLive)
      .filter((n) => n.projectId === node.projectId && n.id !== node.id && !existingDepIds.has(n.id))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [allNodes, upstreamDeps, node.projectId, node.id])

  const [addDepOpen, setAddDepOpen] = useState(false)
  const [addDepSearch, setAddDepSearch] = useState("")
  const [labelManagerOpen, setLabelManagerOpen] = useState(false)
  const [convertDialogOpen, setConvertDialogOpen] = useState(false)
  const [pruneDialogOpen, setPruneDialogOpen] = useState(false)
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)

  // Schedule state
  const schedules = useScheduleStore((s) => s.schedules)
  const loadSchedules = useScheduleStore((s) => s.loadSchedules)
  const deleteSchedule = useScheduleStore((s) => s.deleteSchedule)
  const updateScheduleStore = useScheduleStore((s) => s.updateSchedule)
  const triggerSchedule = useScheduleStore((s) => s.triggerSchedule)
  const nodeSchedule = schedules.find((s) => s.scope === 'node' && s.nodeId === node.id)

  useEffect(() => {
    loadSchedules(node.projectId)
  }, [node.projectId, loadSchedules])

  // Full project (for convert-to-project: needs githubOwner, githubRepo, etc.)
  const fullProject = useProjectStore((s) => s.projects.find((p) => p.id === node.projectId))

  // Node is isolated when no live edge touches it
  const isIsolated = useMemo(() => {
    return isNodeIsolated(node.id, allEdges, isLive)
  }, [allEdges, node.id])

  // Get project labels for this node
  const projectForLabels = useProjectStore((s) => s.projects.find((p) => p.id === node.projectId))
  const projectLabels = projectForLabels?.labels ?? []

  // Milestone options: all milestone-type nodes in the same project
  const milestoneOptions = useMemo(() => {
    const milestones = allNodes
      .filter(isLive)
      .filter((n) => n.type === 'milestone' && n.projectId === node.projectId)
      .map((n) => ({ id: n.id, label: n.title, icon: Diamond }))
    return [{ id: 'none', label: 'No milestone' }, ...milestones]
  }, [allNodes, node.projectId])

  // Current milestone name for display
  const currentMilestoneName = useMemo(() => {
    if (!node.milestoneId) return null
    const ms = allNodes.find((n) => n.id === node.milestoneId)
    return ms?.title ?? null
  }, [allNodes, node.milestoneId])

  const filteredCandidates = useMemo(() => {
    if (!addDepSearch) return addCandidates
    const q = addDepSearch.toLowerCase()
    return addCandidates.filter((n) => n.title.toLowerCase().includes(q))
  }, [addCandidates, addDepSearch])

  const handleAddDep = useCallback((sourceId: string) => {
    addEdge({
      id: crypto.randomUUID(),
      source: sourceId,
      target: node.id,
      type: "dependency",
    })
    // Sync node.dependencies array
    const targetNode = allNodes.find((n) => n.id === node.id)
    if (targetNode && !targetNode.dependencies.includes(sourceId)) {
      updateNode(node.id, { dependencies: [...targetNode.dependencies, sourceId] })
    }
    setAddDepOpen(false)
    setAddDepSearch("")
  }, [addEdge, node.id, allNodes, updateNode])

  const handleRemoveDep = useCallback((sourceId: string) => {
    removeEdge(sourceId, node.id)
    const targetNode = allNodes.find((n) => n.id === node.id)
    if (targetNode) {
      updateNode(node.id, { dependencies: targetNode.dependencies.filter((d) => d !== sourceId) })
    }
  }, [removeEdge, node.id, allNodes, updateNode])

  const handleUpdate = useCallback((updates: Partial<PlanNode>) => {
    updateNode(node.id, updates)
    onNodeUpdate({ ...node, ...updates })
  }, [node, updateNode, onNodeUpdate])

  const nodeOutputDir = (node.metadata as Record<string, unknown> | undefined)?.outputDir as string | undefined

  // ── Verification state ───────────────────────────────────────
  const execution = useExecutionStore((s) => s.getExecution(node.id))
  const currentUserId = useUserProfileStore((s) => s.profile.id)
  const activeTeamId = useTeamStore((s) => s.activeTeamId)
  const teamMemberCount = useTeamStore((s) => (activeTeamId ? (s.teamMembers[activeTeamId]?.length ?? 0) : 0))
  const isSoloWorkspace = teamMemberCount <= 1
  const needsVerification = node.status === "awaiting_judgment" && !execution?.verifiedBy
  const isVerified = !!execution?.verifiedBy
  // Solo users can verify their own work (server enforces the same rule via isSoloWorkspace check)
  const canVerify = needsVerification && (isSoloWorkspace || execution?.userId !== currentUserId)
  const [verifyNote, setVerifyNote] = useState("")
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [verifyLoading, setVerifyLoading] = useState<string | null>(null) // 'approve' | 'rerun' | 'skip' | null

  const handleVerificationAction = useCallback(async (action: 'verify' | 'rerun' | 'skip') => {
    if (!execution?.executionId) return
    setVerifyLoading(action)
    try {
      const token = await getAccessToken()
      const headers: HeadersInit = { "Content-Type": "application/json" }
      if (token) headers["Authorization"] = `Bearer ${token}`

      const res = await fetch(apiUrl(`/api/executions/${execution.executionId}/${action}`), {
        method: "POST",
        headers,
        body: JSON.stringify({ note: verifyNote || undefined }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to ${action}`)
      }

      const data = await res.json()

      // Update local execution state
      if (data.execution) {
        const executions = useExecutionStore.getState().executions
        const updatedExec = executions.get(node.id)
        if (updatedExec) {
          const newExec = {
            ...updatedExec,
            verifiedBy: data.execution.verifiedBy ?? data.execution.verified_by,
            verificationNote: data.execution.verificationNote ?? data.execution.verification_note,
          }
          executions.set(node.id, newExec)
          useExecutionStore.setState({ executions: new Map(executions) })
        }
      }

      // Update node status if approved/skipped
      if (action === 'verify' || action === 'skip') {
        handleUpdate({ status: "completed" })
      }

      setVerifyNote("")
      setShowNoteInput(false)
      useToastStore.getState().add({
        type: 'success',
        title: action === 'verify' ? 'Execution verified' : action === 'skip' ? 'Verification skipped' : 'Re-run created',
      })
    } catch (err) {
      useToastStore.getState().add({
        type: 'error',
        title: `Failed to ${action}`,
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setVerifyLoading(null)
    }
  }, [execution?.executionId, node.id, verifyNote, handleUpdate])


  return (
    <>
      <div className="flex flex-col gap-3.5">
        {/* Priority */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Priority</span>
          <PropertyPicker
            value={node.priority ?? "none"}
            options={PRIORITY_OPTIONS}
            title="Set priority"
            onSelect={(id) => handleUpdate({ priority: id as Priority })}
          >
            {(() => {
              const config = PRIORITY_CONFIG[(node.priority ?? "none") as Priority]
              return (
                <span className={cn("text-[13px] font-medium", config.color)}>
                  {config.label}
                </span>
              )
            })()}
          </PropertyPicker>
        </div>

        {/* Estimate */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Estimate</span>
          <PropertyPicker
            value={node.estimate}
            options={ESTIMATE_OPTIONS}
            title="Set estimate"
            onSelect={(id) => handleUpdate({ estimate: id as PlanNode["estimate"] })}
          >
            <span className="text-[13px] font-medium text-foreground">
              {node.estimate ?? "\u2014"}
            </span>
          </PropertyPicker>
        </div>

        {/* Labels */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Labels</span>
          {projectLabels.length > 0 ? (
            <LabelPicker
              labelIds={node.labelIds ?? []}
              allLabels={projectLabels}
              displayMode="badges"
              onChange={(labelIds) => handleUpdate({ labelIds })}
              onManageLabels={() => setLabelManagerOpen(true)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setLabelManagerOpen(true)}
              className="text-[13px] text-primary hover:underline cursor-pointer"
            >
              Add labels
            </button>
          )}
        </div>
        <LabelManagerDialog
          open={labelManagerOpen}
          onOpenChange={setLabelManagerOpen}
          projectId={node.projectId}
        />

        {/* Milestone (only for non-milestone nodes) */}
        {node.type !== 'milestone' && (
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Milestone</span>
            <PropertyPicker
              value={node.milestoneId ?? 'none'}
              options={milestoneOptions}
              title="Set milestone"
              onSelect={(id) => handleUpdate({ milestoneId: id === 'none' ? undefined : id })}
            >
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                {currentMilestoneName ? (
                  <>
                    <Diamond className="h-3.5 w-3.5 text-muted-foreground" />
                    {currentMilestoneName}
                  </>
                ) : (
                  "\u2014"
                )}
              </span>
            </PropertyPicker>
          </div>
        )}

        {/* Dependencies */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Dependencies</span>
            <Popover open={addDepOpen} onOpenChange={(o) => { setAddDepOpen(o); if (!o) setAddDepSearch("") }}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded-sm p-0.5 -m-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-56 p-1"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={addDepSearch}
                  onChange={(e) => setAddDepSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground/50"
                  autoFocus
                />
                <div className="max-h-48 overflow-y-auto py-1">
                  {filteredCandidates.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">No tasks available</p>
                  ) : (
                    filteredCandidates.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => handleAddDep(n.id)}
                      >
                        <span className="text-muted-foreground text-xs font-mono min-w-[48px]">{getShortId(n.id)}</span>
                        <span className="flex-1 text-left truncate">{n.title}</span>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          {upstreamDeps.length > 0 ? (
            <div className="flex flex-col gap-1">
              {upstreamDeps.map((dep) => (
                <div
                  key={dep.id}
                  className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      dep.status === "completed" || dep.status === "auto_verified"
                        ? "bg-success"
                        : dep.status === "in_progress" || dep.status === "dispatched"
                          ? "bg-warning"
                          : "border border-muted-foreground/40"
                    )}
                  />
                  <span className="flex-1 truncate text-foreground">{dep.title}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveDep(dep.id) }}
                    className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 shrink-0 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-muted-foreground/60 px-1.5">No dependencies</span>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Status</span>
          <PropertyPicker
            value={node.status}
            options={STATUS_OPTIONS}
            title="Set status"
            onSelect={(id) => handleUpdate({ status: id as PlanNode["status"] })}
          >
            <span className="text-[13px] font-medium text-foreground">
              {statusLabels[node.status]}
            </span>
          </PropertyPicker>
        </div>

        {/* Elapsed time */}
        {node.executionId && (
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Elapsed</span>
            <ElapsedTime node={node} />
          </div>
        )}

        {/* Schedule */}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Schedule</span>
          {nodeSchedule ? (
            <div className="flex items-center gap-1.5">
              <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">{nodeSchedule.cronExpression}</code>
              <button
                type="button"
                onClick={() => updateScheduleStore(nodeSchedule.id, { enabled: !nodeSchedule.enabled })}
                className="p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                title={nodeSchedule.enabled ? "Pause" : "Enable"}
              >
                {nodeSchedule.enabled ? (
                  <ToggleRight className="h-3.5 w-3.5 text-success" />
                ) : (
                  <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setScheduleDialogOpen(true)}
                className="p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                title="Edit schedule"
              >
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => triggerSchedule(nodeSchedule.id)}
                className="p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                title="Run now"
              >
                <Play className="h-3 w-3 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => deleteSchedule(nodeSchedule.id)}
                className="p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                title="Delete schedule"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setScheduleDialogOpen(true)}
              className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline cursor-pointer"
            >
              <Clock className="h-3 w-3" />
              Add
            </button>
          )}
        </div>
        {nodeSchedule?.nextRunAt && (
          <div className="flex items-center justify-between text-[11px] -mt-1.5">
            <span className="text-muted-foreground/60 pl-0.5">Next run</span>
            <span className="text-muted-foreground/60">{new Date(nodeSchedule.nextRunAt).toLocaleString()}</span>
          </div>
        )}

        {/* Verification status pill */}
        {isVerified && execution && (
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="inline-flex items-center gap-1.5 self-start rounded-full bg-success/10 border border-success/25 px-2.5 py-1 text-[11px] font-medium text-success">
              <ShieldCheck className="h-3 w-3" />
              Verified{execution.verifiedBy === currentUserId ? " by you" : " by team member"}
            </div>
            {execution.verificationNote && (
              <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1.5 border border-border/50">
                <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="leading-relaxed">{execution.verificationNote}</span>
              </div>
            )}
          </div>
        )}

        {/* Needs verification pill */}
        {needsVerification && (
          <div className="inline-flex items-center gap-1.5 self-start rounded-full bg-warning/10 border border-warning/25 px-2.5 py-1 text-[11px] font-medium text-warning mt-1">
            <Eye className="h-3 w-3" />
            Needs verification
          </div>
        )}
      </div>

      {/* Verification actions */}
      {canVerify && (
        <>
          <Separator />
          <div className="flex flex-col gap-2.5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Eye className="h-3 w-3" />
                Review execution
              </div>
              {/* Inline note toggle */}
              {!showNoteInput && (
                <button
                  type="button"
                  onClick={() => setShowNoteInput(true)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer"
                >
                  <MessageSquare className="h-3 w-3" />
                  Add note
                </button>
              )}
            </div>

            {/* Optional note input */}
            {showNoteInput && (
              <div className="flex flex-col gap-1">
                <textarea
                  value={verifyNote}
                  onChange={(e) => setVerifyNote(e.target.value)}
                  placeholder="Reviewer note (optional)..."
                  className="w-full rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={2}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => { setShowNoteInput(false); setVerifyNote("") }}
                  className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground self-end transition-colors cursor-pointer"
                >
                  Remove note
                </button>
              </div>
            )}

            {/* Action buttons — Approve prominent, Re-run and Skip secondary */}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                disabled={!!verifyLoading}
                onClick={() => handleVerificationAction('verify')}
                className={cn(
                  "flex w-full items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                  "bg-success text-white hover:bg-success/90",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {verifyLoading === 'verify'
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ShieldCheck className="h-3.5 w-3.5" />}
                Approve
              </button>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={!!verifyLoading}
                  onClick={() => handleVerificationAction('rerun')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                    "bg-muted/60 text-foreground hover:bg-muted border border-border/60",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {verifyLoading === 'rerun'
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <RefreshCw className="h-3 w-3" />}
                  Re-run
                </button>
                <button
                  type="button"
                  disabled={!!verifyLoading}
                  onClick={() => handleVerificationAction('skip')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                    "bg-transparent text-muted-foreground hover:bg-muted border border-border/50",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {verifyLoading === 'skip'
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <SkipForward className="h-3 w-3" />}
                  Skip
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* Schedule Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{nodeSchedule ? 'Edit Schedule' : 'Create Schedule'}</DialogTitle>
          </DialogHeader>
          <ScheduleForm
            projectId={node.projectId}
            scope="node"
            nodeId={node.id}
            schedule={nodeSchedule}
            onSave={() => {
              setScheduleDialogOpen(false)
              loadSchedules(node.projectId)
            }}
            onCancel={() => setScheduleDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-2.5">
        {node.executionId ? (
          <>
            <Link
              to={`/project/${project.id}/task/${node.id}?from=${viewMode}&tab=activity`}
              className="flex items-center justify-center gap-2 h-10 rounded-[10px] bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <FileText className="h-4 w-4" />
              View Execution
            </Link>
            <button
              disabled={isResetting}
              onClick={async () => {
                setIsResetting(true)
                try {
                  await resetExecution(node.id)
                  const freshNode = usePlanStore.getState().nodes.find((n) => n.id === node.id)
                  if (freshNode) onNodeUpdate(freshNode)
                } finally {
                  setIsResetting(false)
                }
              }}
              className="flex items-center justify-center gap-2 h-10 rounded-[10px] border border-border bg-transparent text-sm font-semibold hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              <RotateCcw className={cn("h-4 w-4", isResetting && "animate-spin")} />
              {isResetting ? "Resetting..." : "Reset"}
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <ExecutionPanel node={node} projectId={project.id} viewMode={viewMode} />
          </div>
        )}

        {nodeOutputDir && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(`analysis/${nodeOutputDir}/`)
              useToastStore.getState().add({ title: "Copied output path", type: "success" })
            }}
            className="flex items-center justify-center gap-2 h-10 rounded-[10px] border border-border bg-transparent text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <Copy className="h-4 w-4" />
            Copy Output Path
          </button>
        )}

        {node.status !== "pruned" && (
          <>
            <button
              onClick={() => setPruneDialogOpen(true)}
              className="flex items-center justify-center gap-2 h-10 rounded-[10px] border border-border bg-transparent text-destructive text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <XCircle className="h-4 w-4" />
              {node.type === 'milestone' ? 'Prune Milestone' : 'Prune Branch'}
            </button>
            <PruneCleanupDialog
              open={pruneDialogOpen}
              onOpenChange={setPruneDialogOpen}
              node={node}
              projectId={project.id}
            />
          </>
        )}

        {isIsolated && node.status !== "pruned" && (
          <>
            <button
              onClick={() => setConvertDialogOpen(true)}
              className="flex items-center justify-center gap-2 h-10 rounded-[10px] border border-border bg-transparent text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <ArrowUpRight className="h-4 w-4" />
              Turn into Project
            </button>
            <ConvertToProjectDialog
              open={convertDialogOpen}
              onOpenChange={setConvertDialogOpen}
              node={node}
              hasGitHub={!!(fullProject?.githubOwner && fullProject?.githubRepo)}
            />
          </>
        )}
      </div>
    </>
  )
}

/**
 * Mobile: floating card dialog wrapping NodeInspectorContent.
 */
export function NodeInspectorSheet(props: NodeInspectorProps & { open: boolean }) {
  const { open, onClose, node, onNodeUpdate, ...rest } = props
  const { isRenaming, startRenaming, stopRenaming, editingValue, handleRename } = useTaskRename(
    node,
    onNodeUpdate,
    { guardOpen: open }
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="fixed inset-3 left-auto right-3 top-3 bottom-3 w-[calc(100%-1.5rem)] max-w-sm translate-x-0 translate-y-0 rounded-2xl bg-card/90 backdrop-blur-md shadow-2xl border-border/40 p-0 overflow-hidden">
        <div className="flex flex-col gap-5 p-4 overflow-auto h-full">
          <div className="flex items-center justify-between gap-2">
            {isRenaming ? (
              <InlineRenameInput
                value={editingValue ?? node.title}
                onSave={handleRename}
                onCancel={stopRenaming}
                validate={validateTaskTitle}
                className="text-base font-semibold"
              />
            ) : (
              <h3
                className="font-semibold text-base truncate flex-1 pr-8 group/title cursor-text"
                onDoubleClick={startRenaming}
              >
                {node.title}
                <button
                  className="inline-flex items-center justify-center ml-1.5 p-1 -m-1 rounded opacity-40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/title:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); startRenaming() }}
                  aria-label="Rename task"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </h3>
            )}
          </div>
          <Separator />
          <NodeInspectorContent node={node} onClose={onClose} onNodeUpdate={onNodeUpdate} {...rest} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Desktop: right sidebar wrapping NodeInspectorContent.
 */
export function NodeInspectorSidebar(props: NodeInspectorProps) {
  const { node, onClose, onNodeUpdate, ...rest } = props
  const { isRenaming, startRenaming, stopRenaming, editingValue, handleRename } = useTaskRename(
    node,
    onNodeUpdate
  )

  return (
    <div className="flex flex-col gap-5 border-l bg-card p-5 overflow-auto border-border w-[320px] shrink-0">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-muted-foreground">Node Inspector</h4>
        <Button
          variant="ghost"
          size="icon"
          className="h-[18px] w-[18px] shrink-0 p-0 hover:bg-transparent"
          onClick={onClose}
        >
          <X className="h-[18px] w-[18px] text-muted-foreground" />
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {isRenaming ? (
          <InlineRenameInput
            value={editingValue ?? node.title}
            onSave={handleRename}
            onCancel={stopRenaming}
            validate={validateTaskTitle}
            className="text-xl font-semibold font-serif"
          />
        ) : (
          <h3
            className="font-semibold text-xl text-foreground truncate font-serif group/title cursor-text"
            onDoubleClick={startRenaming}
          >
            {node.title}
            <button
              className="inline-flex items-center justify-center ml-1.5 p-1 -m-1 rounded opacity-40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/title:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer"
              onClick={(e) => { e.stopPropagation(); startRenaming() }}
              aria-label="Rename task"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </h3>
        )}
        {node.executionId && (
          <div className="flex items-center gap-2 text-xs">
            <div className="h-2 w-2 rounded-full bg-muted" />
            <span className="text-muted-foreground">MacBook Pro</span>
          </div>
        )}
      </div>
      <Separator />
      <NodeInspectorContent node={node} onClose={onClose} onNodeUpdate={onNodeUpdate} {...rest} />
    </div>
  )
}
