/**
 * Interactive Plan Mode Page
 *
 * Two-phase component:
 * 1. Input Phase: Goal description textarea + optional advanced settings
 * 2. Chat Phase: Full-height streaming activity with inline approvals
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useSearchParams, useNavigate, useLocation } from "react-router"
import { Sparkles, Loader2, Laptop, FolderOpen, GitBranch, AlertCircle, Info, Monitor, Bot, Clock, Play, FileCode2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useSettingsStore, resolveModel, type ModelTier } from "@/stores/settings-store"
import { PlanChatPhase } from "@/components/plan-session/plan-chat-phase"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { BranchSelector } from "@/components/branch-selector"
import { useDirectoryDetection } from "@/hooks/use-directory-detection"
import { requestNotificationPermission } from "@/lib/notifications"
import { OnboardingHint } from "@/components/onboarding-hint"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"
import { deriveAvailableProviders, isProviderAvailable, PROVIDER_NAMES } from "@/components/execution/provider-utils"

export function ProjectNewPlan() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectIdParam = searchParams.get("projectId")
  const navigate = useNavigate()
  const location = useLocation()

  // Playground context from location state
  const fromPlaygroundId = (location.state as { fromPlaygroundId?: string } | null)?.fromPlaygroundId

  // Input phase state
  const [description, setDescription] = useState("")
  const [workingDir, setWorkingDir] = useState("")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPathBrowser, setShowPathBrowser] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [modelTier, setModelTier] = useState<ModelTier>("large")

  // Git detection (debounced)
  const { detection, isDetecting } = useDirectoryDetection(workingDir, selectedMachine?.machineId)
  const effectiveBranch = selectedBranch || (detection?.isGit ? detection.baseBranch : null)

  // Chat phase state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectIdParam)
  // Track project IDs created by startPlanSession in this session (safe to delete on cancel)
  const ownedProjectIds = useRef(new Set<string>())

  // Stores
  const startPlanSession = useExecutionStore((s) => s.startPlanSession)
  const allExecutions = useExecutionStore((s) => s.executions)
  const execution = useExecutionStore((s) =>
    activeProjectId ? s.executions.get(`plan-${activeProjectId}`) : undefined
  )
  const allProjects = useProjectStore((s) => s.projects)
  const project = useProjectStore((s) =>
    activeProjectId ? s.projects.find((p) => p.id === activeProjectId) : undefined
  )

  // Playground context: read project and execution data
  const playgroundProject = useProjectStore((s) =>
    fromPlaygroundId ? s.projects.find((p) => p.id === fromPlaygroundId) : undefined
  )
  const playgroundExecution = useExecutionStore((s) =>
    fromPlaygroundId ? s.executions.get(`playground-${fromPlaygroundId}`) : undefined
  )

  // Recent interactive plan sessions (projects that have a plan-${id} execution)
  const planHistory = useMemo(() => {
    return allProjects
      .filter((p) => p.projectType !== 'playground' && allExecutions.has(`plan-${p.id}`))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10)
  }, [allProjects, allExecutions])

  // View a past plan session
  const viewSession = useCallback((projectId: string) => {
    const exec = allExecutions.get(`plan-${projectId}`)
    if (exec?.status === 'pending' || exec?.status === 'running') {
      // Still running — open in chat phase
      setActiveProjectId(projectId)
      setSearchParams({ projectId })
    } else {
      // Completed — navigate to the project's plan view
      navigate(`/project/${projectId}/list`)
    }
  }, [allExecutions, setSearchParams, navigate])

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

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission()
  }, [])

  // Reset provider/model when machine changes and current provider isn't available
  useEffect(() => {
    if (selectedProvider && availableProviders.length > 0) {
      if (!isProviderAvailable(selectedProvider, availableProviders)) {
        setSelectedProvider("")
        setSelectedModel("")
      }
    }
  }, [selectedMachine?.machineId]) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only on machine change

  // If URL has projectId, transition to chat phase
  useEffect(() => {
    if (projectIdParam && !activeProjectId) {
      setActiveProjectId(projectIdParam)
    }
  }, [projectIdParam, activeProjectId])

  // Determine machine name for display
  const machineName = (() => {
    if (!execution?.machineId) return undefined
    const realtimeM = realtimeMachines.get(execution.machineId)
    if (realtimeM) return realtimeM.name
    const registeredM = registeredMachines.find((m) => m.id === execution.machineId)
    if (registeredM) return registeredM.name
    return execution.machineId
  })()

  // Available machines from relay + local (memoized to avoid re-render cascades)
  const allMachines = useMemo<MachineInfo[]>(() => [
    ...machines,
    ...Array.from(realtimeMachines.values()).map((m) => ({
      machineId: m.machineId,
      name: m.name,
      status: 'online' as const,
      providers: m.providers.map((p) => ({ type: p.type, status: p.status })),
    })),
  ].filter((m, i, arr) => arr.findIndex((a) => a.machineId === m.machineId) === i), [machines, realtimeMachines])

  // Pre-fill description + working directory from playground context (once)
  const playgroundPrefilled = useRef(false)
  useEffect(() => {
    if (!fromPlaygroundId || !playgroundProject || playgroundPrefilled.current) return
    playgroundPrefilled.current = true

    // Seed description from follow-ups or original playground description
    const summary = playgroundExecution?.summary
    if (summary?.followUps?.length) {
      setDescription(summary.followUps.join('\n'))
    } else if (playgroundProject.description) {
      setDescription(playgroundProject.description)
    }

    // Pre-fill working directory
    if (playgroundProject.workingDirectory) {
      setWorkingDir(playgroundProject.workingDirectory)
    }
  }, [fromPlaygroundId, playgroundProject, playgroundExecution])

  // Pre-fill machine separately — machines load async and may arrive after the first effect
  const machinePrefilled = useRef(false)
  useEffect(() => {
    if (!fromPlaygroundId || !playgroundProject?.defaultMachineId || machinePrefilled.current || allMachines.length === 0) return
    const match = allMachines.find((m) => m.machineId === playgroundProject.defaultMachineId)
    if (match) {
      machinePrefilled.current = true
      setSelectedMachine(match)
    }
  }, [fromPlaygroundId, playgroundProject?.defaultMachineId, allMachines])

  // Build visionDoc from playground execution summary
  const playgroundVisionDoc = useMemo(() => {
    if (!fromPlaygroundId || !playgroundProject) return undefined
    const summary = playgroundExecution?.summary

    const sections: string[] = ['## Context from Prior Playground Session\n']

    if (summary) {
      if (summary.workCompleted) {
        sections.push(`### Work Completed\n${summary.workCompleted}\n`)
      }
      if (summary.keyFindings?.length) {
        sections.push(`### Key Findings\n${summary.keyFindings.map((f) => `- ${f}`).join('\n')}\n`)
      }
      if (summary.filesChanged?.length) {
        const files = summary.filesChanged.slice(0, 50)
        sections.push(`### Files Changed\n${files.map((f) => `- \`${f}\``).join('\n')}\n`)
      }
      if (summary.followUps?.length) {
        sections.push(`### Suggested Follow-ups\n${summary.followUps.map((f) => `- ${f}`).join('\n')}\n`)
      }
    } else if (playgroundExecution?.streamText) {
      sections.push(`### Session Output (truncated)\n${playgroundExecution.streamText.slice(0, 2000)}\n`)
    }

    if (playgroundProject.description) {
      sections.push(`### Original Goal\n${playgroundProject.description}\n`)
    }

    // Always return the visionDoc when from playground (even if minimal) so the
    // "From Playground" badge detection in PlanChatPhase works reliably
    return sections.join('\n')
  }, [fromPlaygroundId, playgroundProject, playgroundExecution])

  const customModelMap = useSettingsStore((s) => s.customModelMap)

  async function handleSubmit() {
    if (!description.trim() || isSubmitting) return
    setIsSubmitting(true)

    try {
      const effectiveModel = selectedModel || resolveModel(modelTier, selectedProvider || undefined, customModelMap)
      const { projectId } = await startPlanSession(
        description.trim(),
        "",
        {
          targetMachineId: selectedMachine?.machineId,
          workingDirectory: workingDir || undefined,
          preferredProvider: selectedProvider || undefined,
          model: effectiveModel,
          visionDoc: playgroundVisionDoc,
        }
      )

      ownedProjectIds.current.add(projectId)
      setActiveProjectId(projectId)
      setSearchParams({ projectId })
    } catch (error) {
      console.error("[plan-session] Failed to start:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Chat Phase ─────────────────────────────────────────────────
  if (activeProjectId && execution) {
    return (
      <div className="h-full">
        <PlanChatPhase
          projectId={activeProjectId}
          projectName={project?.name || "New Project"}
          machineName={machineName}
          workingDirectory={project?.workingDirectory || workingDir || undefined}
          onCancel={() => {
            const pid = activeProjectId
            setActiveProjectId(null)
            setSearchParams({})
            // Only delete the project if it was created by this session (not loaded from URL)
            if (pid && ownedProjectIds.current.has(pid)) {
              ownedProjectIds.current.delete(pid)
              useExecutionStore.getState().cleanupPlanSession(pid)
            }
          }}
        />
      </div>
    )
  }

  // ─── Input Phase ────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center min-h-full p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold font-sans mb-2">Interactive Plan</h1>
          <p className="text-sm text-muted-foreground">
            Describe your goal. Agent will explore your codebase, ask questions, and build a plan collaboratively.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Onboarding hint about machine setup */}
          {allMachines.length > 0 && !selectedMachine && (
            <OnboardingHint hintId="plan-machine-setup" icon={Monitor}>
              Select a <strong>machine</strong> and <strong>working directory</strong> below so the plan can be executed on your environment.
            </OnboardingHint>
          )}

          {/* Playground context card */}
          {fromPlaygroundId && playgroundProject && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-primary">Building on playground session</p>
                {playgroundExecution?.summary?.workCompleted && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {playgroundExecution.summary.workCompleted}
                  </p>
                )}
                {playgroundExecution?.summary?.filesChanged && playgroundExecution.summary.filesChanged.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    <FileCode2 className="h-3 w-3" />
                    {playgroundExecution.summary.filesChanged.length} files changed
                  </p>
                )}
              </div>
            </div>
          )}

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
            rows={8}
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />

          {/* Machine selector */}
          {(isServerMode() || allMachines.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Optionally choose a machine:</span>
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

          {/* Provider selector — always shown when providers available, filtered by machine */}
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

          {/* Model size selector */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Model size:</span>
            <div className="flex flex-wrap gap-2">
              {(["small", "medium", "large"] as const).map((tier) => {
                const label = tier === "small" ? "Small" : tier === "medium" ? "Medium" : "Large"
                const resolved = resolveModel(tier, selectedProvider || undefined, customModelMap)
                return (
                  <button
                    key={tier}
                    onClick={() => { setModelTier(tier); setSelectedModel("") }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors cursor-pointer",
                      modelTier === tier
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Sparkles className="h-3 w-3" />
                    {label}
                    <span className="text-[10px] text-muted-foreground">({resolved})</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Working directory — only shown when a machine is selected */}
          {selectedMachine && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPathBrowser(true)}
                  title="Browse directories"
                  className="shrink-0 rounded-md border border-border p-1.5 hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
                <input
                  type="text"
                  value={workingDir}
                  onChange={(e) => {
                    setWorkingDir(e.target.value)
                    setSelectedBranch(null)
                  }}
                  placeholder="/path/to/project (optional)"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* Detection feedback */}
              <DetectionFeedback detection={detection} isDetecting={isDetecting} />

              {/* Branch selector */}
              {detection?.isGit && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">Target branch:</span>
                  <BranchSelector
                    value={effectiveBranch || 'main'}
                    onChange={setSelectedBranch}
                    path={workingDir.trim()}
                    machineId={selectedMachine.machineId}
                  />
                </div>
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
                        {p.workingDirectory || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px]">
                        {statusLabel}
                      </Badge>
                      {exec?.status !== 'running' && exec?.status !== 'pending' && (
                        <Play className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Remote path browser dialog */}
        {selectedMachine && (
          <RemotePathBrowser
            open={showPathBrowser}
            onOpenChange={setShowPathBrowser}
            machineId={selectedMachine.machineId}
            machineName={selectedMachine.name}
            currentPath={workingDir || undefined}
            onSelect={(path) => setWorkingDir(path)}
          />
        )}
      </div>
    </div>
  )
}

/** Compact detection feedback for advanced settings */
function DetectionFeedback({
  detection,
  isDetecting,
}: {
  detection: ReturnType<typeof useDirectoryDetection>["detection"]
  isDetecting: boolean
}) {
  if (!detection && !isDetecting) return null

  if (isDetecting) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking directory...
      </div>
    )
  }

  if (!detection) return null

  if (!detection.exists) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3 w-3" />
        Directory will be created with git initialized.
      </div>
    )
  }

  if (detection.isGit) {
    const branchInfo = detection.currentBranch ? ` on ${detection.currentBranch}` : ""
    const dirtyInfo = detection.isDirty ? " (dirty)" : ""
    const remoteLabel = detection.remoteType !== "none" ? ` · ${detection.remoteType}` : " · local only"
    return (
      <div className="flex items-center gap-2 text-xs text-info">
        <GitBranch className="h-3 w-3" />
        Git repo{branchInfo}{dirtyInfo}{remoteLabel}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs text-warning">
      <AlertCircle className="h-3 w-3" />
      No git — initialize recommended for safe parallel execution.
    </div>
  )
}
