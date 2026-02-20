import { useState, useCallback, useEffect } from "react"
import { useNavigate } from "react-router"
import { Sparkles, Zap, Upload, Link as LinkIcon, Loader2, X, FolderOpen, Laptop, Globe, Server, Cloud, ChevronDown, CheckCircle2, AlertCircle, Github, Search, ListTodo, GitBranch, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useAgentStore } from "@/stores/agent-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"
import { useGitHubStore } from "@/stores/github-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"
import { useRepoSetup } from "@/hooks/use-repo-setup"
import { GitInitDialog } from "@/components/git-init-dialog"
import { getRandomColor, getRandomProjectIcon } from "@/lib/color-icon-utils"
import { cn } from "@/lib/utils"

const environmentConfig = {
  local: { icon: Laptop, label: "Local", description: "Run on this machine" },
  remote: { icon: Globe, label: "Remote", description: "Run on remote machine" },
  hpc: { icon: Server, label: "HPC", description: "Run on HPC cluster" },
  cloud: { icon: Cloud, label: "Cloud", description: "Run on cloud instance" },
}

type EnvironmentType = keyof typeof environmentConfig
type CreateMode = "choose" | "empty" | "repo"

export function ProjectNew() {
  const [mode, setMode] = useState<CreateMode>("choose")
  const [description, setDescription] = useState("")
  const [firstTask, setFirstTask] = useState("")
  const [repoUrl, setRepoUrl] = useState("")
  const [workingDir, setWorkingDir] = useState("")
  const [showRepoInput, setShowRepoInput] = useState(false)
  const [showGitHubRepos, setShowGitHubRepos] = useState(false)
  const [showDirInput, setShowDirInput] = useState(false)
  const [selectedEnvironment, setSelectedEnvironment] = useState<EnvironmentType>("local")
  const [selectedMachine, setSelectedMachine] = useState<MachineInfo | null>(null)
  const [repoSetupError, setRepoSetupError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const navigate = useNavigate()
  const addProject = useProjectStore((s) => s.addProject)
  const addNode = usePlanStore((s) => s.addNode)
  const startGeneration = useAgentStore((s) => s.startGeneration)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const connectionStatus = useSettingsStore((s) => s.connectionStatus)

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
  const getMachinesForEnvironment = useExecutionStore((s) => s.getMachinesForEnvironment)

  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  const availableMachines = getMachinesForEnvironment(selectedEnvironment)
  const isRemote = selectedEnvironment !== "local"

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

  async function handleGenerate() {
    if (!description.trim() || isSubmitting) return
    setIsSubmitting(true)
    setRepoSetupError(null)
    const id = crypto.randomUUID()  // Use proper UUID format for PostgreSQL
    const projectName = description.slice(0, 50).trim() || "New Project"

    addProject({
      id,
      name: projectName,
      description: description.trim(),
      visionDoc: "",
      status: "active",
      color: getRandomColor(),
      icon: getRandomProjectIcon(),
      workingDirectory: workingDir.trim() || undefined,
      repository: repoUrl.trim() || undefined,
      defaultEnvironment: isRemote ? selectedEnvironment : undefined,
      defaultMachineId: selectedMachine?.machineId || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    navigate(`/project/${id}/graph`)

    if (connectionStatus !== "connected") {
      setIsSubmitting(false)
      return
    }

    // Always use repo setup — handles creating dir, git init, clone, file tree
    setGenerationPhase(id, 'repo_setup')
    try {
      console.log('[project-new] Calling setupRepo with:', { projectId: id, workingDirectory: workingDir.trim() || undefined, repository: repoUrl.trim() || undefined, targetMachineId: selectedMachine?.machineId })

      const repoResult = await setupRepo({
        projectId: id,
        projectName,
        projectDescription: description.trim(),
        workingDirectory: workingDir.trim() || undefined,
        repository: repoUrl.trim() || undefined,
        targetMachineId: selectedMachine?.machineId || undefined,
      })

      console.log('[project-new] Repo setup result:', repoResult)

      if (repoResult?.workingDirectory) {
        console.log('[project-new] Starting generation with working directory:', repoResult.workingDirectory)
        startGeneration(id, projectName, description.trim(), undefined, {
          workingDirectory: repoResult.workingDirectory,
          fileTree: repoResult.fileTree,
          keyFiles: repoResult.keyFiles,
          targetMachineId: selectedMachine?.machineId,
        })
      } else {
        // Repo setup returned null (needsGitInit or error) — generate without context
        console.warn('[project-new] Repo setup returned null, generating without working directory')
        setRepoSetupError('Repository setup returned incomplete data')
        startGeneration(id, projectName, description.trim())
      }
    } catch (error) {
      // Repo setup failed — save error and proceed with plan generation without context
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error('[project-new] Repo setup failed:', errorMsg, error)
      setRepoSetupError(errorMsg)
      setGenerationPhase(id, 'idle')

      // If remote machine failed, suggest fallback to local setup
      if (isRemote && !repoUrl.trim()) {
        // No repository URL — can't proceed with remote execution without working directory
        setRepoSetupError(
          `Failed to set up repository on remote machine: ${errorMsg}. ` +
          'Please either: (1) provide a Git repository URL, or (2) manually configure the working directory in project settings after creation.'
        )
      }

      // Generate plan anyway, but user will need to configure working directory for execution
      startGeneration(id, projectName, description.trim())
    } finally {
      setIsSubmitting(false)
    }
  }

  // Create empty project without AI - just set up working directory and navigate to task list
  async function handleCreateEmpty() {
    if (!description.trim() || isSubmitting) return
    setIsSubmitting(true)
    setRepoSetupError(null)
    const id = crypto.randomUUID()
    const projectName = description.slice(0, 50).trim() || "New Project"

    try {
      // Call repo setup on the machine (creates working directory)
      const repoResult = await setupRepo({
        projectId: id,
        projectName,
        projectDescription: description.trim(),
        workingDirectory: workingDir.trim() || undefined,
        targetMachineId: selectedMachine?.machineId || undefined,
      })

      // Create project with resolved working directory from backend
      addProject({
        id,
        name: projectName,
        description: description.trim(),
        visionDoc: "",
        status: "active",
        color: getRandomColor(),
        icon: getRandomProjectIcon(),
        workingDirectory: repoResult?.workingDirectory || workingDir.trim() || undefined,
        defaultEnvironment: isRemote ? selectedEnvironment : undefined,
        defaultMachineId: selectedMachine?.machineId || undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      setIsSubmitting(false)
      navigate(`/project/${id}/list`)
    } catch (error) {
      console.error('[project-new] Repo setup failed:', error)
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      setRepoSetupError(errorMsg)
      setIsSubmitting(false)
    }
  }

  // Create project with repo and add first task manually (skip AI)
  async function handleCreateWithFirstTask() {
    if (!description.trim() || !firstTask.trim() || isSubmitting) return
    setIsSubmitting(true)
    setRepoSetupError(null)
    const id = crypto.randomUUID()
    const projectName = repoUrl.trim()
      ? repoUrl.split("/").pop()?.replace(".git", "") || "New Project"
      : description.slice(0, 50).trim() || "New Project"

    try {
      // Call repo setup to clone on the machine
      const repoResult = await setupRepo({
        projectId: id,
        projectName,
        projectDescription: description.trim(),
        workingDirectory: workingDir.trim() || undefined,
        repository: repoUrl.trim() || undefined,
        targetMachineId: selectedMachine?.machineId || undefined,
      })

      // Create project with resolved working directory from backend
      addProject({
        id,
        name: projectName,
        description: description.trim(),
        visionDoc: "",
        status: "active",
        color: getRandomColor(),
        icon: getRandomProjectIcon(),
        workingDirectory: repoResult?.workingDirectory || workingDir.trim() || undefined,
        repository: repoUrl.trim() || undefined,
        defaultEnvironment: isRemote ? selectedEnvironment : undefined,
        defaultMachineId: selectedMachine?.machineId || undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Add first task node with due date set to today
      const taskId = crypto.randomUUID()
      const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD format
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

      setIsSubmitting(false)
      navigate(`/project/${id}/list`)
    } catch (error) {
      console.error('[project-new] Repo setup failed:', error)
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      setRepoSetupError(errorMsg)
      setIsSubmitting(false)
    }
  }

  // Reset mode and clear form
  function handleBack() {
    setMode("choose")
    setRepoUrl("")
    setWorkingDir("")
    setFirstTask("")
    setShowRepoInput(false)
    setShowGitHubRepos(false)
    setShowDirInput(false)
    setSearchQuery("")
    setRepoSetupError(null)
  }

  const EnvironmentIcon = environmentConfig[selectedEnvironment].icon

  // Shared environment selector component
  const EnvironmentSelector = () => (
    <div className="flex flex-col gap-3">
      <span className="text-[13px] font-medium text-muted-foreground">Environment</span>
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer">
              <EnvironmentIcon className="h-4 w-4" />
              {environmentConfig[selectedEnvironment].label}
              <ChevronDown className="h-3 w-3 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Select Environment</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(environmentConfig) as EnvironmentType[]).map((env) => {
              const config = environmentConfig[env]
              const Icon = config.icon
              const machineCount = getMachinesForEnvironment(env).length
              return (
                <DropdownMenuItem
                  key={env}
                  onClick={() => {
                    setSelectedEnvironment(env)
                    setSelectedMachine(null)
                  }}
                  className="gap-2"
                >
                  <Icon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{config.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {env === "local" ? config.description : `${machineCount} available`}
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

        {/* Machine selector for non-local environments */}
        {isRemote && availableMachines.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                <Server className="h-4 w-4" />
                <span className="max-w-[140px] truncate">
                  {selectedMachine?.name || "Select machine"}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Select Machine</DropdownMenuLabel>
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
                    </span>
                  </div>
                  {selectedMachine?.machineId === machine.machineId && (
                    <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {isRemote && availableMachines.length === 0 && machinesLoaded && (
          <span className="text-xs text-muted-foreground">
            No {environmentConfig[selectedEnvironment].label.toLowerCase()} machines connected
          </span>
        )}
      </div>
    </div>
  )

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

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex w-[640px] flex-col items-center gap-8">
        {/* Icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
          {mode === "choose" ? (
            <Sparkles className="h-7 w-7 text-primary-foreground" />
          ) : mode === "empty" ? (
            <ListTodo className="h-7 w-7 text-primary-foreground" />
          ) : (
            <GitBranch className="h-7 w-7 text-primary-foreground" />
          )}
        </div>

        {/* Mode: Choose */}
        {mode === "choose" && (
          <>
            <div className="flex flex-col items-center gap-3">
              <h1 className="text-3xl font-bold">Create a new project</h1>
              <p className="max-w-[480px] text-center text-[15px] leading-relaxed text-muted-foreground">
                Choose how you want to start your project.
              </p>
            </div>

            {/* Option cards */}
            <div className="flex w-full flex-col gap-4">
              <button
                onClick={() => setMode("empty")}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border p-6 text-left transition-all cursor-pointer",
                  "border-primary bg-primary/[0.03] hover:bg-primary/[0.05] shadow-[0_2px_8px_rgba(87,73,244,0.12)]"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <ListTodo className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-base font-semibold text-foreground">Start with empty project</span>
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Set up a new working directory and start adding tasks manually. Best for when you want full control.
                </p>
              </button>

              <button
                onClick={() => setMode("repo")}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border p-6 text-left transition-all cursor-pointer",
                  "border-border bg-card hover:border-foreground/20"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                    <GitBranch className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <span className="text-base font-semibold text-foreground">Start with a repo</span>
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Link an existing repository. Add tasks manually or use AI to generate a plan based on the codebase.
                </p>
              </button>
            </div>
          </>
        )}

        {/* Mode: Empty project */}
        {mode === "empty" && (
          <>
            <div className="flex flex-col items-center gap-3">
              <h1 className="text-3xl font-bold">Create empty project</h1>
              <p className="max-w-[480px] text-center text-[15px] leading-relaxed text-muted-foreground">
                Describe your project and start adding tasks manually.
              </p>
            </div>

            <div className="flex w-full flex-col gap-4">
              {/* Project description */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-foreground">Project description</label>
                <div className="relative">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What are you building? e.g., A personal finance app with budgeting and transaction tracking..."
                    className="h-[120px] w-full resize-none rounded-xl border border-border bg-card p-4 pr-12 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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

              {/* Optional working directory */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-foreground">
                  Working directory <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder={isRemote ? "/remote/path/to/project" : "/path/to/project (leave empty for default)"}
                  className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave empty to create a new project directory automatically
                </p>
              </div>

              <ErrorAlert />
              <EnvironmentSelector />
            </div>

            {/* Actions */}
            <div className="flex w-full flex-col gap-3">
              <Button
                onClick={handleCreateEmpty}
                disabled={!description.trim() || isSubmitting}
                className="h-12 w-full rounded-xl text-base font-semibold"
              >
                {isSubmitting ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" />
                ) : (
                  <ListTodo className="h-[18px] w-[18px]" />
                )}
                {isSubmitting ? "Creating..." : "Create Project"}
              </Button>
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={isSubmitting}
                className="h-10 w-full rounded-xl"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </div>
          </>
        )}

        {/* Mode: Repo project */}
        {mode === "repo" && (
          <>
            <div className="flex flex-col items-center gap-3">
              <h1 className="text-3xl font-bold">Start with a repo</h1>
              <p className="max-w-[480px] text-center text-[15px] leading-relaxed text-muted-foreground">
                Link a repository and choose how to create your project.
              </p>
            </div>

            <div className="flex w-full flex-col gap-4">
              {/* Project description */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-foreground">Project description</label>
                <div className="relative">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What are you building? e.g., A personal finance app with budgeting and transaction tracking..."
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

              {/* Repository URL */}
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
                              setRepoUrl(repo.htmlUrl)
                              setShowGitHubRepos(false)
                              setSearchQuery("")
                              setShowRepoInput(true)
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
                ) : showRepoInput ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/user/repo"
                      className="flex-1 h-10 rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      onClick={() => { setRepoUrl(""); setShowRepoInput(false) }}
                      className="p-2 rounded-md hover:bg-muted transition-colors cursor-pointer"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {connected && (
                      <button
                        onClick={() => setShowGitHubRepos(true)}
                        className="flex-1 h-10 flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer"
                      >
                        <Github className="h-4 w-4" />
                        Browse GitHub repos
                      </button>
                    )}
                    <button
                      onClick={() => setShowRepoInput(true)}
                      className="flex-1 h-10 flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:border-foreground/20 transition-colors cursor-pointer"
                    >
                      <GitBranch className="h-4 w-4" />
                      {connected ? "Manual URL" : "Enter URL"}
                    </button>
                  </div>
                )}
              </div>

              {/* First Task */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-foreground">
                  First task <span className="text-muted-foreground font-normal">(optional for AI)</span>
                </label>
                <input
                  type="text"
                  value={firstTask}
                  onChange={(e) => setFirstTask(e.target.value)}
                  placeholder="e.g., Add user authentication, refactor API endpoints, set up CI/CD..."
                  className="h-10 rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Required if you want to skip AI and add the first task manually
                </p>
              </div>

              <ErrorAlert />
              <EnvironmentSelector />
            </div>

            {/* Actions */}
            <div className="flex w-full flex-col gap-3">
              <Button
                onClick={handleCreateWithFirstTask}
                disabled={!description.trim() || !firstTask.trim() || isSubmitting}
                className="h-12 w-full rounded-xl text-base font-semibold"
              >
                {isSubmitting ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" />
                ) : (
                  <ListTodo className="h-[18px] w-[18px]" />
                )}
                {isSubmitting ? "Creating..." : "Create Project & Add First Task"}
              </Button>
              <Button
                variant="outline"
                onClick={handleGenerate}
                disabled={!description.trim() || isSubmitting}
                className="h-12 w-full rounded-xl text-base font-semibold"
              >
                <Sparkles className="h-[18px] w-[18px]" />
                Or Use AI to Generate Plan
              </Button>
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={isSubmitting}
                className="h-10 w-full rounded-xl"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </div>
          </>
        )}

        {/* Git init confirmation dialog */}
        <GitInitDialog
          prompt={gitInitPrompt}
          onConfirm={confirmGitInit}
          onDismiss={dismissGitInit}
        />
      </div>
    </div>
  )
}
