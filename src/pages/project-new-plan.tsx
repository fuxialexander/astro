/**
 * Interactive Plan Mode Page
 *
 * Two-phase component:
 * 1. Input Phase: Goal description textarea + optional advanced settings
 * 2. Chat Phase: Full-height streaming activity with inline approvals
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useSearchParams, useLocation } from "react-router"
import { Sparkles, Loader2, Laptop, FolderOpen, GitBranch, AlertCircle, Info, Monitor, Bot, Clock, X, FileCode2, Layers, Github, Link, ChevronDown, ChevronRight, FileText, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useSettingsStore, resolveModel, type ModelTier } from "@/stores/settings-store"
import { useClaudeSessionsStore } from "@/stores/claude-sessions-store"
import { PlanChatPhase } from "@/components/plan-session/plan-chat-phase"
import { SessionPickerDialog } from "@/components/playground/session-picker-dialog"
import { RemotePathBrowser } from "@/components/remote-path-browser"
import { BranchSelector } from "@/components/branch-selector"
import { GitHubRepoPickerDialog } from "@/components/github-repo-picker-dialog"
import { AttachmentList } from "@/components/task-detail/attachment-list"
import { useDirectoryDetection } from "@/hooks/use-directory-detection"
import { useGitHubStore } from "@/stores/github-store"
import { requestNotificationPermission } from "@/lib/notifications"
import { OnboardingHint } from "@/components/onboarding-hint"
import { isServerMode } from "@/lib/app-mode"
import { cn } from "@/lib/utils"
import { deriveAvailableProviders, isProviderAvailable, PROVIDER_NAMES } from "@/components/execution/provider-utils"
import type { GitHubRepo, TaskAttachment } from "@/types"

/** Parse a GitHub URL to extract owner and repo name */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Match https://github.com/owner/repo, git@github.com:owner/repo, or owner/repo
  const httpsMatch = url.match(/github\.com[/:]([^/\s]+)\/([^/\s.]+?)(?:\.git)?(?:[/#?]|$)/)
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }

  // Match bare "owner/repo" format
  const bareMatch = url.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/)
  if (bareMatch) return { owner: bareMatch[1], repo: bareMatch[2] }

  return null
}

export function ProjectNewPlan() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectIdParam = searchParams.get("projectId")
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
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
  const [repoUrl, setRepoUrl] = useState("")
  const [githubOwner, setGithubOwner] = useState("")
  const [githubRepo, setGithubRepo] = useState("")
  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [visionDoc, setVisionDoc] = useState("")
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const modelTier: ModelTier = "large"

  // Git detection (debounced)
  const { detection, isDetecting } = useDirectoryDetection(workingDir, selectedMachine?.machineId)
  const effectiveBranch = selectedBranch || (detection?.isGit ? detection.baseBranch : null)

  // Chat phase state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectIdParam)


  // GitHub connection
  const githubConnected = useGitHubStore((s) => s.connected)
  const githubRepos = useGitHubStore((s) => s.repos)
  const fetchGitHubStatus = useGitHubStore((s) => s.fetchStatus)
  const fetchGitHubRepos = useGitHubStore((s) => s.fetchRepos)

  // Stores
  const startPlanSession = useExecutionStore((s) => s.startPlanSession)
  const startPlanSessionForProject = useExecutionStore((s) => s.startPlanSessionForProject)
  const allExecutions = useExecutionStore((s) => s.executions)
  const execution = useExecutionStore((s) =>
    activeProjectId ? s.executions.get(`plan-${activeProjectId}`) : undefined
  )
  const allProjects = useProjectStore((s) => s.projects)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const project = useProjectStore((s) =>
    activeProjectId ? s.projects.find((p) => p.id === activeProjectId) : undefined
  )

  // Detect existing project with zero plan nodes (for re-generation pre-fill)
  const planNodes = usePlanStore((s) => s.nodes)
  const existingProject = useProjectStore((s) =>
    projectIdParam ? s.projects.find((p) => p.id === projectIdParam) : undefined
  )
  const existingProjectHasNoNodes = useMemo(() => {
    if (!existingProject) return false
    return planNodes.filter((n) => n.projectId === existingProject.id && isLive(n)).length === 0
  }, [existingProject, planNodes])

  // Playground context: read project and execution data
  const playgroundProject = useProjectStore((s) =>
    fromPlaygroundId ? s.projects.find((p) => p.id === fromPlaygroundId) : undefined
  )
  const playgroundExecution = useExecutionStore((s) =>
    fromPlaygroundId ? s.executions.get(`playground-${fromPlaygroundId}`) : undefined
  )

  // Recent plan chat sessions (projectType === 'plan')
  const planHistory = useMemo(() => {
    return allProjects
      .filter((p) => p.projectType === 'plan')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20)
  }, [allProjects])

  // Playground sessions (for the session picker)
  const playgroundHistory = useMemo(() => {
    return allProjects
      .filter((p) => p.projectType === 'playground')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20)
  }, [allProjects])

  // Sessions store (Claude Code sessions from connected machines)
  const loadSessions = useClaudeSessionsStore((s) => s.loadSessions)

  // View a past plan session — always open in chat phase
  const viewSession = useCallback((projectId: string) => {
    setActiveProjectId(projectId)
    setSearchParams({ projectId })
  }, [setSearchParams])

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

  // Request notification permission and load sessions on mount
  useEffect(() => {
    requestNotificationPermission()
    loadSessions()
  }, [loadSessions])

  // Fetch GitHub status on mount (if in server mode)
  useEffect(() => {
    if (isServerMode()) {
      fetchGitHubStatus().then(() => {
        // If connected, pre-fetch repos for the picker
        if (useGitHubStore.getState().connected && useGitHubStore.getState().repos.length === 0) {
          fetchGitHubRepos()
        }
      })
    }
  }, [fetchGitHubStatus, fetchGitHubRepos])

  // Reset provider/model when machine changes and current provider isn't available
  useEffect(() => {
    if (selectedProvider && availableProviders.length > 0) {
      if (!isProviderAvailable(selectedProvider, availableProviders)) {
        setSelectedProvider("")
        setSelectedModel("")
      }
    }
  }, [selectedMachine?.machineId]) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only on machine change

  // Sync URL → state: if URL gains a projectId we don't have, adopt it.
  // But ignore when URL still has the stale param during back navigation.
  const backingRef = useRef(false)
  useEffect(() => {
    if (backingRef.current) {
      backingRef.current = false
      return
    }
    if (projectIdParam && !activeProjectId) {
      setActiveProjectId(projectIdParam)
    }
  }, [projectIdParam, activeProjectId])

  // When projectId param is removed from URL (e.g., sidebar Plan click), reset to input phase
  useEffect(() => {
    if (!projectIdParam && activeProjectId) {
      setActiveProjectId(null)
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

  // Pre-fill from existing project (re-generation flow: project exists with zero nodes)
  const existingPrefilled = useRef(false)
  useEffect(() => {
    if (!existingProject || !existingProjectHasNoNodes || existingPrefilled.current || fromPlaygroundId) return
    existingPrefilled.current = true

    // Pre-fill description from project name/description
    if (existingProject.description) {
      setDescription(existingProject.description)
    } else if (existingProject.name) {
      setDescription(existingProject.name)
    }

    // Pre-fill working directory
    if (existingProject.workingDirectory) {
      setWorkingDir(existingProject.workingDirectory)
    }

    // Pre-fill repository info
    if (existingProject.repository) {
      setRepoUrl(existingProject.repository)
      if (existingProject.githubOwner) setGithubOwner(existingProject.githubOwner)
      if (existingProject.githubRepo) setGithubRepo(existingProject.githubRepo)
    }

    // Pre-fill vision doc and auto-expand context section
    if (existingProject.visionDoc) {
      setVisionDoc(existingProject.visionDoc)
      setContextOpen(true)
    }
  }, [existingProject, existingProjectHasNoNodes, fromPlaygroundId])

  // Pre-fill machine for existing project (async — machines load after mount)
  const existingMachinePrefilled = useRef(false)
  useEffect(() => {
    if (!existingProject?.defaultMachineId || !existingProjectHasNoNodes || existingMachinePrefilled.current || allMachines.length === 0 || fromPlaygroundId) return
    const match = allMachines.find((m) => m.machineId === existingProject.defaultMachineId)
    if (match) {
      existingMachinePrefilled.current = true
      setSelectedMachine(match)
    }
  }, [existingProject?.defaultMachineId, existingProjectHasNoNodes, allMachines, fromPlaygroundId])

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

  // Handle repo URL text input changes with auto-parsing
  const handleRepoUrlChange = useCallback((value: string) => {
    setRepoUrl(value)
    const parsed = parseGitHubUrl(value.trim())
    if (parsed) {
      setGithubOwner(parsed.owner)
      setGithubRepo(parsed.repo)
    } else if (!value.trim()) {
      setGithubOwner("")
      setGithubRepo("")
    }
  }, [])

  // Handle repo selection from picker dialog
  const handleRepoSelect = useCallback((repo: GitHubRepo) => {
    setRepoUrl(repo.htmlUrl)
    setGithubOwner(repo.owner.login)
    setGithubRepo(repo.name)
    // If repo provides a default branch and no branch is currently selected, use it
    if (repo.defaultBranch && !selectedBranch) {
      setSelectedBranch(repo.defaultBranch)
    }
  }, [selectedBranch])

  // Attachment handlers
  const handleAddAttachment = useCallback((attachment: TaskAttachment) => {
    setAttachments((prev) => [...prev, attachment])
  }, [])

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
  }, [])

  // Handle paste in goal textarea (image paste support)
  const handleGoalPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files
    if (!files || files.length === 0) return

    // Check if any pasted items are files (images)
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return

    e.preventDefault() // Prevent pasting file name as text

    for (const file of imageFiles) {
      const url = URL.createObjectURL(file)
      const attachment: TaskAttachment = {
        id: crypto.randomUUID(),
        name: file.name || `pasted-image-${Date.now()}.png`,
        url,
        mimeType: file.type || 'image/png',
        size: file.size,
        uploadedAt: new Date(),
        thumbnailUrl: url,
      }
      setAttachments((prev) => [...prev, attachment])
    }

    // Auto-expand context section to show pasted images
    setContextOpen(true)
  }, [])

  const customModelMap = useSettingsStore((s) => s.customModelMap)

  // Whether we're re-generating for an existing project (pre-fill mode)
  const isRegeneration = !!(existingProject && existingProjectHasNoNodes && !fromPlaygroundId)

  async function handleSubmit() {
    if (!description.trim() || isSubmitting) return
    setIsSubmitting(true)

    try {
      const effectiveModel = selectedModel || resolveModel(modelTier, selectedProvider || undefined, customModelMap)
      // Use first line of description as project name (truncated)
      const firstLine = description.trim().split('\n')[0].slice(0, 80)

      // Combine user-provided vision doc with playground context
      const combinedVisionDoc = [playgroundVisionDoc, visionDoc.trim()]
        .filter(Boolean)
        .join('\n\n') || undefined

      let projectId: string

      if (isRegeneration && existingProject) {
        // Re-generation flow: use existing project, don't create a duplicate
        // Update project description/name before starting session
        updateProject(existingProject.id, {
          description: description.trim(),
          name: firstLine,
        })

        const result = await startPlanSessionForProject(
          existingProject.id,
          description.trim(),
          {
            targetMachineId: selectedMachine?.machineId,
            workingDirectory: workingDir || undefined,
            preferredProvider: selectedProvider || undefined,
            model: effectiveModel,
            visionDoc: combinedVisionDoc,
            baseBranch: effectiveBranch || undefined,
          }
        )
        projectId = result.projectId
      } else {
        // Normal flow: create a new project + plan session
        const result = await startPlanSession(
          description.trim(),
          firstLine,
          {
            targetMachineId: selectedMachine?.machineId,
            workingDirectory: workingDir || undefined,
            preferredProvider: selectedProvider || undefined,
            model: effectiveModel,
            visionDoc: combinedVisionDoc,
            baseBranch: effectiveBranch || undefined,
            repository: repoUrl || undefined,
          }
        )
        projectId = result.projectId
      }

      // Update project with GitHub owner/repo and attachments if set
      const projectUpdates: Record<string, unknown> = {}
      if (githubOwner && githubRepo) {
        projectUpdates.githubOwner = githubOwner
        projectUpdates.githubRepo = githubRepo
        projectUpdates.repository = repoUrl || undefined
      }
      if (attachments.length > 0) {
        projectUpdates.attachments = attachments
      }
      if (Object.keys(projectUpdates).length > 0) {
        updateProject(projectId, projectUpdates)
      }

      setActiveProjectId(projectId)
      setSearchParams({ projectId })
    } catch (error) {
      console.error("[plan-session] Failed to start:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Chat Phase ─────────────────────────────────────────────────
  // Skip chat phase for existing projects with no plan nodes and no execution (re-generation pre-fill).
  // Once the user submits, execution becomes truthy and we enter chat phase normally.
  const showInputForRegeneration = existingProjectHasNoNodes && !execution && !fromPlaygroundId
  if (activeProjectId && (execution || project) && !showInputForRegeneration) {
    return (
      <div className="h-full">
        <PlanChatPhase
          projectId={activeProjectId}
          projectName={project?.name || "New Project"}
          machineName={machineName}
          workingDirectory={project?.workingDirectory || workingDir || undefined}
          onBack={() => {
            backingRef.current = true
            setActiveProjectId(null)
            setSearchParams({})
          }}
          onNewPlan={() => {
            backingRef.current = true
            setActiveProjectId(null)
            setSearchParams({})
          }}
        />
      </div>
    )
  }

  // ─── Input Phase ────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-start min-h-full p-4 md:p-6 overflow-auto">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8 mt-4 md:mt-8">
          <h1 className="text-xl md:text-2xl font-bold font-sans mb-2">
            {isRegeneration ? "Regenerate Plan" : "Plan"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isRegeneration
              ? "Review and update your goal, then generate a fresh plan."
              : "Describe your goal in detail. Agent will build a plan with you collaboratively."}
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

          {/* Goal textarea + session resume */}
          <div className="flex flex-col rounded-lg border border-border bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              onPaste={handleGoalPaste}
              placeholder="What do you want to build or accomplish?"
              rows={5}
              autoFocus
              className="w-full px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none resize-none bg-transparent"
            />

            {/* OR divider + resume button */}
            <div className="px-4 pb-3">
              <div className="flex items-center gap-3 mb-2.5">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <button
                type="button"
                onClick={() => setSessionPickerOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <Layers className="h-3.5 w-3.5" />
                Resume a previous session
              </button>
            </div>
          </div>

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
            <div className="animate-reveal flex flex-col gap-2">
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

          {/* Repository (GitHub URL) — shown when a machine is selected */}
          {selectedMachine && (
            <div className="animate-reveal flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">Repository (optional):</span>
              <div className="flex items-center gap-2">
                {githubConnected && (
                  <button
                    type="button"
                    onClick={() => {
                      // Ensure repos are loaded before opening picker
                      if (githubRepos.length === 0) fetchGitHubRepos()
                      setRepoPickerOpen(true)
                    }}
                    title="Browse GitHub repositories"
                    className="shrink-0 rounded-md border border-border p-1.5 hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    <Github className="h-4 w-4" />
                  </button>
                )}
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => handleRepoUrlChange(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {repoUrl && (
                  <button
                    type="button"
                    onClick={() => { setRepoUrl(""); setGithubOwner(""); setGithubRepo("") }}
                    className="shrink-0 rounded-md p-1.5 hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                    title="Clear repository"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Parsed owner/repo feedback */}
              {githubOwner && githubRepo && (
                <div className="flex items-center gap-2 text-xs text-info">
                  <Github className="h-3 w-3" />
                  {githubOwner}/{githubRepo}
                </div>
              )}
              {repoUrl && !githubOwner && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Info className="h-3 w-3" />
                  Enter a GitHub URL (e.g. https://github.com/owner/repo) or owner/repo
                </div>
              )}

              {/* Connection hint: Local path → GitHub repo */}
              {workingDir && githubOwner && githubRepo && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-2.5 py-1.5">
                  <Link className="h-3 w-3 shrink-0" />
                  <span className="truncate font-mono">{workingDir}</span>
                  <span className="shrink-0">&rarr;</span>
                  <span className="truncate font-mono">{githubOwner}/{githubRepo}</span>
                </div>
              )}
            </div>
          )}

          {/* Add Context — collapsible section */}
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setContextOpen(!contextOpen)}
              className="flex items-center gap-1.5 text-left py-1.5 rounded transition-colors cursor-pointer group hover:bg-muted/30 -mx-1 px-1"
            >
              {contextOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-xs text-muted-foreground font-medium">
                Add Context
              </span>
              {(visionDoc.trim() || attachments.length > 0) && (
                <span className="flex items-center gap-1 text-[10px] text-primary">
                  {visionDoc.trim() && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                      <FileText className="h-2.5 w-2.5 mr-0.5" />
                      Vision
                    </Badge>
                  )}
                  {attachments.length > 0 && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                      <Paperclip className="h-2.5 w-2.5 mr-0.5" />
                      {attachments.length}
                    </Badge>
                  )}
                </span>
              )}
            </button>

            {contextOpen && (
              <div className="flex flex-col gap-4 mt-2 animate-reveal">
                {/* Vision / Design Document */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-3 w-3" />
                    Vision / Design Document
                  </label>
                  <textarea
                    value={visionDoc}
                    onChange={(e) => setVisionDoc(e.target.value)}
                    placeholder="Define the product vision, research question, or project context here. This will be provided to all agents working on this project as persistent context (skill.md)..."
                    rows={6}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y min-h-[100px]"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Markdown supported. Injected into every agent session as context.
                  </p>
                </div>

                {/* Attachments */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Paperclip className="h-3 w-3" />
                    Attachments
                  </label>
                  <AttachmentList
                    attachments={attachments}
                    onAdd={handleAddAttachment}
                    onRemove={handleRemoveAttachment}
                  />
                </div>
              </div>
            )}
          </div>

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
              {isSubmitting ? "Starting..." : isRegeneration ? "Regenerate Plan" : "Start Planning"}
            </Button>
          </div>
        </div>

        {/* Recent Plan Sessions */}
        {planHistory.length > 0 && (
          <div id="plan-history" className="mt-10">
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
                  : exec?.status === 'cancelled' ? 'Stopped'
                  : 'Pending'
                const statusColor = exec?.status === 'running' ? 'bg-primary'
                  : exec?.status === 'success' ? 'bg-success'
                  : exec?.status === 'failure' ? 'bg-destructive'
                  : 'bg-muted-foreground'

                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => viewSession(p.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') viewSession(p.id) }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left group cursor-pointer"
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", statusColor)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">
                        {p.workingDirectory || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusLabel && (
                        <Badge variant="outline" className="text-[10px] hidden md:inline-flex">
                          {statusLabel}
                        </Badge>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (activeProjectId === p.id) {
                            setActiveProjectId(null)
                            setSearchParams({})
                          }
                          allExecutions.delete(`plan-${p.id}`)
                          deleteProject(p.id)
                        }}
                        className="p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 [@media(hover:none)]:opacity-60 hover:bg-destructive/10 transition-all text-destructive"
                        title="Delete session"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
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

        {/* GitHub repo picker dialog (onSelect mode) */}
        <GitHubRepoPickerDialog
          open={repoPickerOpen}
          onOpenChange={setRepoPickerOpen}
          onSelect={handleRepoSelect}
        />

        {/* Session picker dialog */}
        <SessionPickerDialog
          open={sessionPickerOpen}
          onOpenChange={setSessionPickerOpen}
          onSelectSession={(session) => {
            // Pre-fill form from Claude Code session
            const title = session.customTitle || session.summary || session.firstPrompt || ""
            if (title) setDescription(title)
            if (session.cwd) setWorkingDir(session.cwd)
            const machine = allMachines.find((m) => m.machineId === session.machineId)
            if (machine) setSelectedMachine(machine)
          }}
          playgroundSessions={playgroundHistory}
          onSelectPlaygroundSession={(projectId) => {
            // Navigate to plan with playground context
            const pg = allProjects.find((p) => p.id === projectId)
            if (pg) {
              if (pg.description) setDescription(pg.description)
              if (pg.workingDirectory) setWorkingDir(pg.workingDirectory)
              if (pg.defaultMachineId) {
                const machine = allMachines.find((m) => m.machineId === pg.defaultMachineId)
                if (machine) setSelectedMachine(machine)
              }
            }
          }}
          planSessions={planHistory}
          onSelectPlanSession={viewSession}
        />
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
