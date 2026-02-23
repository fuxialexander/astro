import { useState, useCallback, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { Sparkles, Loader2, X, Laptop, CheckCircle2, AlertCircle, Info, HelpCircle, Github, Search, GitBranch, Plus, Users, GitPullRequest, FolderEdit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useAgentStore } from "@/stores/agent-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useMachinesStore } from "@/stores/machines-store"
import { useGitHubStore } from "@/stores/github-store"
import { useTeamStore } from "@/stores/team-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"
import { useRepoSetup } from "@/hooks/use-repo-setup"
import { useDirectoryDetection } from "@/hooks/use-directory-detection"
import { GitInitDialog } from "@/components/git-init-dialog"
import { AddEnvironmentDialog } from "@/components/environments/add-environment-dialog"
import { isServerMode } from "@/lib/app-mode"
import { getRandomColor, getRandomProjectIcon } from "@/lib/color-icon-utils"
import { cn } from "@/lib/utils"
import { remoteTypeLabel, deliveryModeLabel } from "@/lib/project-source"

export function ProjectNew() {
  const [searchParams] = useSearchParams()
  const teamIdParam = searchParams.get('teamId')

  const [description, setDescription] = useState("")
  const [firstTask, setFirstTask] = useState("")
  const [repoUrl, setRepoUrl] = useState("")
  const [workingDir, setWorkingDir] = useState("")
  const [showRepoUrl, setShowRepoUrl] = useState(false)
  const [showGitHubRepos, setShowGitHubRepos] = useState(false)
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [repoSetupError, setRepoSetupError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const navigate = useNavigate()
  const addProject = useProjectStore((s) => s.addProject)
  const teams = useTeamStore((s) => s.teams)
  const addNode = usePlanStore((s) => s.addNode)
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)

  // Directory detection — inline feedback as user types
  const { detection, isDetecting } = useDirectoryDetection(workingDir)

  // GitHub integration
  const { connected, repos, selectedRepoIds, fetchRepos } = useGitHubStore()

  // Fetch repos when GitHub selector is opened
  useEffect(() => {
    if (connected && showGitHubRepos && repos.length === 0) {
      fetchRepos()
    }
  }, [connected, showGitHubRepos, repos.length, fetchRepos])

  // Filter repos by search query
  const filteredRepos = repos.filter((repo) => {
    if (!searchQuery) return selectedRepoIds.length === 0 || selectedRepoIds.includes(repo.id)
    const query = searchQuery.toLowerCase()
    return (
      repo.name.toLowerCase().includes(query) ||
      repo.fullName.toLowerCase().includes(query) ||
      repo.description?.toLowerCase().includes(query)
    )
  })

  // Shared repo setup hook
  const { setupRepo, gitInitPrompt, dismissGitInit, confirmGitInit } = useRepoSetup()

  // Machine state from execution store
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const machines = useExecutionStore((s) => s.machines)

  // Server mode: registered machines
  const isMultiTenant = isServerMode()
  const registeredMachines = useMachinesStore((s) => s.machines)
  const fetchRegisteredMachines = useMachinesStore((s) => s.fetchMachines)
  const [showAddEnvironment, setShowAddEnvironment] = useState(false)

  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  useEffect(() => {
    if (isMultiTenant) fetchRegisteredMachines()
  }, [isMultiTenant, fetchRegisteredMachines])

  // Auto-select first registered machine in server mode
  useEffect(() => {
    if (isMultiTenant && !selectedMachine && registeredMachines.length > 0) {
      const first = registeredMachines.find((m) => !m.isRevoked && m.isConnected) || registeredMachines.find((m) => !m.isRevoked)
      if (first) {
        setSelectedMachine({ machineId: first.id, name: first.name, hostname: first.hostname } as MachineInfo)
      }
    }
  }, [isMultiTenant, selectedMachine, registeredMachines])

  const availableMachines = machines.filter((m) => m.status !== 'offline')

  // Auto-select first available machine in local mode
  useEffect(() => {
    if (!isMultiTenant && !selectedMachine && availableMachines.length > 0) {
      setSelectedMachine(availableMachines[0])
    }
  }, [isMultiTenant, selectedMachine, availableMachines])
  const isRemote = isMultiTenant ? true : !!selectedMachine

  // Voice transcription for project description
  const handleTranscript = useCallback((text: string) => {
    setDescription((prev) => {
      if (prev.trim()) {
        return prev.trim() + " " + text
      }
      return text
    })
  }, [])

  const {
    isRecording,
    isTranscribing,
    isAvailable,
    duration,
    toggleRecording,
  } = useVoiceTranscription({
    onTranscript: handleTranscript,
  })

  const setGenerationPhase = useAgentStore((s) => s.setGenerationPhase)

  // Pending AI generation context — set when git init dialog is shown, consumed after user chooses
  const [pendingGeneration, setPendingGeneration] = useState<{
    id: string
    projectName: string
    description: string
    workingDir: string
    machineId?: string
  } | null>(null)

  // Navigate to graph view and start AI plan generation
  function navigateAndGenerate(
    projectId: string,
    name: string,
    desc: string,
    repoContext?: { workingDirectory: string; fileTree?: string[]; keyFiles?: { claudeMd?: string; readmeMd?: string; packageInfo?: string }; targetMachineId?: string },
  ) {
    navigate(`/project/${projectId}/graph`)
    startGeneration(projectId, name, desc, undefined, repoContext)
  }

  // Called when user confirms git init from the dialog
  const handleGitInitConfirm = async () => {
    await confirmGitInit()
    if (pendingGeneration) {
      const pg = pendingGeneration
      setPendingGeneration(null)
      navigateAndGenerate(pg.id, pg.projectName, pg.description, {
        workingDirectory: pg.workingDir,
        targetMachineId: pg.machineId,
      })
    }
  }

  // Called when user skips git init from the dialog
  const handleGitInitDismiss = () => {
    dismissGitInit()
    if (pendingGeneration) {
      const pg = pendingGeneration
      setPendingGeneration(null)
      navigateAndGenerate(pg.id, pg.projectName, pg.description, {
        workingDirectory: pg.workingDir,
        targetMachineId: pg.machineId,
      })
    }
  }

  // Unified create handler
  async function handleCreate(useAI: boolean) {
    if (!description.trim() || isSubmitting) return
    // Skip AI requires either a first task or just creates empty project
    setIsSubmitting(true)
    setRepoSetupError(null)
    const id = crypto.randomUUID()
    const projectName = description.slice(0, 50).trim() || "New Project"

    if (useAI) {
      // --- AI path: create project, setup repo, then navigate + generate ---
      addProject({
        id,
        name: projectName,
        description: description.trim(),
        visionDoc: "",
        status: "active",
        teamId: teamIdParam || undefined,
        color: getRandomColor(),
        icon: getRandomProjectIcon(),
        sourceDirectory: workingDir.trim() || undefined,
        workingDirectory: workingDir.trim() || undefined,
        repository: repoUrl.trim() || undefined,
        defaultMachineId: selectedMachine?.machineId || undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      if (connectionStatus !== "connected") {
        navigate(`/project/${id}/graph`)
        setIsSubmitting(false)
        return
      }

      setGenerationPhase(id, 'repo_setup')
      try {
        const repoResult = await setupRepo({
          projectId: id,
          projectName,
          projectDescription: description.trim(),
          workingDirectory: workingDir.trim() || undefined,
          repository: repoUrl.trim() || undefined,
          targetMachineId: selectedMachine?.machineId || undefined,
        })

        if (!repoResult) {
          // needsGitInit — stay on page, let user choose via dialog
          setPendingGeneration({
            id,
            projectName,
            description: description.trim(),
            workingDir: workingDir.trim(),
            machineId: selectedMachine?.machineId,
          })
          setIsSubmitting(false)
          return
        }

        // Navigate and generate
        const resolvedWorkDir = repoResult?.workingDirectory || workingDir.trim()
        if (repoResult?.workingDirectory) {
          navigateAndGenerate(id, projectName, description.trim(), {
            workingDirectory: repoResult.workingDirectory,
            fileTree: repoResult.fileTree,
            keyFiles: repoResult.keyFiles,
            targetMachineId: selectedMachine?.machineId,
          })
        } else if (resolvedWorkDir) {
          navigateAndGenerate(id, projectName, description.trim(), {
            workingDirectory: resolvedWorkDir,
            targetMachineId: selectedMachine?.machineId,
          })
        } else {
          navigate(`/project/${id}/graph`)
          startGeneration(id, projectName, description.trim())
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error('[project-new] Repo setup failed:', errorMsg, error)
        setRepoSetupError(errorMsg)
        setGenerationPhase(id, 'idle')

        if (isRemote && !repoUrl.trim()) {
          setRepoSetupError(
            `Failed to set up repository on remote machine: ${errorMsg}. ` +
            'Please either: (1) provide a Git repository URL, or (2) manually configure the working directory in project settings after creation.'
          )
        }

        const fallbackDir = workingDir.trim()
        navigate(`/project/${id}/graph`)
        startGeneration(id, projectName, description.trim(), undefined, fallbackDir ? {
          workingDirectory: fallbackDir,
          targetMachineId: selectedMachine?.machineId,
        } : undefined)
      } finally {
        setIsSubmitting(false)
      }
    } else {
      // --- Non-AI path: setup repo, create project, optionally add first task ---
      try {
        const repoResult = await setupRepo({
          projectId: id,
          projectName,
          projectDescription: description.trim(),
          workingDirectory: workingDir.trim() || undefined,
          repository: repoUrl.trim() || undefined,
          targetMachineId: selectedMachine?.machineId || undefined,
        })

        const resolvedDir = repoResult?.workingDirectory || workingDir.trim() || undefined
        addProject({
          id,
          name: projectName,
          description: description.trim(),
          visionDoc: "",
          status: "active",
          teamId: teamIdParam || undefined,
          color: getRandomColor(),
          icon: getRandomProjectIcon(),
          sourceDirectory: resolvedDir,
          workingDirectory: resolvedDir,
          repository: repoUrl.trim() || undefined,
          defaultMachineId: selectedMachine?.machineId || undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Add first task node if provided
        if (firstTask.trim()) {
          const taskId = crypto.randomUUID()
          const today = new Date().toISOString().split('T')[0]
          addNode({
            id: taskId,
            projectId: id,
            type: "task",
            title: firstTask.trim(),
            description: "",
            status: "planned",
            parentId: null,
            dependencies: [],
            verification: "auto",
            position: { x: 0, y: 0 },
            priority: "medium",
            dueDate: today,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        }

        setIsSubmitting(false)
        navigate(`/project/${id}/list`)
      } catch (error) {
        console.error('[project-new] Repo setup failed:', error)
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        setRepoSetupError(errorMsg)
        setIsSubmitting(false)
      }
    }
  }

  // Shared machine selector component
  const MachineSelector = () => {
    // Server mode: show registered machines as selectable cards
    if (isMultiTenant) {
      const connectedMachines = registeredMachines.filter((m) => !m.isRevoked)
      return (
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-medium text-muted-foreground">Target Machine</span>
          {connectedMachines.length > 0 ? (
            <div className="flex flex-col gap-2">
              {connectedMachines.map((machine) => {
                const isSelected = selectedMachine?.machineId === machine.id
                return (
                  <button
                    key={machine.id}
                    type="button"
                    onClick={() => setSelectedMachine({ machineId: machine.id, name: machine.name, hostname: machine.hostname } as MachineInfo)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all cursor-pointer",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/50"
                    )}
                  >
                    <Laptop className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{machine.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{machine.hostname}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {machine.providers.length > 0 && (
                        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{machine.providers[0]}</span>
                      )}
                      <div className={cn(
                        "flex items-center gap-1 text-xs",
                        machine.isConnected ? "text-green-600" : "text-muted-foreground"
                      )}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", machine.isConnected ? "bg-green-600" : "bg-muted-foreground")} />
                        <span>{machine.isConnected ? "Online" : "Offline"}</span>
                      </div>
                      {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/20 px-4 py-4">
              <Laptop className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-sm font-medium">No machines registered</div>
                <div className="text-xs text-muted-foreground">Register a machine to run tasks</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddEnvironment(true)}
                className="gap-1.5 shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Register
              </Button>
            </div>
          )}
        </div>
      )
    }

    // Local mode: show connected machines as selectable cards
    if (availableMachines.length > 0) {
      return (
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-medium text-muted-foreground">Target Machine</span>
          <div className="flex flex-col gap-2">
            {availableMachines.map((machine) => {
              const isSelected = selectedMachine?.machineId === machine.machineId
              return (
                <button
                  key={machine.machineId}
                  type="button"
                  onClick={() => setSelectedMachine(machine)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all cursor-pointer",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/50"
                  )}
                >
                  <Laptop className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{machine.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{machine.hostname || machine.machineId}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1 text-xs text-green-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                      <span>Online</span>
                    </div>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )
    }

    return null
  }

  // Error alert component
  const ErrorAlert = () => repoSetupError ? (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
      <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1 flex-1">
        <p className="text-sm font-medium text-destructive">Repository Setup Failed</p>
        <p className="text-sm text-destructive/90">{repoSetupError}</p>
      </div>
      <button
        onClick={() => setRepoSetupError(null)}
        className="p-1 rounded-md hover:bg-destructive/20 transition-colors"
      >
        <X className="h-4 w-4 text-destructive" />
      </button>
    </div>
  ) : null

  // Detection feedback component — shown inline below the directory input
  const DetectionFeedback = () => {
    const trimmedDir = workingDir.trim()
    if (!trimmedDir) return null

    // Detecting state
    if (isDetecting) {
      return (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Checking directory...</p>
        </div>
      )
    }

    if (!detection) return null

    let Icon = Info
    let message = ''
    let borderColor = 'border-border'
    let bgColor = 'bg-muted/30'
    let textColor = 'text-muted-foreground'
    let iconColor = 'text-muted-foreground'

    if (!detection.exists) {
      Icon = Info
      message = 'Directory will be created with git initialized.'
      borderColor = 'border-border'
      bgColor = 'bg-muted/30'
      textColor = 'text-muted-foreground'
      iconColor = 'text-muted-foreground'
    } else if (detection.isGit && detection.remoteType !== 'none') {
      Icon = GitPullRequest
      const label = remoteTypeLabel(detection.remoteType)
      const modeLabel = deliveryModeLabel(detection.suggestedDeliveryMode)
      message = detection.suggestedDeliveryMode === 'pr'
        ? `Git repo detected (${label}). PRs will be created for review.`
        : `Git repo detected (${label}). ${modeLabel}.`
      borderColor = 'border-blue-200 dark:border-blue-900'
      bgColor = 'bg-blue-50/50 dark:bg-blue-950/20'
      textColor = 'text-blue-700 dark:text-blue-300'
      iconColor = 'text-blue-600 dark:text-blue-400'
    } else if (detection.isGit) {
      Icon = GitBranch
      message = 'Local git repo (no remote). Changes saved as local branches.'
      borderColor = 'border-amber-200 dark:border-amber-900'
      bgColor = 'bg-amber-50/50 dark:bg-amber-950/20'
      textColor = 'text-amber-700 dark:text-amber-300'
      iconColor = 'text-amber-600 dark:text-amber-400'
    } else {
      Icon = AlertCircle
      message = 'No git history. Initialize Git recommended for safe parallel execution.'
      borderColor = 'border-amber-200 dark:border-amber-900'
      bgColor = 'bg-amber-50/50 dark:bg-amber-950/20'
      textColor = 'text-amber-700 dark:text-amber-300'
      iconColor = 'text-amber-600 dark:text-amber-400'
    }

    return (
      <div className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5", borderColor, bgColor)}>
        <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconColor)} />
        <p className={cn("text-xs leading-relaxed", textColor)}>{message}</p>
      </div>
    )
  }

  // Help tooltip state
  const [showDirHelp, setShowDirHelp] = useState(false)

  const WorkingDirectoryHelp = () => (
    <>
      <button
        type="button"
        onClick={() => setShowDirHelp(!showDirHelp)}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        title="How Astro uses your working directory"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {showDirHelp && (
        <div className="rounded-lg border border-border bg-card p-4 text-xs leading-relaxed space-y-3">
          <p className="font-medium text-sm text-foreground">How Astro uses your working directory</p>
          <div className="space-y-2.5">
            <div>
              <p className="font-medium text-foreground">Scenario A: Data-only directory</p>
              <p className="text-muted-foreground">Your folder has datasets, documents, or supporting materials but no code. Agents can read these files using absolute paths. The directory itself is not modified.</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Scenario B: Data directory + Git repo URL</p>
              <p className="text-muted-foreground">The repository is cloned into a subfolder inside your directory (e.g., <code className="font-mono bg-muted px-1 rounded">your-folder/repo-name/</code>). Agents work on isolated git branches in <code className="font-mono bg-muted px-1 rounded">repo-name.astro-worktrees/</code>. Your data files stay untouched and accessible.</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Scenario C: Existing Git project</p>
              <p className="text-muted-foreground">Agents work on isolated branches in a sibling directory (<code className="font-mono bg-muted px-1 rounded">your-project.astro-worktrees/</code>). Your project directory is never modified directly. All changes happen on the worktree branch and are submitted as pull requests.</p>
            </div>
          </div>
          <div className="border-t border-border pt-2.5 space-y-1.5">
            <p className="font-medium text-foreground">Safety</p>
            <ul className="text-muted-foreground space-y-1 list-disc pl-4">
              <li>Back up data that isn't under version control before running tasks</li>
              <li>Agents write code using absolute paths to reference data files</li>
              <li>Git worktrees are automatically cleaned up after tasks complete</li>
            </ul>
          </div>
        </div>
      )}
    </>
  )

  // Get team name if creating team project
  const selectedTeam = teamIdParam ? teams.find(t => t.id === teamIdParam) : null

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex w-[640px] flex-col items-center gap-8">
        {/* Team indicator */}
        {selectedTeam && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Team: {selectedTeam.name}</span>
          </div>
        )}

        {/* Icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
          <Sparkles className="h-7 w-7 text-primary-foreground" />
        </div>

        {/* Title */}
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-3xl font-bold">Create a new project</h1>
          <p className="max-w-[480px] text-center text-[15px] leading-relaxed text-muted-foreground">
            Describe what you're building. Point to a directory or repo and we'll detect the rest.
          </p>
        </div>

        {/* Unified Form */}
        <div className="flex w-full flex-col gap-4">
          {/* Project description */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">
              What are you building? <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A personal finance app with budgeting and transaction tracking..."
                className="h-[100px] w-full resize-none rounded-xl border border-border bg-card p-4 pr-12 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <div className="absolute right-3 top-3">
                <VoiceInputButton
                  isRecording={isRecording}
                  isTranscribing={isTranscribing}
                  isAvailable={isAvailable}
                  duration={duration}
                  onClick={toggleRecording}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>

          {/* Project directory */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              Project directory
              <WorkingDirectoryHelp />
            </label>
            <input
              type="text"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              placeholder={isRemote ? "/remote/path/to/project" : "/path/to/project"}
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <DetectionFeedback />
          </div>

          {/* Repository URL — collapsed by default */}
          {showRepoUrl ? (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-foreground">Repository URL</label>
              {showGitHubRepos ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search repositories..."
                        className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <button
                      onClick={() => { setShowGitHubRepos(false); setSearchQuery("") }}
                      className="p-2 rounded-md hover:bg-muted transition-colors cursor-pointer"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background">
                    {filteredRepos.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        {searchQuery ? "No repositories found" : "No repositories available"}
                      </div>
                    ) : (
                      filteredRepos.map((repo) => (
                        <button
                          key={repo.id}
                          onClick={() => {
                            setRepoUrl(repo.sshUrl)
                            setShowGitHubRepos(false)
                            setSearchQuery("")
                          }}
                          className="w-full p-3 text-left hover:bg-muted/50 border-b last:border-b-0 transition-colors"
                        >
                          <div className="flex items-start gap-2">
                            <Github className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{repo.fullName}</div>
                              {repo.description && (
                                <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                  {repo.description}
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="git@github.com:user/repo.git"
                    className="flex-1 h-10 rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  {connected && (
                    <button
                      onClick={() => setShowGitHubRepos(true)}
                      className="p-2 rounded-md hover:bg-muted transition-colors cursor-pointer"
                      title="Browse GitHub repos"
                    >
                      <Github className="h-4 w-4 text-muted-foreground" />
                    </button>
                  )}
                  <button
                    onClick={() => { setShowRepoUrl(false); setRepoUrl(""); setShowGitHubRepos(false); setSearchQuery("") }}
                    className="p-2 rounded-md hover:bg-muted transition-colors cursor-pointer"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowRepoUrl(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
            >
              <Plus className="h-3.5 w-3.5" />
              Add repository URL
            </button>
          )}

          {/* First task */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">
              First task <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={firstTask}
              onChange={(e) => setFirstTask(e.target.value)}
              placeholder="e.g., Add user authentication, refactor API endpoints..."
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <ErrorAlert />
          <MachineSelector />
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-3">
          <Button
            onClick={() => handleCreate(true)}
            disabled={!description.trim() || isSubmitting || connectionStatus !== "connected"}
            className="h-12 w-full rounded-xl text-base font-semibold"
          >
            {isSubmitting ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" />
            ) : (
              <Sparkles className="h-[18px] w-[18px]" />
            )}
            {isSubmitting ? "Creating..." : "Create & Generate Plan"}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleCreate(false)}
            disabled={!description.trim() || isSubmitting}
            className="h-10 w-full rounded-xl"
          >
            <FolderEdit className="h-4 w-4" />
            Create Project
          </Button>
        </div>

        {/* Git init confirmation dialog */}
        <GitInitDialog
          prompt={gitInitPrompt}
          onConfirm={handleGitInitConfirm}
          onDismiss={handleGitInitDismiss}
        />

        {/* Add environment dialog (server mode) */}
        <AddEnvironmentDialog
          open={showAddEnvironment}
          onOpenChange={setShowAddEnvironment}
        />
      </div>
    </div>
  )
}
