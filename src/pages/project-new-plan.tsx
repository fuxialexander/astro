/**
 * Interactive Plan Mode Page
 *
 * Two-phase component:
 * 1. Input Phase: Goal description textarea + optional advanced settings
 * 2. Chat Phase: Full-height streaming activity with inline approvals
 */

import { useState, useEffect, useMemo } from "react"
import { useSearchParams } from "react-router"
import { Sparkles, Loader2, Laptop, FolderOpen, GitBranch, AlertCircle, Info, Monitor, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useRealtimeStore } from "@/stores/realtime-store"
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

  // Input phase state
  const [description, setDescription] = useState("")
  const [workingDir, setWorkingDir] = useState("")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPathBrowser, setShowPathBrowser] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")

  // Git detection (debounced)
  const { detection, isDetecting } = useDirectoryDetection(workingDir, selectedMachine?.machineId)
  const effectiveBranch = selectedBranch || (detection?.isGit ? detection.baseBranch : null)

  // Chat phase state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectIdParam)

  // Stores
  const startPlanSession = useExecutionStore((s) => s.startPlanSession)
  const execution = useExecutionStore((s) =>
    activeProjectId ? s.executions.get(`plan-${activeProjectId}`) : undefined
  )
  const project = useProjectStore((s) =>
    activeProjectId ? s.projects.find((p) => p.id === activeProjectId) : undefined
  )

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

  async function handleSubmit() {
    if (!description.trim() || isSubmitting) return
    setIsSubmitting(true)

    try {
      const { projectId } = await startPlanSession(
        description.trim(),
        "",
        {
          targetMachineId: selectedMachine?.machineId,
          workingDirectory: workingDir || undefined,
          preferredProvider: selectedProvider || undefined,
          model: selectedModel || undefined,
        }
      )

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
