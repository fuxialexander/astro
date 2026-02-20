import { useState, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router"
import {
  Compass,
  GitBranch,
  Loader2,
  ListTodo,
  Github,
  Search,
  X,
  Laptop,
  Globe,
  Server,
  Cloud,
  Plus,
  CheckCircle2,
  FolderGit2,
  Sun,
  Moon,
  Sparkles,
  RefreshCw,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useGitHubStore } from "@/stores/github-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useMachinesStore } from "@/stores/machines-store"
import { AddEnvironmentDialog } from "@/components/environments/add-environment-dialog"
import { useTheme } from "@/components/theme-provider"
import { isServerMode } from "@/lib/app-mode"
import { validateAbsolutePath } from "@/lib/path-utils"
import { useRepoSetup } from "@/hooks/use-repo-setup"
import { cn } from "@/lib/utils"

const environmentConfig = {
  local: { icon: Laptop, label: "Local", description: "Run on this machine" },
  remote: { icon: Globe, label: "Remote", description: "Run on remote machine" },
  hpc: { icon: Server, label: "HPC", description: "Run on HPC cluster" },
  cloud: { icon: Cloud, label: "Cloud", description: "Run on cloud instance" },
} as const

export function Welcome() {
  const [mode, setMode] = useState<"choose" | "repo">("choose")
  const [repoUrl, setRepoUrl] = useState("")
  const [firstTask, setFirstTask] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showGitHubRepos, setShowGitHubRepos] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddEnvironment, setShowAddEnvironment] = useState(false)
  const [isRefreshingMachines, setIsRefreshingMachines] = useState(false)
  const [selectedMachineId, setSelectedMachineId] = useState<string | undefined>(undefined)
  const [showWorkDirDialog, setShowWorkDirDialog] = useState(false)
  const [workingDirectory, setWorkingDirectory] = useState("")
  const [pathError, setPathError] = useState<string | null>(null)
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false)

  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const addProject = useProjectStore((s) => s.addProject)
  const addNode = usePlanStore((s) => s.addNode)
  const { setupRepo } = useRepoSetup()
  const [searchParams] = useSearchParams()

  // Check if we're in multi-tenant mode (production)
  const isMultiTenant = isServerMode()

  // GitHub integration
  const { connected, repos, selectedRepoIds, fetchRepos } = useGitHubStore()

  // Machine/environment state
  const machinesLoaded = useExecutionStore((s) => s.machinesLoaded)
  const loadMachines = useExecutionStore((s) => s.loadMachines)
  const liveMachines = useRealtimeStore((s) => s.machines)
  const registeredMachines = useMachinesStore((s) => s.machines)
  const fetchRegisteredMachines = useMachinesStore((s) => s.fetchMachines)

  useEffect(() => {
    if (!machinesLoaded) loadMachines()
  }, [machinesLoaded, loadMachines])

  // Fetch registered machines for multi-tenant mode
  // Re-fetch on mount and when navigating back from device auth
  useEffect(() => {
    if (isMultiTenant) {
      fetchRegisteredMachines()
    }
  }, [isMultiTenant, fetchRegisteredMachines])

  // Also fetch machines when page becomes visible (handles device auth redirect)
  useEffect(() => {
    if (!isMultiTenant) return

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchRegisteredMachines()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isMultiTenant, fetchRegisteredMachines])

  // Auto-refresh machines after device auth redirect
  useEffect(() => {
    if (!isMultiTenant) return

    const registered = searchParams.get('registered')
    if (registered === 'true') {
      // Clear the parameter from URL
      navigate('/welcome', { replace: true })

      // Wait for machine to connect to relay, then refresh
      const timer = setTimeout(async () => {
        setIsAutoRefreshing(true)
        console.log('[welcome] Auto-refreshing machines after device registration')
        await fetchRegisteredMachines()
        setIsAutoRefreshing(false)
      }, 3000) // Increased to 3s for better machine connection time

      return () => {
        clearTimeout(timer)
        setIsAutoRefreshing(false)
      }
    }
  }, [isMultiTenant, searchParams, navigate, fetchRegisteredMachines])

  // Compute default machine ID from available machines
  const defaultMachineId = isMultiTenant && registeredMachines.length > 0
    ? registeredMachines[0].id
    : !isMultiTenant && liveMachines.size > 0
    ? Array.from(liveMachines.values())[0]?.machineId
    : undefined

  // Use the selected machine or fallback to default
  const effectiveMachineId = selectedMachineId || defaultMachineId

  // Check if user can create projects (has machines in multi-tenant, or in single-user mode)
  const canCreateProjects = !isMultiTenant || registeredMachines.length > 0

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

  // Show working directory dialog for empty project
  function handleStartEmpty() {
    setShowWorkDirDialog(true)
  }

  // Handle working directory path change with validation
  function handleWorkDirChange(value: string) {
    setWorkingDirectory(value)
    const validation = validateAbsolutePath(value)
    setPathError(validation.isValid ? null : validation.error || null)
  }

  // Create empty project with repo setup on selected machine
  async function handleConfirmWorkDir() {
    // Validate path only if provided
    if (workingDirectory.trim()) {
      const validation = validateAbsolutePath(workingDirectory)
      if (!validation.isValid) {
        setPathError(validation.error || 'Invalid path')
        return
      }
    }
    setPathError(null)

    setIsSubmitting(true)
    const id = crypto.randomUUID()

    try {
      // Call repo setup on the selected machine
      // If workingDirectory is empty, backend will create default path: ~/.astro/projects/{projectId}
      const result = await setupRepo({
        projectId: id,
        projectName: "Quick Start",
        projectDescription: "Your first project - start adding tasks below",
        workingDirectory: workingDirectory.trim() || undefined,
        targetMachineId: isMultiTenant ? effectiveMachineId : undefined,
      })

      // Create project with resolved working directory from backend
      addProject({
        id,
        name: "Quick Start",
        description: "Your first project - start adding tasks below",
        visionDoc: "",
        status: "active",
        defaultMachineId: effectiveMachineId, // Save selected machine in both modes
        workingDirectory: result?.workingDirectory,
        color: '#06b6d4', // cyan blue
        icon: 'FaStar',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      setShowWorkDirDialog(false)
      setWorkingDirectory("")
      setIsSubmitting(false)
      navigate(`/project/${id}/list`)
    } catch (error) {
      console.error('[welcome] Repo setup failed:', error)
      setIsSubmitting(false)
    }
  }

  // Create project with repo and add first task manually (skip AI)
  async function handleStartWithFirstTask() {
    if (!repoUrl.trim() || !firstTask.trim() || isSubmitting) return
    setIsSubmitting(true)

    const id = crypto.randomUUID()
    const projectName = repoUrl.split("/").pop()?.replace(".git", "") || "New Project"

    try {
      // Call repo setup to clone on the selected machine
      const result = await setupRepo({
        projectId: id,
        projectName,
        projectDescription: firstTask.trim(),
        repository: repoUrl.trim(),
        targetMachineId: isMultiTenant ? effectiveMachineId : undefined,
      })

      // Create project with resolved working directory from backend
      addProject({
        id,
        name: projectName,
        description: firstTask.trim(),
        visionDoc: "",
        status: "active",
        repository: repoUrl.trim(),
        defaultMachineId: effectiveMachineId, // Save selected machine in both modes
        workingDirectory: result?.workingDirectory,
        color: '#06b6d4', // cyan blue
        icon: 'FaStar',
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
      console.error('[welcome] Repo setup failed:', error)
      setIsSubmitting(false)
    }
  }

  // Create project with repo and navigate to plan view (optionally use AI)
  async function handleStartWithAI() {
    if (!repoUrl.trim() || isSubmitting) return
    setIsSubmitting(true)

    const id = crypto.randomUUID()
    const projectName = repoUrl.split("/").pop()?.replace(".git", "") || "New Project"

    try {
      // Call repo setup to clone on the selected machine
      const result = await setupRepo({
        projectId: id,
        projectName,
        projectDescription: firstTask.trim() || `Work on ${projectName}`,
        repository: repoUrl.trim(),
        targetMachineId: isMultiTenant ? effectiveMachineId : undefined,
      })

      // Create project with resolved working directory from backend
      addProject({
        id,
        name: projectName,
        description: firstTask.trim() || `Work on ${projectName}`,
        visionDoc: "",
        status: "active",
        repository: repoUrl.trim(),
        defaultMachineId: effectiveMachineId, // Save selected machine in both modes
        workingDirectory: result?.workingDirectory,
        color: '#06b6d4', // cyan blue
        icon: 'FaStar',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      setIsSubmitting(false)
      navigate(`/project/${id}/list`)
    } catch (error) {
      console.error('[welcome] Repo setup failed:', error)
      setIsSubmitting(false)
    }
  }

  // Refresh machines list
  async function handleRefreshMachines() {
    setIsRefreshingMachines(true)
    try {
      if (isMultiTenant) {
        await fetchRegisteredMachines()
      } else {
        await loadMachines()
      }
    } catch (error) {
      console.error('[welcome] Failed to refresh machines:', error)
    }
    setIsRefreshingMachines(false)
  }

  // Group machines by environment type (for single-user mode)
  const machinesByEnv = Array.from(liveMachines.values()).reduce((acc, m) => {
    const env = m.environmentType as keyof typeof environmentConfig
    if (!acc[env]) acc[env] = []
    acc[env].push(m)
    return acc
  }, {} as Record<string, typeof liveMachines extends Map<string, infer M> ? M[] : never>)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Theme toggle - top right */}
      <div className="absolute top-4 right-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="h-10 w-10 rounded-full"
        >
          {theme === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="flex w-full max-w-[900px] flex-col items-center gap-10">
          {/* Brand */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <Compass className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold tracking-[4px] text-foreground">ASTRO</span>
          </div>

          {/* Heading */}
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-center text-3xl font-semibold text-foreground">
              Welcome to Astro
            </h1>
            <p className="max-w-[560px] text-center text-[15px] leading-relaxed text-muted-foreground">
              AI-powered task planning and execution. Start simple, scale gradually.
            </p>
          </div>

          {mode === "choose" ? (
            <>
              {/* Machine registration required in multi-tenant mode */}
              {isMultiTenant && !canCreateProjects && (
                <div className="w-full flex flex-col items-center gap-4 py-8 px-4 rounded-2xl border-2 border-dashed border-border bg-muted/20">
                  <Laptop className="h-12 w-12 text-muted-foreground" />
                  <div className="flex flex-col items-center gap-2 text-center">
                    <h3 className="text-lg font-semibold">Register your machine first</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      To create projects, you need to register at least one machine where tasks will run.
                      Click below to get started.
                    </p>
                    {isAutoRefreshing && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Waiting for machine to connect...
                      </p>
                    )}
                  </div>
                  <Button onClick={() => setShowAddEnvironment(true)} size="lg" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Register Machine
                  </Button>
                </div>
              )}

              {/* Project creation options - only show if can create */}
              {canCreateProjects && (
                <>
                  {/* Instructions in multi-tenant mode */}
                  {isMultiTenant && registeredMachines.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-muted-foreground">
                        Select a machine below, then choose how to start your project
                      </p>
                    </div>
                  )}

                  {/* Two main options - side by side on desktop */}
                  <div className="flex w-full flex-col gap-4 md:flex-row md:gap-6">
                    <OptionCard
                      icon={ListTodo}
                      title="Start with empty project"
                      description="Set up a new working directory on your selected machine and start adding tasks."
                      onClick={handleStartEmpty}
                      disabled={isSubmitting}
                      primary
                      className="flex-1"
                    />
                    <OptionCard
                      icon={GitBranch}
                      title="Start with a repo"
                      description="Link an existing repository. Manually add tasks or optionally use AI to generate a plan."
                      onClick={() => setMode("repo")}
                      disabled={isSubmitting}
                      className="flex-1"
                    />
                  </div>
                </>
              )}

              {/* Available Environments */}
              <div className="w-full flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      {isMultiTenant ? "Select target machine" : "Available execution environments"}
                    </h3>
                    {isMultiTenant && isAutoRefreshing && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Auto-refreshing in a moment...
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshMachines}
                    disabled={isRefreshingMachines}
                    className="h-8 gap-2"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", isRefreshingMachines && "animate-spin")} />
                    Refresh
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {/* Single-user mode: show "Local" + grouped environments */}
                  {!isMultiTenant && (
                    <>
                      <EnvironmentCard
                        env="local"
                        machineCount={1}
                        isLocal
                      />
                      {(['remote', 'hpc', 'cloud'] as const).map((env) => {
                        const count = machinesByEnv[env]?.length || 0
                        return count > 0 ? (
                          <EnvironmentCard
                            key={env}
                            env={env}
                            machineCount={count}
                          />
                        ) : null
                      })}
                    </>
                  )}

                  {/* Multi-tenant mode: show registered machines as selectable cards */}
                  {isMultiTenant && registeredMachines.map((machine) => (
                    <MachineCard
                      key={machine.id}
                      machine={machine}
                      isSelected={effectiveMachineId === machine.id}
                      onClick={() => setSelectedMachineId(machine.id)}
                    />
                  ))}

                  {/* Add new machine/environment */}
                  <button
                    onClick={() => setShowAddEnvironment(true)}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 p-6 text-center transition-colors hover:border-foreground/20 hover:bg-muted/40 cursor-pointer"
                  >
                    <Plus className="h-6 w-6 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {isMultiTenant ? "Register machine" : "Add environment"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {isMultiTenant
                          ? "Connect your laptop, workstation, or server"
                          : "Connect remote machines, HPC clusters, or cloud instances"}
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {isSubmitting && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating your project...
                </div>
              )}
            </>
          ) : (
            <>
              {/* Repo input mode */}
              <div className="flex w-full flex-col gap-4">
                {/* Repo URL */}
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
                            className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                        <button
                          onClick={() => {
                            setShowGitHubRepos(false)
                            setSearchQuery("")
                          }}
                          className="p-2 rounded-md hover:bg-muted transition-colors"
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
                                setShowManualInput(true)
                              }}
                              className="w-full p-3 text-left hover:bg-muted/50 border-b last:border-b-0 transition-colors"
                            >
                              <div className="flex items-start gap-2">
                                <Github className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">
                                    {repo.fullName}
                                  </div>
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
                  ) : showManualInput ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        placeholder="https://github.com/user/repo"
                        className="flex-1 h-10 rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          setRepoUrl("")
                          setShowManualInput(false)
                        }}
                        className="p-2 rounded-md hover:bg-muted transition-colors"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {connected && (
                        <button
                          onClick={() => setShowGitHubRepos(true)}
                          className="flex-1 h-10 flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:border-foreground/20 transition-colors"
                        >
                          <Github className="h-4 w-4" />
                          Browse GitHub repos
                        </button>
                      )}
                      <button
                        onClick={() => setShowManualInput(true)}
                        className="flex-1 h-10 flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:border-foreground/20 transition-colors"
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
                    What do you want to do as a first task?
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
              </div>

              {/* Actions */}
              <div className="flex w-full flex-col gap-3">
                <Button
                  onClick={handleStartWithFirstTask}
                  disabled={!repoUrl.trim() || !firstTask.trim() || isSubmitting}
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
                  onClick={handleStartWithAI}
                  disabled={!repoUrl.trim() || isSubmitting}
                  className="h-12 w-full rounded-xl text-base font-semibold"
                >
                  <Sparkles className="h-[18px] w-[18px]" />
                  Or Use AI to Generate Plan
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setMode("choose")}
                  disabled={isSubmitting}
                  className="h-10 w-full rounded-xl"
                >
                  Back
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add environment dialog */}
      <AddEnvironmentDialog
        open={showAddEnvironment}
        onOpenChange={setShowAddEnvironment}
      />

      {/* Working directory dialog */}
      <Dialog open={showWorkDirDialog} onOpenChange={setShowWorkDirDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set Working Directory</DialogTitle>
            <DialogDescription>
              Specify where your project files will be stored on the selected machine, or leave empty to use the default location.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Working Directory (optional)</label>
              <input
                type="text"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="/absolute/path/to/project (optional)"
                value={workingDirectory}
                onChange={(e) => handleWorkDirChange(e.target.value)}
                autoFocus
              />
              {pathError && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{pathError}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Leave empty to use default path: <span className="font-mono">~/.astro/projects/</span>
                <br />
                Or enter an absolute path starting with / (e.g., /Users/username/projects/my-app)
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowWorkDirDialog(false)
                  setWorkingDirectory("")
                  setPathError(null)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmWorkDir}
                disabled={!!pathError || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Setting up...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function OptionCard({
  icon: Icon,
  title,
  description,
  workdir,
  onClick,
  disabled,
  primary,
  className,
}: {
  icon: typeof ListTodo
  title: string
  description: string
  workdir?: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-6 text-left transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        primary
          ? "border-primary bg-primary/[0.03] hover:bg-primary/[0.05] shadow-[0_2px_8px_rgba(87,73,244,0.12)]"
          : "border-border bg-card hover:border-foreground/20",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl",
            primary ? "bg-primary/10" : "bg-muted"
          )}
        >
          <Icon className={cn("h-5 w-5", primary ? "text-primary" : "text-muted-foreground")} />
        </div>
        <span className="text-base font-semibold text-foreground">{title}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground mb-2">{description}</p>
      {workdir && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate">{workdir}</span>
        </div>
      )}
    </button>
  )
}

function EnvironmentCard({
  env,
  machineCount,
  isLocal,
}: {
  env: keyof typeof environmentConfig
  machineCount: number
  isLocal?: boolean
}) {
  const config = environmentConfig[env]
  const Icon = config.icon

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-foreground">{config.label}</div>
        </div>
        {machineCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            <span>{isLocal ? "Ready" : `${machineCount} connected`}</span>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{config.description}</p>
    </div>
  )
}

function MachineCard({
  machine,
  isSelected,
  onClick,
}: {
  machine: {
    id: string
    name: string
    hostname: string
    platform: string
    environmentType: string
    isConnected: boolean
    providers: string[]
  }
  isSelected?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-xl border-2 p-4 text-left transition-all cursor-pointer",
        isSelected
          ? "border-primary bg-primary/5 shadow-[0_0_0_3px_rgba(99,102,241,0.1)]"
          : "border-border bg-card hover:border-primary/50 hover:bg-card/80"
      )}
    >
      <div className="flex items-center gap-2">
        <div className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg",
          isSelected ? "bg-primary/20" : "bg-primary/10"
        )}>
          <Laptop className={cn("h-4 w-4", isSelected ? "text-primary" : "text-primary")} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{machine.name}</div>
          <div className="text-xs text-muted-foreground truncate">{machine.hostname}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
          <div className={cn(
            "flex items-center gap-1 text-xs",
            machine.isConnected ? "text-green-600" : "text-muted-foreground"
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", machine.isConnected ? "bg-green-600" : "bg-muted-foreground")} />
            <span>{machine.isConnected ? "Online" : "Offline"}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{machine.platform}</p>
        {machine.providers.length > 0 && (
          <div className="flex gap-1">
            {machine.providers.slice(0, 2).map((p) => (
              <span key={p} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{p}</span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}
