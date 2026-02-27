/**
 * Plan Generate View
 *
 * Embedded in plan-view as a "generate" view mode.
 * Two-phase component:
 *   1. Landing: textarea + machine/provider selectors + session picker
 *   2. Activity: renders PlanChatPhase for streaming activity
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useNavigate } from "react-router"
import { Sparkles, Loader2, Laptop, Bot, Clock, Play, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useSettingsStore, resolveModel, type ModelTier } from "@/stores/settings-store"
import { PlanChatPhase } from "@/components/plan-session/plan-chat-phase"
import { SessionPickerDialog } from "@/components/playground/session-picker-dialog"
import { deriveAvailableProviders, isProviderAvailable, PROVIDER_NAMES } from "@/components/execution/provider-utils"
import { isServerMode } from "@/lib/app-mode"
import { BranchSelector } from "@/components/branch-selector"
import { cn } from "@/lib/utils"

interface PlanGenerateViewProps {
  projectId: string
}

export function PlanGenerateView({ projectId }: PlanGenerateViewProps) {
  const navigate = useNavigate()

  // Input phase state
  const [description, setDescription] = useState("")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [showSessionPicker, setShowSessionPicker] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const modelTier: ModelTier = "large"

  // Stores
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const startPlanSessionForProject = useExecutionStore((s) => s.startPlanSessionForProject)
  const allExecutions = useExecutionStore((s) => s.executions)
  const allProjects = useProjectStore((s) => s.projects)
  const execution = useExecutionStore((s) => s.executions.get(`plan-${projectId}`))
  const cancelPlanSession = useExecutionStore((s) => s.cancelPlanSession)
  const planNodes = usePlanStore((s) => s.nodes.filter((n) => n.projectId === projectId && isLive(n)))

  // Machines
  const machines = useExecutionStore((s) => s.machines)
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const realtimeMachines = useRealtimeStore((s) => s.machines)
  const registeredMachines = useMachinesStore((s) => s.machines)

  // Providers
  const globalProviders = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const availableProviders = useMemo(
    () => deriveAvailableProviders(selectedMachine?.providers, globalProviders),
    [selectedMachine?.providers, globalProviders]
  )

  // Load machines and providers on mount
  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  useEffect(() => {
    if (!providersLoaded) loadProviders()
  }, [providersLoaded, loadProviders])

  // Reset provider/model when machine changes
  useEffect(() => {
    if (selectedProvider && availableProviders.length > 0) {
      if (!isProviderAvailable(selectedProvider, availableProviders)) {
        setSelectedProvider("")
        setSelectedModel("")
      }
    }
  }, [selectedMachine?.machineId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Available machines from relay + local
  const allMachines = useMemo<MachineInfo[]>(() => [
    ...machines,
    ...Array.from(realtimeMachines.values()).map((m) => ({
      machineId: m.machineId,
      name: m.name,
      status: 'online' as const,
      providers: m.providers.map((p) => ({ type: p.type, status: p.status })),
    })),
  ].filter((m, i, arr) => arr.findIndex((a) => a.machineId === m.machineId) === i), [machines, realtimeMachines])

  // Pre-select machine from project config
  const machineInitialized = useRef(false)
  useEffect(() => {
    if (machineInitialized.current || allMachines.length === 0 || !project?.defaultMachineId) return
    const match = allMachines.find((m) => m.machineId === project.defaultMachineId)
    if (match) {
      machineInitialized.current = true
      setSelectedMachine(match)
    }
  }, [project?.defaultMachineId, allMachines])

  // Pre-select branch from project source
  const branchInitialized = useRef(false)
  useEffect(() => {
    if (branchInitialized.current || !project?.source?.baseBranch) return
    branchInitialized.current = true
    setSelectedBranch(project.source.baseBranch)
  }, [project?.source?.baseBranch])

  const effectiveBranch = selectedBranch || project?.source?.baseBranch || null

  // Recent plan sessions (projects with plan-${id} executions, excluding current)
  const planHistory = useMemo(() => {
    return allProjects
      .filter((p) => p.id !== projectId && p.projectType !== 'playground' && allExecutions.has(`plan-${p.id}`))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10)
  }, [allProjects, allExecutions, projectId])

  // Plan session projects for session picker
  const planSessionProjects = useMemo(() => {
    return allProjects
      .filter((p) => p.projectType !== 'playground' && allExecutions.has(`plan-${p.id}`))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [allProjects, allExecutions])

  // Machine name for display
  const machineName = (() => {
    if (!execution?.machineId) return undefined
    const realtimeM = realtimeMachines.get(execution.machineId)
    if (realtimeM) return realtimeM.name
    const registeredM = registeredMachines.find((m) => m.id === execution.machineId)
    if (registeredM) return registeredM.name
    return execution.machineId
  })()

  const customModelMap = useSettingsStore((s) => s.customModelMap)

  async function handleSubmit() {
    if (!description.trim() || isSubmitting) return
    setIsSubmitting(true)

    try {
      const effectiveModel = selectedModel || resolveModel(modelTier, selectedProvider || undefined, customModelMap)
      await startPlanSessionForProject(
        projectId,
        description.trim(),
        {
          targetMachineId: selectedMachine?.machineId,
          workingDirectory: project?.workingDirectory || undefined,
          preferredProvider: selectedProvider || undefined,
          model: effectiveModel,
          baseBranch: effectiveBranch || undefined,
        }
      )
    } catch (error) {
      console.error("[plan-generate] Failed to start:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  // View a past plan session
  const viewSession = useCallback((pid: string) => {
    navigate(`/project/${pid}/graph`)
  }, [navigate])

  // When plan is completed and has nodes, auto-switch to graph view
  const prevStatus = useRef(execution?.status)
  useEffect(() => {
    if (prevStatus.current === "running" && execution?.status === "success" && planNodes.length > 0) {
      // Small delay so the user sees the result card
      const timer = setTimeout(() => navigate(`/project/${projectId}/graph`), 1500)
      return () => clearTimeout(timer)
    }
    prevStatus.current = execution?.status
  }, [execution?.status, planNodes.length, projectId, navigate])

  // ─── Activity Phase (only for active sessions) ────────────────────
  const isActiveExecution = execution && (execution.status === "running" || execution.status === "pending")
  if (isActiveExecution) {
    return (
      <div className="h-full">
        <PlanChatPhase
          projectId={projectId}
          projectName={project?.name || "Project"}
          machineName={machineName}
          workingDirectory={project?.workingDirectory || undefined}
          onBack={() => {
            cancelPlanSession(projectId)
          }}
        />
      </div>
    )
  }

  // ─── Landing Phase ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold font-sans mb-2">Generate Plan</h1>
          <p className="text-sm text-muted-foreground">
            Describe your goal. The agent will explore your codebase, ask questions, and build a plan collaboratively.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Goal textarea */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="What do you want to build or accomplish?"
            rows={6}
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />

          {/* OR divider + session picker */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <div className="flex-1 border-t border-border" />
          </div>

          <button
            onClick={() => setShowSessionPicker(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
          >
            <Clock className="h-4 w-4" />
            Resume a previous planning session
          </button>

          {/* Machine selector */}
          {(isServerMode() || allMachines.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Machine:</span>
              <div className="flex flex-wrap gap-2">
                {allMachines.map((m) => (
                  <button
                    key={m.machineId}
                    onClick={() => setSelectedMachine(
                      selectedMachine?.machineId === m.machineId ? null : m
                    )}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                      selectedMachine?.machineId === m.machineId
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Laptop className="h-3 w-3" />
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Provider selector */}
          {availableProviders.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Provider:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { setSelectedProvider(""); setSelectedModel("") }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                    !selectedProvider
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <Bot className="h-3 w-3" />
                  Auto
                </button>
                {availableProviders.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProvider(selectedProvider === p.id ? "" : p.id)
                      setSelectedModel("")
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                      selectedProvider === p.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Bot className="h-3 w-3" />
                    {PROVIDER_NAMES[p.id] || p.name || p.id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Working directory + branch selector */}
          {project?.workingDirectory && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="font-mono truncate">{project.workingDirectory}</span>
              </div>
              {selectedMachine && (
                <BranchSelector
                  value={effectiveBranch || 'main'}
                  onChange={setSelectedBranch}
                  path={project.workingDirectory}
                  machineId={selectedMachine.machineId}
                />
              )}
            </div>
          )}

          {/* Submit button */}
          <div className="flex items-center justify-end gap-3">
            <p className="text-[10px] text-muted-foreground">
              Cmd+Enter to submit
            </p>
            <Button
              onClick={handleSubmit}
              disabled={!description.trim() || isSubmitting}
              className="gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {isSubmitting ? "Starting..." : "Start Planning"}
            </Button>
          </div>
        </div>

        {/* Recent Plan Sessions */}
        {planHistory.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Recent Sessions
            </h2>
            <div className="flex flex-col gap-1">
              {planHistory.map((p) => {
                const exec = allExecutions.get(`plan-${p.id}`)
                const statusLabel = exec?.status === 'running' ? 'Running'
                  : exec?.status === 'success' ? 'Completed'
                  : exec?.status === 'failure' ? 'Failed'
                  : exec?.status === 'cancelled' ? 'Cancelled'
                  : 'Pending'
                const statusColor = exec?.status === 'running' ? 'bg-primary'
                  : exec?.status === 'success' ? 'bg-success'
                  : exec?.status === 'failure' ? 'bg-destructive'
                  : 'bg-muted-foreground'

                return (
                  <button
                    key={p.id}
                    onClick={() => viewSession(p.id)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left group"
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", statusColor)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">
                        {p.workingDirectory || "\u2014"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px]">
                        {statusLabel}
                      </Badge>
                      {exec?.status !== 'running' && exec?.status !== 'pending' && (
                        <Play className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Session picker dialog */}
        <SessionPickerDialog
          open={showSessionPicker}
          onOpenChange={setShowSessionPicker}
          onSelectSession={() => {}}
          planSessions={planSessionProjects}
          onSelectPlanSession={(pid) => navigate(`/project/${pid}/graph`)}
        />
      </div>
    </div>
  )
}
